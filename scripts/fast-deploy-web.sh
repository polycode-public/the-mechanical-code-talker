#!/usr/bin/env bash
# Fast website content deploy: sync public/ straight to the publish bucket and
# invalidate CloudFront. Skips the full `cdk deploy` — use it for content-only
# changes once the WebsiteStack is up. Requires AWS creds already in the
# environment (e.g. `source scripts/assume-aws.sh prod`, or an SSO profile via
# AWS_PROFILE).
#
#   bash scripts/fast-deploy-web.sh <BUCKET_NAME> <DISTRIBUTION_ID>
#
# BUCKET_NAME + DISTRIBUTION_ID are the WebsiteStack's PublishBucketName +
# DistributionId CfnOutputs. Run `npm run build:ask-bundle && npm run
# demo:build` first — public/ is a generated directory, not checked in.
set -euo pipefail

BUCKET="${1:?usage: fast-deploy-web.sh <BUCKET_NAME> <DISTRIBUTION_ID>}"
DIST="${2:?usage: fast-deploy-web.sh <BUCKET_NAME> <DISTRIBUTION_ID>}"
SITE_DIR="${SITE_DIR:-public}"

echo "### syncing ${SITE_DIR}/ -> s3://${BUCKET} ###"
aws s3 sync "${SITE_DIR}/" "s3://${BUCKET}" \
  --delete \
  --cache-control "public, max-age=300, s-maxage=300"

echo "### invalidating CloudFront ${DIST} ###"
aws cloudfront create-invalidation \
  --distribution-id "${DIST}" \
  --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table

echo "done."
