# PLAN_EMBEDDINGS.md — the semantic-similarity axis, and the way back to it

**Status (2026-07-17): design only, nothing built. Not started, and not next.** The code this
describes was deleted at 2.1.0 (`src/adapters/embed.mjs`, `src/domain/vector.mjs`, and the
`embedRank` branch in `src/domain/codegraph.mjs`). This file is the record of what it was, what it
could buy, and what has to be true before it earns a place again. Git history holds the code.

## Why it went

The feature was inert. Nothing called `loadEmbedder()`; nothing set `opts.embedder`. Turning
`embed_rank = true` on in `tmct.toml` did nothing except print a line telling you to run
`npm run refs:embeddings`.

That command did not exist. Neither did `scripts/fetch-embeddings.mjs`, which the file's own header
named as the fetcher, nor the `vendor/` directory both pointed at. So this was not a wire that came
loose. It was a feature that stopped halfway and left instructions to a door that was never built.

It stayed dead long enough that nobody noticed the message was lying. That is the useful signal: no
one wanted it enough to try it.

## What was deleted

A complete, dependency-free static embedder in 169 lines, and it was good work:

- a hand-rolled **safetensors** reader (u64le header length, JSON header, raw tensors) that handles
  4-byte alignment correctly
- a hand-rolled **WordPiece/BertNormalizer tokenizer** read from `tokenizer.json` — control-char
  strip, CJK padding, lowercase, NFD accent strip, greedy longest-match with `##` continuation
- a **mean-pool + L2-normalise** embedder over **potion-base-8M** (29,528 × 256 F32 = 30.2 MB, MIT)
- a per-process, per-directory weights cache that memoises the absent case too

Plus `src/domain/vector.mjs`: a 12-line `cosine(a, b)`. It went with the branch because
`codegraph.mjs:994` was its only caller.

**The architecture was already solved, and that is worth knowing.** `vector.mjs` (pure, zero
imports, domain-legal) was deliberately split from `embed.mjs` (fs, adapters), and the embedder
reached the domain layer duck-typed as `opts.embedder` — so `codegraph.mjs` stayed fs-free and the
layer rule in `test/estate/import-layers.test.mjs` was never bent. Whoever did that got the hard
part right.

Re-introduction is therefore **~40 lines of fetch script plus ~3 lines of injection** at
`bin/tmct.mjs`'s two `searchModulesRanked` call sites. No layering change. The obstacle was never
the design.

## What it actually is, precisely

Not a transformer. A lookup table plus an average. The whole forward pass is `+=`, `/=`, and one
`sqrt`: take each subword's row from the matrix, sum, divide by token count, normalise. There is no
attention, no layer, no matmul, no positional encoding.

model2vec builds it by forward-passing an entire vocabulary through a teacher sentence-transformer
one token at a time and keeping each output vector as that token's permanent row, then applying PCA
to 256 dims and Zipf weighting. The teacher's contextual machinery is gone; its *average* behaviour
is baked into a table.

Four consequences follow from the arithmetic, and no amount of tuning touches them:

- **Order-blind, bit-identically.** Summation commutes, so `embed("parse config")` and
  `embed("config parse")` are the same bytes.
- **Negation-blind.** `not` contributes its own row additively. `"not cached"` lands *near*
  `"cached"`, not opposite it.
- **Sense-blind.** One row for `bank`, and one each for `test`, `client`, `handler`, `index`,
  `graph` — the words where code needs sense most.
- **Fully deterministic.** No RNG, no seed, no threading, strictly sequential loops. Same bytes in,
  same bytes out. This part fits tmct exactly.

## The one gap it fits, and it is a real one

Every similarity mechanism in `src/` is a closed table:

| Mechanism | Size | Where |
|---|---|---|
| verb lexicon | **93 verbs** | `src/domain/grammar/lexicon-core.json` |
| fuzzy repair targets | 136 | `src/domain/interpret/fuzzy.mjs` |
| real-word collisions | 4,820 words | `src/domain/real-word-collisions.json` |
| sense hold-off | **1 word** (`used`) | `fuzzy.mjs:15` |

