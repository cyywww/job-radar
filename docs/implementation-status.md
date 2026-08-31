# Implementation status

Last updated: 2026-08-31

## Current milestone

M1 / Phase 2 — Profile, job preferences, and onboarding complete; ready for M2.

## Completed

- Preserved and re-verified the full M0 quality gate before M1 changes.
- `JR-101`: single local Profile record with immutable snapshot versions.
- Structured facts for basics, work, education, skills, languages, certifications, and
  projects.
- Per-fact logical ID, immutable evidence-row ID, evidence source, confirmation status,
  optional evidence note, and update timestamp.
- Structured preferences covering roles, locations, onsite/hybrid/remote modes, commute,
  salary, work authorization/sponsorship, industries, company size, must-haves, and hard
  exclusions.
- `JR-102`: create, read, full-snapshot update, confirmation, version list, and historical
  version APIs with optimistic `baseVersion` conflict checks.
- `JR-103`/`JR-104`: pasted-text and local text-file import contracts plus an explicitly
  identified deterministic substitute. It extracts only exact labeled basic fields,
  never claims to be AI, and always returns pending facts.
- `JR-105`: preference read/update and deterministic search-constraint preview APIs.
- `JR-106`: responsive React onboarding and Profile editor covering all M1 fact and
  preference categories.
- `JR-107`: live browser preview of target-role search lanes, search terms, hard gates,
  exclusions, and readiness warnings. The pure preview function is shared with the API,
  and pending or unknown preferences cannot report ready.
- Confirmed-only completeness and missing-information guidance in the browser.
- Evidence ledger, confirmation controls, and visible immutable version history.
- `GET /api/profile/confirmed`, which removes pending and rejected facts before future
  search or scoring code can consume candidate data.
- Generated and reviewed Drizzle migration `0001_dusty_praxagora.sql`.
- File import protections: `.txt`/`.md` only, `text/plain`/`text/markdown` only, 512 KiB
  body limit, simple file-name validation, and no disk writes.
- Expanded log redaction for request bodies, imported text, evidence excerpts, profiles,
  resumes, credentials, and tokens.
- Complete fictional Profile fixture plus contract, repository, API, security, privacy,
  and browser-flow integration tests.

## Deliberately not implemented

- Real AI extraction. The current extractor is a deterministic labeled-text test
  substitute with `aiUsed: false`.
- PDF, DOCX, image, or rich resume parsing.
- Multiple candidate Profiles, Profile deletion, or automatic historical compaction.
- Job sources, connectors, scans, job storage, and lifecycle logic (M2).
- Final gates, evidence matching, AI scoring, or job ranking (M3).
- Job dashboard/review workflow (M4), service scheduling/notifications (M5), application
  tracking (M6), and release hardening (M7).

## Verification commands

Run from `/Users/yuweicao/Projects/job-radar`:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm dev
pnpm start
```

For an empty-database acceptance check, override `JOB_RADAR_DATABASE_PATH` with a new
disposable path. Runtime acceptance should cover health/readiness, Profile creation,
preference exclusions, pending import, explicit confirmation, editing, version history,
and the confirmed-only view.

## Latest verified result

Verified on 2026-08-31 with Node 22.16.0 and pnpm 11.19.0:

- `pnpm install --frozen-lockfile` completed and `pnpm peers check` found no issues.
- `pnpm check` passed ESLint, all workspace TypeScript checks, 36 tests across 12 test
  files, all package builds, the Vite production build, and the Fastify bundle.
- `pnpm format:check` passed.
- A migration run against a new disposable SQLite file applied both migrations, created
  all five Profile tables, passed `PRAGMA integrity_check` and
  `PRAGMA foreign_key_check`, and exposed the expected indexes.
- `pnpm dev` migrated first, started Vite and Fastify together on loopback, served the
  browser entry page, and returned HTTP 200 with API and database status `ok` from both
  health and readiness.
- `pnpm start` served the production build and returned HTTP 200 from the page, health,
  and readiness endpoints.
- The automated browser-flow test created and edited immutable Profile versions, set
  exclusions, and exposed the live search-lane/Gate preview using fictional values only.

## Stable M1 interfaces

- Shared request/response schemas and inferred types live in
  `packages/shared/src/profile.ts`.
- `ProfileSnapshot` is the full current or historical immutable snapshot.
- `ConfirmedProfileView` contains only confirmed candidate facts and preferences.
- `computeProfileCompleteness` only counts confirmed facts.
- `previewPreferences` produces deterministic search terms, hard constraints,
  exclusions, and readiness warnings without job scoring.
- `ProfileRepository` exposes `create`, `getCurrent`, `getVersion`, `update`, `confirm`,
  `updatePreferences`, `listVersions`, and `getConfirmedView`.
- API endpoints:
  - `POST /api/profile`, `GET /api/profile`, `PUT /api/profile`
  - `POST /api/profile/confirm`
  - `GET /api/profile/versions`, `GET /api/profile/versions/:version`
  - `GET /api/profile/confirmed`
  - `GET /api/preferences`, `PUT /api/preferences`
  - `POST /api/preferences/preview`
  - `POST /api/profile/import`, `POST /api/profile/import/file`
- All writes return the newly created Profile snapshot; updates require the caller's
  current `baseVersion`.

## Next phase entry

M2 may implement job entities, lifecycle state, scan runs, connector interfaces, and
fictional connector fixtures. It can use `GET /api/profile/confirmed` or
`ProfileRepository.getConfirmedView()` for confirmed target roles, locations, work modes,
authorization, and exclusions. M2 must not read `profile_facts` directly, add AI scoring,
or promote pending facts.
