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
This keeps source adapters reusable without copying orchestration or privacy policy.

## ADR-016: material normalized content identifies source-specific snapshots

Every successful detail normalization includes the complete parsed source response. The
repository SHA-256 hashes the normalized company, title, location, deadline, and complete
description, stores the raw response locally in `job_snapshots.raw_json`, and appends only
when that material hash is new for the job and source. Transport-only raw-response changes
therefore do not create false history. Normal APIs do not expose the raw object. This
balances source auditability, full-JD retention, and repeat-scan idempotency without
putting descriptions in logs.

## ADR-017: disappearance requires a complete discovery set

A connector explicitly reports whether pagination exhausted every configured query.
Only a complete result set with no detail failures can increment source-link misses; the
third consecutive miss closes the link. Failed, cancelled, page-capped, or detail-partial
scans cannot close jobs by absence.
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

## ADR-020: Swedish coverage uses one broad source and selected company pages

JobTech / Platsbanken is the only automatic broad-market source and always applies the
official Data/IT occupation field. A user may add one-page company career sources when
they provide useful supplemental coverage. Those sources start paused and accept only
schema.org `JobPosting` JSON-LD. Platform-specific adapters are intentionally absent so
the application does not accumulate configuration, fixtures, and UI branches for sources
that do not materially improve this user's Swedish search.

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

## ADR-023: source-specific fields stay on source records and raw snapshots

`NormalizedJob` has a source-metadata boundary in addition to the complete raw detail.
JobSource stores bounded source metadata JSON while JobSnapshot stores the full parsed
detail wrapper. Core Job fields remain source-neutral. Normal job APIs expose only that
source metadata and the raw response were stored, never the raw objects themselves.

## ADR-024: cross-source matching uses ordered exact evidence

Per-source identity remains `(source_id, source_job_id)`. Cross-source matching then tries
canonical URL, normalized company/title/location plus complete-description fingerprint,
and unique company/title/location/publication day. A rule applies only to one candidate;
ambiguity keeps jobs separate. This is intentionally more conservative than fuzzy title
matching, which requires a separate reviewed policy and eval set.

## ADR-025: source metrics are derived from durable runs

The Sources API computes aggregate successes, failures, retries, and job counters from
SourceRun rows and returns the latest SourceRun alongside Source health. No parallel
in-memory metrics store is introduced. Metrics therefore remain consistent with audit
history and survive restarts at local scale.

## ADR-026: source support is an exact two-type contract

The shared contract accepts only `jobtech` and `generic_web`. JobTech is supported and
enabled by default. Generic web represents a selected one-page company career source; it
is limited, explicitly configured, and paused by default. Unknown source types fail
validation rather than falling through to a compatibility path. The browser explains
these two levels directly and has no catalog of unavailable platforms.

## ADR-027: user-configured web URLs are resolved and pinned before fetching

Generic web requires HTTPS on port 443 without credentials. Literal and DNS-resolved IPs
are checked against loopback, private, link-local, reserved, multicast, documentation/test,
and metadata ranges for IPv4 and IPv6. All returned DNS addresses must be public, and the
request transport pins one validated address so a second lookup cannot rebind the host.
Redirects are followed manually and revalidated at every hop. Size, redirect-count, and
HTML content-type limits bound the response. No JavaScript, selector scraping, login,
CAPTCHA, or access-control bypass is implemented.

## ADR-028: cross-source identity is deterministic, unique, and explainable

The matcher uses ordered evidence: same-source external ID, canonical URL, exact normalized
description fingerprint together with company/title/location, then a unique normalized
company/title/location/publication-day identity. A rule applies only when it has exactly
one candidate; ambiguous candidates remain separate. Each JobSource stores the chosen
strategy and evidence, and each cross-source merge appends a merge event. Fuzzy similarity
and AI-assisted identity remain deferred until there is an explicit eval-backed policy.

URL normalization removes credentials, fragments, default ports, and known tracking
parameters, normalizes host/path, and sorts retained query parameters. Normalized full
descriptions use a SHA-256 fingerprint. A controlled reprocessor can apply newer
normalization to old Jobs and merge only disjoint-source candidates while retaining the
same number of immutable snapshots.

## ADR-029: job state is the aggregate of source-link state

Snapshots and misses are source-specific. Material description, location, deadline, title,
or company changes append a snapshot with explicit changed fields. Only a complete source
result with no detail failures can advance misses; failed, cancelled, capped, or
detail-partial runs cannot. One or two misses make an otherwise-open Job
`possibly_closed`; the third closes that link. A Job closes only when every attached source
link is closed, and any later observation resets the link misses and reopens the aggregate
Job. This prevents one source failure or delisting from overriding another source that
still observes the posting.

