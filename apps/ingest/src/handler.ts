import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { CollectionSourceError, collectFeed } from './collect.js';
import { publishFeed } from './publish.js';

const environmentSchema = z.object({
  JOB_RADAR_BUCKET: z.string().min(3),
});

const s3 = new S3Client({});

export async function handler(): Promise<{ published: number; generatedAt: string }> {
  try {
    const environment = environmentSchema.parse(process.env);
    const result = await publishFeed(collectFeed, async (body) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: environment.JOB_RADAR_BUCKET,
          Key: 'data/latest.json',
          Body: body,
          ContentType: 'application/json; charset=utf-8',
          CacheControl: 'public, max-age=60, s-maxage=300',
        }),
      );
    });
    console.info('feed_published', {
      count: result.published,
      generatedAt: result.generatedAt,
    });
    return result;
  } catch (error) {
    console.error(
      'feed_publication_failed',
      error instanceof CollectionSourceError
        ? { category: 'source', statusCode: error.statusCode }
        : { category: 'validation_or_publish' },
    );
    // The original error can contain source payloads or AWS metadata. Lambda logs only this safe summary.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Feed publication failed');
  }
}
