# BENCHMARK_INFERENCE_2.5.0 — the existential probe lands and the product refuses it; INF-C2 stops being a declared ceiling; 259/259 chat, 90/90 kernel, 0 fabrication

## Timing

- **Date:** 2026-07-17 (CEST).
- **Benchmarking session + analysis:** ~21:33:31 → 21:35:12 — regenerate + run (deterministic, plus
  the replay determinism check) and the write-up, one sub-agent pass (shared with AGENT).
- **Note:** reconstructed from the run's wall-clock; a clean session-vs-analysis split was not
  separately instrumented this round. From 2.5.0 onward the four stamps are captured directly, per
  `SKILL_BENCHMARK_INFERENCE.md` §1.

The honest delta versus `BENCHMARK_INFERENCE_2.0.3.md`: **two things the ladder could not see before,
it now sees — and the product answers both correctly.**

The first is the existential probe. 2.0.3 recorded that the ladder was green through C2 and did not
test whether an existential premise ("some N1s are N2s") could be turned into a universal proof — the
false-premise-proof class. The ladder now carries 40 `b1Existential` cases at INF-B1 that test exactly
that, and **2.5.0 refuses the existential** on all 20 probe cells while still proving the 20
minimal-pair controls. The defect a proof-certifies-a-false-premise class describes is now caught by
the benchmark, and the product passes it.

The second is INF-C2. 2.0.3 counted its 20 `c2Inconsistent` greens as a declared ceiling — cases
whose expected answer was the honest floor, "answers from contradictory memory without noticing." At
2.5.0 the template grades a **live capability**: the expected verdict is `inconsistent`, and the
product observes `inconsistent` on all 20, naming the disjoint pair it clashed on. INF-C2's 20/20 is
now a real detection, not a floor holding. The count of declared ceilings drops **50 → 30**.

Both arms still pass every band at 100% completion and 0% fabrication. The case set grew — the chat
arm is 219 → **259** and the kernel arm 80 → **90** — so this is not the like-for-like verdict diff
2.0.3 ran; it is a deeper ladder that stays green.

**And the committed case set is now reproducible.** 2.0.3 found that `npm run infbench` silently
re-drew `infbench/cases.jsonl` because the generator draws vocabulary from a moving lexicon.
Regenerating today produces a **byte-identical** file: `diff` against the committed
`infbench/cases.jsonl` is empty. The artifact is derivable again, closing that 2.0.3 open item.

**This cycle applied no lever to the generator.** The `b1Existential` template and the
`c2Inconsistent` capability grading were already committed to the generator when this measurement
ran — the working tree was clean, and regeneration is a no-op. This report measures what those
already-landed changes produce at 2.5.0; it does not add them.

## Run

`npm run infbench` (`generate-cases.mjs` then `run.mjs`) ran to completion in the foreground, exit 0.
259 cases at the default seed, two drive points per case: the pure kernel prover
(`src/domain/syllogise.mjs`) and the chat surface via `runChat()`. No LLM, no judge, no network
anywhere in this loop. The `infbench` script is present in `package.json` as required. Raw:
`infbench/results/raw/run-2.5.0/product.jsonl`. Determinism re-checked with
`node infbench/run.mjs --replay`: byte-identical across two runs.

Because the generator now produces a byte-identical `infbench/cases.jsonl` (verified by regenerating
to a scratch file and diffing), only one arm is needed — the regenerated set and the committed set
are the same bytes, unlike 2.0.3 which had to measure both.

Per-template counts, as printed by the generator — the authoritative count:

| template | n |
| --- | --: |
| a1Lookup | 30 |
| a2ChainLen2 | 40 |
| b1Disjoint | 39 |
| b1Existential | **40** |
| b2ChainLenK | 30 |
| b2Svf1 | 10 |
| b2Svf1Apply | 10 |
| c1Cardinality | 30 |
| c1ScmSvfApply | 10 |
| c2Inconsistent | 20 |

`b1Existential` (40) is new since 2.0.3's nine templates; the other nine counts are unchanged.

