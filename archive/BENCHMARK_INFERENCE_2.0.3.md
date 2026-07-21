# BENCHMARK_INFERENCE_2.0.3 — no verdict drift across 299 rows; 50 of the 219 greens are declared ceilings; and the generator re-draws every case when the lexicon moves

The honest delta versus `BENCHMARK_INFERENCE_1.7.0.md`: **no verdict moved, and that is the
finding.**

Both arms pass every band at 100% completion and 0% fabrication, exactly as 1.7.0 recorded.
Matching percentages can hide two cases swapping places, so this cycle diffed the raw files
row-by-row rather than trusting the summary: **0 verdict changes across all 299 rows**, no row
without a 1.7.0 counterpart, on both the committed case set and a freshly regenerated one. The
deterministic prover is the same instrument it was at 1.7.0, across a major version bump that
re-homed `src/` into five layers. The interpretation pipeline moved a great deal in the 1.8.x–2.0.x
line; the prover underneath did not notice.

**What that diff does and does not prove.** `product.jsonl` records a row's verdict
(`expected: "yes"`, `observed: "yes"`) and not its premises or query, so a raw-vs-raw diff compares
verdicts only. It cannot see a change in the *wording* of a case. That matters here, because the
wording did change — see the generator-drift section below. The claim this run supports is that
tmct returns identical verdicts on a structurally identical ladder, which is what the benchmark
grades; it is not a claim that the 219 sentences were the same 219 sentences.

**The number that needs context is the green one.** A reader seeing "INF-C2: 20/20, 100%, PASS"
will reasonably conclude tmct handles inconsistency at C2. It does not. **50 of the 219 chat cases
(23%) are graded against a declared ceiling** — their expected answer is the honest floor, not the
classically correct one, so passing them means the engine correctly declines or correctly fails to
notice, exactly as the case set asks. Full detail below. This is by construction and long-standing,
not new, but "every band passes" is a claim that should never be read without it.

**This cycle applied no lever.** It is a pure re-measurement at 2.0.3 on the operator's
instruction. The ladder gates nowhere today, so there was nothing to build even had the cycle
wanted to.

## Run

