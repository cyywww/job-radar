import { z } from 'zod';

import {
  ashbySourceConfigSchema,
  normalizedJobSchema,
  type AshbySourceConfig,
  type NormalizedJob,
} from '@job-radar/shared';

import {
  type ConnectorContext,
  type ConnectorHealthResult,
  ConnectorRequestError,
  type DiscoveredJob,
  type DiscoveryResult,
  type JobConnector,
} from './contracts.js';
import { ConnectorHttpClient, type ConnectorHttpDependencies } from './http.js';
import { canonicalizeUrl, htmlToText, parseOptionalDate } from './util.js';

const optionalNullableString = z.string().nullable().optional();
const ashbyJobSchema = z
  .object({
    title: z.string(),
    location: optionalNullableString,
    department: optionalNullableString,
    team: optionalNullableString,
    isRemote: z.boolean().optional(),
    workplaceType: optionalNullableString,
    descriptionHtml: optionalNullableString,
    descriptionPlain: optionalNullableString,
    publishedAt: optionalNullableString,
    employmentType: optionalNullableString,
    jobUrl: z.string().url(),
    applyUrl: z.string().url().optional(),
    isListed: z.boolean().optional(),
    secondaryLocations: z.array(z.record(z.string(), z.unknown())).optional(),
    address: z.record(z.string(), z.unknown()).optional(),
    compensation: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const ashbyBoardSchema = z
  .object({ apiVersion: z.string(), jobs: z.array(ashbyJobSchema) })
  .passthrough();
const ashbyRawSchema = z
  .object({ posting: ashbyJobSchema, companyName: z.string().min(1) })
  .strict();

export interface AshbyDiscoveredJob extends DiscoveredJob {
  readonly rawSummary: Record<string, unknown>;
}

function externalId(jobUrl: string): string {
  const url = new URL(jobUrl);
  const id = url.pathname.split('/').filter(Boolean).at(-1);
  if (!id) {
    throw new ConnectorRequestError(
      'Ashby job URL did not contain a stable posting ID',
      'invalid_response',
    );
  }
  return id;
}

function remoteMode(value: string | null | undefined): NormalizedJob['remoteMode'] {
  const mode = value?.toLowerCase().replace(/[_ -]/g, '');
  if (mode === 'remote') return 'remote';
  if (mode === 'hybrid') return 'hybrid';
  if (mode === 'onsite') return 'onsite';
  return 'unknown';
}

export class AshbyConnector implements JobConnector<
  AshbyDiscoveredJob,
  Record<string, unknown>
> {
  public readonly type = 'ashby';
  private readonly http: ConnectorHttpClient;

  public constructor(dependencies: ConnectorHttpDependencies = {}) {
    this.http = new ConnectorHttpClient(dependencies);
  }

  public async healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult> {
    const config = this.config(context);
    await this.requestBoard(config, context, 'health');
    return { status: 'healthy', message: null };
  }

  public async discover(
    context: ConnectorContext,
  ): Promise<DiscoveryResult<AshbyDiscoveredJob>> {
    const config = this.config(context);
    const board = await this.requestBoard(config, context, 'discover');
    const jobs = board.jobs
      .filter((job) => job.isListed !== false)
      .map((job) => ({ externalId: externalId(job.jobUrl), rawSummary: job }));
    return { jobs, pagesFetched: 1, complete: true };
  }

  public async fetchDetail(
    job: AshbyDiscoveredJob,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const config = this.config(context);
    return {
      posting: ashbyJobSchema.parse(job.rawSummary),
      companyName: config.companyName,
    };
  }

  public normalize(raw: Record<string, unknown>): NormalizedJob {
    const { posting, companyName } = ashbyRawSchema.parse(raw);
    const descriptionText =
      posting.descriptionPlain?.trim() || htmlToText(posting.descriptionHtml ?? '');
    if (!descriptionText) {
      throw new ConnectorRequestError(
        'Ashby posting did not contain a full description',
        'invalid_response',
      );
    }
    const sourceUrl = canonicalizeUrl(posting.jobUrl);

    return normalizedJobSchema.parse({
      externalId: externalId(posting.jobUrl),
      title: posting.title.trim(),
      company: companyName,
      location: posting.location?.trim() || 'Location not specified',
      publishedAt: parseOptionalDate(posting.publishedAt),
      deadline: null,
      descriptionText,
      descriptionHtml: posting.descriptionHtml?.trim() || null,
      sourceUrl,
      canonicalUrl: sourceUrl,
      remoteMode: remoteMode(posting.workplaceType),
      employmentType: posting.employmentType?.trim() || null,
      sourceActive: true,
      sourceMetadata: {
        applyUrl: posting.applyUrl ?? null,
        department: posting.department ?? null,
        team: posting.team ?? null,
        isRemote: posting.isRemote ?? null,
        secondaryLocations: posting.secondaryLocations ?? [],
        address: posting.address ?? null,
        compensation: posting.compensation ?? null,
      },
      rawData: raw,
    });
  }

  private config(context: ConnectorContext): AshbySourceConfig {
    return ashbySourceConfigSchema.parse(context.source.config);
  }

  private async requestBoard(
    config: AshbySourceConfig,
    context: ConnectorContext,
    operation: 'health' | 'discover',
  ): Promise<z.infer<typeof ashbyBoardSchema>> {
    const url = new URL(
      `/posting-api/job-board/${encodeURIComponent(config.boardName)}`,
      context.source.baseUrl,
    );
    url.searchParams.set('includeCompensation', String(config.includeCompensation));
    const raw = await this.http.requestJson('Ashby', url, config, context, operation);
    return ashbyBoardSchema.parse(raw);
  }
}
