# Implementation status

Last updated: 2026-08-31

## Current milestone

The M2 planned-source, identity, and lifecycle hardening slice is complete. JobTech,
Greenhouse, Lever, and Ashby remain fully supported. Teamtailor and one-page generic
schema.org JSON-LD collection are deliberately limited and disabled until explicitly
configured and enabled. Workday, Jobylon, and SAP SuccessFactors are explicitly reported
as not supported rather than implemented through unstable tenant-specific endpoints.

Jobs now have deterministic and explainable cross-source identity, per-source immutable
change history, first/last/changed timestamps, aggregate open/possibly-closed/closed state,
three-complete-scan missing closure, source-failure isolation, reopening, safe
reprocessing, configuration-versioned reruns, and database-backed duplicate scan guards.

## Connector support status

| Connector          | Status        | Supported scope                                                     | Deliberate limits                                                                                |
| ------------------ | ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| JobTech            | Supported     | Confirmed-role discovery, offset paging, complete `/ad/{id}` detail | No taxonomy/location ID mapping yet.                                                             |
| Greenhouse         | Supported     | Official unauthenticated board list/detail JSON                     | Non-paginated list; employment type unavailable; configured company fallback.                    |
| Lever              | Supported     | Official global/EU Postings list/detail JSON and skip/limit paging  | Configured company; no public deadline.                                                          |
| Ashby              | Supported     | Official complete public board JSON with embedded descriptions      | Unlisted posts excluded; configured company; no public deadline.                                 |
| Teamtailor         | Limited       | Official regional JSON:API list/detail and location relationship    | Company-admin Public Read token required by environment-variable name; starts paused.            |
| Workday            | Not supported | Capability/reason visible; no configurable connector                | External sites vary by tenant; documented service reports require customer configuration.        |
| Jobylon            | Not supported | Capability/reason visible; no configurable connector                | Official feed is provisioned to customers/integration partners; no universal anonymous contract. |
| SAP SuccessFactors | Not supported | Capability/reason visible; no configurable connector                | Recruiting APIs require tenant permissions/credentials.                                          |
| Generic web        | Limited       | One public HTTPS page; valid schema.org `JobPosting` JSON-LD only   | Explicit opt-in and paused; no crawl/selectors/JS/login/CAPTCHA/bypass.                          |

All implemented connectors have strict Zod boundaries, explicit User-Agent, abortable
timeout/retry controls, safe errors, and fictional offline fixtures. URL-configured generic
web additionally enforces DNS-aware SSRF and redirect protections, public-IP pinning,
HTTPS/port/content/size limits, and metadata/private/reserved address denial.

## Completed

- Added a shared support catalog and `GET /api/source-capabilities`; browser users see the
  level, default state, configurability, and reason for every planned source.
- Added `TeamtailorConnector` for its official EU/NA/AU JSON:API. The database stores only
  the configured token environment-variable name, and the source starts disabled.
- Added an explicitly enabled generic JSON-LD connector with pre-connect and per-redirect
  SSRF validation, public DNS/IP pinning, response bounds, and no arbitrary selectors or
  browser execution.
- Added deterministic identity helpers for canonical URLs, normalized identity text,
  normalized descriptions, full-description SHA-256 fingerprints, and publication-day
  composite keys.
- Implemented ordered unique matching by same-source external ID, canonical URL,
  company/title/location/full-description fingerprint, and
  company/title/location/publication day. Ambiguous candidates remain separate.
- Added per-source match strategy/evidence and append-only cross-source merge events so the
  job detail can explain every link.
- Made snapshots source-specific and material: description, location, deadline, title, or
  company changes append a snapshot with explicit changed fields; unchanged repeats do
  not. Raw payloads remain local and hidden from normal APIs.
- Added job/link first seen, last seen, and last changed semantics. One or two complete-run
  misses produce `possibly_closed`; the third closes a link; a later sighting reopens it.
  Failed, cancelled, incomplete, or detail-partial runs cannot advance misses, and another
  live source keeps the aggregate job open.
- Added safe normalization reprocessing through `POST /api/jobs/reprocess`. It can merge
  only unambiguous disjoint-source jobs transactionally and asserts that snapshot history
  is neither dropped nor duplicated.
- Added monotonically increasing source `config_version`, captured by each SourceRun, plus
  `POST /api/sources/:id/rerun` for the current version.
