# AWS Accounts — tmct

Mirrors the polycode multi-account pattern (see seonix / marginalia /
bedrock-meter `AWS_ACCOUNTS.md`), same org as seonix. Workloads live in
**eu-west-2**; ACM + CloudFront (the website edge) in **us-east-1**.

**Org ID:** `o-d4gyqlg7o0` · **Org root account:** `541134664601`
(polycode-management) · **Workloads OU:** `ou-k4f6-nxhap4c0` · **Org root:**
`r-k4f6`

> Both tmct accounts exist and are placed in the Workloads OU. OIDC, deploy
> roles, CDK bootstrap, DNS, and CI variables are not provisioned yet — see
> PLAN_AWS.md Phase 3 onward and [docs/AWS_SETUP.md](docs/AWS_SETUP.md) for the
> remaining steps and the reproduce block below.

## Accounts

| Account | ID | OU | Role |
|---------|-----|-----|------|
| polycode-management | `541134664601` | (root) | Org admin, IAM Identity Center (SSO) |
| **tmct-ci** | `026621560310` | Workloads (`ou-k4f6-nxhap4c0`) | Branch-scoped CI deploys of the website edge |
| **tmct-prod** | `000868243177` | Workloads (`ou-k4f6-nxhap4c0`) | Production website (`tmct.polycode.co.uk`) + apex DNS zone |

## Member account contact emails

| Account | Email (sub-addressed to polycodelimited@gmail.com) |
|---------|------|
| tmct-ci | `polycodelimited+aws-tmct-ci@gmail.com` |
| tmct-prod | `polycodelimited+aws-tmct-prod@gmail.com` |

## IAM Identity Center (SSO)

Single org instance, shared with seonix — reuse the three existing permission
sets (do **not** create new ones):

- **Instance ARN:** `arn:aws:sso:::instance/ssoins-7535eb607eb3f5ee`
- **Identity store:** `d-9c674f05a6`

| Permission set | ARN | Session |
|----------------|-----|---------|
| `AdministratorAccess` | `arn:aws:sso:::permissionSet/ssoins-7535eb607eb3f5ee/ps-753516a5ca846d1c` | 8h |
| `PowerUserAccess` | `arn:aws:sso:::permissionSet/ssoins-7535eb607eb3f5ee/ps-753526f7c8d287d5` | 8h |
| `ReadOnlyAccess` | `arn:aws:sso:::permissionSet/ssoins-7535eb607eb3f5ee/ps-7535e633132dfcd8` | 4h |

Assignment plan (mirrors seonix/marginalia/bedrock-meter): **Admin +
PowerUser on tmct-ci**, **Admin + ReadOnly on tmct-prod**.

## GitLab OIDC + deployment roles

Each Workloads account gets a GitLab OIDC provider and a two-step role chain
(actions role → deployment role), assumed from CI by `scripts/assume-aws.sh`.
The CI project path is the tmct repo
(`polycode-projects/the-mechanical-code-talker`).

| Account | OIDC provider | Actions role | Deployment role | Trust scope (`gitlab.com:sub`) |
|---------|---------------|--------------|-----------------|--------------------------------|
| tmct-ci (`026621560310`) | `arn:aws:iam::026621560310:oidc-provider/gitlab.com` (not yet provisioned) | `tmct-ci-gitlab-actions-role` | `tmct-ci-deployment-role` | StringLike `project_path:polycode-projects/the-mechanical-code-talker:ref_type:branch:ref:*` |
| tmct-prod (`000868243177`) | `arn:aws:iam::000868243177:oidc-provider/gitlab.com` (not yet provisioned) | `tmct-prod-gitlab-actions-role` | `tmct-prod-deployment-role` | StringEquals `project_path:polycode-projects/the-mechanical-code-talker:ref_type:branch:ref:main` |

GitLab OIDC thumbprint: `3c4a8b66430edde6b6f03fd431e01a5e30fce540`.
Trust-policy JSON lives in `infra/iam-trust-policies/`.

## DNS

- Apex zone **`tmct.polycode.co.uk`** is created in **tmct-prod** by
  `infra/lib/apex-stack.ts` (the `tmct-prod-apex` stack).
- The parent `polycode.co.uk` zone lives in **polycode-management**; the
  operator copies the apex stack's `Nameservers` output into an `NS` record
  there to delegate the subdomain.
- The ACM cert for `tmct.polycode.co.uk` is requested in **us-east-1**
  (CloudFront requirement) and DNS-validated via CNAMEs the operator adds to
  the delegated `tmct.polycode.co.uk` zone.

## Provisioning status (2026-07-26)

- ✅ **tmct-ci / tmct-prod accounts created**, `026621560310` / `000868243177`, both placed in
  the Workloads OU.
- ⏳ GitLab OIDC provider + actions roles — `infra/provision-oidc.sh`, next.
- ⏳ Deployment role (`…-deployment-role`) + `AdministratorAccess` — pending an explicit
  operator grant (same high-severity gate as seonix's).
- ⏳ CDK bootstrap (`hnb659fds`, ×2 regions per account) — `infra/bootstrap-accounts.sh`, after
  the deploy roles.
- ⏳ SSO permission-set assignments (Admin+PowerUser on ci, Admin+ReadOnly on prod).
- ⏳ ACM cert (us-east-1) + DNS validation; Route53 NS delegation.
- ⏳ GitLab CI variables (the seven named in `.gitlab-ci.yml`'s Phase 6 comment block).

## Reproduce / finish provisioning

```bash
# from repo root, logged into the management account (profile polycode-management).
# Fill these real account IDs into the *-trust.json placeholders first.
bash infra/provision-oidc.sh         ci   026621560310   # OIDC + actions role
bash infra/provision-oidc.sh         prod 000868243177
bash infra/provision-deploy-roles.sh ci   026621560310   # deployment role + admin (operator)
bash infra/provision-deploy-roles.sh prod 000868243177
bash infra/bootstrap-accounts.sh     026621560310 000868243177  # cdk bootstrap x2 regions x2 accounts
```

The full manual runbook (account creation, SSO assignment, ACM, NS
delegation, GitLab CI vars) is in [docs/AWS_SETUP.md](docs/AWS_SETUP.md).
