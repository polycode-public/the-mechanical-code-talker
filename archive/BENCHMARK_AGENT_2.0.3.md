# BENCHMARK_AGENT_2.0.3 — the goal driver closes C2's composing gap: 100%/100% on all 56 cases, every rung gated PASS

The honest delta versus `BENCHMARK_AGENT_1.7.0.md`: **exactly one case moved, and it moved on both
drivers, in opposite directions.**

`ab-c2-what-to-test` is the case every prior cycle named as the kept honest red — the plan was
right, but nothing folded it into an answer. On the **goal driver it now composes**: result
completion goes 91% → **100%** at C2, and 98% → **100%** overall. That red is closed, and this
report retires it.

On the **resolver floor** the same case went the other way: it used to produce the plan without a
result (`completed: true`, `resultCompleted: false`); it now produces no calls at all
(`completed: false`). C2 plan-completion drops 36% → **27%**. The resolver arm has no planner and
no goal reasoner, so a case whose plan now comes from the goal reasoner is a case the floor should
not be able to plan. That reads as the capability moving up a tier rather than a defect — but it
is a real floor-driver move and is logged as open rather than explained away.

Nothing else changed. 54 of 56 verdicts are byte-identical to 1.7.0 on both drivers.

**This cycle applied no lever.** It is a pure re-measurement at 2.0.3 on the operator's
instruction, so no change here is attributable to work done in this cycle — the movement landed in
the 1.8.x–2.0.x line and this is the first AGENT measurement to see it. The last AGENT figure on
record was 1.7.0.

## Run

`node agentbench/run.mjs --driver <stub|resolver|goal> --ladder --stamp 2.0.3-<driver>`
— 56 cases per arm, no LLM, no network, no judge. Raw:
`agentbench/results/raw/run-2.0.3-{stub,resolver,goal}/product.jsonl`.

## The metric pair, per rung — goal driver (Stage 5), 56 cases

Drivers `resolver-0.8.0` + `goal-0.8.1`.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| A0 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| A1 | 12 | 12 | **100%** | **100%** | **0%** | PASS |
| A2 | 4 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| B2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| C1 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| C2 | 11 | 11 | **100%** | **100%** | **0%** | PASS |
| **all** | **56** | **56** | **100%** | **100%** | **0%** | **PASS** |

Ladder: A0 → A1 → A2 → B1 → B2 → C1 → C2 — **all rungs pass the gate**, and for the first time the
ladder tops out with nothing held back. 1.7.0's single plan-correct/result-incomplete row is gone.

## The metric pair, per rung — resolver floor (Stage 1), 56 cases

Driver `resolver-0.8.0` only — no planner, no goal reasoner.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| A0 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| A1 | 12 | 12 | **100%** | **100%** | **0%** | PASS |
| A2 | 4 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| B2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| C1 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| C2 | 11 | 3 | 27% | 27% | 0% | ---- |
| **all** | **56** | **48** | **86%** | **86%** | **0%** | gated at C2 |

Gates at C2 (27% < the 50% completion floor), as it has in every prior cycle. 1.7.0 read 36%/27%
here; the plan-completion column is what moved, and only through `ab-c2-what-to-test`.

## The metric pair, per rung — stub floor, 56 cases

Driver `stub-floor`. This arm is **new to this report** — 1.7.0 measured goal and resolver only, so
there is no prior figure to compare and none is implied. It is `agentbench/run.mjs`'s default
driver, recorded here so the three arms are on one page.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| A0 | 7 | 6 | 86% | 86% | **0%** | PASS |
| A1 | 12 | 9 | 75% | 75% | **0%** | PASS |
| A2 | 4 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | 0 | 0% | 0% | **0%** | ---- |
| B2 | 7 | 0 | 0% | 0% | **0%** | skipped (gated by B1) |
| C1 | 9 | 0 | 0% | 0% | **0%** | skipped (gated by B1) |
| C2 | 11 | 3 | 27% | 27% | **0%** | skipped (gated by B1) |
| **all** | **56** | **22** | **39%** | **39%** | **0%** | gated at B1 |

## Per-driver comparison

| | stub floor | resolver floor | goal ceiling |
| --- | --: | --: | --: |
| pass | 22/56 | 48/56 | **56/56** |
| plan completion | 39% | 86% | **100%** |
| result completion | 39% | 86% | **100%** |
| hallucination | **0%** | **0%** | **0%** |
| ladder tops out | B1 | C2 | **clears C2** |

The three arms separate cleanly and each one earns its rung. The stub gates at B1 — it resolves
single-symbol lookups and nothing composed. The resolver clears everything up to C1 and gates at
C2's multi-step composed proofs (impact chains, cochange-gated risk checks). The goal reasoner is
what closes C2, and as of this measurement it closes all of it. **0% hallucination holds at every
rung on all three drivers** — the property that matters most here is the one that has never moved.

## What's new this cycle

Nothing. No lever was applied and no code changed — this is a re-measurement, on the operator's
instruction, and every number above comes from code that was already on `main`. The one
improvement (`ab-c2-what-to-test` composing on the goal driver) landed somewhere in the 1.8.x–2.0.x
line, which no AGENT cycle had measured until now; this report cannot attribute it to a commit
without a bisect, and does not guess at one.

## Deliberately-kept honest red

**None on the goal driver.** For the first time since this benchmark existed, the goal arm has no
kept red: `ab-c2-what-to-test`, named as the frontier by 1.4.1, 1.5.7 and 1.7.0 alike, now composes
its result.

The resolver floor's 8 failing C2 cases are not reds — they are the floor doing its job. The arm
has no planner, and C2 is where composed proof begins; a resolver that passed them would mean the
case set had stopped discriminating.

## Discipline checklist

- **Zero hallucination held** — 0% at every rung on all three drivers, 168 rows total.
- **Determinism / byte-identity verified** — the goal arm was re-run and its `product.jsonl` is
  byte-identical once the stamp field is stripped.
- **No overfit / leakage** — no code changed this cycle, so nothing could be fitted to the cases.
- **Boundary refusals still sharp** — the refusal cases pass on the resolver and goal arms; the
  stub's B1 gate is a genuine capability floor, not a refusal failure.
- **`npm test` green** — 2450 pass, 0 fail, run in the foreground before this cycle.
- **Case set unchanged** — 56 cases, same ids as 1.7.0; the diff found no new or removed case.

## Decision

**Ship as-is.** Every rung gates where it should, the goal ladder clears C2 with nothing held back,
and hallucination stays at zero. There is no rung to push past on the goal driver, so there is no
build to do here; the next AGENT cycle's work is to deepen the case set rather than the engine —
C2's 11 cases are now all green, which means the ladder has more headroom than the corpus tests.

One item is left open, and it is logged rather than acted on per this cycle's no-change rule:
the resolver floor's `ab-c2-what-to-test` plan regression, above.

## Open item mirrored to NEXT.md

- The resolver floor no longer plans `ab-c2-what-to-test` (`completed: true` → `false` since
  `BENCHMARK_AGENT_1.7.0.md`; C2 plan-completion 36% → 27%). Probably correct — the case's plan now
  comes from the goal reasoner, which the floor arm does not have — but unconfirmed. Decide whether
  the floor's expectation should move, or whether the resolver lost a plan it should still build.
