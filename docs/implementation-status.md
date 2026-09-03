# Implementation status

Last updated: 2026-09-03

## Current milestone

M4 daily job review is implemented on the verified M3 deterministic-scoring baseline.
Collection remains Sweden-first: JobTech / Platsbanken is the only enabled broad source,
and one explicitly configured company page with schema.org `JobPosting` JSON-LD is the
only limited supplement.

M4 adds no source or ATS adapter, fuzzy/AI deduplication, scheduler, resident worker,
notification, application workflow, application document, or score override.

## M4 implemented behavior

- The browser has three primary destinations: **Opportunities**, **Profiles**, and
  **Settings**. The former Dashboard and Jobs flows are consolidated into Opportunities;
  source management and system health are secondary Settings tabs. The Dashboard
  component, endpoint, queries, contracts, and styles have been deleted.
- Users can create, name, select, edit, and delete up to 20 Profiles. Exactly one saved
  Profile is selected when any exist; that Profile alone drives scans, eligibility,
  scoring queues, score history, feedback, and the Opportunities score projection. Each
  Profile retains its own immutable version history. Switching does not invalidate another
  Profile's scores. Deleting removes that Profile's facts, evidence, scoring tasks,
  requirements, scores, attempts, feedback, and review events; global jobs and scan
  summaries remain, while deleted-profile search queries are scrubbed from retained runs.
- Profile starts with three inputs: target role is required, location is optional, and
  core skills are recommended. Language/eligibility, work evidence, optional filters, and
  supporting credentials are separate nested disclosures; deterministic import and
  immutable history share another. The complete Profile contract and confirmed evidence
  boundary remain unchanged, while internal source/confirmation metadata is not presented
  as routine form work.
- Opportunities is card-first with one search field and four quick views: all, new, saved,
  and needs review. Advanced filters, sorting, table view, saved-filter controls, and batch
  selection remain available through progressive disclosures. It retains pagination,
  default closed-job hiding, server search over title/company/extracted skills, all bounded
  M4 filters and whitelisted sorts, and versioned browser-local filter/view snapshots.
- Unscored, pending, running, retry-wait, failed, Gate-failed, review, and scored states are
  separate. Gate failure has null numeric scores and is never presented as zero.
- Detail leads with Save, Ignore, the original listing, distinct match/ranking/confidence,
  and plain-language strengths, gaps, and questions. Gate reasons, seven weighted
  dimensions, version/provider/model/`rankingAsOf`, AI usage, the complete plain-text JD,
  source links/merge explanations, and immutable snapshot history remain available in
  explicit technical/detail disclosures. External links keep safe attributes and source
  HTML never enters an executable DOM path.
- Sparse SQLite triage implements `new | shortlisted | ignored | archived`; missing rows
  read as `new`. Single and bounded bulk writes are validated and idempotent. Bulk
  validation and exact undo are transactional. Same-state requests do not rewrite the
  timestamp, and undo restores the prior timestamp or deletes the row when the prior state
  was implicit `new`. Refresh retains state; optimistic UI rolls back on failure and moves
  focus to the live Undo action.
- A one-click “Looks right” action records a bounded built-in confirmation reason;
  correction still requires the user to explain what needs changing. Both append immutable
  review events and change only review state. Detailed correction feedback separately stores
  the server-derived original formal score, optional human suggestion, type, and reason. It
  cannot rewrite formal M3 match/ranking, Gate, breakdown, versions, Profile evidence, or
  history.
- Explicit operations distinguish full scan, source rerun, current-source job refresh,
  job/bulk rescore, retryable-failure reset, and bounded queue process. Historical
  reprocessing is removed. Buttons prevent concurrent double submission and surface safe
  progress or failures.
- Scan and source stages and bounded in-progress counts are durable. SSE sends the current
  database state immediately, sends changed stages/counts/terminal state only, removes
  interval state on disconnect, and stops at terminal status. Refresh/reconnect
  reconstructs progress from SQLite.
- Settings > Sources shows supported versus limited sources, enabled/paused/deleted state,
  health, latest run/stage, discovery/fetch/create/update/failure counts, retries, sanitized
  error classification, and the stage that failed. Test/edit/enable/pause/soft-delete/rerun
  operations preserve provenance.
- Loading, empty, missing-score, scoring/source/network failure, and no-result states have
  readable labels. Native semantic controls, headings, tables, progress, live regions,
  keyboard operation, focus transfer, non-color status text, and narrow-screen layouts are
  covered without a new UI/state/table framework.

## Complexity cleanup

- Multi-Profile resources are the only management API. Singleton CRUD/version routes,
  standalone preferences routes, and unused client/repository wrappers are removed.
  Imports use `/api/profiles/import[/file]`. The selected confirmed-data endpoint
  `GET /api/profile/confirmed` remains a privacy boundary, not a compatibility alias.
- `GET /api/jobs` and `GET /api/jobs/:id` now serve the current review read models.
  The old raw-job contracts/query implementation and `/api/review/jobs` routes are gone.
- Historical job reprocessing and its merge/normalization repair code are deleted.
  Current ingestion, deterministic identity, lifecycle, and immutable histories remain.
- Backend routes separate collection from job review. Frontend features are only
  jobs, profile, and settings; source/system panels have no standalone-page modes.
- HTTP handling is shared by all Web API adapters. Job filters, result rendering, and
  details are separate components; feedback form state belongs to the selected detail.
  Unreferenced exports and obsolete/overridden styles are removed.
- No schema migration, personal-data deletion, new dependency, or later-phase feature
  was introduced. Existing migrations and stored historical values remain intact.

## Source and scoring boundaries retained

