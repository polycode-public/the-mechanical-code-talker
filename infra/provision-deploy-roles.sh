#!/usr/bin/env bash
# Create the CDK deployment role (AdministratorAccess) in each tmct member
# account. SEPARATE from provision-oidc.sh because creating an OIDC-federated
# admin role is a high-severity grant that should be run/reviewed explicitly by
# the operator. Idempotent. Run from the repo root, logged into
# polycode-management.
#
#   bash infra/provision-deploy-roles.sh ci   <TMCT_CI_ACCOUNT_ID>
#   bash infra/provision-deploy-roles.sh prod <TMCT_PROD_ACCOUNT_ID>
set -euo pipefail

ENVN="$1"; ACC="$2"
MGMT="${AWS_MGMT_PROFILE:-polycode-management}"
TP=infra/iam-trust-policies

creds=$(aws sts assume-role --profile "$MGMT" \
  --role-arn "arn:aws:iam::${ACC}:role/OrganizationAccountAccessRole" \
  --role-session-name "tmct-deployrole-${ENVN}" --output json)
export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r '.Credentials.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r '.Credentials.SecretAccessKey')
export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r '.Credentials.SessionToken')
export AWS_REGION=eu-west-2
echo "assumed: $(aws sts get-caller-identity --query Arn --output text)"

DEPLOY=tmct-${ENVN}-deployment-role
# The actions role must already exist (provision-oidc.sh) for this trust to be valid.
if aws iam get-role --role-name "$DEPLOY" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$DEPLOY" \
    --policy-document "file://${TP}/tmct-${ENVN}-deploy-trust.json" >/dev/null
else
  aws iam create-role --role-name "$DEPLOY" \
    --assume-role-policy-document "file://${TP}/tmct-${ENVN}-deploy-trust.json" \
    --max-session-duration 3600 \
    --description "CDK deployment role for tmct ${ENVN}" >/dev/null
fi
aws iam attach-role-policy --role-name "$DEPLOY" \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess >/dev/null
echo "deployment role ready for ${ENVN}: ${DEPLOY}"
