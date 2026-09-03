# Testing and verification

All default tests use temporary directories and fictional/system-only data. They never
read the normal local database, a real Profile/resume, credentials, or the network. The
default suite never starts a real Codex CLI process.

## Deterministic coverage

- Shared contracts cover the exact two source types, strict JobTech Data/IT configuration,
  target-page HTTPS configuration, normalized jobs, run/error states, URL canonicalization,
  identity text, fingerprints, and publication-day keys. Removed source types are rejected.
  Scoring contracts also validate explicit model readiness, token-count invariants,
  bounded-run aggregates, and legacy attempts without reconstructed usage.
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
  duplicate-scan rejection, sparse triage defaults,
  idempotent single writes, atomic bulk writes/sparse exact undo, independent formal-score
  sorting, append-only correction feedback, review-state event history, formal-score
  isolation, populated M3-to-M4 preservation, multiple named Profile selection and
  independent version histories, selected-Profile score projection, cross-Profile scoring
  isolation, Profile deletion cleanup, and populated singleton-to-multi-Profile migration.
- API tests use temporary migrated databases for named multi-Profile CRUD/selection,
  immutable per-Profile history, duplicate-name rejection, JobTech scans, target-page
  management, health/errors/metrics, source reruns, cancellation, partial source/detail
  safety, lifecycle, duplicate scan protection, job audit responses,
  bounded search/filter/sort, detail, triage/restore, bulk rescore, feedback,
  review isolation, job refresh, persisted run stages/counts, SSE
  initial/progress/terminal state, disconnect cleanup, terminal reconnect, and SSE data
  minimization. Retired endpoints must return 404 with no aliases; Profile version URLs
  cannot retrieve another Profile's versions. Facts and preferences share one versioned
  resource update path.
- React tests cover the three-destination navigation and minimal Profile
  onboarding/versioning path; named Profile creation, editing, selection, and deletion;
  creation from one required target role plus optional location and recommended skills;
  nested optional-detail groups and removal of routine provenance controls;
  card-first Opportunities with disclosed table
  and batch modes, search, filters/sort/save/restore/clear, quick views, formal match versus
  ranking, Gate failure versus zero,
  evidence/gaps/unknowns/version detail and review history, plain-text hostile JD and
  non-HTTP link rendering, optimistic triage/exact undo, keyboard focus, bulk actions,
  human review and suggested-score separation; and target-page
  add/test/edit/pause/enable/delete operations with source support level/health/history.
- Scoring Gate table tests cover pass, fail, and unknown outcomes for closure, exclusions,
  authorization/sponsorship/citizenship, location/work mode/remote scope, required
  language, security clearance, and conflicting structured/extracted work modes.
- Deterministic scoring tests cover all seven fixed dimensions, exact weights, evidence
  depth, partial/unknown mappings, neutral missing rules, component rounding, integer
  bounds, ranking clamps, freshness separation, target-company boost, extraction/Gate
  uncertainty, reproducibility, and version rejection.
- Provider tests use only a fake process. They cover the ephemeral/read-only/schema-bound
  invocation, environment redaction, prompt-injection-shaped JD data, success, nonzero
  exit, timeout, cancellation, invalid JSON, Schema-invalid JSON, final-output bounds, and
  temporary-directory cleanup, explicit model configuration, JSONL usage parsing, and
  fail-closed missing usage.
- Scoring audit tests reject added Gate fields, nonexistent evidence, invented snippets,
  missing matches/gaps, unexplained required skills, and version mismatch.
- Repository/API tests cover idempotent enqueue/backfill, transactional claim/deduplication,
  bounded exponential retry, explicit failed-task recovery, interrupted-task recovery,
  invalid output producing no formal score, Gate non-overridability, forced rescore,
  Profile/snapshot/extractor/scoring/lifecycle invalidation, closure Gate, reopening path,
  append-only requirements/scores/attempt history, persisted actual token usage, explicit
  scoring configuration, and no-model refusal before a task claim.
- The offline eval runner executes 34 explicit fully fictional cases with expected Gate
  outcome and exact match-score range. Coverage includes language, authorization,
  sponsorship, citizenship, location, remote scope, seniority, evidence depth, soft
  preferences, gaps, confidence, and unknowns.

Shared HTTP-client tests cover headers, raw uploads, cancellation forwarding, empty
responses, and validated/fallback error handling. Detail-form tests retain failed
feedback drafts and reset them when selecting another job. Standalone Dashboard tests were removed
with that feature; source controls are tested in their Settings-owned location.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
pnpm --filter @job-radar/scoring eval
```

`pnpm check` runs lint, typecheck, tests, and build. Formatting remains an explicit
non-mutating check.

The 2026-09-03 acceptance run passed 185 tests across 31 files: 24 shared, 5 config,
27 connector, 29 scoring, 33 database, 50 API, and 17 web tests. The separate
offline eval passed 34/34 cases. `pnpm lint`, formatting, typecheck, tests, build,
`pnpm check`, diff checks, empty/M2/M3-populated migrations, SQLite integrity/foreign keys,
and production-style loopback checks passed. No Playwright dependency or unused E2E
scaffold was added; the core workflow is covered at repository, API integration, and React
interaction boundaries. The local development preview and built application used only a
disposable database. The Profile interaction test verifies that only the three initial
fields are required for setup, and the Opportunities tests verify that advanced controls
remain available without occupying the primary review surface.

A one-off real-browser acceptance run used bundled Playwright with installed Chrome,
a fresh browser session, and a disposable database. It verified Profile creation and
selection, job detail, Save/Undo, Settings health, no JavaScript errors, and desktop/
390px mobile layouts without horizontal overflow. No Playwright dependency or test
scaffold was added to the project. The actual `pnpm start` command was also verified
against a separate empty database on loopback port 18917 and stopped afterward.

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
- `0006_neat_clea.sql` adds the four M3 scoring tables without mutating M2 job, snapshot,
  source, or Profile history. Tests migrate both an empty database and a database already
  migrated through M2 with fictional current job/snapshot data.
- `0007_bizarre_richard_fisk.sql` adds sparse triage, append-only feedback/review events,
  persisted scan/source stage, and source failure stage. Tests migrate both empty and
  populated M3 databases; exact formal score/version/history values remain unchanged and
  existing terminal runs become `complete`.
- `0008_melted_purple_man.sql` rebuilds only `scoring_attempts` to add nullable actual-usage
  columns. The populated M3/M4 fixture proves old attempt byte/model/error/
  timestamp data survives and new usage fields remain null.
- `0009_light_sleepwalker.sql` additively adds Profile name/selection columns and the
  global Profile-version uniqueness index. A populated pre-migration singleton becomes
  the selected `Primary profile`; its version and foreign-key relationships remain intact.

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
curl --fail http://127.0.0.1:8787/api/profiles
curl --fail 'http://127.0.0.1:8787/api/jobs?includeClosed=true&sort=rankingScore&direction=desc'
curl --fail 'http://127.0.0.1:8787/api/scoring/queue?limit=1'
curl --fail http://127.0.0.1:8787/api/scoring/config
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

Fuzzy-dedup evals, scheduler/notification integration, application tracking/documents,
large-volume performance, backup restore drills, additional source adapters, and release
automation remain in their owning later phases. Restart recovery for M3 scoring state and
SSE reconnect from durable M4 scan state are covered without introducing a resident
scheduler.
