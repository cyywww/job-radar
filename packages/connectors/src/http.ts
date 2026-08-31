import type { SourceErrorCategory } from '@job-radar/shared';

import {
  ConnectorCancelledError,
  type ConnectorContext,
  type ConnectorRetryEvent,
  ConnectorRequestError,
} from './contracts.js';
import { abortableDelay } from './util.js';

export interface ConnectorRequestPolicy {
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly minRequestIntervalMs: number;
  readonly userAgent: string;
}

export interface ConnectorHttpDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
}

class RequestGate {
  private tail = Promise.resolve();
  private nextAllowedAt = 0;

  public constructor(
    private readonly intervalMs: number,
    private readonly now: () => number,
    private readonly delay: (ms: number, signal: AbortSignal) => Promise<void>,
  ) {}

  public async wait(signal: AbortSignal): Promise<void> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.delay(Math.max(0, this.nextAllowedAt - this.now()), signal);
      this.nextAllowedAt = this.now() + this.intervalMs;
    } finally {
      release();
    }
  }
}

function categoryForStatus(status: number): SourceErrorCategory {
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'http_server';
  return 'http_client';
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000);
  const at = new Date(raw).getTime();
  return Number.isNaN(at) ? null : Math.min(Math.max(0, at - Date.now()), 60_000);
}

export class ConnectorHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly gates = new Map<string, RequestGate>();

  public constructor(dependencies: ConnectorHttpDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.delay = dependencies.delay ?? abortableDelay;
  }

  public async requestJson(
    label: string,
    url: URL,
    policy: ConnectorRequestPolicy,
    context: ConnectorContext,
    operation: ConnectorRetryEvent['operation'],
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    let retryStatusCode: number | undefined;
    let nextDelayMs: number | null = null;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
      if (context.signal.aborted) throw new ConnectorCancelledError();
      if (attempt > 0) {
        context.onRetry({
          operation,
          attempt,
          ...(retryStatusCode === undefined ? {} : { statusCode: retryStatusCode }),
        });
        await this.delay(
          nextDelayMs ?? policy.retryBaseDelayMs * 2 ** (attempt - 1),
          context.signal,
        );
      }

      await this.gate(context.source.id, policy).wait(context.signal);
      const timeoutController = new AbortController();
      const timeout = setTimeout(
        () => timeoutController.abort(),
        policy.requestTimeoutMs,
      );
      const signal = AbortSignal.any([context.signal, timeoutController.signal]);

      try {
        const response = await this.fetchImpl(url, {
          headers: {
            accept: 'application/json',
            'user-agent': policy.userAgent,
            ...extraHeaders,
          },
          signal,
        });
        if (response.ok) {
          try {
            return await response.json();
          } catch {
            throw new ConnectorRequestError(
              `${label} returned invalid JSON`,
              'invalid_response',
              response.status,
            );
          }
        }

        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        if (!retryable || attempt === policy.maxRetries) {
          throw new ConnectorRequestError(
            `${label} request failed with HTTP ${response.status}`,
            categoryForStatus(response.status),
            response.status,
          );
        }
        retryStatusCode = response.status;
        nextDelayMs = retryAfterMs(response);
      } catch (error) {
        if (context.signal.aborted) throw new ConnectorCancelledError();
        if (error instanceof ConnectorRequestError) throw error;
        if (attempt === policy.maxRetries) {
          const timedOut = timeoutController.signal.aborted;
          throw new ConnectorRequestError(
            `${label} request ${timedOut ? 'timed out' : 'failed'}`,
            timedOut ? 'timeout' : 'transport',
          );
        }
        retryStatusCode = undefined;
        nextDelayMs = null;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ConnectorRequestError(`${label} request failed`, 'transport');
  }

  private gate(sourceId: string, policy: ConnectorRequestPolicy): RequestGate {
    const existing = this.gates.get(sourceId);
    if (existing) return existing;
    const gate = new RequestGate(policy.minRequestIntervalMs, this.now, this.delay);
    this.gates.set(sourceId, gate);
    return gate;
  }
}
