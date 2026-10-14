import { publicFeedSchema } from '@job-radar/shared';

export async function publishFeed(
  collect: () => Promise<unknown>,
  write: (body: string) => Promise<void>,
): Promise<{ published: number; generatedAt: string }> {
  const feed = publicFeedSchema.parse(await collect());
  await write(JSON.stringify(feed));
  return { published: feed.jobs.length, generatedAt: feed.generatedAt };
}
