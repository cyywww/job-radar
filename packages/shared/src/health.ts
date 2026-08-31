import { z } from 'zod';

export const APP_VERSION = '0.1.0';

export const componentStatusSchema = z.enum(['ok', 'error']);

export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    service: z.literal('job-radar-api'),
    version: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
    api: z
      .object({
        status: z.literal('ok'),
        uptimeSeconds: z.number().nonnegative(),
      })
      .strict(),
    database: z
      .object({
        status: componentStatusSchema,
        latencyMs: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ComponentStatus = z.infer<typeof componentStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
