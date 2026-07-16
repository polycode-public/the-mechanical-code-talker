# PLAN_LAYERS_AND_TEST_ESTATE.md — five code layers, a corpus-lane test estate, and a four-stage pipeline

Status: IN DELIVERY — design agreed 2026-07-15; delivery started 2026-07-16.

## Delivery status (updated 2026-07-16)

45 commits in, suite green throughout (currently 2,352 unit/integration + 131 e2e, zero fail).

- Workstreams 1–5 are DONE: skeleton + import checker + lane harness; quick wins
  (.npmrc hardening, publint/pack gate, e2e CI stage, bench-smoke lane); supply chain and
  content (renovate 14-day cooldown, licence allowlist + corpus licence rollup, PII lint,
  clean full-history secret scan, link checker); all six corpus lanes (723 rows, every
  purge coverage-gated); the README example harness (35 tagged blocks, all ten script
  families documented and replayed by the suite).
- Workstream 6 is IN PROGRESS: the in-place layer-violation fixes are merged (import
  checker allowlist 54 → 26 edges; domain no longer imports the store, the NLP adapter,
  or reads files at import). The chat.mjs minimal split + browser-bundle shrink is in
  flight; the physical per-layer moves and the tool-contract/adapter flat-test
  migrations follow it. Flat test/*.test.mjs count: 192 → 63.
- Workstreams 7–8 and the closing 1.13.0 bump+push are not started.
- Product findings frozen as failing-safe rows for the src fix pass: the teach-lane
  garbage fact from an ask-level empty, the describe-wrapper inconsistency, the
  debt-remeasure wrong answers, and /tests answering at module level for a function.

## Goal

Three coupled transformations, done incrementally with `npm test` green at every commit:

1. Reorganise `src/` around five layers with a downward-only dependency rule:
   surfaces → tools → services → domain → adapters.
2. Rebuild the test estate around six corpus lanes, with the bulk of coverage at the tool
   layer, an `e2e/` tier beside the bench rigs, README examples executed as tests, and
   post-deploy smoke checks in CI. The new estate grows beside the old one for measurement;
   once the coverage diff shows no empty spots, the legacy files are purged.
3. Harden the quality pipeline (supply-chain, secrets, PII, licensing, docs consistency) to
   the point where publicising the repo and package carries no embarrassment risk.

Neither transformation is a greenfield rewrite. The tool layer already exists as
`src/tools/server.mjs` (`dispatchTool`), the adapter seams already exist (`src/adapters/providers/`, the
Backend B in-memory store in `src/adapters/memory/core.mjs`), and the surfaces already exist
(`src/tui/`, `server-http.mjs`, the browser bundles). The work is re-homing, naming, and
closing gaps.

## The five layers

| layer | dir | what lands there (from today's tree) |
| --- | --- | --- |
| surfaces | `src/surfaces/{tui,web,http}` | `tui/`, `server-http.mjs`, browser entries, CLI routes |
| tools | `src/tools/` | `server.mjs` dispatch, one module per tool |
| services | `src/services/` | `chat.mjs` session orchestration, `sessions.mjs`, `init.mjs`, import and viz composition |
| domain | `src/domain/` | `grammar/`, `interpret/`, `syllogise.mjs`, memory fold/trust logic, `router/` planner |
| adapters | `src/adapters/` | `providers/`, memory-store backends, wink model loader, corpus readers, source slicing |

Rules, enforced by a small import checker that runs as part of `npm test` (a custom walk of
import statements is enough; add dependency-cruiser only if the custom check grows painful):

- Imports point downward only. A layer may import from any layer below it, never above.
- `src/domain/` is pure: no filesystem, no network, no process state. It imports nothing
  outside `domain/` except other domain modules.
- Services define the ports (interfaces); adapters implement them. The memory store becomes a
  declared port with three implementations: the flat-file backend, sqlite, and the existing
  Backend B in-memory store. The browser bundle then selects the in-memory backend instead of
  stubbing node builtins at build time, which should shrink the esbuild stub plugin in
  `scripts/build-ask-bundle.mjs`.

Invariant: the chat tool reaches the other tools through the same dispatch the programmable JS
interface exposes. Chat can only do what documented tools do, so the grammar and lexicon docs
stay honest by construction.

## The tool layer is the documented product surface

Each tool colocates its definition with its documentation inputs:

- schema (name, params, result shape) and a short description;
- for chat-facing tools, additionally: the canonical grammar it accepts, lexicon hints, and
  worked examples.

The README section and the API docs are generated from these definitions (`schema-docs.mjs`
is the seed). One source of truth; hand-maintained copies of the tool list go away.

## Public exports

`package.json` `exports` shrinks from 19 subpaths to the tool layer plus a small set of
extension points (provider/extension registration, conformance). There are no external
consumers, so this ships on a minor version bump. Old subpaths are removed, not shimmed.

## The test estate

### Tiers

- `test/` — unit + integration. `npm test` stays `node --test "test/**/*.test.mjs"` and runs
  everything under `test/`, both estates, throughout the migration.
