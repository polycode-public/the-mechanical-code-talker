# PLAN_BENCHMARK_MECHANISATION.md — intelligence authored once, benchmarks run mechanical

Status: DELIVERED (2026-07-27; measured at 3.1.2). All seven levers landed, archived.

## Landed (context)

Levers 1, 2, 3, 5, 6, 7, and lever 4 (both chatbench's subclass-paraphrase check and INGEST's ING-8
checker) are landed and verified. The eval harness now judges only what changed since the last
cycle (`test-benchmarks/chatbench/verdict-cache.mjs`), promotes stable-wording passes to
deterministic matchers (`matchers.mjs`, `distill.mjs`, `promoted.json`), compiles per-construction
rubrics and gates a small judge model in per family once it's measured against a frontier pass
(`rubrics.mjs`, `calibrate.mjs`, `downtier.json`), checks subclass-paraphrase and ING-8
relation-paraphrase answers against ingestbench's own deterministic checkers instead of a pinned
string (`test-benchmarks/chatbench/run.mjs`'s `expect.subclassParaphrase` and
`expect.ing8Paraphrase`, backed by `src/domain/paraphrase.mjs` and `src/domain/paraphrase-ing8.mjs`),
replays unchanged cases without re-running the engine (`skip-unchanged.mjs`), freezes every judged
CONVERSATION pass as a regression within one cycle, and reads the AGI-scales rungs mechanically
from sibling benches' committed envelopes (`scripts/agi-scales-aggregate.mjs`). The invariants
below still govern all of it: graders are committed, reviewed data; a fabricated pass is
impossible by construction (caches key on answer content, matchers/checkers are tighter than the
judge — `src/domain/paraphrase-ing8.mjs`'s held-out gate held zero false positives across build and
held-out slices in `test/domain/paraphrase-ing8.test.mjs` — down-tiered judges are
calibration-gated); no model output ever enters the product path.

## The idea

The eval harness may use LLMs; the product may not. A frontier model authors graders, rubrics and
checkers ONCE, as reviewed committed data; the harness then runs them mechanically, at near-zero
model cost thereafter.

## What's outstanding

Nothing. ING-9 (whole-document fidelity) stays judge-based — a broader, open-ended restatement
problem than ING-8's closed-vocabulary paraphrase pairs, not scoped into this item.
