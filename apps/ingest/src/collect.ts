import {
  publicFeedSchema,
  publicJobSchema,
  type PublicFeed,
  type PublicJob,
} from '@job-radar/shared';
import { z } from 'zod';

const SEARCH_URL = 'https://jobsearch.api.jobtechdev.se/search';
const OCCUPATION_FIELD = 'apaJ_2ja_LuF';
const MAX_HITS = 100;

const BROAD_QUERIES = [
  'software engineer',
  'systemutvecklare',
  'backend developer',
  'frontend developer',
] as const;

const SEARCHES = [
  ...BROAD_QUERIES.map((query) => ({ query, regionId: undefined })),
  {
    query: 'systemutvecklare',
    regionId: 'g5Tt_CAV_zBd',
  },
  {
    query: 'systemutvecklare',
    regionId: '9hXe_F4g_eTG',
  },
];

const REGIONS: Record<string, string> = {
  '01': 'Stockholm',
  '03': 'Uppsala',
  '04': 'Södermanland',
  '24': 'Västerbotten',
  '25': 'Norrbotten',
};

const optionalText = z.string().nullable().optional();
const searchHitSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  headline: z.string().min(1),
  webpage_url: optionalText,
  publication_date: optionalText,
  employer: z
    .object({ name: optionalText, workplace: optionalText })
    .nullable()
    .optional(),
  workplace_address: z
    .object({
      city: optionalText,
      municipality: optionalText,
      region_code: optionalText,
    })
    .nullable()
    .optional(),
  must_have: z
    .object({
      languages: z.array(z.object({ label: optionalText })).optional(),
    })
    .nullable()
    .optional(),
});

const responseSchema = z.object({ hits: z.array(z.unknown()) });

type Hit = z.infer<typeof searchHitSchema>;

export class CollectionSourceError extends Error {
  public constructor(public readonly statusCode: number | null) {
    super(
      statusCode === null
        ? 'JobTech search transport failed'
        : `JobTech search failed: HTTP ${statusCode}`,
    );
    this.name = 'CollectionSourceError';
  }
}

export interface CollectOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  queries?: readonly string[];
  pause?: (milliseconds: number) => Promise<void>;
}

function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapJob(hit: Hit): PublicJob | null {
  if (/(security|cyber|säkerhet|infosec|pentest|penetration test)/i.test(hit.headline)) {
    return null;
  }
  const address = hit.workplace_address;
  const region = address?.region_code ? REGIONS[address.region_code] : undefined;
  if (!region) return null;

  const link =
    hit.webpage_url?.trim() ||
    `https://arbetsformedlingen.se/platsbanken/annonser/${encodeURIComponent(hit.id)}`;
  const candidate = publicJobSchema.safeParse({
    id: hit.id,
    title: hit.headline.trim(),
    company:
      hit.employer?.name?.trim() ||
      hit.employer?.workplace?.trim() ||
      'Employer not specified',
    location: address?.city?.trim() || address?.municipality?.trim() || region,
    region,
    publishedAt: dateOrNull(hit.publication_date),
    sourceUrl: link,
    mustHaveLanguages:
      hit.must_have?.languages
        ?.map((language) => language.label?.trim())
        .filter((language): language is string => Boolean(language)) ?? [],
  });
  return candidate.success ? candidate.data : null;
}

async function requestSearch(
  query: string,
  fetchImpl: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
  regionId?: string,
): Promise<z.infer<typeof responseSchema>> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('occupation-field', OCCUPATION_FIELD);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(MAX_HITS));
  url.searchParams.set('offset', '0');
  if (regionId) url.searchParams.set('region', regionId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (attempt < 2) {
        await pause(500 * 2 ** attempt);
        continue;
      }
      throw new CollectionSourceError(null);
    }
    if (response.ok) return responseSchema.parse(await response.json());
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await pause(500 * 2 ** attempt);
      continue;
    }
    throw new CollectionSourceError(response.status);
  }
  throw new CollectionSourceError(null);
}

export async function collectFeed(options: CollectOptions = {}): Promise<PublicFeed> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const pause =
    options.pause ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const searches = options.queries
    ? options.queries.map((query) => ({ query, regionId: undefined }))
    : SEARCHES;
  const jobs = new Map<string, PublicJob>();

  for (const [index, search] of searches.entries()) {
    if (index > 0) await pause(250);
    const result = await requestSearch(search.query, fetchImpl, pause, search.regionId);
    for (const raw of result.hits) {
      const hit = searchHitSchema.safeParse(raw);
      const job = hit.success ? mapJob(hit.data) : null;
      if (job) jobs.set(job.id, job);
    }
  }

  if (jobs.size === 0) throw new Error('JobTech returned no publishable jobs');

  return publicFeedSchema.parse({
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    jobs: [...jobs.values()].sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') ||
        a.id.localeCompare(b.id),
    ),
  });
}