- `e2e/` — top level, beside the bench rigs. `npm run test:e2e` =
  `node --test "e2e/**/*.test.mjs"`.
- post-deploy smoke — lives in the pipeline `verify` stage, not in the repo's test globs.

### Six corpus lanes (the chat-tool estate)

The bulk of chat coverage moves from one-bug-one-file tests to data tables. Each lane is a
corpus file (JSONL) plus one runner that emits a subtest per row, so `node --test` still
reports failures individually. A bug fix adds a row, never a file. Rows carry a key
(grammar production or capability) so a small script can print the production-by-lane matrix
and make gaps visible.

| lane | rows assert |
| --- | --- |
| grammar | every parsable sentence structure → expected normal form |
| templates | sentence → template id + exact rendered answer |
| inference | taught facts + query → answer + justification |
| planning | state + goal → expected plan |
| games | scripted multi-turn dialogues; guess-a-number first |
| bench-smoke | each benchmark's runner path executes one real case end-to-end |

The bench-smoke lane covers the four benchmarks: CEFR (`chatbench/run.mjs`), inference
(`infbench/` generate + run), agent (`agentbench/run.mjs` on the stub driver), and
conversation (one scripted transcript replayed through `createSession`). Each row runs the
smallest real slice of the rig and asserts it completes and yields a gradeable result shape.
No judge calls, no network, no LLM. Quality coverage lives in the other lanes; this lane's
signal is that a benchmark is runnable, so its next full run yields a meaningful value rather
than failing mid-rig.

Layout: `test/corpus/` holds the lane data and runners, `test/tools/` holds per-tool contract
tests, `test/adapters/` holds the unit ring, including the tricky-to-trigger cases that need
verbose mocks, and `test/readme/` holds the README example harness below.

### README examples run as tests

The README's examples are extracted from the actual `README.md` at test time and executed, so
a documented example that stops working fails the suite. No copies of the examples live in the
test tree; the harness greps the fenced blocks out of the file itself.

- Every fenced block gets an info string that classifies it: `js` (library usage), `bash`
  (CLI usage), or a plain/output tag for transcript and output blocks. Today 26 blocks exist
  and most are untagged, so tagging them is the first step.
- `js` blocks run in-process in a temp dir, with the published import specifier
  (`@polycode-projects/the-mechanical-code-talker`) mapped to the repo root at extraction
  time.
- `bash` blocks run in a temp repo with `npx tmct` mapped to `node bin/tmct.mjs`. Where a
  command block is paired with an output block, the harness asserts the output.
- Fast blocks run from `test/readme/` in `npm test`. Blocks that spawn the real binary or do
  heavy corpus imports carry a marker and run from the `e2e/` tier instead.

The same harness is what enforces the "every build capability is documented" rule in the
quality-pipeline section below: a capability's README entry includes a tagged, runnable
example, so documented and runnable stay the same set.

Expected shape: today's ~190 flat files collapse to roughly 30–40 files plus corpus data.
Row count stays similar or grows; runtime falls because rows run in-process.

Naming hygiene carries over from CLAUDE.md: rows and runners are named for the behaviour
under test. The migration retires the plan-label test names ("W1 …", "W3 …") that the current
estate accumulated.

