# SKILL_BENCHMARK_AGENT.md — the AGENTBENCH measure-then-build cycle (rung-gated, deterministic, no judge)

The repeatable loop that drives the tmct **tool-loop** measurement forward one router/planner
capability at a time: run the ladder, read the rung table, decide ship-or-build, and if building,
pick the next capability, implement it, regression-test, and re-measure. AGENTBENCH is
`test-benchmarks/agentbench/`'s harness (`test-benchmarks/agentbench/README.md` documents the mechanics in full); this skill is the
loop a session actually RUNS every time it wants to advance the ladder.

**The TOOL ladder (`TOOL-0…TOOL-8`) is its own scale, drawn from this bench's own domain.**
AGENTBENCH grades **tool-use capability** — can the router pick and sequence the right tool call(s)
for a request, without hallucinating a call, and without exceeding what it can honestly do. The
rungs are named for that meaning, not borrowed from CEFR (CHATBENCH grades linguistic complexity in
conversation) or from INFBENCH's `INF-1…INF-8` logic-fragment bands. This is a real capability
progression, matching the shape external tool-use benchmarks grade on (the Berkeley
Function-Calling Leaderboard's simple→multiple→parallel→relevance categories; API-Bank's
call→retrieve-then-call→plan levels, Li et al. 2023; τ-bench's tool-agent-user setting, Yao et al.
2024; survey Qin et al. 2023):

| rung | name | what it tests |
|---|---|---|
| TOOL-0 | Direct dispatch | one obvious tool, arguments on a plate |
| TOOL-1 | Tool selection | pick the right tool from a declared set, bind one entity |
| TOOL-2 | Scope refusal | refuse cleanly when no declared tool fits / the entity doesn't resolve (BFCL relevance-detection; carries the honest miss into the router) |
| TOOL-3 | Sequential composition | a bounded multi-step recipe: thread one result into the next call |
| TOOL-4 | Conditional dispatch | branch on a result; retry |
| TOOL-5 | Goal planning | compose a plan for a novel goal, closed-world |
| TOOL-6 | Goal deduction | self-directed: deduce the goal, then plan it |
| TOOL-7 | Recovery & replanning | a plan step fails (a tool returns empty/error) and the driver observes the failure and replans a fallback rather than dying on the dead branch — `expect.recover` (grounding: ReAct/Reflexion, τ-bench recovery) |
| TOOL-8 | Composition under ambiguity | the goal/entity is underspecified: enumerate the tied readings (`expect.candidateResults`, one dispatched read per tied candidate) or refuse-with-a-nudge — never an arbitrary pick, never a hallucinated call |
| TOOL-9 | Goal recognition | infer the goal from an observed action sequence, then confirm it against a bounded scheme — N declared goals plus an explicit reject class — rather than force-fit a partial trace to the nearest goal (grounding: `PLAN_DISCOURSE_AND_RECOGNITION.md` Part B, bounded (N+1) goal recognition; plan recognition as planning, Ramírez & Geffner 2010) |
| TOOL-10 | Open-world relevance | plan when the closed-world assumption fails: the facts the request turns on are not all declared (the frame problem, recorded in `archive/PLAN_AGENTS.md` §5 R3). Grade the honest handling — bound the relevant set, or land on the miss wall naming what's missing, never a guess at the unstated world |

TOOL-0..TOOL-8 are on record clean under the goal driver (`test-benchmarks/agentbench/envelope.json`'s
`rungReached: TOOL-8`) — the replanning branch lives in the planner's own method table, the
tied-candidate composer at the resolver's binding seam. Don't compare a TOOL rung against a CEFR
grade or an `INF-*` band: same ladder shape, unrelated axes.

### The scale's upper bound (TOOL-9, TOOL-10 — defined ahead of design)

TOOL-0..TOOL-8 are reached and measured (above). TOOL-9 and TOOL-10 sit past the current ladder,
defined here so the scale extends just past what the plan docs anticipate — a measuring stick
with headroom, not a claim the router does either yet. The AGI won't sit in this sandbox; these two
rungs are where its agent-side capabilities would first register. They carry no cases in
`test-benchmarks/agentbench/cases.jsonl` today: a horizon rung's cases get authored when a design for it exists
(`PLAN_DISCOURSE_AND_RECOGNITION.md` Part B for TOOL-9; `archive/PLAN_AGENTS.md` §5 R3 for TOOL-10), the same defer-until-buildable discipline
INF-7/INF-8 hold in `SKILL_BENCHMARK_INFERENCE.md`. `SKILL_BENCHMARK_AGI_SCALES.md` maps the same
capabilities at the classic-AI level.

