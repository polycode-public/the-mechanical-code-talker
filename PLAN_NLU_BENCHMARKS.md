# PLAN_NLU_BENCHMARKS.md — scoring tmct on CLINC150 and HWU64

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Goal

Adapt tmct so it can be scored by two pre-existing, third-party NLU scoring systems, then
extract the successes and failures honestly:

1. **CLINC150** (Larson et al., EMNLP 2019, `github.com/clinc/oos-eval`) — 150 in-scope
   intents across 10 everyday domains plus a 1,000-query out-of-scope (OOS) test set.
   Metrics: **in-scope accuracy** and **OOS recall**.
2. **HWU64** (Liu et al., IWSDS 2019, `github.com/xliuhw/NLU-Evaluation-Data`) — 25,716
   utterances, 64 intents, 54 entity types, 21 domains. Metrics: **intent F1** and
   **entity F1**, under their 10-fold cross-validation protocol. Published numbers already
   exist on this scale for Watson (intent 0.882 / entity 0.488), Dialogflow (0.864 / 0.743),
   Rasa (0.863 / 0.768) and LUIS (0.855 / 0.777).

The point of borrowing these scales is credibility: any claim we make must be reproducible
by an outsider running our harness against the pinned upstream data with the upstream
protocol. Anything that weakens that (tuning on test, cherry-picked metrics, unpinned data)
defeats the purpose.

## Where tmct stands today (the as-is estimate)

tmct's capability universe is: 15 read-only code-graph capabilities
(`src/router/registry.mjs`), a commonsense fact/teach surface in `src/chat.mjs`
(IsA/HasA/CapableOf over a small animal-flavoured seed corpus), and runtime-taught game
actions. None of the CLINC150/HWU64 domains (banking, travel, weather, alarms, music,
cooking, ...) exist anywhere in the product, and a sweep of all 13 playtest logs confirms
no probe has ever touched them.

Both benchmarks require the system to emit one label from a fixed vocabulary (150 or 64
intents). tmct has no mapping to either vocabulary, so every in-scope query scores wrong
by construction. Its refusal machinery is real and machine-readable (`miss: true`,
`WALL_MISS_RE` in `src/chat.mjs`), so every OOS query maps to a correct "oos" prediction.

Estimated as-is scores:

| Scale | Metric | Estimate | Why |
| --- | --- | --- | --- |
| CLINC150 | in-scope accuracy | ~0% | no shared label vocabulary; nothing to emit |
| CLINC150 | OOS recall | ~100% | everything that is not a graph answer maps to "oos" |
| HWU64 | intent F1 | ~0 | as above; HWU64 has no OOS track to fall back on |
| HWU64 | entity F1 | ~0 | no slot extraction for the 54 entity types |

The ~100% OOS recall is the **degenerate refuser** score. It is exactly the cheap claim the
CLINC150 paper warns against and it carries no leverage. Every point of value in this plan
comes from lifting in-scope accuracy / intent F1 off the floor while keeping OOS recall
high, then reporting the pair together.

The playtests also say the closed-set-regex route to coverage does not scale to this task.
Each log adds one hand-written lane to fix one phrasing family. Covering 150 intents with
~100 training phrasings each by hand-authored FRAMES is the same patchwork times a thousand.
Three playtest failure modes matter directly here because the benchmarks will re-trigger
them at scale if we score the raw chat surface:

- **Cross-domain false accept.** PLAYTEST_LOG_001: "does a dog have a tail" parsed as the
  code-graph `defines` relation. Many CLINC/HWU utterances share surface shapes with graph
  queries and would mis-route the same way.
- **The ≤3-word conversational catch-all.** PLAYTEST_LOG_010/011/013: short declaratives
  ("dogs bark", "penguins swim") get the self-introduction card, which is not flagged as a
  miss. Benchmark utterances are often short; scored raw, these are neither a clean reject
  nor a label.
- **Silent wrong-lane writes.** PLAYTEST_LOG_011: "remember that dogs are animals" stored a
  garbled fact with no miss signal. The benchmark runs must be read-only.

