# BENCHMARK_AGENT_1.4.1 — unchanged since 0.8.2; a clean re-confirmation, not a null finding

**Headline:** first AGENTBENCH re-run since `0.8.2`, against the current **1.4.1** codebase (per
`package.json`). This session's work touched `src/completions/`, `src/syllogise.mjs`,
`src/chat.mjs`'s memory/fact-query lanes, `chatbench/`, `PLAN_AGENTS.md`-adjacent corpus/ontology
files, and packaging — nothing in `src/router/`, `agentbench/`, or the goal-reasoner's own rule
set. The numbers below are, case-for-case, byte-identical to `AGENTBENCH_0.8.2.md`'s own table —
the honest, correct result of a re-measurement against unchanged router code, not a stale copy.

**Timing** (from real result-file mtimes and the write-up commit timestamp; both runs were fast,
foreground, single-shot commands, not backgrounded — start times below are the moment each `node
agentbench/run.mjs` invocation was issued):

| stage | time | duration |
| --- | --- | --- |
| goal-driver run start (approx.) | 2026-07-10 ~12:15:40 BST | — |
| goal-driver run end (`run-1.4.1/product.jsonl` mtime) | 2026-07-10 12:16:30 BST | ~50s |
| resolver-floor run end (`run-1.4.1r/product.jsonl` mtime) | 2026-07-10 12:24:15 BST | — |
| write-up committed (`3ab1ef0`) | 2026-07-10 12:24:55 BST | **~9m15s** (goal-driver start→write-up-end) |
| concurrency | 8 (`DEFAULT_CONCURRENCY`, `agentbench/run.mjs`), 56 cases per run | |

## The metric pair, per rung — goal driver (Stage 5), 56 cases

`node agentbench/run.mjs --driver goal --ladder --stamp 1.4.1` (raw:
`agentbench/results/raw/run-1.4.1/product.jsonl`, drivers `resolver-0.8.0` + `goal-0.8.1`)

| rung | n | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | ---- |
| A0 | 7 | **100%** | **100%** | **0%** | PASS |
| A1 | 12 | **100%** | **100%** | **0%** | PASS |
| A2 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | **100%** | **100%** | **0%** | PASS |
| B2 | 7 | **100%** | **100%** | **0%** | PASS |
| C1 | 9 | **100%** | **100%** | **0%** | PASS |
| C2 | 11 | **100%** | **91%** | **0%** | PASS |
| **all** | **56** | **100%** | **98%** | **0%** | **PASS** |

Ladder: A0 → A1 → A2 → B1 → B2 → C1 → C2 — **all rungs pass the gate**. The single plan-correct/
result-incomplete row is unchanged: `ab-c2-what-to-test` (plan is right, no composed result folds
to an answer) — the same deliberately-honest composing gap `0.8.2` reported, not a regression.

## The C1-only floor the goal driver climbs (same 56 cases, `--driver resolver`, stamp `1.4.1r`)

| driver | A0–C1 | C2 plan | C2 result | overall plan | overall result |
| ---- | --- | --: | --: | --: | --: |
| `resolver` (C1 only) | 100% / 100% on every rung | 36% | 27% | 88% | 86% |
| `goal` (Stage 5) | 100% / 100% | **100%** | **91%** | **100%** | **98%** |

Gated at C2 completion 36% < 50% for the resolver-only floor — the same 7 case ids fail for the
same reason as `0.8.2`: `ab-c2-safe-to-change`, `-goal-touch-f`, `-goal-worry-c`, `-goal-keystone`,
`-cochange-ship-a`, `-cochange-precheck-a`, `-cochange-regress-a` — every one of them a case that
genuinely needs goal deduction (the resolver alone can't reach a proof chain for them, ;
the goal driver's rule-general `applicableRules` selection is what closes the gap).

## What moved since 0.8.2 — checked directly, not assumed from matching headline numbers

**Nothing.** A direct comparison of both runs' `product.jsonl` rows (56 rows each, keyed on
`caseId`) against the produced `calls`/`plan`/`result` fields found zero differences — every case's
plan, composed result, and hallucination verdict is identical between `0.8.2` and `1.4.1`. This is
expected and correct: `git log --oneline -- src/router/ agentbench/` shows no commits touching
either directory since `0.8.2`'s own build — this session's work (PLAN_COMPLETIONS' extractive
pipeline, the INFBENCH ladder closures, ontology/grammar growth, packaging) is entirely outside
AGENTBENCH's measured surface (the router/goal-reasoner call-composition path). "No measurable
effect" is the honest, expected result of re-running an unrelated-surface benchmark, not a null
finding to explain away — the same discipline `INFBENCH_1.3.1.md` established for exactly this
situation.

## Discipline — the non-negotiables, checked

- **No LLM, no judge, fully deterministic** — unaffected, unchanged mechanism.
- **Both runs watched to completion in the foreground**, not backgrounded/assumed.
- **`npm test`**: 1665/1665 green at the commit this measurement is pinned to.

## Reproduce

```
node agentbench/run.mjs --driver goal --ladder --stamp 1.4.1
node agentbench/run.mjs --driver resolver --ladder --stamp 1.4.1r   # the C1-only floor comparison
```

## Next

No AGENTBENCH-specific follow-up identified this cycle — the router/goal-reasoner surface is stable
and fully gate-passing. Future leverage sits with growing the ladder itself (new C2 cases/rules) or
`PLAN_CODE.md`'s program-synthesis tracks, neither touched this session.
