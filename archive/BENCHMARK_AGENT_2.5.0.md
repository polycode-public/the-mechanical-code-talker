# BENCHMARK_AGENT_2.5.0 — a clean re-measurement: 56/56 on the goal driver, every rung gated PASS, and nothing moved on any of the three arms

## Timing

- **Date:** 2026-07-17 (CEST).
- **Benchmarking session + analysis:** ~21:25:00 → 21:33:31 — the three deterministic driver arms
  run and the write-up, in one sub-agent pass.
- **Note:** reconstructed from the run's wall-clock (sub-agent duration + report write time); this
  axis shared a sub-agent with INFERENCE, so a clean session-vs-analysis split was not separately
  instrumented this round. From 2.5.0 onward the four stamps are captured directly, per
  `SKILL_BENCHMARK_AGENT.md` §1.

The honest delta versus `BENCHMARK_AGENT_2.0.3.md`: **no verdict moved on any driver.** The goal
ceiling clears C2 at 100%/100%, the resolver floor gates at C2 exactly where it did, and the stub
floor gates at B1 exactly where it did. All three arms read the same numbers they read at 2.0.3.

The one item 2.0.3 left open — the resolver floor no longer planning `ab-c2-what-to-test` (its C2
plan-completion had dropped 36% → 27% somewhere in the 1.8.x–2.0.x line) — **held stable at 27%**
this cycle. The case is still one of the resolver's eight C2 misses, and it still composes on the
goal driver as part of C2's 11/11. Nothing moved it further, in either direction; the 2.0.3 reading
was not a transient.

**This cycle applied no lever.** It is a pure re-measurement at 2.5.0. No code in `src/domain/router/`
changed for this benchmark, and `agentbench/cases.jsonl` is the same 56 cases with the same ids as
2.0.3. Every number below comes from code already on `main`.

## Run

`node agentbench/run.mjs --driver <stub|resolver|goal> --ladder --stamp 2.5.0-<driver>`
— 56 cases per arm, no LLM, no network, no judge. All three exited 0. Raw:
`agentbench/results/raw/run-2.5.0-{stub,resolver,goal}/product.jsonl`.

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

Ladder: A0 → A1 → A2 → B1 → B2 → C1 → C2 — **all rungs pass the gate**, nothing held back.
Identical to 2.0.3's goal arm.

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

Gates at C2 (27% < the 50% completion floor), as it did at 2.0.3. The eight C2 misses are the
multi-step composed proofs the floor arm has no planner to build — impact chains, cochange-gated
risk checks, and `ab-c2-what-to-test`. These are the floor doing its job, not reds.

## The metric pair, per rung — stub floor, 56 cases

Driver `stub-floor` — `agentbench/run.mjs`'s default, a keyword matcher, recorded so the three arms
sit on one page.

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

The three arms separate cleanly and each earns its rung, exactly as at 2.0.3. The stub gates at B1 —
it resolves single-symbol lookups and nothing composed. The resolver clears everything up to C1 and
gates at C2's multi-step composed proofs. The goal reasoner is what closes C2, and it closes all of
it. **0% hallucination holds at every rung on all three drivers** — 168 rows, the property that has
never moved and did not move here.

## What's new this cycle

Nothing. No lever was applied and no router code changed. This is a re-measurement at 2.5.0, and
every number above comes from code already on `main`.

## Deliberately-kept honest red

**None on the goal driver.** The goal arm has no kept red: `ab-c2-what-to-test` composes its result,
as it has since 2.0.3.

The resolver floor's eight failing C2 cases are not reds — they are the floor doing its job. The arm
has no planner, and C2 is where composed proof begins; a resolver that passed them would mean the
case set had stopped discriminating.

## Discipline checklist

- **Zero hallucination held** — 0% at every rung on all three drivers, 168 rows total.
- **Determinism / byte-identity verified** — the goal arm was re-run to a scratch dir and its
  `product.jsonl` is byte-identical once the stamp field is stripped.
- **No overfit / leakage** — no code changed this cycle, so nothing could be fitted to the cases.
- **Bench-import direction one-way** — `grep -rE "(import|require).*agentbench" src/` finds nothing;
  the three `src/domain/router/` mentions of the word are comments, not imports.
- **Boundary refusals still sharp** — the refusal cases pass on the resolver and goal arms; the
  stub's B1 gate is a genuine capability floor, not a refusal failure.
- **`test:fast` green** — 172 pass, 0 fail. No source changed this cycle, so the blast radius is
  empty; the full suite's count is the coordinator's to cite from the release run.
- **Case set unchanged** — 56 cases, same ids as 2.0.3.

## Decision

**Ship as-is.** Every rung gates where it should, the goal ladder clears C2 with nothing held back,
and hallucination stays at zero. There is no rung to push past on the goal driver, so there is no
build to do here; the next AGENT cycle's useful work is deepening the case set rather than the
engine — C2's 11 cases are all green, so the ladder has more headroom than the corpus tests.

## Open item mirrored to HANDOVER.md

- The resolver floor still does not plan `ab-c2-what-to-test` (C2 plan-completion holds at 27%,
  unchanged since `BENCHMARK_AGENT_2.0.3.md`). This looks correct — the case's plan comes from the
  goal reasoner, which the floor arm does not have — and it is now stable across two cycles rather
  than a one-off drop. Decide whether the floor's expectation should move to make this a declared
  refusal rather than a bare miss.
