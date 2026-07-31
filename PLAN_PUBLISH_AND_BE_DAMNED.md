# PLAN_PUBLISH_AND_BE_DAMNED.md — CI as sensors, not gates

Status: Phase 1 merged to `main`, DELIVERED once a real pipeline there demonstrates the projected
critical path (not yet confirmed empirically). Phase 2 is a follow-up, PROPOSED. Phase 3 is not
being pursued — see its own section. Evidence throughout is pipeline `2722619624`, the last
known-good run before this plan: 1636 seconds (27.3 minutes) wall-clock.

## The philosophy

The operator's framing, kept as stated: we don't care if we ship broken, because we are iterating
fast with no real users. We do care if we don't know the consumer surface is broken, and we care
that we know what we can, fast.

tmct is a pre-launch product. Nobody's production depends on the npm package or the site today.
The cost of shipping a broken build is one more push. The cost of a 27-minute pipeline is paid on
every push, and the cost of NOT knowing a surface is broken compounds silently. So the pipeline's
job is to produce fast, comprehensive knowledge of what is broken, and to ship while it does it.
Publish, and be damned if it's broken. But know immediately that it is.

The current pipeline was built for the opposite posture. Its stage model
(`test` → `e2e` → `deploy` → `verify`) blocks deploy and publish until nearly everything before
them passes. That trades away the thing we actually want (speed of both shipping and knowledge)
to buy the thing we don't (a guarantee that nothing broken reaches an audience that doesn't
exist yet).

Two guarantees survive as hard gates, because they are a different kind of risk:

1. **Secret detection gates every ship job.** A leaked credential is not "shipped broken"; it is
   an incident that outlives the next push. Today `secret_detection` has `allow_failure: true`
   and `needs: []`. It runs in parallel and blocks nothing. This plan closes that gap.
2. **The deployed-site e2e tier must test the build this pipeline deployed.** If the live site is
   serving a different commit's build, every green and every red the deployed-e2e jobs produce
   describes the wrong thing. That would poison the knowledge this whole philosophy exists to
   buy, so it stays a hard, verified guarantee.

Everything else (unit tiers, the e2e matrices, licence checks, package hygiene) becomes a sensor:
maximum parallelism, fastest possible report, no gating of deploy or publish.

## What pipeline 2722619624 actually did

Job timeline, offsets from pipeline start:

| stage | job | duration | starts at |
|---|---|--:|--:|
| test | unit:smoke | 37.2s | +1s |
| test | unit:fast | 39.9s | +1s |
| test | unit | 188.3s | +1s |
| test | unit:slow | 214.6s | +37s |
| test | pack:contents | 42.4s | +37s |
| test | license:deps | 26.8s | +37s |
| verify | secret_detection | 19.4s | +46s |
| verify | semgrep-sast | 275.5s | +46s |
| verify | pii:lint | 23.4s | +57s |
| verify | links:check | 31.7s | +57s |
| e2e | e2e-cli | 74.0s | +254s |
| e2e | e2e-tui | 42.8s | +254s |
| e2e | e2e-web-local-origin | 372.5s | +254s |
| e2e | e2e-web-index | 504.8s | +254s |
| deploy | deploy:website | 408.2s | +758s |
| deploy | publish:npm | 615.5s | +758s |
| site-ready | site:ready | 38.8s | +1170s |
| e2e-deployed | e2e:deployed:shell | 95.6s | +1211s |
| e2e-deployed | e2e:deployed:pages | 374.4s | +1211s |
| e2e-deployed | e2e:deployed:pages-timing | 420.1s | +1211s |
| e2e-deployed | e2e:deployed:mesh | 427.6s | +1211s |
| verify | smoke:post-deploy | 24.3s | +1377s |
| verify | e2e:published-package | 84.7s | +1377s |

The core finding sits in the deploy row. `publish:npm` is the single longest job in the pipeline
(615.5s) and it starts at the 758-second mark. Nothing it produces is consumed by anything that
took 758 seconds to make. It starts there because the stage model makes it wait for the entire
`test` stage and the entire `e2e` stage. `deploy:website` names its real `needs:` explicitly and
STILL starts at +758s, because its stage position makes it wait for `e2e-web-local-origin`, a job
its own `needs:` list deliberately excludes. The stage model overrides the DAG the file already
tried to draw.

## The real dependency graph

What each job's minimum real dependency is, under the philosophy above:

| job | real minimum dependency | why |
|---|---|---|
| unit:*, pack:contents, license:deps, e2e-*, pii:lint, links:check, semgrep-sast | nothing | sensors; they read the checkout |
| secret_detection | nothing | must start immediately; it becomes the ship gate |
| deploy:website | secret_detection | don't put a leaked secret on the edge |
| publish:npm | secret_detection | don't publish a leaked secret to npm |
| site:ready | deploy:website | reads what the deploy wrote |
| e2e:deployed:* | site:ready | measurement correctness (guarantee 2) |
| smoke:post-deploy | publish:npm + deploy:website | reads both ship outputs |
| e2e:published-package | publish:npm | installs what the publish wrote |

