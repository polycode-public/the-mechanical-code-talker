# AGENTBENCH_0.8.1 — the RESULT-graded router, measured (plan vs composed answer)

**Headline (lead with the honest delta):** AGENTBENCH now **executes the plan and grades the
composed RESULT**, not just the call-plan. Under result-grading the deterministic, no-LLM
resolver/planner scores **plan-completion 97% (34/35)** but **result-completion 91% (32/35)** — the
composed answer is correct on **6 percentage points fewer** cases than the plan is, at the
non-negotiable **0% hallucination on every rung**. The gap is **concentrated in the abstract rungs**:
**C1 100% → 75%** and **C2 50% → 0%** on the result axis, while **A0–B2 hold 100% = 100%** (plan =
result). That delta is the whole point of the release: **composing a multi-step answer is strictly
harder than emitting the plan**, and the cases that pass plan-grading on a *relaxed determinable
shape* now visibly **fail result-grading**, because the true end-to-end answer is checked. Two runs
over the same tree + `--stamp 0.8.1` are byte-identical.

> ## ⚠ The caveat AGENTBENCH_0.8.0 carried — and this release RETIRES
> AGENTBENCH_0.8.0_001 graded the **call-PLAN + its causal proof, NOT the executed composed
> RESULT**: `ab-c1-untested-in-impact` passed by emitting `tmct_impact` then `tmct_untested` *in
> order*; the actual set-intersection ("which impacted modules are untested") was **never computed or
> checked**. 0.8.1 closes that hole. The harness dispatches each call, threads the **structured
> result set** (`ctx.dispatch(...).result` — the label set the query produces, mirroring the
> `dispatchTool` render\* semantics, uncapped), and **folds** the threaded results into one composed
> answer via a small set-algebra (`intersect` / `fallback-if-empty` / `guard-if-empty`). The composed
> answer is value-compared to a **static `expect.result` literal** hand-derived from the fixture and
> lint-checked against it. So "closed-world C1" now measures **reasoning that actually composes**, not
> routing that merely sequences.

## The metric pair, per rung — BOTH completion axes

`node agentbench/run.mjs --driver resolver --ladder --stamp 0.8.1`

| rung | n | **plan-compl** | **result-compl** | Δ (result−plan) | **halluc** | gate | reading |
| ---- | --: | --: | --: | --: | --: | ---- | --- |
| **A0** | 7 | **100%** | **100%** | — | **0%** | PASS | single call — the answer IS the call, nothing to fold |
| **A1** | 9 | **100%** | **100%** | — | **0%** | PASS | pick + bind — same |
| **A2** | 3 | **100%** | **100%** | — | **0%** | PASS | honest refuse — a correct null answer |
| **B1** | 6 | **100%** | **100%** | — | **0%** | PASS | sequences — two independent answers, no single fold |
| **B2** | 4 | **100%** | **100%** | — | **0%** | PASS | **conditional fold works** (fallback / guard compose correctly) |
| **C1** | 4 | **100%** | **75%** | **−25pp** | **0%** | PASS | **3 intersections compose to truth; 1 relaxed case fails result** |
| **C2** | 2 | **50%** | **0%** | **−50pp** | **0%** | PASS | ranking + goal-deduction are unbuilt — both fail result |
| **all** | 35 | **97%** | **91%** | **−6pp** | **0%** | **PASS** | 0% hallucination everywhere; result trails plan on the abstract rungs |

**Ladder:** `A0 → A1 → A2 → B1 → B2 → C1 → C2 — all rungs pass the gate`. The **gate is unchanged**
(0% hallucination AT ≥50% **plan** completion) — result-completion is reported **alongside**, never
folded into the gate, because conflating the two would hide the delta the release exists to expose.

## What result-grading proves — the honest attribution