The measurement contract (§1) applies to them unchanged, the zero-hallucination line included: a
recognized goal outside the declared N+1 set, or a plan over undeclared facts asserted as grounded,
fails outright. Expect-shapes, sketched in the case format so a future author has a target:

- **TOOL-9** grades an inferred goal against the bounded set. `expect.inferredGoal` names the
  recognized goal or the reject class — `{"inferredGoal":"restock","reject":false}` for a trace that
  fits a declared goal, `{"reject":true}` when it fits none — the honest miss carried into
  recognition, not a forced nearest-fit.
- **TOOL-10** grades the relevance boundary: either `expect.refuse` with the missing-world reason
  named, or an `expect.relevanceBound` listing the facts the plan declared it needs and could not
  ground — the frame problem handled honestly, not a guessed-complete world.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_AGENT.md` and run an AGENTBENCH
> cycle"* (optionally: a driver to measure, a rung to target, a version stamp).

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the
  tmct version it measures: `BENCHMARK_AGENT_<version>.md`, raw under
  `test-benchmarks/agentbench/results/raw/run-<version>[_00N]/`. A RE-RUN of the same version (a harness fix, a second
  driver, a re-verify) appends `_00N`: `BENCHMARK_AGENT_0.8.2_001.md`, `_002`, … — the same convention
  `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1 and `SKILL_BENCHMARK_INFERENCE.md` §1 already use.
- **Record the timing.** The write-up carries four wall-clock stamps: the start and end of the
  **benchmarking session** (the run itself) and the start and end of the **analysis** (reading the
  results and writing the report). State the date and both intervals — a reader comparing two
  versions needs the measurement time and the write-up time as separate figures.
- **Fixed, versioned case set:** `test-benchmarks/agentbench/cases.jsonl` — one JSON object per line
  (`id`, `rung`, `request`, `tools`, `expect`). Append-only once the AGENTBENCH arc starts: new
  cases may be added between cycles (record the addition in the write-up), existing cases are never
  edited or removed mid-arc, for the same reason CHATBENCH's case set is sacred — editing a case
  invalidates every prior cycle's comparison against it.
- **No LLM, no judge, fully deterministic.** Grading compares the produced call(s) against
  `expect.calls`/`expect.refuse`, checks termination, and checks the proof chain — pure functions in
  `test-benchmarks/agentbench/grade.mjs`, no network, no model call anywhere in this loop. Two runs over the same
  tree and stamp produce byte-identical `product.jsonl`. One run per arm is sufficient; there is no
  judge-noise tier to sample against, unlike CHATBENCH.
- **The automatic-fail line: zero hallucination.** A produced call naming a tool outside the
  declared set, or outside the registered-capability closed world (`src/domain/router/registry.mjs`), or
  with an unbindable/extra required argument, fails that case outright — no matter how good the
  rest of the loop looks. Closed-world default-deny: an unregistered tool name is treated as
  UNKNOWN and rejected exactly like an invented one.
- **The metric pair per rung.** A single number is gameable (a driver that refuses everything scores
  0% hallucination at ~0% completion), so every rung reports BOTH:
  - **plan-completion** — did the driver produce the expected call sequence (or a correct honest
    refusal)?
  - **result-completion** — did executing that plan produce the expected composed result (not just
    the right call shape)?
  - **hallucination rate** — fraction of cases with any out-of-set/unbindable call.
- **The rung-gate rule (the AGENTBENCH analogue of CHATBENCH's decision rule and INFBENCH's
  ladder-gating rule).** Rungs run **TOOL-0 → TOOL-1 → … → TOOL-8**, strictly in that order. A
  rung PASSES iff **0% hallucination at ≥50% plan-completion** (`COMPLETION_FLOOR = 0.5`,
  `test-benchmarks/agentbench/grade.mjs`). The FIRST rung that fails this gate gates every rung above it — report
  those higher rungs as **skipped-with-a-receipt** (e.g. `rung TOOL-8 skipped: gated by TOOL-7
  completion 0% < 50%`), the same Meta-2 discipline `SKILL_BENCHMARK_INFERENCE.md` §2 borrows for INFBENCH and
  `SKILL_BENCHMARK_CONVERSATION.md`'s ladder honors for flow tiers: don't pay to judge a ceiling while
  the floor leaks. `--ladder` runs the rungs ascending and applies this automatically.
- **Refusal is a legitimate pass.** For an `expect.refuse` case, a clean refusal (no call, when no
  declared tool fits or the entity does not resolve) is a PASS at the honest-miss level — refusing
  when unsure is the correct behavior, not a fallback. On an ambiguous resolved term, that refusal
  MAY also carry `candidateResults` (the same read-only tool dispatched once per tied candidate) —
  still a refusal, still a PASS, and the preferred shape going forward.
