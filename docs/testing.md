# Testing and verification

## Test layers in M2

- Shared contract tests cover Profile/preferences plus bounded source configuration,
  required complete descriptions/raw data, and enumerated scan states.
- Configuration tests retain safe loopback/path defaults and environment validation.
- Connector fixture tests use fictional JobTech list/detail JSON only. They cover
  pagination, full-detail normalization, canonical URLs, 429 retry accounting with
  exponential-delay hooks, request timeout, rate pacing, concurrency caps, and in-flight
  cancellation.
- Database tests migrate an empty temporary SQLite database, verify all M0–M2 tables,
  run integrity and foreign-key checks, and retain Profile version tests.
- API integration tests use a migrated temporary database and the real JobTech connector
  against an injected fixture transport. They prove full-detail storage, repeat-scan
  idempotency, changed snapshots, three-complete-scan closure, failure isolation, retry
  counts, cancellation, health continuity, and list/detail responses.
- React tests retain Profile onboarding/version coverage and add the Jobs list/detail plus
  browser-initiated scan flow. Complete upstream HTML is never rendered in tests or code.

All default tests use temporary directories or fictional/system-only values. No default
test reads the normal local database, a real Profile/resume, a secret, or the network.

## Commands

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm check` runs lint, typecheck, tests, and build. Formatting remains an explicit
non-mutating check.

## Empty-database migration check

Use a newly created disposable directory rather than a broad target:

```bash
JOB_RADAR_DATABASE_PATH=/tmp/job-radar-m2-migration/example.sqlite pnpm db:migrate
```

A successful M2 migration creates `sources`, `scan_runs`, `source_runs`, `jobs`,
`job_sources`, and `job_snapshots` in addition to the M0/M1 tables. Verify both:

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

## Runtime checks

Development:

```bash
pnpm dev
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/sources
curl --fail http://127.0.0.1:5173/
```

Production-style local run:

```bash
pnpm build
pnpm start
curl --fail http://127.0.0.1:8787/
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/jobs
```

Starting a real scan requires a local Profile with at least one confirmed target role.
Use a disposable database and fictional Profile for acceptance unless the user explicitly
wants their normal local state. POST the scan, then poll its ID until a terminal status.

## Latest deterministic result

Verified on 2026-08-31 with Node 22.16.0 and pnpm 11.19.0:

- 52 Vitest tests across 16 files passed: 11 shared, 3 config, 7 connector, 5 database,
  22 API, and 4 web tests.
- A fixture scan stored three jobs with full descriptions and raw responses. An identical
  scan produced three unchanged results with no new rows; a changed detail added exactly
  one snapshot.
- Three complete empty discoveries closed the fixture jobs. Failure and cancellation
  produced durable terminal run states without making `/api/health` unavailable.
- `pnpm check` and `pnpm format:check` passed. A new database applied all migrations and
  passed integrity/foreign-key checks. Both development and production-style loopback
  servers returned HTTP 200 for their page and relevant API health/data routes.
- In-app browser acceptance verified Jobs navigation, the run strip, list/detail empty
  states, the missing-confirmed-role error, and an empty warning/error console.
- The opt-in live JobTech smoke succeeded with one discovered/fetched/created real-source
  job, zero retries/failures, and a stored 2,924-character complete description/raw
  snapshot. The deliberate one-page/one-result cap yielded `resultSetComplete=false`, as
  required for safe lifecycle handling. Its disposable database was removed.

## Live JobTech smoke policy

Live smoke is optional and must never be part of `pnpm test`. If network access is
available, use a disposable database/Profile, start one scan through the API, and record
the real run ID/counts. If DNS or egress is unavailable, record the exact connectivity
failure; do not replace it with a fixture result or call fixture data “live.”

## Deferred tests

Additional ATS fixture suites, cross-source fuzzy matching, scoring evals, a standalone
Playwright suite, crash recovery, large-volume performance, CSP/security hardening, and
release automation remain in their owning later phases.
