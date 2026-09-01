# Job Radar

Job Radar is a local-first workspace for finding Swedish Data/IT jobs. It keeps one
evidence-backed candidate Profile, collects jobs from a deliberately small source set,
deduplicates them deterministically, applies non-AI eligibility Gates, and produces
evidence-linked, reproducible job scores.

The repository contains no real profile, resume, credentials, captured jobs, model output,
or application tracking data. Tests, scoring evals, and fixtures are fictional and offline.

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

Create and confirm a local Profile with at least one target role. Dashboard then summarizes
today's additions, strong matches, pending scoring/review, closed jobs, source health, the
latest run, and the top ten ranked roles. Jobs is the daily review workspace: it provides
table/card views, bounded search/filter/sort queries, saved browser-local filters, explicit
score states, full evidence-backed detail, persistent triage with undo, human review and
separate correction feedback. Sources keeps JobTech / Platsbanken primary and allows only
selected company career pages as a limited supplement.

Scoring remains deliberately explicit rather than a resident background service. A scan or
Profile edit creates idempotent pending tasks, but Codex CLI extraction runs only when the
user clicks **Process scoring queue** or calls `POST /api/scoring/process`. The normal UI
processes one job per click. Before real extraction, authenticate Codex CLI and set the
exact approved model in `.env.local`; the server starts normally without it, but scoring
stays disabled rather than silently using a CLI default:

```dotenv
JOB_RADAR_CODEX_MODEL=your-approved-codex-model
```

Codex CLI does not expose an equivalent of a hard USD or `max_output_tokens` budget, so
Job Radar does not present an approximate limit as a guarantee. Every completed attempt
instead records the CLI-reported input, cached-input, output, reasoning-output, and total
token usage. The Jobs detail panel shows the actual usage. Default tests use a fake
process and never call Codex or the network. See `docs/scoring.md` for the exact cost,
Gate, schema, retry, and privacy contract.

The Jobs detail panel renders the complete description as untrusted plain text. It never
injects posting HTML, source metadata, model output, or prompts. `matchScore` remains the M3
formal evidence-fit score; `rankingScore` is labeled separately and is used only for order.
Human suggested scores are append-only advisory feedback and never overwrite either score.

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
- `GET /api/scans/:id/events` for durable explicit-scan SSE progress
- `POST /api/scans/:id/cancel`
- `GET /api/jobs` and `GET /api/jobs/:id`
- `GET /api/dashboard`
- `GET /api/review/jobs` and `GET /api/review/jobs/:id`
- `PATCH /api/jobs/:id/triage`
- `POST /api/jobs/bulk-triage` and `POST /api/jobs/bulk-triage/restore`
- `POST /api/jobs/:id/refresh`
- `POST /api/jobs/reprocess`

Scoring:

- `GET /api/scoring/config`
- `GET /api/scoring/queue`
- `POST /api/scoring/backfill` and `POST /api/scoring/process`
- `POST /api/scoring/tasks/:id/retry`
- `POST /api/scoring/retry-failed`
- `POST /api/jobs/:id/rescore`
- `POST /api/jobs/bulk-rescore`
- `GET /api/jobs/:id/scoring`

Review and feedback:

- `PATCH /api/jobs/:id/review`
- `POST /api/jobs/:id/feedback`

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

Migration `0006_neat_clea.sql` adds append-only job requirements, scores, scoring attempts,
and an idempotent task queue. It does not rewrite existing M2 jobs or snapshots; an
explicit backfill creates tasks for their current snapshots.

Migration `0007_bizarre_richard_fisk.sql` adds sparse persistent job triage, append-only
score feedback and review events, and durable scan/source stages with source failure-stage
classification. Existing terminal M3 runs are mapped to `complete`; existing Profiles,
jobs, snapshots, requirements, scores, and attempts are retained without rewriting formal
score values.

Migration `0008_melted_purple_man.sql` adds nullable token-usage columns to
append-only scoring attempts. Existing attempts retain their model, outcome, byte count,
timestamps, and error audit; their usage fields remain null because historical usage
cannot be reconstructed safely.

After changing `packages/db/src/schema.ts`, generate and review a migration:

```bash
pnpm db:generate
```

Database files and their WAL/SHM companions are ignored by Git.

## Quality checks

```bash
pnpm check
pnpm format:check
pnpm --filter @job-radar/scoring eval
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
