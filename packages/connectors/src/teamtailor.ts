import { z } from 'zod';

import {
  normalizedJobSchema,
  teamtailorSourceConfigSchema,
  type NormalizedJob,
  type TeamtailorSourceConfig,
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
const relationshipSchema = z
  .object({ data: z.array(z.object({ id: z.string(), type: z.string() })) })
  .passthrough();
const teamtailorJobSchema = z
  .object({
    id: z.string(),
    type: z.literal('jobs'),
    attributes: z
      .object({
        title: z.string(),
        body: optionalNullableString,
        pitch: optionalNullableString,
        status: optionalNullableString,
        'company-name': optionalNullableString,
        'created-at': optionalNullableString,
        'updated-at': optionalNullableString,
        'start-date': optionalNullableString,
        'end-date': optionalNullableString,
        'employment-type': optionalNullableString,
        'remote-status': optionalNullableString,
        'careersite-job-url': optionalNullableString,
        'careersite-job-apply-url': optionalNullableString,
      })
      .passthrough(),
    relationships: z
      .object({ locations: relationshipSchema.optional() })
      .passthrough()
      .optional(),
    links: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const includedSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    attributes: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const teamtailorCollectionSchema = z
  .object({
    data: z.array(teamtailorJobSchema),
    included: z.array(includedSchema).optional(),
    links: z
      .object({ next: z.string().url().nullable().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const teamtailorDetailSchema = z
  .object({
    data: teamtailorJobSchema,
    included: z.array(includedSchema).optional(),
  })
  .passthrough();
const teamtailorRawSchema = z
  .object({
    posting: teamtailorJobSchema,
    included: z.array(includedSchema),
    companyName: z.string().min(1),
  })
  .strict();

export interface TeamtailorDiscoveredJob extends DiscoveredJob {
  readonly rawSummary: Record<string, unknown> & { id: string };
}

export interface TeamtailorDependencies extends ConnectorHttpDependencies {
  readonly readEnvironment?: (name: string) => string | undefined;
}

function remoteMode(value: string | null | undefined): NormalizedJob['remoteMode'] {
  const mode = value?.toLowerCase().replace(/[ _-]/g, '');
  if (mode?.includes('hybrid')) return 'hybrid';
  if (mode?.includes('remote')) return 'remote';
  if (mode?.includes('onsite') || mode?.includes('office')) return 'onsite';
  return 'unknown';
}

function locationName(
  posting: z.infer<typeof teamtailorJobSchema>,
  included: z.infer<typeof includedSchema>[],
): string {
  const ids = new Set(
    (posting.relationships?.locations?.data ?? []).map((relationship) => relationship.id),
  );
  const names = included
    .filter((resource) => resource.type === 'locations' && ids.has(resource.id))
    .map((resource) => {
      const attributes = resource.attributes;
      return [attributes.name, attributes.city, attributes.country]
        .filter(
          (value): value is string => typeof value === 'string' && value.trim() !== '',
        )
        .join(', ');
    })
    .filter(Boolean);
  return [...new Set(names)].join(' · ') || 'Location not specified';
}

export class TeamtailorConnector implements JobConnector<
  TeamtailorDiscoveredJob,
  Record<string, unknown>
> {
  public readonly type = 'teamtailor';
  private readonly http: ConnectorHttpClient;
  private readonly readEnvironment: (name: string) => string | undefined;

  public constructor(dependencies: TeamtailorDependencies = {}) {
    this.http = new ConnectorHttpClient(dependencies);
    this.readEnvironment = dependencies.readEnvironment ?? ((name) => process.env[name]);
  }

  public async healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult> {
    const config = this.config(context);
    await this.requestPage(config, context, 1, 1, 'health');
    return {
      status: 'healthy',
      message:
        'Official Teamtailor API is reachable with the configured Public Read key.',
    };
  }

  public async discover(
    context: ConnectorContext,
  ): Promise<DiscoveryResult<TeamtailorDiscoveredJob>> {
    const config = this.config(context);
    const jobs = new Map<string, TeamtailorDiscoveredJob>();
    let pagesFetched = 0;
    let complete = false;
    for (let page = 1; page <= config.maxPages; page += 1) {
      const response = await this.requestPage(
        config,
        context,
        page,
        config.pageSize,
        'discover',
      );
      pagesFetched += 1;
      for (const posting of response.data) {
        jobs.set(posting.id, {
          externalId: posting.id,
          rawSummary: { ...posting, id: posting.id },
        });
      }
      if (!response.links?.next || response.data.length < config.pageSize) {
        complete = true;
        break;
      }
    }
    return { jobs: [...jobs.values()], pagesFetched, complete };
  }

  public async fetchDetail(
    job: TeamtailorDiscoveredJob,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const config = this.config(context);
    const url = new URL(
      `/v1/jobs/${encodeURIComponent(job.externalId)}`,
      context.source.baseUrl,
    );
    url.searchParams.set('include', 'locations');
    const raw = await this.http.requestJson(
      'Teamtailor',
      url,
      config,
      context,
      'detail',
      this.headers(config),
    );
    const detail = teamtailorDetailSchema.parse(raw);
    return {
      posting: detail.data,
      included: detail.included ?? [],
      companyName: config.companyName,
    };
  }

  public normalize(raw: Record<string, unknown>): NormalizedJob {
    const { posting, included, companyName } = teamtailorRawSchema.parse(raw);
    const attributes = posting.attributes;
    const descriptionHtml = attributes.body?.trim() || attributes.pitch?.trim() || '';
    const descriptionText = htmlToText(descriptionHtml);
    if (!descriptionText) {
      throw new ConnectorRequestError(
        'Teamtailor detail did not contain a public full description',
        'invalid_response',
      );
    }
    const publicUrl = attributes['careersite-job-url'];
    if (!publicUrl) {
      throw new ConnectorRequestError(
        'Teamtailor detail did not contain a public career-site URL',
        'invalid_response',
      );
    }
    const sourceUrl = canonicalizeUrl(publicUrl);
    const location = locationName(posting, included);
    return normalizedJobSchema.parse({
      externalId: posting.id,
      title: attributes.title.trim(),
      company: attributes['company-name']?.trim() || companyName,
      location,
      publishedAt: parseOptionalDate(
        attributes['start-date'] ?? attributes['created-at'],
      ),
      deadline: parseOptionalDate(attributes['end-date']),
      descriptionText,
      descriptionHtml,
      sourceUrl,
      canonicalUrl: sourceUrl,
      remoteMode: remoteMode(attributes['remote-status']),
      employmentType: attributes['employment-type']?.trim() || null,
      sourceActive: attributes.status === undefined || attributes.status === 'published',
      sourceMetadata: {
        applyUrl: attributes['careersite-job-apply-url'] ?? null,
        status: attributes.status ?? null,
        updatedAt: attributes['updated-at'] ?? null,
        region: null,
      },
      rawData: raw,
    });
  }

  private config(context: ConnectorContext): TeamtailorSourceConfig {
    return teamtailorSourceConfigSchema.parse(context.source.config);
  }

  private headers(config: TeamtailorSourceConfig): Record<string, string> {
    const token = this.readEnvironment(config.apiTokenEnv)?.trim();
    if (!token) {
      throw new ConnectorRequestError(
        `Teamtailor API token environment variable ${config.apiTokenEnv} is not set`,
        'configuration',
      );
    }
    return {
      authorization: `Token token=${token}`,
      'x-api-version': '20210218',
    };
  }

  private async requestPage(
    config: TeamtailorSourceConfig,
    context: ConnectorContext,
    page: number,
    pageSize: number,
    operation: 'health' | 'discover',
  ): Promise<z.infer<typeof teamtailorCollectionSchema>> {
    const url = new URL('/v1/jobs', context.source.baseUrl);
    url.searchParams.set('filter[status]', 'published');
    url.searchParams.set('include', 'locations');
    url.searchParams.set('page[number]', String(page));
    url.searchParams.set('page[size]', String(pageSize));
    const raw = await this.http.requestJson(
      'Teamtailor',
      url,
      config,
      context,
      operation,
      this.headers(config),
    );
    return teamtailorCollectionSchema.parse(raw);
  }
}
