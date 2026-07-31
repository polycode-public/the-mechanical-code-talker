# AWS setup — standing up tmct-ci / tmct-prod

This is the **manual operator runbook** for the tmct AWS estate: two member
accounts (`tmct-ci`, `tmct-prod`) under the polycode organization, GitLab
OIDC deploy roles, the website edge (S3 + CloudFront + ACM + Route53), and
the `tmct.polycode.co.uk` DNS delegation. It mirrors the seonix / marginalia
/ bedrock-meter pattern (same org — see `../AWS_ACCOUNTS.md`).

Account/org facts and ARNs live in [`../AWS_ACCOUNTS.md`](../AWS_ACCOUNTS.md).
All `aws` commands below run as the **`polycode-management`** profile unless a
script assumes a role for you.

- **Org root account:** `541134664601` (polycode-management)
- **Org ID:** `o-d4gyqlg7o0` · **Org root:** `r-k4f6` · **Workloads OU:** `ou-k4f6-nxhap4c0`
- **SSO instance:** `arn:aws:sso:::instance/ssoins-7535eb607eb3f5ee` · store `d-9c674f05a6`
- **Regions:** workloads **eu-west-2**; ACM + CloudFront **us-east-1**.

> Nothing here is destructive-by-accident, but several steps **create accounts,
> an admin-grade IAM role, and DNS records**. Read each step before running it.

---

## 1. Create the two member accounts

Organizations creates accounts asynchronously; capture the request id and poll.

```bash
aws organizations create-account \
  --email polycodelimited+aws-tmct-ci@gmail.com \
  --account-name tmct-ci --profile polycode-management

aws organizations create-account \
  --email polycodelimited+aws-tmct-prod@gmail.com \
  --account-name tmct-prod --profile polycode-management

# poll until SUCCEEDED, capture the new account ids:
aws organizations list-create-account-status \
  --states SUCCEEDED --profile polycode-management \
  --query 'CreateAccountStatuses[?contains(AccountName,`tmct`)].[AccountName,AccountId]' \
  --output table
```

**Record the two account IDs.** Then:

1. Fill them into [`../AWS_ACCOUNTS.md`](../AWS_ACCOUNTS.md).
2. Replace the `TBD_CI_ACCOUNT_ID` / `TBD_PROD_ACCOUNT_ID` placeholders in
   `infra/iam-trust-policies/tmct-{ci,prod}-{actions,deploy}-trust.json`.

## 2. Place both accounts in the Workloads OU

New accounts land in the org root; move them under Workloads
(`ou-k4f6-nxhap4c0`):

```bash
aws organizations move-account --account-id <TMCT_CI_ACCOUNT_ID> \
  --source-parent-id r-k4f6 --destination-parent-id ou-k4f6-nxhap4c0 \
  --profile polycode-management
aws organizations move-account --account-id <TMCT_PROD_ACCOUNT_ID> \
  --source-parent-id r-k4f6 --destination-parent-id ou-k4f6-nxhap4c0 \
  --profile polycode-management
```

## 3. SSO permission-set assignments

Reuse the three **existing** permission sets (do not create new ones). Assign
**Admin + PowerUser on tmct-ci**, **Admin + ReadOnly on tmct-prod**, to your
operator user/group in IAM Identity Center. ARNs:

| Permission set | ARN |
|----------------|-----|
| AdministratorAccess | `arn:aws:sso:::permissionSet/ssoins-7535eb607eb3f5ee/ps-753516a5ca846d1c` |
| PowerUserAccess | `arn:aws:sso:::permissionSet/ssoins-7535eb607eb3f5ee/ps-753526f7c8d287d5` |
| ReadOnlyAccess | `arn:aws:sso:::permissionSet/ssoins-7535eb607eb3f5ee/ps-7535e633132dfcd8` |

Easiest via the console (IAM Identity Center → AWS accounts → select account →
Assign users/groups). CLI equivalent (per account × permission set):

```bash
aws sso-admin create-account-assignment \
  --instance-arn arn:aws:sso:::instance/ssoins-7535eb607eb3f5ee \
  --target-id <ACCOUNT_ID> --target-type AWS_ACCOUNT \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --principal-type GROUP --principal-id <IDENTITY_STORE_GROUP_ID> \
  --profile polycode-management
```

