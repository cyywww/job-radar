import { describe, expect, it } from 'vitest';

import { publicFeedSchema } from './feed.js';

describe('public feed contract', () => {
  const feed = {
    schemaVersion: 1,
    generatedAt: '2026-10-14T08:00:00.000Z',
    jobs: [
      {
        id: 'fictional-1',
        title: 'Software Engineer',
        company: 'Example AB',
        location: 'Stockholm',
        region: 'Stockholm',
        publishedAt: '2026-10-13T08:00:00.000Z',
        sourceUrl: 'https://example.com/jobs/1',
        mustHaveLanguages: [],
      },
    ],
  } as const;

  it('accepts a minimal public feed', () => {
    expect(publicFeedSchema.parse(feed).jobs).toHaveLength(1);
  });

  it('rejects private fields and non-HTTPS links', () => {
    expect(
      publicFeedSchema.safeParse({
        ...feed,
        jobs: [{ ...feed.jobs[0], descriptionText: 'private' }],
      }).success,
    ).toBe(false);
    expect(
      publicFeedSchema.safeParse({
        ...feed,
        jobs: [{ ...feed.jobs[0], sourceUrl: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false);
    expect(
      publicFeedSchema.safeParse({
        ...feed,
        jobs: [{ ...feed.jobs[0], sourceUrl: 'https://user:secret@example.com/jobs/1' }],
      }).success,
    ).toBe(false);
  });
});