### e2e tier content

- TUI journeys: a few dozen, in-process via ink-testing-library where possible; real-binary
  spawns reserved for the flows that need a pty.
- The current slow outliers move here from `test/`: the river-crossing `--prompt` solve
  (14.7 s) and the real-binary seed gate (18.3 s).
- `npm run viz` artefacts: generate each fixture once, assert on the output files.
- Browser chat and the Pages home page served from local express, driven by Playwright
  (new dev-only dependency).

## Migration mechanics

The two estates run side by side for measurement only. The parallel period exists to prove,
via the coverage diff, that the new estate leaves no empty spots. It is a scaffold, never a
steady state: two estates asserting the same behaviour mean every refactor pays twice, so the
moment a legacy file's coverage is matched it gets purged, per lane, in the same commit that
lands the lane.

The mechanics:

1. Legacy files stay flat at `test/*.test.mjs`. The new estate grows in the subdirectories.
   Nothing renames; `npm test` runs both estates the whole way through. Progress metric: the
   flat-file count heads to zero.
2. Coverage diff gates every deletion. Run the legacy-only glob with node's built-in coverage
   (`--experimental-test-coverage`, lcov reporter) → lcov A. Run the new-only glob → lcov B.
   A compare script reports lines covered by A and not by B, per source file.
3. A legacy file is deleted only when (a) the compare report is clean for the code it
   exercised and (b) a quick read confirms each behaviour it asserted has a corpus row or a
   contract test. Coverage proves the code still runs; the row proves it still gives the same
   answer.

Layer moves interleave with the test migration, adapters first (the memory port), then
domain, services, tools, surfaces. Tests migrate with their module.

## Pipeline

Stages: `test` → `e2e` → `deploy` → `verify`. Each stage is its own column in the GitLab
pipeline graph, so each tier's pass/fail is visible at the top level.

- `test`: `npm ci && npm test`.
- `e2e`: `npm run test:e2e` (Playwright image or browser install step).
- `deploy`: the existing publish-on-version-bump and Pages jobs, unchanged.
- `verify`: the existing security scans, plus a post-deploy smoke job that runs only after a
  publish: fetch the Pages home page and the npmjs package page and assert both show the
  published version. Retries with a short delay, because registry and Pages propagation lag a
  publish by a minute or two. Smoke jobs never gate merge requests.

## Quality pipeline: publish without embarrassment

The bar: the repo and the published package can be pointed at publicly, and nothing in either
would embarrass us — no vulnerability a repo following npmjs good practice would have caught,
no secrets, no PII, no unattributed or mis-licensed content, no documentation that disagrees
with the code.

### Already in place (keep)

- SAST (semgrep) and pipeline secret detection via GitLab's stock templates.
- Nightly blocking dependency audit: `npm audit --audit-level=high` plus a pinned OSV-Scanner
  over `package-lock.json`.
- `npm publish --provenance` (Sigstore-signed via GitLab OIDC), a `files` allowlist, and
  `npm ci` in every CI job.
- Tier-2 corpuses carry `sha256` + byte counts in `tier2/manifest.json`; fetch-sourced
  corpuses are checksum-verified.
- `.tmct/` is never committed.

### Supply-chain additions

- **Dependency cooldown.** No dependency or transitive release younger than 14 days lands in
  the lockfile, so registry-hijack and worm-style releases have time to be reported and
  yanked before we pull them. Mechanism: Renovate on GitLab with `minimumReleaseAge: 14 days`
  opens the update MRs; manual updates use `npm install --before=<today minus 14 days>`.
  The lockfile is the source of truth and only changes through those two routes.
- **`.npmrc`** with `ignore-scripts=true` and `save-exact=true`. Install scripts are the main
  worm vector; tmct's dependency set (ink, react, smol-toml, wink) should need none. Step one
  is enabling it and confirming install and the full suite still pass.
- **Dependency licence check.** A CI job (license-checker or equivalent) asserts the
  production dependency tree stays inside an allowlist (MIT, ISC, BSD, Apache-2.0, MPL-2.0).

### Content sweeps (GitLab repo)

