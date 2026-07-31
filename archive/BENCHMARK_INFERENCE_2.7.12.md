# BENCHMARK_INFERENCE_2.7.12 — the reformed ladder holds at 100% across both arms, 379/379 chat, 100/100 kernel, 0% fabrication, and INF-4's ceiling count drops 35→30

## Timing

- **Date:** 2026-07-19.
- **Benchmarking session:** regenerate + replay + the `--replay` determinism check, one pass,
  well under a minute of wall-clock (deterministic replay, no LLM, no judge, no network).
- **Analysis:** immediately following, same session.

**Headline: no capability regressed since 2.6.0, and one genuinely moved.** Case counts are
byte-identical to 2.6.0 on every template and every band (379 chat / 100 kernel), and every band
still passes the gate at 0% fabrication. The one real difference: **INF-4's ceiling-graded count on
the chat arm dropped from 35/70 (2.6.0) to 30/70 (this run)** — five cases that previously only
passed because they were graded against the engine's declared honest-miss floor now pass as
genuine capability instead. This session did not touch the multi-hop proof-chain materialization
INF-4 measures directly, so the mechanism behind this specific move was not traced here; flagged
as a real, observed delta rather than investigated to a root cause in this pass.

## Run

`node infbench/generate-cases.mjs` then `node infbench/run.mjs --replay --stamp 2.7.12` (the same
pair `npm run infbench` chains, plus the replay determinism check). 379 cases, two drive points
per case: the pure kernel provers (`src/domain/syllogise.mjs`) and the chat surface via the real
turn engine. No LLM, no judge, no network. `--replay`: **byte-identical across 2 runs — PASSED.**
Raw: `infbench/results/raw/run-2.7.12/product.jsonl`.

No lever was applied to the generator this cycle — the per-template counts below are byte-identical
to 2.6.0's own table, confirming the case set carried over untouched:

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

Ladder: INF-1 → INF-2 → INF-3 → INF-4 → INF-5 — all bands pass the gate, byte-identical to 2.6.0's
own kernel-arm table (same n, same pass counts, same 0% fabrication).

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

Ladder: INF-1 → … → INF-8 — every band passes the gate. Versus 2.6.0: every per-band `n` is
identical (confirming no case-set drift); INF-4's ceiling-graded count moved **35 → 30** (5 cases
that only passed against the declared honest-miss floor now pass as real capability — the overall
`all` ceiling count moved 61 → 56 accordingly); INF-7 and INF-8's ceiling counts are unchanged
(14/14 and 12/20). Kernel-vs-chat verdict agreement remains 100/100 on the both-arm cases.

## What moved, and what didn't

- **INF-4's ceiling count (35→30) is the one real delta.** INF-4 measures multi-hop proof-chain
  materialization; a `ceiling/pass` row means the case's expected verdict IS the engine's declared
  floor (not yet a materialized proof), so a drop means 5 fewer cases are still stuck at that floor.
  No commit in this session's own history directly targeted this path — worth a follow-up read of
  `git log` for whatever landed the actual fix, rather than asserting a specific mechanism here.
- **INF-7 (OWL 2 EL) and INF-8 (OWL 2 DL) hold exactly at 2.6.0's own ceiling counts** (14/14 and
  12/20) — both rungs still measure the same named horizons `PLAN_SYLLOGIST_EL_DL.md` describes
  (EL saturation through undeclared class expressions; DL complement/disjunction reasoning by
  cases), unchanged this cycle.
- **Everything else is byte-stable**, including the harness's own determinism guarantee
  (`--replay` clean across 2 runs).

## Deliberately-kept honest ceilings

INF-7 (14/14 ceiling-graded) and INF-8 (12/20 ceiling-graded) remain named horizons, not
regressions — `PLAN_SYLLOGIST_EL_DL.md`'s own Stage EL/Stage DL build paths are the way these move,
and neither shipped this cycle.

## Discipline checklist

- **Zero fabrication held** — 0% at every band on both arms, 479 rows total (379 chat + 100
  kernel).
- **Determinism verified** — `--replay` byte-identical across 2 runs.
- **Case set untouched** — every per-template count matches 2.6.0's own table exactly; no lever
  applied to the generator this cycle.
- **No overfit/leakage** — no `src/domain/syllogise.mjs` or chat-inference-path code changed as
  part of running this benchmark itself (this is a measurement pass, not a build step).

## Decision

**Ship as-is.** No regression on any of the 479 rows; one real, unexplained-but-observed capability
improvement (INF-4's ceiling count). Worth a short follow-up (`git log` since 2.6.0 for whatever
touched multi-hop proof-chain materialization) to attribute the INF-4 move correctly, but nothing
here blocks anything.

## Backlog

1. **Attribute the INF-4 ceiling-count improvement (35→30) to its actual commit.** Not done in this
   pass — flagged rather than guessed.
2. **INF-7/INF-8 remain open horizons**, per `PLAN_SYLLOGIST_EL_DL.md`'s own Stage EL/Stage DL
   build paths — unchanged this cycle, not a new finding.
