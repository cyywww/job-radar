import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  genericWebSourceConfigSchema,
  normalizedJobSchema,
  type GenericWebSourceConfig,
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
import { SafeWebClient, type SafeWebDependencies } from './safe-web.js';
import { canonicalizeUrl, htmlToText, parseOptionalDate } from './util.js';

const jsonLdJobSchema = z
  .object({
    '@type': z.union([z.string(), z.array(z.string())]),
    title: z.string(),
    description: z.string(),
    url: z.string().optional(),
    datePosted: z.union([z.string(), z.number()]).nullable().optional(),
    validThrough: z.union([z.string(), z.number()]).nullable().optional(),
    employmentType: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    jobLocationType: z.string().nullable().optional(),
    identifier: z
      .union([
        z.string(),
        z.number(),
        z.object({ value: z.union([z.string(), z.number()]) }).passthrough(),
      ])
      .nullable()
      .optional(),
    hiringOrganization: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    jobLocation: z.unknown().optional(),
    applicantLocationRequirements: z.unknown().optional(),
  })
  .passthrough();
const genericRawSchema = z
  .object({
    posting: jsonLdJobSchema,
    pageUrl: z.string().url(),
    companyName: z.string().min(1),
  })
  .strict();

export interface GenericWebDiscoveredJob extends DiscoveredJob {
  readonly rawSummary: Record<string, unknown>;
}

function isJobPosting(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const type = (value as Record<string, unknown>)['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [value, ...flattenJsonLd(record['@graph'])];
}

export function extractJsonLdJobPostings(
  html: string,
): Array<z.infer<typeof jsonLdJobSchema>> {
  const postings: Array<z.infer<typeof jsonLdJobSchema>> = [];
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    const attributes = script[1] ?? '';
    if (!/\btype\s*=\s*(["'])application\/ld\+json\1/i.test(attributes)) continue;
    const body = (script[2] ?? '').trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    for (const candidate of flattenJsonLd(parsed)) {
      if (!isJobPosting(candidate)) continue;
      const result = jsonLdJobSchema.safeParse(candidate);
      if (result.success) postings.push(result.data);
    }
  }
  return postings;
}

function identifier(posting: z.infer<typeof jsonLdJobSchema>, pageUrl: string): string {
  const raw = posting.identifier;
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
  if (raw && typeof raw === 'object' && 'value' in raw) return String(raw.value);
  const target = canonicalizeUrl(
    posting.url ? new URL(posting.url, pageUrl).toString() : pageUrl,
  );
  const stableSeed = posting.url
    ? target
    : JSON.stringify({
        pageUrl: target,
        title: posting.title,
        company: posting.hiringOrganization?.name ?? null,
        datePosted: posting.datePosted ?? null,
        location: posting.jobLocation ?? null,
      });
  return createHash('sha256').update(stableSeed).digest('hex');
}

function locationPart(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(locationPart);
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const address =
    record.address && typeof record.address === 'object'
      ? (record.address as Record<string, unknown>)
      : record;
  const parts = [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
    record.name,
  ].filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  return parts.length > 0 ? [parts.join(', ')] : [];
}

function remoteMode(
  posting: z.infer<typeof jsonLdJobSchema>,
): NormalizedJob['remoteMode'] {
  const value = posting.jobLocationType?.toLowerCase() ?? '';
  return value.includes('telecommute') || value.includes('remote') ? 'remote' : 'unknown';
}

export class GenericWebConnector implements JobConnector<
  GenericWebDiscoveredJob,
  Record<string, unknown>
> {
  public readonly type = 'generic_web';
  private readonly web: SafeWebClient;

  public constructor(dependencies: SafeWebDependencies = {}) {
    this.web = new SafeWebClient(dependencies);
  }

  public async healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult> {
    const config = this.config(context);
    const page = await this.web.requestHtml(
      'Generic web',
      config.startUrl,
      config,
      context,
      'health',
    );
    const count = extractJsonLdJobPostings(page.html).length;
    return count > 0
      ? { status: 'healthy', message: `Found ${count} public JSON-LD job posting(s).` }
      : {
          status: 'degraded',
          message:
            'The page is reachable but contains no valid schema.org JobPosting JSON-LD.',
        };
  }

  public async discover(
    context: ConnectorContext,
  ): Promise<DiscoveryResult<GenericWebDiscoveredJob>> {
    const config = this.config(context);
    const page = await this.web.requestHtml(
      'Generic web',
      config.startUrl,
      config,
      context,
      'discover',
    );
    const all = extractJsonLdJobPostings(page.html);
    const selected = all.slice(0, config.maxPostings);
    const jobs = new Map<string, GenericWebDiscoveredJob>();
    for (const posting of selected) {
      const externalId = identifier(posting, page.finalUrl);
      jobs.set(externalId, {
        externalId,
        rawSummary: {
          posting,
          pageUrl: page.finalUrl,
          companyName: config.companyName,
        },
      });
    }
    return {
      jobs: [...jobs.values()],
      pagesFetched: 1,
      complete: all.length <= config.maxPostings,
    };
  }

  public async fetchDetail(
    job: GenericWebDiscoveredJob,
  ): Promise<Record<string, unknown>> {
    return job.rawSummary;
  }

  public normalize(raw: Record<string, unknown>): NormalizedJob {
    const { posting, pageUrl, companyName } = genericRawSchema.parse(raw);
    const descriptionHtml = posting.description.trim();
    const descriptionText = htmlToText(descriptionHtml) || descriptionHtml;
    if (!descriptionText) {
      throw new ConnectorRequestError(
        'JSON-LD JobPosting did not contain a complete description',
        'invalid_response',
      );
    }
    const sourceUrl = canonicalizeUrl(
      posting.url ? new URL(posting.url, pageUrl).toString() : pageUrl,
    );
    const locations = [
      ...locationPart(posting.jobLocation),
      ...locationPart(posting.applicantLocationRequirements),
    ];
    const employmentType = Array.isArray(posting.employmentType)
      ? posting.employmentType.join(', ')
      : posting.employmentType;
    const deadline = parseOptionalDate(posting.validThrough);
    return normalizedJobSchema.parse({
      externalId: identifier(posting, pageUrl),
      title: posting.title.trim(),
      company: posting.hiringOrganization?.name?.trim() || companyName,
      location: [...new Set(locations)].join(' · ') || 'Location not specified',
      publishedAt: parseOptionalDate(posting.datePosted),
      deadline,
      descriptionText,
      descriptionHtml,
      sourceUrl,
      canonicalUrl: sourceUrl,
      remoteMode: remoteMode(posting),
      employmentType: employmentType?.trim() || null,
      sourceActive: true,
      sourceMetadata: {
        jsonLdType: 'JobPosting',
        pageUrl,
      },
      rawData: raw,
    });
  }

  private config(context: ConnectorContext): GenericWebSourceConfig {
    return genericWebSourceConfigSchema.parse(context.source.config);
  }
}
