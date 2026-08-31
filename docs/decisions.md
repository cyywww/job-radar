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

## ADR-015: connectors are transport adapters with one normalized boundary

`@job-radar/connectors` owns source HTTP behavior and parsing. A connector health-checks,
discovers summaries, fetches complete details, and returns `NormalizedJob`; it never reads
Profile tables or writes SQLite. The API scan coordinator supplies confirmed-role queries,
cancellation, and retry accounting, while `JobRepository` owns identity and persistence.
This keeps later ATS adapters reusable without copying orchestration or privacy policy.

## ADR-016: complete raw details back immutable, content-addressed snapshots

Every successful detail normalization includes the complete parsed source response. The
repository stable-sorts and SHA-256 hashes that response, stores it locally in
`job_snapshots.raw_json`, and appends only when the hash is new for the job. Normal APIs do
not expose the raw object. This balances source auditability, full-JD retention, and repeat
scan idempotency without putting descriptions in logs.

## ADR-017: disappearance requires a complete discovery set

A connector explicitly reports whether pagination exhausted every configured query.
Only a complete result set can increment source-link misses; the third consecutive miss
closes the link. Failed, cancelled, or page-capped scans cannot close jobs by absence.
Deadlines and explicit upstream removal remain immediate closure signals. This prevents a
rate limit or result cap from silently turning active jobs into false closures.

## ADR-018: scans run in-process but persist every state transition

M2 uses one process-local coordinator and one active scan rather than introducing the M5
scheduler/queue infrastructure early. POST returns a durable queued run, background work
updates SQLite, and graceful Fastify shutdown aborts and awaits it before closing the
database. Connector and per-detail errors become terminal run data rather than unhandled
process errors.

## ADR-019: the first JobTech query uses confirmed roles only

JobTech free-text searches are built only from confirmed target roles. Locations are not
concatenated into free text because that would produce unstable relevance and is not a
substitute for JobTech Taxonomy geographic IDs. Structured location mapping is deferred;
the stored job location and complete confirmed preferences remain available for that
adapter improvement and later deterministic Gates.

## ADR-020: public ATS configuration selects fixed official origins

Greenhouse, Lever, and Ashby sources accept a bounded board/site identifier and company
label rather than an arbitrary base URL. The server selects the official public JSON
origin (including Lever global/EU). This keeps the browser workflow simple and avoids
turning source testing into a general-purpose SSRF client. The current connectors use no
credentials, HTML scraping, login bypass, or CAPTCHA handling.

## ADR-021: one shared transport policy classifies connector failures

Every connector uses the same request gate, timeout, capped retries, bounded Retry-After,
User-Agent, cancellation, and safe JSON parsing. A durable error category is stored on the
source and SourceRun while the summary omits response bodies, headers, queries, Profile
data, and job descriptions. This makes UI errors actionable without source-specific
logging behavior or privacy drift.

## ADR-022: source deletion preserves collection provenance

`DELETE /api/sources/:id` sets `deleted_at` and disables the source. Normal configuration
queries hide deleted rows, but SourceRuns, JobSources, snapshots, and historical scan
views remain valid. The active source name uniqueness constraint is partial so a deleted
configuration can later be recreated deliberately.

## ADR-023: ATS fields stay on source records and raw snapshots

`NormalizedJob` has a source-metadata boundary in addition to the complete raw detail.
JobSource stores the bounded ATS metadata JSON while JobSnapshot stores the full parsed
detail wrapper. Core Job fields remain source-neutral. Normal job APIs expose only that
source metadata and the raw response were stored, never the raw objects themselves.

## ADR-024: cross-source matching starts with exact complete-content evidence

A new source link can merge with an existing Job only when normalized company, title,
location, and complete plain-text description all match. Per-source identity remains
`(source_id, source_job_id)`, and canonical keys are source-scoped. This is intentionally
more conservative than fuzzy title matching; broader similarity matching requires a
separate reviewed policy and eval set.

## ADR-025: source metrics are derived from durable runs

The Sources API computes aggregate successes, failures, retries, and job counters from
SourceRun rows and returns the latest SourceRun alongside Source health. No parallel
in-memory metrics store is introduced. Metrics therefore remain consistent with audit
history and survive restarts at local scale.
