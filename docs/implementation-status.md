# Implementation status

Last updated: 2026-08-31

## Current milestone

M2 / Phase 3 — the first JobTech collection loop is complete: confirmed Profile search
roles can drive discovery, full-detail retrieval, normalization, SQLite persistence, API
queries, and browser review.

## Completed

- Preserved and re-verified the complete M0/M1 quality gate before M2 changes.
- `JR-201`: reusable `JobConnector` contract in `@job-radar/connectors`, with explicit
  `healthCheck`, `discover`, `fetchDetail`, and `normalize` stages.
- `Source` plus discriminated `SourceConfig` contracts. The default local JobTech source
  is inserted idempotently and keeps its base URL, enablement, request policy, latest
  success/error, and health state in SQLite.
- `JR-202`: durable `ScanRun` and per-source `SourceRun` state, including terminal state,
  timestamps, queries, completeness, page/retry counts, created/updated/unchanged/closed/
  failed counts, and a bounded safe error summary.
- `Job`, `JobSource`, and immutable `JobSnapshot` models plus generated and reviewed
  migration `0002_lush_proemial_gods.sql`.
- `JR-203`: JobTech JobSearch connector using `/search` pagination and `/ad/{id}` full
  details. Search results are never treated as the complete description.
- JobTech normalization for source ID, title, employer, location, publication timestamp,
  application deadline, complete plain-text/HTML description, canonical/source URL,
  employment type, and conservative remote/hybrid/unknown mode.
- Request timeout, capped exponential retry for 408/425/429/5xx and transport timeouts,
  explicit User-Agent, per-source start-rate limiting, bounded detail concurrency, and
  `AbortSignal` cancellation.
- Complete parsed JobTech detail responses are stored in `job_snapshots.raw_json`. The
  raw response is local/auditable but is not returned by normal job APIs or logged.
- Idempotency by `(source_id, source_job_id)` and a stable `sourceType:sourceJobId`
  canonical key for the single-source phase. Stable raw-response hashing prevents an
  identical fixture scan from creating more snapshots.
- Snapshot history: a changed JobTech detail response creates a new immutable snapshot
  and advances `jobs.current_snapshot_id`.
- First lifecycle rules: seen jobs reset source misses; explicit source removal or an
  elapsed deadline closes a job; three consecutive complete scans without a source job
  close it. Truncated or failed scans never increment missing counters.
- Process-local scan coordination with one active scan, background execution, source and
  per-detail error isolation, cancellation, and graceful shutdown before SQLite closes.
- Confirmed-only search boundary: scan queries come only from confirmed
  `preferences.targetRoles` through `ProfileRepository.getConfirmedView()`. Pending or
  rejected facts are not inspected.
- Zod-validated API endpoints:
  - `GET /api/sources`
  - `POST /api/scans`, `GET /api/scans`, `GET /api/scans/:id`
  - `POST /api/scans/:id/cancel`
  - `GET /api/jobs`, `GET /api/jobs/:id`
- Minimal React Jobs workspace with JobTech scan/cancel controls, active-run polling, latest
  ScanRun/SourceRun status, active job list, normalized metadata, original link, complete
  safe-text description, snapshot count, and audit hash indicator.
- Fixed fictional JobTech JSON fixtures for pagination and complete details. The default
  test suite has no external-network dependency.

## Deliberately not implemented

- Greenhouse, Lever, Ashby, Teamtailor, Workday, generic HTML, or any other connector.
- JobTech Taxonomy ID lookup and structured geographic filtering. This first loop sends
  each confirmed target role as a free-text JobSearch query; confirmed locations remain
  available for the later structured-search adapter.
- Cross-source fuzzy deduplication. The current key is exact and correct for one JobTech
  source; cross-source company/title/location/description matching begins only when a
  second connector is added.
- AI extraction, requirements, eligibility Gates, scoring, ranking, or rescore queues.
- Job triage, applications, automated scheduling, notifications, SSE, or a public server.
- Rendering upstream HTML. The browser displays `description_text` as text, avoiding an
  untrusted-HTML/XSS surface; HTML is retained only in the local snapshot.

## Connector contract for subsequent ATS sources

The public contract is exported from `packages/connectors/src/contracts.ts`:

