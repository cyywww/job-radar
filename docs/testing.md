# Testing and verification

All automated fixtures are fictional and all test requests are mocked. The suite does not access a real résumé, personal Profile, AWS account, or live JobTech data.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm format:check
```

`pnpm check` runs lint, typecheck, tests, and build. `pnpm format:check` is separate. There is no database migration or API health endpoint in the new architecture.

Both infrastructure templates also pass local validation with `cfn-lint -t infra/template.yaml -r eu-north-1` and `cfn-lint -t infra/budget.yaml -r us-east-1`.

## Automated coverage

- Shared Zod contract accepts a minimal feed and rejects private extra fields and unsafe links.
- Collector covers regional filtering, deduplication, strict public shape, source errors, empty results, and rate-limit/transport retry. The publication boundary proves collection or schema failure cannot replace the previous feed.
- React tests cover validated loading, region filtering, and invalid-data error state. Visual review should confirm that jobs and filters appear immediately, without a promotional hero or engineering explainer.

## Local runtime checks

After `pnpm build`, start `pnpm start` and check `http://127.0.0.1:4173/` in a browser. With no feed, the explicit missing-snapshot state is expected. A separate fictional `data/latest.json` can be copied into `apps/web/public/data/` for a local-only visual smoke check; do not include it in a production upload.

## Cloud acceptance after authorization

1. Validate the CloudFormation template, deploy the stack, then inspect Outputs.
2. Invoke the Lambda once; confirm that `data/latest.json` is valid against `publicFeedSchema` and contains no description/raw data.
3. Verify CloudFront serves the page and JSON over HTTPS, S3 public access is blocked, and the origin cannot be read anonymously.
4. Simulate source failure; verify the S3 version/current feed is unchanged and the UI shows an outdated snapshot after 48 hours.
5. Check Lambda logs for counts only, Scheduler status, budget subscription, actual bill, desktop/mobile layout, keyboard focus, and source links.