## ADR-030: configuration versions and a database guard make reruns reproducible

Material source edits increment `config_version`, and each SourceRun captures the version
used at queue time. A source-specific rerun creates a normal durable ScanRun against the
current version, preserving prior run history. A partial unique SQLite index and
transactional preflight enforce one queued/running scan across simultaneous requests, and
job reprocessing refuses to start while a scan is active. This keeps retries and browser
double-clicks from creating overlapping mutation tasks without introducing an external
queue before its owning phase.

## ADR-031: bounded detail concurrency preserves deterministic source ordering

A scan processes enabled sources in their stable configured order while each connector
fetches details with its own bounded concurrency. This deliberately narrows the plan's
parallel-connector sketch: source-order persistence makes canonical-source selection and
merge explanations repeatable, bounds aggregate upstream load, and avoids competing local
SQLite mutation streams. The durable active-scan guard prevents overlapping scans; wider
parallelism can be reconsidered with the later scheduler/queue and an explicit
deterministic commit stage.

## ADR-032: source contraction resets reproducible collection state

The Sweden-first migration upgrades valid JobTech configuration in place. If any removed
source type exists, it clears job/source run state, snapshots, links, jobs, and merge
events before deleting unsupported sources. Keeping partial history would require dead
configuration contracts and could leave misleading provenance. Collection data can be
scanned again; immutable candidate Profile/version history is unrelated and remains
untouched.

## ADR-033: AI extraction cannot make eligibility or score decisions

The strict model output is limited to job requirements, evidence proposals, gaps,
unknowns, fit labels, and confidence. A separate audit verifies the current snapshot and
confirmed Profile evidence IDs. Code then runs the eligibility Gate and versioned scoring
algorithm. Strict Zod objects reject additional Gate or score properties, so a posting's
prompt-like text or a model response cannot change policy, weights, versions, or final
scores. This keeps model variability outside the decisive boundary.

## ADR-034: M3 has one hardened Codex CLI provider

`AIProvider` currently has exactly one implementation and provider ID: `codex_cli`. The
non-interactive process runs in a new temporary working directory with ephemeral state,
read-only sandboxing, Schema-constrained output, integrations disabled, no shell, bounded
time/output, cancellation, a minimal environment with a temporary isolated `HOME`, and
cleanup. Only minimized confirmed
evidence plus the current snapshot text are supplied. An unneeded OpenAI API provider,
placeholder, or fallback would expand secret handling and untested behavior, so none is
present.

## ADR-035: eligibility failures are not low scores

The deterministic Gate evaluates closure, confirmed exclusions, authorization,
citizenship/sponsorship, location/work mode, required language, and security clearance
before scoring. Explicit contradiction makes the job ineligible; missing facts are
unknown rather than failure. Ineligible records retain extraction and human/machine Gate
reasons but database constraints require all numeric scores and breakdowns to be null.
This preserves the semantic difference between “cannot qualify” and “weak match.”

## ADR-036: match and ranking use separate versioned calculations

`deterministic-weighted-v1` owns the immutable 30/20/15/15/8/7/5 weights, ratio mappings,
neutral values, rounding, and bounds. `matchScore` contains only evidence/fit dimensions
and is independent of publication time. `rankingScore` adds recorded-as-of freshness and
confirmed target-company boost, then subtracts capped extraction/Gate uncertainty. Saving
all versions and `rankingAsOf` makes identical inputs reproducible while allowing later
ranking policy to change without rewriting historical match quality.

## ADR-037: scoring history is append-only and work is explicitly bounded

SQLite gives each task a unique job/snapshot/Profile/extractor/scoring identity and each
attempt a unique monotonically increasing number. Transactional claim prevents concurrent
execution; startup converts interrupted running attempts into safe durable failures.
Automatic retries use capped exponential backoff and a finite budget. Explicit retry,
rescore, or backfill grants another finite window without deleting attempts, requirements,
or scores. Snapshot, Profile, extractor, scoring, and lifecycle changes invalidate current
results and enqueue the matching identity. M3 exposes a bounded process endpoint instead
of introducing the M5 scheduler or resident worker early.

## ADR-038: triage is sparse state with transactional exact undo