The resulting critical path is the ship-and-verify chain: secret_detection (~20s, done by roughly
the one-minute mark with runner pickup) → deploy:website (408s) → site:ready (39s) → slowest
e2e:deployed job (428s). About 894 seconds of work, roughly 15 minutes wall-clock. `publish:npm`
starting at the same ~60s mark finishes around the 11-minute mark instead of at +1373s, and its
own followers (`smoke:post-deploy`, `e2e:published-package`) finish inside the deployed-e2e
window instead of after it. Every sensor reports well before the chain completes. Total
wall-clock roughly halves, and the halving comes entirely from cutting gating down to what is
load-bearing, with zero jobs removed.

## Phase 1 — sensors, two gates, and commit-precise readiness (MERGED)

Landed on `main`. Flips to DELIVERED once a real pipeline there demonstrates the projected
critical path.

### 1a. Secret detection gates both ship jobs

- `secret_detection` loses `allow_failure: true`. It keeps `needs: []` so it starts at pipeline
  start; at ~20s it is the cheapest gate in the file.
- `deploy:website` and `publish:npm` each gain `secret_detection` as a real `needs:` entry, and
  drop every unit/e2e entry from their `needs:` lists.
- Failure mode: a detected secret fails `secret_detection`, both ship jobs skip, every sensor
  still runs and reports. The pipeline goes red with full knowledge and nothing shipped.
- `semgrep-sast` stays `allow_failure: true`. It is an advisory scanner with a false-positive
  rate; making it a gate or a red-sensor would let noise block or discolour pipelines. Its
  report is still knowledge, at the right severity.

### 1b. Deploy what we deployed: the commit stamp

The gap: `site:ready` polls the live site until it shows `package.json`'s version and a real,
full-size `chat-seed.json` (`scripts/wait-for-site.mjs`). A version is not commit-precise.
Several commits share a version between bumps, so two racing pipelines (or a slow deploy
overlapping a fast next push) can both pass the version check while the edge serves the wrong
commit's build. Every deployed-e2e result downstream would then describe a build nobody asked
about.

The fix, as actually implemented:

- **What stamps it.** `src/domain/version-stamp.mjs` grows a commit twin of its version trio:
  `stampCommit(html, sha)` / `parseCommitStamp(html)` / `hasCommitStamp(html)`, same
  one-place-writer-and-reader pattern that file exists to enforce. The carrier is a hidden
  `<span id="pkg-commit">local</span>` placeholder committed in `public/index.html` — "local"
  never matches the twelve-hex-character shape the reader accepts, so an unstamped page reads
  as "no commit stamped" rather than a false match. `scripts/build-demo-site.mjs` stamps it at
  build time only when `CI_COMMIT_SHA` is present in the environment; a local build leaves the
  placeholder untouched, so it never churns outside CI.
- **Who sets it.** Nothing has to — `CI_COMMIT_SHA` is one of GitLab's own predefined variables,
  present in every job automatically.
- **What reads it.** `scripts/wait-for-site.mjs` keeps its version and seed checks and adds: when
  `CI_COMMIT_SHA` is set in the poller's own environment, the live page's commit stamp must
  match its short form. Run locally with it unset, the script behaves as before this phase.
- **Failure mode when the stamp is absent or wrong.** An expected-but-missing stamp means the
  edge is still serving a pre-stamp build; a mismatched stamp means it is serving some other
  commit's build. Both are "not ready": the poll keeps polling and, at the attempt cap,
  `site:ready` fails and every `e2e:deployed:*` job skips. No deployed-e2e signal is produced
  rather than a wrong-build signal, which is the point.

### 1c. Stages become labels; `needs:` becomes the schedule

GitLab requires a `stage:` per job, so the stage names stay for pipeline-graph readability. The
actual ordering moves to `needs:` on every job, per the dependency table above. Sensors get
`needs: []` and start at pipeline start. The `optional: true` pattern the file already uses stays
wherever a needed job can be absent from a pipeline (a README-only push, say).

**Sensors keep the default `allow_failure: false`. This is a deliberate choice, and it is the
single biggest behavioural change from today's pipeline, so here is the reasoning in full.** Once
no ship job `needs:` a sensor, a failing sensor no longer blocks anything: GitLab only skips jobs
downstream of a failure in their own `needs:` chain, and the ship jobs' chains contain only
`secret_detection`. So a red unit tier and a completed deploy coexist in the same pipeline. That
is exactly both halves of the philosophy: the deploy shipped (publish and be damned), and the
pipeline is red (know immediately). Setting sensors to `allow_failure: true` instead would buy
nothing (they already block nothing) and cost the one thing we care about, because a
"passed with warnings" pipeline reads as green at a glance and the knowledge arrives late or
never. Red must stay loud.

