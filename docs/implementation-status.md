# Implementation status

Last updated: 2026-08-31

## Current milestone

Phase 4 / M2 structured-source expansion is complete: JobTech plus user-configured
Greenhouse, Lever, and Ashby public boards can be managed in the browser, scanned behind
independent failure boundaries, normalized to the shared Job model, and audited through
durable health, metrics, run summaries, source metadata, and immutable snapshots.

## Connector support status

| Connector  | Status    | Supported scope                                                                                                         | Deliberate limits                                                                                           |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| JobTech    | Supported | Confirmed-role free-text discovery, offset pagination, `/ad/{id}` complete detail, lifecycle                            | No taxonomy/location ID mapping yet.                                                                        |
| Greenhouse | Supported | Public board list plus individual public job detail; dates, location, content, source fields                            | Official list is non-paginated. Employment type is unavailable. Company can fall back to configured label.  |
| Lever      | Supported | Global/EU public Postings API, documented skip/limit paging, individual detail, structured categories/workplace         | Company is configured; no public application deadline.                                                      |
| Ashby      | Supported | Public complete board response, embedded plain/HTML detail, workplace/employment, optional public compensation metadata | Official endpoint is non-paginated. Unlisted posts are excluded; company is configured; no public deadline. |

All four connectors use fixed official JSON origins, strict Zod parsing, explicit
User-Agent, abortable timeout/retry/rate/concurrency policy, safe error classification,
and fictional offline fixtures. There is no login/CAPTCHA bypass or HTML scraping.

## Completed

- Added strict discriminated Greenhouse, Lever, and Ashby `SourceConfig` contracts with a
  shared bounded request policy and source-neutral `NormalizedJob` output.
- Added a shared connector transport with per-source pacing, timeout, capped exponential
  retry, bounded `Retry-After`, cancellation, JSON validation boundary, and classified
  safe errors.
- Added `GreenhouseConnector`, `LeverConnector`, and `AshbyConnector`, retaining stable
  external IDs, original URLs, complete raw detail data, and ATS-only metadata outside the
  core Job fields.
- Added reusable `exerciseConnectorContract` validation for later structured sources.
- Added fixed fictional success, empty, multi-job or multi-page, rate/failure, and detail
  fixtures/tests for all three ATS connectors. Default tests have no network dependency.
- Added Zod-validated source configuration APIs:
  - `GET /api/sources`
  - `POST /api/sources`
  - `PATCH /api/sources/:id`
  - `DELETE /api/sources/:id`
  - `POST /api/sources/:id/test`
- Restricted creation to official fixed API origins. Lever global/EU is explicit; no
  arbitrary URL can be supplied through the browser API.
- Added source pause/enable and soft deletion. Deleted sources leave historical runs,
  JobSource links, and snapshots auditable while disappearing from future scans.
- Added durable source/run error categories, health, last success/error, aggregate run/
  retry/job metrics, and the latest SourceRun summary.
- Preserved source and detail isolation: one failed connector does not stop later sources,
  and one failed detail does not discard sibling jobs.
- Generalized lifecycle missing thresholds across all source configs. Only complete
  discovery can advance misses; failed, cancelled, and capped scans remain non-closing.
- Added source-scoped canonical keys and a conservative cross-source matcher requiring an
  exact company/title/location/full-description match. Same-source repeat scans remain
  idempotent by `(source_id, source_job_id)`.
- Made merged-job lifecycle source-aware: an inactive or expired source link cannot close
  a Job while another source link remains active.
- Added JobSource metadata storage and raw-response audit without exposing raw JSON through
  normal APIs or rendering upstream HTML.
- Added a Sources browser workspace for add/configure, test, pause/enable, delete, health,
  friendly errors, metrics, and latest-run inspection. Jobs now scans all enabled sources
  and reports classified per-source errors.
- Added generated/reviewed migration `0003_superb_sprite.sql`.

## Deliberately not implemented

- Teamtailor, Workday, Jobylon, SuccessFactors, generic HTML, or any other new source.
- Authenticated ATS endpoints, application submission, internal postings, CAPTCHA/login
  bypass, browser scraping, or high-risk anti-bot behavior.
- Broad fuzzy cross-source matching. Exact complete-content matching is the only merge
  rule beyond source identity.
- AI requirement extraction, eligibility Gates, scoring, ranking, rescore queues, or evals.
- Daily scheduling, service management, notifications, crash recovery, backups, or the
  project CLI.
- Applications, triage, feedback, or automated application behavior.

## Verification result

Verified on 2026-08-31 with Node 22.16.0 and pnpm 11.19.0:

- The deterministic suite passes 64 tests across 20 files: 12 shared, 3 config, 13
  connector, 7 database, 24 API, and 5 web tests.
- Connector contract/fixture tests cover all four source types; Lever proves two-page
  discovery while Greenhouse/Ashby prove their documented complete-board semantics.
- API integration proves the full source-management lifecycle, health testing, safe error
  categories, one-source failure isolation, durable metrics/latest summaries, and the
  existing repeat-scan/detail-failure/cancellation/lifecycle behavior.
- Database integration proves exact cross-source merge, two retained source links,
  same-source repeat idempotency, immutable source-specific snapshots, metadata markers,
  and migration integrity.
- Browser tests prove source add/test/edit/pause/enable/delete plus Jobs scan/detail and
  Profile version flows.
- `pnpm check` passed lint, all workspace TypeScript checks, all 64 tests, package builds,
  the Vite production build, and the Fastify bundle; `pnpm format:check` passed.
- A disposable empty SQLite database applied all four migrations, exposed the Phase 4
  columns, returned `ok` from `PRAGMA integrity_check`, and had no foreign-key violations.
- `pnpm dev` and `pnpm start` both migrated first, bound only to loopback, and returned
  HTTP 200 for their web entry plus health, readiness, sources, and jobs routes.
- In-app browser acceptance used a disposable database and the production build. It
  verified Sources navigation, fictional source creation, pause/enable, source metrics
  empty states, the multi-source Jobs empty state, responsive visual layout, and an empty
  browser warning/error console.
- Live Greenhouse/Lever/Ashby network smoke is optional and was not part of the
  deterministic suite.

## Stable privacy and phase boundaries

- `ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` remain the only
  candidate-data consumption boundary. Pending/rejected facts are not inspected.
- Connectors receive queries and source configuration but never read Profile tables or
  write SQLite directly.
- Complete raw source details remain local in snapshots; normal APIs expose only safe
  normalized descriptions, audit hashes, and storage markers.
- The server remains loopback-only and no credentials are required by supported ATS
  connectors.

## Phase 5 entry

The next phase is the scoring vertical slice. It still needs strict requirement-extraction
schemas, the replaceable AI Provider boundary (Codex CLI first), deterministic eligibility
Gates, evidence-linked match/gap output, versioned weighted scoring/ranking, confidence and
unknown handling, invalid-output audit, pending/retry queues, score invalidation on Profile
or snapshot changes, and a fictional eval set. It must consume only `ConfirmedProfileView`
plus normalized Job detail/snapshot data, never raw ATS metadata as candidate evidence.