Missing `job_triage` means `new`, so upgrading does not manufacture one row per historical
job. Single updates return the prior value and skip a same-state write. Bulk updates first
validate every job and then commit one transaction; exact undo submits the returned prior
records through another all-or-nothing transaction, preserving the prior timestamp or
deleting the row when the prior state was implicit `new`. Jobs, snapshots, scores,
sources, and provenance are never deleted by triage.

## ADR-039: one server read model owns review filtering and ordering

The review list uses one bounded SQL read model with current score/task windowing,
triage-default projection, source aggregation, and extracted-skill search. Enum-backed
sort fields map to a fixed column whitelist; text and filter values stay bound parameters.
The payload contains summaries only, while full descriptions and histories require the
detail endpoint. Saved filters use a versioned browser-local Zod contract rather than a
single-user server subsystem.

“Today” starts at local midnight in the API process. The centralized strong-match display
threshold is 80; it classifies current eligible scores for Dashboard only and cannot alter
`matchScore`, `scoringVersion`, or ranking.

## ADR-040: human review and correction are separate from formal scores

Review decisions append immutable events with a required explanation and may change only
the formal record's review-state field. Correction feedback is a separate append-only row
with server-captured original score, optional human suggestion, type, and reason. Neither
path rewrites Gate, match/ranking, breakdown, versions, evidence, Profile facts, or
weights, and neither automatically triggers a policy or Profile change.

## ADR-041: explicit scan SSE is a projection of durable state

The SSE endpoint immediately sends the current database-backed ScanRun, then polls for
changed stages/counts and stops at a terminal status. Discovery, detail, bounded persist
batches, and lifecycle updates persist source counts and aggregate ScanRun counts, so a
reconnect recovers current progress from the database instead of replaying volatile
process events. Connection-close handlers clear the unreferenced timer. Events contain
only bounded run/source status and safe error metadata, never descriptions, Profiles,
headers, tokens, prompts, or raw responses. This does not introduce the M5 scheduler or
resident process.

## ADR-042: network refresh and historical reprocessing are distinct operations

Job refresh creates an explicit one-source ScanRun and refetches the selected current
source identity. Source rerun scans one source under its current configuration version.
Historical reprocessing only reapplies deterministic local identity/normalization to
stored data. Keeping separate routes, labels, and coordinator methods prevents a local
reprocess from being presented as fresh upstream confirmation.

## ADR-043: the M4 browser uses native React and safe semantic rendering

The Dashboard, review list, cards, detail sidebar, filters, dialogs/forms, live regions,
and responsive layouts use the existing React/CSS stack without a table, state, or UI
framework. The complete posting is rendered only as text in `pre`; source HTML, raw
metadata, model output, and prompts never enter an executable DOM path. External links
are emitted only for HTTP(S) URLs and use isolated browsing attributes. Buttons, inputs,
tables, progress elements, headings, focus transfer, and non-color labels provide the
keyboard and screen-reader baseline.

## ADR-044: run failure visibility uses persisted bounded stages

ScanRuns and SourceRuns store their current stage; failed or partial SourceRuns also store
the stage that failed alongside the existing sanitized error category and retry count.
Existing terminal runs migrate to `complete`. Sources/Runs can therefore explain health,
configuration state, work counts, retries, and failure location after a refresh or restart
without retaining response bodies or creating an operational scheduler.

## ADR-045: manual scoring requires an explicit model and auditable token usage

Job Radar may start, scan, and review without AI configuration, but it cannot claim a
scoring task until the user sets an exact Codex model. Each call requires Codex JSONL usage
before accepting extracted output. New append-only attempts store actual
input/cached/output/reasoning counts; cached and reasoning subsets are not double-counted
in the displayed total. The browser processes one attempt per explicit click. This adapts
the bounded manual-run lesson from `job-scan` without adding its scheduler or pretending
Codex has an unsupported hard USD/output-token flag.

## ADR-046: Profile onboarding emphasizes minimum useful input

The browser presents Profile editing with one minimal **Quick setup** area: one target role
is required, target locations are optional, and core skills are recommended. All
eligibility, language, experience, preference, and supporting-evidence fields share one
native disclosure. Deterministic import and version/provenance history share a second.
Routine editing no longer asks the user to choose internal evidence sources or
confirmation states; direct input is confirmed with the local manual source and imported
facts retain the existing explicit confirmation action.

This adopts the useful short-profile and separate-preferences lesson from `job-scan`
without copying its scheduler or AI workflow. The full shared Profile schema, immutable
versions, stored provenance, completeness calculation, and confirmed-only M2/M3 boundary
remain unchanged, so the simpler UI does not discard existing data or weaken scoring
evidence rules.
