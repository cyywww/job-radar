# Implementation status — 2026-10-14

## Active scope

The old local-first Profile, SQLite, Fastify, scoring, and review product was retired by user direction. The working tree now contains a single public data flow: `apps/ingest` → `packages/shared` → `apps/web`, plus CloudFormation and a manual deployment script. No personal candidate data is collected or published.

## Implemented locally

- JobTech Search collector with four broad queries and two northern region searches, one page/query, Data/IT occupation field, regional scope, security-title exclusion, Zod parsing, duplicate removal, retry on 429/5xx, and fail-closed empty result.
- Public feed contains only its version, generation time, and display-ready jobs: title, company, location, publication date, original HTTPS URL, and structured required-language labels. Full descriptions and raw responses are discarded. Unused collection counters, source label, and deadline were removed from the published contract.
- Lambda writes one validated `data/latest.json` object to S3. Errors leave the previous version untouched and logs contain only status/count/time.
- Static React view with jobs and filters visible immediately, original links, freshness, a concise sample caveat, and empty/error states. The promotional hero, architecture card, extra metrics, and engineering explainer were removed from the product UI; implementation details remain in the repository documentation.
- AWS CloudFormation: Stockholm site stack with private versioned S3, CloudFront OAC/security headers, daily Scheduler, Lambda ARM64, least-privilege publish role, and 14-day logs; separate `us-east-1` stack for a $5 monthly account-level budget notification.
- Read-only CI workflow, local tests, and deployment script.
- Workspace cleanup removed the unused shared-package build and barrel file, redundant web test configuration, obsolete SQLite build approval, unused coverage and lint dependencies, stale config entries, and an unused CloudFormation output. The three functional workspaces remain.

## Verified

- Frozen-lockfile pnpm install, lint, typecheck, all 11 current tests, build, format check, shell syntax, and `git diff --check` passed locally. The shared package was checked and built from source without its former generated `dist` directory.
- Both CloudFormation templates passed `cfn-lint` for their target regions. AWS's own online `validate-template` could not run because this workspace has no configured AWS credentials.
- Read-only JobTech Search checks returned HTTP 200 on 2026-10-14. The final six-query collector produced 138 scoped jobs from 327 sampled hits (Stockholm 112, Norrbotten 14, Västerbotten 5, Uppsala 5, Södermanland 2). Only aggregate counts and metadata keys were printed; no job body was stored.
- Production static preview ran on `127.0.0.1:4173` with a temporary fictional feed. The simplified layout was reviewed at 1280px and 390px; jobs and filters appeared immediately, and neither viewport had horizontal overflow. The preview was stopped and its fictional feed removed.
- After the structure cleanup, the production preview served its index over loopback with HTTP 200 and was stopped. The leaner feed passed producer, publication-boundary, and browser contract tests.
- Tests use fictional records and mocked network only.

## Pending before calling this publicly deployed

1. AWS account/region/credential review and explicit user approval for resource creation, Git push, and public publication.
2. Deploy the budget stack in `us-east-1` and the site stack in `eu-north-1`; invoke initial collection and verify `latest.json` through CloudFront, logs, budget email, and desktop/mobile page.
3. Update the public GitHub repository (it currently shows the old implementation), add the live URL to CV/LinkedIn, and rehearse the project explanation.

No commit, push, tag, cloud resource, or public site has been created in this task.

## Local data check

During scope removal, the old ignored `data/` directory was removed along with its tracked placeholder. The user confirmed the old database held no real data and no recovery is needed. `.env.local` itself was not changed; its stale SQLite path is unused by the new architecture.
