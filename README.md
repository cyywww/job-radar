# Job Radar

A public, read-only showcase of Swedish software roles. A small TypeScript collector samples the official JobTech Search API, validates and narrows the data, and publishes one JSON feed. A static React site serves the feed through CloudFront. No accounts, candidate profiles, AI scoring, or database are involved.

When published, the page will show a **bounded sample**, not a complete job board. It links to each original advertisement. A missing structured language field does not mean Swedish is unnecessary.

## Architecture

```text
EventBridge Scheduler → Node.js Lambda → private, versioned S3 JSON
                                            ↓
Vite/React static assets → private S3 → CloudFront HTTPS → browser
```

The code lives in three pnpm workspaces:

- `packages/shared`: Zod contract for the public feed.
- `apps/ingest`: bounded JobTech collection and Lambda publisher.
- `apps/web`: static React page with search, region filter, source links, and stale/error states.

`infra/template.yaml` defines the site in Stockholm; `infra/budget.yaml` defines the account budget in `us-east-1`, the region supported by AWS Budgets CloudFormation. `scripts/deploy.sh` is an explicit manual deployment command. The former local Fastify/SQLite/Profile/scoring app was retired; see Git history for its implementation.

## Local development

Requires Node.js 22.12+ and pnpm 11.19.0.

```bash
pnpm install
pnpm dev
```

The page opens at `http://127.0.0.1:5173`. Without a published `/data/latest.json`, it shows the expected empty/error state. No live source request runs during `pnpm dev` or tests.

```bash
pnpm check
pnpm format:check
pnpm build
pnpm start
```

`pnpm start` previews the static build at `http://127.0.0.1:4173` on loopback.

## AWS deployment

The reviewed infrastructure uses `eu-north-1`, Lambda ARM64 with 256 MB memory, EventBridge Scheduler, a private versioned S3 bucket, CloudFront Origin Access Control, 14-day log retention, and an account-level $5 monthly budget alert. It uses the CloudFront default domain, so a domain purchase is unnecessary.

Before deployment, create a private S3 artifact bucket in `eu-north-1`, use AWS credentials with CloudFormation/IAM/Lambda/S3/CloudFront/Scheduler/Budgets access, and choose an email for the budget notice. Then run:

```bash
AWS_REGION=eu-north-1 scripts/deploy.sh <artifact-bucket-name> <budget-email>
```

This command **creates cloud resources and publishes a public site**. In this project conversation, it must not be run until the user explicitly authorizes that action. See [operations](docs/operations.md) for checks, rollback, cleanup, and cost caveats.

## Why this scope

A scheduled read-only data product is enough to demonstrate API integration, TypeScript, validation, failure handling, least-privilege IAM, infrastructure as code, CI, and cloud delivery. The detailed [implementation plan](Job%20Radar%20implementation%20plan.md) explains market evidence and limitations. [Status](docs/implementation-status.md) and [testing](docs/testing.md) record what has actually been verified.
