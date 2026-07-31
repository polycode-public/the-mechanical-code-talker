#!/usr/bin/env bash
# CDK-bootstrap both tmct accounts in both regions (eu-west-2 workloads,
# us-east-1 for CloudFront/ACM — the website edge needs it). Uses
# OrganizationAccountAccessRole to assume into each account. Run from the repo
# root, logged into polycode-management. Requires the deployment roles to exist
# (provision-deploy-roles.sh).
#
#   bash infra/bootstrap-accounts.sh <TMCT_CI_ACCOUNT_ID> <TMCT_PROD_ACCOUNT_ID>
set -euo pipefail
MGMT="${AWS_MGMT_PROFILE:-polycode-management}"
QUALIFIER=hnb659fds

CI_ACC="${1:?usage: bootstrap-accounts.sh <CI_ACCOUNT_ID> <PROD_ACCOUNT_ID>}"
PROD_ACC="${2:?usage: bootstrap-accounts.sh <CI_ACCOUNT_ID> <PROD_ACCOUNT_ID>}"

bootstrap_one() {
  local envn="$1" acc="$2"
  creds=$(aws sts assume-role --profile "$MGMT" \
    --role-arn "arn:aws:iam::${acc}:role/OrganizationAccountAccessRole" \
    --role-session-name "tmct-bootstrap-${envn}" --output json)
  export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r '.Credentials.AccessKeyId')
  export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r '.Credentials.SecretAccessKey')
  export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r '.Credentials.SessionToken')
  for region in eu-west-2 us-east-1; do
    echo "### cdk bootstrap ${envn} ${acc} ${region} ###"
    npx --yes aws-cdk@2 bootstrap "aws://${acc}/${region}" \
      --qualifier "$QUALIFIER" \
      --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
  done
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
}

bootstrap_one ci   "$CI_ACC"
bootstrap_one prod "$PROD_ACC"
