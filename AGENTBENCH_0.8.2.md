# AGENTBENCH_0.8.2 — rule-general C2 + the member-filter hop, ladder 43→56

**Headline (the honest delta):** 0.8.2 makes "C2 cleared" **rule-general** and closes the standing
C1 red. The goal-reasoner now holds **two** declared goal-rules (`coverage-invariant` +
**`cochange-risk-invariant`**) and selects between them by **pure applicability deduction**
(`applicableRules` in `src/router/goal-reasoner.mjs`): 0 applicable rules → an honest open-world
REFUSE, >1 → an honest ambiguous-meta-goal REFUSE, and **nothing in selection reads the request
string** (grep-clean of request keywords). A new **member-filter HTN method**
(`src/router/planner.mjs`) plus a per-member callees hop in the resolver driver flips the standing
C1 red `ab-c1-widget-methods-calling` green **in both drivers**. On the ladder — grown **43 → 56
cases** (+13 new fixture-linted result-composition cases) — the goal driver holds **100% plan / 98%
result / 0% hallucination** with **every rung gate-PASS**; the single red is kept deliberately
honest (below). Two post-merge runs over the same tree are byte-identical.

## The metric pair, per rung — goal driver (Stage 5), 56 cases

`node agentbench/run.mjs --driver goal --ladder --stamp 0.8.2` (raw:
`agentbench/results/raw/run-0.8.2/product.jsonl`, drivers `resolver-0.8.0` + `goal-0.8.1`)

| rung | n | **plan-compl** | **result-compl** | **halluc** | gate | reading |
| ---- | --: | --: | --: | --: | ---- | --- |
| **A0** | 7 | **100%** | **100%** | **0%** | PASS | pass-through |
| **A1** | 12 | **100%** | **100%** | **0%** | PASS | incl. the Stage-2 reach cases, held |
| **A2** | 4 | **100%** | **100%** | **0%** | PASS | refuse boundary held |
| **B1** | 6 | **100%** | **100%** | **0%** | PASS | sequences |
| **B2** | **7** | **100%** | **100%** | **0%** | PASS | +1 composition case |
| **C1** | **9** | **100%** | **100%** | **0%** | PASS | **the old red flips** — member-filter lands |
| **C2** | **11** | **100%** | **91%** | **0%** | PASS | 10/11 deduced+composed; 1 kept honestly red |
| **all** | **56** | **100%** | **98%** | **0%** | **PASS** | 0% hallucination everywhere |

## The C1-only floor the goal driver climbs (same 56 cases, `--driver resolver`, stamp `0.8.2r`)

| driver | A0–C1 | C2 plan | C2 result | overall plan | overall result |
| ---- | --- | --: | --: | --: | --: |
| `resolver` (C1 only) | **100% / 100% on every rung** | 36% | 27% | 88% | 86% |
| `goal` (Stage 5) | 100% / 100% | **100%** | **91%** | **100%** | **98%** |

The resolver floor is now clean through C1 — the member-filter hop lives below the goal-reasoner
(HTN method in the planner + the per-member callees hop in `agentbench/driver-resolver.mjs`), so
`ab-c1-widget-methods-calling` is green on BOTH axes. C2 remains the **deliberate C1-escalation
ceiling**: the 7 resolver C2 plan-reds (`ab-c2-safe-to-change`, `-goal-touch-f`, `-goal-worry-c`,
`-goal-keystone`, and the three `-cochange-*` cases) are exactly the cases that need goal deduction,
and the resolver's honest gap (result 86% < plan 88%) still strictly bites — no vacuous floor.

## What's new in 0.8.2

1. **Rule-general C2** (`e10f76b`): a second declared goal-rule, **`cochange-risk-invariant`**
   ("a module change-coupled with the focus must be tested" — cochanges(focus) ∩ untested), joins
   `coverage-invariant` in `GOAL_RULES`. The old single-rule hard-wiring is replaced by
   **`applicableRules(declaredTools, focus, mode)`** — a pure deduction over the goal model + the
   declared toolset (groundable sub-goals, declared mode, declared focusClass). Zero matches and
   multiple matches are both honest refusals, never a guess; the deduction never reads the request
   string, so there is nothing to memorize.
2. **The member-filter hop** (`81c8caa`): "which methods of X end up calling Y" decomposes via a
   declared HTN method — enumerate members(X), then a bounded per-member callees hop + reachability
   fold in the driver. Flips `ab-c1-widget-methods-calling` (the 0.8.1 standing C1 red) green in
   both drivers, with the fixture-grain mismatch (bare `render` vs dotted `Widget.render`) fixed.
