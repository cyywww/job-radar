# Connector operations and extension contract

## Reviewed support matrix

| Source             | Level         | Implemented contract                                                              | Deliberate boundary                                                                                                                                                      |
| ------------------ | ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JobTech            | Supported     | Official JobSearch `GET /search` plus `GET /ad/{id}`; `offset`/`limit` paging     | Confirmed-role free text only; taxonomy/location mapping remains deferred.                                                                                               |
| Greenhouse         | Supported     | Official unauthenticated Job Board list and detail JSON                           | Complete-board list is not paginated; company can use the configured label; employment type is unavailable.                                                              |
| Lever              | Supported     | Official global/EU Postings list and detail JSON; `skip`/`limit` paging           | Company is configured; no public application deadline.                                                                                                                   |
| Ashby              | Supported     | Official complete public job-board JSON with embedded detail                      | Unlisted postings are excluded; company is configured; no public deadline.                                                                                               |
| Teamtailor         | Limited       | Official regional JSON:API `/v1/jobs` list/detail with locations                  | Requires a company-admin-issued Public Read API token. Only the environment-variable name is stored; sources start paused.                                               |
| Workday            | Not supported | No connector is exposed                                                           | Official external career sites vary by tenant, while documented web-service reports require customer configuration; there is no reviewed universal public jobs contract. |
| Jobylon            | Not supported | No connector is exposed                                                           | The official Feed API/link and identifiers are provisioned by Jobylon to a customer or integration partner rather than being a universal unauthenticated contract.       |
| SAP SuccessFactors | Not supported | No connector is exposed                                                           | Recruiting OData/Marketing APIs require tenant permissions or credentials and do not form a universal public connector.                                                  |
| Generic web        | Limited       | One explicitly configured public HTTPS page; schema.org `JobPosting` JSON-LD only | Disabled by default; no crawl, selectors, JS execution, login, CAPTCHA, or access-control bypass.                                                                        |

`GET /api/source-capabilities` is the machine-readable version of this matrix, and the
Sources workspace renders it even for non-configurable sources. A source is not called
supported merely because a tenant-specific endpoint can be reverse engineered.