Consequences to accept with open eyes: `main`'s pipeline badge will show red more often, and red
now means "something is broken, and it may already be live". Whether it shipped is answered by
which jobs failed, in one click. For a project with no users, that trade is the whole plan.

### 1d. `publish:npm` runs `test:fast`, not the full suite

The job's script ran the full suite before publishing — a hidden gate inside the job, several
minutes of its 615s, duplicating what four parallel unit sensors already run. It now runs
`npm run test:fast` (seconds, not minutes): a real check still stands between a broken build and
the registry even if a pipeline's other test jobs haven't finished yet, without reintroducing
the duplication the full suite cost.

### 1e. What keeps its hard `needs:`

The post-ship verifiers read ship outputs, so their edges are real dependencies, not gates:
`site:ready` → `deploy:website`; `e2e:deployed:*` → `site:ready`; `smoke:post-deploy` →
both ship jobs; `e2e:published-package` → `publish:npm`. All unchanged.

## Phase 2 — build in CI, stop committing bundles (PROPOSED)

Three times in one recent session, a committed generated bundle (`src/surfaces/web/*.bundle.js`)
went stale against its source and broke CI, once on a real pipeline.
`test/estate/generated-artifacts.test.mjs` exists to catch exactly this, and it does, at the cost
of a whole test category whose only job is policing a self-inflicted invariant: the repo commits
build outputs, so the outputs can drift from their sources.

The proposal: a `build:*` job per artifact family builds fresh from source once per pipeline and
hands the result to every consumer via `artifacts:` + `needs:`. Nothing committed means nothing
to be stale, and the drift-guard tests for those artifacts get deleted rather than maintained.

The real complication, stated plainly: some of these bundles ship INSIDE the published npm
package. `src/surfaces/web/memory-ask-browser.bundle.js` is committed, packed by `npm publish`,
and inlined into the deployed ledger page (the estate test's own header says so). So this phase
is not just wiring `deploy:website` to a build job; `publish:npm` must also get a fresh build
before it packs. Two workable shapes:

- `publish:npm` runs the builders itself (`npm run build:ask-bundle`) before `npm publish`.
  `npm pack` includes files present in the package directory whether or not git tracks them, so
  gitignoring the bundle and building it in-job works. Simplest; duplicates build time into the
  publish job.
- A `build:package-assets` job produces the bundle as an artifact; `publish:npm` adds it to
  `needs:` and receives it into the working tree before packing. One build, two consumers, at
  the cost of one more edge on the ship path.

Either way, the site build stays inside `deploy:website` for now: `public/` is ~85 MB, and the
file's own header records that keeping it out of GitLab artifact transit was a deliberate
choice. This phase moves the PACKAGE-shipped bundles first, since they are where the drift bugs
actually bit, and takes up the site build only if artifact transit proves cheap enough. Sequenced
after Phase 1 because it changes what `npm publish` packs, which deserves its own verification
pass rather than riding along with a scheduling rewrite.

Local development keeps a drift story during the transition: until a bundle stops being
committed, its estate guard stays. Guard and commit are removed together, per artifact.

## Phase 3 — patch-vs-x.y.0 conditional scope: not pursued

The idea was: some currently-always-on jobs become optional on an ordinary patch bump (`x.y.z`,
z ≠ 0) and mandatory on a fresh minor or major (`x.y.0`). A prototype (`scripts/release-scope.mjs`,
a script-level soft-skip — GitLab evaluates `rules:` at pipeline creation, before any job runs,
so a dotenv variable a job computes can never reach another job's `rules:`) was built and applied
to `e2e:heavy`, then removed.

The reason: under Phase 1's `needs:`-based scheduling, `e2e:heavy` already has `needs: []` and
gates nothing. Skipping it on a patch roll would save runner-minutes, not wall-clock — neither
push-to-deploy nor push-to-pipeline-complete change, because it was never on the critical path to
begin with. A conditional-scope mechanism only pays for itself on a job that actually sits on the
critical path, and the one candidate this plan had doesn't. Not worth the added moving part for a
cost saving alone, so this phase stops here rather than carrying speculative complexity forward.
If a future job genuinely earns a place on the critical path AND has a legitimate reason to run
lighter on patch bumps, revisit this section rather than starting over.

## Not in this plan

The nightly scheduled jobs (`dep:audit`, `renovate`, scheduled `e2e:heavy`) keep their current
shapes; they run outside the push pipeline this plan redesigns. The doc-guard sensors
(`pii:lint`, `links:check`) are already parallel, cheap, and non-gating, and only pick up
explicit `needs: []` for uniformity. Branch/MR pipeline behaviour is untouched: ship jobs are
already `main`-only by rule, and on other refs the pipeline is sensors all the way down, which
is already the philosophy.