3. **Ladder depth 43 → 56** (`6f5aa29`, `11744a2`, `e10f76b`): +13 result-composition cases
   (static `expect.result` literals, every truth **verified by running before pinning** —
   fixture-linted, never hand-authored guesses), spread over B2/C1/C2 incl. the cochange C2 family.
4. **Bench-import inversion** (`b94422c`): the product no longer imports from `agentbench/` —
   `hallucinationsIn`/set algebra extracted to **`src/router/call-validator.mjs`** +
   **`src/router/set-algebra.mjs`**; the bench imports downward. `grep -r 'agentbench' src/` is
   clean.
5. **Bounded runner pool** (`ddf6489`): the case loop runs under `--concurrency` (default 8) with
   order preserved — rows byte-identical to the sequential loop.

## REQUIRED NOTE (advisor F9) — 5 refuse rows vs the frozen 0.8.1_002 baseline

Five refuse rows shared with `AGENTBENCH_0.8.1_002` (`ab-a2-refuse-out-of-set`,
`ab-a2-refuse-undeclared-verb`, `ab-a2-refuse-unknown-class`, `ab-a2-refuse-unresolvable`,
`ab-c2-goal-escalate-method`) are **identical on ALL graded axes**
(pass/completed/resultCompleted/hallucinated) — only the `produced.why` provenance TEXT was
reworded by the rule-selection generalization (e.g. "the coverage-invariant is Module-scoped" →
"the declared goal-rules are Module-scoped"; "sub-goal (knows untested) not groundable…" → "no
declared goal-rule is applicable in global mode…"). A provenance-text diff against the frozen
baseline is **not a regression**; zero behavior change, verified by axis-level diff.

## The one honest red — kept deliberately

`ab-c2-what-to-test` ("what most needs a test in this codebase"): the goal driver plans and
executes correctly (backward-chains to `tmct_untested`, observes the 5-module untested set) but
does **not** compose the expected ranked answer (`app/lib/a.mjs`, the keystone). Ranking "most
needs" would require a request-keyword → priority mapping the goal model does not declare — i.e.
**request-keyword memorization**, the exact overfit the discipline forbids. It stays red until a
priority reading is *declared*, not pattern-matched. (This is result-red only: plan-completion,
termination, and 0-hallucination all hold on the row.)

## Discipline — the non-negotiables, checked

- **Zero hallucination on every rung, both drivers** (56/56 rows × 2) — the automatic-fail line, held.
- **Byte-identity**: verified **twice post-merge** — two runs over the merged tree produce identical
  rows (`run-0.8.2` goal, `run-0.8.2r` resolver); the bounded pool is proven row-identical to the
  sequential loop.
- **No overfit / leakage guards**: rule selection is grep-clean of request literals; the 13 new
  `expect.result` literals are fixture-linted (truths executed before pinning); every miss→answer
  flip vs 0.8.1_002 was spot-verified as a real behavior change at the joint gate (advisor F8/F10 —
  incl. driving the actual product CLI, not just the bench).
- **The boundary stays sharp**: undeclared verbs, out-of-set capabilities, unknown classes,
  unresolvable slots, and now un-declared/ambiguous meta-goals all REFUSE — 0 calls, honest `why`.
- **Determinism**: no LLM anywhere (AGENTBENCH grading is fully deterministic); `version` reads
  `package.json` = **0.8.2**; `npm test` green (**974**), CLI smoke exits 0.

## Decision

**0.8.2 accepted on the agent axis.** C2 is now rule-general (two declared rules + pure selection
with honest refuse semantics at both failure modes), the resolver floor is clean through C1, the
ladder is 30% deeper with fixture-linted result truths, and the bench/product dependency now points
the right way. Frontiers, named honestly and unchanged: **open-world imperative NL**, **cross-turn
anaphora slot-filling**, and **declared priority readings** (the `what-to-test` ranking seam).

Artifacts: `agentbench/results/raw/run-0.8.2/product.jsonl` (goal, 56 rows, stamp `0.8.2`) +
`run-0.8.2r/product.jsonl` (resolver, stamp `0.8.2r`); rules + selection
`src/router/goal-reasoner.mjs`; method `src/router/planner.mjs` + hop
`agentbench/driver-resolver.mjs`; extraction `src/router/call-validator.mjs` +
`src/router/set-algebra.mjs`; cases `agentbench/cases.jsonl` (56); runner pool `agentbench/run.mjs`
(`--concurrency`, default 8).
