# Testing and verification

## Test layers in M1

- Shared contract tests cover dates, complete salary triples, evidence references, and
  confirmed-only completeness. Shared preference-preview tests cover deterministic search
  terms, hard gates, pending status, and unknown work authorization.
- Configuration tests cover safe loopback/path defaults and environment validation.
- Database integration tests migrate an empty temporary SQLite database, exercise Profile
  version creation/history/conflict handling, and prove pending facts are absent from the
  confirmed-only view.
- API integration tests use Fastify injection and a migrated temporary database for
  health, Profile CRUD/versioning/confirmation, preferences, deterministic imports, Zod
  errors, path traversal rejection, MIME restrictions, and upload size limits.
- Import privacy tests prove unlabeled raw source markers are not returned or persisted in
  the draft contract.
- React tests validate health parsing and run a jsdom browser integration flow that
  creates a Profile, enters job preferences and exclusions, edits the Profile, and sees a
  second immutable version plus the live search-lane/Gate preview.
- Manual in-app browser acceptance uses only fictional values and a disposable database.

All tests use temporary directories or fictional/system-only values. No test reads the
normal local database, a real Profile, resume, secret, or personal file.

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

Use a newly created disposable directory rather than a broad `/tmp` target:

```bash
JOB_RADAR_DATABASE_PATH=/tmp/job-radar-migration-check/example.sqlite pnpm db:migrate
```

The database test performs the same check automatically. A successful M1 migration
creates `profiles`, `profile_versions`, `profile_evidence_sources`, `profile_facts`, and
`profile_preferences` in addition to the M0 metadata and migration tables.

## Runtime checks

Development:

```bash
pnpm dev
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8787/api/readiness
curl --fail http://127.0.0.1:5173/
```

Production-style local run:

```bash
pnpm build
pnpm start
curl --fail http://127.0.0.1:8787/
curl --fail http://127.0.0.1:8787/api/health
```

For manual Profile acceptance, use an isolated `JOB_RADAR_DATABASE_PATH`; verify pending
import, creation, explicit confirmation, manual edits, preference exclusions, version
history, completeness, and the System health tab. Do not use a real resume or Profile.

## Latest result

Verified on 2026-08-31 with Node 22.16.0 and pnpm 11.19.0:

- Frozen-lockfile installation passed; the peer dependency check found no issues.
- ESLint, Prettier, and all workspace TypeScript checks passed.
- 36 Vitest tests across 12 files passed: 8 shared, 3 config, 5 database, 17 API,
  and 3 web tests.
- Package TypeScript builds, Vite production build, and Fastify `tsup` bundle passed.
- A disposable empty database applied 2 migrations, exposed all expected tables and
  indexes, and returned no foreign-key violations.
- The jsdom browser-flow test created versions 1 and 2, set a hard exclusion, and rendered
  one deterministic search lane without using personal data.
- `pnpm dev` started Vite and Fastify together after migration; the browser entry,
  health, and readiness endpoints returned HTTP 200 with API and SQLite status `ok`.
- Production-style `pnpm start` served the built page and returned HTTP 200 from health
  and readiness with database status `ok`.
- Privacy tests verified that an unlabeled raw-source marker is neither returned nor
  persisted by the import substitute.

## Deferred tests

Connector contract fixtures and lifecycle/idempotency tests begin in M2. Scoring evals
belong to M3. A standalone Playwright suite, recovery drills, CSP/security hardening, and
release automation remain M7 work; M1 has an automated Testing Library browser-flow test
plus manual in-app browser acceptance.
