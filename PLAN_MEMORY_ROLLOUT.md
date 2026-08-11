# PLAN_MEMORY_ROLLOUT.md — container-image Lambdas with sqlite seeds, and the live-ops close-out

Status: DESIGN — decided by the operator on 2026-08-11; build starts on the operator's go.
This doc continues `PLAN_MEMORY_BACKEND.md` (Status: BUILT) into its rollout: every code
phase of that plan is merged and deployed, and this plan owns what the first days of live
traffic taught, the container re-packaging the operator chose, and the remaining
operator-gated data loads. A fresh session resumes from here plus `NEXT.md`.

## 1. Where the deployment stands (verified live, 2026-08-11)

Version 6.0.9 is deployed. Working, proven by pipeline and by hand against the real edge:

- The row service end to end: PUT/GET/meta, soft deletes, the global cap counter, the
  purge — `smoke:post-deploy`'s api probe is green.
- The turn service: real turns over HTTP, corpus-supplemented answers with the T4 marker,
  the honest miss, rate caps — the smoke turn probe is green.
- The corpus surface: `corpus:load` loads wordnet-complete (206,357 rows) every pipeline
  and the read route serves it (`smoke`'s corpus probe finds "dolphin").
- Every deployed page e2e, the thin news page's rendering, and the site itself.

Broken, with the failure fully characterized:

- **The news worker OOMs on every real cycle.** At 3008 MB (this account's Lambda memory
  quota ceiling — 4096 was rejected at deploy): init completes in ~2 s, the cycle then
  runs 97–183 s of real work and dies at exactly `Max Memory Used: 3008 MB`,
  `Runtime.OutOfMemory`. Lambda's async invoke auto-retries re-drive each event up to
  twice more, so one button press bills up to three ~2-minute OOM runs. The pipeline's
  `e2e:deployed:news-live` job (added for exactly this — it presses the real start button
  and waits for real ingestion) is the standing acceptance gate: it is red today and goes
  green when this plan's R-phases land.
- **Why it OOMs**: the worker holds the 61,724-fact xl seed roughly three times — the
  parsed seed payload, `wrapRowBackend`'s wire-row projection of every seed fact (which
  exists only so seed keys can be excluded from writes), and the assembled working
  payload — plus a live cycle's own churn. The in-page version never paid this: it used
  the payload directly.
- **The seed's size is not the knob.** The xl seed on the worker is correctness, not
  fat: the newsworthiness gate's novelty test reads the seed's whole vocabulary as its
  prior-term universe (a small seed makes common words look novel — junk hubs; measured:
  a 688-fact seed yielded a spurious "geneva" hub the production seed correctly
  suppresses), and grounding parity is the feed's product claim. The turn service's
  per-query band retrieval cannot substitute: a cycle evaluates novelty across thousands
  of terms at once, far past the bounded per-turn query budget. `PLAN_MEMORY_BACKEND.md`
  §29.19 records the asymmetry; the number of in-memory COPIES is the knob.

## 2. The decision: one container image, sqlite seeds, all three Lambdas

The operator chose (2026-08-11): move the Lambdas to container images on a Node 24 base,
with the seeds pre-baked as sqlite files in the image, uniformly across the fleet.

What this buys, in order of force:

- **No init parse.** Opening a pre-built sqlite seed is milliseconds; the 40 MB
  JSON.parse that forced the full-vCPU sizing disappears.
- **The projection copy dies by design.** Seed-key exclusion becomes a keys-only set (or
  `EXISTS` queries) read from sqlite, not a full wire-row materialization.
- **Node 24, which sqlite requires.** tmct's sqlite store rides the built-in
  `node:sqlite`; managed Lambda runtimes stop short of Node 24 — a container ships the
  real runtime, so Backend C works unmodified. (The current zip bundles work only
  because esbuild targets node20 and nothing hits a newer API at runtime.)
- **Artifact room**: 10 GB image limit vs the zip path's 250 MB; both seed files ride
  trivially; uniform base = one cache, one patch surface.

What it does NOT change, stated so nobody re-learns it:

- **The 3008 MB quota applies to container images too.** Packaging never raises memory.
  The bet is that ONE assembled payload plus cycle churn fits where three copies did
  not. The parallel lever if it doesn't: an AWS service-quota increase (Lambda function
  memory, 3008 → 10240) — an operator request, likely quick, pennies at demo traffic.
- **The engine stays synchronous over one assembled payload.** sqlite feeds assembly;
  it does not make resolution lazy. Term-lazy resolution remains the recorded horizon in
  `PLAN_MEMORY_BACKEND.md` §30.