| Source                | Level     | Scope                                                                                                      | Boundary                                                                                                                 |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| JobTech / Platsbanken | Supported | Official Swedish JobSearch API; Data/IT occupation field; one query per confirmed role; complete ad detail | Up to 100 results × 20 pages per role; structured location taxonomy is retained but Profile location mapping is deferred |
| Target company page   | Limited   | One public HTTPS page with schema.org `JobPosting` JSON-LD                                                 | Paused until enabled; no crawl, selectors, JavaScript, login, CAPTCHA, bypass, or authenticated postings                 |

M2 deterministic identity, provenance, immutable snapshots, complete-run three-miss
closure, reopening, and scan deduplication remain intact. M3's confirmed-Profile boundary,
strict extraction audit, code-owned Gate, fixed 30/20/15/15/8/7/5 scoring, separate
ranking, confidence/unknown review triggers, append-only history, retry, invalidation, and
safe backfill remain unchanged.

## Manual AI usage controls

- Real scoring requires the user to set an exact `JOB_RADAR_CODEX_MODEL`; the app and
  manual scans remain usable without AI configuration, while scoring fails before task
  claim instead of inheriting an unknown CLI default.
- The Jobs UI processes one job per explicit click, and there is still no scheduler or
  resident worker. Codex CLI has no supported hard token/currency budget, so the app does
  not expose an approximate limit as a guarantee.
- Codex JSONL usage is required for accepted output. Every new attempt records actual
  input/cached/output/reasoning counts, output bytes, and model; the
  detail panel shows total usage without replacing or modifying the formal M3 score.
- The design follows the useful `job-scan` lessons—deterministic work before AI, only
  pending items sent to a model, and bounded manual runs—without copying its scheduler,
  heuristics, or provider-specific USD flag.

## Database migration

Migration `0007_bizarre_richard_fisk.sql` adds `job_triage`, `score_feedback`, and
`score_review_events`; adds durable `stage` to ScanRuns and SourceRuns; and adds
`failure_stage` to SourceRuns. Existing terminal M3 runs become `complete`. It neither
creates triage rows for old jobs nor rewrites existing Profiles, jobs, source links,
snapshots, requirements, formal scores, or attempts.

Migration tests cover an empty database, a populated M2 database entering M3, and a
populated M3 database containing a fictional confirmed Profile, job, snapshot,
requirement, formal score, and attempt. The M3-to-M4 fixture retains exact score/version/
review values and history while the new review tables begin empty.

Migration `0008_melted_purple_man.sql` adds nullable token-usage columns to
`scoring_attempts`. Existing attempts retain all prior fields and receive null usage;
new success and auditable failure attempts persist CLI-reported counts.

Migration `0009_light_sleepwalker.sql` adds Profile names and the single-selected-Profile
marker, marks an existing singleton Profile as selected and names it `Primary profile`,
and makes numeric Profile versions globally unique so the existing scan/scoring audit
references remain unambiguous across Profiles. It uses additive column changes and does
not rebuild the parent Profile table, preserving facts, versions, jobs, scans, scores, and
foreign-key relationships. Populated migration coverage verifies this preservation.

## Verification result

Verified on 2026-09-03 with Node 22.16 and pnpm 11.19:

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
  `pnpm check`, and `git diff --check` passed.
- The offline suite passed 185 tests across 31 files: 24 shared, 5 config, 27
  connector, 29 scoring, 33 database, 50 API, and 17 web tests.
- The standalone scoring eval passed all 34 explicit fictional cases.
- An empty disposable database migrated through `0009`; SQLite integrity returned `ok`,
  foreign-key checking returned no rows, and all token-audit columns were present.
- The populated M3 migration test retained its fictional confirmed Profile, job, snapshot,
  requirement, formal match/ranking scores, scoring/review versions, and attempt; new M4
  review tables were empty and terminal runs became `complete`.
- A production-style process bound only to `127.0.0.1:8787` with a disposable empty
  database served the built app. Root, health, readiness, Opportunities read model,
  Sources, and scoring configuration returned HTTP 200.
- A second production-style disposable run with no configured model returned ready health,
  readiness, and built-root responses while `/api/scoring/config` reported `ready=false`
  and `model=null`; no Codex process was started.
- React interaction verification covered the three-item navigation; named Profile
  creation, editing, selection, deletion, and independent version history; card-first
  Opportunities; quick search and disclosed advanced tools; detail actions; safe
  plain-text JD; feedback/review separation; and Settings source operations. A local
  disposable development preview and the production build both loaded successfully on
  loopback.
- The cleanup acceptance run additionally verified the actual `pnpm start` command
  with a separate empty database on loopback port 18917. Bundled Playwright with installed
  Chrome verified real Profile creation/selection, detail, Save/Undo, Settings, no browser
  errors, and desktop/390px layouts without overflow. Temporary services were stopped.
  Shared button styles no longer get overwritten by generic detail-action styles.

No live JobTech, real Codex CLI, or external source request was made during verification.

## Stable privacy boundary

`ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` remain the only
candidate-data consumption boundary. The Provider receives minimized confirmed evidence;
connectors never read Profile tables. List payloads omit full JDs and histories; only
detail returns the plain-text normalized JD. Normal logs, SSE, source/run errors, and
attempt audit exclude full descriptions, Profiles, evidence text, prompts, outputs,
secrets, authorization headers, cookies, tokens, and raw responses.

## Deferred to later phases

- M5: scheduler, launchd/background execution, resident scoring worker, notifications,
  digests, and automated operational backup/restore.
- M6: Applications/Kanban, application tasks, resume or cover-letter versions, contacts,
  interview records, submissions, and automated applications.
- Later explicit decisions: additional sources/ATS adapters, fuzzy or AI deduplication,
  taxonomy-based location mapping, authenticated/crawled/JavaScript sources, comparison
  workspace, and large-volume performance work.
