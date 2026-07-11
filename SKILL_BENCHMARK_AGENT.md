# SKILL_BENCHMARK_AGENT.md — the AGENTBENCH measure-then-build cycle (rung-gated, deterministic, no judge)

The repeatable loop that drives the tmct **tool-loop** measurement forward one router/planner
capability at a time: run the ladder, read the rung table, decide ship-or-build, and if building,
pick the next capability, implement it, regression-test, and re-measure. AGENTBENCH is
`agentbench/`'s harness (`agentbench/README.md` documents the mechanics in full); this skill is the
loop a session actually RUNS every time it wants to advance the ladder.

**`A0…C2` is its own scale, not CEFR or `INF-A1…C2`.** The rung labels look like CHATBENCH's CEFR
bands and INFBENCH's `INF-A1…C2` bands, but they measure a third, distinct axis: AGENTBENCH grades
**agentic capability** — can the router pick and sequence the right tool call(s) for a request,
without hallucinating a call, and without exceeding what it can honestly do. CHATBENCH's CEFR grades
linguistic complexity in conversation; INFBENCH's `INF-A1…C2` grades classical-logic inference. All
three ladders share the letter-number shape because it reads well as a ladder, not because the
rungs correspond. Don't compare an AGENTBENCH `C1` result against a CEFR C1 or an `INF-C1` result —
this is a documentation-only disambiguation; nothing in `agentbench/` is renamed by it.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_AGENT.md` and run an AGENTBENCH
> cycle"* (optionally: a driver to measure, a rung to target, a version stamp).

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the
  tmct version it measures: `BENCHMARK_AGENT_<version>.md`, raw under
  `agentbench/results/raw/run-<version>/`. A RE-RUN of the same version (a harness fix, a second
  driver, a re-verify) appends `_00N`: `BENCHMARK_AGENT_0.8.2_001.md`, `_002`, … — the same convention
  `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1 and `SKILL_BENCHMARK_INFERENCE.md` §1 already use.
- **Fixed, versioned case set:** `agentbench/cases.jsonl` — one JSON object per line
  (`id`, `rung`, `request`, `tools`, `expect`). Append-only once the AGENTBENCH arc starts: new
  cases may be added between cycles (record the addition in the write-up), existing cases are never
  edited or removed mid-arc, for the same reason CHATBENCH's case set is sacred — editing a case
  invalidates every prior cycle's comparison against it.
- **No LLM, no judge, fully deterministic.** Grading compares the produced call(s) against
  `expect.calls`/`expect.refuse`, checks termination, and checks the proof chain — pure functions in
  `agentbench/grade.mjs`, no network, no model call anywhere in this loop. Two runs over the same
  tree and stamp produce byte-identical `product.jsonl`. One run per arm is sufficient; there is no
  judge-noise tier to sample against, unlike CHATBENCH.
- **The automatic-fail line: zero hallucination.** A produced call naming a tool outside the
  declared set, or outside the registered-capability closed world (`src/router/registry.mjs`), or
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
  ladder-gating rule).** Rungs run **A0 → A1 → A2 → B1 → B2 → C1 → C2**, strictly in that order. A
  rung PASSES iff **0% hallucination at ≥50% plan-completion** (`COMPLETION_FLOOR = 0.5`,
  `agentbench/grade.mjs`). The FIRST rung that fails this gate gates every rung above it — report
  those higher rungs as **skipped-with-a-receipt** (e.g. `rung C1 skipped: gated by A2 completion
  40% < 50%`), the same Meta-2 discipline `SKILL_BENCHMARK_INFERENCE.md` §2 borrows for INFBENCH and
  `SKILL_BENCHMARK_CONVERSATION.md`'s ladder honors for flow tiers: don't pay to judge a ceiling while
  the floor leaks. `--ladder` runs the rungs ascending and applies this automatically.
- **Refusal is a legitimate pass.** For an `expect.refuse` case, a clean refusal (no call, when no
  declared tool fits or the entity does not resolve) is a PASS at the honest-miss level — refusing
  when unsure is the correct behavior, not a fallback. On an ambiguous resolved term, that refusal
  MAY also carry `candidateResults` (the same read-only tool dispatched once per tied candidate) —
  still a refusal, still a PASS, and the preferred shape going forward (`PLAN_BREADTH_FIRST_NLU.md` §4).
- **Reference bands stay illustrative, never run.** `agentbench/README.md`'s comparable-model bands
  (tiny-local, 8B-open, Nova-micro/lite, Haiku) are anchors for a future write-up, not scores this
  harness produces (no network, no LLM). Don't claim a number for them.
- **Bench-import direction stays one way.** The product (`src/`) never imports from `agentbench/`;
  the bench imports downward from `src/router/call-validator.mjs` and `src/router/set-algebra.mjs`.
  A cycle that reverses this is a real regression, not a refactor detail — verify with
  `grep -r 'agentbench' src/` before writing up a cycle as clean.

## 2. The loop (one cycle; repeats until the ladder tops out or the operator stops)