- **Secrets, full history.** The stock template scans new commits; before publicising, run a
  one-off full-history scan (gitleaks) and record the clean result. Anything found means
  rotate the secret; history rewriting is a separate operator decision.
- **PII.** A verify-stage lint job greps the repo, including `playtests/` transcripts, for
  emails, home-directory paths, and personal names beyond the intended author identity.
- **Attribution and licences for committed corpuses.** `corpus/` ships 35 MB derived from
  external sources (ConceptNet, WordNet, namenet, seon). Record the upstream source, licence,
  and any share-alike obligations per corpus, alongside the existing checksum manifest, and
  assert the record's presence with a test. ConceptNet's CC BY-SA terms make this an
  obligation, and it belongs in the README's corpus section too.

### Package and docs hygiene

- **Package contents check.** `npm pack --dry-run` diffed against an expected manifest, plus
  publint over the `exports` map, in the `test` stage. No stray files ship; no export subpath
  resolves wrong.
- **Docs consistency.** Three mechanisms already in this plan carry most of it: tool docs
  generated from tool definitions, README examples executed by the harness, and the corpus
  gap matrix. On top: a link checker over the markdown (internal links and version strings),
  in the `verify` stage.

### README and home page

- **README**: every build capability is surfaced, tested, and referenced — each package.json
  script family (chat, init and corpus imports, viz and its render variants, serve,
  demo:build, the browser bundles, the bench rigs) gets a README entry with a tagged, runnable
  example that the README harness executes. A capability with no documented example, or an
  example that fails, fails the suite.
- **Pages home page**: restructured toward chat and visual highlights — a transcript excerpt
  and the viz/plan renders up front — while keeping the steps to run the local chat and to use
  tmct as a library. Copy follows `SKILL_AGENT_PLAIN_PROSE.md`: the claim on the page, the
  proof in the benchmark write-ups, a link between them.

## Run-time budgets

Baseline measured 2026-07-15 on the dev machine: 2,356 tests, 1 m 58 s wall.

- `npm test` (unit + integration): 60–90 s once the slow spawns move to `e2e/`. Corpus rows
  are in-process and cost milliseconds; load the wink model once per file via a shared helper;
  use temp `.tmct` dirs.
- `test:e2e`: 3–4 min (TUI journeys ~1–2 min including the two slow solves; browser journeys
  under 1 min; viz artefact checks seconds).
- post-deploy smoke: under 30 s plus propagation wait.

## Sequencing

1. Skeleton: new directories, the import checker, the corpus runner harness, the coverage
   compare script. No code moves yet.
2. Quick wins: bench-smoke lane; move the two slow spawn tests to `e2e/`; add the `e2e`
   pipeline stage; `.npmrc` (ignore-scripts, save-exact); pack dry-run + publint job.
3. Supply-chain and content jobs: Renovate with the 14-day cooldown, licence allowlist check,
   PII lint, full-history secret scan, corpus attribution manifest + test.
4. Corpus lanes, lane by lane (grammar → templates → inference → planning → games), each lane
   purging the legacy files it supersedes under the coverage-diff gate, in the same commit.
5. README example harness: tag the fenced blocks, land the extractor and runners, then the
   capability-by-capability README sweep it enforces.
6. Layer moves: adapters (memory port + browser bundle backend selection), then domain,
   services, tools, surfaces.
7. Exports shrink + generated tool docs; minor version bump.
8. Playwright e2e for browser chat and the Pages page; post-deploy smoke job; home page
   restructure toward chat and visual highlights.

## Exit criteria

- Zero flat `test/*.test.mjs` files; the coverage compare script reports no legacy-only lines;
  the legacy estate is fully purged.
- The import checker passes and runs in `npm test`.
- The production-by-lane gap matrix renders from the corpus files.
- The README harness runs every tagged example green, and every package.json script family has
  a tagged README example.
- The lockfile only moves through the cooldown routes; licence, PII, pack dry-run, and link
  checks are green; the corpus attribution manifest exists and its test passes.
- README tool docs are generated, and the four-stage pipeline shows green columns for `test`
  and `e2e` on merge requests, `deploy` and `verify` on a version-bump push to main.