## The metric pair, per band — kernel arm (90 cases; the pure-prover subset)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | **0%** | PASS |
| INF-A2 | 20 | 20 | **100%** | **0%** | PASS |
| INF-B1 | 10 | 10 | **100%** | **0%** | PASS |
| INF-B2 | 10 | 10 | **100%** | **0%** | PASS |
| INF-C1 | 40 | 40 | **100%** | **0%** | PASS |
| **all** | **90** | **90** | **100%** | **0%** | **PASS** |

Ladder: INF-A1 → INF-A2 → INF-B1 → INF-B2 → INF-C1 — all bands pass the gate.

**The INF-B1 kernel row is new.** It is the 10 `b1Existential` class-control cases, which declare
`arms: ["kernel", "chat"]`: the kernel prover derives the genuine universal ("every N1 is a N2" ⊢
N1 ⊑ N2) directly. 2.0.3 had no kernel row at INF-B1 at all. The other four kernel bands are the same
80 rows 2.0.3 measured.

## The metric pair, per band — chat arm (259 cases; the full `runTurn()` surface)

| band | n | pass | completion | fabrication | gate | of which ceiling-graded |
| --- | --: | --: | --: | --: | --- | --: |
| INF-A1 | 30 | 30 | **100%** | **0%** | PASS | 0 |
| INF-A2 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-B1 | 79 | 79 | **100%** | **0%** | PASS | 0 |
| INF-B2 | 50 | 50 | **100%** | **0%** | PASS | **30** |
| INF-C1 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-C2 | 20 | 20 | **100%** | **0%** | PASS | **0** |
| **all** | **259** | **259** | **100%** | **0%** | **PASS** | **30** |

Ladder: INF-A1 → INF-A2 → INF-B1 → INF-B2 → INF-C1 → INF-C2 — every band passes the gate, on both
arms.

INF-B1 grew 39 → 79: the 39 `b1Disjoint` cases plus the 40 new `b1Existential` cases. INF-C2's
ceiling column is now **0** where 2.0.3 read 20 — the flip described in the headline.

## The existential probe — what it catches and 2.5.0's answer

`b1Existential` is the new band content 2.0.3 named as the cheapest available. It asks a single
question in four cells per noun pair: does an existential premise license a universal conclusion? The
honest floor is a refusal, because "some N1s are N2s" entails nothing about the class N1 or about any
individual N1.

- **class-probe** (10) — premise "some N1s are N2s" (cycled across `some / a few / several / most /
  many`), query "is a N1 a N2". Expected: refusal. **2.5.0 observed `unproven` on all 10.**
- **individual-probe** (10) — the existential plus "IND is a N1", query "is IND a N2". Even granted
  membership, the existential licenses nothing about the member. Expected: refusal. **2.5.0 observed
  `unproven` on all 10.**
- **class-control** (10) — the minimal pair: swap the existential quantifier for "every", same nouns,
  same query. Now genuinely provable. Expected: `yes`. **2.5.0 observed `yes` on all 10** (both
  arms).
- **individual-control** (10) — the individual probe's minimal pair, proof chain and all. Expected:
  `yes` with a proof. **2.5.0 observed `yes` on all 10.**

The controls are what make the probe's pass mean something. An engine that refused everything would
score the probes green while failing the controls; only an engine that reads the quantifier — refusing
the existential and proving the universal — clears all four cells. **2.5.0 clears all four.** The
ladder now catches the false-premise-proof class, and the product does not fabricate the universal:
it refuses the existential and proves only the genuine "every".

Two generation filters keep the probe honest, and both are load-bearing. The pool is regular-plural
nouns only — an irregular plural like "men" masks the trap, because the assert lane never folds "men"
to "man", so the existential would be refused for the wrong reason. And it excludes any noun the
default persona seeds into a fresh session's memory, which would answer from pre-seeded facts rather
than from reading the quantifier.

## The declared ceilings — what the one remaining green ceiling band asserts

30 cases are green because they match an expectation deliberately set to the honest floor. After the
INF-C2 flip, only one band carries them:

