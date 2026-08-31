# Job Radar

Job Radar is a local-first job-search workspace. The current milestone completes the M2
data-source and lifecycle slice: an evidence-backed candidate Profile plus reviewed job
collection, deterministic cross-source identity, immutable per-source change history,
source-aware closure/reopening, health diagnostics, API queries, and browser review.

No real profile, resume, credentials, captured job data, AI scoring, or application
tracking data is included in this repository. Tests and examples use fictional people,
organizations, and JobTech responses.

## Requirements

- macOS or another Unix-like environment
- Node.js 22.12 or newer
- pnpm 10 or newer (the workspace was verified with pnpm 11)

## Install

```bash
cd /path/to/job-radar
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

Open the web URL to create or edit the local Profile, confirm at least one target role,
then use Sources to configure and test public ATS boards. Jobs starts all enabled sources
and shows per-source run status, normalized metadata, and the complete locally stored
description. The System tab retains API/database health.

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

## Structured-source collection

The default source is the official JobTech JobSearch API. User-configured sources support
the public Greenhouse Job Board API, Lever Postings API (global or EU), and Ashby Job
Postings API. Teamtailor has limited support through its official JSON API and requires a
company-issued Public Read token supplied only through a named local environment variable.
The limited generic connector is explicit opt-in, starts paused, accepts one public HTTPS
URL, and reads only schema.org `JobPosting` JSON-LD. It validates DNS and every redirect,
pins the validated public IP for the request, and blocks local/private/reserved/metadata
addresses, credentials, non-HTTPS schemes, nonstandard ports, oversized bodies, login,
CAPTCHA, and access-control bypass.

Workday, Jobylon, and SAP SuccessFactors are listed as not supported: their official
integration paths are tenant-configured or credential/provisioning dependent and do not
provide a reliable universal public contract. The browser support matrix makes this
boundary visible instead of presenting an unreliable connector.

The Sources browser workspace can add/configure, test, pause/enable, safely rerun, and
delete sources. Deletion is soft so historical runs and job provenance remain auditable.
Each source shows its support level, configuration version, health, a friendly error,
aggregate counters, and latest run. Fixed-origin connectors accept only a board/site
identifier; only the deliberately limited generic connector accepts a URL.

Jobs are matched in deterministic order: same-source external ID, normalized canonical
URL, exact normalized full-description fingerprint with company/title/location, then a
unique company/title/location/publication-date key. Ambiguous candidates stay separate.
Every merge stores its strategy and explanation. Material description, location, deadline,
title, or company changes append a source-specific snapshot. A complete successful source
scan increments misses; three consecutive misses close that source link. Failed,
cancelled, incomplete, or detail-partial runs do not advance misses, another open source
keeps the merged job open, and a later sighting reopens it.

Primary M2 routes are:

- `GET` and `POST /api/sources`
- `GET /api/source-capabilities`
- `PATCH` and `DELETE /api/sources/:id`
- `POST /api/sources/:id/test` and `POST /api/sources/:id/rerun`
- `POST /api/scans`, `GET /api/scans`, and `GET /api/scans/:id`
- `POST /api/scans/:id/cancel`
- `GET /api/jobs` and `GET /api/jobs/:id`
- `POST /api/jobs/reprocess`

Default tests use fixed fictional JSON and never require network access. See
`docs/connectors.md` for each connector's exact public endpoint, support limits, lifecycle
safety, and the reusable connector contract test kit.

## Quality checks

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Run the complete project gate with `pnpm check`. Tests use temporary SQLite databases
and contain only fictional/system data. The web suite covers Profile versioning, the Jobs
list/detail and scan trigger, plus the complete Sources management flow.

## Production-style local run

```bash
pnpm build
pnpm start
```

Fastify applies migrations, serves the built React assets, and listens on
`http://127.0.0.1:8787`. The host is intentionally loopback-only by default.

See `docs/implementation-status.md`, `docs/decisions.md`, and `docs/testing.md` for the
handoff state and extension points.