Review references: [Teamtailor API](https://docs.teamtailor.com/),
[Teamtailor API-key guidance](https://support.teamtailor.com/en/articles/5963369-use-our-teamtailor-api),
[Workday external career sites](https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/career-sites/san1394588983205.html),
[Jobylon developer portal](https://developer.jobylon.com/api),
[Jobylon API support guidance](https://support.jobylon.com/en/articles/69898-jobylon-api),
and
[SAP SuccessFactors Recruiting API setup](https://help.sap.com/docs/successfactors-recruiting/recruiting-marketing-setup-and-integration-with-recruiting-management-configuration-guide/create-api).

Fixed-origin connectors accept only bounded identifiers. Teamtailor selects one of its
official EU, North American, or Asia-Pacific origins. The generic connector is the sole
URL-configurable source and is constrained by the safety policy below.

## Generic web safety policy

Before any request, the generic connector requires HTTPS, port 443, no embedded
credentials, and a syntactically valid hostname. It rejects loopback, private, link-local,
reserved, multicast, documentation/test, `.local`/`.internal`, and cloud metadata names or
addresses for IPv4, IPv6, and IPv4-mapped IPv6. DNS must resolve and every returned address
must be public. The validated address is pinned into the request transport to prevent a
second DNS lookup from rebinding to a private host.

Redirects are manual and the full policy is repeated at every hop, with a maximum of
three. The response must be HTML, may not exceed 2 MiB, and is parsed only for valid
schema.org `JobPosting` JSON-LD. A response body is never included in a stored/logged
error. These controls do not grant permission to fetch a site: source owners remain
responsible for its terms and access policy.

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
  → append an immutable source-specific JobSnapshot when material content changes
  → apply deadline/missing lifecycle only after safe discovery
  → finish each SourceRun and aggregate ScanRun
```

`POST /api/scans` returns HTTP 202 with the durable queued run. The browser polls the run
list. A partial unique database constraint plus a transactional preflight allows only one
queued/running scan, including concurrent API requests. Reprocessing is also refused while
a scan is active. Cancellation aborts rate-limit waits, network requests, pagination, and
detail workers through the same `AbortSignal`.

A connector failure becomes a failed SourceRun and does not escape the coordinator; later
sources still execute. A detail failure becomes a partial SourceRun and does not discard
sibling jobs. The aggregate ScanRun is `partial` when at least one source produced useful
results and another source or detail failed.

## Request reliability and error classes

The structured connectors use the shared JSON transport implementation:

- per-source request start pacing;
- per-request timeout;
- capped exponential retry for 408, 425, 429, 5xx, and transport errors;
- bounded `Retry-After` support;
- explicit User-Agent and JSON Accept header;
- abortable waits and in-flight requests;
- bounded detail concurrency;
- typed JSON parsing before normalization.

Durable safe error categories are `rate_limited`, `timeout`, `transport`, `http_client`,
`http_server`, `invalid_response`, `not_found`, `configuration`, `unsafe_url`,
`partial_detail`, `cancelled`, `connector_unavailable`, and `unexpected`. Errors include
only the connector label and status/classification. Response bodies, headers, query
content, Profile data, job descriptions, cookies, tokens, and credentials are not placed
in errors or logs.

## Source management and observability

```text
GET    /api/sources
GET    /api/source-capabilities
POST   /api/sources
PATCH  /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/:id/test
POST   /api/sources/:id/rerun
POST   /api/jobs/reprocess
```

Creation and update payloads are shared strict Zod contracts. A test connection does not
require a Profile and does not create a ScanRun; it updates health, last success/error, and
reports test retry count. Pause/enable changes only future scans. Every material source
configuration update increments `config_version`; each SourceRun records the exact version
it used. The source-specific rerun queues the current validated configuration and uses the
same active-scan guard. Delete is a soft delete: the source disappears from configuration
and future scans while historical SourceRuns, JobSources, snapshots, and provenance remain
intact.

`GET /api/sources` includes aggregate run/retry/job counters and the latest SourceRun.
Metrics are derived from durable SourceRuns, not an in-memory counter, so they survive a
service restart.

## Identity, metadata, and lifecycle

Identity is deterministic and ordered:

1. `(source_id, source_job_id)` is authoritative for repeat observations within a source.
2. Otherwise a unique normalized canonical URL match joins the existing job. URL
   normalization lowercases the host, removes credentials/fragments/default ports,
   normalizes path slashes, sorts query parameters, and removes known tracking parameters.
3. Otherwise a unique exact company/title/location plus normalized full-description
   SHA-256 fingerprint match joins it.
4. Otherwise a unique normalized company/title/location/publication-day key joins it.
5. Zero or multiple matches create a separate job; ambiguity never triggers a merge.

Each JobSource records the selected strategy and its structured evidence, and every
cross-source merge appends a `job_merge_events` audit record. A title alone is never proof
of identity. Source-specific IDs, URLs, and ATS-only fields stay on JobSource metadata or
the local raw snapshot rather than the core Job.

Snapshots are unique per job, source, and material hash. Description, location, deadline,
title, or company changes append a new immutable snapshot with `changed_fields`; an
unchanged repeat updates observation timestamps only. `first_seen_at`, `last_seen_at`, and
`last_changed_at` therefore keep separate meanings.

`DiscoveryResult.complete` is a safety signal. Only complete discovery with no detail
failures can increment missing counters. Failed, cancelled, page-capped, or detail-partial
scans cannot close jobs by absence. After a complete successful run, a seen source ID
resets misses and reopens its source link; an unseen active link increments misses, and the
configured threshold (default three) closes the link. One or two misses surface as
`possibly_closed`. A successful detail fetch also
closes its source link when the posting is explicitly inactive or its deadline has
elapsed. A merged Job closes only when it has no active source link, so one failed or
closed source cannot hide a posting that remains live elsewhere. Reappearance clears the
misses, reactivates the link, and reopens the aggregate Job.

`POST /api/jobs/reprocess` recalculates canonical URLs and fingerprints and can merge only
deterministic, unambiguous, disjoint-source candidates. It moves source links, snapshots,
and merge audit records transactionally and verifies that the snapshot count is unchanged;
legacy snapshot payloads and hashes remain immutable. This makes normalization upgrades
repeatable without erasing change history.

## Adding another connector

Implement `JobConnector` in `packages/connectors`, inject transport/time dependencies for
deterministic tests, and keep source schemas beside the adapter. Before enabling it:

1. add a reviewed support level, strict discriminated `SourceConfig` variant, and a
   fixed-origin policy unless a separately reviewed URL safety model applies;
2. document discovery, complete-detail, pagination, external-ID, and URL semantics;
3. populate every `NormalizedJob` field without inventing missing values;
4. keep ATS fields in `sourceMetadata`/`rawData` rather than the core Job;
5. use the shared HTTP reliability layer and safe errors;
6. use `exerciseConnectorContract` plus fictional success, empty, paging/full-board,
   rate/failure, cancellation, partial failure, and idempotency fixtures;
7. review cross-source matching and complete-discovery semantics explicitly before
   enablement.

Connectors never read Profile tables, write SQLite, score jobs, or log responses.