- **`b2ChainLenK`, 30 cases at INF-B2** (`infbench/generate-cases.mjs`). The chained subject-object
  pair is classically **provable** by scm-sco transitivity, and the kernel closure derives it
  correctly today. The chat layer has no multi-hop proof-chain materialization, so the expected chat
  answer stays "cannot be proven". These 30 greens assert that tmct declines honestly, not that it
  proves the chain. INF-B2's 50/50 is 20 real proofs plus 30 honest declines. The capability that
  would lift them is chat-layer multi-hop proof-chain materialization; until one is built these hold
  the honest floor.

INF-C2's 20 `c2Inconsistent` cases are no longer in this list. They now grade a live capability: the
engine detects the clash, names the disjoint pair, and refuses to answer from the contradictory
memory — `expect.verdict` is `inconsistent` and the product observes `inconsistent` on all 20. Where
2.0.3 read "INF-C2 measures no consistency checking at all right now," 2.5.0 measures it and it holds.

## What's new this cycle

- **The `b1Existential` band is now measured** — 40 chat cases and 10 kernel cases at INF-B1, all
  green, testing whether an existential premise is refused rather than turned into a universal proof.
  The template was already committed to the generator; this is the first INFBENCH cycle to report it.
- **INF-C2 is no longer a declared ceiling** — `c2Inconsistent` now grades live consistency detection
  (`inconsistent` expected and observed on all 20), dropping the ladder's ceiling count 50 → 30.
- **`infbench/cases.jsonl` is derivable again** — regenerating produces a byte-identical file, so the
  committed case set can be reproduced from today's generator. This closes 2.0.3's silent-rewrite
  open item.

No engine code changed for this measurement, and the generator was not edited this cycle — the case
set regenerates byte-identical. This is a re-measurement that reports already-landed capability.

## Drift

**No band regressed, and no pre-existing band's verdict moved.** The nine templates 2.0.3 measured
carry the same counts and the same all-green/0-fabrication result. A full row-for-row verdict diff
against 2.0.3's raw is not like-for-like this cycle, because the case set grew: the 40 `b1Existential`
rows and the 10 new INF-B1 kernel rows have no 2.0.3 counterpart, and the `c2Inconsistent` rows
carry a different expected verdict (`inconsistent` rather than the 2.0.3 floor). Those are the two
intended changes, not drift. Every carried-over band still reads 100%/0%.

The 2.0.3 caution that a cross-version INFBENCH comparison is like-for-like only on the verdict, never
on the sentence, still applies — the sentences are drawn against the day's lexicon. What is new is
that, against a fixed lexicon, the committed file is now reproducible rather than a one-way snapshot.

## Decision

**Ship as-is.** Both arms clear every band, fabrication holds at zero, the existential probe lands and
the product refuses it, and INF-C2 now measures a live capability rather than a floor. No band gates,
so nothing is blocked waiting on this cycle.

The next INFERENCE cycle's useful work is still corpus depth over prover work: with 259/259 green and
only 30 declared-ceiling greens left, the informative moves are flipping the last ceiling once the
capability behind it exists (chat-layer multi-hop proof materialization for `b2ChainLenK`) or
authoring a deeper band. Both are decisions rather than defects, named here and mirrored to
`NEXT.md`.

## Open items mirrored to NEXT.md

- INFBENCH grew a real discriminator this cycle: `b1Existential` (40 chat + 10 kernel at INF-B1) tests
  the false-premise-proof class and 2.5.0 refuses it; INF-C2 flipped from declared ceiling to live
  consistency detection (20/20 `inconsistent`). 259/259 chat, 90/90 kernel, 0 fabrication. See
  `BENCHMARK_INFERENCE_2.5.0.md`.
- 30 of INFBENCH's 259 green cases still grade against a declared ceiling: `b2ChainLenK` (30 at
  INF-B2) expects "cannot be proven" for chains the kernel already derives, pending chat-layer
  multi-hop proof-chain materialization. Flipping it requires building that capability first. See
  `BENCHMARK_INFERENCE_2.5.0.md`.
- `infbench/cases.jsonl` is now a derivable artifact — regenerating is byte-identical — and
  `test/estate/generated-artifacts.test.mjs` already guards it, so a future lexicon move that re-draws
  the cases fails loud rather than silently. This closes 2.0.3's silent-rewrite item; no further
  action is needed. See `BENCHMARK_INFERENCE_2.5.0.md`.