And the fuzzy tier is **orthographic** — a bounded Damerau-Levenshtein. It repairs `imprt` → `import`
beautifully. It does not carry `talks to` → `uses`, because those two are 0%
orthographically similar and 100% semantically similar.

**That axis has no instrument in the tree today.** It is the one place a vector would add a signal that
does not exist today rather than duplicating one. The ontology synonym lane
(`chat.mjs:9744`, ConceptNet Synonym/SimilarTo) is the nearest thing, and it is a corpus lookup
routed last-resort behind a weak prior precisely because it is low-precision.

**The axis already has a worked example, and it went the other way.** `what talks to the payment
module?` was the README's own headline and the 2.0.3 sweep's highest-impact dead-end — "the
capability exists and only the phrasing is unrouted". It was fixed at 2.1.0 by `c720a16`, and the
fix was one lexicon entry: `ask-vocab.mjs:57` now carries `"talks to", "talk to"`. A 30 MB model
would have solved the same dead-end less precisely, less traceably, and 30 MB more expensively.

Keep that in view when reading the rest of this list. Each of these is a candidate for the same
treatment first.

The dead-ends still live on this axis:

- **Item 15** — `tell me more` expands; its synonyms (`what else`, `why`) fall through to the
  identity blurb.
- **Items 16, 18, 21, 22** — a missing `do/does <subject> <verb>` frame; the `i was wondering`
  politeness frame; goal phrasings narrower than natural speech; unrouted plan follow-ups.
- Possibly **`naming-vocabulary` at 1.675/2 over n=20** — the second-worst construction and the
  largest sample of it, so the signal is real. Undiagnosed. It needs a look before it needs a lever.

## Where it cannot help, which is most of the pain

The 2.0.3 cycle's organising finding is **input silently discarded before the parser runs**: a
sentence boundary, a quantifier, a clause, a modifier, an article, a qualifier. Six confident-wrong
answers, two of them proof-shaped — a numbered "shortest" plan that is illegal on move one, and a
real proof certifying a false premise.

**Every one of those is a dropped token, not a missing synonym.** An order-blind, negation-blind bag
of subwords touches none of them.

And where the fix *is* on the synonym axis, the table has been winning. The 2.0.3 sweep said of its
headline dead-end: *"One lexicon entry (`talks to` → `uses`) is the whole fix."* That entry landed
at 2.1.0 and the dead-end closed. The verb lexicon holds 93 verbs. Reaching for 30 MB of weights to
solve what a row solves is the expensive way round, and it trades a declared table for a number
nobody can trace.

## Three findings that must govern any re-introduction

**1. The model was wrong for the job.** potion-base-8M's MTEB scores: Classification 70.34,
STS 72.91, PairClassification 76.62 — and **Retrieval 31.11**, its weakest axis by a distance. Code
search is a retrieval task. We picked the general-purpose model from a family that has a
retrieval-specific member.

- **`potion-retrieval-32M`** — retrieval 36.35, 86.65% of all-MiniLM-L6-v2. **A drop-in**: F32,
  WordPiece, same `embeddings` tensor name. The deleted reader would have loaded it unchanged.
- **`static-retrieval-mrl-en-v1`** (sentence-transformers) — the strongest static retrieval model,
  Matryoshka-trained, so dims are truncatable and you can trade accuracy for MB.

Either is a better starting point than what was there. Re-litigate the model before the code.

**2. `[UNK]` collision is a false-positive source.** The deleted test suite recorded it: two
*unrelated* unknown words both tokenize to `[UNK]` and score **cosine 1.0 — identical**. Over
unusual identifiers, which is exactly what a code graph is full of, that is active mis-ranking
dressed as a match. Any re-introduction needs an explicit answer for it — most likely refusing to
score when a query is mostly `[UNK]`.