- **The intersection is now COMPUTED and CHECKED (the retired caveat, positively).**
  `ab-c1-untested-in-impact` "of the modules impacted by app/lib/a.mjs, which are untested" —
  the planner emits `impact(a)` then `untested`; the harness executes both, folds `impact ∩ untested`,
  and the composed answer is the **four** modules `{app/lib/c.mjs, app/lib/e.mjs, app/lib/f.mjs,
  scripts/g.mjs}` — value-equal to the static `expect.result` literal. **Plan-correct AND
  result-correct.** Two sibling cases exercise the other shapes of the same fold:
  - `ab-c1-untested-in-impact-f` → **singleton** `{app/lib/e.mjs}`,
  - `ab-c1-untested-in-impact-b` → **∅** (the one impacted module is tested) — a real composed answer,
    not a miss; the harness computes and checks the empty set.
- **The conditional recipes compose correctly (B2 = 100% on both axes).**
  - `ab-b2-cond-tests-fallback` ("if c has no tests, list what covers b instead") → guard set
    `tests(c)` is empty → **fallback** to `tests(b)` = `{app/unit-tests/b.test.mjs}` ✅.
  - `ab-b2-cond-untested-describe` ("if fnAlpha is untested, describe it") → guard empty → **guarded
    action** fires → `{fnAlpha}` ✅.
  - `ab-b2-cond-untested-impact` ("if c is untested, show its impact") → `{app/functions/d/handler.mjs}` ✅.
  - `ab-b2-cond-tests-keep` (guard **non-empty** — b *does* have tests) → the fold **keeps the
    primary** `tests(b)` rather than the fallback ✅ (the other branch of the operator).
- **The honest result-FAILS — plan-correct, result-incomplete (say it plainly).** These are the cases
  the retired caveat quietly passed on the plan and this release now marks red on the result axis:
  - `ab-c1-widget-methods-calling` "which methods of Widget end up calling fnAlpha" — plan is relaxed
    to the determinable `members(Widget)`; the "end up calling fnAlpha" **reachability filter** needs a
    per-member callees hop the single-shot resolver does not emit, so **no fold is produced**. True
    answer `{Widget.render}`; result-**incomplete**. (Even the two-call `members ∩ callers(fnAlpha)`
    would not compose it: members labels are bare `render`/`name` while `callers(fnAlpha)` yields the
    dotted `Widget.render` — a real fixture-grain mismatch, which is exactly why the case is
    `overfitProne`.)
  - `ab-c2-what-to-test` "what most needs a test" — plan is relaxed to `untested` (the whole list);
    **ranking** the untested set by blast-radius is a goal-reasoner (Stage 5, unbuilt), so no fold
    ranks it. True answer `{app/lib/a.mjs}` (highest impact among the untested); result-**incomplete**.
  - `ab-c2-safe-to-change` — the genuine C2 miss carried from 0.8.0: the planner **refuses/escalates**
    (no goal model to deduce impact+tests+callers from). Fails **both** axes, honestly.

## The `expect.result` schema (new) — static literals, linted against the fixture

A composition case pins the **true composed answer** as a static array of entity labels in
`cases.jsonl`; the grader never re-derives it (no circularity):

```jsonc
{ "id": "ab-c1-untested-in-impact", "rung": "C1",
  "request": "of the modules impacted by app/lib/a.mjs, which are untested",
  "tools": ["tmct_impact", "tmct_untested"],
  "compose": "intersect",                       // documentary — the driver derives the op from the HTN method
  "expect": {
    "calls": [ {"name":"tmct_impact","input":{"module":"app/lib/a.mjs"}}, {"name":"tmct_untested"} ],
    "result": ["app/lib/c.mjs","app/lib/e.mjs","app/lib/f.mjs","scripts/g.mjs"],  // ← the STATIC composed-answer literal
    "terminates": true } }
```

- **`expect.result`** — an array of entity labels (the true end-to-end set; `[]` is a valid composed
  answer, ∅). Absent ⇒ the case has nothing to fold and its result axis **mirrors plan completion**
  (a single grounded call / a correct refusal is its own answer).
