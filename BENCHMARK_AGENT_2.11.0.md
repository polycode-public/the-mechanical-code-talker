# BENCHMARK_AGENT_2.11.0 — clean re-measurement, no rung moved since 2.7.12

## Timing

- **Date:** 2026-07-23.
- **Benchmarking session:** 06:58:32–06:59:02 CEST (four deterministic driver arms, run back to
  back; each arm takes low single-digit seconds — no LLM, no network, no judge).
- **Analysis + write-up:** 06:59:31–07:20 CEST, same session.

**Headline: nothing moved. Every rung gates in the same place as `BENCHMARK_AGENT_2.7.12.md`, on
all four drivers, to the percentage point.** No router/planner commit landed between 2.7.12 and
2.11.0 (`git log` confirms — see "What's new" below), so this cycle is a pure measurement pass, not
a build cycle, exactly as scoped. The goal driver still clears all nine rungs 68/68 (100%). The
resolver floor still gates at TOOL-6 (36%, 4/11). The stub and shim floors still gate at TOOL-3.

## Run

`node agentbench/run.mjs --driver <stub|shim|resolver|goal> --ladder --stamp 2.11.0-<driver>` — 68
cases per arm, no LLM, no network, no judge. All four exited 0. Raw (untracked, per
`agentbench/results/.gitignore`):
`agentbench/results/raw/run-2.11.0-{stub,shim,resolver,goal}/product.jsonl`.

## The metric pair, per rung — goal driver (Stage 5), 68 cases

Drivers `resolver-0.8.0` + `goal-0.8.1`.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 8 | 8 | **100%** | **100%** | **0%** | PASS |
| TOOL-1 | 14 | 14 | **100%** | **100%** | **0%** | PASS |
| TOOL-2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-4 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-5 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| TOOL-6 | 11 | 11 | **100%** | **100%** | **0%** | PASS |
| TOOL-7 | 3 | 3 | **100%** | **100%** | **0%** | PASS |
| TOOL-8 | 3 | 3 | **100%** | **100%** | **0%** | PASS |
| **all** | **68** | **68** | **100%** | **100%** | **0%** | **all rungs pass** |

Byte-identical shape to 2.7.12's goal table.

## The metric pair, per rung — resolver floor (Stage 1), 68 cases

Driver `resolver-0.8.0` only — no goal reasoner.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 8 | 8 | **100%** | **100%** | **0%** | PASS |
| TOOL-1 | 14 | 14 | **100%** | **100%** | **0%** | PASS |
| TOOL-2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-4 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-5 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| TOOL-6 | 11 | 4 | 36% | 36% | 0% | ---- |
| TOOL-7 | 3 | 3 | **100%** | **100%** | 0% | PASS |
| TOOL-8 | 3 | 3 | **100%** | **100%** | 0% | PASS |
| **all** | **68** | **61** | **90%** | **90%** | **0%** | gated at TOOL-6 |

Same TOOL-6 gate position and the same 36% number as 2.7.12 — the coverage-gap/cochange/keystone
proofs still need the goal-reasoner's own composition step, which this arm deliberately doesn't
have. TOOL-7/TOOL-8 clear the raw threshold on this arm (their fixes live below the goal-reasoner
layer) but stay skipped-with-a-receipt in the ladder rollup because TOOL-6 gates first.

## The metric pair, per rung — stub floor, 68 cases

Driver `stub-floor` — a dumb keyword matcher, not the router baseline.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 8 | 7 | 88% | 88% | **0%** | PASS |
| TOOL-1 | 14 | 11 | 79% | 64% | **0%** | PASS |
| TOOL-2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 0 | 0% | 0% | **0%** | ---- |
| TOOL-4 | 7 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-5 | 9 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-6 | 11 | 3 | 27% | 27% | **0%** | skipped (gated by TOOL-3) |
| TOOL-7 | 3 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-8 | 3 | 2 | 67% | 67% | **0%** | skipped (gated by TOOL-3) |
| **all** | **68** | **30** | **44%** | **41%** | **0%** | gated at TOOL-3 |

Same gate as 2.7.12 (TOOL-3), same 30/68 shape.