Then add an SSO profile for each account to `~/.aws/config` and
`aws sso login` so you can run `cdk` locally if needed.

## 4. GitLab OIDC + actions roles

Once the trust JSON placeholders are filled (step 1), provision the OIDC
provider and the federated **actions** role in each account. Idempotent.

```bash
# from repo root, profile polycode-management
bash infra/provision-oidc.sh ci   <TMCT_CI_ACCOUNT_ID>
bash infra/provision-oidc.sh prod <TMCT_PROD_ACCOUNT_ID>
```

This creates the `gitlab.com` OIDC provider, the
`tmct-{env}-gitlab-actions-role`, and an inline policy letting it assume only
the deployment role.

## 5. Deployment roles + AdministratorAccess (HIGH-SEVERITY — explicit grant)

Creating an OIDC-federated admin role is a high-severity action, kept in a
separate script so it's a deliberate, reviewed step:

```bash
bash infra/provision-deploy-roles.sh ci   <TMCT_CI_ACCOUNT_ID>
bash infra/provision-deploy-roles.sh prod <TMCT_PROD_ACCOUNT_ID>
```

Each creates `tmct-{env}-deployment-role` (trusted by the actions role only)
and attaches `AdministratorAccess`.

## 6. CDK bootstrap (both accounts × both regions)

The website edge needs **us-east-1** (CloudFront/ACM) as well as **eu-west-2**:

```bash
bash infra/bootstrap-accounts.sh <TMCT_CI_ACCOUNT_ID> <TMCT_PROD_ACCOUNT_ID>
```

Bootstraps with the `hnb659fds` qualifier and an `AdministratorAccess`
execution policy, matching CI.

## 7. Deploy the apex (DNS) stack + delegate the subdomain

The `tmct.polycode.co.uk` zone lives in **tmct-prod**. Deploy the apex stack
first (it has no cert dependency):

```bash
cd infra
npm install            # infra workspace only
npx cdk deploy tmct-prod-apex \
  -c env=prod -c account=<TMCT_PROD_ACCOUNT_ID> -c region=eu-west-2
# read the "Nameservers" CfnOutput (comma-separated NS hostnames)
```

Then, in the **polycode-management** account's `polycode.co.uk` Route 53
zone, add an `NS` record:

```
tmct.polycode.co.uk.   NS   <ns1> <ns2> <ns3> <ns4>   (TTL 300)
```

(Console: Route 53 → Hosted zones → polycode.co.uk → Create record → type NS,
name `tmct`, paste the four nameservers.)

## 8. ACM certificate (us-east-1) + DNS validation

CloudFront certs must be in **us-east-1**. Request a DNS-validated cert in
tmct-prod (us-east-1) for the apex hostname:

```bash
aws acm request-certificate \
  --domain-name tmct.polycode.co.uk \
  --validation-method DNS \
  --region us-east-1 --profile <tmct-prod-sso-profile> \
  --query CertificateArn --output text
# describe to read the CNAME validation record:
aws acm describe-certificate --certificate-arn <CERT_ARN> \
  --region us-east-1 --profile <tmct-prod-sso-profile> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

Add the returned **CNAME** to the `tmct.polycode.co.uk` zone (now delegated,
so it lives in tmct-prod's Route 53). Wait for the cert status to reach
`ISSUED`. **Record the cert ARN.**

## 9. Deploy the website stack

tmct's site is generated, not checked in — build it before deploying:

```bash
npm ci
npm run build:ask-bundle
npm run demo:build     # writes public/, including the .br/.gz precompressed siblings
```

With the cert ARN and (optionally) the zone id/name from the apex stack:

```bash
cd infra
npx cdk deploy tmct-prod-prod-website \
  -c env=prod -c slug=prod \
  -c account=<TMCT_PROD_ACCOUNT_ID> -c region=eu-west-2 \
  -c hostname=tmct.polycode.co.uk \
  -c certArn=<US_EAST_1_CERT_ARN> \
  -c hostedZoneId=<APEX_ZONE_ID> -c zoneName=tmct.polycode.co.uk
