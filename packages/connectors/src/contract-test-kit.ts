import { normalizedJobSchema, type NormalizedJob } from '@job-radar/shared';

import type {
  ConnectorContext,
  ConnectorHealthResult,
  DiscoveredJob,
  DiscoveryResult,
  JobConnector,
} from './contracts.js';

export interface ConnectorContractResult {
  readonly health: ConnectorHealthResult;
  readonly discovery: DiscoveryResult;
  readonly normalized: readonly NormalizedJob[];
}

export async function exerciseConnectorContract(
  connector: JobConnector,
  context: ConnectorContext,
): Promise<ConnectorContractResult> {
  const health = await connector.healthCheck(context);
  const discovery = await connector.discover(context);
  const externalIds = new Set<string>();
  const normalized: NormalizedJob[] = [];

  for (const job of discovery.jobs) {
    if (externalIds.has(job.externalId)) {
      throw new Error('Connector discovery returned duplicate external IDs');
    }
    externalIds.add(job.externalId);
    const detail = await connector.fetchDetail(job as DiscoveredJob, context);
    const value = normalizedJobSchema.parse(await connector.normalize(detail));
    if (value.externalId !== job.externalId) {
      throw new Error('Normalized external ID did not match discovery');
    }
    normalized.push(value);
  }

  return { health, discovery, normalized };
}
