import { z } from 'zod';

import {
  leverSourceConfigSchema,
  normalizedJobSchema,
  type LeverSourceConfig,
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
const leverPostingSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string().url(),
    applyUrl: z.string().url().optional(),
    createdAt: z.union([z.number(), z.string()]).nullable().optional(),
    description: optionalNullableString,
    descriptionPlain: optionalNullableString,
    additional: optionalNullableString,
    additionalPlain: optionalNullableString,
    workplaceType: optionalNullableString,
    categories: z
      .object({
        location: optionalNullableString,
        commitment: optionalNullableString,
        team: optionalNullableString,
        department: optionalNullableString,
        allLocations: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    lists: z
      .array(z.object({ text: z.string(), content: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();
const leverListSchema = z.array(leverPostingSchema);
const leverRawSchema = z
  .object({ posting: leverPostingSchema, companyName: z.string().min(1) })
  .strict();

export interface LeverDiscoveredJob extends DiscoveredJob {
  readonly rawSummary: Record<string, unknown> & { id: string };
}

function descriptionParts(posting: z.infer<typeof leverPostingSchema>): {
  html: string | null;
  text: string;
} {
  const listHtml = (posting.lists ?? [])
    .map((section) => `<h3>${section.text}</h3>${section.content}`)
    .join('\n');
  const html = [posting.description, listHtml, posting.additional]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n')
    .trim();
  const text = [
    posting.descriptionPlain,
    ...(posting.lists ?? []).map(
      (section) => `${section.text}\n${htmlToText(section.content)}`,
    ),
    posting.additionalPlain,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n\n')
    .trim();
  return { html: html || null, text: text || htmlToText(html) };
}

function remoteMode(value: string | null | undefined): NormalizedJob['remoteMode'] {
  const mode = value?.toLowerCase().replace(/[_ -]/g, '');
  if (mode === 'remote') return 'remote';
  if (mode === 'hybrid') return 'hybrid';
  if (mode === 'onsite') return 'onsite';
  return 'unknown';
}

export class LeverConnector implements JobConnector<
  LeverDiscoveredJob,
  Record<string, unknown>
> {
  public readonly type = 'lever';
  private readonly http: ConnectorHttpClient;

  public constructor(dependencies: ConnectorHttpDependencies = {}) {
    this.http = new ConnectorHttpClient(dependencies);
  }

  public async healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult> {
    const config = this.config(context);
    await this.requestPage(config, context, 0, 1, 'health');
    return { status: 'healthy', message: null };
  }

  public async discover(
    context: ConnectorContext,
  ): Promise<DiscoveryResult<LeverDiscoveredJob>> {
    const config = this.config(context);
    const jobs = new Map<string, LeverDiscoveredJob>();
    let pagesFetched = 0;
    let complete = false;

    for (let page = 0; page < config.maxPages; page += 1) {
      const postings = await this.requestPage(
        config,
        context,
        page * config.pageSize,
        config.pageSize,
        'discover',
      );
      pagesFetched += 1;
      for (const posting of postings) {
        jobs.set(posting.id, {
          externalId: posting.id,
          rawSummary: { ...posting, id: posting.id },
        });
      }
      if (postings.length < config.pageSize) {
        complete = true;
        break;
      }
    }

    return { jobs: [...jobs.values()], pagesFetched, complete };
  }

  public async fetchDetail(
    job: LeverDiscoveredJob,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    const config = this.config(context);
    const url = new URL(
      `/v0/postings/${encodeURIComponent(config.site)}/${encodeURIComponent(job.externalId)}`,
      context.source.baseUrl,
    );
    url.searchParams.set('mode', 'json');
    const raw = await this.http.requestJson('Lever', url, config, context, 'detail');
    return { posting: leverPostingSchema.parse(raw), companyName: config.companyName };
  }

  public normalize(raw: Record<string, unknown>): NormalizedJob {
    const { posting, companyName } = leverRawSchema.parse(raw);
    const description = descriptionParts(posting);
    if (!description.text) {
      throw new ConnectorRequestError(
        'Lever detail did not contain a full description',
        'invalid_response',
      );
    }
    const sourceUrl = canonicalizeUrl(posting.hostedUrl);

    return normalizedJobSchema.parse({
      externalId: posting.id,
      title: posting.text.trim(),
      company: companyName,
      location: posting.categories?.location?.trim() || 'Location not specified',
      publishedAt: parseOptionalDate(posting.createdAt),
      deadline: null,
      descriptionText: description.text,
      descriptionHtml: description.html,
      sourceUrl,
      canonicalUrl: sourceUrl,
      remoteMode: remoteMode(posting.workplaceType),
      employmentType: posting.categories?.commitment?.trim() || null,
      sourceActive: true,
      sourceMetadata: {
        applyUrl: posting.applyUrl ?? null,
        team: posting.categories?.team ?? null,
        department: posting.categories?.department ?? null,
        allLocations: posting.categories?.allLocations ?? [],
        workplaceType: posting.workplaceType ?? null,
      },
      rawData: raw,
    });
  }

  private config(context: ConnectorContext): LeverSourceConfig {
    return leverSourceConfigSchema.parse(context.source.config);
  }

  private async requestPage(
    config: LeverSourceConfig,
    context: ConnectorContext,
    skip: number,
    limit: number,
    operation: 'health' | 'discover',
  ): Promise<z.infer<typeof leverListSchema>> {
    const url = new URL(
      `/v0/postings/${encodeURIComponent(config.site)}`,
      context.source.baseUrl,
    );
    url.searchParams.set('mode', 'json');
    url.searchParams.set('skip', String(skip));
    url.searchParams.set('limit', String(limit));
    const raw = await this.http.requestJson('Lever', url, config, context, operation);
    return leverListSchema.parse(raw);
  }
}
