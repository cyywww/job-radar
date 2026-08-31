# Job Radar

Job Radar is a local-first job-search workspace. The current milestone is M1: an
evidence-backed candidate Profile, job preferences, immutable version history, and a
browser onboarding/editor flow on top of the React, Fastify, Zod, SQLite, and Drizzle
foundation.

No real profile, resume, credentials, job-source connector, AI scoring, or application
tracking data is included in this repository. Tests and examples use fictional people
and organizations.

## Requirements

- macOS or another Unix-like environment
- Node.js 22.12 or newer
- pnpm 10 or newer (the workspace was verified with pnpm 11)

## Install

```bash
cd /Users/yuweicao/Projects/job-radar
pnpm install
cp .env.example .env.local
```

The copy step is optional because safe local defaults are built in. Edit `.env.local`
when runtime data, configuration, logs, the SQLite file, or the built web directory
should live elsewhere. Local environment files are ignored by Git.

## Develop

```bash
pnpm dev
```

This migration-first command starts both processes and is suitable for a macOS terminal
or for Codex CLI to run from the repository root:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`
- Health: `http://127.0.0.1:8787/api/health`

Open the web URL to create or edit the local Profile, set hard job-search constraints,
review evidence status, preview deterministic search lanes and Gates, confirm pending
imports, and inspect version history. The System tab retains the API and database health
view.

Stop both processes with `Ctrl+C`. Use `pnpm dev:api` or `pnpm dev:web` to run only one
side during focused development.

## Database migrations

Apply all migrations to an empty or existing local database:

```bash
pnpm db:migrate
```

After changing `packages/db/src/schema.ts`, generate and inspect a migration:

```bash
pnpm db:generate
```

Never edit a user database by hand. Database files and their WAL/SHM companions are
ignored by Git.

## Profile import substitute

M1 intentionally has no AI provider. The browser and API accept pasted text or a local
`.txt`/`.md` file, then a deterministic test substitute reads only exact labeled lines:

```text
Name: Robin North
Headline: Fictional product engineer
Location: Stockholm
Summary: Builds imaginary local-first tools.
```

The substitute never infers employment, education, skills, languages, authorization, or
preferences. Extracted basics remain `pending` until the user explicitly confirms them.
Raw imported source text is hashed but not stored. File imports accept only `text/plain`
or `text/markdown`, simple file names, and at most 512 KiB.

Profile API contracts are exported from `@job-radar/shared`. Primary routes are:

- `POST`, `GET`, and `PUT /api/profile`
- `POST /api/profile/confirm`
- `GET /api/profile/versions` and `GET /api/profile/versions/:version`
- `GET /api/profile/confirmed` (confirmed facts only)
- `GET` and `PUT /api/preferences`
- `POST /api/preferences/preview`
- `POST /api/profile/import` and `POST /api/profile/import/file`

## Quality checks

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Run the complete project gate with `pnpm check`. Tests use temporary SQLite databases
and contain only fictional/system data. The web suite includes a jsdom integration test
for profile creation, preferences, editing, and version history.

## Production-style local run

```bash
pnpm build
pnpm start
```

Fastify applies migrations, serves the built React assets, and listens on
`http://127.0.0.1:8787`. The host is intentionally loopback-only by default.

See `docs/implementation-status.md`, `docs/decisions.md`, and `docs/testing.md` for the
handoff state and extension points.