```

The stack creates the private S3 publish bucket (OAC), uploads `../public`,
fronts it with CloudFront (`PRICE_CLASS_100`, on-the-fly compression up to
10 MB). Unlike seonix's SPA-rewrite function (every tmct URL has a file
extension, so no extensionless fallback is needed), the stack's CloudFront
Function instead rewrites any asset over the 10 MB compression ceiling
(currently only `chat-seed.json`) to its precompressed `.br`/`.gz` sibling by
`Accept-Encoding` — the path list is read from the built `public/` directory
at synth time, so it always matches the actual build output. If
`BucketDeployment`'s Lambda hits memory/size limits on the ~85 MB payload
despite the raised memory/ephemeral storage, the fallback is publishing
content straight from CI via `scripts/fast-deploy-web.sh`'s three-pass
`aws s3 sync`, leaving CDK to own only the infra.

Note the `DistributionId` + `PublishBucketName` outputs — the content-only
fast path uses them:

```bash
source scripts/assume-aws.sh prod        # or use an SSO profile
bash scripts/fast-deploy-web.sh <PublishBucketName> <DistributionId>
```

## 10. GitLab CI variables

Set per-environment role ARNs as GitLab CI/CD variables (protected; `prod`
ones masked + environment-scoped) so `scripts/assume-aws.sh` works in CI:

```bash
glab variable set CI_AWS_ACTIONS_ROLE_ARN   "arn:aws:iam::<CI_ID>:role/tmct-ci-gitlab-actions-role"
glab variable set CI_AWS_DEPLOY_ROLE_ARN    "arn:aws:iam::<CI_ID>:role/tmct-ci-deployment-role"
glab variable set PROD_AWS_ACTIONS_ROLE_ARN "arn:aws:iam::<PROD_ID>:role/tmct-prod-gitlab-actions-role" --scope production
glab variable set PROD_AWS_DEPLOY_ROLE_ARN  "arn:aws:iam::<PROD_ID>:role/tmct-prod-deployment-role"    --scope production
```

The `deploy:website` job (`.gitlab-ci.yml`) also reads the website-stack
context as CI vars (so the deploy is a one-click, manual, protected/main job):

```bash
glab variable set TMCT_PROD_ACCOUNT_ID "<TMCT_PROD_ACCOUNT_ID>" --scope production
glab variable set TMCT_PROD_CERT_ARN   "<US_EAST_1_CERT_ARN>"   --scope production
glab variable set TMCT_PROD_ZONE_ID    "<APEX_ZONE_ID>"         --scope production
```

The job already defines an `id_tokens` block minting `GITLAB_OIDC_TOKEN`
(`aud: https://gitlab.com`); `scripts/assume-aws.sh prod` consumes it.

### The exact local deploy go-command

Stood up the estate by hand and want to deploy from a workstation (SSO
profile)? After `aws sso login`, build the site, then from `infra/`:

```bash
npm run build:ask-bundle && npm run demo:build   # from repo root, first
cd infra
npx cdk deploy tmct-prod-prod-website --require-approval never \
  -c env=prod -c slug=prod \
  -c account=<TMCT_PROD_ACCOUNT_ID> -c region=eu-west-2 \
  -c hostname=tmct.polycode.co.uk \
  -c certArn=<US_EAST_1_CERT_ARN> \
  -c hostedZoneId=<APEX_ZONE_ID> -c zoneName=tmct.polycode.co.uk
```

---

## Manual steps that cannot be scripted away

1. **Create the two accounts** (§1) and record their IDs.
2. **Fill the IDs** into `AWS_ACCOUNTS.md` and the `*-trust.json` placeholders.
3. **SSO permission-set assignment** to your operator identity (§3).
4. **The admin grant** — running `provision-deploy-roles.sh` is a deliberate
   high-severity action (§5).
5. **NS delegation** — paste the apex `Nameservers` output into the parent
   `polycode.co.uk` zone (§7).
6. **ACM request + DNS-validation CNAME** in us-east-1, then record the ARN (§8).
7. **GitLab CI variables** + the `id_tokens` block (§10).
8. **The cutover commit** (reference updates, `homepage`, version roll,
   `npm publish`) — see PLAN_AWS.md Phase 8, run only once `deploy:website` +
   `e2e:deployed` are green.
