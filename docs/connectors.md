# Connector operations and extension contract

## Supported public sources

| Source     | Discovery                                          | Complete detail                                                  | Pagination                                               | Known limits                                                                                                                                                                  |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JobTech    | `GET /search` for confirmed Profile roles          | `GET /ad/{id}`                                                   | `offset` / `limit`                                       | Free-text role search only; structured taxonomy/location filtering remains deferred.                                                                                          |
| Greenhouse | `GET /v1/boards/{board_token}/jobs`                | `GET /v1/boards/{board_token}/jobs/{job_id}`                     | None; the documented endpoint returns the complete board | Company falls back to configured company name; employment type is not exposed. HTML entities are decoded before safe-text rendering.                                          |
| Lever      | `GET /v0/postings/{site}?mode=json&skip=X&limit=Y` | `GET /v0/postings/{site}/{posting_id}?mode=json`                 | Documented `skip` / `limit`                              | Global and EU API regions are supported. Company name is configured because postings do not expose it. Application deadline is not exposed.                                   |
| Ashby      | `GET /posting-api/job-board/{board_name}`          | The board response already contains full plain/HTML descriptions | None; the documented endpoint returns the complete board | Unlisted postings are excluded. Company name is configured. The public response does not expose an application deadline; the stable external ID is the final job URL segment. |

These are unauthenticated, documented JSON endpoints. Source creation selects only the
fixed official origin for its type; arbitrary base URLs are not accepted. The connectors
do not submit applications, access internal postings, bypass login/CAPTCHA, or fall back
to HTML scraping.

## Scan flow

```text
POST /api/scans
  → read ConfirmedProfileView.preferences.targetRoles
  → create ScanRun plus one queued SourceRun per enabled source
  → execute each source behind an isolation boundary
  → health-check the configured public board
  → discover the complete safe result set
  → fetch/obtain every complete posting detail with bounded concurrency
  → normalize into NormalizedJob
  → upsert Job + source-specific JobSource metadata
  → append an immutable raw JobSnapshot when source content changes
  → apply deadline/missing lifecycle only after safe discovery
  → finish each SourceRun and aggregate ScanRun
```

`POST /api/scans` returns HTTP 202 with the durable queued run. The browser polls the run
list. Only one scan runs in the local API process. Cancellation aborts rate-limit waits,
network requests, pagination, and detail workers through the same `AbortSignal`.

A connector failure becomes a failed SourceRun and does not escape the coordinator; later
sources still execute. A detail failure becomes a partial SourceRun and does not discard
sibling jobs. The aggregate ScanRun is `partial` when at least one source produced useful
results and another source or detail failed.

## Request reliability and error classes

All four connectors use the same transport implementation:

- per-source request start pacing;
- per-request timeout;
- capped exponential retry for 408, 425, 429, 5xx, and transport errors;
- bounded `Retry-After` support;
- explicit User-Agent and JSON Accept header;
- abortable waits and in-flight requests;
- bounded detail concurrency;
- typed JSON parsing before normalization.

Durable safe error categories are `rate_limited`, `timeout`, `transport`, `http_client`,
`http_server`, `invalid_response`, `not_found`, `configuration`, `partial_detail`,
`cancelled`, `connector_unavailable`, and `unexpected`. Errors include only the connector
label and status/classification. Response bodies, headers, query content, Profile data,
job descriptions, cookies, tokens, and credentials are not placed in errors or logs.

## Source management and observability

```text
GET    /api/sources
POST   /api/sources
PATCH  /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/:id/test
```

Creation and update payloads are shared strict Zod contracts. A test connection does not
require a Profile and does not create a ScanRun; it updates health, last success/error, and
reports test retry count. Pause/enable changes only future scans. Delete is a soft delete:
the source disappears from configuration and future scans while historical SourceRuns,
JobSources, snapshots, and provenance remain intact.

`GET /api/sources` includes aggregate run/retry/job counters and the latest SourceRun.
Metrics are derived from durable SourceRuns, not an in-memory counter, so they survive a
service restart.

## Identity, metadata, and lifecycle

The primary idempotency key is `(source_id, source_job_id)`. A repeat scan of the same
posting updates `last_seen_at` and creates no duplicate Job or snapshot when raw content is
unchanged. Source-specific IDs, URLs, and ATS-only fields are stored on JobSource metadata
or in the local raw snapshot; they are not added to the core Job model or returned as raw
objects by normal APIs.

Cross-source merging is deliberately conservative. A new source link joins an existing
Job only when normalized company, title, location, and the complete plain-text description
all match exactly after basic case/whitespace normalization. A title alone is never proof
of identity. Less exact fuzzy matching remains deferred.

`DiscoveryResult.complete` is a safety signal. Only complete discovery can increment
missing counters. Failed, cancelled, or page-capped scans cannot close jobs by absence.
After a complete run, a seen source ID resets misses, an unseen active link increments
misses, and the configured threshold (default three) disables the link. A successful
detail fetch also disables its source link when the posting is explicitly inactive or its
deadline has elapsed. A merged Job closes only when it has no active source link, so one
closed source cannot hide a posting that remains live elsewhere.

## Adding another connector

Implement `JobConnector` in `packages/connectors`, inject transport/time dependencies for
deterministic tests, and keep source schemas beside the adapter. Before enabling it:

1. add a strict discriminated `SourceConfig` variant and fixed-origin creation policy;
2. document discovery, complete-detail, pagination, external-ID, and URL semantics;
3. populate every `NormalizedJob` field without inventing missing values;
4. keep ATS fields in `sourceMetadata`/`rawData` rather than the core Job;
5. use the shared HTTP reliability layer and safe errors;
6. use `exerciseConnectorContract` plus fictional success, empty, paging/full-board,
   rate/failure, cancellation, partial failure, and idempotency fixtures;
7. review cross-source matching explicitly before enablement.

Connectors never read Profile tables, write SQLite, score jobs, or log responses.