### What the shipped corpus tiers do and don't cover

The importable corpus bundles (`tmct import --corpus human | human-medium | human-large |
conceptnet | wordnet-xl | wordnet-full | namenet`, resolved from `corpus/`) do carry the
everyday-domain **vocabulary**. `corpus/wordnet/wordnet-full.jsonl` (the largest tier) has
real coverage of the CLINC/HWU domain nouns (bank 124 rows, travel 210, music 208,
calendar 184, weather 82, alarm 32, restaurant 23), `wordnet-xl` and the ConceptNet slice
thinner, `human-large` thinner still. Coverage is uneven exactly where CLINC150 lives:
modern-device/app terms are near-absent (recipe 2 rows, playlist 2, timer 16).

What none of them carry is **intent knowledge**. Every row is an ontological fact about a
word (alarm HasProperty alarming; bank IsA financial-institution chains), so loading
`wordnet-full` improves term resolution, never utterance-to-label mapping. It cannot
substitute for the matcher. It matters in three places:

- **A second as-is arm (step 1):** run the baseline bare AND with `wordnet-full` loaded.
  More resolvable terms means more fact-lane firings on benchmark utterances, so the
  loaded arm likely trades some of the trivial ~100% OOS recall for false accepts. That
  measured delta is itself a useful result (what world knowledge without intent knowledge
  buys, and costs).
- **A tier-1 accuracy lever (step 2):** deterministic synonym/hypernym expansion of query
  tokens from the WordNet corpus rows before IDF scoring — ethos-clean, and directly
  attacks the short-utterance thin-overlap risk.
- **The HWU64 gazetteer (step 2):** real hypernym chains help entity typing (jazz → music
  genre), supplementing the training-fold lexicons for the 54 entity types.

## Design: a benchmark adapter, not a product rewrite

New top-level `nlubench/` directory, sibling to `chatbench/`, holding data plumbing, the
matcher, the runners and the reports. The matcher trains from the benchmarks' example
utterances; that is the layer tmct lacks today.

### The matcher (deterministic, trainable from examples)

- **Tier 1 (default, ethos-clean): IDF-weighted token-overlap nearest neighbour.** Reuse
  the scoring shape of `retrieveBlocks` (`src/memory/blocks.mjs`): index every training
  utterance under its intent label, score a test utterance against all of them with
  wink-nlp token/lemma normalisation, take the top-scoring label. Classical IR, no model
  weights, byte-identical output on repeated runs.
- **Rejection threshold → "oos".** Below-threshold top score emits the OOS label
  (CLINC150) or an abstention (HWU64, recorded but scored as wrong under their protocol).
  The threshold is tuned **only on the validation split** (CLINC150 provides one; for
  HWU64 hold out from training folds). Never on test.
- **Tier 2 (optional, flagged arm): dense cosine via `src/embed.mjs`** (static model2vec
  embeddings, offline, deterministic). This is ML-trained weights, so it sits outside the
  ethos-clean tier; run it as a separately-labelled arm so both numbers exist and the claim
  can cite the pure-IR one.
- **Entity extraction for HWU64:** deterministic gazetteer + pattern extractor built from
  the training folds' annotated spans (exact-match lexicon per entity type, wink-nlp
  tokenisation, longest-match-wins), no sequence model. Target is Watson's published 0.488
  entity F1, which low-precision hurt; a conservative extractor competes on precision.

The matcher lives in the harness only, like the LLM judge does. Whether it later becomes a
product-path domain via `registerCapability` is a separate decision, out of scope here.

### Scoring integration

- Runners follow `chatbench/run.mjs` conventions: `--stamp` from the CLI, no `Date.now`,
  byte-identical result rows, JSONL per-case output under `nlubench/results/raw/run-<version>/`.
- Write-ups follow the chatbench measurement contract: `BENCHMARK_CLINC150_<version>.md`
  and `BENCHMARK_HWU64_<version>.md`, named for the `package.json` version they measure,
  `_00N` suffix for re-runs of the same version.
