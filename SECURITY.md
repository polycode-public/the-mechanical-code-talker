# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
issue or merge request for a suspected vulnerability.

- **Email:** antony@polycode.co.uk
- **Or:** open a *confidential* issue on the GitLab project (tick "This issue is
  confidential" so it is visible only to project members).

Include enough detail to reproduce (affected version, steps, and impact). We aim
to **acknowledge within ~3 working days** and will keep you updated on triage and
a fix. Please give us reasonable time to remediate before any public disclosure.

## Supported versions

tmct is distributed as a single npm package
(`@polycode-projects/the-mechanical-code-talker`). Security fixes land on the
**latest released version**; there are no long-term support branches. Please
upgrade to the latest release before reporting, and always run a supported
Node.js (**>=24**).

| Version | Supported |
| ------- | --------- |
| latest release | ✅ |
| older releases | ❌ (upgrade to latest) |

## Automated scanning

Security scanning runs in GitLab CI (`.gitlab-ci.yml`):

- **Per pipeline (non-blocking):**
  - **SAST** — GitLab stock `semgrep` analyzer, run in the `verify` stage with
    `needs: []` and `allow_failure: true` (reports, never gates the pipeline).
  - **Secret Detection** — GitLab stock secret scanner, same non-blocking setup.
  - Both scope out committed corpus/data/site assets via `SAST_EXCLUDED_PATHS` /
    `SECRET_DETECTION_EXCLUDED_PATHS`.

- **Nightly (scheduled pipeline, BLOCKING) — the `dep:audit` job:**
  - `npm audit --audit-level=high` (`npm run audit`) — **fails the job** on any
    high or critical advisory.
  - `npm outdated` — visibility only, never fails the job.
  - **Google OSV-Scanner** — pinned release (`v2.0.2`, not `latest`), scanning
    `package-lock.json`.
  - The nightly schedule is created manually in GitLab
    (Settings → CI/CD → Pipeline schedules, e.g. `0 3 * * *` on `main`).

- **On publish:**
  - `npm publish --provenance --access public` — packages are published with
    **npm provenance** (a signed, verifiable link from the published tarball back
    to this CI pipeline and source commit).

- **Not applicable (pure-JS package):**
  - **Container Scanning** — N/A, tmct ships no container image.
  - **IaC / KICS scanning** — N/A, tmct contains no infrastructure-as-code.
