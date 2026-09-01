# Implementation status

Last updated: 2026-09-01

## Current milestone

M4 daily job review is implemented on the verified M3 deterministic-scoring baseline.
Collection remains Sweden-first: JobTech / Platsbanken is the only enabled broad source,
and one explicitly configured company page with schema.org `JobPosting` JSON-LD is the
only limited supplement.

M4 adds no source or ATS adapter, fuzzy/AI deduplication, scheduler, resident worker,
notification, application workflow, application document, or score override.

## M4 implemented behavior

- Dashboard shows local-day additions, eligible strong matches at the centralized display
  threshold 80, pending scoring, pending review, closed jobs, source health, latest scan,
  top ten ranked jobs, and explicit next actions.
- Jobs provides responsive table/card views, pagination, default closed-job hiding, and
  server search over title/company/extracted skills. It filters triage, location, remote
  mode, company, source, lifecycle, Gate, score state, and review state; sorts only through
  whitelisted match/ranking/published/deadline/changed fields; and stores a versioned filter
  and view snapshot in browser local storage.
- Unscored, pending, running, retry-wait, failed, Gate-failed, review, and scored states are
  separate. Gate failure has null numeric scores and is never presented as zero.
- Detail renders the complete JD as untrusted plain text and external links with safe
  attributes. It shows lifecycle/timestamps, distinct match and ranking scores, seven
  weighted dimensions, Gate reasons/explanations, matched evidence and Profile evidence
  IDs, gaps, unknowns, confidence, versions/provider/model/`rankingAsOf`, all source links
  and merge explanations, and immutable snapshot history.
- Sparse SQLite triage implements `new | shortlisted | ignored | archived`; missing rows
  read as `new`. Single and bounded bulk writes are validated and idempotent. Bulk
  validation and exact undo are transactional. Same-state requests do not rewrite the
  timestamp, and undo restores the prior timestamp or deletes the row when the prior state
  was implicit `new`. Refresh retains state; optimistic UI rolls back on failure and moves
  focus to the live Undo action.
- Review decisions require an explanation, append immutable review events, and change only
  review state. Correction feedback stores the server-derived original formal score,
  optional human suggestion, type, and reason separately. It cannot rewrite formal M3
  match/ranking, Gate, breakdown, versions, Profile evidence, or history.
- Explicit operations distinguish full scan, source rerun, current-source job refresh,
  job/bulk rescore, retryable-failure reset, bounded queue process, and local historical
  reprocessing. Buttons prevent concurrent double submission and surface safe progress or
  failures.
- Scan and source stages and bounded in-progress counts are durable. SSE sends the current
  database state immediately, sends changed stages/counts/terminal state only, removes
  interval state on disconnect, and stops at terminal status. Refresh/reconnect
  reconstructs progress from SQLite.
- Sources/Runs shows supported versus limited sources, enabled/paused/deleted state,
  health, latest run/stage, discovery/fetch/create/update/failure counts, retries, sanitized
  error classification, and the stage that failed. Test/edit/enable/pause/soft-delete/rerun
  operations preserve provenance.
- Loading, empty, missing-score, scoring/source/network failure, and no-result states have
  readable labels. Native semantic controls, headings, tables, progress, live regions,
  keyboard operation, focus transfer, non-color status text, and narrow-screen layouts are
  covered without a new UI/state/table framework.

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

## Verification result

Verified on 2026-09-01 with Node 22.16 and pnpm 11.19:

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
  `pnpm check`, and `git diff --check` passed.
- The offline suite passed 161 tests across 30 files: 22 shared, 5 config, 27
  connector, 28 scoring, 30 database, 35 API, and 14 web tests.
- The standalone scoring eval passed all 34 explicit fictional cases.
- An empty disposable database migrated through `0007`; SQLite integrity returned `ok`,
  foreign-key checking returned no rows, and all three M4 tables were present.
- The populated M3 migration test retained its fictional confirmed Profile, job, snapshot,
  requirement, formal match/ranking scores, scoring/review versions, and attempt; new M4
  review tables were empty and terminal runs became `complete`.
- A production-style process bound only to `127.0.0.1:8787` with a disposable fictional
  database served the built app. Root, health, readiness, Dashboard, filtered Jobs, Detail,
  Sources, Runs, and terminal SSE returned HTTP 200. SSE contained terminal run state and
  no description. A triage update survived a new detail read and exact transactional undo
  restored `new`.
- Browser verification covered Dashboard, Jobs, Detail, and Sources/Runs at the desktop
  viewport and at 390 px. Navigation remained usable, support/stage labels were visible,
  and the console contained no warnings or errors.

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
