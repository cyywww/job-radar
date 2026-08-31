import { z } from 'zod';

import {
  greenhouseSourceConfigSchema,
  normalizedJobSchema,
  type GreenhouseSourceConfig,
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
import {
  canonicalizeUrl,
  decodeHtmlEntities,
  htmlToText,
  parseOptionalDate,
} from './util.js';

const optionalNullableString = z.string().nullable().optional();
const greenhouseSummarySchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    absolute_url: z.string().url(),
    location: z.object({ name: optionalNullableString }).passthrough().optional(),
  })
  .passthrough();
const greenhouseListSchema = z
  .object({
    jobs: z.array(greenhouseSummarySchema),
    meta: z.object({ total: z.number().int().nonnegative() }).passthrough().optional(),
  })
  .passthrough();
const greenhouseDetailSchema = greenhouseSummarySchema
  .extend({
    company_name: optionalNullableString,
    first_published: optionalNullableString,
    updated_at: optionalNullableString,
    application_deadline: optionalNullableString,
    content: z.string(),
    internal_job_id: z.union([z.string(), z.number()]).nullable().optional(),
    requisition_id: z.union([z.string(), z.number()]).nullable().optional(),
    departments: z.array(z.record(z.string(), z.unknown())).optional(),
    offices: z.array(z.record(z.string(), z.unknown())).optional(),
    metadata: z.unknown().optional(),
    language: optionalNullableString,
  })
  .passthrough();
const greenhouseRawSchema = z
  .object({
    posting: greenhouseDetailSchema,
    companyName: z.string().min(1),
  })
  .strict();

export interface GreenhouseDiscoveredJob extends DiscoveredJob {
  readonly rawSummary: Record<string, unknown> & { id: string };
}

function remoteMode(location: string, description: string): NormalizedJob['remoteMode'] {
  const value = `${location} ${description}`.toLowerCase();
  if (value.includes('hybrid')) return 'hybrid';
  if (value.includes('remote')) return 'remote';
  return 'unknown';
}

export class GreenhouseConnector implements JobConnector<
  GreenhouseDiscoveredJob,
  Record<string, unknown>
> {
  public readonly type = 'greenhouse';
  private readonly http: ConnectorHttpClient;

  public constructor(dependencies: ConnectorHttpDependencies = {}) {
    this.http = new ConnectorHttpClient(dependencies);
  }

  public async healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult> {
    const config = this.config(context);
    await this.requestList(config, context, 'health');
    return { status: 'healthy', message: null };
  }

  public async discover(
    context: ConnectorContext,
  ): Promise<DiscoveryResult<GreenhouseDiscoveredJob>> {
    const config = this.config(context);
    const list = await this.requestList(config, context, 'discover');
    return {
      jobs: list.jobs.map((job) => ({
        externalId: job.id,
        rawSummary: { ...job, id: job.id },
      })),
      pagesFetched: 1,
      complete: true,
    };
  }

  public async fetchDetail(
    job: GreenhouseDiscoveredJob,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const config = this.config(context);
    const url = new URL(
      `/v1/boards/${encodeURIComponent(config.boardToken)}/jobs/${encodeURIComponent(job.externalId)}`,
      context.source.baseUrl,
    );
    const raw = await this.http.requestJson('Greenhouse', url, config, context, 'detail');
    return {
      posting: greenhouseDetailSchema.parse(raw),
      companyName: config.companyName,
    };
  }

  public normalize(raw: Record<string, unknown>): NormalizedJob {
    const { posting, companyName } = greenhouseRawSchema.parse(raw);
    const descriptionHtml = decodeHtmlEntities(posting.content).trim();
    const descriptionText = htmlToText(descriptionHtml);
    if (!descriptionText) {
      throw new ConnectorRequestError(
        'Greenhouse detail did not contain a full description',
        'invalid_response',
      );
    }
    const location = posting.location?.name?.trim() || 'Location not specified';
    const sourceUrl = canonicalizeUrl(posting.absolute_url);

    return normalizedJobSchema.parse({
      externalId: posting.id,
      title: posting.title.trim(),
      company: posting.company_name?.trim() || companyName,
      location,
      publishedAt: parseOptionalDate(posting.first_published),
      deadline: parseOptionalDate(posting.application_deadline),
      descriptionText,
      descriptionHtml: descriptionHtml || null,
      sourceUrl,
      canonicalUrl: sourceUrl,
      remoteMode: remoteMode(location, descriptionText),
      employmentType: null,
      sourceActive: true,
      sourceMetadata: {
        internalJobId: posting.internal_job_id ?? null,
        requisitionId: posting.requisition_id ?? null,
        departments: posting.departments ?? [],
        offices: posting.offices ?? [],
        metadata: posting.metadata ?? null,
        language: posting.language ?? null,
        updatedAt: posting.updated_at ?? null,
      },
      rawData: raw,
    });
  }

  private config(context: ConnectorContext): GreenhouseSourceConfig {
    return greenhouseSourceConfigSchema.parse(context.source.config);
  }

  private async requestList(
    config: GreenhouseSourceConfig,
    context: ConnectorContext,
    operation: 'health' | 'discover',
  ): Promise<z.infer<typeof greenhouseListSchema>> {
    const url = new URL(
      `/v1/boards/${encodeURIComponent(config.boardToken)}/jobs`,
      context.source.baseUrl,
    );
    const raw = await this.http.requestJson(
      'Greenhouse',
      url,
      config,
      context,
      operation,
    );
    return greenhouseListSchema.parse(raw);
  }
}