- HWU64 is scored with the upstream toolkit's own scripts where runnable, so the F1 we
  report is computed by their code, not ours. If their tooling won't run, we reimplement
  their metric exactly and prove parity on their published example outputs.

## Steps

**0. Pin the ground truth.**
   - Vendor-or-fetch decision per dataset after checking licenses (record them in
     `nlubench/README.md`). Either way, pin upstream commit hashes; a fetch script fails
     loudly on hash mismatch.
   - Transcribe the exact baseline tables from both papers into `nlubench/README.md`
     (CLINC150 per-variant in-scope accuracy and OOS recall; HWU64 per-platform intent and
     entity F1). Estimates in this plan cite ranges; claims cite transcribed numbers only.

**1. As-is baseline row.**
   - Run both test sets through the real chat surface (`runTurn`, read-only fixture graph,
     the chatbench turns-mode pattern) with an outcome mapper: miss wall → "oos" /
     abstain; orientation card, fact-lane answers and graph answers → recorded verbatim,
     scored as non-label. This turns the table above from an estimate into a measured row
     and produces the false-accept inventory (how many benchmark utterances leak into
     fact/graph lanes, PLAYTEST_LOG_001-style).

**2. Matcher v1 (tier 1) + threshold sweep.**
   - Build the IDF-NN matcher and gazetteer extractor. Sweep the rejection threshold on
     validation only; freeze it before touching test. Unit tests under `test/` per repo
     convention; `npm test` stays green.

**3. CLINC150 run.**
   - The paper's data variants (at minimum `data_full`; add `imbalanced`/`oos+` variants
     if cheap once the runner exists). Report in-scope accuracy and OOS recall together,
     per-domain breakdown, plus the tier-2 arm if enabled.

**4. HWU64 run.**
   - Their 10-fold CV protocol on the same subcorpus construction they used, intent F1 and
     entity F1 via their scoring path. One row per fold plus the aggregate, so variance is
     visible.

**5. Extract successes and failures.**
   - Per-benchmark write-up with: the headline pair (never OOS recall alone), the published
     rival numbers alongside (labelled "as published in Liu et al. 2019" / "Larson et al.
     2019"), a failure taxonomy (wrong-label vs false-accept vs over-refusal, with counts
     and discriminating examples first, chatbench style), and an explicit "claims this
     does and does not support" section.
   - Fold the confirmed failure families back into the lever board as candidate levers,
     e.g. "short-utterance sink" if the ≤3-word catch-all shape reappears in adapter form.

## Minimum success bar: non-degenerate scores

The as-is table (0% / ~100% / ~0) is not yet a comparison; its numbers are artifacts of
having no label space and refusing everything, and both endpoints are reachable by
strategies that understand nothing. The plan's hard requirement is an uplift that puts
every reported metric strictly inside the interval:

