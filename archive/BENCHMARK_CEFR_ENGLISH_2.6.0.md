# BENCHMARK_CEFR_ENGLISH_2.6.0 — the case set grows 109 → 128 at the arc boundary; like-for-like mean 1.817 → 1.826, the impact hard-fail clears, and the P-axis measures its horizon

**Result: mean 1.790 / 2 across 128 cases (like-for-like over the 109 shared with 2.5.0: 1.826), 3 hard fails, tier-1 127/128, 0 unscored cases (5 mid-run voids re-sampled).**

## Timing

- **Date:** 2026-07-18 (CEST).
- **Benchmarking session:** product replay 04:52 (1.2s, deterministic); judge fan-out 04:53 → ~04:57
  (`claude-haiku-4-5-20251001`, concurrency 12, 128 calls). An account spend-limit outage struck
  mid-fan-out: 5 judge invocations failed at the CLI layer and were VOIDED (never scored as fails);
  after the limit was raised the 5 voids were re-sampled 09:44 → 09:45, so every case carries a real
  score. The outage cost wall-clock, not integrity.
- **Analysis (reading the scores, writing this report):** 09:46 → 10:12.

The headline this cycle is the arc boundary, not the mean. The append-only case set was allowed to
grow for the first time since case-set v3: **109 → 128** (the 5 P-axis horizon cases landed by the
ladder reform, plus 14 hand-authored capability cases added by this run — the addition record is in
`chatbench/README.md` and the full list below). The overall mean (1.790) therefore measures a
harder set than 2.5.0 did, on purpose: the new cases include five P-axis cells that sit at the
honest-miss floor by design. The comparable number is the **like-for-like mean over the 109 shared
cases: 1.817 → 1.826**, with **zero tier-1 pass→fail regressions** — the shared tier-1 row is
108/109 at both versions, failing the same case for the same recorded reason.

Three deterministic movements matter more than either mean:

- **`gq-impact-a`'s hard fail is gone — 0.5 → 2.000.** The 2.5.0 decision log's item 3 named the
  cause exactly: `/impact` labelled a depth-2 transitive dependent `(imports it)`. The fix landed
  this cycle (`c7e5fbb fix(codegraph): a transitive impact dependent never claims the direct
  edge`), the label now reads "reaches it through an intermediary", and the judge scores the same
  closure 2/2.
