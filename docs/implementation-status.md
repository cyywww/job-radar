# Implementation status

Last updated: 2026-09-01

## Current milestone

M3 eligibility, requirement extraction, and evidence-backed deterministic scoring are
implemented on the verified Sweden-first M2 baseline. Collection remains unchanged:
JobTech / Platsbanken is the only default broad source, and one explicitly configured
company page with schema.org `JobPosting` JSON-LD is the only limited supplement.

M3 adds no source, ATS compatibility code, AI deduplication, scheduler, resident worker,
notification, application workflow, or scoring UI.

## M3 completed behavior

- `packages/shared` owns a strict extraction Schema for skills, responsibilities,
  seniority, years, language, authorization, education, domain, location, salary,
  clearance, matched evidence, gaps, unknowns, fits, confidence, and extractor version.
- Scoring reads candidates only through `ProfileRepository.getConfirmedView(version)`.
  Pending and rejected facts are excluded, including from evidence-ID validation.
- `packages/scoring` owns the only provider interface and its only implementation:
  Codex CLI. There is no OpenAI API provider, placeholder, fallback, or compatibility
  branch.
- The Provider uses a private temporary directory, minimized confirmed evidence, the
  current normalized snapshot, a strict output Schema, read-only/ephemeral Codex exec,
  disabled tools/integrations, `shell:false`, an environment allowlist with an isolated
  temporary `HOME`, timeout, cancellation, output bounds, and unconditional cleanup.
- Auditing rejects invalid Schema/JSON/version, fabricated or stale Profile evidence IDs,
  invented JD snippets, invalid requirement references, missing matches/gaps, and any
  model-added Gate or score. Invalid output never reaches formal requirement/score tables.
- A code-owned Gate runs before scoring and covers closed jobs; company/role exclusions;
  authorization, citizenship, and sponsorship; location, onsite, and remote scope;
  required language; and security clearance. Explicit contradictions fail eligibility;
  insufficient information becomes an auditable unknown.
- Gate failure produces no numeric score. AI output cannot mutate or replace the Gate.
- `deterministic-weighted-v1` implements the fixed 30/20/15/15/8/7/5 weights. Component
  ratios, neutral missing values, rounding, integer/range bounds, and version rejection are
  explicit. `matchScore` is independent of publication time.
- `rankingScore` separately combines recorded-as-of freshness, confirmed target-company
  boost, and capped extraction/Gate uncertainty. Confidence and unknowns control review
  state without changing deterministic eligibility.
- SQLite stores append-only requirements, formal scores, task attempts, Gate reasons,
  breakdown, evidence, gaps, unknowns, confidence, provider/model, review state, version
  identities, invalidation, retry, and safe failure metadata.
- The task uniqueness constraint covers job, snapshot, Profile version, extractor version,
  and scoring version. Transactional claims plus a process-local bounded-run guard prevent
  scan duplication, double-clicks, and restarts from processing one attempt twice.
- Snapshot, confirmed Profile, extractor, scoring, and lifecycle changes invalidate the
  applicable current results and requeue work. Closure is re-Gated; reopening can re-enter
  scoring. Forced rescore, explicit retry, backfill, and job reprocessing preserve all
  historical scores, requirements, and attempts.
- API routes validate and orchestrate queue/backfill/process/retry/rescore/history only;
  Gate and scoring rules do not live in routes.
- The offline eval runner contains 34 fully fictional cases with deterministic eligibility
  and exact score ranges across language, authorization, sponsorship, citizenship,
  location, remote scope, closure, exclusions, security clearance, evidence depth,
  seniority, soft preferences, confidence, gaps, and unknowns.

See `docs/scoring.md` for the normative M3 contract.

## Source coverage retained from M2

| Source                | Level     | Scope                                                                                                      | Boundary                                                                                                                 |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| JobTech / Platsbanken | Supported | Official Swedish JobSearch API; Data/IT occupation field; one query per confirmed role; complete ad detail | Up to 100 results × 20 pages per role; structured location taxonomy is retained but Profile location mapping is deferred |
| Target company page   | Limited   | One public HTTPS page with schema.org `JobPosting` JSON-LD                                                 | Paused until enabled; no crawl, selectors, JavaScript, login, CAPTCHA, bypass, or authenticated postings                 |

M2 deterministic identity, source provenance, immutable material snapshots, three-complete-
miss closure, reopening, reprocessing, and one-active-scan protection remain intact.

## Database migration

Migration `0006_neat_clea.sql` adds `scoring_tasks`, `job_requirements`, `job_scores`, and
`scoring_attempts` with foreign keys, range/presence checks, claim indexes, append-only
history, and unique task/attempt identities. It does not rewrite existing M2 jobs,
snapshots, Profile versions, or source history. Existing current snapshots receive work
only through an explicit idempotent backfill.

Migration tests cover an empty database and a database migrated through M2 with a
fictional confirmed Profile, JobTech job, and snapshot history.

## Verification result

Verified on 2026-09-01 with Node 22.16 and pnpm 11.19:

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
  `pnpm check`, and `git diff --check` passed.
- The offline suite passed 131 tests across 27 files: 15 shared, 5 config, 27
  connector, 28 scoring, 21 database, 30 API, and 5 web tests.
- The standalone scoring eval passed all 34 explicit fictional cases.
- An empty disposable database migrated through `0006`; SQLite integrity returned `ok`,
  foreign-key checking returned no rows, and all four M3 tables were present.
- A populated database migrated through M2 retained its fictional confirmed Profile, job,
  current snapshot ID, and description while adding empty M3 tables; integrity and foreign
  keys passed.
- A production-style process bound only to `127.0.0.1` with a disposable database and
  served the built web app. Root, health, readiness, sources, all-status jobs, and scoring
  queue returned HTTP 200. The empty scoring queue did not invoke Codex CLI or network
  extraction.

## Stable privacy boundary

`ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` remain the only
candidate-data consumption boundary. The Provider receives minimized confirmed evidence;
connectors still never read Profile tables. Normal logs and safe failure audit exclude
full descriptions, Profiles, evidence text, prompts, outputs, secrets, authorization
headers, cookies, and tokens.

## Deferred to M4 or later

- Dashboard or job-list score presentation, filtering, sorting, compare views, favorites,
  ignore actions, and review/correction UI.
- Additional job sources, ATS adapters, fuzzy/AI deduplication, taxonomy location mapping,
  multi-page crawling, JavaScript rendering, authenticated sources, or bypass behavior.
- Scheduler, resident/background scoring worker, notifications, digests, operational
  backup/restore automation, and large-volume performance work.
- Application tracking, application documents, submission, or automated applications.
