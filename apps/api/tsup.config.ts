import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  entry: ['src/server.ts'],
  external: [
    'better-sqlite3',
    'dotenv',
    'drizzle-orm/better-sqlite3',
    'drizzle-orm/better-sqlite3/migrator',
    'drizzle-orm/sqlite-core',
    'pino',
    'zod',
  ],
  format: ['esm'],
  minify: false,
  noExternal: [/^@job-radar\//],
  platform: 'node',
  sourcemap: true,
  splitting: false,
  target: 'node22',
});