- **The `be-honest-empty` reconciliation landed as the superseding case `be-honest-empty-v2`**
  (`PLAN_25_BACKLOG` §8.1's recommended path). The v2 case tracks the current product string —
  verified live in-process before authoring — and passes tier-1 with a judge 2.000. The frozen v1
  row stays in the set per the append-only rule and keeps failing its stale string check; from this
  cycle that failure is a recorded historical artifact, not an open item. Every LIVE expectation in
  the set is green; the 127/128 counter carries the one frozen row.
- **The P-axis is now measured, not just declared.** The five `pragmatic-implicature` /
  `cross-turn-composition` cases score a mean of 0.800 — the horizon made visible. One implicature
  case already passes outright (`do you know what calls fnAlpha` answers the callers, not "yes");
  the other four sit at the documented floor, two of them as this cycle's real hard fails (below).

## Profile

```bash
node chatbench/run.mjs --stamp 2.6.0 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-2.6.0/product.jsonl \
  --samples 1 --concurrency 12 --out chatbench/results/raw/run-2.6.0
# + a 5-case --only re-sample of the outage voids, appended, summary recomputed
```

128 cases, 133 judge calls (128 + 5 re-samples of voided calls), single draw, N=1. Judge model
**`claude-haiku-4-5-20251001`** (full pinned id), prompt **`judge-prompt-v1`**. Raw:
`chatbench/results/raw/run-2.6.0/` (the void rows stay recorded with `void: true`; the re-sampled
rows sit beside them and the summary excludes voids from every mean, per the skill's judge-integrity
rule). N=1 matches the 2.5.0 profile deliberately, so the like-for-like comparison holds; the N=1
caveat carries over unchanged — a single draw is not smoothed, and three of this cycle's
noteworthy scores (below) are exactly that caveat at work.

## The case-set addition (append-only, recorded)

The set is append-only mid-arc; an arc boundary is where it may grow. This run appended **14
cases**; no existing case was edited or removed. Ids and what each pins:

| id | pins |
|---|---|
| `be-honest-empty-v2` | the §8.1 supersession: the current bootstrap-empty wording as the live expectation |
| `hm-disjoint-chain-veto` | the 2.5.0 worst find: a stored disjointness vetoes the subclass-chain proof (contradiction report, never "so rex is a cat") |
| `gq-impact-blast-radius` | `blast radius of X` / `impact of X` answer the impact closure; nothing is remembered; "impact" never collapses to "import"; the depth-2 label claims no direct edge |
| `gq-impact-paraphrases` | `what happens if I change X`, `can I safely delete X`, `if I change X what breaks` all reach the closure |
| `am-stale-modifier-multi` | the multi-candidate stale-modifier decline: names "deprecated"/"legacy"/"cache", suggests candidates, answers for none of them |
| `conv-vocab-openers` | the Tier-0 vocabulary lane: `i wonder what a dog is`, `tell me something about a cat`, `what else can dogs do`, `what can you do for me`, `tell me about this repo` |
| `conv-board-read` | `where does disk-1 rest?` / `where is every disk` read the taught board, never the code locator |
| `conv-goal-stack-solve` | `stack all disks on peg-c` registers the goal; `solve it` finds the 7-move shortest plan |
| `conv-goal-conjunction` | a conjunction goal compiles one atom per conjunct (2 goals held) |
| `conv-guess-guesser` | guess-the-number, guessing seat: bisection 50 → 75 → 62, win report with guess count |
| `conv-guess-thinker` | thinking seat (secret pinned via case-level `env`): true hints, out-of-range declined by name, exact guess wins |
| `hm-guess-contradiction` | hints that empty the interval get the contradiction named, never another guess |
| `hm-pack-and-word-relations` | learn-on-miss: the reference-pack cited answer, the stored-fact second ask, the `zorblatt` miss standing, and the SKOS `another word for X` honest miss |
| `gq-needs-test-inversion` | `what most needs a test` ranks by FEWEST tests (the need-verb inversion) |

Every expectation was authored from a verified live replay through the harness's own `runCase`
before it was frozen. **All 14 pass tier-1**; 11 of 14 score a judge-clean 2.000 (the three
below-2 scores are analysed under "What the judge flagged").

One authoring note for future arcs: the pre-parse desire-opener rewrite (`i wanna know about a
horse` → `tell me about a horse`) makes those exact phrasings unmeasurable in session mode — the
session sidecar records the REWRITTEN query, so the runner's record-to-turn matching cannot see the
original surface. The family is covered here by its verbatim-recorded siblings and by the
`template.vocab.desire-opener` corpus pins; the sidecar's rewritten-query recording is routed as a
CONVERSATION finding (`BENCHMARK_CONVERSATION_2.6.0.md`, routed backlog).

## Scores

| | 2.6.0 (N=1) | 2.5.0 (N=1) |
| --- | --: | --: |
| cases | **128** | 109 |
| overall mean | 1.790 | 1.817 |
| like-for-like mean (shared 109) | **1.826** | 1.817 |
| hard fails | 3 | 1 |
| tier-1 pass | 127/128 | 108/109 |
| tier-1 pass, shared 109 | **108/109 (same case, same cause)** | 108/109 |
| pass→fail regressions | **0** | 0 |
| unscored cases | 0 | 0 |
| judge calls | 133 | 109 |

The overall means are NOT a like-for-like pair — the 2.6.0 set is 19 cases larger and includes
five deliberate floor-sitters. On the shared 109 the mean moves +0.009, inside N=1 judge noise; the
deterministic rows are the signal, and they say: nothing regressed, the one shared tier-1 failure
is the frozen v1 `be-honest-empty` row, and the 2.5.0 hard fail cleared.

### Hard fails — one instrument artifact, two horizon markers

2.5.0 had one hard fail (`gq-impact-a`, an N=1 judge flip on unchanged output). 2.6.0 has three,
and none is a shared-case regression:

- **`g-a1-naming-8` (0.000 — groundedness 0, correctness 0, honesty 0).** `what does tests mean`
  answers with the graph's own schema-doc gloss ("A test module's own internal imports — a
  lightweight … signal, not line-level coverage-tool data"). That gloss is real: it ships in the
  ingested schema docs every graph artifact carries. But `FIXTURE_CONTEXT` — the enumeration the
  judge scores groundedness against — names the vocabulary terms without their gloss text, so the
  judge read a truthful schema answer as invention and zeroed every dimension. This is the META-1
  class of judge-INPUT grain gap (cycle 4 fixed the same failure shape for symbol-grain output),
  surfaced now because the case's turn passes tier-1 for the first time and the judge finally
  scores a full answer instead of a miss. Decision-log item 1.
- **`g-c1-implicature-2` (0.250).** `I don't suppose app/lib/e.mjs imports anything` still
  misroutes into the teach lane and answers with the pronoun-rejection lecture. The case is a
  P-axis horizon cell and its `baselineFail` turn documents the miss — but the reply is
  confident-wrong-shaped (it asserts a wrong reading of the user's intent), and the judge scored it
  exactly as the rubric orders wrong-confident: below an honest miss. This is the P1 cell doing its
  job: the routing it measures does not exist yet, and the hard fail marks the sharpest edge of
  that absence — the negative-polarity opener is the one member of the desire/wrapper family the
  2.6.0 stripper does not peel.
- **`g-c2-xturn-2` (0.500).** The cross-turn composition case: after `who calls fnAlpha` answers
  Widget.render, `so what is the full call chain into fnAlpha` deflects into an entity lookup on
  "chain into fnAlpha". A P2 horizon cell, `baselineFail`-documented; the judge scores the
  deflection as confidently off-target. Horizon, measured.

So the hard-fail row reads 1 → 3, and the honest gloss is: the 2.5.0 hard fail (a real label
overstatement) was fixed and cleared; one new hard fail is a judge-input artifact with a named
correction; the other two are the P-axis floor being scored for the first time — the cells exist
precisely to hold this signal until the pragmatics/discourse routing lands.

### Per grade

| grade | n (2.6.0) | 2.6.0 mean | shared-109 mean | 2.5.0 mean |
| --- | --: | --: | --: | --: |
| A1 | 31 | 1.696 | 1.670 | 1.636 |
| A2 | 22 | 1.920 | 1.934 | 1.921 |
| B1 | 36 | 1.880 | 1.869 | 1.818 |
| B2 | 12 | 1.903 | 1.883 | 2.000 |
| C1 | 15 | 1.533 | 1.800 | 1.867 |
| C2 | 12 | 1.729 | 1.875 | 1.875 |

C1 and C2 drop in the full-set column because that is where the P-axis floor-sitters live; their
shared-109 columns are flat-to-noise. B2's 2.000 → 1.883 is `g-b2-passive-9` drawing a 1.333 on
this N=1 draw with tier-1 10/10 — judge wobble on a deterministic-green cell, the same caveat the
2.5.0 report attached to `negation`. The ladder is still not monotonic, which remains the expected
shape: the grade letters price the construction, not a difficulty tmct experiences.

### Per construction

| construction | n | 2.6.0 mean | 2.5.0 mean |
| --- | --: | --: | --: |
| **pragmatic-implicature** (P1, horizon) | 3 | **0.667** | — |
| **cross-turn-composition** (P2, horizon) | 2 | **1.000** | — |
| ellipsis | 1 | 1.000 | — |
| naming-vocabulary | 22 | 1.682 | 1.633 |
| quantifier-counting | 2 | 1.750 | — |
| temporal | 10 | 1.800 | 1.867 |
| discourse-reference | 5 | 1.800 | 1.800 |
| negation | 7 | 1.857 | 1.733 |
| noise+svo-query | 5 | 1.867 | 1.933 |
| svo-query | 29 | 1.874 | 1.780 |
| pronoun-binding | 20 | 1.879 | 1.871 |
| reversible-passive | 10 | 1.883 | 2.000 |
| assert-recall | 10 | 1.950 | 1.944 |
| conditional | 1 | 2.000 | — |
| coordination-compositional | 1 | 2.000 | — |

Four constructions appear with live cases for the first time — `conditional`,
`coordination-compositional`, `ellipsis` and `quantifier-counting` were all in the untested-shape
list every CEFR report has carried; the 14 capability cases happen to give each its first measured
row. Thin rows (n=1-2), but the untested-shape count drops from 14 to 10.
`ellipsis`'s 1.000 is the `conv-guess-guesser` judge-charter artifact (below), not an ellipsis
finding.

### Per cell — the floor is unchanged, and it is still A1 naming

| grade / construction | n | 2.6.0 mean | tier-1 | 2.5.0 mean |
| --- | --: | --: | :--: | --: |
| **C1 / pragmatic-implicature** (horizon) | 3 | **0.667** | 3/3* | — |
| **C2 / cross-turn-composition** (horizon) | 2 | **1.000** | 2/2* | — |
| C1 / ellipsis | 1 | 1.000 | 1/1 | — |
| **A1 / naming-vocabulary** | 12 | **1.479** (shared: 1.425) | 12/12 | 1.367 |
| A2 / quantifier-counting | 2 | 1.750 | 2/2 | — |
| C1 / temporal | 10 | 1.800 | 10/10 | 1.867 |
| B1 / discourse-reference | 5 | 1.800 | 5/5 | 1.800 |
| A1 / svo-query | 19 | 1.833 | 18/19 | 1.794 |
| B1 / negation | 7 | 1.857 | 7/7 | 1.733 |
| B1 / noise+svo-query | 5 | 1.867 | 5/5 | 1.933 |
| C2 / pronoun-binding | 10 | 1.875 | 10/10 | 1.875 |
| B1 / pronoun-binding | 10 | 1.883 | 10/10 | 1.867 |
| B2 / reversible-passive | 10 | 1.883 | 10/10 | 2.000 |
| A2 / naming-vocabulary | 10 | 1.925 | 10/10 | 1.900 |
| B1 / svo-query | 9 | 1.944 | 9/9 | 1.938† |
| A2 / assert-recall | 9 | 1.944 | 9/9 | 1.944 |
| A2 / svo-query | 1 | 2.000 | 1/1 | — |
| B2 / assert-recall | 1 | 2.000 | 1/1 | — |
| B2 / coordination-compositional | 1 | 2.000 | 1/1 | — |
| C1 / conditional | 1 | 2.000 | 1/1 | — |

\* horizon cells pass tier-1 because their frontier turns are `baselineFail`-documented; the
rollup's green/frontier split reports them as 1/3 and 0/2 green. † 2.5.0's B1/svo-query cell was
n=8; the shared-subset mean is shown.

Setting the by-design horizon cells aside, **the true floor is still `A1 / naming-vocabulary`**
(shared-109: 1.425, against 1.367 at 2.5.0 and 1.475 at 2.0.3 — flat across three cycles at N=1).
Same diagnosis as both prior reports: definitional answers mixing a correct generic definition with
fixture examples draw 1s, plus this cycle's sharper instance — the schema-gloss answer the judge
zeroed for want of the gloss in its context (`g-a1-naming-8`, decision-log item 1). The cell's
tier-1 is 12/12; this floor is a judge-scored quality gap and, in part, a judge-input gap, not a
miss.

### Per tag

| tag | n | 2.6.0 mean | 2.5.0 mean |
| --- | --: | --: | --: |
| bootstrap-empty | 3 | 2.000 | 2.000 |
| typo-fuzzy | 4 | 2.000 | 1.750 |
| conversational | 12 | 1.917 | 2.000 |
| ambiguity | 5 | 1.900 | 1.750 |
| noise | 5 | 1.867 | 1.933 |
| memory-recall | 3 | 1.833 | 1.833 |
| honesty-miss | 8 | 1.813 | 1.733 |
| multi-turn-focus | 5 | 1.800 | 1.800 |
| graph-query | 19 | 1.772 | 1.740 |
| graded (all) | 128 | 1.790 | 1.817 |

The tag rows with new members (conversational +6, honesty-miss +3, graph-query +3, ambiguity +1,
bootstrap-empty +1) are not comparable as trends; the shared-109 tag table in the raw analysis
shows every shared tag flat or up except `noise` (n=5 draw wobble). `typo-fuzzy` and `honesty-miss`
both recover their 2.5.0 N=1 dips, consistent with those dips having been draw variance, exactly as
that report predicted.

### Per rubric dimension (nulls excluded)

| dimension | n scored | 2.6.0 | 2.5.0 |
| --- | --: | --: | --: |
| groundedness | 111 | 1.856 | 1.847 |
| correctness | 100 | 1.720 | 1.738 |
| honesty | 72 | 1.764 | 1.883 |
| rephrase | 35 | 1.543 | 1.833 |

The honesty and rephrase drops are concentrated in the new floor-sitters and the two
judge-artifact scores: the P-axis cases score honesty/rephrase 0-1 by design of their documented
misses, and `conv-guess-guesser`'s honesty 0 is the judge-charter artifact below. On the shared
109 both dimensions are within noise of 2.5.0.

## What the judge flagged on the new cases — three scores worth reading

- **`conv-guess-guesser` 1.000 (correctness 2, honesty 0).** The judge's rationale concedes the
  bisection is "mathematically correct" and then dings honesty because *its own charter text* says
  tmct "may only state facts from the graph" and should refuse out-of-scope requests — the game
  looks like a charter violation to a prompt written before the game existed. `judge-prompt-v1`
  predates guess-the-number, the planner and the reference pack; the product's sanctioned
  capability surface has outgrown the prompt's description of it. Instrument finding, decision-log
  item 2. (The thinker-seat case, whose transcript shows range-checking and honest hints, scored
  2.000 on the same draw.)
- **`gq-needs-test-inversion` 1.500 (correctness 1).** A real product nit inside a passing case:
  the fewest-tests ranking includes `app/unit-tests/b.test.mjs` itself among what "most needs a
  test". The inversion is right; the candidate set should exclude test-source modules the way
  `/untested` already does. Routed to the backlog (CONVERSATION report, routed item), decision-log
  item 4.
- **`hm-pack-and-word-relations` 1.500 (honesty 1).** The judge calls turns 1-3 "exemplary" and
  docks the SKOS miss for offering no teach path ("teach me synonyms for otter"). Fair — and
  currently unbuildable as phrased: there is no synonym teach shape, which is exactly the
  prepositional-verb predicate-minting decision already sitting with the operator (`HANDOVER.md`
  open item). The miss text can grow a hint once that lands.

## Best examples — what good looks like at 2.6.0

**92 of 128 cases score a clean 2/2.** The demo reel this cycle is the new capability surface
answering with receipts, and the honesty machinery extending into game state:

```txt
Q: rex is a dog / every dog is a cat / no dog is a cat / is rex a cat   [hm-disjoint-chain-veto, 2/2]
A: you've told me both dog is a kind of cat (source: …) and dog is not a cat (source: …) —
   together those contradict, and I won't derive an answer from an inconsistency.
   To settle it, say "forget that dog is a cat".

Q: what is an otter                                              [hm-pack-and-word-relations]
A: otter — Otters are animals that live near and around water. … (source: reference article
   "Otter", Simple English Wikipedia, CC BY-SA 4.0 — https://simple.wikipedia.org/wiki/Otter?oldid=9364353)

Q: I'm thinking of a number between 1 and 100 → higher → lower → correct   [conv-guess-guesser]
A: My guess: 50. … My guess: 75. … My guess: 62. … Got it — your number is 62, found in 3 guesses.

Q: (after five hints that leave only 32) lower                   [hm-guess-contradiction, 2/2]
A: That's not possible — you said higher than 31, and now lower than 32, but no number can be
   both. One of those answers must be wrong. Say "guess my number" to restart.

Q: blast radius of app/lib/a.mjs                                 [gq-impact-blast-radius, 2/2]
A: Impact of changing app/lib/a.mjs … depth 1 (4 direct dependents): app/lib/b.mjs (imports it) …
   depth 2 (2): app/functions/d/handler.mjs (reaches it through an intermediary) …

Q: do you know what calls fnAlpha                                [g-c1-implicature-1, tier-1 PASS]
A: in app/lib/b.mjs there is function Widget.render().
```

The disjointness veto is the strongest of these: 2.5.0's single worst finding was this exact
transcript ending in "yes, with a proof"; it now ends in a contradiction report that names both
stored facts and refuses to pick. The last excerpt is the P1 cell's first live pass — an indirect
speech act answered as a request, not a yes/no.

## Predictions vs actuals

The 2.5.0 decision log's ranked menu, checked item by item:

| predicted / picked | actual |
| --- | --- |
| PICK: reconcile `be-honest-empty` (expect tier-1 108/109 → 109/109) | Landed as the superseding case (`be-honest-empty-v2`, the revise path §8.1 recommended). Every live expectation is green; the raw counter reads 127/128 because the frozen v1 row stays failing as the historical record — the predicted "109/109" materializes as "0 live failures", not as a counter value |
| item 3: `gq-impact-a` depth-label rephrase | Landed (`c7e5fbb`); hard fail cleared, 0.5 → 2.000 |
| item 2: diagnose `A1 / naming-vocabulary` (1.367) | Not undertaken; floor persists (shared 1.425), and this cycle adds a sharper diagnosis: part of it is judge-input grain (`g-a1-naming-8`) |
| item 4: grow the pool toward untested shapes | Partially, via the arc boundary: 4 of the 14 untested constructions gained first cases (conditional, coordination-compositional, ellipsis, quantifier-counting), plus the two P-axis families; 10 surface-parse shapes remain untested |
| item 5: N≥2 before chasing small-cell drops | Not this round — N=1 kept deliberately for the like-for-like pair; the 2.5.0 small-cell dips (`typo-fuzzy`, `honesty-miss`) recovered on this draw, confirming them as variance |

## Per-lever analysis

Levers committed this cycle (before this measurement), and what each moved:

- **The chat-track backlog (`PLAN_25_BACKLOG` §§1-7, 9) + the three new capabilities
  (guess-the-number, learn-on-miss, SKOS synonyms) + the superlative inversion.** Measured through
  the 14 new cases: 14/14 tier-1, 11/14 judge 2.000. Also measured through the shared set's
  baselineFail estate: 15 previously-documented weakness turns now pass their recorded checks
  without an `improvedIn` stamp (g-a1-naming-1/8/9, g-a2-naming-2, mr-asked-before, am-bare-name,
  mt-focus-drift t2+t3, g-c2-pron-3/5/6/7/8/9/10) — some of these were already passing at 2.5.0
  (its report names g-a1-naming-1/8/9); the improvement cycle per turn is not attributable from
  N=1 snapshots, so the next cycle should stamp `improvedIn` per the runner's documented
  convention and make them enforced.
- **`c7e5fbb` (impact depth label).** Moved exactly `gq-impact-a`: hard fail → 2.000. No other
  case's output contains the label.
- **The `be-honest-empty-v2` supersession (this run's own case addition).** Tier-1 live green;
  judge 2.000 on both the v1 and v2 rows (the behaviour was always an honest miss; only the frozen
  string check disagreed).

## Decision log — the re-ranked lever menu, LOGGED not applied

1. **PICK — extend `FIXTURE_CONTEXT` with the schema-doc glosses (a META-1-class judge-input
   correction).** `g-a1-naming-8` hard-fails at 0.000 because the judge cannot see the gloss text
   the graph itself carries, so it zeroes a truthful schema answer. Cheap, surgical, and it is the
   difference between a 0.000 and a plausible 2 on the A1 naming floor. Like cycle 4's META-1, this
   re-baselines groundedness on affected naming cases; say so in the next report.
2. **Bump the judge prompt to `judge-prompt-v2` naming the sanctioned capability surface** (games,
   planning, the reference pack, seeded vocabulary). v1's charter line ("only state facts from the
   graph") predates all four and produced `conv-guess-guesser`'s honesty 0 on a correct game. A new
   pinned file per the versioning rule; scores across the boundary are not comparable on the
   affected cases.
3. **The P1 negative-polarity opener (`I don't suppose X …`) — the one hard fail that is a real
   product behaviour.** The desire/wrapper stripper family that fixed `i wanna know about X` does
   not peel it, and the teach lane's pronoun lecture asserts a wrong intent. Fixing it is the first
   concrete step toward graduating the P1 cell.
4. **Exclude test-source modules from the needs-a-test superlative** (`gq-needs-test-inversion`
   correctness 1): the ranking currently names `b.test.mjs` as needing a test; `/untested` already
   knows better.
5. **`A1 / naming-vocabulary` after item 1 lands** — re-read the floor once the judge can see the
   glosses; whatever remains is the real definitional-answer quality gap, and wants an N≥2 read.
6. **N≥2 for the next comparison cycle.** Two draws would have settled this cycle's B2 passive and
   noise wobbles for ~$10.

## Discipline

- **Gate before the run:** `npm run test:smoke` 8/8, `npm run test:fast` 181/181, harness tests
  (`test/bench/chatbench.test.mjs` + `chatbench-graded.test.mjs`) 68/68, CLI smoke (`printf
  'hi\n/exit\n' | node bin/tmct.mjs`) greets and exits 0 in a graph-less temp dir. This round ran
  in an isolated benchmark worktree under the blast-radius rule; the full `npm test` gate belongs
  to the merge to `main`, not to this measure-only tree.
- **Judge pins recorded on every row:** `claude-haiku-4-5-20251001`, `judge-prompt-v1`, samples 1.
- **Voids never scored as fails:** the 5 outage-voided samples are recorded with `void: true` and
  were re-sampled to real scores; final unscored cases 0.
- **No LLM in the product path.** The judge exists only in this harness.
- **Raw snapshotted** to `chatbench/results/raw/run-2.6.0/` (plus `run-2.6.0-voidfill/` for the
  re-sample provenance) before any later run can overwrite.
- **Case set: append-only honoured.** 14 additions, 0 edits, 0 removals; the addition is recorded
  in `chatbench/README.md` and in this report. The superseded `be-honest-empty` row stays.
- **Measure-only:** no `src/` or `test/` edit was made by this run.

## Open items routed onward

Mirrored into the coordinator's pickup list (this measurement worktree does not edit
`HANDOVER.md`; the coordinator lands these lines on merge):

- `FIXTURE_CONTEXT` lacks the schema-doc glosses; a truthful `what does tests mean` schema answer
  hard-fails groundedness at 0.000 (`g-a1-naming-8`) — decision-log item 1, this report.
- `judge-prompt-v1` predates the game/planner/reference-pack capability surface; a correct
  guess-the-number game draws honesty 0 (`conv-guess-guesser`) — decision-log item 2.
- `I don't suppose X imports anything` misroutes to the teach lane's pronoun lecture
  (`g-c1-implicature-2`, hard fail; also found live by the persona sweep) — decision-log item 3.
- The needs-a-test superlative includes test modules in its answer set
  (`gq-needs-test-inversion`) — decision-log item 4.
- 15 baselineFail turns now pass without `improvedIn` stamps; the next cycle should stamp them so
  the fixed weaknesses become enforced regressions per the runner's documented convention.
- 10 construction shapes still have no cases in the go-to pool (down from 14).