- **Lints** (`parseCases`): structure (array of non-empty strings; never on a refuse case) **plus**, when
  the fixture is supplied, a **referential** check — every literal must name a real fixture entity, so a
  stale literal **fails loudly at parse time** (mirrors the existing expected-call referential lint). The
  committed cases lint clean under this check; a test injects `app/lib/NONEXISTENT.mjs` to prove it bites.
- **`grade.mjs` imports NO composition function** — `gradeCase` only value-compares the driver's
  produced `composed` field to the literal (`sameSet`, order/duplication-insensitive). The composition
  itself lives in the **driver** (`driver-resolver.mjs` → `agentbench/results.mjs`), which picks the
  operator from the router's OWN HTN method (`relative-filter → intersect`; `conditional → fallback/guard`).

## Discipline notes

- **Composition runs INSIDE the timeout guard.** The fold executes inside `resolverDriver` — i.e.
  inside `runCase`'s `Promise.race([driver(...), guard])` (`DRIVER_TIMEOUT_MS`). No unbounded work runs
  after the driver returns, so a plan that never grounds still records a **FAIL on `terminates:true`**
  rather than hanging the 878-test suite (the exact hazard the 0.8.0 backstop closed).
- **No self-check / no circularity.** `expect.result` is a hand-derived static literal, lint-verified
  for *existence* against the fixture (not value-derived by the same code that folds). The driver's
  `composed` is new code (0.8.0's `observed` was only the first call's rendered text), so the
  produced-vs-expected comparison is purely value-level.
- **Determinism:** stamped `--stamp 0.8.1` (never `Date.now()`); re-running is byte-identical (checked).
  The `version` field reads `package.json` = **0.8.1** (raw regenerated on `main` after the 0.8.1 bump);
  stamp/label and version agree.
- **The extractor is tested, not asserted:** `test/agentbench.test.mjs` pins every result set
  (`untested`, `impact(a)`, `tests_for`, `members`, `callers`) against a hand-derived fixture truth, the
  compose operators as pure set-algebra, the two-branch `gradeCase` result axis, the referential lint,
  and the resolver e2e (result-completion **strictly below** plan-completion, at 0% hallucination).
- `npm test` green (**878** tests); CLI smoke `printf 'hi\n/exit\n' | node bin/tmct.mjs` exits 0.

## Decision

**Result-grading accepted; the 0.8.0 caveat is retired.** AGENTBENCH now measures whether the router's
plan, **executed and composed, yields the true answer** — not just whether the call sequence is
well-formed. The router **composes the closed-world folds it can determine** (all of B2, three of four
C1 intersections including the empty set) and is **honestly red where it cannot** (the C1 reachability
filter and the C2 ranking/goal-deduction, all Stage-5 frontier), at **0% hallucination on every rung**.
The demonstrated envelope an optimiser may route to the deterministic floor at $0 is now the tighter,
truer claim: **A0–B2 end-to-end, plus the determinable C1 set-folds** — not merely "emits the plan."
The frontier named honestly: **result-completion on C1 reachability + C2 (the goal-reasoner, Stage 5)**,
and the driver seam is intact for the next agent to add a **C2 goal-reasoner driver + cases** on top.

Artifacts: raw product rows in `agentbench/results/raw/run-0.8.1/product.jsonl` (35 graded rows,
`driver:"resolver-0.8.0"`, `stamp:"0.8.1"`, each with `produced.composed` + `verdict.resultCompleted`)
and the console rollup `console.txt`; harness `agentbench/run.mjs` (`--driver resolver`), grader
`agentbench/grade.mjs`, result layer `agentbench/results.mjs`, driver `agentbench/driver-resolver.mjs`,
cases `agentbench/cases.jsonl`, tests `test/agentbench.test.mjs`.
