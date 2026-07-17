# PLAN_NLU_BENCHMARKS.md — scoring tmct on CLINC150 and HWU64

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Goal

Adapt tmct so it can be scored by two pre-existing, third-party NLU scoring systems, then
extract the successes and failures:

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
(`src/domain/router/registry.mjs`, `capabilities()`), a 22-tool declared surface
(`src/tools/definitions.mjs`, of which `tmct_context`, `tmct_snippet` and `tmct_ask` are the hot
tier `src/tools/server.mjs` dispatches), a
commonsense fact/teach surface in `src/services/chat.mjs` (IsA/HasA/CapableOf over a small
animal-flavoured seed corpus), and runtime-taught game actions. None of the CLINC150/HWU64 domains
(banking, travel, weather, alarms, music, cooking, ...) exist anywhere in the product. A sweep of
the playtest logs confirms no probe has ever touched them, and no corpus lane keys any of them
(`node scripts/corpus-matrix.mjs`).

Both benchmarks require the system to emit one label from a fixed vocabulary (150 or 64
intents). tmct has no mapping to either vocabulary, so every in-scope query scores wrong
by construction. Its refusal machinery is real and machine-readable (`miss: true`,
`WALL_MISS_RE` in `src/services/chat.mjs`), so every OOS query maps to a correct "oos" prediction.

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

## What the test estate gives this plan, and what it does not

The estate is now organised around a tested tool surface and a keyed corpus: `src/` is five layers
with downward-only imports (`test/estate/import-layers.test.mjs`), `src/tools/` is the tool layer,
and `test/corpus/` holds ~790 rows across 11 JSONL lanes (793 measured 2026-07-17), each row keyed by
the production or capability it pins and driven through the real session. The lanes grow most weeks,
so treat any row count here as a snapshot — `wc -l test/corpus/*.jsonl test/corpus/games/*.jsonl` is
the live one. `node scripts/corpus-matrix.mjs` prints the
key × lane matrix; `--gaps` names the keys a single row pins and the keys with no negative row.
That changes three things for this plan, and leaves the central problem untouched.

**What it makes easier.**

- **The as-is baseline (step 1) is a lane, not a new harness.** A lane row already does exactly what
  step 1 describes: drive turns through `createSession` and assert a named predicate. Run a curated
  diagnostic slice of benchmark utterances as rows with a miss-wall predicate, and the false-accept
  inventory becomes a test rather than a one-off report. The read-only requirement comes free: rows
  run in an ephemeral scratch dir under `TMCT_NO_SEED`, so the wrong-lane-write risk cannot touch
  user memory.
- **Wiring the harness up is an existing, keyed pattern.** `test/corpus/bench-smoke.jsonl` carries
  one row per benchmark (`bench.chatbench`, `bench.infbench`, `bench.agentbench`,
  `bench.conversation`), each spawning the real script and handing the finished process to a
  predicate. An `nlubench` adds a `bench.nlubench` row the same way, so "the harness still runs" is
  checked on every `npm test` instead of rotting between cycles.
- **Confirmed failure families get a home.** Step 5 folds each confirmed family back as a keyed row
  that freezes the current wrong answer, so a later fix has to flip it deliberately. The chat-surface
  debt rows in `PLAN_AGENTS.md` §3 are the worked precedent.
- **The promotion path is concrete if the matcher is ever promoted.** The layer rule decides where it
  could live: harness-only means outside `src/` entirely, and a promoted matcher would be a `domain/`
  module the tool layer calls, with a contract test and a registry entry. That remains a separate,
  later decision.

**What it does not touch.**

- **The label vocabulary.** tmct still has no mapping to 150 or 64 intents. The lanes pin behaviour;
  they do not supply a label space, and no fixture carries a CLINC/HWU domain. This is the whole gap,
  and the reorganisation does not narrow it.
- **Scale.** The estate is built for ~790 curated rows inside `npm test`; the grammar lane's 241 rows
  take about 5.7 seconds. CLINC150's test set and HWU64's 25,716 utterances under 10-fold CV are
  orders of magnitude past that. The scored runs stay in `nlubench/` with their own runner and their
  own results tree. Only the diagnostic slice belongs in a lane.
- **Training.** Rows assert; they do not train. The matcher below is still the layer tmct lacks.
- **Coverage measurement.** `--gaps` measures how thinly the estate pins tmct's own capabilities. It
  says nothing about benchmark coverage.

## Design: a benchmark adapter, not a product rewrite

New top-level `nlubench/` directory, sibling to `chatbench/`, holding data plumbing, the
matcher, the runners and the reports, plus a `bench.nlubench` smoke row in
`test/corpus/bench-smoke.jsonl`. The matcher trains from the benchmarks' example utterances; that is
the layer tmct lacks today.

### The matcher (deterministic, trainable from examples)

- **Tier 1 (default, ethos-clean): IDF-weighted token-overlap nearest neighbour.** Reuse
  the scoring shape of `retrieveBlocks` (`src/adapters/memory/blocks.mjs`): index every training
  utterance under its intent label, score a test utterance against all of them with
  wink-nlp token/lemma normalisation, take the top-scoring label. Classical IR, no model
  weights, byte-identical output on repeated runs.
