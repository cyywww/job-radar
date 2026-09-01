# Sweden-first collection

Job Radar intentionally has two source types.

| Source                     | Role                           | Scope                                                                                                   |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| JobTech / Platsbanken      | Primary, enabled automatically | Official Swedish JobSearch API, Data/IT occupation field, one query per confirmed role, complete detail |
| Target company career page | Optional, paused until enabled | One public HTTPS page containing schema.org `JobPosting` JSON-LD                                        |

There are no platform-specific ATS adapters. A target company page is supplemental rather
than a second broad job market.

## JobTech search policy

JobTech queries use the official Data/IT occupation-field concept
`apaJ_2ja_LuF`. Every confirmed target role is sent as its own `q` query; unrelated role
keywords are never concatenated into one phrase. Discovery uses pages of 100 and at most
20 pages per role, respecting JobSearch's 2,000-result window.

Complete `/ad/{id}` responses remain the normalization boundary. In addition to the core
job fields, source metadata retains the structured occupation-group label, municipality
code/concept ID, and employer-declared must-have languages when present. These fields are
for later deterministic filters; connectors never inspect unconfirmed Profile facts.

## Target-company page safety

The optional page connector accepts one explicitly configured HTTPS URL on port 443 with
no embedded credentials. Before connecting, it rejects loopback, private, link-local,
reserved, multicast, documentation/test, `.local`/`.internal`, and cloud-metadata names or
addresses for IPv4, IPv6, and IPv4-mapped IPv6.

DNS must resolve and every answer must be public. The validated address is pinned into the
request transport to prevent DNS rebinding. Redirects are manual, limited to three, and
fully revalidated. Responses must be HTML and at most 2 MiB. Only valid schema.org
`JobPosting` JSON-LD is accepted; there is no crawling, selector scraping, JavaScript,
login, CAPTCHA, or access-control bypass.

## Scan and lifecycle flow

```text
confirmed Profile roles
  → JobTech health and paginated discovery
  → optional enabled target pages
  → bounded concurrent detail fetch
  → normalize
  → deterministic identity match
  → source link + immutable material snapshot
  → safe missing/deadline lifecycle
  → explicit scoring synchronization
  → durable source and aggregate run results
```

Only one queued/running scan may exist. Sources run in stable order and each source bounds
its own detail concurrency. A source or detail failure is isolated and stored as safe run
metadata without logging response bodies, descriptions, Profile data, headers, cookies,
or credentials.

Identity rules are ordered and require a unique candidate:

1. same-source external ID;
2. canonical URL;
3. company, title, location, and full-description fingerprint;
4. company, title, location, and publication day.

Ambiguous candidates stay separate. Each source link stores its strategy and evidence;
cross-source merges append an audit event. Material company, title, location, deadline, or
description changes create a source-specific immutable snapshot.

Only complete discovery with no detail failures may advance missing counters. One or two
misses produce `possibly_closed`; the third closes that source link. A job closes only
when all links are closed. A later sighting resets misses and reopens the link and job.

Each explicit scan persists both aggregate and per-source stage: `queued`, `health`,
`discovery`, `detail`, `persist`, `lifecycle`, `scoring`, or `complete`. Failed and partial
SourceRuns also retain a bounded error category and the stage that failed. The browser
reconstructs current progress from these rows; it does not depend on an in-memory event
history.

## Source operations

```text
GET    /api/sources
POST   /api/sources                 target-company page only
PATCH  /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/:id/test
POST   /api/sources/:id/rerun
POST   /api/jobs/:id/refresh
GET    /api/scans/:id/events
```

Target pages start paused. Configuration changes increment `config_version`; each source
run records the version it used. Soft deletion keeps existing provenance auditable.

A source rerun creates a normal explicit scan for that source. Job refresh instead fetches
the selected job's current canonical source identity and persists any new material
snapshot; it is deliberately distinct from deterministic historical job reprocessing.
The SSE endpoint sends the current persisted scan immediately, then changed stage/count/
terminal snapshots only. It cleans up on disconnect and stops at a terminal status. It
contains no descriptions, Profile data, request headers, tokens, or raw responses.

## Adding another source later

Adding a broad platform adapter is not a routine extension. It requires an explicit
product decision that the new source materially improves Swedish coverage beyond JobTech
and selected company pages. If approved, it must use a stable public contract, strict Zod
boundaries, safe errors, complete details, deterministic fictional fixtures, bounded
retry/concurrency, and reviewed lifecycle semantics.
