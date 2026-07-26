#!/usr/bin/env bash
# OIDC two-step into a tmct AWS account from GitLab CI.
#
#   source scripts/assume-aws.sh ci      # -> tmct-ci
#   source scripts/assume-aws.sh prod    # -> tmct-prod
#
# Reads:
#   CI_AWS_ACTIONS_ROLE_ARN / PROD_AWS_ACTIONS_ROLE_ARN  (federated role)
#   CI_AWS_DEPLOY_ROLE_ARN  / PROD_AWS_DEPLOY_ROLE_ARN   (target role)
#   GITLAB_OIDC_TOKEN or CI_JOB_JWT_V2                   (token from GitLab)
# Exports AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN /
# AWS_REGION (defaults eu-west-2). Idempotent.
set -euo pipefail

env_name="${1:-ci}"
case "${env_name}" in
  ci)
    actions_arn="${CI_AWS_ACTIONS_ROLE_ARN:?CI_AWS_ACTIONS_ROLE_ARN required}"
    deploy_arn="${CI_AWS_DEPLOY_ROLE_ARN:?CI_AWS_DEPLOY_ROLE_ARN required}"
    ;;
  prod)
    actions_arn="${PROD_AWS_ACTIONS_ROLE_ARN:?PROD_AWS_ACTIONS_ROLE_ARN required}"
    deploy_arn="${PROD_AWS_DEPLOY_ROLE_ARN:?PROD_AWS_DEPLOY_ROLE_ARN required}"
    ;;
  *)
    echo "usage: source $0 <ci|prod>" >&2
    return 2 2>/dev/null || exit 2
    ;;
esac

oidc_token="${GITLAB_OIDC_TOKEN:-${CI_JOB_JWT_V2:-}}"
if [[ -z "${oidc_token}" ]]; then
  echo "no GitLab OIDC token (expected GITLAB_OIDC_TOKEN or CI_JOB_JWT_V2)" >&2
  return 1 2>/dev/null || exit 1
fi

export AWS_REGION="${AWS_REGION:-eu-west-2}"

# Extract the three credential fields with the AWS CLI's own JMESPath query +
# text output (tab-separated) — NO jq dependency (the CI deploy image ships no jq).
step1=$(aws sts assume-role-with-web-identity \
  --role-arn "${actions_arn}" \
  --role-session-name "gitlab-${CI_PIPELINE_ID:-local}-actions" \
  --web-identity-token "${oidc_token}" \
  --duration-seconds 3600 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)
read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<< "${step1}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

step2=$(aws sts assume-role \
  --role-arn "${deploy_arn}" \
  --role-session-name "gitlab-${CI_PIPELINE_ID:-local}-deploy" \
  --duration-seconds 3600 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)
read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<< "${step2}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

aws sts get-caller-identity >&2