- **Seed assignments keep §3.18's design**: the image carries BOTH seeds
  (`mid-seed.sqlite`, `xl-seed.sqlite`); the turn service opens mid (its cold-start
  trade is deliberate; WordNet/ConceptNet come per-query from the bands), the news
  worker opens xl. If the operator ever wants the turn service on xl too, that is a
  §3.18 revision with its own cold-start measurement, not a config drift.

## 3. The R-phases

Written to be built by Sonnet-tier implementers; R2 is the engine-adjacent one and earns
Opus. Same campaign rules as the parent plan: worktree sub-agents, blast-radius testing,
full suite only at push moments, `e2e:deployed:news-live` is the rollout's acceptance.

- **R0 — the seed sqlite build** (Sonnet). A script (`scripts/build-seed-sqlite.mjs` or
  per-seed pair) that writes `mid-seed.sqlite` and `xl-seed.sqlite` from the same seed
  pipelines that build the JSON today, THROUGH the sqlite store's own writer
  (`createSqliteMemoryStore` / the M3-refactored persist), so bytes and semantics match
  Backend C exactly. Deterministic output, digest printed, a fixture-scale test pinning
  a round trip (write → open → payload equals the JSON-built payload). npm scripts
  `build:seed-sqlite:*`; artifacts gitignored, built in CI like every other bundle.
- **R1 — the image** (Sonnet). One `Dockerfile` (repo root or `server/`): Node 24 slim
  base, the three ESM bundles, both seed sqlite files, `CMD` overridden per function.
  Local verification via the AWS Lambda Runtime Interface Emulator (`docker run` +
  curl the RIE endpoint): each handler answers; the worker handler must show
  millisecond-class seed open, no JSON parse. Also wire the worker's `log` seam to
  console here — the deployed worker currently logs NOTHING (its silence cost a day of
  blind 502s), so cycles must narrate phases with timestamps to CloudWatch.
- **R2 — the sqlite seed overlay** (Opus). The seam change: the worker (and the turn
  service, mid) opens its seed as a read-only sqlite store instead of receiving a parsed
  `basePayload`. `wrapRowBackend` (or a sibling entry) takes the store handle, assembles
  base ⊕ session rows once, and excludes seed keys via a keys-set built from sqlite
  (small) — never a full wire-row projection. M1's invariant is non-negotiable and keeps
  its pin: `putRows` provably never receives a seed row. Add a memory assertion to the
  worker's tests: a fixture cycle's peak heap stays under a stated budget, so the diet
  can't silently regress.