- **CLINC150:** in-scope accuracy > 0 and OOS recall < 100 at the same frozen operating
  point, and that point must strictly dominate the all-reject strategy (any in-scope
  accuracy above 0 while holding OOS recall above the paper's ML baselines). The
  threshold sweep (step 2) produces the full accuracy/OOS-recall trade-off curve on
  validation; the write-up publishes the curve plus one frozen point, so nobody can
  accuse the headline pair of being a cherry-picked corner.
- **HWU64:** intent F1 and entity F1 both materially above zero under their protocol.
  The sanity floor is the majority-class/random-label strategy computed from their own
  splits (report it in the same table); tmct's F1 must clear it by a wide margin for the
  run to count as a measurement rather than a stunt.

The spike below already clears this bar comfortably on CLINC150, so the fallback ladder
(corpus-backed synonym expansion, then the tier-2 embedding arm) now exists to push the
operating pair up, not to rescue it — each still deterministic and offline, each a
separately labelled row so the claim stays honest about which machinery earned which
number.

## Estimated outcomes with the adapter (spike-measured priors, not claims)

A scratchpad spike (2026-07-15, tf-idf matchers over the real CLINC150 `data_full.json`,
threshold frozen on validation only; scripts not yet in-repo — step 2 rebuilds this
properly inside `nlubench/`) measured the tier-1 arms end to end:

| Arm | Raw in-scope acc | Frozen pair (acc / OOS recall) |
| --- | --- | --- |
| unigram 1-NN (plan's literal baseline) | 77.5% | 61.9% / 78.2% |
| unigram 15-NN vote | 83.0% | 63.4% / 78.2% |
| char 3–5-gram 15-NN vote | 83.9% | 68.2% / 89.7% |
| centroid unigram | 83.6% | 68.2% / 85.0% |
| centroid uni+bigram | 84.8% | 60.6% / 89.3% |

Lever findings from the same spike: k-NN voting over 1-NN is free and worth ~+5.5 raw
points; char n-grams are the biggest OOS-axis lever (+11.5 OOS recall vs unigram at equal
accuracy, at real index-build cost — the slow arm); class centroids match k-NN at a
fraction of the query cost; word bigrams are worthless (−1 to −2, dropped); margin-based
(top1−top2) rejection only moves along the accuracy/OOS trade-off curve and does not
dominate a plain score threshold — tested with both a margin-only and a score+margin grid,
not a planned lever anymore.

- **CLINC150, tier 1:** expect low-80s raw in-scope accuracy and an operating pair near
  68% / 88–90% before untested levers (WordNet synonym expansion, wink-nlp lemmas). The
  paper's classical baselines sit near 90% raw and BERT-class models near 97%, so we do
  not compete on that axis and the write-up should not pretend to. The claim shape: "X%
  OOS recall at Y% in-scope accuracy, no model, no training, no cloud, deterministic."
- **HWU64, tier 1:** spike-measured (same 2026-07-15 scratchpad spike, their real
  autoGeneFromRealAnno 10-fold splits, intent classification only): unigram 15-NN
  **micro-F1 0.792**, centroid unigram 0.791, char 15-NN 0.791 — all three arms converge
  on ~0.79, so surface matching plateaus there and char n-grams buy nothing without an
  OOS axis. That is ~7 points behind Rasa's published 0.863 and ~6.5 behind LUIS's
  last-place 0.855. The honest frame is value-per-footprint, not victory; post-lever
  ceiling ~0.81–0.83 (ethos-clean), embedding arm maybe 0.83–0.85. The harness must
  rescore with the upstream toolkit's own metric before any number is cited. Entity F1
  still estimate-only at 0.35–0.60; beating Watson's published 0.488 is plausible and
  would be the strongest single headline available.
- **Biggest estimate risk:** short utterances. Both datasets are heavy with 2–4 word
  queries where token overlap is thin, which drags tier-1 accuracy toward the bottom of
  the ranges and makes the threshold choice the dominant variable.

## Score-raising measures: the lever ladder

Ordered by expected points-per-effort. Discipline is the chatbench contract's: **one lever
per measured run**, results in the version-named write-up, so every movement is
attributable. Deltas are against the spike bases (CLINC150 68.2%/89.7%, HWU64 0.792).

- **L1 — pool evidence per intent (k-NN vote or class centroid), adopt as the harness
  default.** Measured: +5.5 raw points on CLINC150 over the plan's literal 1-NN baseline;
  on HWU64 all pooled arms already converge at 0.79. Zero risk, do it unconditionally.
- **L2 — char 3–5-grams on the CLINC150 OOS axis.** Measured: +11.5 OOS recall at equal
  accuracy. Slow index; CLINC-only (measured no gain on HWU64's closed-set task).
- **L3 — wink-nlp lemma/token normalization in the matcher tokenizer.** Est. +1–2 on both
  scales; also the first lever that makes the adapter genuinely tmct-flavoured rather
  than generic IR.
- **L4 — WordNet synonym/hypernym expansion from `corpus/wordnet/wordnet-full.jsonl`.**
  Deterministic query-token expansion (synset siblings at a fixed weight discount)
  before IDF scoring. Est. +2–4 where token overlap is thinnest (short imperative
  utterances). Post-L3/L4 targets: CLINC150 ~71–73% in-scope at ~90% OOS recall; HWU64
  intent F1 ~0.81–0.83 — knocking on LUIS's 0.855, unlikely to pass any of the four.
- **L5 — the static-embedding arm (`src/embed.mjs` model2vec), separately labelled row.**
  Est. the largest single jump: CLINC150 raw toward 87–90%; HWU64 toward 0.81–0.85,
  i.e. within ~5 points of Rasa's 0.863. Never the headline row; the pure-IR claim
  stays L1–L4 only.
- **L6 — precision-first entity extraction (HWU64 entity F1).** Longest-match gazetteer
  from training folds + hypernym typing from the WordNet corpus. This lever alone
  decides the beat-Watson-0.488 coin-flip, the strongest single headline in the plan.
- **L7 — inference uplift: complete OWL 2 RL property reasoning** (transitive / inverse /
  symmetric / functional properties, subPropertyOf, property chains, sameAs,
  allValuesFrom, hasValue, intersection completion — the ~70 unshipped RL rules; today
  `src/syllogise.mjs` ships 7 kernels, all class-level). Honest annotation: this does
  NOT move intent F1 — its benchmark surface is L6 (richer hypernym/role chains behind
  entity typing) plus chatbench groundedness; its main value is product capability
  (kinship, part-whole, role reasoning). Product-path work, delivered under the
  Syllogist track (`PLAN_SYLLOGIST.md` carries the survey of this territory), recorded
  here so the scoreboard linkage stays explicit.
- **L8 — inference uplift: generalize the 1.11.0 rule-teach frames to full Horn rules.**
  What shipped (compose-2 / filter / recursive frames, query-side hop-counted chase in
  `src/chat.mjs`) is a closed set of rule templates. The uplift is arbitrary
  conjunctive-body Horn rules ("every X that lives in water is aquatic"), forward-
  chained by `syllogise()` under the same budget/focus/trust guards — Datalog over
  binary predicates, still polynomial and deterministic. Same honest annotation as L7:
  no direct intent-F1 effect; moves teach/ask capability and chatbench, and feeds L6's
  typing. Stratified negation-as-failure stays out unless separately designed — it must
  not erode the open-world honesty behavior that wins the CLINC OOS axis.

Beyond L8, the reasoning ladder leaves this plan's scope entirely: OWL 2 EL
classification and DL tableau reasoning are a rebuild, not a lever — designed separately
in `PLAN_SYLLOGIST_EL_DL.md`.

## Risks and decision points

- **Ethos boundary.** Tier 1 is classical deterministic IR and stays inside the no-LLM,
  no-neural-training rule. Tier 2 (static embeddings) is a judgement call; keeping it a
  separately-labelled optional arm keeps the headline claim clean either way.
- **Dataset licensing** decides vendoring vs fetch-script (step 0). `.tmct/` stays
  uncommitted as ever; benchmark runs are read-only and never touch user memory.
- **Comparability drift.** The rival numbers are 2019 platform versions. Every citation of
  them must say so, or the claim is attackable.
- **Protocol fidelity on HWU64.** The 10-fold CV and their 190-per-intent subcorpus
  construction must be replicated exactly; a near-miss protocol produces a number that
  looks comparable and is not.

## Non-goals

- No product-path changes in this plan. The matcher is harness-only; promoting it to a
  chat capability is a separate, later decision. Levers L7/L8 are the exception in
  listing only: they are product-path work owned by the Syllogist track and appear in
  the ladder solely so their (indirect) benchmark effect is measured here when they land.
- No hand-authored FRAMES/lanes for benchmark domains. The playtests already show that
  approach grows one phrasing family at a time; it cannot reach 150 intents honestly.
- No leaderboard chasing on in-scope accuracy against transformer models. The claims this
  plan targets are the OOS/honesty axis, the entity-precision axis and value-per-footprint.