**3. The instruments cannot score it yet.** This is the blocking one:

- AGENTBENCH: 56/56 on the goal driver, "no rung to push past".
- INFBENCH: 219/219 and "has stopped discriminating… it now measures the generator's reach, not the
  prover's" — with 50 of those greens graded against declared ceilings.
- CHATBENCH: blind to 14 of 23 construction shapes, run at N=1.

The only instrument currently discriminating on the meaning axis is the CONVERSATION persona sweep,
which is qualitative. **A lever you cannot measure is a lever you cannot defend.** A scale for
paraphrase misses has to exist before an embedding can be judged against the table entry that
competes with it.

## What safetensors does and does not open

The format is *just* a tensor container: header length, JSON header, packed data. It stores no
architecture and no computation graph.

- **Another static embedding model** — free. Different rows, different dims, no code change, as
  long as it is F32 with a WordPiece tokenizer. `potion-multilingual-128M` would not work; it uses
  SentencePiece/Unigram.
- **A classifier, a cross-encoder, a real transformer** — no. You would get the tensors out and then
  have to hand-write attention, layer norm, GELU and the matmuls in JS, matching the architecture
  exactly, and you would want SIMD or WASM or it would be 100–1000× slower than the lookup. That is
  writing an inference engine, not extending a reader. The realistic alternatives are
  onnxruntime-node or transformers.js, which are the dependency class this project exists to avoid.

So the reader is a one-trick asset. The trick is "swap in a better static embedding model", and it
does that trick perfectly.

## Sequencing — what has to be true first

1. **Fix the dropped-input family.** Deterministic, cheap, and it is where every confident-wrong
   answer lives. Nothing here competes with that.
2. **Grow the verb lexicon past 93.** Item 15 is a handful of entries; so are 16, 18, 21 and 22.
   This is the cheapest route to the same dead-ends and it keeps every answer traceable to a
   declared table, which is the product's whole pitch. `c720a16` is the proof that it works: one
   row closed the headline dead-end at 2.1.0.
3. **Build a paraphrase-miss scale.** Until a benchmark discriminates on this axis, no lever can be
   scored. `graded-pool-max.jsonl` already holds all 36 grade×construction cells; the lightest
   full-coverage run is 315 cases.
4. **Then re-litigate**, with `potion-retrieval-32M` and an `[UNK]` refusal rule, against the
   question the benchmark by then can answer: does a bounded vector signal beat the next 200 lexicon
   entries?

## The shape any re-introduction must keep

The deleted design respected the honest-miss discipline, and that was its best feature. It:

- **re-ranked only** — it could never introduce a candidate the lexical scorer had not already found
- **never demoted** — `Math.max(0, cosine(...))`, so similarity could not penalise
- **stayed bounded** — `EMB_FRAC = 0.2`, capped at `EMB_CAP_FRAC = 0.35` of the base score
- **no-opped silently** when weights were absent, returning `null` rather than failing

Keep all four. tmct refuses ties, exits the grammar on undeclared words, and returns `null` on
unverified paraphrases. An embedding that *breaks* ties by cosine would be fighting the
architecture, not extending it. A bounded additive booster extends it.

## References

- [minishlab/potion-base-8M](https://huggingface.co/minishlab/potion-base-8M) — what was deleted
- [minishlab/potion-retrieval-32M](https://huggingface.co/minishlab/potion-retrieval-32M) — the drop-in upgrade
- [sentence-transformers/static-retrieval-mrl-en-v1](https://huggingface.co/sentence-transformers/static-retrieval-mrl-en-v1) — best-in-class static retrieval
- [MinishLab/model2vec](https://github.com/MinishLab/model2vec) — how the distillation works
- [safetensors](https://github.com/safetensors/safetensors) — the format
- [SwiftEmbed (arXiv 2510.24793)](https://arxiv.org/pdf/2510.24793) — static-token-lookup embeddings for real-time use