- **R3 — infra** (Sonnet). CDK: the three `lambda.Function`s become container-image
  functions. Preferred shape: a fixed ECR repo + `DockerImageFunction`/`fromEcr` with an
  image tag passed via context (deterministic; `cdk synth`/`deploy` never needs a Docker
  daemon), rather than `DockerImageAsset` (which builds at synth and would force Docker
  into the deploy job). Everything else carries over unchanged: env vars, the function
  URLs + OAC, the /api/* behaviors, BOTH CloudFront permissions per function
  (`lambda:InvokeFunctionUrl` AND `lambda:InvokeFunction` — see §5), the reconcile rule,
  the invoke grants. Sharp edge: swapping packaging REPLACES the functions — new
  function URLs mint, CloudFront origins update in the same deploy (CDK wires it), one
  brief API blip is accepted. Also set the news worker's async `EventInvokeConfig` to
  `retryAttempts: 0` — a failed cycle should read as one failed cycle the visitor can
  re-press, not three auto-billed retries.
- **R4 — CI** (Sonnet). A `build:image` job (kaniko on the shared runners — no
  privileged Docker needed) builds and pushes the image tagged with the commit SHA to
  the ECR repo, before `deploy:website`; the deploy passes the tag through context. The
  three `build:*-service`/`build:news-worker` esbuild steps and the seed builds move
  into (or feed) the image build. OIDC role needs ECR push added.
- **R5 — acceptance and close.** The standing gates: `e2e:deployed:news-live` green
  (press start on the live page → real ingestion → stop & forget), `smoke:post-deploy`
  green, cycle peak memory visible in the worker's new CloudWatch narration. Record the
  measured cycle peak in this doc's build marker. If the one-copy working set still
  exceeds 3008 MB, the quota request (§2) unblocks without code change.

## 4. The operator-gated data loads (mop-up from NEXT.md)

- **conceptnet-full — staged, awaiting one command.** 147,922 of 2,344,809 rows are in
  the live band (the first run died on a transient DynamoDB 500; the loader now retries
  — 5 attempts, exponential backoff, full jitter). The built jsonl, its NOTICE, and the
  dump sit in the session scratchpad
  (`/private/tmp/claude-501/-Users-antony-projects-polycode-projects-the-mechanical-code-talker/25aaa718-8e2f-446f-97b2-78a35a914eb8/scratchpad/`):
  `conceptnet-full.band.jsonl` (2,344,809 rows, 3.02 GiB, sha256
  `7937e30c…ad8e91c`), `conceptnet-full.band.jsonl.NOTICE`, `conceptnet-dump.tsv`
  (9.46 GiB). The load is idempotent and resumes from what is there. The command
  (permission-gated away from the assistant; the operator runs it, ~$6 one-time write
  cost):
  `AWS_PROFILE=tmct-prod node bin/tmct.mjs corpus load conceptnet-full --table tmct-prod-prod-website-RowServiceTable2B650E09-1AG9XEDHMG359 --source <scratchpad>/conceptnet-full.band.jsonl`
  Then verify: `bandStatus` manifest read-back plus a `queryBandTerm("dog")` probe.
  If the scratchpad has been cleaned, rebuild: re-download the dump (URL in the build
  script's header), `node scripts/corpus-bands/build-conceptnet-full.mjs --source <tsv>`
  (now streams; digest must match the sha256 above for the same dump).
- **wikidata-slice — full-dump route chosen; the download is operator-run.**
  `bash scripts/resume-wikidata-dump.sh` resumes it from any interruption and verifies
  the final byte count. Target: `~/tmct-dumps/wikidata-latest-all.json.gz`
  (155,314,703,515 bytes from
  `https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz`; resume with
  `curl -sS -L -C - -o <target> <url>` — it was hours from done at ~4 MB/s). Then:
  pass A streams `gzip -dc` and extracts the 12 committed `SEED_QIDS` entities' lines
  (strip the dump's per-line trailing commas); a small node script derives the object
  QIDs from their mapped claims (`WIKIDATA_PROPERTY_RELATIONS`, shared with
  wikidata-live.mjs); pass B extracts those object entities' lines; concatenate to a
  dump-derived JSON-lines slice; `node scripts/corpus-bands/build-wikidata-slice.mjs
  --source <slice>`; `tmct corpus load wikidata-slice` against the same table (also
  operator-gated). CC0, no notice. Growing the slice later = adding SEED_QIDS and
  re-running.
- The corpus CLI needs the table name; the stack output is the authority:
  `aws cloudformation describe-stacks --region eu-west-2 --stack-name
  tmct-prod-prod-website --query "Stacks[0].Outputs[?OutputKey=='RowTableName'].OutputValue"
  --output text` (awscli v1 ignores `AWS_REGION`; always pass `--region`).

## 5. Live-ops facts a fresh session must not re-learn

Each of these cost a red pipeline or a blind hour to establish; all are encoded in code
or tests now, listed here so nobody re-derives them:

- **CloudFront OAC → Lambda function URLs** needs, together: the origin request policy
  `ALL_VIEWER_EXCEPT_HOST_HEADER` (forwarding the viewer Host invalidates SigV4), BOTH
  resource-policy grants for `cloudfront.amazonaws.com` (`lambda:InvokeFunctionUrl` and
  `lambda:InvokeFunction` — CDK's origin helper adds only the first), a client-computed
  `x-amz-content-sha256` on every body-carrying request (Lambda URLs reject unsigned
  payloads), and no body on DELETE (CloudFront signs DELETE body-less — hence the
  `POST /api/sessions/:uuid/rows/delete` twin the clients and smoke use).
- **Account limits**: Lambda memory quota ceiling 3008 MB; ANY reserved concurrency is
  rejected (the account sits at the service floor). Both surface only at deploy time.
- **DynamoDB**: a FilterExpression may not reference key attributes (the fake document
  client now enforces this so tests catch it); transient 500s are routine at
  million-row scale (the corpus loader retries; the SDK's own retries cover the row
  backend); the live table is CloudFormation-named — never hardcode
  `tmct-prod-prod-rows`, read the `RowTableName` output.
- **Bundling**: the server bundles are ESM (`handler.mjs`, `--format=esm`, a
  `createRequire` banner) because CJS leaves `import.meta.url` empty and chat.mjs's
  sprite path constant kills init; the stack's existence checks reference
  `handler.mjs`; keep bundle format and stack checks in lockstep.
- **Tests vs real clocks**: the retrieval budgets are wall-clock by design; tests that
  prove grounding (not budget behavior) pass `retrievalBudgets: { wallTimeMs: 60_000 }`
  through the turn service's seam, or they flake on any saturated machine.
- **CI images**: `deploy:website` and `corpus:load` need the python+node image (the
  awscli fallback installs via pip); the default node image has no pip.
- **The deployed news probe** (`e2e:deployed:news-live`) is deliberately its own job —
  its multi-minute wait budget must not ride in the fast page matrix.

## 6. Also open, unrelated to the rollout

- `PLAN_WIKIPEDIA_BAND.md` — the deferred simplewiki-derived band, design stub only.
- The scratchpad artifacts above are session-temporary; anything still needed after the
  loads complete should not be assumed present later.
