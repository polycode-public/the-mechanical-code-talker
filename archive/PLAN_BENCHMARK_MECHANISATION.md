# PLAN_BENCHMARK_MECHANISATION.md — intelligence authored once, benchmarks run mechanical

Status: DELIVERED (2026-07-27; measured at 3.1.2).

## Landed (context)

INGEST's ING-8 checker is landed and verified. It checks relation-paraphrase answers against
ingestbench's own deterministic checker instead of a pinned string (`expect.ing8Paraphrase`,
backed by `src/domain/paraphrase-ing8.mjs`); freezes every judged CONVERSATION pass as a
regression within one cycle; and reads the AGI-scales rungs mechanically from sibling benches'
committed envelopes (`scripts/agi-scales-aggregate.mjs`). The invariants below still govern all
of it: graders are committed, reviewed data; a fabricated pass is impossible by construction
(caches key on answer content, matchers/checkers are tighter than the judge —
`src/domain/paraphrase-ing8.mjs`'s held-out gate held zero false positives across build and
held-out slices in `test/domain/paraphrase-ing8.test.mjs` — down-tiered judges are
calibration-gated); no model output ever enters the product path.

## The idea

The eval harness may use LLMs; the product may not. A frontier model authors graders, rubrics and
checkers ONCE, as reviewed committed data; the harness then runs them mechanically, at near-zero
model cost thereafter.

## What's outstanding

Nothing. ING-9 (whole-document fidelity) stays judge-based — a broader, open-ended restatement
problem than ING-8's closed-vocabulary paraphrase pairs, not scoped into this item.
