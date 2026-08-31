# Implementation status

Last updated: 2026-09-01

## Current milestone

The M2 collection, deterministic identity, and lifecycle slice is complete and Sweden
first. The project has one broad source—JobTech / Platsbanken—and one deliberately narrow
supplement: an explicitly configured target-company page with valid schema.org
`JobPosting` JSON-LD.

Platform-specific ATS adapters and their configuration/UI/test branches have been deleted.
The application does not advertise support for code it does not contain.

## Source coverage

| Source                | Level     | Scope                                                                                                      | Boundary                                                                                                                 |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| JobTech / Platsbanken | Supported | Official Swedish JobSearch API; Data/IT occupation field; one query per confirmed role; complete ad detail | Up to 100 results × 20 pages per role; structured location taxonomy is retained but Profile location mapping is deferred |
| Target company page   | Limited   | One public HTTPS page with schema.org `JobPosting` JSON-LD                                                 | Paused until enabled; no crawl, selectors, JavaScript, login, CAPTCHA, bypass, or authenticated postings                 |

The target-page transport validates and pins public DNS results, revalidates redirects,
and denies unsafe schemes, credentials, ports, local/private/reserved/metadata addresses,
unsafe content types, and oversized bodies.

## Completed behavior

- JobTech is the only automatic source. It always uses occupation-field
  `apaJ_2ja_LuF`, sends confirmed roles separately, respects the 2,000-result search
  window, and retains occupation group, municipality identifiers, and required languages
  as structured source metadata.
- Target company pages can be added, tested, edited, enabled/paused, rerun, and soft
  deleted. They start paused and accept only an explicit HTTPS page.
- URL canonicalization removes credentials, fragments, default ports, and known tracking
  parameters, then normalizes host/path and sorts retained query parameters.
- Identity matching is ordered: same-source external ID, canonical URL, exact normalized
  description fingerprint with company/title/location, then unique
  company/title/location/publication day. Ambiguous candidates remain separate.
- `jobs`, `job_sources`, `job_snapshots`, and append-only merge events preserve aggregate
  identity, every source link, immutable material changes, and the reason a merge occurred.
- Jobs and links track first seen, last seen, and last changed timestamps. Description,
  company, title, location, or deadline changes append a source-specific snapshot.
- Only complete, detail-successful source scans advance misses. One or two misses produce
  `possibly_closed`; the third closes the link. Another open source keeps the aggregate
  job open, and a later observation reopens it.
- Reprocessing recomputes current identity under the latest normalization rules without
  deleting snapshots. Source configuration versions make safe reruns auditable.
- A database partial unique index plus transactional preflight prevents duplicate
  queued/running scans. Sources run in stable order and bound their detail concurrency.
- The browser shows source health/errors/metrics, latest run, all job sources, merge
  explanations, lifecycle state, timestamps, and change history.

## Clean-break migration

Migration `0005_sweden_source_cleanup.sql` upgrades JobTech to the fixed Sweden Data/IT
configuration. If a database contains only current source types, source and snapshot
history is retained. If it contains a removed source type, all reproducible collection
state is reset before that source is deleted so no orphaned provenance or unsupported
configuration survives. Candidate Profile/version history is not touched.

## Deliberately deferred

- Additional broad job boards or platform-specific adapters.
- Taxonomy-backed mapping from free-text Profile locations to JobTech municipality IDs.
- Multi-page crawling, selector scraping, JavaScript rendering, authenticated postings,
  or access-control bypass.
- Fuzzy or AI-assisted deduplication.
- AI extraction, eligibility gates, scoring, ranking, applications, scheduling, and
  notifications.

## Verification result

Verified on 2026-09-01 with Node 22 and pnpm 11:

- `pnpm check` passed lint, workspace typechecks, 90 tests across 20 files, all package
  builds, the Vite production build, and the Fastify ESM bundle.
- Test totals are 15 shared, 3 config, 27 connector, 13 database, 27 API, and 5 web tests.
- `pnpm format:check` and `git diff --check` passed.
- Migration tests cover empty creation, populated JobTech history retention/config upgrade,
  and complete unsupported-source collection cleanup with SQLite integrity and foreign-key
  checks.
- Connector fixtures are fictional and offline. JobTech covers filtering, separate-role
  paging, normalization, metadata, retry/timeout/cancellation/concurrency; target-page
  tests cover JSON-LD and DNS/redirect/SSRF/content bounds.
- Repository/API tests cover cross-source fixtures, explainable matches, ambiguity,
  material snapshots, three misses, reopening, source-failure isolation, partial-detail
  safety, versioned reruns, duplicate-scan prevention, and history-preserving reprocessing.
- A production-style loopback runtime served the built web application and returned HTTP
  200 for health, readiness, sources, and all-status jobs using a disposable database.

## Stable privacy boundary

`ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` remain the only
candidate-data consumption boundary. Pending/rejected facts stay excluded. Connectors do
not read Profile tables or write SQLite directly, complete raw details remain local, and
the server binds to loopback by default.

## Next phase

M3 may add deterministic eligibility gates and evidence-linked scoring, but it must
consume only `ConfirmedProfileView` plus normalized job/snapshot data. No AI scoring has
started in this milestone.
