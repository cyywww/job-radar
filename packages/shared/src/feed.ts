import { z } from 'zod';

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Expected an HTTPS URL without credentials');

export const publicJobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    company: z.string().min(1),
    location: z.string().min(1),
    region: z.string().min(1),
    publishedAt: z.iso.datetime().nullable(),
    sourceUrl: httpsUrl,
    mustHaveLanguages: z.array(z.string().min(1)),
  })
  .strict();

export const publicFeedSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    jobs: z.array(publicJobSchema).min(1),
  })
  .strict();

export type PublicJob = z.infer<typeof publicJobSchema>;
export type PublicFeed = z.infer<typeof publicFeedSchema>;
