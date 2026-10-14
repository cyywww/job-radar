# Operations and deployment

The deployment command creates billable AWS resources and publishes a public page. Run it only after explicit approval and an account-level cost review. The default deployment region is `eu-north-1` (Stockholm). The site uses a CloudFront default domain.

## Prerequisites

- Node.js 22.12+, pnpm 11.19.0, AWS CLI v2, `zip`, and AWS credentials.
- Permissions for CloudFormation, IAM role creation, Lambda, S3, CloudFront, EventBridge Scheduler, CloudWatch Logs, and AWS Budgets.
- A **private** artifact S3 bucket in `eu-north-1` for Lambda zip files. This bucket is separate from the site bucket defined by the stack. Block its public access and keep artifacts for rollback.
- An email address for the monthly account-level $5 budget alert. The alert triggers above 50% actual spend; it does not stop spending.

## Deploy

```bash
pnpm install --frozen-lockfile
AWS_REGION=eu-north-1 scripts/deploy.sh <artifact-bucket-name> <budget-email>
```

The script runs checks, creates the budget stack from `infra/budget.yaml` in `us-east-1`, uploads the Lambda zip, applies the site stack from `infra/template.yaml` in `eu-north-1`, uploads static assets, invokes collection once, and prints the CloudFront URL. The feed is not committed into the static build. CloudFront deployment and cache propagation may take several minutes. Do not use `aws s3 sync --delete` on the site bucket because it would remove `data/latest.json`.

## Verify

- Open the printed HTTPS URL and `/data/latest.json`.
- Confirm the feed is recent, links point to JobTech/Platsbanken over HTTPS, and the JSON has no `description`, `rawData`, candidate Profile, or token.
- Check `aws logs` for `feed_published` with counts only and the EventBridge Scheduler schedule status.
- Confirm the site bucket blocks all public access and its bucket policy only allows the named CloudFront distribution.
- Confirm the budget notification email and current billing dashboard. The budget applies to the **whole account**.
- Check the site at desktop and phone widths and follow at least one original listing link.

## Failure and rollback

If collection fails, Lambda throws before S3 publication; the prior `data/latest.json` version remains current. The page warns when the snapshot is over 48 hours old. Inspect the sanitized Lambda log and source HTTP status. Do not print or store entire JobTech responses while debugging.

To restore an earlier feed, find the desired `data/latest.json` version in S3 and copy that version back to the same key; this creates a new current version. To restore the application, deploy the previous Lambda zip artifact and static build. The site bucket retains noncurrent versions for 30 days.

The CloudFormation site bucket uses `Retain`, so deleting the site stack does not delete published data. After deciding to retire the site, separately delete the site stack in `eu-north-1` and budget stack in `us-east-1`, then empty and delete both the site bucket and artifact bucket to avoid residual charges. CloudFront removal and AWS billing updates may lag.
