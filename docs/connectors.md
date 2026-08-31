# Connector operations and extension contract

## One JobTech scan

```text
POST /api/scans
  → read ConfirmedProfileView.preferences.targetRoles
  → create ScanRun + queued SourceRun
  → JobTech health request
  → paginate /search for each confirmed role
  → deduplicate JobTech IDs across queries
  → fetch /ad/{id} with bounded concurrency
  → normalize complete detail fields
  → upsert Job + JobSource
  → hash and append JobSnapshot when detail changed
  → apply deadline/missing lifecycle only after safe discovery
  → finish SourceRun and aggregate ScanRun
  → GET /api/jobs and GET /api/jobs/:id
```

`POST /api/scans` returns HTTP 202 with the durable queued run. The browser polls the run
list; it does not keep an external request open for the duration of the scan. Only one
scan runs in this local API process. `POST /api/scans/:id/cancel` aborts rate-limit waits,
network requests, pagination, and detail workers through the same `AbortSignal`.

## Completeness and lifecycle

`DiscoveryResult.complete` is a safety signal, not a convenience field. It is `false`
when a connector reaches its configured page cap before exhausting a query. Failed,
cancelled, and incomplete discoveries do not prove a job disappeared, so they never
increase `JobSource.consecutiveMisses`.

After a complete successful/partial discovery:

- a seen source ID resets misses to zero;
- an unseen active source ID increments misses;
- the third consecutive miss disables that source link;
- a job closes when it has no active source links or its deadline elapsed;
- a later valid sighting can reopen a missing-closed job if its deadline is still future.

Partial means discovery succeeded but one or more detail requests failed. Discovered IDs
still count as seen, preventing a transient detail failure from becoming a false missing
event.

## Error and privacy boundary

Connectors may retain complete raw detail responses only through `NormalizedJob.rawData`.
The repository writes them to local SQLite. They are never logged or returned by the
normal list/detail API; the API exposes only `rawResponseStored: true` and the snapshot
hash. Unknown thrown errors become a generic summary. Known HTTP errors contain only the
source name/status, never response bodies, queries, descriptions, authorization headers,
or candidate data.

## Adding an ATS connector

Implement `JobConnector` in `packages/connectors`, inject transport/time dependencies for
deterministic tests, and keep source-specific schemas beside the adapter. The adapter owns
HTTP semantics and source parsing; the scan coordinator owns isolation and counters; the
database repository owns identity, snapshots, and lifecycle.

Before enabling the source:

- add its strict `SourceConfig` union variant and default/user-created source policy;
- document which endpoint is discovery and which yields the complete JD;
- define a stable `externalId` and canonical source URL;
- map title, company, location, published/deadline timestamps, full description, work
  mode, and employment type without invention;
- report discovery completeness correctly;
- honour cancellation, timeout, retries, rate, and concurrency;
- provide fixed fictional fixtures and failure/cancellation/idempotency tests;
- add a reviewed cross-source matcher instead of collapsing jobs on title alone.

Do not put database writes, Profile reads, scoring, or logging inside a connector.
