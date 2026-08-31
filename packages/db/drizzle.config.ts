import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  out: './migrations',
  schema: './src/schema.ts',
  dbCredentials: {
    url: process.env.JOB_RADAR_DATABASE_PATH ?? '../../data/job-radar.sqlite',
  },
  strict: true,
  verbose: true,
});
