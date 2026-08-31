# Testing and verification

## Deterministic test layers in the completed M2 collection slice

- Shared contract tests cover Profile/preferences, strict source configurations, the full
  support matrix, bounded request policy, safe board identifiers, complete descriptions,
  source metadata, enumerated run/error states, URL canonicalization, identity text, and
  publication-date composite keys.
- Connector tests use only fictional fixed JSON. `exerciseConnectorContract` is a
  reusable, transport-independent contract kit that checks health, discovery, unique
  external IDs, detail retrieval, normalized schema output, and ID continuity.
- JobTech fixtures cover search pagination, complete detail, retries, timeout, pacing,
  cancellation, and concurrency.
- Greenhouse fixtures cover a successful multi-job full-board response, empty board,
  individual details, HTML entity normalization, and 429 retry. Its documented jobs list
  has no pagination, so tests assert one complete page rather than inventing parameters.
- Lever fixtures cover successful `skip/limit` multi-page discovery, empty page, individual
  details, and classified 5xx failure.
- Ashby fixtures cover a successful multi-job full-board response, unlisted filtering,
  empty board, complete embedded details, and classified 429 failure. Its documented
  public endpoint has no pagination or separate detail endpoint.
- Teamtailor fixtures cover official JSON:API list/detail pagination, stable IDs, location
  relationships, safe token-header handling, and its required environment configuration.
- Generic-web fixtures contain fictional schema.org `JobPosting` JSON-LD. Security tests
  cover non-HTTPS URLs, credentials, nonstandard ports, localhost/private/link-local/
  reserved/metadata IPv4 and IPv6, unsafe DNS answers, mixed public/private answers, DNS
  rebinding resistance, unsafe redirects, redirect limits, response size, and content type.
- Database tests migrate both an empty database and a populated database created at the
  preceding migration. They verify the new backfills/indexes, integrity/foreign keys,
  deterministic URL/fingerprint/composite matches, ambiguous no-merge behavior, merge
  evidence, source-specific snapshots, changed-field classification, three-miss closure,
  reopening, partial-failure safety, configuration versions, duplicate-scan rejection,
  and history-preserving reprocessing.
- API integration tests use temporary migrated databases. They cover Profile CRUD,
  JobTech scanning/lifecycle, source create/edit/pause/enable/test/delete, source metrics,
  latest-run summaries, partial source isolation, detail-partial missing-counter safety,
  safe error categories, retry counts, cancellation, health continuity, support levels,
  limited-source defaults, source reruns, duplicate scan protection, reprocessing, and
  expanded job list/detail audit responses.
- React tests cover Profile onboarding/versioning, Jobs list/detail/scan, and browser
  source add/test/edit/pause/enable/delete operations plus support/health/history rendering.

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

Use a newly created disposable directory rather than the normal local database:

```bash
JOB_RADAR_DATABASE_PATH=/tmp/job-radar-m2-migration/example.sqlite pnpm db:migrate
```

Migration `0004_windy_mongu.sql` adds source configuration/run versions, the durable active
scan key, canonical-source/fingerprint/change timestamps, explainable source-match data,
source-specific snapshot fields/indexes, and merge events. It explicitly backfills
populated Phase 4 databases. Verify:

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
curl --fail http://127.0.0.1:8787/api/sources
curl --fail http://127.0.0.1:8787/api/jobs
```

Starting a scan requires a local Profile with at least one confirmed target role. Use a
disposable database and fictional Profile for acceptance unless the user explicitly wants
their normal local state.

## Live smoke policy

Live Greenhouse, Lever, Ashby, JobTech, and authorized Teamtailor smoke checks are optional
and must never be part of `pnpm test`. Use only a documented public board with a disposable
database or a read-only connector health/discovery script. Never place a Teamtailor token
in source JSON, shell history, logs, or fixtures. Record only the board identifier, time,
status, and counts; never retain or log complete real job descriptions as smoke output. If
DNS or egress is unavailable, record that fact rather than calling fixtures “live.”

## Deferred tests

M3 scoring evals, broader fuzzy-dedup evals, scheduler/crash recovery, standalone
Playwright browser automation, large-volume performance, CSP/security hardening, backup
restore drills, and release automation remain in their owning later phases.
