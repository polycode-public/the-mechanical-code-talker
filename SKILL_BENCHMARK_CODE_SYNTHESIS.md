# SKILL_BENCHMARK_CODE_SYNTHESIS.md — the SYNTHBENCH-CODE measure-then-build cycle (regenerate, run, gate, write up)

The repeatable loop that drives tmct's **deterministic code synthesis and transformation** forward
one rung at a time: run the ladder, read the rung table, decide ship-or-build, and if building, pick
the next track capability, implement it, regression-test, and re-measure. The harness is
`synthbench/code/` — a dev-only sibling of the shipped `synthbench/rules/` and `synthbench/phrasing/`
(Track 1), grading the code tracks split across `PLAN_CODE_PLANNING.md` (tmct: Tracks 1 and 5)
and seonix's `PLAN_CODE_SYNTHESIS.md` (Tracks 2-4). This skill is the loop a session RUNS every
time it wants to advance the ladder.

**The SYN ladder (`SYN-0…SYN-8`) is its own scale, drawn from this bench's own domain.**
SYNTHBENCH-CODE grades one thing: can a bounded, no-LLM search produce a code artifact — a single
edit, a synthesized expression, a repair, a planned transformation, a whole subsystem — that a REAL
toolchain then VERIFIES, with a precondition that fails refusing rather than mangling. The rungs are
named for that meaning. Do not compare a SYN rung against CHATBENCH's CEFR grade, AGENTBENCH's
`TOOL-0…TOOL-8`, or INFBENCH's `INF-1…INF-8` — same ladder shape, unrelated axes.

