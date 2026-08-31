import type { NormalizedJob, Source, SourceErrorCategory } from '@job-radar/shared';

export interface ConnectorRetryEvent {
  readonly operation: 'health' | 'discover' | 'detail';
  readonly attempt: number;
  readonly statusCode?: number;
}

export interface ConnectorContext {
  readonly source: Source;
  readonly queries: readonly string[];
  readonly signal: AbortSignal;
  readonly onRetry: (event: ConnectorRetryEvent) => void;
}

export interface ConnectorHealthResult {
  readonly status: 'healthy' | 'degraded' | 'unavailable';
  readonly message: string | null;
}

export interface DiscoveredJob {
  readonly externalId: string;
  readonly rawSummary: Record<string, unknown>;
}

export interface DiscoveryResult<TJob extends DiscoveredJob = DiscoveredJob> {
  readonly jobs: readonly TJob[];
  readonly pagesFetched: number;
  readonly complete: boolean;
}

export interface JobConnector<
  TDiscovered extends DiscoveredJob = DiscoveredJob,
  TRaw extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly type: string;
  healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult>;
  discover(context: ConnectorContext): Promise<DiscoveryResult<TDiscovered>>;
  fetchDetail(job: TDiscovered, context: ConnectorContext): Promise<TRaw>;
  normalize(raw: TRaw): Promise<NormalizedJob> | NormalizedJob;
}

export class ConnectorCancelledError extends Error {
  public constructor() {
    super('Connector operation cancelled');
    this.name = 'ConnectorCancelledError';
  }
}

export class ConnectorRequestError extends Error {
  public constructor(
    message: string,
    public readonly category: SourceErrorCategory,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ConnectorRequestError';
  }
}
