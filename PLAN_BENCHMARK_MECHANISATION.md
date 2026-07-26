# PLAN_BENCHMARK_MECHANISATION.md — intelligence authored once, benchmarks run mechanical

## Landed (context)

Levers 1, 2, 3, 5, 6, 7, and the chatbench half of lever 4 are landed and verified. The eval
harness now judges only what changed since the last cycle
(`test-benchmarks/chatbench/verdict-cache.mjs`), promotes stable-wording passes to deterministic
matchers (`matchers.mjs`, `distill.mjs`, `promoted.json`), compiles per-construction rubrics and
gates a small judge model in per family once it's measured against a frontier pass
(`rubrics.mjs`, `calibrate.mjs`, `downtier.json`), checks subclass-paraphrase answers against
ingestbench's own ING-7 checker instead of a pinned string
(`test-benchmarks/chatbench/run.mjs`'s `expect.subclassParaphrase`), replays unchanged cases
without re-running the engine (`skip-unchanged.mjs`), freezes every judged CONVERSATION pass as a
regression within one cycle, and reads the AGI-scales rungs mechanically from sibling benches'
committed envelopes (`scripts/agi-scales-aggregate.mjs`). The invariants below still govern all of
it: graders are committed, reviewed data; a fabricated pass is impossible by construction (caches
key on answer content, matchers are tighter than the judge, down-tiered judges are
calibration-gated); no model output ever enters the product path.

## The idea

The eval harness may use LLMs; the product may not. A frontier model authors graders, rubrics and
checkers ONCE, as reviewed committed data; the harness then runs them mechanically, at near-zero
model cost thereafter. ING-8 is the one piece of that split not yet built.

## What's outstanding: ING-8, a corpus-authored equivalence checker

INGEST is the one bench axis with real remaining judge exposure: ING-0..7 are deterministic, but
ING-8 (paraphrase equivalence) and ING-9 (whole-document fidelity) still run on the judge every
cycle. ING-7 already has a deterministic checker (`verifySubClassParaphrase`,
`src/domain/paraphrase.mjs`) — narrow, isa/subclass paraphrases only, and already wired into
chatbench's own tier-1. ING-8 needs the same treatment for the harder, whole-document paraphrase
shapes ING-7 doesn't cover: a deterministic equivalence checker (normalization + synonym tables
over the closed relation vocabulary, seeded from `verifySubClassParaphrase`'s pattern), authored
from a corpus of judged examples and held to a held-out judged set — the ReaComp pattern
`PLAN_CODE_PLANNING.md` §4.11 already names, applied to this harness. The judge would then stay
only for ING-9.

**The bottleneck is corpus, not code.** The checker has to distil from judged examples, and only
two real ING-8/9 verdicts exist today (`reports/BENCHMARK_INGEST_3.0.3.md`). Authoring and judging
a candidate-pair corpus is the unavoidable paid step; building the checker against it is
mechanical once that corpus exists.

**Shape of the work**, mirroring how ING-7's checker actually got built (~18 min inside a ~180k-token
build once its corpus existed):

1. Author ~200 candidate paraphrase pairs spanning the equivalence shapes ING-7 doesn't cover.
2. Judge them (frontier + a same-family small-model pass, ~400 calls, ~20 min) to get the
   ground-truth corpus.
3. Build the checker against that corpus; hold it to a held-out judged slice before trusting it —
   same discipline `matcherTighterThanJudge` already applies to lever 2's matchers.

| item | agent effort | judge cost | wall clock |
|---|---|---|---|
| ING-8 checker | one agent authors candidate paraphrase pairs; one builds the checker + held-out gate | ~200 pairs × 2 samples ≈ 400 haiku calls ≈ ~20 min | ~2–3 h |

Written 2026-07-24 against the nine `SKILL_BENCHMARK_*.md` docs at 2.11.10; levers 2/3/4's
chatbench half landed 2026-07-27.
