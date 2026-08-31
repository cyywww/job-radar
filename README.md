# Job Radar

Job Radar is a local-first workspace for finding Swedish Data/IT jobs. It keeps one
evidence-backed candidate Profile, collects jobs from a deliberately small source set,
deduplicates them deterministically, and records source health and immutable job history.

The repository contains no real profile, resume, credentials, captured jobs, AI scoring,
or application tracking data. Tests and fixtures are fictional and offline.

## Requirements

- Node.js 22.12 or newer
- pnpm 10 or newer
- macOS or another Unix-like environment

## Setup and development

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The environment file is optional because safe local defaults are built in. Development
starts the migration-first API and web processes:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`
- Health: `http://127.0.0.1:8787/api/health`

Create and confirm a local Profile with at least one target role. The Sources workspace
shows JobTech / Platsbanken as the primary source and lets you add selected company career
pages only when they add useful coverage. Jobs starts enabled sources and displays the
normalized posting, all source links, merge reasons, lifecycle state, and change history.

Use `Ctrl+C` to stop both processes. `pnpm dev:api` and `pnpm dev:web` run one side during
focused development.

## Source model

Job Radar intentionally supports only two source types:

1. JobTech / Platsbanken is created automatically and enabled by default. It uses the
   official JobSearch API, always applies the Data/IT occupation field, runs each confirmed
   target role as a separate query, and fetches complete ad details.
2. A target company page is optional and starts paused. It reads schema.org `JobPosting`
   JSON-LD from one explicitly configured public HTTPS page.

The target-page connector does not crawl, execute JavaScript, use arbitrary selectors, or
bypass login, CAPTCHA, access control, or site restrictions. It validates DNS and every
redirect, pins a validated public address for the request, and rejects unsafe protocols,
credentials, nonstandard ports, local/private/reserved networks, cloud metadata targets,
unsafe content types, and oversized responses.

There are no platform-specific ATS adapters or compatibility branches. See
`docs/connectors.md` for the exact source and safety contract.

## Job identity and lifecycle

Matching uses ordered, deterministic evidence:

1. same-source external ID;
2. normalized canonical URL;
3. company, title, location, and complete-description fingerprint;
4. company, title, location, and publication day.

A cross-source rule applies only when it finds one candidate. Ambiguous postings remain
separate. Every source link stores the strategy and evidence, and each merge appends an
explainable audit event. Company, title, location, deadline, or description changes append
a source-specific immutable snapshot.

Only a complete source scan with no detail failures may advance missing counters. One or
two misses make an otherwise open job `possibly_closed`; the third closes that source
link. The aggregate job closes only when all attached source links are closed. A later
sighting resets the counter and reopens the link and job. Failed, cancelled, capped, and
detail-partial runs cannot close jobs by absence.

## Main API routes

Profile:

- `POST`, `GET`, and `PUT /api/profile`
- `POST /api/profile/confirm`
- `GET /api/profile/versions` and `GET /api/profile/versions/:version`
- `GET /api/profile/confirmed`
- `GET` and `PUT /api/preferences`
- `POST /api/preferences/preview`
- `POST /api/profile/import` and `POST /api/profile/import/file`

Sources and jobs:

- `GET` and `POST /api/sources`
- `PATCH` and `DELETE /api/sources/:id`
- `POST /api/sources/:id/test` and `POST /api/sources/:id/rerun`
- `POST /api/scans`, `GET /api/scans`, and `GET /api/scans/:id`
- `POST /api/scans/:id/cancel`
- `GET /api/jobs` and `GET /api/jobs/:id`
- `POST /api/jobs/reprocess`

All request and response boundaries use shared Zod contracts.

## Database migrations

```bash
pnpm db:migrate
```

Migration `0005_sweden_source_cleanup.sql` enforces the two-source model. Pure JobTech and
target-page databases retain their collection history. If an old database contains a
removed source type, reproducible collection state is reset and unsupported source rows
are deleted; Profile/version history is untouched. This is an intentional clean break,
not a compatibility layer.

After changing `packages/db/src/schema.ts`, generate and review a migration:

```bash
pnpm db:generate
```

Database files and their WAL/SHM companions are ignored by Git.

## Quality checks

```bash
pnpm check
pnpm format:check
```

`pnpm check` runs lint, typecheck, offline tests, package builds, the Vite production
build, and the Fastify bundle. `docs/testing.md` describes the deterministic coverage.

For a production-style loopback-only run:

```bash
pnpm build
pnpm start
```

See `docs/implementation-status.md` and `docs/decisions.md` for the current handoff state
and architectural boundaries.
