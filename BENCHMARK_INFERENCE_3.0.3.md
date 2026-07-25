# BENCHMARK_INFERENCE_3.0.3 — the ladder holds byte-identical to 2.11.0: 379/379 chat, 100/100 kernel, 0% fabrication, every ceiling count unchanged

## Timing

- **Date:** 2026-07-24.
- **Benchmarking session (regenerate + replay + the `--replay` determinism check):** 05:42:23 →
  05:46:51 CEST.
- **Analysis (this write-up):** 05:47:17 → 05:52 CEST.

**Headline: nothing moved.** Every per-band number (completion, fabrication, ceiling/pass split)
is byte-identical to `archive/BENCHMARK_INFERENCE_2.11.0.md`, on both the kernel arm and the chat arm. 577
commits landed between the two reports, including 72 that touch `src/services/chat.mjs`, and none
of them changed a single row on this generated case set. Case counts are also byte-identical on
every template. No commit in the range touched `src/domain/syllogise.mjs`.

## Run

`node test-benchmarks/infbench/generate-cases.mjs --seed 20260707` (the generator's own default seed — the same
one 2.11.0 used) then `node test-benchmarks/infbench/run.mjs --replay --stamp 3.0.3`. 379 cases, two drive points
per case: the pure kernel prover (`src/domain/syllogise.mjs`) and the chat surface via the real
turn engine (`runChat()`). No LLM, no judge, no network. `--replay`: **byte-identical across 2
runs — PASSED.** Raw: `test-benchmarks/infbench/results/raw/run-3.0.3/product.jsonl` (479 rows: 379 chat + 100
kernel).

`npm run infbench` is present in `package.json` (confirmed via `grep infbench package.json` per the
skill's own warning). No regression there; the two steps ran manually with `--stamp`/`--replay` to
match this cycle's stamping convention.

Per-template counts, byte-identical to 2.11.0's own table:

| template | n | | template | n |
| --- | --: | --- | --- | --: |
| a1Lookup | 30 | | elConstructedRestriction | 8 |
| a2ChainLen2 | 40 | | elExistentialChain | 6 |
| b1Disjoint | 39 | | dlDisjunction | 6 |
| b1Existential | 40 | | dlComplement | 6 |
| b2ChainLenK | 30 | | dlDisjointProofSoundness | 8 |
| b2Svf1 | 10 | | a1UniversalConditional | 10 |
| b2Svf1Apply | 10 | | a2Reflexive | 10 |
| c1Cardinality | 30 | | a2Converse | 10 |
| c1ScmSvfApply | 10 | | a2EntailedRetraction | 12 |
| c2Inconsistent | 20 | | b1DisjointVeto | 24 |
| | | | b2PropertyInheritance | 20 |

## The metric pair, per band — kernel arm (100 cases; the pure-prover subset)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-1 | 10 | 10 | **100%** | **0%** | PASS |
| INF-2 | 30 | 30 | **100%** | **0%** | PASS |
| INF-3 | 10 | 10 | **100%** | **0%** | PASS |
| INF-4 | 10 | 10 | **100%** | **0%** | PASS |
| INF-5 | 40 | 40 | **100%** | **0%** | PASS |
| **all** | **100** | **100** | **100%** | **0%** | **PASS** |

Ladder: INF-1 → INF-2 → INF-3 → INF-4 → INF-5. All bands pass the gate, byte-identical to 2.11.0's
own kernel-arm table.

## The metric pair, per band — chat arm (379 cases; the full turn-engine surface)

| band | n | pass | completion | fabrication | gate | of which ceiling-graded |
| --- | --: | --: | --: | --: | --- | --: |
| INF-1 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-2 | 72 | 72 | **100%** | **0%** | PASS | 0 |
| INF-3 | 103 | 103 | **100%** | **0%** | PASS | 0 |
| INF-4 | 70 | 70 | **100%** | **0%** | PASS | **30** |
| INF-5 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-6 | 20 | 20 | **100%** | **0%** | PASS | 0 |
| INF-7 | 14 | 14 | **100%** | **0%** | PASS | **14** |
| INF-8 | 20 | 20 | **100%** | **0%** | PASS | **12** |
| **all** | **379** | **379** | **100%** | **0%** | **PASS** | **56** |

Ladder: INF-1 → … → INF-8. Every band passes the gate. Versus 2.11.0: every `n`, every
ceiling/pass split, is identical (30/70, 14/14, 12/20, overall 56/379). Kernel-vs-chat verdict
agreement remains 100/100 on the both-arm cases.

## Ceiling markers (unchanged this cycle)

- **INF-4** (multi-hop proof-chain materialization): 30 of 70 chat-arm passes are ceiling-graded.
  The expected verdict is the engine's declared honest-miss floor, not a materialized proof.
- **INF-7** (OWL 2 EL — classify through undeclared class expressions): 14 of 14 ceiling-graded. Sits
  at the honest-miss floor per `PLAN_SYLLOGIST_EL_DL.md`'s Stage EL description.
- **INF-8** (OWL 2 DL — reasoning by cases, complement classes): 12 of 20 ceiling-graded. The other 8
  (`dlDisjointProofSoundness`) already grade live — unchanged from 2.11.0.

None of these are new findings; all three are named horizons already carried in
`PLAN_SYLLOGIST_EL_DL.md` and in 2.11.0's own report.

## What's new since 2.11.0, and why none of it moved a row

577 commits landed between `8c16380` (the 2.11.0 report) and this run. None touched
`src/domain/syllogise.mjs`. 72 touched `src/services/chat.mjs`, spanning the discourse/DRT-lite
work, digest-stage read-back, anaphor and unbound-referent handling, temporal-comparison routing,
and architecture/overview intent routing landed across the same interval as `PLAN_AGENTS.md`'s
close-out and the discourse-plan merge. Each is a real chat-lane change, but this generator's fixed
case shapes don't happen to exercise the paths any of them touch, so no verdict on the 379
generated cases moved. This is the same "no lever applied to the generator this cycle" state
2.11.0 itself reported relative to 2.7.12.

## Drift check

No drift. Every band's `n`, completion, fabrication, and ceiling/pass split matches 2.11.0 exactly.
`--replay` confirms determinism held (byte-identical across 2 runs). No commit in the
8c16380..HEAD range touched `src/domain/syllogise.mjs`.

## Discipline checklist

- **Zero fabrication held**: 0% at every band on both arms, 479 rows total (379 chat + 100 kernel).
- **Determinism verified** — `--replay` byte-identical across 2 runs.
- **Case set untouched** — every per-template count matches 2.11.0's own table exactly; no lever
  applied to the generator this cycle.
- **No overfit/leakage** — this is a measurement pass; no `src/domain/syllogise.mjs` or
  chat-inference-path code was touched as part of running this benchmark.

## Decision

**Ship as-is.** Every band gates exactly where 2.11.0 left it, at 100% completion and 0%
fabrication, with the same three named ceiling markers (INF-4's multi-hop materialization, INF-7's
OWL 2 EL horizon, INF-8's OWL 2 DL horizon). No regression, no unexplained drift, no new lever
applied this cycle. This was a measurement pass only, per this cycle's own scope.
`PLAN_SYLLOGIST_EL_DL.md`'s Stage EL / Stage DL remain the build path if the ladder is to move past
its current top-of-ladder ceilings.
