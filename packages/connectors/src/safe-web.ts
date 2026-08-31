import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

import {
  ConnectorCancelledError,
  type ConnectorContext,
  type ConnectorRetryEvent,
  ConnectorRequestError,
} from './contracts.js';
import type { ConnectorRequestPolicy } from './http.js';
import { abortableDelay } from './util.js';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type SafeFetch = (
  input: string | URL,
  init: {
    method: 'GET';
    redirect: 'manual';
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
    dispatcher?: Agent;
  },
) => Promise<Response>;

export interface SafeWebDependencies {
  readonly resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly fetch?: SafeFetch;
  readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return (
    (((parts[0]! << 24) >>> 0) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
  );
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, prefix]) => inIpv4Range(value, ipv4Number(base)!, prefix));
}

function ipv6Number(address: string): bigint | null {
  let input = address.toLowerCase().split('%', 1)[0] ?? '';
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const ipv4 = ipv4Number(input.slice(lastColon + 1));
    if (ipv4 === null) return null;
    input = `${input.slice(0, lastColon)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(
      ipv4 & 0xffff
    ).toString(16)}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const zeros = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array.from({ length: zeros }, () => '0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return parts.reduce((total, part) => (total << 16n) | BigInt(`0x${part}`), 0n);
}

function inIpv6Range(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

export function isPublicIpv6(address: string): boolean {
  const value = ipv6Number(address);
  if (value === null) return false;
  const mappedBase = ipv6Number('::ffff:0:0')!;
  if (inIpv6Range(value, mappedBase, 96)) {
    return isPublicIpv4(
      `${Number((value >> 24n) & 255n)}.${Number((value >> 16n) & 255n)}.${Number(
        (value >> 8n) & 255n,
      )}.${Number(value & 255n)}`,
    );
  }
  const blocked: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ];
  return !blocked.some(([base, prefix]) => inIpv6Range(value, ipv6Number(base)!, prefix));
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? isPublicIpv4(address)
    : family === 6
      ? isPublicIpv6(address)
      : false;
}

export function assertSafePublicHttpsUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (url.protocol !== 'https:') {
    throw new ConnectorRequestError(
      'Target company page URLs must use HTTPS',
      'unsafe_url',
    );
  }
  if (url.username || url.password) {
    throw new ConnectorRequestError('URL credentials are not allowed', 'unsafe_url');
  }
  if (url.port && url.port !== '443') {
    throw new ConnectorRequestError(
      'Only the standard HTTPS port is allowed',
      'unsafe_url',
    );
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new ConnectorRequestError('Local and metadata hosts are blocked', 'unsafe_url');
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new ConnectorRequestError(
      'Local, private, reserved, and metadata addresses are blocked',
      'unsafe_url',
    );
  }
  return url;
}

async function defaultResolve(hostname: string): Promise<readonly ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
}

async function readBoundedHtml(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    throw new ConnectorRequestError(
      'Target company page response exceeded the 2 MiB safety limit',
      'invalid_response',
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new ConnectorRequestError(
        'Target company page response exceeded the 2 MiB safety limit',
        'invalid_response',
      );
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export class SafeWebClient {
  private readonly resolve: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  private readonly fetchImpl: SafeFetch;
  private readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;

  public constructor(dependencies: SafeWebDependencies = {}) {
    this.resolve = dependencies.resolve ?? defaultResolve;
    this.fetchImpl =
      dependencies.fetch ??
      (async (input, init) =>
        (await undiciFetch(input, init as never)) as unknown as Response);
    this.delay = dependencies.delay ?? abortableDelay;
  }

  public async requestHtml(
    label: string,
    input: string | URL,
    policy: ConnectorRequestPolicy,
    context: ConnectorContext,
    operation: ConnectorRetryEvent['operation'],
  ): Promise<{ html: string; finalUrl: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
      if (attempt > 0) {
        context.onRetry({ operation, attempt });
        await this.delay(policy.retryBaseDelayMs * 2 ** (attempt - 1), context.signal);
      }
      try {
        return await this.requestOnce(label, input, policy, context);
      } catch (error) {
        if (context.signal.aborted || error instanceof ConnectorCancelledError) {
          throw new ConnectorCancelledError();
        }
        if (
          error instanceof ConnectorRequestError &&
          ['unsafe_url', 'configuration', 'http_client', 'not_found'].includes(
            error.category,
          )
        ) {
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError instanceof ConnectorRequestError) throw lastError;
    throw new ConnectorRequestError(`${label} request failed`, 'transport');
  }

  private async requestOnce(
    label: string,
    input: string | URL,
    policy: ConnectorRequestPolicy,
    context: ConnectorContext,
  ): Promise<{ html: string; finalUrl: string }> {
    let current = assertSafePublicHttpsUrl(input);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (context.signal.aborted) throw new ConnectorCancelledError();
      const addresses = await this.resolve(current.hostname);
      if (
        addresses.length === 0 ||
        addresses.some(({ address }) => !isPublicAddress(address))
      ) {
        throw new ConnectorRequestError(
          'URL resolved to a local, private, reserved, or metadata address',
          'unsafe_url',
        );
      }
      const selected = addresses[0]!;
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: selected.address, family: selected.family }]);
        } else {
          callback(null, selected.address, selected.family);
        }
      };
      const dispatcher = new Agent({ connect: { lookup } });
      const timeoutController = new AbortController();
      const timeout = setTimeout(
        () => timeoutController.abort(),
        policy.requestTimeoutMs,
      );
      try {
        const requestInit: Parameters<SafeFetch>[1] = {
          method: 'GET',
          redirect: 'manual',
          headers: {
            accept: 'text/html, application/xhtml+xml',
            'user-agent': policy.userAgent,
          },
          signal: AbortSignal.any([context.signal, timeoutController.signal]),
        };
        requestInit.dispatcher = dispatcher;
        const response = await this.fetchImpl(current, requestInit);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location || redirect === MAX_REDIRECTS) {
            throw new ConnectorRequestError(
              `${label} returned too many or invalid redirects`,
              'unsafe_url',
            );
          }
          current = assertSafePublicHttpsUrl(new URL(location, current));
          continue;
        }
        if (!response.ok) {
          const category =
            response.status === 404
              ? 'not_found'
              : response.status === 429
                ? 'rate_limited'
                : response.status >= 500
                  ? 'http_server'
                  : 'http_client';
          throw new ConnectorRequestError(
            `${label} request failed with HTTP ${response.status}`,
            category,
            response.status,
          );
        }
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (
          contentType &&
          !contentType.includes('text/html') &&
          !contentType.includes('application/xhtml+xml')
        ) {
          throw new ConnectorRequestError(
            `${label} did not return HTML`,
            'invalid_response',
          );
        }
        return { html: await readBoundedHtml(response), finalUrl: current.toString() };
      } catch (error) {
        if (context.signal.aborted) throw new ConnectorCancelledError();
        if (error instanceof ConnectorRequestError) throw error;
        if (timeoutController.signal.aborted) {
          throw new ConnectorRequestError(`${label} request timed out`, 'timeout');
        }
        throw new ConnectorRequestError(`${label} request failed`, 'transport');
      } finally {
        clearTimeout(timeout);
        await dispatcher.close();
      }
    }
    throw new ConnectorRequestError(`${label} redirect policy failed`, 'unsafe_url');
  }
}
