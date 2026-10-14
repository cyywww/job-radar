#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: scripts/deploy.sh <existing-private-artifact-bucket> <budget-email>' >&2
  exit 2
fi

artifact_bucket=$1
budget_email=$2
stack_name=${JOB_RADAR_STACK_NAME:-job-radar-showcase}
aws_region=${AWS_REGION:-eu-north-1}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

cd "$repo_root"
CI=true pnpm check
CI=true pnpm format:check

aws cloudformation deploy \
  --region us-east-1 \
  --stack-name "${stack_name}-budget" \
  --template-file infra/budget.yaml \
  --parameter-overrides "BudgetEmail=${budget_email}" \
  --no-fail-on-empty-changeset

zip -j "$tmp_dir/handler.zip" apps/ingest/dist/handler.mjs >/dev/null
artifact_hash=$(shasum -a 256 apps/ingest/dist/handler.mjs | cut -d ' ' -f 1)
artifact_key="job-radar/ingest/${artifact_hash}.zip"
aws s3 cp "$tmp_dir/handler.zip" "s3://${artifact_bucket}/${artifact_key}" --region "$aws_region" --only-show-errors

aws cloudformation deploy \
  --region "$aws_region" \
  --stack-name "$stack_name" \
  --template-file infra/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "ArtifactBucket=${artifact_bucket}" \
    "ArtifactKey=${artifact_key}" \
  --no-fail-on-empty-changeset

site_bucket=$(aws cloudformation describe-stacks --region "$aws_region" --stack-name "$stack_name" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteBucketName'].OutputValue | [0]" --output text)
function_name=$(aws cloudformation describe-stacks --region "$aws_region" --stack-name "$stack_name" \
  --query "Stacks[0].Outputs[?OutputKey=='FeedFunctionName'].OutputValue | [0]" --output text)
site_domain=$(aws cloudformation describe-stacks --region "$aws_region" --stack-name "$stack_name" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue | [0]" --output text)

aws s3 sync apps/web/dist/assets "s3://${site_bucket}/assets" \
  --region "$aws_region" --cache-control 'public,max-age=300' --only-show-errors
aws s3 cp apps/web/dist/index.html "s3://${site_bucket}/index.html" \
  --region "$aws_region" --content-type 'text/html; charset=utf-8' \
  --cache-control 'public,max-age=60' --only-show-errors

invoke_error=$(aws lambda invoke --region "$aws_region" --function-name "$function_name" \
  --cli-binary-format raw-in-base64-out --payload '{}' \
  --query FunctionError --output text "$tmp_dir/invoke.json")
if [[ "$invoke_error" != 'None' ]]; then
  echo 'Initial collection failed. Inspect the Lambda log group; the public feed was not replaced.' >&2
  exit 1
fi

echo "Site: https://${site_domain}"
echo "Data: https://${site_domain}/data/latest.json"
echo 'CloudFront propagation can take several minutes.'
