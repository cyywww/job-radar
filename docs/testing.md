# Testing and verification

All default tests use temporary directories and fictional/system-only data. They never
read the normal local database, a real Profile/resume, credentials, or the network.

## Deterministic coverage

- Shared contracts cover the exact two source types, strict JobTech Data/IT configuration,
  target-page HTTPS configuration, normalized jobs, run/error states, URL canonicalization,
  identity text, fingerprints, and publication-day keys. Removed source types are rejected.
- JobTech fixtures cover separate confirmed-role queries, occupation-field filtering,
  paging/completeness, full details, structured occupation/location/language metadata,
  retries, timeout, pacing, cancellation, and detail concurrency.
- Target-page fixtures contain schema.org `JobPosting` JSON-LD. Tests cover extraction and
  non-HTTPS URLs, credentials, nonstandard ports, local/private/link-local/reserved/cloud
  metadata IPv4 and IPv6, mixed DNS answers, DNS rebinding, redirects, response size, and
  content type.
- Database tests cover migration from empty, populated JobTech history retention and
  configuration upgrade, unsupported-source cleanup, deterministic cross-source matching,
  ambiguous no-merge, merge evidence, source-specific snapshots, changed fields,
  three-miss closure, reopening, partial-failure isolation, configuration versions,
  duplicate-scan rejection, and history-preserving reprocessing.
- API tests use temporary migrated databases for Profile CRUD, JobTech scans, target-page
  management, health/errors/metrics, source reruns, cancellation, partial source/detail
  safety, lifecycle, duplicate scan protection, reprocessing, and job audit responses.
- React tests cover Profile onboarding/versioning, Jobs list/detail/scan, and target-page
  add/test/edit/pause/enable/delete operations with source health and history rendering.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
```

`pnpm check` runs lint, typecheck, tests, and build. Formatting remains an explicit
non-mutating check.

## Migration checks

Use a disposable database rather than the normal local file:

```bash
JOB_RADAR_DATABASE_PATH=/tmp/job-radar-migration/example.sqlite pnpm db:migrate
```

- `0004_windy_mongu.sql` adds configuration/run versions, the active-scan guard,
  canonical source/fingerprint/change timestamps, explainable source-match data,
  source-specific snapshots, and merge events.
- `0005_sweden_source_cleanup.sql` fixes JobTech to the Sweden Data/IT search policy and
  removes collection state if an unsupported legacy source exists. Profile history remains.

Verify a migrated disposable database with:

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

Production style:

```bash
pnpm build
pnpm start
curl --fail http://127.0.0.1:8787/
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/readiness
curl --fail http://127.0.0.1:8787/api/sources
curl --fail 'http://127.0.0.1:8787/api/jobs?active=all'
```

Starting a scan requires a Profile with at least one confirmed target role. Use a
disposable database and fictional Profile for acceptance unless the user explicitly asks
to use their normal local state.

## Live smoke policy

Live JobTech or target-page smoke checks are optional and never part of `pnpm test`. Use a
read-only request or a disposable database, retain no complete real description, and
record only the source, time, status, and counts. If DNS or egress is unavailable, report
that rather than calling fixtures live.

## Deferred tests

M3 scoring evals, fuzzy-dedup evals, scheduler/crash recovery, large-volume performance,
backup restore drills, and release automation remain in their owning later phases.