- Added a partial unique SQLite active-scan constraint and transactional guard. Browser
  double-clicks/concurrent requests cannot create overlapping queued/running scans, and
  reprocessing refuses to overlap an active scan.
- Expanded Jobs browser detail with every source, merge explanation, per-source state,
  open/possibly-closed/closed aggregate status, discovery/change timestamps, source health
  and errors, run config versions, and change history.
- Added generated and reviewed migration `0004_windy_mongu.sql`, including explicit
  backfills for an already populated database at the previous migration.

## Deliberately not implemented

- Workday, Jobylon, and SuccessFactors tenant-specific/credentialed integration paths.
  Their reasons remain visible as `not_supported`; there is no fragile placeholder code.
- Arbitrary HTML selectors, multi-page crawling, JavaScript rendering, login/CAPTCHA/
  access-control bypass, authenticated internal postings, or application submission.
- Broad fuzzy/AI-assisted cross-source matching. Deterministic rules require a unique
  candidate; uncertain jobs remain separate.
- AI extraction, eligibility Gates, scoring, ranking, rescore queues, or evals.
- Daily scheduling, service management, notifications, crash recovery, backups, or the
  project CLI.
- Applications, triage, feedback, or automated application behavior.

## Verification result

Verified on 2026-08-31 with Node 22.16.0 and pnpm 11.19.0:

- `pnpm check` passed lint, every workspace TypeScript check, all 98 tests across 21 test
  files, package builds, the Vite production build, and the Fastify ESM bundle.
- Test totals are 15 shared, 3 config, 35 connector, 12 database, 28 API, and 5 web tests.
  The suite uses fictional/system data and does not read the network, normal local
  database, real Profile, or a secret.
- Teamtailor and generic-web connector fixtures pass their connector contract. Generic web
  includes 20 focused parsing/SSRF tests. Support-contract tests cover every planned source
  and explicitly assert all limited/not-supported levels.
- Database tests prove deterministic cross-source matches and ambiguous no-merge,
  explanations, per-source material snapshots, three-miss closure, reopening,
  incomplete-result non-closure, source-aware aggregate state, versioned config, durable
  duplicate-scan rejection, repeatable reprocessing, and unchanged snapshot counts.
- Migration tests apply all five migrations from empty and upgrade a populated database
  built at migration 0003. The independent disposable database returned `ok` from
  `PRAGMA integrity_check`, no rows from `PRAGMA foreign_key_check`, and exposed the new
  merge/snapshot/source/run tables and indexes.
- `pnpm format:check` passed.
- `pnpm start` migrated first, served the production web bundle and API only on
  `127.0.0.1:8787`, and returned HTTP 200 for `/`, health, readiness, source capabilities,
  and all-status jobs. The API ESM build keeps `undici` external as a declared runtime
  dependency, verified by this real start rather than build output alone.
- In-app browser acceptance used a disposable database. It verified the nine-source
  support matrix, limited generic source default-pause behavior, source health/error and
  config-version display, one explainable two-source merged job, `possibly_closed` state,
  first/last/changed timestamps, and three immutable snapshots including explicit
  description/location/deadline changes. Browser warning/error logs were empty.
- Live network smoke remains optional and was not used for deterministic acceptance.

## Stable privacy and phase boundaries

- `ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` remain the only
  candidate-data consumption boundary. Pending/rejected facts are not inspected.
- Connectors receive queries and source configuration but never read Profile tables or
  write SQLite directly.
- Complete raw source details remain local in snapshots; normal APIs expose only safe
  normalized descriptions, audit hashes, changed fields, and storage markers.
- The server remains loopback-only. Fully supported ATS connectors need no credentials;
  limited Teamtailor reads a token from the named process environment without persistence.

## Next phase

The next implementation-plan milestone is the M3 scoring vertical slice. It still needs strict requirement-extraction
schemas, the replaceable AI Provider boundary (Codex CLI first), deterministic eligibility
Gates, evidence-linked match/gap output, versioned weighted scoring/ranking, confidence and
unknown handling, invalid-output audit, pending/retry queues, score invalidation on Profile
or snapshot changes, and a fictional eval set. It must consume only `ConfirmedProfileView`
plus normalized Job detail/snapshot data, never raw ATS metadata as candidate evidence.