**Step 1 — READ.** Read the latest `BENCHMARK_AGENT_<version>.md` (its "one honest red kept" section, if
any, and its decision on frontiers), `ROADMAP.md`'s agent-axis items, and the current
`agentbench/cases.jsonl` rung counts. Decide which driver to measure (`--driver stub|resolver|goal`,
per `agentbench/README.md`'s pluggable-driver seam) and whether this cycle is a pure measurement or
targets a specific gated rung to push past.

**Step 2 — RUN the ladder.** `node agentbench/run.mjs --driver <driver> --ladder --stamp <version>`
(the provisioned script is `npm run agentbench:run -- --stamp <version>`). This is fast and free —
no judge concurrency to manage, unlike CHATBENCH's Step 4 — but still route it through the
coordinator model described below when it's one of several concurrent workstreams this cycle.

> **Coordinator model — background sub-agents for the build, not (usually) the run.** Per
> `CLAUDE.md`'s standing working model, the main session is the coordinator, not the worker. The
> AGENTBENCH run itself is cheap enough to run inline most cycles. What benefits from delegation is
> the SAME kind of work `SKILL_BENCHMARK_CEFR_ENGLISH.md`'s Step 2 calls out: a cycle that touches multiple
> mostly-independent workstreams — a new HTN method in `src/router/planner.mjs`, a new declared goal
> rule in `src/router/goal-reasoner.mjs`, new fixture-linted cases in `agentbench/cases.jsonl`, the
> write-up itself — can fan those out to background sub-agents with clear file-ownership boundaries,
> serialized on any shared file (the registry, `src/router/call-validator.mjs`), while the
> coordinator keeps the main chat free for the operator and picks results up on each completion
> notification. If a cycle ever needs a genuinely long run (a much larger case set, multiple drivers
> compared in one pass), that run itself moves to a background task too — never block the
> conversation on it.

**Step 3 — READ the rung table.** For each rung, read plan-completion / result-completion /
hallucination against the contract's gate (§1). Compare against the previous `BENCHMARK_AGENT_<version>.md`
if this cycle re-measures a driver already on record — did any previously-clean rung's numbers move,
and if so, is that move explained (a real behavior change, spot-verified) or unexplained (a
regression to chase down before writing anything up)?

**Step 4 — DECIDE (apply the rung gate, §1).** Walk A0→C2 in order. The first ungated PASS is real
progress; the first gate failure names exactly where the ladder currently tops out, honestly, with a
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
shape prior cycles already use (see `AGENTBENCH_0.8.2.md` for the pattern): a headline naming the
honest delta versus the last cycle; the metric-pair table per rung; a per-driver comparison when more
than one driver is measured (e.g. the resolver floor vs. the goal-reasoner ceiling); what's new this
cycle, one item per change with the commit it landed in; any deliberately-kept honest red (a case
that plans/executes correctly but doesn't compose the expected result, named as a frontier, not
patched around); the discipline checklist (zero hallucination held, byte-identity verified, no
overfit/leakage, boundary refusals still sharp, determinism); and a decision line.

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
- A pure re-measurement (no build) is a fast, cheap cycle — worth running whenever `src/router/` or
  `agentbench/cases.jsonl` changes, to catch a regression before it compounds.
- Run alongside `SKILL_BENCHMARK_CEFR_ENGLISH.md` and `SKILL_BENCHMARK_INFERENCE.md` cycles when a release
  touches both the chat surface and the router — they measure different axes of the same release
  and belong in the same write-up cadence, not necessarily the same run.

## 4. Guardrails (delivery discipline)

- **The case set is sacred.** Append-only between cycles; never edit or delete an existing case
  mid-arc; record every addition in the write-up, and fixture-lint every new `expect.result` literal
  (verify the truth by running it, never hand-author a guess) — the discipline `AGENTBENCH_0.8.2.md`
  already documents for its +13 result-composition cases.
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

Run `node agentbench/run.mjs --driver <driver> --ladder --stamp <version>` (fast, free, fully
deterministic — no judge, no LLM anywhere in this loop) and read the per-rung metric pair
(plan-completion, result-completion, hallucination) against the honest gate: **0% hallucination at
≥50% plan-completion** passes a rung (`A0→C2`, strictly in order), the first rung that fails gates
every rung above it skipped-with-a-receipt, and a clean refusal on an `expect.refuse` case is a PASS,
not a fallback — optionally carrying `candidateResults` (one real dispatched answer per tied
candidate) when the term was ambiguous, still a refusal, still a PASS. `A0…C2` is a third distinct
scale from CHATBENCH's CEFR and INFBENCH's `INF-A1…C2` —
same letter-number shape, unrelated axes, never compared across benches. If every rung lands where
expected, ship the re-measurement as-is; if you want to push the ladder further, implement the next
router/planner capability that unlocks the gating rung, keep `npm test` green, and re-run to confirm
the gate passes before moving on. Fan cycle work that decomposes into independent workstreams (a new
HTN method, a new goal rule, new fixture-linted cases, the write-up) out to background sub-agents
under the coordinator model per `CLAUDE.md`, keeping the main chat free; write up the cycle as
`BENCHMARK_AGENT_<version>.md` (headline delta, metric-pair table, per-driver comparison, what's new, any
deliberately-kept honest red, the discipline checklist, a decision).
