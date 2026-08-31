# Architecture decisions

## ADR-001: pnpm workspace without a task orchestrator

The repository uses native pnpm workspace filtering and recursive commands. This keeps
M0 small and matches the implementation plan; task caching can be reconsidered only when
the project demonstrates a real need.

## ADR-002: stable better-sqlite3 driver for Drizzle

The database package uses SQLite through `better-sqlite3` and Drizzle ORM. The built-in
`node:sqlite` Drizzle integration was still documented with release-candidate packages at
implementation time, while the stable driver is sufficient for this local-only service.
The database wrapper keeps driver-specific details inside `packages/db`.

## ADR-003: Zod is the contract source of truth

`packages/shared` exports runtime Zod schemas and inferred TypeScript types. API handlers
and the browser parse the same health contract, so runtime validation and compile-time
types cannot silently drift.

## ADR-004: environment and filesystem policy is centralized

`packages/config` loads `.env` and `.env.local`, validates values, resolves relative paths
from the repository root, and creates only declared runtime directories. Shell-provided
environment variables take precedence. Defaults bind to `127.0.0.1`.

## ADR-005: structured logs go to stdout and a local file

Fastify and startup/migration paths share Pino configuration. Logs are JSON, include a
service name, and redact authorization headers, cookies, tokens, passwords, profile data,
resumes, and job-description fields. The file destination lives below the configurable
log directory and is ignored by Git.

## ADR-006: health and readiness have different semantics

`GET /api/health` always reports observable component state. `GET /api/readiness` returns
HTTP 503 when the database is unavailable. The web status page uses health so it can show
a degraded database instead of replacing useful diagnostics with a generic request error.

## ADR-007: one process for production-style local use

Vite serves web assets during development. After `pnpm build`, Fastify serves the same
browser application and API on port 8787. This preserves the implementation plan's
single-process local production shape without introducing deployment work in M0.

## ADR-008: workspace code is bundled, native/runtime libraries stay external

The API build bundles the local config, database, and shared packages into one ESM entry.
Third-party runtime libraries such as Fastify, Drizzle, SQLite, Pino, Zod, and dotenv stay
external and are declared directly by the API package when referenced by the emitted
bundle. This avoids CommonJS dynamic-require failures while keeping native SQLite code
outside the bundle.

## ADR-009: Profile updates append immutable snapshots

The local installation owns one candidate Profile. Every create, edit, preference update,
or confirmation writes a new `profile_versions` row plus new fact/evidence rows and then
advances the Profile's current-version pointer in one SQLite transaction. Logical fact IDs
survive across versions while evidence-row IDs are immutable. `baseVersion` provides
optimistic conflict detection. This favors auditability and recovery over storage
deduplication at M1 scale.

## ADR-010: facts share provenance columns but retain category-specific Zod data

`profile_facts` stores a constrained `kind` plus JSON data for basics, work, education,
skills, languages, certifications, and projects. Shared provenance columns enforce one
model for source, confirmation, evidence note, and timestamp. Category-specific Zod
schemas validate the JSON at every API and repository boundary. Preferences use a
dedicated one-per-version table because they form a single structured search policy.

## ADR-011: unconfirmed data has a separate consumption boundary

Pending imported facts remain visible and editable in `ProfileSnapshot`, but completeness
counts only confirmed facts. `ConfirmedProfileView`, exposed by the repository and
`GET /api/profile/confirmed`, filters out both pending and rejected facts. Future search
and scoring code must consume this view instead of querying fact tables directly.

## ADR-012: M1 import is deterministic and does not retain source text

The import contract identifies its provider as `deterministic_labeled_text_stub`, version
`stub-v1`, with `aiUsed: false`. It copies only four exact labeled fields and infers
nothing else. The API keeps a SHA-256 content hash and source metadata, but not the raw
pasted/file text. File content is parsed in memory, accepts only plain text or Markdown,
has a 512 KiB limit, rejects path-like file names, and never constructs a filesystem path.

## ADR-013: manual edits become confirmed user-input evidence

When a user changes imported basics or preferences in the browser, the draft creates or
reuses a `user_input` source, assigns that source to the changed fact, records a concise
manual-entry evidence note, and marks it confirmed. Untouched extracted values remain
pending until the explicit confirmation action creates another version.

## ADR-014: preference preview is shared, deterministic policy logic

`previewPreferences` lives in `packages/shared` and is used by both the API and the React
editor. It derives search terms, hard constraints, exclusions, and warnings only from the
validated preference contract; it does not inspect jobs or score them. A preview cannot
be ready while preferences are pending, required search inputs are missing, or work
authorization is unknown. This keeps the M1 browser preview and the future M2 search
boundary consistent without duplicating policy code.