- **Rejection threshold → "oos".** Below-threshold top score emits the OOS label
  (CLINC150) or an abstention (HWU64, recorded but scored as wrong under their protocol).
  The threshold is tuned **only on the validation split** (CLINC150 provides one; for
  HWU64 hold out from training folds). Never on test.
- **Tier 2 (optional, flagged arm): dense cosine via `src/adapters/embed.mjs`** (static model2vec
  embeddings, offline, deterministic). This is ML-trained weights, so it sits outside the
  ethos-clean tier; run it as a separately-labelled arm so both numbers exist and the claim
  can cite the pure-IR one.
- **Entity extraction for HWU64:** deterministic gazetteer + pattern extractor built from
  the training folds' annotated spans (exact-match lexicon per entity type, wink-nlp
  tokenisation, longest-match-wins), no sequence model. Target is Watson's published 0.488
  entity F1, which low-precision hurt; a conservative extractor competes on precision.

The matcher lives in the harness only, like the LLM judge does. Whether it later becomes a
product-path domain via `registerCapability` is a separate, later decision.

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
   - Keep the full scored run in `nlubench/`. Freeze a small diagnostic slice of the
     inventory as keyed corpus rows (one per confirmed false-accept family), so the leak
     is re-checked on every `npm test` rather than only when the harness runs.

**2. Matcher v1 (tier 1) + threshold sweep.**
   - Build the IDF-NN matcher and gazetteer extractor. Sweep the rejection threshold on
     validation only; freeze it before touching test. The matcher is harness-only, so it
     lives under `nlubench/` and outside `src/`, and its unit tests sit beside it. Add the
     `bench.nlubench` smoke row so the runner itself stays wired. `npm test` stays green.

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
     Each confirmed family also becomes a keyed corpus row freezing the current wrong
     answer, so a later fix has to flip the row rather than argue with a write-up.

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
  last-place 0.855. Read this as value-per-footprint, not as a ranking; post-lever
  estimate ~0.81–0.83 (ethos-clean), embedding arm maybe 0.83–0.85. The harness must
  rescore with the upstream toolkit's own metric before any number is cited. Entity F1
  still estimate-only at 0.35–0.60; beating Watson's published 0.488 is plausible and
  would be the strongest single headline available.
- **Biggest estimate risk:** short utterances. Both datasets are heavy with 2–4 word
  queries where token overlap is thin, which drags tier-1 accuracy toward the bottom of
  the ranges and makes the threshold choice the dominant variable.

## Score-raising measures: the lever ladder

Ordered by expected points-per-effort. Discipline is the chatbench contract's: **one lever
per measured run**, results in the version-named write-up, so every movement is
attributable. Deltas are against the spike bases (CLINC150 68.2%/89.7%, HWU64 0.792) — and those
bases came from a scratchpad spike whose scripts were never committed, so nothing in the repo can
re-derive them. Step 2 rebuilds the spike inside `nlubench/`. Rebase every delta on that run's
numbers when it lands; until then the bases are a pointer, not a baseline.

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
- **L5 — the static-embedding arm (`src/adapters/embed.mjs` model2vec), separately labelled row.**
  Est. the largest single jump: CLINC150 raw toward 87–90%; HWU64 toward 0.81–0.85,
  i.e. within ~5 points of Rasa's 0.863. Never the headline row; the pure-IR claim
  stays L1–L4 only.
- **L6 — precision-first entity extraction (HWU64 entity F1).** Longest-match gazetteer
  from training folds + hypernym typing from the WordNet corpus. This lever alone
  decides the beat-Watson-0.488 coin-flip, the strongest single headline in the plan.
- **L7 — inference uplift: complete OWL 2 RL property reasoning** (transitive / inverse /
  symmetric / functional properties, subPropertyOf, property chains, sameAs,
  allValuesFrom, hasValue, intersection completion — the bulk of the RL rule set; today
  `src/domain/syllogise.mjs` ships five rules: `scm-sco` and `scm-svf1` at class level, and
  `cax-sco`, `cax-dw`, `cls-svf1` over individuals). Honest annotation: this does
  NOT move intent F1 — its benchmark surface is L6 (richer hypernym/role chains behind
  entity typing) plus chatbench groundedness; its main value is product capability
  (kinship, part-whole, role reasoning). Product-path work, delivered under the
  Syllogist track (`PLAN_SYLLOGIST.md` carries the survey of this territory), recorded
  here so the scoreboard linkage stays explicit.
- **L8 — inference uplift: generalize the 1.11.0 rule-teach frames to full Horn rules.**
  What shipped (compose-2 / filter / recursive frames, query-side hop-counted chase in
  `src/services/chat.mjs`) is a closed set of rule templates. The uplift is arbitrary
  conjunctive-body Horn rules ("every X that lives in water is aquatic"), forward-
  chained by `syllogise()` under the same budget/focus/trust guards — Datalog over
  binary predicates, still polynomial and deterministic. Same honest annotation as L7:
  no direct intent-F1 effect; moves teach/ask capability and chatbench, and feeds L6's
  typing. Stratified negation-as-failure needs its own design pass before it lands — it
  must not erode the open-world honesty behavior that wins the CLINC OOS axis.

