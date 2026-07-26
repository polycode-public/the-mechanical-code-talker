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
| tmct-ci (`026621560310`) | `arn:aws:iam::026621560310:oidc-provider/gitlab.com` | `tmct-ci-gitlab-actions-role` | `tmct-ci-deployment-role` (not yet provisioned) | StringLike `project_path:polycode-projects/the-mechanical-code-talker:ref_type:branch:ref:*` |
| tmct-prod (`000868243177`) | `arn:aws:iam::000868243177:oidc-provider/gitlab.com` | `tmct-prod-gitlab-actions-role` | `tmct-prod-deployment-role` (not yet provisioned) | StringEquals `project_path:polycode-projects/the-mechanical-code-talker:ref_type:branch:ref:main` |

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
- ✅ **GitLab OIDC provider + actions roles provisioned**, both accounts — `infra/provision-oidc.sh`
  run and verified (`tmct-ci-gitlab-actions-role` / `tmct-prod-gitlab-actions-role` exist, each
  with its OIDC provider and `assume-deployment-role` inline policy).
- ✅ **Deployment role (`…-deployment-role`) + `AdministratorAccess` granted**, both accounts —
  operator confirmed the grant explicitly; `infra/provision-deploy-roles.sh` run for ci and prod.
- ✅ **CDK bootstrap complete**, `hnb659fds` qualifier, both accounts × both regions
  (`eu-west-2`, `us-east-1`) — `infra/bootstrap-accounts.sh` run and verified (all 4
  `CDKToolkit` stacks `CREATE_COMPLETE`).
- ✅ **Apex (DNS zone) stacks deployed**, both accounts —
  `tmct-ci-apex`: zone `Z097342215YVGJPQGXL7E`, nameservers
  `ns-1583.awsdns-05.co.uk, ns-465.awsdns-58.com, ns-1291.awsdns-33.org, ns-890.awsdns-47.net`.
  `tmct-prod-apex`: zone `Z016664215EH1WLK6NZGI`, nameservers
  `ns-980.awsdns-58.net, ns-347.awsdns-43.com, ns-2006.awsdns-58.co.uk, ns-1232.awsdns-26.org`.
  Neither is public yet — no NS delegation in the parent zone.
- ✅ **NS delegation added in the parent `polycode.co.uk` zone (`Z2981ZT3I1K2HT`,
  polycode-management)**, operator-confirmed. First attempt pointed at `tmct-ci-apex`'s
  nameservers by mistake (the validation CNAME lives in `tmct-prod-apex`'s zone) — corrected via
  an UPSERT to `tmct-prod-apex`'s actual nameservers
  (`ns-980.awsdns-58.net, ns-347.awsdns-43.com, ns-2006.awsdns-58.co.uk, ns-1232.awsdns-26.org`).
- ✅ **ACM cert issued**, us-east-1, `tmct-prod`:
  `arn:aws:acm:us-east-1:000868243177:certificate/8e8aa751-9c16-4cd8-a7c5-42d6595e6ec5`,
  valid until 2027-02-09. Validated via the CNAME in `tmct-prod-apex`'s zone once the NS
  delegation above propagated. **Phase 5 complete.**
- ✅ **SSO permission-set assignments done** — Admin+PowerUser on tmct-ci, Admin+ReadOnly on
  tmct-prod, all four `create-account-assignment` calls confirmed `SUCCEEDED`.
- ✅ **GitLab CI variables set**, all seven, via `glab variable set` (prod ones `--scope
  production`; `deploy:website`/`e2e:deployed` given a matching `environment: production` so the
  scope actually applies — GitLab only injects a non-wildcard-scoped variable into a job whose
  `environment` matches it).
- ✅ **Website stack deployed**: `tmct-prod-prod-website`, CloudFront `d1wf3da8rbekm0.cloudfront.net`
  (distribution `E1YEAO48PKAJHE`), bucket `tmct-prod-prod-web-000868243177`. Confirmed serving
  real content directly via the CloudFront domain (HTTP 200); `tmct.polycode.co.uk` itself was
  still resolving through a stale negative-DNS-cache entry from pre-deploy nameserver checks at
  last check (the SOA's negative-cache TTL is 24h) — the A-record and CloudFront are both
  confirmed correct via the AWS API, so this clears on its own, not a real fault.
- ✅ **Cutover done**: `package.json`'s `homepage` now points at `https://tmct.polycode.co.uk/`;
  `pages` now publishes a meta-refresh + canonical-link redirect stub instead of the real site;
  `smoke:post-deploy` now needs `deploy:website` instead of `pages`.
- ⏳ Post-cutover `SKILL_PAGE_WEIGHTS` run → `reports/PAGE_WEIGHTS.md` revision 2 (once DNS
  fully clears, so the measurement hits the real deployed edge, not a stale-cache miss).

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
