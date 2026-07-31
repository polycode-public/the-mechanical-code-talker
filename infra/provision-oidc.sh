#!/usr/bin/env bash
# Provision the GitLab OIDC provider + actions role in a tmct member account.
# Idempotent. Run from the repo root, logged into polycode-management.
#
#   bash infra/provision-oidc.sh ci   <TMCT_CI_ACCOUNT_ID>
#   bash infra/provision-oidc.sh prod <TMCT_PROD_ACCOUNT_ID>
#
# Fill the real account IDs into the *-trust.json placeholders
# (TBD_CI_ACCOUNT_ID / TBD_PROD_ACCOUNT_ID) before running.
#
# The deployment role (which carries AdministratorAccess) is created separately
# by provision-deploy-roles.sh so the high-severity admin grant is an explicit,
# reviewable step.
set -euo pipefail

ENVN="$1"; ACC="$2"
MGMT="${AWS_MGMT_PROFILE:-polycode-management}"
TP=infra/iam-trust-policies
THUMB=3c4a8b66430edde6b6f03fd431e01a5e30fce540

creds=$(aws sts assume-role --profile "$MGMT" \
  --role-arn "arn:aws:iam::${ACC}:role/OrganizationAccountAccessRole" \
  --role-session-name "tmct-provision-${ENVN}" --output json)
export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r '.Credentials.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r '.Credentials.SecretAccessKey')
export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r '.Credentials.SessionToken')
export AWS_REGION=eu-west-2
echo "assumed: $(aws sts get-caller-identity --query Arn --output text)"

if ! aws iam get-open-id-connect-provider \
     --open-id-connect-provider-arn "arn:aws:iam::${ACC}:oidc-provider/gitlab.com" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://gitlab.com \
    --client-id-list https://gitlab.com --thumbprint-list "$THUMB" >/dev/null
fi

ACTIONS=tmct-${ENVN}-gitlab-actions-role
if aws iam get-role --role-name "$ACTIONS" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ACTIONS" \
    --policy-document "file://${TP}/tmct-${ENVN}-actions-trust.json" >/dev/null
else
  aws iam create-role --role-name "$ACTIONS" \
    --assume-role-policy-document "file://${TP}/tmct-${ENVN}-actions-trust.json" \
    --max-session-duration 3600 \
    --description "GitLab CI web-identity entry role for tmct ${ENVN}" >/dev/null
fi
aws iam put-role-policy --role-name "$ACTIONS" \
  --policy-name assume-deployment-role \
  --policy-document "file://${TP}/actions-can-assume-deploy-policy.json" >/dev/null
echo "oidc + actions role ready for ${ENVN}"