## The metric pair, per rung — shim transport, 68 cases

Driver `shim-transport` — the `server-http.mjs` selectTool routing, reused in-process.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 8 | 5 | 63% | 63% | **0%** | PASS |
| TOOL-1 | 14 | 7 | 50% | 43% | **0%** | PASS |
| TOOL-2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 0 | 0% | 0% | **0%** | ---- |
| TOOL-4 | 7 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-5 | 9 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-6 | 11 | 3 | 27% | 27% | **0%** | skipped (gated by TOOL-3) |
| TOOL-7 | 3 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-8 | 3 | 2 | 67% | 67% | **0%** | skipped (gated by TOOL-3) |
| **all** | **68** | **24** | **35%** | **34%** | **0%** | gated at TOOL-3 |

Same gate as 2.7.12 (TOOL-3), same 24/68 shape — the shim is a transport floor, not a routing
brain, by design.

## Per-driver comparison

| | stub floor | shim transport | resolver floor | goal ceiling |
| --- | --: | --: | --: | --: |
| pass | 30/68 | 24/68 | 61/68 | **68/68** |
| plan completion | 44% | 35% | 90% | **100%** |
| result completion | 41% | 34% | 90% | **100%** |
| hallucination | **0%** | **0%** | **0%** | **0%** |
| ladder tops out | TOOL-3 | TOOL-3 | TOOL-6 | **TOOL-8 (clears everything)** |

**0% hallucination holds at every rung on all four drivers — 272 rows.** Every number in this
table matches `BENCHMARK_AGENT_2.7.12.md`'s table exactly. No rung moved.

## What's new since 2.7.12

`git log --oneline 8c00f16..HEAD -- agentbench/ src/domain/router/` (`8c00f16` is the "roll to
2.7.12" commit) shows no commit touching `src/domain/router/` at all, and exactly one
non-version-roll commit touching `agentbench/`:

- **`9cdec16` — `agentbench/run.mjs`'s memory-fixture seeding moved onto the configured memory
  backend seam**, as part of the live-Wikipedia learn-on-miss feature. This is harness plumbing
  (how the bench materializes its fixture graph), not a routing or planning change. It does not
  touch `grade.mjs`, `driver-stub.mjs`, `driver-shim.mjs`, `driver-resolver.mjs`,
  `driver-goal.mjs`, or anything under `src/domain/router/`. The identical numbers above confirm it
  changed no measured behavior.
- Every other touch to `agentbench/envelope.json` between 2.7.12 and 2.11.0 is a version-stamp
  bump (`chore: roll <version>`), not a content change.

Case set: still 68 lines in `agentbench/cases.jsonl`, unchanged since 2.7.12 — no new cases this
cycle.

## Deliberately-kept honest red

Same one as 2.7.12: the resolver floor's TOOL-6 gate (36%) is correct-and-expected, not a defect —
the coverage-gap/cochange/keystone composed proofs need the goal-reasoner's own composition step,
which this arm deliberately doesn't carry. No new honest red surfaced this cycle.

## Discipline checklist

- **Zero hallucination held** — 0% at every rung on all four drivers, 272 rows total.
- **No router lever touched this cycle** — this was a measurement pass only, per the task scope;
  `git log` confirms no `src/domain/router/` commit landed between 2.7.12 and 2.11.0.
- **Case set append-only, unchanged** — still 68 cases, no addition or edit this cycle.
- **Bench-import direction stays one-way** — `grep -rn "from ['\"].*agentbench\|require(['\"].*agentbench\|import.*agentbench" src/` returns nothing; the handful of `grep -r 'agentbench' src/` hits are comments describing the relationship, not imports.
- **Byte-identity of the numbers against 2.7.12** verified by direct table comparison — every
  rung, every driver, matches to the percentage point.

## Decision

**Ship as-is.** No rung gates earlier than 2.7.12 recorded, so there is nothing to chase. The
resolver floor's TOOL-6 gate remains the next capability worth building when engine work is back
in scope (the goal-reasoner's composition step, ported down to the resolver-only arm) — not
attempted here, per this cycle's explicit measurement-only scope.