```ts
interface JobConnector<TDiscovered, TRaw> {
  readonly type: string;
  healthCheck(context: ConnectorContext): Promise<ConnectorHealthResult>;
  discover(context: ConnectorContext): Promise<DiscoveryResult<TDiscovered>>;
  fetchDetail(job: TDiscovered, context: ConnectorContext): Promise<TRaw>;
  normalize(raw: TRaw): Promise<NormalizedJob> | NormalizedJob;
}
```

Every new connector must:

1. Add a discriminated, bounded config variant to `SourceConfig` without weakening the
   existing JobTech config.
2. Use a stable source type and external ID, return whether discovery was complete, and
   distinguish the search/list response from the complete detail response.
3. Populate every `NormalizedJob` field, retain the complete raw detail object, and use
   `null`/`unknown` instead of guessing missing fields.
4. Honour the supplied `AbortSignal`, request timeout, retry cap, rate limit, concurrency
   cap, explicit User-Agent, and `onRetry` accounting callback.
5. Throw bounded connector errors that do not contain JD/Profile text, credentials,
   headers, or raw responses. A job-detail failure must not abort sibling jobs; a source
   failure must not escape the scan coordinator.
6. Ship fictional fixed list/detail fixtures covering pagination, empty fields, retries,
   partial failure, cancellation, normalization, and repeat-scan idempotency. Live network
   checks remain opt-in.
7. Extend canonical matching deliberately before enabling cross-source merging. Never
   reuse the current exact source key as proof that two different sources are the same
   vacancy.

The complete operational description is in `docs/connectors.md`.

## Verification commands

Run from `/Users/yuweicao/Projects/job-radar`:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm dev
pnpm start
```

For an empty-database acceptance check, override `JOB_RADAR_DATABASE_PATH` with a new
disposable path. Runtime acceptance should create a fictional confirmed Profile, start a
fixture or live scan, poll its run, and query the resulting job list/detail.

## Latest verified result

Verified on 2026-08-31 with Node 22.16.0 and pnpm 11.19.0:

- The M0/M1 baseline passed before implementation.
- The deterministic suite passes 52 tests across 16 files: 11 shared, 3 config, 7
  connector, 5 database, 22 API, and 4 web tests.
- Fixture API scans store three full fictional jobs and three snapshots; an identical
  repeat creates zero jobs/snapshots, while a changed detail creates one new snapshot.
- Three complete missing scans close all fixture jobs; earlier missing scans and
  incomplete/failing scans do not.
- Connector failure and cancellation reach terminal ScanRun/SourceRun states while
  `/api/health` remains available.
- `pnpm check` passed lint, all workspace TypeScript checks, all 52 tests, package builds,
  the Vite production build, and the Fastify bundle; `pnpm format:check` passed.
- A new disposable SQLite database applied all three migrations, exposed all 12
  application tables from M0–M2, returned `ok` from `PRAGMA integrity_check`, and had no
  foreign-key violations.
- `pnpm dev` migrated first, started Vite and Fastify on loopback, and returned HTTP 200
  from the web entry, health, readiness, sources, and jobs routes.
- `pnpm start` served the production React build and returned HTTP 200 from the root,
  health, sources, and jobs routes.
- In-app browser acceptance opened the production build, navigated to Jobs, verified the
  source/run/list/detail empty states and Profile precondition error, and found no browser
  console warnings or errors.
- An opt-in live JobTech smoke used a disposable database, fictional Profile, and a
  one-result page cap. Run `c6ac889c-f03a-4ec9-965a-9230c1536e03` succeeded with one
  discovered/fetched/created job, zero retries/failures, a 2,924-character full
  description, stored raw response, and one snapshot. Its intentionally truncated
  discovery correctly reported `resultSetComplete=false`. The disposable data was
  deleted after the check.

## Stable M1 interfaces retained

- `ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` remain the only
  candidate-data consumption boundary for collection and future scoring.
- Profile facts, evidence, preferences, imports, confirmation, and immutable version APIs
  are unchanged.
- M2 does not read `profile_facts` directly and does not promote pending facts.

## Next phase entry

A second connector can reuse the contract above after adding its config variant, source
row, fixed fixtures, and a reviewed cross-source matching policy. M3 scoring must consume
only `JobDetail.snapshot` plus `ConfirmedProfileView`; it must not use raw source JSON as
candidate evidence or bypass confirmation.