- **Reference bands stay illustrative, never run.** `test-benchmarks/agentbench/README.md`'s comparable-model bands
  (tiny-local, 8B-open, Nova-micro/lite, Haiku) are anchors for a future write-up, not scores this
  harness produces (no network, no LLM). Don't claim a number for them.
- **Bench-import direction stays one way.** The product (`src/`) never imports from `test-benchmarks/agentbench/`;
  the bench imports downward from `src/domain/router/call-validator.mjs` and `src/domain/router/set-algebra.mjs`.
  A cycle that reverses this is a real regression, not a refactor detail — verify with
  `grep -r 'agentbench' src/` before writing up a cycle as clean.

## 2. The loop (one cycle; repeats until the ladder tops out or the operator stops)

**Step 1 — READ.** Read the latest `BENCHMARK_AGENT_<version>.md` (its "one honest red kept" section, if
any, and its decision on frontiers), the agent-axis open items in `NEXT.md`, and the current
`test-benchmarks/agentbench/cases.jsonl` rung counts. Decide which driver to measure (`--driver stub|resolver|goal`,
per `test-benchmarks/agentbench/README.md`'s pluggable-driver seam) and whether this cycle is a pure measurement or
targets a specific gated rung to push past.

**Step 2 — RUN the ladder.** `node test-benchmarks/agentbench/run.mjs --driver <driver> --ladder --stamp <version>`
(the provisioned script is `npm run agentbench:run -- --stamp <version>`). This is fast and free —
no judge concurrency to manage, unlike CHATBENCH's Step 4 — but still route it through the
coordinator model described below when it's one of several concurrent workstreams this cycle.

> **Coordinator model — background sub-agents for the build, not (usually) the run.** Per
> `CLAUDE.md`'s standing working model, the main session is the coordinator, not the worker. The
> AGENTBENCH run itself is cheap enough to run inline most cycles. What benefits from delegation is
> the SAME kind of work `SKILL_BENCHMARK_CEFR_ENGLISH.md`'s Step 2 calls out: a cycle that touches multiple
> mostly-independent workstreams — a new HTN method in `src/domain/router/planner.mjs`, a new declared goal
> rule in `src/domain/router/goal-reasoner.mjs`, new fixture-linted cases in `test-benchmarks/agentbench/cases.jsonl`, the
> write-up itself — can fan those out to background sub-agents with clear file-ownership boundaries,
> serialized on any shared file (the registry, `src/domain/router/call-validator.mjs`), while the
> coordinator keeps the main chat free for the operator and picks results up on each completion
> notification. If a cycle ever needs a genuinely long run (a much larger case set, multiple drivers
> compared in one pass), that run itself moves to a background task too — never block the
> conversation on it.

**Step 3 — READ the rung table.** For each rung, read plan-completion / result-completion /
hallucination against the contract's gate (§1). Compare against the previous `BENCHMARK_AGENT_<version>.md`
if this cycle re-measures a driver already on record — did any previously-clean rung's numbers move,
and if so, is that move explained (a real behavior change, spot-verified) or unexplained (a
regression to chase down before writing anything up)?

**Step 4 — DECIDE (apply the rung gate, §1).** Walk TOOL-0→TOOL-8 in order. The first ungated PASS is real
progress; the first gate failure names exactly where the ladder currently tops out, with a
receipt for everything above it.

**Step 5 — SHIP OR BUILD.** Two outcomes:
- **Every rung gates where expected, and the current ladder depth is where it should be:** ship
  as-is — a clean re-measurement is a legitimate, reportable outcome, not a null result.
- **A rung you want to move past is gating, or the case set should grow deeper:** implement the next
  router/planner capability that unlocks it (a new HTN method, a new declared goal rule, a new
  fixture-linted case family), regression-test (`npm test` green — no exception for router work),
  and re-run this cycle from Step 2 to confirm the target rung's gate now passes before moving
  further up the ladder.

**Step 6 — WRITE the cycle up.** `BENCHMARK_AGENT_<version>.md` (§1's naming convention), modeled on the
shape prior cycles already use (see the latest `BENCHMARK_AGENT_<version>.md` on record for the
pattern): a headline naming the
honest delta versus the last cycle; the metric-pair table per rung; a per-driver comparison when more
than one driver is measured (e.g. the resolver floor vs. the goal-reasoner ceiling); what's new this
cycle, one item per change with the commit it landed in; any deliberately-kept honest red (a case
that plans/executes correctly but doesn't compose the expected result, named as a frontier, not
patched around); the discipline checklist (zero hallucination held, byte-identity verified, no
overfit/leakage, boundary refusals still sharp, determinism); and a decision line. **Mirror every
issue the cycle leaves open** (the kept honest red, an unexplained rung move) **into `NEXT.md`**
as a one-line open item pointing at this write-up — `NEXT.md` is the next-session pickup list.

**Step 7 — CONTINUE.** If the operator wants the ladder pushed further, go to Step 1 of the next
cycle with the next gated rung as the target. There is no autonomous no-pause loop here the way
`SKILL_BENCHMARK_CEFR_ENGLISH.md` runs one — AGENTBENCH cycles are naturally coarser-grained (one router
capability is real implementation work, not a lever toggle), so each cycle ends with a normal
operator check-in rather than an automatic re-arm.

---

## 3. Cadence

- One cycle per router/planner capability. Unlike CHATBENCH's continuous autonomous cycles, an
  AGENTBENCH cycle's Step 5 "build" is genuine engine work (an HTN method, a goal rule, a driver
  change) — size the cycle to that, not to a fixed time box.
- A pure re-measurement (no build) is a fast, cheap cycle — worth running whenever `src/domain/router/` or
  `test-benchmarks/agentbench/cases.jsonl` changes, to catch a regression before it compounds.
- Run alongside `SKILL_BENCHMARK_CEFR_ENGLISH.md` and `SKILL_BENCHMARK_INFERENCE.md` cycles when a release
  touches both the chat surface and the router — they measure different axes of the same release
  and belong in the same write-up cadence, not necessarily the same run.

## 4. Guardrails (delivery discipline)

- **The case set is sacred.** Append-only between cycles; never edit or delete an existing case
  mid-arc; record every addition in the write-up, and fixture-lint every new `expect.result` literal
  (verify the truth by running it, never hand-author a guess).
- **Snapshot before overwrite.** The raw dir is keyed on `--stamp`, so a same-version re-run stamps
  `_00N` (`run-<version>_001`) rather than clobbering the prior run's raw output — a skipped
  snapshot is a process slip, the same rule chatbench holds.
- **Zero hallucination is non-negotiable.** No cycle ships a driver change that trades hallucination
  for completion. If a change makes the driver reckless on any rung, it is reverted or gated off,
  not shipped with a caveat.
- **Never memorize the request string.** Rule/method selection must stay grep-clean of request
  keywords — deduce from the declared toolset, the goal model, and the resolved entities, never
  pattern-match the imperative's literal words. This is what keeps a "PASS" honest rather than
  overfit to the seed cases.
- **A gated rung is reported, not hidden.** Skipped-with-a-receipt, every time, even when the raw
  numbers on a gated rung look fine by coincidence — the gate exists precisely because a
  not-yet-implemented capability can clear 50% on a small pool without the rule that would make that
  number mean something.
- **Push state is session-scoped.** Commit locally with the repo-local identity; whether to push
  depends on the current session's operator authorization, same as every other loop in this repo.
- **No LLM leaks into the product or the bench.** AGENTBENCH's whole value proposition is a
  deterministic ruler for a deterministic router; a lever that would put a model call in either path
  is rejected by definition.

## 5. One-paragraph TL;DR

Run `node test-benchmarks/agentbench/run.mjs --driver <driver> --ladder --stamp <version>` (fast, free, fully
deterministic — no judge, no LLM anywhere in this loop) and read the per-rung metric pair
(plan-completion, result-completion, hallucination) against the honest gate: **0% hallucination at
≥50% plan-completion** passes a rung (`A0→C2`, strictly in order), the first rung that fails gates
every rung above it skipped-with-a-receipt, and a clean refusal on an `expect.refuse` case is a PASS,
not a fallback — optionally carrying `candidateResults` (one real dispatched answer per tied
candidate) when the term was ambiguous, still a refusal, still a PASS. `TOOL-0…TOOL-8` is a distinct
scale from CHATBENCH's CEFR and INFBENCH's `INF-1…INF-8` — drawn from tool-use, unrelated axes,
never compared across benches. If every rung lands where
expected, ship the re-measurement as-is; if you want to push the ladder further, implement the next
router/planner capability that unlocks the gating rung, keep `npm test` green, and re-run to confirm
the gate passes before moving on. Fan cycle work that decomposes into independent workstreams (a new
HTN method, a new goal rule, new fixture-linted cases, the write-up) out to background sub-agents
under the coordinator model per `CLAUDE.md`, keeping the main chat free; write up the cycle as
`BENCHMARK_AGENT_<version>.md` (headline delta, metric-pair table, per-driver comparison, what's new, any
deliberately-kept honest red, the discipline checklist, a decision), mirroring anything left open
into `NEXT.md` as one-line pickup items.
