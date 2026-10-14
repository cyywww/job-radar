import { describe, expect, it, vi } from 'vitest';

import { publishFeed } from './publish.js';

const validFeed = {
  schemaVersion: 1,
  generatedAt: '2026-10-14T08:00:00.000Z',
  jobs: [
    {
      id: 'fictional-1',
      title: 'Software Engineer',
      company: 'Example AB',
      location: 'Stockholm',
      region: 'Stockholm',
      publishedAt: null,
      sourceUrl: 'https://example.com/jobs/fictional-1',
      mustHaveLanguages: [],
    },
  ],
};

describe('atomic feed publication boundary', () => {
  it('writes one validated feed and returns the published count', async () => {
    const write = vi.fn(async (body: string) => {
      void body;
    });
    await expect(publishFeed(async () => validFeed, write)).resolves.toEqual({
      published: 1,
      generatedAt: validFeed.generatedAt,
    });
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '')).toEqual(validFeed);
  });

  it('does not replace the last feed after collection or validation failure', async () => {
    const write = vi.fn(async (body: string) => {
      void body;
    });
    await expect(
      publishFeed(async () => {
        throw new Error('source unavailable');
      }, write),
    ).rejects.toThrow('source unavailable');
    await expect(
      publishFeed(async () => ({ ...validFeed, jobs: [] }), write),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
