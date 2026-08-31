import { z } from 'zod';

import {
  jobTechSourceConfigSchema,
  normalizedJobSchema,
  type JobTechSourceConfig,
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
import { canonicalizeUrl } from './util.js';

const optionalNullableString = z.string().nullable().optional();
const jobTechAdSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    external_id: optionalNullableString,
    webpage_url: optionalNullableString,
    headline: z.string(),
    application_deadline: optionalNullableString,
    description: z
      .object({
        text: z.string(),
        text_formatted: optionalNullableString,
      })
      .passthrough(),
    employment_type: z
      .object({ label: optionalNullableString })
      .passthrough()
      .nullable()
      .optional(),
    employer: z
      .object({ name: optionalNullableString, workplace: optionalNullableString })
      .passthrough()
      .nullable()
      .optional(),
    workplace_address: z
      .object({
        city: optionalNullableString,
        municipality: optionalNullableString,
        region: optionalNullableString,
        country: optionalNullableString,
      })
      .passthrough()
      .nullable()
      .optional(),
    publication_date: optionalNullableString,
    removed: z.boolean().nullable().optional(),
    remote_work: z.boolean().nullable().optional(),
  })
  .passthrough();

const searchHitSchema = z
  .object({ id: z.union([z.string(), z.number()]).transform(String) })
  .passthrough();
const searchResponseSchema = z
  .object({
    total: z
      .union([
        z.number().int().nonnegative(),
        z.object({ value: z.number().int().nonnegative() }).passthrough(),
      ])
      .optional(),
    hits: z.array(searchHitSchema),
  })
  .passthrough();

export type JobTechRawAd = z.infer<typeof jobTechAdSchema>;
export interface JobTechDiscoveredJob extends DiscoveredJob {
  readonly rawSummary: Record<string, unknown> & { id: string };
}

export type JobTechConnectorDependencies = ConnectorHttpDependencies;

function totalValue(total: z.infer<typeof searchResponseSchema>['total']): number | null {
  if (total === undefined) return null;
  return typeof total === 'number' ? total : total.value;
}

function parseDate(value: string | null | undefined, endOfDay = false): string | null {
  if (!value) return null;
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferRemoteMode(
  description: string,
  remoteWork: boolean | null | undefined,
): 'onsite' | 'hybrid' | 'remote' | 'unknown' {
  const text = description.toLocaleLowerCase('sv-SE');
  if (/\b(hybrid|hybridarbete)\b|delvis.{0,24}distans/.test(text)) return 'hybrid';
  if (/\b(fully remote|remote only|100% remote)\b|helt.{0,20}(på )?distans/.test(text)) {
    return 'remote';
  }
  return remoteWork === true ? 'hybrid' : 'unknown';
}

function locationLabel(ad: JobTechRawAd): string {
  const address = ad.workplace_address;
  const values = [address?.city, address?.municipality, address?.region, address?.country]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  return [...new Set(values)].join(', ') || 'Location not specified';
}

export class JobTechConnector implements JobConnector<
  JobTechDiscoveredJob,
  Record<string, unknown>
> {
  public readonly type = 'jobtech';
  private readonly http: ConnectorHttpClient;

  public constructor(dependencies: JobTechConnectorDependencies = {}) {
    this.http = new ConnectorHttpClient(dependencies);
  }

  public async healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult> {
    const config = this.config(context);
    const url = this.searchUrl(context, context.queries[0] ?? 'jobb', 0, 1);
    await this.requestJson(url, config, context, 'health');
    return { status: 'healthy', message: null };
  }

  public async discover(
    context: ConnectorContext,
  ): Promise<DiscoveryResult<JobTechDiscoveredJob>> {
    const config = this.config(context);
    const jobs = new Map<string, JobTechDiscoveredJob>();
    let pagesFetched = 0;
    let complete = true;

    for (const query of context.queries) {
      let offset = 0;
      let queryComplete = false;

      for (let page = 0; page < config.maxPages; page += 1) {
        const url = this.searchUrl(context, query, offset, config.pageSize);
        const raw = await this.requestJson(url, config, context, 'discover');
        const response = searchResponseSchema.parse(raw);
        pagesFetched += 1;

        for (const hit of response.hits) {
          const rawSummary = { ...hit, id: hit.id };
          jobs.set(hit.id, { externalId: hit.id, rawSummary });
        }

        offset += response.hits.length;
        const total = totalValue(response.total);
        if (
          response.hits.length === 0 ||
          response.hits.length < config.pageSize ||
          (total !== null && offset >= total)
        ) {
          queryComplete = true;
          break;
        }
      }

      if (!queryComplete) complete = false;
    }

    return { jobs: [...jobs.values()], pagesFetched, complete };
  }

  public async fetchDetail(
    job: JobTechDiscoveredJob,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const config = this.config(context);
    const url = new URL(
      `/ad/${encodeURIComponent(job.externalId)}`,
      context.source.baseUrl,
    );
    const raw = await this.requestJson(url, config, context, 'detail');
    return jobTechAdSchema.parse(raw) as Record<string, unknown>;
  }

  public normalize(raw: Record<string, unknown>): NormalizedJob {
    const ad = jobTechAdSchema.parse(raw);
    const sourceUrl = canonicalizeUrl(
      ad.webpage_url ??
        `https://arbetsformedlingen.se/platsbanken/annonser/${encodeURIComponent(ad.id)}`,
    );
    const descriptionText = ad.description.text.trim();
    if (!descriptionText) {
      throw new ConnectorRequestError(
        'JobTech detail did not contain a full description',
        'invalid_response',
      );
    }

    return normalizedJobSchema.parse({
      externalId: ad.id,
      title: ad.headline.trim(),
      company:
        ad.employer?.name?.trim() ||
        ad.employer?.workplace?.trim() ||
        'Employer not specified',
      location: locationLabel(ad),
      publishedAt: parseDate(ad.publication_date),
      deadline: parseDate(ad.application_deadline, true),
      descriptionText,
      descriptionHtml: ad.description.text_formatted?.trim() || null,
      sourceUrl,
      canonicalUrl: sourceUrl,
      remoteMode: inferRemoteMode(descriptionText, ad.remote_work),
      employmentType: ad.employment_type?.label?.trim() || null,
      sourceActive: ad.removed !== true,
      sourceMetadata: {
        externalId: ad.external_id ?? null,
        workplace: ad.employer?.workplace ?? null,
      },
      rawData: ad,
    });
  }

  private config(context: ConnectorContext): JobTechSourceConfig {
    return jobTechSourceConfigSchema.parse(context.source.config);
  }

  private searchUrl(
    context: ConnectorContext,
    query: string,
    offset: number,
    limit: number,
  ): URL {
    const url = new URL('/search', context.source.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));
    return url;
  }

  private async requestJson(
    url: URL,
    config: JobTechSourceConfig,
    context: ConnectorContext,
    operation: 'health' | 'discover' | 'detail',
  ): Promise<unknown> {
    return this.http.requestJson('JobTech', url, config, context, operation);
  }
}