Beyond L8, the reasoning ladder leaves this plan's scope entirely: OWL 2 EL
classification and DL tableau reasoning are a rebuild, not a lever — designed separately
in `PLAN_SYLLOGIST_EL_DL.md`.

## Visible thinking: rendering the proof and the plan

An LLM's chain-of-thought is narration sampled from the same model — tokens about the
computation, not the computation. tmct's equivalents are the proof object and the plan
object, which ARE the computation, rendered afterwards; the display cannot diverge from
what happened. Two surfaces make that visible, and both belong in the claims story this
plan builds (the "deterministic, grounded, no model" claim gets its demo), even though
neither moves a leaderboard number directly — same honest annotation as L7/L8.

- **W1 — a real `/why` proof-rendering lane (days-scale).** Today chat's "why" lane
  (`src/services/chat.mjs`, the "why"/"say more" re-render group) only re-renders the previous
  answer more fully. The feature: on
  "why" after an answered fact, re-run the bounded live chase in proof-recording mode
  (the kernels already return `via`/premises; `scm-sco` facts already persist a
  two-premise justification; trust already grades by hop count via
  `min(premiseTrusts) × ruleConfidence`) and render each premise as a plain sentence
  with its source tag and grade: "dog ⊑ mammal (taught, 0.9) + mammal ⊑ animal (corpus,
  1.0) ⊨ dog ⊑ animal (entailed, 0.86)". Everything it needs exists; only the lane and
  the template rendering are new. Scope grows with the ladder: taxonomic answers first,
  rule-frame applications when L8 lands ("john bornIn italy" + "people born in italy
  are italian" ⊨ "john is italian"), case-split proofs via `PLAN_SYLLOGIST_EL_DL.md`'s
  `/prove`.
- **W2 — planner consumption of `taught:` capability records ("how can I build X?",
  days-to-weeks).** `src/domain/router/planner.mjs` already does HTN decomposition with a POP
  causal-link chain, monitored execution, and an internal `why` trace; goal sentences
  and taught actions shipped in 1.11.0; `tmct plan` + the plan-viz page already render
  goal and steps. The named gap (a 1.11.0 follow-up in `HANDOVER.md`) is the planner
  consuming `taught:` records, so "how can I build X" plans over a world model the user
  taught in sentences — with the plan page as the visible-thinking display.

Measurement hooks: W1's rendered proofs become chatbench evidence (the groundedness and
honesty-on-miss rubric dimensions get transcript-visible premises to score), and both
surfaces feed the benchmark write-ups' "claims this supports" section — the difference
between asserting determinism and showing the derivation.

The far end of the why-spectrum, worked — "why did the American Civil War start?":

- **Teach:** "secession caused the civil war", "the slavery dispute caused secession",
  "the cotton economy caused the slavery dispute". Causal edges are already first-class:
  `mgx:causes` is a corpus predicate with a display phrase (the predicate-phrase table in
  `src/services/chat.mjs`), taught
  cause facts store today (the taught `mgx:cause` vs corpus `mgx:causes` predicate
  unification is a known deferred item that W1 would force closed).
- **Ask "why did the civil war start?" today:** at best a single-hop read-back of one
  taught edge; no multi-hop cause chase exists, and "why" only re-renders the previous
  answer. Effectively a miss.
- **After W1:** the same graded chain rendering as any other proof — "the cotton economy
  → the slavery dispute → secession → the civil war", each hop a taught fact with its
  source and trust, the far end arriving visibly weaker (three hops of
  `min × ruleConfidence` attenuation). tmct answers exactly as well as the causal graph
  it was taught, and shows precisely which taught claims the answer rests on.
- **Research horizon past that:** weighing contested historiography, defaults,
  counterfactuals, competing narratives — problems with no generally accepted
  deterministic engineering to adopt today (candidate literatures exist: defeasible
  logic, argumentation frameworks). Until a tier is designed for them, tmct renders an
  account rather than synthesizing one, with provenance — and that gap is
  benchmark-observable, not something this document needs to legislate. The demo line:
  for "why is John Italian" the proof IS the answer; for the civil war, the proof is an
  inventory of what tmct was told, clearly labelled as such.

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

## Not in this plan

- Product-path changes. The matcher is harness-only here; promoting it to a chat
  capability is a separate, later decision. Levers L7/L8 are the exception in listing
  only: they are product-path work owned by the Syllogist track and appear in the ladder
  solely so their (indirect) benchmark effect is measured here when they land.
- Hand-authored FRAMES/lanes for benchmark domains. The playtest evidence says that
  approach grows one phrasing family at a time — the wrong tool for 150 intents; the
  trainable matcher is the right one.
- Leaderboard chasing on in-scope accuracy against transformer models. The claims this
  plan targets are the OOS/honesty axis, the entity-precision axis and value-per-footprint.
