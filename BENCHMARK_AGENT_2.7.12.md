# BENCHMARK_AGENT_2.7.12 — the goal driver now clears all nine rungs; the resolver floor gains TOOL-7/TOOL-8 too, both from this session's router uplift

## Timing

- **Date:** 2026-07-19.
- **Benchmarking session:** four deterministic driver arms, run back to back; each arm takes low
  single-digit seconds (no LLM, no network, no judge).
- **Analysis + write-up:** immediately following, same session.

**Headline: the goal driver clears every rung, 68/68 (100%), where 2.6.0 gated at TOOL-7 (62/66,
94%).** This is a real capability move, not a ruler change: this session's TOOL-7/TOOL-8 router
uplift (a guarded RECOVER step for TOOL-7, a tied-candidate composer for TOOL-8's ambiguity
handling) landed in `src/domain/router/` earlier in this session, before this benchmark ran. The
resolver-floor arm (no goal-reasoner layer) benefited too: TOOL-7 went 0%→100% and TOOL-8 67%→100%
on that arm as well, since both rungs' fixes live in the resolver/planner layer the floor arm
already exercises, not only in the goal-reasoner's own meta-loop. The stub and shim floors are
unchanged in gate position (both still gate at TOOL-3) — expected, since neither arm routes
through the fixed code at all.

The case set grew **66 → 68**. `ab-a0-related-sofa` (TOOL-0) is confirmed new: it expects
`tmct_related({"term":"sofa"})` to actually be CALLED, not refused — the positive case 2.6.0's own
backlog item 5 asked for once `tmct_related` was registered as a real capability. It passes on the
resolver and goal arms, fails on stub/shim (expected — neither does semantic routing). The second
new case was not individually identified in this pass; the case file is append-only and diffing it
precisely against 2.6.0's exact 66-id list was not done here — flagged rather than guessed.

## Run

`node agentbench/run.mjs --driver <stub|shim|resolver|goal> --ladder --stamp 2.7.12-<driver>` — 68
cases per arm, no LLM, no network, no judge. All four exited 0. Raw (untracked, per
`agentbench/results/.gitignore`): `agentbench/results/raw/run-2.7.12-{stub,shim,resolver,goal}/product.jsonl`.

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

Every rung the 2.6.0 report named as a build target — the TOOL-8 silent-pick (backlog item 1) and
the TOOL-7 conditional-fallback double-fire (backlog item 2) — now passes. No ceiling remains on
this arm at this ladder's current depth.

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

Same TOOL-6 gate position and the same 36% number as 2.6.0 (the coverage-gap/cochange/keystone
proofs still need the goal-reasoner's composition, which this arm doesn't have) — but TOOL-7 and
TOOL-8 both moved to 100% on this arm too, since the fixes for both live below the goal-reasoner
layer.

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

Same gate as 2.6.0 (TOOL-3). `ab-a0-related-sofa` fails here as expected — a keyword matcher has
no synonym/related-word routing.

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

Same gate as 2.6.0 (TOOL-3), same shape — the shim is a transport floor, not a routing brain, by
design.

## Per-driver comparison

| | stub floor | shim transport | resolver floor | goal ceiling |
| --- | --: | --: | --: | --: |
| pass | 30/68 | 24/68 | 61/68 | **68/68** |
| plan completion | 44% | 35% | 90% | **100%** |
| result completion | 41% | 34% | 90% | **100%** |
| hallucination | **0%** | **0%** | **0%** | **0%** |
| ladder tops out | TOOL-3 | TOOL-3 | TOOL-6 | **TOOL-8 (clears everything)** |

**0% hallucination holds at every rung on all four drivers — 272 rows.** Since 2.6.0: goal ceiling
94%→100%, resolver floor 83%→90% (both via the TOOL-7/TOOL-8 fixes), stub and shim essentially flat
(42%→44%, 35%→35%) since neither reaches the router layer those fixes live in.

## What's new this cycle

- **TOOL-7's conditional-fallback double-fire is fixed.** 2.6.0 backlog item 2
  (`ab-tool7-callees-recover-callers-fnalpha` firing both branches unconditionally, with a
  duplicated primary) now passes on both the resolver and goal arms.
- **TOOL-8's silent arbitrary pick is fixed.** 2.6.0 backlog item 1 (`ab-tool8-ambiguous-depends-b`
  silently binding bare "b" to one tied candidate) now returns the declared ambiguous refusal with
  `candidateResults` on both arms.
- **`tmct_related` is now positively measurable.** `ab-a0-related-sofa` passes on resolver/goal —
  2.6.0 backlog item 5's two-gap horizon (no registry capability, no positive case) is at least
  partly closed; whether the registry/memory-fixture seam item 5 also named is fully resolved was
  not re-verified in this pass.

## Deliberately-kept honest red

None on the goal or resolver arms within TOOL-0…TOOL-5, TOOL-7, TOOL-8. The resolver floor's TOOL-6
gate (36%, unchanged from 2.6.0) is correct-and-expected: the coverage-gap/cochange/keystone
composed proofs need the goal-reasoner's own composition step, which this arm deliberately doesn't
have.

## Discipline checklist

- **Zero hallucination held** — 0% at every rung on all four drivers, 272 rows total.
- **No router lever applied during THIS benchmarking pass** — the TOOL-7/TOOL-8 fixes measured here
  landed earlier in this session, before this run; this pass is a measurement, not a build step.
- **Case set append-only** — 66 → 68; at least one new case (`ab-a0-related-sofa`) identified and
  described above.
- **`npm run test:fast` green** at the time of this run (183/183, confirmed earlier this session).

## Decision

**Ship as-is.** Both rungs 2.6.0 flagged as the highest-priority build targets (TOOL-7's
double-fire, TOOL-8's silent pick) are now fixed and measured clean on every arm that reaches them.
The next capability worth building is whatever NEXT.md's open items name next — nothing on this
ladder currently points at an unbuilt capability the way TOOL-7/TOOL-8 did last cycle.

## Backlog

1. **Identify the second new case precisely.** This pass confirmed `ab-a0-related-sofa` as new by
   inspection but did not do a full 66-vs-68 id diff against `BENCHMARK_AGENT_2.6.0.md`'s case list.
   Low priority (no behavior is in question), but the append-only discipline is cleaner with every
   addition named.
2. **Coordinator FYI, outside this axis:** the ask-bundle estate guard was stale earlier this
   session (after an unrelated merge touched its import closure) and was rebuilt before this run;
   confirmed clean (6/6) at the time of this benchmark.
