import { describe, expect, it, vi } from 'vitest';

import { collectFeed } from './collect.js';

const hit = {
  id: 'fictional-101',
  headline: 'Software Engineer',
  webpage_url: 'https://example.com/jobs/fictional-101',
  publication_date: '2026-10-13T08:00:00+00:00',
  employer: { name: 'Example Works AB' },
  workplace_address: { city: 'Stockholm', region_code: '01' },
  must_have: { languages: [{ label: 'Engelska' }] },
};

function response(hits: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ hits }), { status });
}

describe('JobTech public feed collection', () => {
  it('adds focused northern searches to the four broad queries', async () => {
    const requests: URL[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      requests.push(url);
      return response([hit]);
    });
    await collectFeed({
      fetchImpl: fetchImpl as typeof fetch,
      pause: async () => undefined,
    });
    expect(requests).toHaveLength(6);
    expect(requests.map((url) => url.searchParams.get('region')).slice(-2)).toEqual([
      'g5Tt_CAV_zBd',
      '9hXe_F4g_eTG',
    ]);
  });

  it('deduplicates and limits publication to the regional, validated public shape', async () => {
    const requests: URL[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()));
      return response([
        hit,
        {
          ...hit,
          id: 'fictional-north',
          workplace_address: { city: 'Luleå', region_code: '25' },
        },
        {
          ...hit,
          id: 'fictional-south',
          workplace_address: { city: 'Malmö', region_code: '12' },
        },
        { ...hit, id: 'fictional-bad', webpage_url: 'javascript:alert(1)' },
        { ...hit, id: 'fictional-security', headline: 'Cyber Security Engineer' },
      ]);
    });
    const feed = await collectFeed({
      fetchImpl: fetchImpl as typeof fetch,
      queries: ['software engineer', 'systemutvecklare'],
      now: () => new Date('2026-10-14T08:00:00.000Z'),
      pause: async () => undefined,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.searchParams.get('occupation-field')).toBe('apaJ_2ja_LuF');
    expect(feed.jobs.map((job) => job.id)).toEqual(['fictional-101', 'fictional-north']);
    expect(feed.jobs[0]).toEqual({
      id: 'fictional-101',
      title: 'Software Engineer',
      company: 'Example Works AB',
      location: 'Stockholm',
      region: 'Stockholm',
      publishedAt: '2026-10-13T08:00:00.000Z',
      sourceUrl: 'https://example.com/jobs/fictional-101',
      mustHaveLanguages: ['Engelska'],
    });
    expect(JSON.stringify(feed)).not.toContain('description');
  });

  it('fails closed on source errors or empty scoped results', async () => {
    await expect(
      collectFeed({
        fetchImpl: vi.fn(async () => response([], 401)) as typeof fetch,
        queries: ['software engineer'],
      }),
    ).rejects.toThrow('HTTP 401');
    await expect(
      collectFeed({
        fetchImpl: vi.fn(async () =>
          response([{ ...hit, workplace_address: { region_code: '12' } }]),
        ) as typeof fetch,
        queries: ['software engineer'],
      }),
    ).rejects.toThrow('no publishable jobs');
  });

  it('retries rate limits without logging response bodies', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([], 429))
      .mockResolvedValueOnce(response([hit]));
    const pauses: number[] = [];
    const feed = await collectFeed({
      fetchImpl,
      queries: ['software engineer'],
      pause: async (ms) => {
        pauses.push(ms);
      },
    });
    expect(feed.jobs).toHaveLength(1);
    expect(pauses).toEqual([500]);
  });

  it('retries transient transport failures', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('fictional connection reset'))
      .mockResolvedValueOnce(response([hit]));
    const feed = await collectFeed({
      fetchImpl,
      queries: ['software engineer'],
      pause: async () => undefined,
    });
    expect(feed.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