| rung | name | what it tests |
|---|---|---|
| SYN-0 | Observable single edit | add one line with an observable side effect (print to stdout) to a fixture function; verified by RUNNING it and reading the output |
| SYN-1 | Expression from examples | synthesize a single-expression function body from I/O examples — PBE over closed operator families (Track 3's floor), held-out-checked |
| SYN-2 | Template repair | flip one failing test with a catalogue mutation-template, the green set held (Track 2); mutation-testing-validated against overfit |
| SYN-3 | Planned single transformation | one Track-5 operator (rename), preconditions machine-checked against the graph, declared-vs-observed graph delta reconciled |
| SYN-4 | Two-step planned refactor | the §3.7 milestone: rename + move on a JS fixture, importers updated, fixture suite green, byte-deterministic re-run, poisoned variant refused, one mid-plan drift caught |
| SYN-5 | Multi-step with replanning | a plan of three or more operators where a mid-plan tier-1 drift forces a replan from observed state, not an edit against a stale snapshot |
| SYN-6 | Capability from spec | synthesize a NEW capability into the fixture app from a behavioral spec — planning + PBE composed, the spec's own acceptance tests as the oracle |
| SYN-7 | Self-source change | a planned transformation on tmct's OWN non-core source, verified by tmct's own suite (the fixture is now the repo) |
| SYN-8 | Bootstrapping | regenerate a working tmct SUBSYSTEM from its own specs and tests — the self-improvement capability `SKILL_BENCHMARK_AGI_SCALES.md` names as different-in-kind |

**SYN-0…SYN-4 are the near ladder** — each maps to a track already designed (SYN-0 and SYN-3/4 to
tmct's `PLAN_CODE_PLANNING.md` Track 5, SYN-1 to seonix's `PLAN_CODE_SYNTHESIS.md` Track 3, SYN-2
to Track 2 in the same doc), and Track 1's shipped
`synthbench/rules`/`synthbench/phrasing` is the floor beneath SYN-0 (a synthesized `GOAL_RULE` is a
code artifact through a trusted oracle, no sandbox). **SYN-5…SYN-6 are the mid ladder** — designed,
unbuilt. **SYN-7…SYN-8 are horizons**, not walls: `SYN-7` needs the self-source posture Track 5's
§8 stages as a later step past the fixture milestone; `SYN-8` edges toward open-ended
self-improvement, and the AGI-shaped version of that (improvement that rewrites the improver or the
operator catalogue itself, not a regeneration from a fixed catalogue) begins at the miss wall
`SKILL_BENCHMARK_AGI_SCALES.md` marks. Candidate literatures for the horizons are the plan docs' own:
Opdyke's behavior-preservation preconditions (1992), CEGIS, equality saturation (egg/egglog/Ruler),
APR/TBar template repair, and for self-hosting the plan-calculus lineage (Programmer's Apprentice,
Rich & Waters). Until a rung is built it sits at the honest-miss floor as a **ceiling marker**,
measured and named, never patched to a fake pass.

> **STATUS (docs-only, 2026-07-23):** this document SPECIFIES the harness; `synthbench/code/` is not
> built yet. Track 1 (`synthbench/rules`, `synthbench/phrasing`) is shipped and is the floor.
> **SYN-0 is the first build target** — the smallest end-to-end slice (one observable edit through
> the plan-act-verify loop on a JS fixture), staged in `PLAN_CODE_PLANNING.md` §3.7's sub-list.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_CODE_SYNTHESIS.md` and run a
> SYNTHBENCH-CODE cycle"* (optionally: a rung to target, a track to build, a version stamp). Until
> the harness lands, invoking it means executing the ship-or-build loop against the plan — the first
> "build" is the SYN-0 slice itself.

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the tmct
  version it measures: `BENCHMARK_CODE_SYNTHESIS_<version>.md`, raw under
  `synthbench/code/results/raw/run-<version>[_00N]/`. A RE-RUN of the same version (a harness fix, a
  second fixture, a re-verify) appends `_00N`: `BENCHMARK_CODE_SYNTHESIS_0.9.0_001.md`, `_002`, … —
  the convention `SKILL_BENCHMARK_AGENT.md` §1, `SKILL_BENCHMARK_INFERENCE.md` §1, and
  `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1 all use.
- **Record the timing.** Four wall-clock stamps: the start and end of the benchmarking session (the
  ladder run, including any sandbox test execution) and the start and end of the analysis (reading
  results and writing the report), with the date. A reader comparing two versions needs the
  measurement time and the write-up time as separate figures.
- **Fixed, versioned case set:** `synthbench/code/cases.jsonl` — one JSON object per line, keyed by
  `rung`. Append-only once the SYN arc starts: new cases may be added between cycles (record the
  addition in the write-up), existing cases are never edited or removed mid-arc — editing a case
  invalidates every prior cycle's comparison against it, the same reason every other bench's case set
  is sacred. Fixtures the cases run against (the `examples/tiny-webapp-src` source repo and its
  siblings) are versioned alongside; a fixture edit is a case edit.
- **No LLM anywhere in the loop — not in the product, not in the search, not in the dev harness.**
  Synthesis is bounded enumeration and planning over closed grammars and closed operator catalogues,
  verified by real execution. `PLAN_CODE_PLANNING.md`'s Ground rules are binding here: a harness that
  ships artifacts into `src/` is transitively the product path, so no model call may enter any search
  loop even offline.
  Assistants author the catalogues, grammars, and cases offline as reviewed static data (the Track 1
  posture); the engine executes them. Two runs over the same fixture and stamp produce byte-identical
  results (§5's determinism check).
- **Verification is REAL execution, never simulation (the Track 1 oracle posture).** A candidate is
  graded by running it through the real, unmodified toolchain — the fixture's own test runner in a
  subprocess, or the candidate code in Playwright (§6), or `graph-build.mjs`'s re-index and a
  value-compare of the observed graph delta against the step's declared effect. Never a model of the
  toolchain, never a re-derivation of the expected result; compare to pinned literals and to what the
  real run reports (`agentbench/grade.mjs`'s zero-fabrication posture).
- **The automatic-fail line: zero false-pass.** A case reported PASS whose artifact does NOT actually
  survive its full verification stack fails the whole rung outright, no matter how good the rest looks
  — the synthesis analogue of AGENTBENCH's zero-hallucination line. Equivalently: a produced artifact
  that fails a tier but is scored as a pass is a false-pass, and one is enough to fail the rung.
- **Abstention is graded first-class — a precondition that fails must REFUSE, never mangle.** Every
  rung family carries poisoned cases: a rename into a name collision, a spec no closed grammar can
  satisfy, a move that would create an import cycle, an example set with no consistent expression. The
  correct behavior is a clean refusal — no edit, no partial artifact, an honest miss with the failed
  precondition named. A refusal on a poisoned case is a PASS at the honest-miss level. A mangled or
  partial artifact emitted where the precondition failed is a hard fail, counted with the false-pass
  line above.
- **The metric set per rung.** A single number is gameable (a synthesizer that refuses everything is
  never wrong and never useful), so every rung reports:
  - **synthesis-completion** — fraction of non-abstention cases that produced an artifact clearing
    tier 0 (it parses / it runs);
  - **verified-completion** — fraction that produced an artifact passing the FULL tier stack for its
    family (real tests green, declared delta equals observed, held-out examples pass);
  - **abstention-correctness** — fraction of abstention cases answered with a clean refusal;
  - **false-pass rate** — fraction of cases scored pass whose artifact did not survive real
    verification (the automatic-fail line: must be 0).
- **The rung-gate rule (Meta-2, borrowed from AGENTBENCH/INFBENCH).** Rungs run
  **SYN-0 → SYN-1 → … → SYN-8**, strictly in that order. A rung PASSES iff **false-pass = 0 AND every
  abstention case refused correctly AND verified-completion ≥ 50%** (`COMPLETION_FLOOR = 0.5`). The
  FIRST rung that fails this gate gates every rung above it — report those higher rungs as
  **skipped-with-a-receipt** (e.g. `rung SYN-5 skipped: gated by SYN-4 verified-completion 40% <
  50%`), never silently omitted, and never read anything into their raw numbers. Don't pay to verify a
  ceiling while the floor leaks. A rung sitting at a clean floor on a not-yet-built capability is a
  **ceiling marker**, not a failure — name it as exactly that.
- **Overfit rejection folds into verified-completion, it is not optional.** A PBE candidate (SYN-1,
  SYN-6) that passes the given examples but fails a held-out example is NOT verified-complete. A repair
  candidate (SYN-2) that flips the failing test but dies under mutation-testing validation (§5) is NOT
  verified-complete. A transformation (SYN-3…SYN-8) that passes once but is not byte-deterministic on
  re-run is NOT verified-complete. Overfit is a verification failure, graded as one.
- **Bench-import direction stays one way.** The product (`src/`) never imports from `synthbench/`; the
  bench imports downward from `src/` (the planner, the code graph, `graph-build.mjs`, the adaptor once
  it exists). Verify with `grep -r 'synthbench' src/` before writing up a cycle as clean, the same
  guard AGENTBENCH holds on its own directory.

## 2. The harness — `synthbench/code/` layout

A dev-only sibling directory, never listed in `package.json`'s `files` or `exports`, exactly as
`synthbench/rules/` and `synthbench/phrasing/` sit today. The proposed shape:

- `synthbench/code/cases.jsonl` — the append-only case set (§3), keyed by rung.
- `synthbench/code/run.mjs` — the ladder driver: `--ladder` walks SYN-0→SYN-8 ascending and applies
  the gate; `--rung SYN-N` runs one; `--stamp <version>` keys the raw output dir. Provision
  `npm run synthbench:code -- --stamp <version>` when the harness lands (and verify it exists rather
  than assume it — the same lesson `SKILL_BENCHMARK_INFERENCE.md` §4 records for `npm run infbench`).
- `synthbench/code/grade.mjs` — pure deterministic grading: the four metrics (§1), the gate, the
  overfit checks, byte-determinism. No network, no model call.
- `synthbench/code/verify/` — the verification tiers (§4): the re-parse pass, the re-index +
  declared-vs-observed delta comparison, the subprocess test-runner harness, the Playwright
  `page.evaluate` / `setContent` harness.
- `synthbench/code/catalogue/` — the taught operator catalogue and the PBE/repair grammars as static
  reviewed data (rename, move, extract, inline, the PAR/TBar mutation templates, the closed
  expression grammars). Authored offline, committed, treated as data the engine runs — never
  hardcoded engine behavior.
- `synthbench/code/fixtures/` (or `examples/tiny-webapp-src`) — the source-bearing JS fixture repos
  the cases transform. `examples/mini-webapp` is the graph-only precedent (it ships `.tmct/graph.json`
  with no source); SYN needs fixtures that ship real source AND their own test suite so tiers 2–3 can
  run them.
- `synthbench/code/results/raw/run-<version>[_00N]/` — snapshotted raw output, written before the
  next run overwrites it.

## 3. Case shape per rung family

Five families, one case schema per family. Every case declares its rung, its fixture-or-grammar, its
goal-or-spec, its expected artifacts or graded properties, and whether it is an abstention (poisoned)
case.

**Family A — planned edit / transformation (SYN-0, SYN-3, SYN-4, SYN-5, SYN-7).**
```
{ id, rung, fixture,           // path to the source-bearing fixture repo state
  goal,                        // a graph-predicate goal spec (compileGoal shape), or for SYN-0 a
                               //   side-effect assertion ("stdout contains 'X' when f() runs")
  catalogue,                   // which taught operators are available this case
  expect: {
    plan,                      // the ordered operator applications (rename m.f; move f m→n; …)
    steps: [                   // per step:
      { operator, preconditions, declaredDelta } ],   // graph-delta effect, declared before execution
    tiers,                     // which verification tiers apply (0–3, §4)
    finalState },              // assertions on the re-indexed graph + suite-green
  poisoned }                   // true → a precondition MUST fail; correct output is a refusal
```
SYN-0 is the degenerate case: a one-line insertion whose declared effect is an observable side
effect, verified by tier-0 re-parse plus running the function and reading stdout. SYN-3 is one
operator with tiers 0–2. SYN-4 is the §3.7 two-step milestone with all tiers plus the byte-determinism
and drift-caught receipts. SYN-5 adds a case whose second or third step's tier-1 check finds a drift
and the loop must replan from observed state. SYN-7 points `fixture` at tmct's own non-core source and
`tiers` at tmct's own suite.

**Family B — expression synthesis from examples (SYN-1).** Track 3's shape, retained from
seonix's `PLAN_CODE_SYNTHESIS.md` §3:
```
{ id, rung, kind, signature,
  grammar,                     // the closed operator family (arith, compare/ternary, string, array)
  examples,                    // given I/O pairs — all must pass
  heldOut,                     // checked ONLY after every given example passes; a held-out miss = overfit
  poisoned }                   // true → no expression in the grammar fits; correct output is a refusal
```
Verified by `page.evaluate` in Playwright: value-compare outputs, prune on throw/timeout,
smallest-AST tie-break.

**Family C — template repair (SYN-2).** Track 2's shape:
```
{ id, rung, fixture,
  failingTests,                // the tests to flip
  greenSet,                    // the regression set that must stay green
  catalogue,                   // the PAR/TBar mutation-template catalogue available
  poisoned }                   // true → no template in the catalogue flips the target without
                               //   breaking the green set; correct output is a refusal
```
Verified by a subprocess test run over the mutated source, plus mutation-testing validation (§5).

**Family D — capability from a behavioral spec (SYN-6).**
```
{ id, rung, fixture,
  spec,                        // the behavioral spec: acceptance tests, or I/O the new capability must satisfy
  catalogue,                   // operators + expression grammars available (planning + PBE composed)
  expect: { acceptanceGreen, suiteGreen },
  poisoned }                   // true → the spec is unsatisfiable in the closed catalogue; refuse
```
The spec's OWN acceptance tests are the oracle — the synthesizer never sees a target artifact, only
the tests it must make pass while the existing suite stays green.

**Family E — bootstrapping (SYN-8).**
```
{ id, rung, target,            // a tmct non-core SUBSYSTEM: its spec docs + its own test file(s)
  catalogue,
  expect: { regeneratedGreen,  // the regenerated subsystem passes its own tests
            suiteGreen,        // tmct's full suite stays green
            byteDeterministic } }   // same specs + tests + catalogue → same regenerated source
```
The subsystem's own tests and specs are the whole oracle: regenerate the implementation, run its
tests, run the full suite, confirm byte-determinism. A subsystem the fixed catalogue cannot regenerate
lands on the honest-miss floor as a ceiling marker — the horizon named up top, not a wall.

## 4. Verification tiers (echoing `PLAN_CODE_PLANNING.md` §3.5)

Track 1's oracle posture extended to real code: run candidates through the real, unmodified toolchain,
never a simulation. Which tiers apply is declared per case (`expect.tiers`).

| tier | check | cost | families |
|---|---|--:|---|
| 0 | the produced artifact re-parses / the candidate expression runs without throwing | ms | all |
| 1 | re-index via `graph-build.mjs`, then value-compare the OBSERVED graph delta to the step's DECLARED effect — the predicted-vs-observed ledger, per step | sub-second | A (SYN-3…SYN-8) |
| 2 | blast-radius tests: the tests reachable from the touched entities via the graph's own `tests`/`calls` edges, run in the sandbox | seconds | A, C, D |
| 3 | the fixture's (or tmct's) FULL suite, at plan completion | as costed | A (SYN-4+), C, D, E |
| E | held-out example evaluation (B) / mutation-testing validation (C) — the overfit gate, run after tier 0–3 pass | sub-second to seconds | B, C, D |

Tier 1 is the transformation rungs' honest core: a mismatch between the declared delta and the
re-indexed observed delta ABORTS the plan and replans from observed state — a miss, never a guess.
This is exactly the drift SYN-4 must demonstrate-and-catch and SYN-5 must replan around. GumTree-class
tree diffing (`PLAN_CODE_PLANNING.md` §4.9) is the candidate instrument if tier 1 ever needs finer
grain than graph-delta comparison. Tier 1's re-index dependency, `PLAN_REPO_INDEX.md`'s JS/TS +
Python extractor, SHIPPED 2026-07-24 (tmct 3.0.0) — see `PLAN_CODE_PLANNING.md` §3.6 for the
remaining wiring work.

## 5. Scoring and overfitting checks

- **Pass/fail per rung** by the §1 gate: false-pass = 0, abstention-correctness = 100%,
  verified-completion ≥ 50%, in ladder order with skipped-with-a-receipt above the first failure.
- **Held-out examples (SYN-1, SYN-6).** Given examples establish candidacy; held-out examples decide
  it. A candidate is checked against held-out inputs ONLY after every given example passes, and a
  single held-out miss rejects it as overfit. This is seonix's `PLAN_CODE_SYNTHESIS.md` §3's floor
  discipline and PBE's
  standard guard (FlashFill/PROSE version-space practice).
- **Mutation-testing validation (SYN-2), mandatory per Track 2's own mitigations.** A repair that
  flips the failing test is re-checked against deliberately mutated versions of the fixture: a patch
  that survives breakage it should not survive is overfit to the test text and is rejected
  (DeMillo/Lipton/Sayward 1978; DiffTGen's lesson). The regression green-set inside the goal state is
  the second, always-on overfit guard.
- **Byte-deterministic re-run (SYN-3…SYN-8).** Same fixture, same catalogue, same plan → byte-identical
  edits and byte-identical raw output. A non-deterministic transformation is a verification failure,
  not a curiosity. Report byte-identity held / broken alongside each transformation rung, the way
  AGENTBENCH reports its determinism check.
- **The discipline checklist per write-up:** zero false-pass held, abstention correct on every poisoned
  case, held-out / mutation overfit gates clear, byte-identity verified, no `synthbench`-in-`src`
  import leak, no model call in any loop.

## 6. The sandbox (per tmct's `PLAN_CODE_PLANNING.md` §5 for the subprocess tiers, and seonix's
`PLAN_CODE_SYNTHESIS.md` §5/§7 for the Playwright tiers)

- **SYN-0, SYN-3, SYN-4, SYN-5, SYN-7 (planned transformations)** run the fixture's own test suite via
  its own runner in a **subprocess** — the mildest form of the surface, real OS-process isolation, no
  candidate-authored code executed beyond the fixture's declared tests. SYN-0's stdout check runs the
  edited fixture function the same way.
- **SYN-1, SYN-6 (synthesized JS)** execute candidate-authored expressions in **Playwright**
  (`page.evaluate`): real isolation, value-compare outputs, prune on throw/timeout. Playwright 1.61.1
  is already pinned in `devDependencies` with Chromium installed by `npm run e2e:browsers` — no new
  dependency, a new USE of an existing one, which seonix's `PLAN_CODE_SYNTHESIS.md` §6 records.
- **SYN-2 (repair)** runs the fixture's test suite over candidate-mutated source in Playwright /
  subprocess — candidate-influenced code execution, the sharper surface Track 2 carries.
- **SYN-8 (bootstrapping)** runs tmct's own suite over regenerated source in a subprocess.
- **Determinism pinned:** one engine, one Playwright version, seeded PRNGs, one fixture runner. Nothing
  in the product or the search ever samples.

## 7. The loop (one cycle; repeats until the ladder tops out or the operator stops)

**Step 1 — READ.** Read the latest `BENCHMARK_CODE_SYNTHESIS_<version>.md` (its ceiling markers and
its decision on frontiers), the code-axis open items in `NEXT.md`, tmct's `PLAN_CODE_PLANNING.md`
Track 5 status and seonix's `PLAN_CODE_SYNTHESIS.md` Track 2-4 status, and the current
`synthbench/code/cases.jsonl` rung counts. Decide whether this cycle is a
pure re-measurement or targets a specific gated rung to push past, and which track's capability that
requires.

**Step 2 — RUN the ladder.** `node synthbench/code/run.mjs --ladder --stamp <version>` (the
provisioned `npm run synthbench:code -- --stamp <version>` once it exists). The planning and
enumeration are fast and free; the sandbox test runs cost seconds to as-costed. If a cycle's fixture
suite is large, or several fixtures run in one pass, the run itself moves to a BACKGROUND task under
the coordinator model — never block the conversation on it.

> **Coordinator model — background sub-agents for the build.** Per `CLAUDE.md`'s standing working
> model, the main session is the coordinator, not the worker. A cycle that touches
> mostly-independent workstreams — a new operator in the catalogue, a new verification tier, new
> fixture-linted cases, the JS adaptor, the write-up — fans those out to background sub-agents with
> clear file-ownership boundaries, serialized on any shared file (the grader, the runner), while the
> coordinator keeps the main chat free for the operator and picks results up on each completion
> notification.

**Step 3 — READ the rung table.** For each rung, read synthesis-completion / verified-completion /
abstention-correctness / false-pass against the gate (§1). Compare against the previous
`BENCHMARK_CODE_SYNTHESIS_<version>.md` if this cycle re-measures — did any previously-clean rung's
numbers move, and is the move explained (a real change, spot-verified) or unexplained (a regression to
chase down before writing anything up)?

**Step 4 — DECIDE (apply the rung gate, §1).** Walk SYN-0→SYN-8 in order. The first ungated PASS is
real progress; the first gate failure names exactly where the ladder currently tops out, honestly,
with a receipt for every rung above it.

**Step 5 — SHIP OR BUILD.** Two outcomes:
- **Every rung gates where expected, and the ladder depth is where it should be:** ship the
  re-measurement as-is — a clean re-measurement is a legitimate, reportable outcome, not a null result.
- **A rung you want to move past is gating:** implement the next track capability that unlocks it — a
  new operator in the catalogue, the JS adaptor, a new verification tier, a re-index stage, a new
  fixture-linted case family — following the owning doc's staging (tmct's `PLAN_CODE_PLANNING.md`
  for SYN-0/3/4, seonix's `PLAN_CODE_SYNTHESIS.md` for SYN-1/2) (SYN-0's slice first, then SYN-3's
  single operator, then SYN-4's §3.7 milestone, upward). Regression-test (`npm test` green — no
  exception for engine work), and re-run this cycle from Step 2 to confirm the target rung's gate now
  passes before moving further up.

**Step 6 — WRITE the cycle up.** Snapshot the raw output first
(`synthbench/code/results/raw/run-<version>[_00N]/`), then write
`BENCHMARK_CODE_SYNTHESIS_<version>.md`: a headline naming the honest delta versus the last cycle; the
run's four timing stamps; the per-rung metric table with gate receipts (skipped-with-a-receipt lines
and named ceiling markers included); what's new this cycle, one item per change with the commit it
landed in; any deliberately-kept ceiling marker or honest red, named as a frontier, not patched
around; the discipline checklist (§5); and a decision line. **Mirror every issue the cycle leaves
open** (a ceiling marker, an unexplained rung move, an under-covered fixture) **into `NEXT.md`** as a
one-line open item pointing at this write-up — `NEXT.md` is the next-session pickup list.

**Step 7 — CONTINUE.** If the operator wants the ladder pushed further, go to Step 1 with the next
gated rung as the target. Like AGENTBENCH and INFBENCH, SYNTHBENCH-CODE cycles are coarse-grained —
one track capability is real implementation work, not a lever toggle — so each cycle ends with a
normal operator check-in, not an autonomous re-arm.

## 8. Guardrails (delivery discipline)

- **The case set and fixtures are sacred.** Append-only between cycles; never edit or delete an
  existing case or fixture mid-arc; record every addition in the write-up, and fixture-lint every new
  `expect` literal by RUNNING it, never hand-authoring a guess (the rule AGENTBENCH §4 holds on its
  own `expect.result` literals).
- **Snapshot before overwrite.** The raw dir is keyed on `--stamp`, so a same-version re-run stamps
  `_00N` rather than clobbering the prior run — a skipped snapshot is a process slip.
- **Zero false-pass is non-negotiable.** No cycle ships a change that trades verification rigor for
  completion. If a change makes the synthesizer report artifacts that don't actually survive real
  execution, it is reverted or gated off, not shipped with a caveat.
- **Abstention stays sharp.** A poisoned case that starts emitting a mangled artifact instead of
  refusing is a regression on the product's central promise, chased down before anything ships, the
  same weight AGENTBENCH gives a boundary-refusal regression.
- **Never memorize the fixture.** Operator/template/expression selection must stay grep-clean of the
  fixture's own identifiers and the case's request text — deduce from the declared catalogue, the goal
  predicates, the graph shape, and the examples, never pattern-match the target's literal spelling.
  This is what keeps a PASS honest rather than overfit to the seed cases.
- **A gated rung is reported, not hidden.** Skipped-with-a-receipt, every time, even when a gated
  rung's raw numbers look fine by coincidence — a not-yet-built capability can clear 50% on a small
  pool without the machinery that would make that number mean something.
- **Push state is session-scoped.** Commit locally with the repo-local identity; whether to push
  depends on the current session's operator authorization, same as every other loop in this repo.
- **No LLM leaks into the product, the search, or the harness.** SYNTHBENCH-CODE's whole value is a
  deterministic ruler for a deterministic synthesizer that ships artifacts a review reads as
  hand-written. A model call in any path — product, dev search loop, or grader — is rejected by
  definition (`PLAN_CODE_PLANNING.md`'s Ground rules and `PLAN_CODE_SYNTHESIS.md`'s parallel
  invariant).

## 9. One-paragraph TL;DR

Run `node synthbench/code/run.mjs --ladder --stamp <version>` (fast planning + enumeration, real
sandboxed verification, no LLM anywhere) and read the per-rung metrics — synthesis-completion,
verified-completion, abstention-correctness, false-pass — against the honest gate: **false-pass = 0
AND every poisoned case refused AND verified-completion ≥ 50%** passes a rung (SYN-0→SYN-8, strictly in
order), the first rung that fails gates every rung above it skipped-with-a-receipt, and a clean floor
on a not-yet-built rung is a ceiling marker, not a failure. Verification is REAL execution — the
fixture's own tests in a subprocess, candidate code in Playwright, `graph-build.mjs`'s observed graph
delta value-compared to the declared effect — never a simulation, and abstention is first-class: a
precondition that fails must refuse, never mangle. Overfit is a verification failure (held-out
examples for PBE, mutation-testing for repair, byte-determinism for transformation). The ladder rises
from SYN-0 (one observable edit, verified by running it) through SYN-4 (the §3.7 two-step refactor,
suite green, drift caught, poisoned variant refused) to the SYN-7/SYN-8 horizons (self-source change,
then bootstrapping a subsystem from its own specs and tests — the self-improvement capability
`SKILL_BENCHMARK_AGI_SCALES.md` names as different-in-kind, sitting at the miss wall until built, framed as a
research horizon with the plan docs' own candidate literatures, never as a wall). If every rung lands
where expected, ship the re-measurement; to push further, build the next track capability (tmct's
`PLAN_CODE_PLANNING.md` for Track 5, seonix's `PLAN_CODE_SYNTHESIS.md` for Tracks 2-4) that unlocks
the gating rung, keep `npm test` green, and re-run to confirm the gate passes.
Write up `BENCHMARK_CODE_SYNTHESIS_<version>.md` (headline delta, timing, per-rung metric table with
gate receipts, what's new, kept ceiling markers, discipline checklist, decision), snapshotting raw
output to `synthbench/code/results/raw/run-<version>[_00N]/` first and mirroring anything left open
into `NEXT.md`. This pass is docs-only: the harness is specified, `synthbench/code/` is unbuilt, and
SYN-0 is the first build target.

**Precondition for any cycle:** `synthbench/code/` must exist before this skill can run at all.
Its build (SYN-0 first: one observable edit through the plan-act-verify loop on a JS source
fixture) is an OUTPUT of `PLAN_CODE_PLANNING.md`'s (and seonix's `PLAN_CODE_SYNTHESIS.md`'s)
tracks — the plan owns the build, this skill owns the
measurement. A session invoked on this skill while the harness is absent builds it first, per
that plan.