`npm run infbench` (`generate-cases.mjs` then `run.mjs`) ran to completion in the foreground.
219 cases at the default seed, two drive points per case: the pure kernel prover
(`src/domain/syllogise.mjs`'s `deriveSubClassClosure`) and the chat surface via `runChat()`. No LLM,
no judge, no network anywhere in this loop. The `infbench` script is present in `package.json` as
required.

Two arms were measured, because the generator rewrote the committed case set (see Drift):

- `infbench/results/raw/run-2.0.3/product.jsonl` — the regenerated cases (299 rows).
- `infbench/results/raw/run-2.0.3-committed-cases/product.jsonl` — the committed cases, generator
  skipped (299 rows).

Both agree on every figure in this report. `infbench/cases.jsonl` was restored to its committed
state afterwards.

Per-template counts, as printed by the generator — the authoritative count:

| template | n |
| --- | --: |
| a1Lookup | 30 |
| a2ChainLen2 | 40 |
| b1Disjoint | 39 |
| b2ChainLenK | 30 |
| b2Svf1 | 10 |
| b2Svf1Apply | 10 |
| c1Cardinality | 30 |
| c1ScmSvfApply | 10 |
| c2Inconsistent | 20 |

Identical to 1.7.0's nine counts, so the two runs compare like for like.

## The metric pair, per band — kernel arm (80 cases; the pure-prover subset)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | **0%** | PASS |
| INF-A2 | 20 | 20 | **100%** | **0%** | PASS |
| INF-B2 | 10 | 10 | **100%** | **0%** | PASS |
| INF-C1 | 40 | 40 | **100%** | **0%** | PASS |
| **all** | **80** | **80** | **100%** | **0%** | **PASS** |

Ladder: INF-A1 → INF-A2 → INF-B2 → INF-C1 — all bands pass the gate.

**Receipt for what the kernel arm does not run.** The arm is not a sample: each case declares its
own drive points (`arms: ["kernel","chat"]` or `arms: ["chat"]` in
`infbench/generate-cases.mjs`), and `gradeKernelRow` emits a kernel row only for the first kind.
Five of the nine templates declare a kernel arm; four are chat-only, so INF-B1 and INF-C2 carry no
kernel row at all. For `b2ChainLenK` that choice is deliberate and documented at
`infbench/generate-cases.mjs:419`: the kernel closure derives those chains correctly, so running
them on the kernel arm would score correct behaviour as fabrication against a chat-arm ceiling
literal. The chat arm covers all six bands at full strength.

## The metric pair, per band — chat arm (219 cases; the full `runTurn()` surface)

| band | n | pass | completion | fabrication | gate | of which ceiling-graded |
| --- | --: | --: | --: | --: | --- | --: |
| INF-A1 | 30 | 30 | **100%** | **0%** | PASS | 0 |
| INF-A2 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-B1 | 39 | 39 | **100%** | **0%** | PASS | 0 |
| INF-B2 | 50 | 50 | **100%** | **0%** | PASS | **30** |
| INF-C1 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-C2 | 20 | 20 | **100%** | **0%** | PASS | **20** |
| **all** | **219** | **219** | **100%** | **0%** | **PASS** | **50** |

Ladder: INF-A1 → INF-A2 → INF-B1 → INF-B2 → INF-C1 → INF-C2 — every band passes the gate, on both
arms.

## The declared ceilings — what the two green C-bands actually assert

50 cases are green because they match an expectation that is deliberately set to the honest floor.
Both are recorded in the generator, and both are horizons with a named next stage rather than
settled limits:

- **`b2ChainLenK`, 30 cases at INF-B2** (`infbench/generate-cases.mjs:419`, `:455`). The chained
  subject-object pair is classically **provable** by scm-sco transitivity, and the kernel closure
  derives it correctly today. The chat layer has no multi-hop proof-chain materialization, so the
  expected chat answer stays "cannot be proven". These 30 greens assert that tmct declines
  honestly, not that it proves the chain. INF-B2's 50/50 is 20 real proofs plus 30 honest declines.
- **`c2Inconsistent`, 20 cases at INF-C2** (`infbench/generate-cases.mjs:647`). The clash is the
  template's own declared disjoint pair, pinned at generation time. Today the engine "answers from
  the (contradictory) memory without noticing". These 20 greens assert that it answers without
  fabricating — not that it detects the contradiction. **INF-C2 measures no consistency checking
  at all right now.**

The second of these is exactly what `PLAN_CONSISTENCY_CHECK.md` would build, and `NEXT.md`
already lists that plan as a design awaiting a decision. This run is evidence for that decision:
the C2 band is ready to grade a consistency checker the moment one exists, and until then its 20/20
is a floor holding, not a capability.

## What's new this cycle

Nothing. No engine change, no generator change, no case-set change — the nine template counts and
all 299 rows match 1.7.0 exactly. This is a re-measurement on the operator's instruction, and no
number here is attributable to work done in this cycle.

## Drift

**No verdict drift, checked rather than assumed.** The drift check compared
`infbench/results/raw/run-1.7.0/product.jsonl` against this run's raw, keyed on case id and arm:
0 verdict changes across 299 rows, 0 rows without a counterpart, on both case sets. No band moved,
so there is no band regression to record.

**But the case set itself drifted, and this cycle found it by accident.** `npm run infbench`
regenerates `infbench/cases.jsonl` before running, and the regenerated file came out different from
the committed one on all 219 lines. Case `inf-a1-lookup-subClassOf-001` reads "every cuticle is a
pusher" as committed and "every uneasiness is a museum" as regenerated — same id, same structure,
different words.

The generator is not at fault and its seed is not broken. `CLASS_NOUNS` is derived from the
lexicon at load time (`infbench/generate-cases.mjs:96`, from `src/domain/grammar/lexicon-core.json`,
now 9,311 nouns) and every template draws its vocabulary via `seededShuffle(CLASS_NOUNS, rng)`. The
shuffle is deterministic **for a fixed list**; add a word to the lexicon and the same seed lands on
a different draw. `1007b87 grammar: add 9 real-vocabulary words…` is enough to re-draw all 219
cases. So `DEFAULT_SEED = 20260707` reproduces a case set only against the lexicon of the day.

Three consequences, none of them fatal and none of them fixed here:

- The committed `infbench/cases.jsonl` **cannot be reproduced** by running today's generator, so it
  is a snapshot rather than a derivable artifact. `test/estate/generated-artifacts.test.mjs` guards
  other committed generated files against exactly this and does not cover this one.
- `npm run infbench` **silently rewrites a committed file** as a side effect of measuring. This run
  restored it (`git checkout -- infbench/cases.jsonl`) rather than commit the re-draw, per the
  cycle's no-change rule.
- A cross-version INFBENCH comparison is only like-for-like on the verdict, never on the sentence.
  That has been true of every prior cycle too — `BENCHMARK_INFERENCE_1.7.0.md` also ran
  `npm run infbench`, so it measured cases drawn against its own lexicon.

To keep this run honest on its own terms, both were measured: the regenerated set (219 cases,
`run-2.0.3`) and the committed set with the generator skipped (`node infbench/run.mjs` alone,
`run-2.0.3-committed-cases`). **Both read 219/219 chat, 80/80 kernel, every band PASS, 0
fabrication, and both diff to 0 verdict changes against 1.7.0.** The ladder is indifferent to which
nouns it is handed, which is itself a small piece of evidence for the prover's robustness.

## Decision

**Ship as-is.** Both arms clear every band, fabrication holds at zero, and a full-row diff proves
the engine did not drift across a major version bump. No band gates, so no capability is blocked
waiting on this cycle.

The next INFERENCE cycle's useful work is not in the prover. With 219/219 green, the case set has
stopped discriminating: every band it can author is clear, and 50 of its greens are floors rather
than proofs. Two things would make the next run informative, and both are decisions rather than
defects — flipping a declared ceiling once the capability behind it exists (chat-layer proof
materialization for B2; a consistency checker for C2), or authoring a deeper band. Named here and
mirrored to `NEXT.md`; not acted on, per this cycle's no-change rule.

## Open items mirrored to NEXT.md

- INFBENCH has stopped discriminating: 219/219 chat, 80/80 kernel, every band PASS, 0 verdict
  changes vs `BENCHMARK_INFERENCE_1.7.0.md`. It now measures the generator's reach, not the
  prover's. See `BENCHMARK_INFERENCE_2.0.3.md`.
- 50 of INFBENCH's 219 green cases are graded against a declared ceiling, so two bands read as
  capable when they are floors: `b2ChainLenK` (30 at INF-B2) expects "cannot be proven" for chains
  the kernel already derives, pending chat-layer proof materialization; `c2Inconsistent` (20 at
  INF-C2) expects the engine to answer from contradictory memory without noticing, pending a
  consistency checker (`PLAN_CONSISTENCY_CHECK.md`). See `BENCHMARK_INFERENCE_2.0.3.md`.
- `npm run infbench` silently rewrites the committed `infbench/cases.jsonl`, and the rewrite is not
  a no-op: the generator draws vocabulary from the lexicon, so adding a word re-draws all 219 cases
  at the same seed. The committed file cannot be reproduced by today's generator. See
  `BENCHMARK_INFERENCE_2.0.3.md`.
