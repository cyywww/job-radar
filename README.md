# Job Radar

A local-first workspace for finding Swedish Data/IT jobs. Choose a Profile, collect
jobs, analyze a pending job, then save or ignore the result.

## Run locally

Requires Node.js 22.12+ and pnpm 10+.

```bash
pnpm install
pnpm dev
```

Development applies SQLite migrations and starts:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

Stop both with `Ctrl+C`. For a production-style local run, use
`pnpm build && pnpm start`; the API serves the built Web app on port 8787.

Environment files are optional. To enable real AI analysis, authenticate Codex CLI
and set an explicit model in `.env.local`:

```dotenv
JOB_RADAR_CODEX_MODEL=your-approved-codex-model
```

Without a configured model, Profile management, collection, and review remain usable.
Analysis is explicit, one pending job per normal UI click; no scheduler or resident
worker runs in the background. Actual token usage is recorded, not a claimed USD cap.

## Daily workflow

1. **Profiles** — create, name, select, edit, or delete a Profile. Start with a target
   role; location is optional and core skills are recommended. Import, extra evidence,
   filters, and version history are secondary disclosures.
2. **Opportunities** — update jobs, analyze the next waiting job, and save or ignore
   matches. Search and four quick views are primary; advanced filters and batch tools
   stay collapsed.
3. **Settings** — manage sources and inspect local system health.

The selected Profile drives searches, score queues, and displayed matches. Profile
versions and scores are independent; jobs, sources, and triage are shared locally.
Deleting a Profile removes its derived scoring and review data, but retains global jobs.

## Architecture

```text
apps/
  api/src/routes/       HTTP boundaries: profile, collection, jobs, scoring, health
  api/src/services/     Scan and scoring orchestration, deterministic Profile import
  web/src/api/          Shared HTTP client and validated API adapters
  web/src/features/
    jobs/              Opportunities orchestration, filters, results, detail
    profile/           Profile editor and management
    settings/          Source controls and system status
  web/src/styles/       Shared UI styles
packages/
  shared/              Zod contracts and shared domain rules
  config/              Environment parsing and safe logging
  db/                  SQLite schema, migrations, repositories
  connectors/          JobTech and limited target-page collection
  scoring/             Codex extraction, audit, Gate, deterministic scoring
  testing/             Fictional fixtures
docs/                   Decisions, source/scoring contracts, verification
config/ data/ logs/      Local runtime directories, not committed personal data
```

Collection follows confirmed role queries → connector → normalized job →
deterministic identity/snapshots → pending scoring tasks. Explicit analysis follows
Codex extraction → evidence audit → code-owned eligibility Gate → deterministic
match/ranking scores → SQLite → Opportunities.

JobTech / Platsbanken is the sole broad source. An optional public company page may
provide `JobPosting` JSON-LD; there is no crawler or ATS adapter matrix.

## API surface

- `GET/POST /api/profiles`; `GET/PUT/DELETE /api/profiles/:id`.
- `POST /api/profiles/:id/select` and `/confirm`; `GET /api/profiles/:id/versions`
  and `/versions/:version`.
- `POST /api/profiles/import` and `/api/profiles/import/file`.
- `GET /api/profile/confirmed` is the intentional selected-Profile privacy boundary,
  not a singleton CRUD endpoint.
- `GET /api/jobs` and `/api/jobs/:id` are the only job list/detail read models.
  They include review/scoring state; use `includeClosed=true` to include closed jobs.
- `/api/sources`, `/api/scans`, `/api/scoring`, and job-specific actions provide
  collection, explicit analysis, triage/undo, and feedback.
- `GET /api/health` and `/api/readiness` expose system-only health.

There are no legacy endpoint aliases. Dashboard, singleton Profile CRUD, standalone
preferences, `/api/review/jobs`, and historical job reprocessing are removed.

## Safety and verification

Only confirmed candidate facts cross `ProfileRepository.getConfirmedView()`.
AI cannot set formal scores or execute job-posting instructions. Full profiles,
resumes, JDs, prompts, tokens, and secrets are excluded from normal logs. The server
binds to loopback. Scans send role queries to sources; explicit AI analysis sends only
the minimized confirmed evidence and job snapshot needed for extraction.

```bash
pnpm check
pnpm format:check
pnpm --filter @job-radar/scoring eval
```

Tests use fictional data and disposable databases, never live sources or real AI.
Schema migrations and immutable user history are retained; runtime compatibility
code is not. See [implementation status](docs/implementation-status.md),
[testing](docs/testing.md), [collection](docs/connectors.md), and
[scoring](docs/scoring.md) for exact boundaries.
