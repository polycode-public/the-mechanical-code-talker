# PLAN_COMMON_SENSE_QA.md — swap the claims stack to CommonsenseQA, and climb five rungs off zero

Status: F0 (the fixture), F1 (the option splitter), F2 (the chat lane), F3 (the rig), and F4
(the claims block) are built and tested. Every other module path marked "new" below is still a file
that does not exist yet. The plan delivers the whole arc: the closed multiple-choice lane, the
CommonsenseQA fixture and rig, the claims block, the removal of the OpenBookQA stack, and the five
measured rungs that follow.

This plan is written to be built by a Sonnet-tier implementer with no further design work. Every
phase names its module paths, its data structures, its function signatures, its test files, its
corpus rows and its acceptance commands. Where a phase is mechanical enough for Haiku, it says so.

No LLM runs anywhere in this stack. Not in the product path, which is the project constitution, and
not in the scoring path either. Scoring is a gold-key comparison against a committed answer key.
That is the difference between this axis and the CEFR axis: `npm run chatbench:judge` sends
transcripts to a judge model, and every CEFR number carries that judge as a condition. A
CommonsenseQA number carries no judge, so it is reproducible by anyone with the repo.

---

## 1. What ships today

### 1.1 The claims stack

`scripts/claims/lib.mjs` is the shared writer. A rig calls `writeClaim(name, payload)`; the writer
stamps `generatedAt`, `commit`, `hardware` and `pack`, validates against `scripts/claims/schema.json`
through `checkClaim`, writes `results/claims/<name>.json`, and then throws if the value crossed its
committed threshold. It writes the file first and throws second, on purpose, so the regression
evidence survives the failure.

Three rigs are registered today, discovered by `run-all.mjs` from the `claim:` prefix in
`package.json`:

| rig | what it measures | seed it runs against | committed value |
|---|---|---|---|
| `claim:planner` | largest Hanoi instance solved under 1s | none (teach lane only) | 9 disks |
| `claim:prose-band` | how much raw Simple Wikipedia prose grounds into a fact | default `tmct init` seed | 18.65 percent |
| `claim:openbookqa` | OpenBookQA questions answered with `wordnet-xl` preloaded | bespoke `tmct import --corpus wordnet-xl` | 0 of 100 |

`scripts/site-pages.mjs` exports `CLAIMS_PAGE_BLOCKS = ["planner", "prose-band", "openbookqa"]`,
a bare list of JSON basenames. `renderClaimsHtml` in `scripts/build-demo-site.mjs` renders one
`claimFigureBlock` per name, and every figure it prints is read off the loaded JSON at build time.
The block shell takes `{ id, kicker, sentence, figureHtml, notMean, standard, jsonName, demoHref }`
and emits the kicker, the sentence, the figure, a "What this does not mean" paragraph, a "Meets the
standard" line, and a footer naming the source JSON and the command that regenerates it.
`results/claims/README.md` states the rule the whole design rests on: no number in a claim JSON is
restated anywhere else, so a page quotes the JSON rather than hardcoding a figure.

`test/estate/claims.test.mjs` is the gate. Every name in `CLAIMS_PAGE_BLOCKS` must resolve to a
JSON file that exists, parses, passes the schema, and cites `sources` paths that exist in the repo.
`loadClaimBlock` runs the same schema check at site-build time, so a bad block fails the build too.

### 1.2 The default chat seed

`npm run chat` and `chat.html` do not share a seed artifact, and the difference matters for what
this plan measures.

The CLI's bare default seeds one band, `human`, at 688 facts. `test-e2e/bootstrap-seed.test.mjs`
pins that to exactly one bundle. The browser demo loads `public/chat-seed.json`, a gitignored build
output produced by `scripts/build-chat-seed.mjs` from `INIT_XL_BANDS`:

```
["human", "human-medium", "human-large", "seon", "conceptnet",
 "tier2-aws", "tier2-python", "tier2-java", "wordnet-xl"]
```

The same band set is what `npm run init:xl` gives the CLI. `SEED_BAND_CAPS` caps the ConceptNet band
at 28,000 facts, `SEED_BYTE_CEILING` caps the whole artifact at 100 MB, and the cap is spent through
`seedMemory`'s `prefer` list, `CONCEPTNET_PREFER` in `src/services/extensions.mjs`, which ranks
`rdfs:subClassOf`, `rdf:type`, `mgx:usedFor`, `mgx:partOf`, `mgx:capableOf` ahead of everything else.
Within a rank band, slice file order decides, so the cut is reproducible but not weight-ordered.

The ConceptNet band reads `corpus/conceptnet/slice.jsonl`, a committed 44,827-edge cut of the pinned
ConceptNet 5.7.0 assertions dump, seeded from about 90 `SEED_TERMS` in `corpus/conceptnet/fetch-slice.mjs`
plus about 230 `EXTRA_SEEDS` in `corpus/conceptnet/filter-dump.mjs`. Those seed terms are a
software and technology vocabulary. The slice that comes out is dominated by `/r/RelatedTo` (28,933
of 44,827 edges), and the relational tail this plan needs is thin: `/r/AtLocation` 641,
`/r/UsedFor` 373, `/r/CapableOf` 230, `/r/PartOf` 196, `/r/MotivatedByGoal` 25, `/r/Causes` 18,
`/r/Desires` 9.

`corpus/child/` is a second, larger ConceptNet cut off the same pinned dump: 46,883 terms, 92,638
keyed facts, seeded from the 702 hand-authored child-concept terms in `corpus/conceptnet/child-seed.mjs`.
Its predicate mix is the one commonsense questions actually key on: `rdfs:subClassOf` 35,970,
`mgx:atLocation` 10,515, `mgx:synonym` 10,046, `mgx:capableOf` 6,651, `mgx:usedFor` 5,878,
`mgx:partOf` 2,019, `mgx:desires` 2,035, `mgx:motivatedByGoal` 798, `mgx:causesDesire` 318,
`mgx:causes` 287. It is never bulk-seeded. Chat reaches it lazily through `getChildPackProvider`
and `childPackFactsForKey` in the learn-on-miss cascade, stage `(4h)` of `runAsk`'s miss ladder.
A fact pulled that way carries `child:conceptnet:<term>` provenance at the 0.7 corpus trust prior.

Both cuts are CC BY-SA 4.0 in `corpus/LICENSES.json`, with notices at
`corpus/conceptnet/LICENSE-NOTICE` and `corpus/child/LICENSE-NOTICE`.

One gap the survey found and this plan closes in rung 1: `corpus/child/` carries a manifest with a
per-file sha256 pin, and `test/estate/child-pack.test.mjs` asserts byte-determinism against it.
`corpus/conceptnet/slice.jsonl` carries no manifest, no hash and no row-count guard. You can change
the slice today and nothing in the estate suite notices.

### 1.3 The lanes, and where a new one fits

`src/services/chat.mjs` is 17,791 lines and has two lane tiers. `dispatchTurn` (line 17064) runs an
ordered list of recognizer-gated blocks, each returning on a hit. The teach write boundary sits at
`assertTurn` (17541) and `bareTaxonomyTeach` (17551). The ask engine is the last resort, `runAsk`
at 17727. Inside `runAsk`, a second set of lanes runs before the actual parse at line 14266, and a
numbered miss cascade runs after it, with the teach lane at stage `(4)`, line 15130.

The two temporal-comparison lanes (13969 and 14029) are the closest precedent for what this plan
builds. Both are closed-set recognizers checked before the ask engine, and the singular one's own
comment gives the reason: falling through handed the sentence to the teach-offer cascade, which read
part of the question as a subject to learn facts about. A choice question has the same failure mode.
"is a whale a fish or a mammal" puts `or` in the object slot and the teach cascade reads it as a
thing to be taught.

The refusal voice is `joinOr`, a module-local const at 16444, an Oxford-comma "or" join. Both of its
call sites are refusals that list candidates and ask which one was meant. `joinList` is its sibling
for "and" joins. Neither is exported, and there is no `joinAnd` anywhere.

The per-option grounding probe has two reusable precedents. `answerWithoutFillerPrefix` (17035) peels
a closed filler clause and re-runs the ordinary dispatcher on the remainder, accepting only on a
double match: the prefix comes from the closed inventory and the remainder grounds. Its ground
verdict is `retry.record?.miss`. The term-level ladder is the narrower one: `isGroundedTerm` (3653)
covers the lexicon, generic anchors, the code graph and taught facts, and `isAnchorableTerm` (3672)
widens that with `isCorpusAnchoredTerm`, which is the tier a child-pack fact lands in.

`findIsaChain` (`src/domain/syllogise.mjs`, line 1736) is the citable proof. It walks outward from a
subject, breadth-first, first hop `rdf:type` or `rdfs:subClassOf` and every hop after `rdfs:subClassOf`,
and returns the shortest chain as an ordered premise list or null. `renderIsaChain` (chat.mjs 7970)
turns that list into "X is a Y; Y is a Z; so X is a Z", with `(source: ...)` on each step that
carries provenance.

Two things the survey turned up that this plan uses directly. `src/domain/dialogue-acts.mjs` already
declares a `choiceQuestion` act, glossed as "a question asking which of the listed alternatives
holds", and no lane maps to it. And there is no `or`-splitting machinery anywhere in `src/domain/`
outside `ask.mjs`'s set algebra, so the option splitter is new surface with nothing to collide with.

---

## 2. The fixture, measured

CommonsenseQA's dev split is 1,221 questions, every one five-choice with labels A to E, 785 distinct
source concepts, all ids unique. Each row carries `answerKey`, `id`, and a `question` object holding
`question_concept`, `choices` and `stem`.

The selection rule follows the OpenBookQA fixture's own precedent, which sorts by id and keeps every
fifth row. Here: **sort the dev rows by `id` ascending as strings, then keep every twelfth row from
index 0, stopping at 100 rows** (indices 0, 12, 24, up to 1,188). The ids are content hashes, so the
sort is stable and the stride spreads the sample across the whole split rather than clustering it.
The result is about 36 KB of JSONL.

Everything below was measured on that sample during the design survey.

### 2.1 Where the answers live

| probe | result |
|---|---|
| source concept present in the `init:xl` band set | 71 of 100 |
| gold option present in the `init:xl` band set | 49 of 100 |
| source-to-gold edge in the `init:xl` band set | **0 of 100** |
| source concept present in the child pack | 91 of 100 |
| gold option present in the child pack | 75 of 100 |
| source-to-gold edge in the child pack | **22 of 100** |

That first zero is the headline. The shipped default seed carries a definitional backbone, a large
WordNet `IsA` layer and a `RelatedTo`-heavy technology slice, and it holds not one relational edge
between a CommonsenseQA source concept and its gold answer. The knowledge is in the child pack, and
chat already reaches the child pack through learn-on-miss. So the lane's probe must go through the
same provider, and the rig's number then describes what a real user gets.

### 2.2 Relation frequency

Two tables. The first is measured against the child pack, counting the tmct predicate on every
source-to-gold edge that exists there. This is the distribution the lane will actually route on.

| predicate on the source-to-gold edge | questions |
|---|---|
| `mgx:atLocation` | 17 |
| `mgx:hasSubevent` | 2 |
| `mgx:atLocation` (reversed) | 1 |
| `mgx:causesDesire` | 1 |
| `mgx:partOf` | 1 |
| `mgx:capableOf` | 1 |

Counting every source-to-option edge, not just the gold one, shows how thoroughly the distractors sit
on the same relation:

| predicate on any source-to-option edge | edges |
|---|---|
| `mgx:atLocation` | 69 |
| `mgx:capableOf` | 7 |
| `mgx:hasSubevent` | 6 |
| `mgx:partOf` | 4 |
| `mgx:causesDesire` | 3 |
| `mgx:antonym` (either direction) | 3 |
| `mgx:hasProperty` | 2 |
| `owl:disjointWith` (either direction) | 2 |
| `mgx:hasA`, `mgx:usedFor`, `mgx:partOf` (rev), `mgx:atLocation` (rev), `rdfs:subClassOf` (rev) | 1 each |

The second table is the stem's own relation cue, assigned by a first-match rule list over the stem
text. This is what a router can see before it touches the graph.

| relation family the stem asks for | questions |
|---|---|
| AtLocation / LocatedNear | 39 |
| (no cue matched) | 24 |
| IsA / Synonym / HasProperty | 11 |
| HasPrerequisite / HasSubevent | 9 |
| Desires / MotivatedByGoal | 7 |
| Causes / CausesDesire | 4 |
| PartOf / HasA / MadeOf | 3 |
| CapableOf | 3 |

Interrogative form, for cross-reference: what 47, where 38, how 5, when 4, why 4, which 1, none 1.

### 2.3 What the three outcomes look like today

Running the naive probe (an edge of any relation between the source concept and an option) over the
sample against the child pack:

| outcome | questions | of which the gold option |
|---|---|---|
| exactly one option grounds | 19 | 1 |
| several options ground | 22 | n/a |
| no option grounds | 59 | n/a |

One correct out of 100 is the floor this plan starts from, and the shape of it is the design brief.
CommonsenseQA's questions were built by pulling several target concepts that share one relation with
a source concept, then asking a crowd worker to write a question discriminating between them. The
distractors are ConceptNet-adjacent to the source by construction. So "an edge exists" is close to no
evidence at all, and a lane that answers on edge presence alone is guessing with extra steps. Two
consequences run through the rest of this plan:

- The refuse-and-list outcome will be common, and it is the product working. Several options
  grounding equally well is exactly the state the open-world design says to report rather than break
  a tie in.
- The rungs that move the number are the ones that add discrimination: routing to the relation the
  stem asks for, chasing a chain the flat probe cannot see, and matching wording that differs from
  the edge's own surface form.

Three scratch projections, measured the same way, sized the rungs. They are forecasts from crude
stand-in helpers, not promises about the built lane.

| projection | answered | correct | several | miss |
|---|---|---|---|---|
| naive any-relation edge | 19 | 1 | 22 | 59 |
| plus depluralize and head-noun backoff | 19 | 3 | 25 | 56 |
| reachable within 2 hops | 18 | 6 | 36 | 46 |

Chain depth moved correctness furthest per unit of work, wording matching moved it a little, and
relation routing on the current seed moved it not at all because the current seed has almost nothing
to route over. That is why rung 1 is seed coverage and rung 2 is routing, in that order.

### 2.4 Licence

CommonsenseQA is released under the MIT licence. Its `question_concept` values and the subgraphs the
questions were generated from come from ConceptNet 5, which is CC BY-SA 4.0. The committed NOTICE
states both, and the repo already carries the ConceptNet attribution twice in `corpus/LICENSES.json`.

---

## 3. The constitution

- **No LLM in the product path.** Unchanged, and it is why this plan exists in the shape it does.
- **No LLM in the scoring path.** The rig compares a selected option label against `answerKey`. No
  judge, no similarity model, no embedding.
- **A refusal is never partial credit.** A question the lane refuses or misses scores zero, exactly
  as `claim-openbookqa.mjs` scores a refusal today.
- **The write boundary holds.** A choice question must never reach the teach lane. The plan gets that
  structurally, by placing the lane before `assertTurn`, not by trusting a surface test.
- **Ties are reported, never broken.** When several options ground equally, the lane lists them and
  asks. It does not pick the highest weight, the first, or the shortest.
- **Every figure is read from the JSON.** The claims block hardcodes no number, including the sample
  size.

---

## 4. Phase F0 — the fixture

**Built.** `scripts/claims/fetch-commonsenseqa-sample.mjs`, the committed 100-row
`test-benchmarks/claims/commonsenseqa-sample.jsonl`, its `.NOTICE`, and
`test/estate/commonsenseqa-fixture.test.mjs` all landed; section 4.7's acceptance commands are green.

**Model tier: Haiku.** Mechanical: a fetch script, a deterministic slice, two text files, one JSON
entry.

### 4.1 New files

| path | what it holds |
|---|---|
| `test-benchmarks/claims/commonsenseqa-sample.jsonl` | the 100 selected rows, one JSON object per line, in selection order |
| `test-benchmarks/claims/commonsenseqa-sample.NOTICE` | attribution and the selection rule |
| `scripts/claims/fetch-commonsenseqa-sample.mjs` | the reproducible fetch-and-sample script |

### 4.2 The row shape

Committed verbatim from upstream, with no reshaping, so the fixture stays diffable against the
source:

```json
{"answerKey":"E","id":"001b0f5a841fd81d13fbe67c7c7179d6","question":{"question_concept":"eating","choices":[{"label":"A","text":"reduced"},{"label":"B","text":"getting full"},{"label":"C","text":"becoming full"},{"label":"D","text":"chewing"},{"label":"E","text":"defecating"}],"stem":"Eating is part of living, but your body doesn't use it all and the next day you will be doing what?"}}
```

Fields the rig reads: `id`, `answerKey`, `question.stem`, `question.choices[].label`,
`question.choices[].text`, `question.question_concept`.

### 4.3 The fetch script

`scripts/claims/fetch-commonsenseqa-sample.mjs`, run by a maintainer, output committed. Not wired
into `npm test` and not run by CI.

```js
export const DEV_SPLIT_URL = "https://s3.amazonaws.com/commensenseqa/dev_rand_split.jsonl";
export const DEV_SPLIT_ROWS = 1221;
export const SAMPLE_SIZE = 100;
export const SAMPLE_STRIDE = 12;

/** Sorts rows by id ascending as strings, then keeps every SAMPLE_STRIDE-th
 *  row from index 0 until SAMPLE_SIZE rows are held. Pure: same input, same
 *  output, no clock and no randomness. */
export function selectSample(rows, { size = SAMPLE_SIZE, stride = SAMPLE_STRIDE } = {});

/** Throws when a row is not the five-choice A-to-E shape the rig assumes:
 *  five choices, labels exactly A B C D E in order, a non-empty stem, a
 *  non-empty question_concept, and an answerKey that names one of the five. */
export function assertFixtureRow(row);
```

`main()` fetches the split, asserts `rows.length === DEV_SPLIT_ROWS` and fails loudly on drift,
runs `selectSample`, runs `assertFixtureRow` over every selected row, and writes the JSONL. CLI
args: `--out <path>` and `--from <local jsonl>` so a maintainer without network can re-cut from a
local copy.

### 4.4 The NOTICE

`test-benchmarks/claims/commonsenseqa-sample.NOTICE`, following the shape
`test-benchmarks/claims/definitions-set.NOTICE` uses: a title line, a provenance paragraph, a licence
paragraph, and a selection-rule block. Content it must carry:

- Source: CommonsenseQA (Talmor, Herzig, Lourie and Berant, NAACL 2019), the `dev_rand_split.jsonl`
  split, 1,221 questions.
- Licence: MIT, the dataset's own stated licence, with the full MIT text following the notice, the
  same way `openbookqa-sample.LICENSE` carries Apache-2.0 after its notice.
- ConceptNet attribution: the questions were generated from ConceptNet 5 subgraphs and each row's
  `question_concept` is a ConceptNet concept. Carry the standard sentence: "This work includes data
  from ConceptNet 5, which was compiled by the Commonsense Computing Initiative. ConceptNet 5 is
  freely available under the Creative Commons Attribution-ShareAlike license (CC BY SA 4.0)." Point
  at `corpus/conceptnet/LICENSE-NOTICE` for the full attribution the repo already carries.
- Selection rule, in words, matching `selectSample` exactly.

### 4.5 `corpus/LICENSES.json`

`test-benchmarks/` is outside the paths `test/estate/corpus-licences.test.mjs` walks, and the two
existing external fixtures under `test-benchmarks/claims/` carry sidecar licence files rather than
rollup entries. Follow that precedent: no `corpus/LICENSES.json` entry, sidecar NOTICE only, cited
in the rig's `sources` array so `test/estate/claims.test.mjs` asserts it exists.

### 4.6 Tests

New file `test/estate/commonsenseqa-fixture.test.mjs`:

- the fixture parses as JSONL and holds exactly 100 rows
- every row passes `assertFixtureRow`
- ids are unique across the fixture
- re-running `selectSample` over a synthetic 1,221-row input twice returns the same ids in the same
  order, and returns the same ids when the input array is shuffled first
- the NOTICE file exists and mentions both "MIT" and "CC BY SA 4.0"

### 4.7 Acceptance

```
node scripts/claims/fetch-commonsenseqa-sample.mjs --out test-benchmarks/claims/commonsenseqa-sample.jsonl
node --test test/estate/commonsenseqa-fixture.test.mjs
node --test "test/estate/*.test.mjs"
npm run check:links
npm run check:pii
```

---

## 5. Phase F1 — the option splitter

**Built.** `src/domain/choice-question.mjs` and `test/domain/choice-question.test.mjs` (23 tests,
every positive and negative row plus the six required extras) landed;
`test/estate/import-layers.test.mjs` stays green and section 5.5's acceptance commands are green.

**Model tier: Sonnet.** A closed-set parser is where the design risk in this phase sits.

New module: **`src/domain/choice-question.mjs`**. Pure. Imports only `./interpret/normalize.mjs` and
`./hash.mjs`, both relative and both domain, so `test/estate/import-layers.test.mjs` stays green. No
graph, no store, no I/O, matching the rule that domain modules import nothing non-relative.

### 5.1 What it recognizes

Two shapes, and the module must handle both because the product surface and the fixture differ.

**Shape A, natural inline phrasing.** A question with the alternatives written into the sentence:

```
is a whale a fish or a mammal?
which is a kitchen in, a house or a car?
does a bird live in a nest or a burrow?
is the capital of france paris, lyon or marseille?
```

**Shape B, enumerated options.** A stem followed by labelled or listed alternatives, which is the
shape the rig feeds it and the shape a user pastes:

```
Where would you find magazines along side many other printed works?
A) doctor B) bookstore C) market D) train station E) mortuary
```

with `A)`, `A.`, `A:`, `(A)` and bare newline-separated lists all accepted.

### 5.2 Exports

```js
/** The recognized shapes. Frozen so a caller can switch on the value
 *  without inventing its own string. */
export const CHOICE_SHAPES = Object.freeze({ inline: "inline", enumerated: "enumerated" });

/** Minimum and maximum alternatives a choice question may carry. Two is the
 *  smallest set that is a choice at all. Six is one above CommonsenseQA's
 *  five, which leaves the fixture room and still keeps the refusal list short
 *  enough to read in one line. A longer list is a set question, which the ask
 *  engine already answers, so the lane declines and falls through. */
export const CHOICE_MIN_OPTIONS = 2;
export const CHOICE_MAX_OPTIONS = 6;

/**
 * Splits a closed multiple-choice question into its stem and its options.
 * Returns null for anything that is not one, which is the fall-through
 * signal every caller relies on.
 *
 * @param {string} text
 * @returns {null | {
 *   shape: "inline" | "enumerated",
 *   stem: string,          // the question with the option list removed, trimmed,
 *                          // trailing punctuation kept
 *   options: Array<{ label: string, text: string, normalized: string }>,
 *                          // label is "A".."F" for enumerated, "1".."6" for
 *                          // inline (positional, so a citation can name one);
 *                          // normalized is lowercased, punctuation stripped,
 *                          // whitespace collapsed
 *   sourceTerm: string,    // the term the options are alternatives ABOUT, read
 *                          // out of the stem; "" when the stem gives none
 * }}
 */
export function splitChoiceQuestion(text);

/** True when `text` reads as a choice question. Sugar over splitChoiceQuestion
 *  for a recognizer that does not need the parts. */
export function isChoiceQuestion(text);

/** The reason splitChoiceQuestion declined, for a trace note. One of:
 *  "not-a-question", "no-alternation", "too-few-options", "too-many-options",
 *  "duplicate-options", "option-empty". Returns "" when it did not decline. */
export function choiceDeclineReason(text);
```

### 5.3 The negative set

The splitter must return null for `or` sentences that are not choice questions. Each of these gets
its own test, and each gets a corpus row in phase F5:

| input | why it is not a choice question |
|---|---|
| `every pet is a cat or a dog` | a teach sentence, a disjunctive class definition |
| `is a whale a fish or not` | polar with a negated tail, not two alternatives |
| `what is a cat or a dog` | a set question the ask engine already answers |
| `tell me about cats or dogs` | an imperative, no interrogative lead |
| `a bird or two flew past` | `or` inside a quantity phrase, no question |
| `sooner or later it rains` | a fixed phrase, `or` is not alternating anything |
| `is it a bird or is it a plane` | two separate polar questions, handled by the multi-sentence pre-split |
| `which is bigger` | a comparison with no listed alternatives |

The last one matters for the write boundary. `every pet is a cat or a dog` is a real teach sentence
the ACE grammar handles, and a splitter that swallowed it would silently kill a shipped capability.
The rule that separates them: shape A needs an interrogative lead. Reuse `leadsInterrogative` and
`QUESTION_LEAD_RE` from `src/domain/interpret/normalize.mjs` rather than writing a new test for it.

### 5.4 Tests

New file `test/domain/choice-question.test.mjs`, following the `test/domain/<module>.test.mjs`
convention. Behaviour-named tests, one per row of the positive and negative tables, plus:

- `"an enumerated five-choice question keeps its upstream labels"`
- `"an inline two-option question numbers its options positionally"`
- `"an option list longer than the cap declines rather than truncating"`
- `"a repeated option declines rather than deduplicating"`
- `"the same input twice returns the same option order"`
- `"a teach sentence with a disjunctive class never parses as a choice question"`

### 5.5 Acceptance

```
npm run test:fast
node --test test/domain/choice-question.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 6. Phase F2 — the chat lane

**Built.** The lane sits in `dispatchTurn` between the slash-command check and `assertTurn`, exactly
as section 6.1 specifies: `probeChoiceOptions` (beside the grounding ladder) does the pair-level
probe, pulling the child pack once per turn for the source term only, and the three outcomes (one
option grounds, several ground, none ground) route through `joinOr`/`factPhrase`/`citationProvenance`
as designed. `"ask-choice": "choiceQuestion"` is in `LANE_DIALOGUE_ACTS`
(`src/domain/dialogue-acts.mjs`), `result.lane` is set on the answering and refusing paths, and
`test/adapters/chat-dialogue-act-labels.test.mjs` gained a case for it. `test/adapters/chat-choice-lane.test.mjs`
carries the nine named behaviours from section 6.5, including the tie invariant with differently-weighted
edges. `chain` stays null (rung 3's work). Section 6.7's acceptance commands are green; found along
the way, and NOT fixed here because it sits entirely outside this lane's own code (`src/domain/grammar/ace.mjs`):
`parseAce` currently leaves residue `["or"]` on a disjunctive class sentence ("every pet is a cat or
a dog"), so that shape does not yet teach — pre-existing on `main`, confirmed unrelated to F0/F1/F2 by
reproducing it before this lane's own edits.

**Model tier: Sonnet.** This is the subtlest phase. `chat.mjs` is 17,791 lines and this track owns it
alone for the duration.

### 6.1 Where it goes, and why there

Insert the lane in `dispatchTurn`, **between the slash-command check at line 17535 and `assertTurn`
at 17541**.

The brief the lane has to satisfy is that it can never reach the teach lane, and this is the only
placement where that is structural rather than surface-dependent. `dispatchTurn` lanes return on a
hit, so a lane that returns before 17541 makes both `assertTurn` and `bareTaxonomyTeach` unreachable
for that turn, and makes `runAsk`'s stage `(4)` teach cascade at 15130 unreachable too, because
`runAsk` never runs.

The alternative was `runAsk`'s pre-parse band, beside the temporal-comparison lanes at 14103. That
placement is the closer stylistic precedent and it still precedes the ask parse, but it sits after
the teach boundary at 17541, so a choice question would pass through `assertTurn` first and the
guarantee would rest on `teachLane`'s own stand-down gates rather than on control flow. Those gates
are good (a trailing `?` returns null, and `leadsInterrogative` on a spell-corrected line returns
null), but they are a surface test, and the brief asked for a boundary.

Follow the temporal lanes' internal pattern regardless of the placement difference, because it is
the house style for a closed-set lane:

1. a bare `{ ... }` block scoping the lane's locals
2. the recognizer, then `if (parsed) { ... }`
3. one `const choiceGoal = "..."` sentence naming what the lane is trying to do
4. a local `refMiss(text)` closure that `note()`s the goal and the lane, then returns
   `plainTurn(query, text, { via: "miss", miss: true, focus, goal: choiceGoal })`
5. every failure mode returns a specific miss naming what is missing, never falls through
6. on success, `note()` the goal and the lane, return `plainTurn(..., { via: "composed", miss: false, focus, goal: choiceGoal })`,
   then attach `turn.detail = { traversal, matches }`

The lane's miss text must not start with the generic grammar wall opening, or stage `(5)` would
rewrite it. `WALL_MISS_RE` (chat.mjs 2735) is the pattern to stay clear of.

### 6.2 The probe

New helper in `chat.mjs`, beside the existing grounding ladder at 3653 to 3738:

```js
/**
 * Per-option grounding for the choice lane. For each option, looks for a
 * stored fact whose {subject, object} pair is {sourceTerm, option} in either
 * direction, under any predicate. Reads the same fact rows the rest of chat
 * reads, through factRowsCache, and pulls the child pack for sourceTerm once
 * when memory holds nothing for it, through the same childPackFactsForKey the
 * learn-on-miss cascade uses. Returns one entry per option, in option order.
 *
 * @returns {Promise<Array<{
 *   label: string,
 *   text: string,
 *   grounds: boolean,
 *   facts: Array<{subject, predicate, object, provenance}>,  // the edges found
 *   chain: null | Array<{subject, predicate, object}>,       // findIsaChain, phase R3
 * }>>}
 */
async function probeChoiceOptions(parsed, { memoryDir, env, cache, graph, synthesisBudget });
```

Grounding is pair-level, not term-level, and the difference is the whole point. `isAnchorableTerm`
answers "is this term known in any sense", which almost every option satisfies (363 of the sample's
500 option terms are child-pack terms). The lane needs "is there a stated relation between the source
concept and this option", which 22 of 100 gold options satisfy. Both checks stay, and they are named
apart in section 12.

The child-pack pull runs once per turn for the source term only, never per option. Pulling for every
option would seed the graph from the question's own distractors, which is a slow way to make every
option ground.

### 6.3 The three outcomes

**Exactly one option grounds.** Answer, citing the fact that decided it.

```
Yes — a bookstore. magazine is at location bookstore (source: corpus:conceptnet).
```

Rendering goes through the existing `factPhrase` (7724) and `citationProvenance` (7777), the same
two the rest of chat cites with. Where `findIsaChain` proves the option instead of a direct edge,
cite the chain through `renderIsaChain` (7970), which is phase R3's work; until then the chain field
stays null and the direct edge carries the citation.

**Several options ground.** Refuse and list, through `joinOr`.

```
More than one of those grounds: bookstore, market, or train station. I have a stated
relation from magazine to each, so nothing in what I hold picks between them.
```

`joinOr` is module-local and stays that way. This is its third call site and all three are refusals
that list candidates, which is the pattern its own comment describes.

**No option grounds.** The honest miss, naming the source term.

```
I don't know how "magazine" relates to any of bookstore, doctor, market, train station,
or mortuary. Nothing I hold connects it to one of them.
```

### 6.4 Dialogue act

`src/domain/dialogue-acts.mjs` already declares `choiceQuestion`. Add `"ask-choice": "choiceQuestion"`
to `LANE_DIALOGUE_ACTS` and set `result.lane = "ask-choice"` on the answering and refusing paths. A
recorded miss is forced to `"honest-miss"` by `askDialogueLane` (line 199), so the miss path needs
nothing. Update `test/adapters/chat-dialogue-act-labels.test.mjs`.

### 6.5 Tests

New file `test/adapters/chat-choice-lane.test.mjs`:

- `"a choice question with one grounded option answers and cites the source fact"`
- `"a choice question with several grounded options refuses and lists every one of them"`
- `"a choice question with no grounded option returns the miss naming the source term"`
- `"a choice question never reaches the teach lane, even without a trailing question mark"`
- `"a disjunctive teach sentence still teaches and is not read as a choice question"`
- `"an enumerated five-choice question answers from the same probe as the inline form"`
- `"the refusal lists the options in the order they were asked"`
- `"the lane's miss is not rewritten by the generic grammar wall"`
- `"two grounded options tie and the lane picks neither, whatever their edge weights"`

The last one is the invariant that keeps the design open-world. Give the two options different
weights in the fixture and assert the refusal anyway.

### 6.6 Rebuild note

The ask bundle inlines `chat.mjs`, so any turn that edits `chat.mjs` needs
`npm run build:ask-bundle` before running anything that reads
`src/surfaces/web/memory-ask-browser.bundle.js` or renders the ledger page. The bundle is gitignored
and rebuilt per CI job, so there is no committed artifact to drift. Adding a corpus row does not
require a rebuild.

### 6.7 Acceptance

```
npm run build:ask-bundle
npm run test:fast
node --test test/adapters/chat-choice-lane.test.mjs
node --test test/adapters/chat-dialogue-act-labels.test.mjs
node --test test/fast/chat-grounding.test.mjs test/fast/chat-corpus-anchor.test.mjs
node --test test/adapters/chat-filler-clause-prefix.test.mjs
node --test test/adapters/chat-child-lane.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 7. Phase F3 — the rig

**Built.** `scripts/claims/claim-commonsenseqa.mjs` seeds exactly the INIT_XL_BANDS band set through
`resolveExtensions`/`seedActiveCorpusEntries` (the same path `scripts/build-chat-seed.mjs` uses),
runs the 100-item fixture through the choice lane with a fresh `sessionId` per item, and writes
`results/claims/commonsenseqa.json`. `"claim:commonsenseqa"` is in `package.json`.

First measurement: 0 of 100 correct (answered 0, refused 0, abstained 100; `sourceEdgePresent` 0),
matching section 2.1's own 0-of-100 source-to-gold edge count against `INIT_XL_BANDS` alone — no
item's child-pack pull ever ran. Root cause, found outside this rig's own code
(`src/domain/choice-question.mjs`, phase F1): `extractStemSourceTerm` only recognized a "where would
you find/see/keep/put/store/place X" stem shape, so it returned `""` for most of the fixture's
natural-language stems (the "what"-led 47 percent chief among them), which sent the lane straight to
its no-`sourceTerm` miss before `probeChoiceOptions` ever ran.

**Resolved.** `extractStemSourceTerm` now tries six closed sentence templates in order — a
broadened placement/possession verb set, a what-do-support subject read, a what-is-subject
direct-object read, a where-copula subject read, a trailing of-clause read, and a want-to verb/object
read — all reading only the stem text. Re-measured: still 0 of 100 correct, but `answered` moved 0 to
1, `refused` 0 to 2, `abstained` 100 to 97, and `sourceEdgePresent` 0 to 2. Selection stayed at zero
because reach and selection are different rungs: the extractor now finds a source term and pulls the
child pack for more of the fixture's natural phrasings, but of the 22 source-to-gold edges the
design survey found reachable in the child pack (section 2.1), only 2 turned up grounded after the
broadened extraction — the rest sit behind stem shapes this closed template set still returns `""`
for (a discovery gated further upstream, in `coreParse`'s own `leadsInterrogative` check: only 50 of
the 100 fixture stems open with a word `QUESTION_LEAD_RE` recognizes at all, so half the fixture is
declined before `extractStemSourceTerm` ever runs — untouched here, since it is a shared gate several
other lanes also read). Section 7.6's acceptance commands are green.

**`leadsInterrogative` widened.** CommonsenseQA stems mostly postpone their wh-word instead of
fronting it ("... you will be doing what?", "The trucker plopped on the bench ..., where did he
arrive?"), which `QUESTION_LEAD_RE`'s first-word-only check couldn't see. `leadsInterrogative`
(`src/domain/interpret/normalize.mjs`) now also recognizes four closed, deterministic shapes, each
gated on the line actually ending in "?": a bare wh-word as the last word before the question mark,
a wh-word fronted behind a single preposition ("In what country ...?"), a wh-word inverted around an
auxiliary mid-sentence with no comma to split on, and a trailing comma/period clause that itself
opens with a `QUESTION_LEAD_RE` word. That takes the fixture from 50 of 100 stems passing the gate to
95 of 100 (5 stay declined — genuinely irregular stems with no wh-word at all, or a wh-word in a
position none of the four shapes cover). Re-measured: `answered`, `refused`, `abstained`, and
`sourceEdgePresent` all came back unchanged (1/2/97/2, still 0 correct) — a wider gate, not a wider
selection. `splitChoiceQuestion` now parses stem-and-options for the newly-reached stems
(`sourceTerm: ""` where before it returned `null` outright), but `extractStemSourceTerm`'s six
templates all read for a FRONTED wh-word, so they still return `""` for a postponed one and the
choice lane still lands on `refMiss` before `probeChoiceOptions` ever runs. Reach and selection stay
two different rungs: `extractStemSourceTerm` gaining postponed-wh templates of its own is the next
one, in `choice-question.mjs`.

**Model tier: Sonnet.** The seeding path and the detail columns need care; the scoring is trivial.

New file: **`scripts/claims/claim-commonsenseqa.mjs`**. Registered in `package.json` as
`"claim:commonsenseqa": "node scripts/claims/claim-commonsenseqa.mjs"`, which is what enrols it with
`run-all.mjs`.

### 7.1 The seed it runs against

`claim-openbookqa.mjs` runs an explicit `tmct import --corpus wordnet-xl` before the first question,
because `wordnet-xl` ships inactive and the claim was about the largest corpus tmct has. This rig
does the opposite: **it seeds exactly `INIT_XL_BANDS` through the same `resolveExtensions` and
`seedActiveCorpusEntries` path `scripts/build-chat-seed.mjs` uses, and imports nothing else.**

That band set is the default two ways over. It is what `npm run init:xl` gives a CLI user, and it is
what `public/chat-seed.json` serves the demo page the claims block links to. Anchoring the number to
it means the claim describes the chat a visitor actually has rather than a configuration assembled
for the measurement.

The child pack is reached the way chat reaches it: lazily, per source term, through the lane's own
probe. Nothing bulk-imports it.

### 7.2 Scoring

Deterministic gold-key comparison, and nothing else:

```js
/**
 * An item counts correct when the lane selected exactly one option AND that
 * option's label equals the item's answerKey. A refusal, a miss, and a
 * selection of the wrong option all score zero. There is no partial credit
 * and no text matching: the lane returns a label, the fixture holds a label,
 * and the two are compared.
 */
function scoresCorrect(selectedLabel, answerKey);
```

The rig reads the selected label off `result.detail.selectedLabel`, which the phase F2 lane sets on
its answering path and leaves undefined on both the refusal and the miss paths. That is a stricter
contract than `claim-openbookqa.mjs`'s content-word matcher, and it is available because a choice
question has a closed answer set.

### 7.3 What it writes

```js
const record = writeClaim("commonsenseqa", {
  hardware: defaultHardware(),
  pack: "shipped",
  unit: "questions",
  value: result.correct,
  threshold: { direction: "min", value: 0 },
  sources: [
    "test-benchmarks/claims/commonsenseqa-sample.jsonl",
    "test-benchmarks/claims/commonsenseqa-sample.NOTICE",
    "scripts/claims/claim-commonsenseqa.mjs",
    "corpus/child/manifest.json",
    "corpus/conceptnet/slice.jsonl",
  ],
  detail: {
    sampleSize: items.length,
    bands: INIT_XL_BANDS,
    seedFacts: result.seedFacts,
    answered: result.answered,
    correctOfAnswered: result.correct,
    refused: result.refused,
    abstained: result.abstained,
    sourceEdgePresent: result.sourceEdgePresent,
    correctWhenSourceEdgePresent: result.correctWhenSourceEdgePresent,
    scorer: "gold-key: the lane's selected option label equals answerKey; a refusal or a miss scores zero; no judge, no text match",
    missedIds: result.missedIds,
    exampleStems: result.exampleStems,
  },
});
```

Column definitions, and each has to be unambiguous because every later rung is measured as a delta on
them:

- **`answered`** — questions where the lane selected exactly one option. Refusals and misses excluded.
- **`correctOfAnswered`** — of those, how many matched `answerKey`. Equals the top-level `value`.
- **`refused`** — questions where several options grounded and the lane listed them.
- **`abstained`** — questions where no option grounded. `answered + refused + abstained === sampleSize`
  is an assertion in the rig, not a hope.
- **`sourceEdgePresent`** — **the count of questions for which the store, after the lane's own
  child-pack pull for the source term, holds at least one Fact row whose `rdf:subject` and
  `rdf:object` attributes are the question's `question_concept` and its gold option text in either
  order, under any predicate, both sides compared after `normFactTerm`.** Pair-level and gold-only.
  It answers one question: was the answer even in the graph. Measured today at 22 of 100 against the
  child pack and 0 of 100 against `INIT_XL_BANDS` alone.
- **`correctWhenSourceEdgePresent`** — correct answers among the `sourceEdgePresent` questions. This
  is the number that separates a coverage problem from a selection problem, and it is what the claims
  block's split sentence reports.
- **`exampleStems`** — three stems the run actually missed, read from the run rather than authored.
  Take the first three by fixture order so the field is stable across runs on an unchanged seed.

### 7.4 Structure

Follow `claim-openbookqa.mjs`'s outer shape: `mkdtemp` a temp repo, `initRepo(dir, { persona: PERSONA_PRESETS.human, env })`,
activate `INIT_XL_BANDS` and seed, `parseEntities(buildEntities([], [], {}))` for the empty code
graph, `openConfiguredMemoryBackend(dir)`, run the sample through `runTurn`, `store.close()` in a
`finally`, `rm` the temp dir in an outer `finally`, `main().catch()` setting `process.exitCode = 1`.

Per item, the question handed to `runTurn` is the stem followed by the enumerated options, which is
shape B of the splitter:

```js
const question = `${item.question.stem}\n${item.question.choices.map((c) => `${c.label}) ${c.text}`).join(" ")}`;
const result = await runTurn(question, { memoryDir, sessionId: `commonsenseqa-${item.id}`, graph });
```

A fresh `sessionId` per item, matching the OpenBookQA rig, so no discourse state leaks between
questions.

### 7.5 Threshold

`{ direction: "min", value: 0 }` on the first run, matching how `claim-openbookqa.mjs` reasons about a
floor. Once a rung lands and the value is above zero, the threshold rises to the landed value, so a
later rung cannot silently give back what an earlier one bought. Section 11 states the rule.

### 7.6 Acceptance

```
npm run claim:commonsenseqa
node --test test/estate/claims.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 8. Phase F4 — the claims block

**Built.** `scripts/site-pages.mjs` and `scripts/build-demo-site.mjs` landed; the four edits complete
and the acceptance commands are green.

**Model tier: Haiku.** Wiring against two verbatim precedents in the same function.

### 8.1 The four edits

`renderClaimsHtml` in `scripts/build-demo-site.mjs` needs four changes, not one, because the block
manifest is only the first of them:

1. `scripts/site-pages.mjs`: `CLAIMS_PAGE_BLOCKS` gains `"commonsenseqa"` in `"openbookqa"`'s place.
2. `renderClaimsHtml`: a new `claimFigureBlock` const built from `blocks.commonsenseqa`.
3. the `<ol class="about-crumbs">` nav: an `#l2-commonsenseqa` crumb replacing `#l2-openbookqa`.
4. the `<div class="claim-block-grid">` interpolation: the new const replacing the old one.

Keep the `L2` kicker. It is the external-input slot on the page and this block inherits the role.

### 8.2 The block

```js
const l2 = claimFigureBlock({
  id: "l2-commonsenseqa", kicker: "L2",
  sentence: "Asked a five-way commonsense multiple-choice question, tmct picks an option only when one grounds against the graph, and picks the right one this often.",
  figureHtml: /* value / sampleSize, plus an answered / refused / abstained strip */,
  notMean: /* see below */,
  standard: "external input: the CommonsenseQA dev split, authored outside this repository from ConceptNet, the same source the shipped corpus slice is cut from, selected by a committed deterministic rule and attributed in test-benchmarks/claims/commonsenseqa-sample.NOTICE.",
  jsonName: "commonsenseqa", demoHref: "chat.html",
});
```

**The figure is a selective-prediction figure, not a bare accuracy figure.** The headline number is
`value` of `detail.sampleSize`, and directly under it the block prints the three-way split from
`detail.answered`, `detail.refused` and `detail.abstained` as the product working rather than as
padding. Every one of those reads off the JSON with its own `data-source` attribute, following the
planner block's convention:

```
data-source="results/claims/commonsenseqa.json#value"
data-source="results/claims/commonsenseqa.json#detail.answered"
data-source="results/claims/commonsenseqa.json#detail.refused"
data-source="results/claims/commonsenseqa.json#detail.abstained"
data-source="results/claims/commonsenseqa.json#detail.sourceEdgePresent"
```

The `sourceEdgePresent` split gets one sentence, and it has to say what it separates:

> Of the 100 questions, `detail.sourceEdgePresent` had the answer stated in the graph at all;
> `detail.correctWhenSourceEdgePresent` of those got picked. The gap between those two numbers is
> knowledge present but not selected. The rest is knowledge absent from the seed.

The "What this does not mean" paragraph, built from the JSON:

> This is not a reasoning score. CommonsenseQA's distractors were pulled from ConceptNet on the same
> relation as the answer, so an option having an edge to the source concept is close to no evidence
> at all. A refusal here means several options grounded equally well and tmct reported the tie rather
> than breaking it. An abstention means nothing in the graph connected the question to any option.
> Neither is a wrong answer, and neither is dressed up as one. Three of the stems it missed:
> `detail.exampleStems` quoted through `q()`.

### 8.3 Tests

`test/estate/claims.test.mjs` needs no new assertion. It reads `CLAIMS_PAGE_BLOCKS` and checks every
name resolves to a valid, sourced JSON, so adding the name is what enrols the check. Confirm it fails
before `results/claims/commonsenseqa.json` is committed, which is the cheapest proof the gate works.

### 8.4 Acceptance

```
npm run demo:build
node --test test/estate/claims.test.mjs
node --test "test/estate/*.test.mjs"
npm run check:links
npm run test:fast
```

All commands passed; 3 claims.test cases + 104 estate cases + 222 fast tests green.

---

## 9. Phase F5 — the removal, and the corpus rows

**Model tier: Haiku.** Mechanical, but grep-first.

### 9.1 What goes

A repo-wide grep found seven files naming OpenBookQA. Five are live and go:

| path | what to do |
|---|---|
| `scripts/claims/claim-openbookqa.mjs` | delete |
| `results/claims/openbookqa.json` | delete |
| `test-benchmarks/claims/openbookqa-sample.jsonl` | delete |
| `test-benchmarks/claims/openbookqa-sample.LICENSE` | delete |
| `package.json` | drop the `claim:openbookqa` script entry |
| `scripts/site-pages.mjs` | drop `"openbookqa"` from `CLAIMS_PAGE_BLOCKS` (phase F4 does this) |
| `scripts/build-demo-site.mjs` | drop `blocks.openbookqa`, the L2 block, the crumb (phase F4 does this) |

Two stay as written:

- `archive/PLAN_CLAIMS.md` records what the OpenBookQA arm was for and what it measured. It is a
  historical design doc and it is accurate about the past.
- Any `reports/BENCHMARK_*.md` that quotes the OpenBookQA figure records what a shipped version
  measured. That is measurement, and measurement does not get rewritten.

### 9.2 The grep discipline

Before deleting anything, run the sweep and read every hit, because the filename is not the only form
the thing goes by:

```
grep -rn --exclude-dir=node_modules --exclude-dir=.git -i 'openbookqa\|open book qa\|open-book' . | tee /tmp/obqa-sweep.log
grep -rn --exclude-dir=node_modules --exclude-dir=.git 'claim:openbookqa\|l2-openbookqa' . | tee /tmp/obqa-hooks.log
```

`claim-openbookqa.mjs`'s own header cites `scripts/claims/claim-definitions.mjs`, which does not
exist. That stale reference dies with the file and needs no separate fix.

### 9.3 Corpus rows

New key group `grammar.choice.*` in `test/corpus/grammar.jsonl`. Rows validate against `validateRow`
in `test/corpus/run-lane.mjs` and are guarded by `test/estate/corpus-schema.test.mjs`. The three
outcomes plus the negative lookalikes, so `npm run corpus:matrix:gaps` sees a negative key on the
group:

| key | id | turns |
|---|---|---|
| `grammar.choice.one-grounds` | `grammar-choice-single-grounded-option-answers-with-a-citation` | teach two facts, then "is a robin a bird or a fish" |
| `grammar.choice.several-ground` | `grammar-choice-several-grounded-options-refuse-and-list-every-one` | teach three facts, then a three-option question over them |
| `grammar.choice.honest-miss` | `grammar-choice-no-grounded-option-misses-naming-the-source-term` | ask a choice question over an unseeded source term |
| `grammar.choice.enumerated-shape` | `grammar-choice-labelled-option-list-parses-like-the-inline-form` | the same question in `A) ... B) ...` form |
| `grammar.choice.teach-not-a-choice` | `grammar-choice-disjunctive-teach-sentence-still-teaches` | "every pet is a cat or a dog", then "what is a pet" |
| `grammar.choice.set-question-not-a-choice` | `grammar-choice-set-question-with-or-still-reaches-the-ask-engine` | "what is a cat or a dog" |
| `grammar.choice.miss-tie-never-broken` | `grammar-choice-two-tied-options-refuse-regardless-of-fact-weight` | two options with different weights, refusal expected |

Each row uses `setup.teach` or `setup.facts` rather than a fixture repo, so the row's own premises
are visible in the row.

### 9.4 Acceptance

```
npm run test:fast
node --test test/corpus/grammar.test.mjs
node scripts/corpus-matrix.mjs
npm run corpus:matrix:gaps
node --test test/estate/claims.test.mjs
node --test "test/estate/*.test.mjs"
npm run check:links
```

---

## 10. The five rungs

Every rung re-runs the same committed fixture and moves the same JSON. Section 11 states what
counts as landing.

### 10.1 Rung 1 — seed coverage

**Model tier: Sonnet.** A corpus re-cut with a determinism guard behind it.

**The problem.** The `init:xl` band set holds zero source-to-gold edges on the sample. Its ConceptNet
band comes from `corpus/conceptnet/slice.jsonl`, whose seed terms are a software vocabulary and whose
edges are 65% `/r/RelatedTo`. The knowledge CommonsenseQA asks about is in `corpus/child/`, which the
lane reaches lazily. Rung 1 moves a useful part of it into the seed itself, from the same source and
under the same licence.

**Where seed selection lives.** Selection and build are separate, and the seam is not where you might
expect:

- The **corpus cut** decides which ConceptNet edges exist at all. That is `corpus/conceptnet/filter-dump.mjs`,
  which streams the pinned 5.7.0 dump against `SEED_TERMS` (about 90, from `fetch-slice.mjs`) plus
  `EXTRA_SEEDS` (about 230, its own), admits `CANONICAL_RELS`, applies `quality-filter.mjs`'s
  `cutReason`, and trims to `MAX_BYTES = 4_500_000` in two tiers. Maintainer-run, output committed.
- The **seed assembly** decides which bands and how many facts reach the artifact. That is
  `scripts/build-chat-seed.mjs` with `SEED_BAND_CAPS` and `SEED_BYTE_CEILING`, spending the cap
  through `CONCEPTNET_PREFER`.

**What changes.**

1. `corpus/conceptnet/filter-dump.mjs` gains a third seed source: the distinct `question_concept`
   values of the **CommonsenseQA train split**, exported as a sorted frozen array from a new
   `corpus/conceptnet/commonsenseqa-seed.mjs`. Train, not dev, so the seed terms are not read off the
   fixture the rig scores. The dev split's 785 concepts stay untouched by the seeding decision and
   the fixture stays an out-of-sample measurement of the cut.
2. `CONCEPTNET_PREFER` in `src/services/extensions.mjs` gains the relational predicates the fixture
   keys on, after the definitional backbone and before the rest: `mgx:atLocation`, `mgx:causes`,
   `mgx:desires`, `mgx:motivatedByGoal`, `mgx:hasSubevent`. The 28,000-fact cap then buys relations
   rather than more `RelatedTo`.
3. `MAX_BYTES` may rise if the wider seed term set needs it. Raising it is a measurement, not a
   preference: re-run `scripts/build-chat-seed.mjs` and check the artifact against `SEED_BYTE_CEILING`
   and `test-e2e/pages-chat-boot-budget.test.mjs` before committing a higher number.

**The determinism guard.** `corpus/conceptnet/slice.jsonl` has no manifest, no hash pin and no
row-count guard, unlike `corpus/child/`, `corpus/wordnet/`, `corpus/tier2/`, `corpus/reference/` and
`corpus/prose/`. Add `corpus/conceptnet/manifest.json` on the `corpus/child/manifest.json` model, and
extend `test/estate/corpus-manifests.test.mjs` to cover it:

```json
{
  "built": "<ISO date>",
  "dump": { "url": "...", "mirror": "...", "version": "5.7.0", "sha256": "accd65fe..." },
  "seed": { "files": ["corpus/conceptnet/fetch-slice.mjs", "corpus/conceptnet/filter-dump.mjs", "corpus/conceptnet/commonsenseqa-seed.mjs"] },
  "files": [{ "file": "slice.jsonl", "bytes": 0, "sha256": "..." }],
  "counts": { "edges": 0, "relations": {} }
}
```

The estate assertion: the committed `slice.jsonl` matches the manifest's byte count and sha256, and
a re-cut from the same dump and the same seed files produces the same bytes. That is the same check
`test/estate/child-pack.test.mjs` already runs, and it is what stops a silent re-cut.

**The pins that watch this.** `NEXT.md`'s discipline section carries the warning, and it is exactly
this change it warns about:

> Re-probe seed-content-dependent e2e pins against the real store after any seed-generation change:
> a raised seed cap can silently ground a demo's lookup term or break a source-adjacency pin.

Two named risks, both real for this change:

- **A demo lookup term stops missing.** `public/chat-demos.mjs` explains the choice: `trelvox` leads
  because it is a coined word that appears in no corpus tmct ships, so it stays a clean miss however
  far the corpus grows. `quokka` is a real word that stays a miss for a different reason, and a
  CommonsenseQA-seeded ConceptNet cut is exactly the kind of change that could ground it. The pins:
  `test-e2e/browser-chat.test.mjs:115`, `test-e2e/ledger-viz-query-only-dock.test.mjs:171`,
  `test-e2e/pages-chat-fullscreen.test.mjs:132`, `test-e2e/build-chat-assets.test.mjs:53`,
  `test-e2e/web-chat-memory.test.mjs:42`, `test-e2e/chat-browser-bundle.test.mjs:115`.
- **A source-adjacency pin flips.** `test-e2e/chat-browser-bundle.test.mjs:98` asserts
  `dog is a kind of animal (source: corpus:human)`, naming the winning band. A bigger ConceptNet band
  can win that citation instead.

The re-probe the implementer runs, in this order, before committing the re-cut:

```
node scripts/build-chat-seed.mjs
npm run build:ask-bundle
node --test test-e2e/build-chat-assets.test.mjs
node --test test-e2e/web-chat-memory.test.mjs
node --test test-e2e/chat-browser-bundle.test.mjs
node --test test-e2e/pages-chat-boot-budget.test.mjs
node --test test/estate/corpus-manifests.test.mjs
```

If `quokka` grounds, the fix is to pick a different demo miss term the way `public/chat-demos.mjs`
already reasons about it, and to record the new one's reason in that file's comment. Do not shrink
the seed to protect a demo.

**Expected effect.** `detail.sourceEdgePresent` rises. The child pack's 22 of 100 is the near-term
reference point for what a CommonsenseQA-seeded cut off the same dump can reach, and the block shows
the number rather than describing it.

### 10.2 Rung 2 — relation routing

**Model tier: Sonnet.** Serialized on `chat.mjs`.

**What it does.** The phase F2 probe accepts an edge under any predicate. Rung 2 routes: read the
relation the stem asks for, and accept only options connected by a predicate in that family.

New table in `src/domain/choice-question.mjs`, so the routing rules stay pure and testable without
the graph:

```js
/** Stem cue to predicate family, first match wins. Each entry is a closed
 *  set of predicates and a closed set of cue patterns. A stem matching no
 *  entry routes to null, which the lane treats as "no relation named", and
 *  the probe falls back to any-predicate matching for that question. */
export const CHOICE_RELATION_ROUTES = Object.freeze([...]);

/** @returns {null | { family: string, predicates: string[] }} */
export function routeChoiceRelation(stem);
```

**Which families, and in what order.** One family per round, ordered by measured yield on the fixed
fixture. The sample's stem-cue distribution:

| family | predicates | questions cued |
|---|---|---|
| AtLocation | `mgx:atLocation`, `mgx:locatedNear` | 39 |
| IsA / Synonym / HasProperty | `rdfs:subClassOf`, `mgx:synonym`, `mgx:hasProperty` | 11 |
| HasPrerequisite / HasSubevent | `mgx:hasPrerequisite`, `mgx:hasSubevent`, `mgx:hasFirstSubevent`, `mgx:hasLastSubevent` | 9 |
| Desires / MotivatedByGoal | `mgx:desires`, `mgx:motivatedByGoal`, `mgx:causesDesire` | 7 |
| Causes | `mgx:causes`, `mgx:causesDesire` | 4 |
| PartOf / HasA / MadeOf | `mgx:partOf`, `mgx:hasA`, `mgx:madeOf` | 3 |
| CapableOf | `mgx:capableOf`, `mgxneg:capableOf` | 3 |
| UsedFor | `mgx:usedFor` | 0 cued, 1 edge present |
| (no cue) | falls back to any predicate | 24 |

AtLocation first: it is 39 of the sample's cues and 69 of its available edges, so it is where routing
either pays or does not.

**The claim JSON gains** `detail.routedByRelation` (questions where `routeChoiceRelation` returned a
family) and `detail.correctWhenRouted`. A family lands when its round moves `value` or moves `refused`
down into `answered` without moving `correctOfAnswered` down.

**One warning from the survey.** A scratch projection of relation routing over the current seed
answered fewer questions than the naive probe and got the same one correct. Routing narrows the
accepted edge set, and narrowing a set that is already almost empty leaves less. That result is a
statement about the seed rung 1 replaces, not about routing, and it is why rung 1 comes first.

**Tests.** `test/domain/choice-question.test.mjs` gains one test per route, asserting the family a
representative stem routes to, plus a test that an unrouted stem returns null.
`test/adapters/chat-choice-lane.test.mjs` gains: an option connected by the wrong relation does not
ground; an option connected by the right relation does; an unrouted stem still probes every predicate.

### 10.3 Rung 3 — inference depth

**Model tier: Sonnet.** Serialized on `chat.mjs`.

**What already exists.** `syllogise()` materializes five OWL 2 RL rules under budget, focus, screen
and trust guards, writing every conclusion under an `entailed:*` provenance at prior 0.3.
`findIsaChain(subj, targets, typeEdges, subClassEdges, { maxHops })` is a bounded rooted proof search
that returns the shortest chain as an ordered premise list or null, and `renderIsaChain(premises)`
turns that list into a cited sentence. Chat already calls it at seven sites, at `maxHops` between 2
and 3.

**What rung 3 adds.** An option that does not have a direct edge to the source concept but is
reachable through one gets accepted, and the lane cites the chain rather than a single fact.

In `probeChoiceOptions`, when no direct edge is found for an option, call `findIsaChain` from the
source term toward the option's variants over the same fact rows, at `maxHops: 2`, and fill the
`chain` field. The answering path then renders through `renderIsaChain` when `chain` is non-null and
through the direct-edge citation otherwise. `maxHops: 2` matches the existing live-chase call sites
and keeps the cost bounded by the source term's own reachable set.

**The claim JSON gains accuracy-by-hop:**

```json
"detail": {
  "byHop": {
    "1": { "answered": 0, "correct": 0 },
    "2": { "answered": 0, "correct": 0 },
    "unreachable": { "abstained": 0 }
  }
}
```

Measured today on the child pack: the gold option sits 1 hop from the source concept in 19 of 100
questions, 2 hops in 13, and beyond 2 hops or unreachable in 68. A 2-hop probe answered 18 with 6
correct against the direct probe's 19 with 1, so depth is where the discrimination is.

**Cross-reference, not a dependency.** `PLAN_SYLLOGIST_EL_DL.md` designs an EL saturation classifier
and then a DL tableau prover. When its phase 1 lands, this same committed fixture is the natural
before-and-after for the classifier's effect on grounded selection, measured as a delta on
`detail.byHop`. Nothing in rung 3 waits for it, and nothing in that plan waits for this one.

**Tests.** `test/adapters/chat-choice-lane.test.mjs` gains: a 2-hop option grounds and the answer
cites every step of the chain; a 3-hop option does not ground at `maxHops: 2`; a chain whose steps
are not all backed by stored facts is not cited (the `renderIsaCite` null path); the same two options
in two different insertion orders produce the same answer.

That last one is the read-time determinism check `CLAUDE.md` requires of any resolver over the fact
store, and `sortFactIndividualsById` is the precedent it names.

### 10.4 Rung 4 — the wording gap

**Model tier: Sonnet.** Owns `src/domain/choice-question.mjs` and one function in `chat.mjs`.

**The problem.** An option's surface form and the edge's surface form differ. `fast food restaurant`
against an edge to `restaurant`, `dogs` against `dog`, `getting full` against `get full`. The fixture
is fixed, so each lever lands as a clean delta on the same 100 questions.

**The levers**, one per measured round, cross-referencing `PLAN_NLU_BENCHMARKS.md`'s ladder:

- **L3, lemma normalization.** wink-nlp lemma and token normalization applied to both sides of the
  option-to-edge comparison, replacing the current exact-after-`normFactTerm` match. Regular
  inflection first, through `src/domain/inflect.mjs`, which already owns the `-s`/`-ed`/`-ing` rules.
- **Head-noun backoff.** A multi-word option that does not match falls back to its head noun.
  `fast food restaurant` becomes `restaurant`. Bounded and closed: the head only, never every
  sub-phrase, and only when the full phrase found nothing. Measured today, depluralize plus head-noun
  backoff moved `sourceEdgePresent` from 19 to 22 and correct from 2 to 3 on the id-sorted sample.
- **L4, WordNet expansion.** Deterministic synonym and hypernym expansion of the option term from
  `corpus/wordnet/wordnet-full.jsonl` at a fixed depth, matching an edge whose object is a synset
  sibling. This is the widest lever and the one most likely to move `refused` up as well as
  `answered`, because expanding both a right and a wrong option lands them both in the accepted set.
  Measure `refused` alongside `value` on this round.

**The claim JSON gains** `detail.matchedBy`, counting how each accepted option matched: `"exact"`,
`"lemma"`, `"head-noun"`, `"wordnet"`. That column is what makes a lever's delta attributable.

**Discipline.** One lever per measured run, the same contract the chatbench cycle uses. A round that
bundles two levers cannot say which one paid.

**Tests.** `test/domain/choice-question.test.mjs` gains one test per lever over the pure matcher.
`test/adapters/chat-choice-lane.test.mjs` gains: a plural option matches a singular edge; a
multi-word option matches its head noun only after the full phrase misses; a WordNet-expanded match
is labelled as such in the turn detail.

### 10.5 Rung 5 — the abstained band

**Model tier: Haiku.** Measurement and one paragraph of copy. No engine work.

24 of the sample's 100 stems match no relation cue at all. They ask about a judgment rather than a
stated relation, and the abstained column is where they land.

```
Seeing idea become reality was a dream of hers for a long time, but as the time came
to get on stage she had more what?

Despite the large crowds, how did the depressed man feel?

Danny is having fun just dancing and singing with his friends. He wasn't concerned
with things that weren't fun. For him having fun is the same as what?
```

**The abstained column is the statement.** It inherits the role `results/claims/openbookqa.json`'s
zero played on the claims page: the number on the page that does not flatter the product. It is
measured, it moves when something changes, and it needs no prose to make it honest.

What would have to exist for that band to move is an open problem, not a settled one. Two named
research horizons, with candidate literatures, and neither is designed here:

- **Affective and evaluative inference.** Answering "how did the depressed man feel" from a graph
  needs a representation of affect and its causes. The candidate literatures are appraisal-theory
  knowledge bases and the ATOMIC-style if-then commonsense inference graphs, which model exactly the
  mental-state consequences ConceptNet's relation set does not carry.
- **Situation and script inference.** Several of the 24 describe a small scene and ask what follows.
  The candidate literatures are script and narrative-schema induction, and the frame-semantic
  resources that give a scene its roles.

Until a tier is designed for either, these land on the honest miss wall, which is the correct
behaviour and is what the abstained column reports.

**What rung 5 delivers.** A `detail.abstainedUncued` count (abstained questions whose stem matched no
relation route), the three real stems quoted above read from the run rather than authored, and the
claims block copy that names the band. Nothing else.

---

## 11. The measurement contract

**One fixture, unchanged.** Every rung re-runs `test-benchmarks/claims/commonsenseqa-sample.jsonl`
unchanged. Changing the fixture makes every earlier number incomparable, so a fixture change is its
own decision with its own commit, and it re-runs the rig at the new fixture before anything else
lands on top.

**One rig, one JSON.** Every rung writes `results/claims/commonsenseqa.json` through `writeClaim`.
No rung adds a second claim name. New evidence goes in `detail`, which the schema leaves
unconstrained, and the top-level `value` stays `correctOfAnswered`.

**Thresholds ratchet.** `writeClaim` resolves the threshold as `payload.threshold ?? existing?.threshold ?? seedThreshold(...)`,
so an explicit threshold wins every run and the committed one otherwise carries forward. The rule for
this rig: the rig passes `{ direction: "min", value: 0 }` on the first run, and **a rung that lands
raises the committed threshold to the value it landed**. From then on `npm run claims` fails if a
later change gives that back. A rung that trades correctness for coverage has to say so by lowering
the threshold in the same commit, which makes the trade visible in the diff.

**What counts as a rung landing.** All four:

1. `npm run claim:commonsenseqa` completes and the fresh `value` is at or above the committed
   threshold.
2. `value` rose, or `refused` fell into `answered` with `correctOfAnswered` not falling.
3. `detail`'s new columns for that rung are present and populated from the run.
4. The rung's own tests and the estate tier pass.

A rung that moves nothing is a measured result and gets recorded as one. It does not get retried with
a different fixture.

**Determinism.** The rig is a pure function of the fixture, the committed corpus and the code. Two
runs at the same commit on the same machine give the same `value`, the same `missedIds` and the same
`exampleStems`. `generatedAt`, `commit` and `hardware` are the only fields that move. A rung that
introduces order-dependence is a bug in the rung: feed the same facts to the probe in two different
orders and demand the same answer, the check `sortFactIndividualsById` already protects the fact store
with.

**No LLM, restated because it is a contract and not a preference.** Nothing in `scripts/claims/claim-commonsenseqa.mjs`,
`src/domain/choice-question.mjs` or the lane calls a model. The scorer is a string equality on a
label. Compare with `npm run chatbench:judge`, which the CEFR axis depends on and which makes every
CEFR number carry a judge as a condition. A CommonsenseQA number carries none.

---

## 12. Config knobs

Three, and each earns its place.

| knob | where | why it exists |
|---|---|---|
| `CHOICE_MIN_OPTIONS` / `CHOICE_MAX_OPTIONS` | module constants in `src/domain/choice-question.mjs` | The bounds decide what the splitter declines. Two is the smallest set that is a choice. Six is one above CommonsenseQA's five, which leaves the fixture headroom and keeps a refusal list readable in one line. Constants rather than config: a user changing this changes which sentences reach the lane at all, which is a design decision and not a preference. |
| `CONCEPTNET_PREFER` | existing, `src/services/extensions.mjs` | Already exists and already decides what the 28,000-fact band cap buys. Rung 1 extends the list rather than adding a parallel mechanism. |
| `MAX_BYTES` | existing, `corpus/conceptnet/filter-dump.mjs` | Already exists. Rung 1 may raise it, and raising it is gated on re-measuring the seed against `SEED_BYTE_CEILING` and the page boot budget. |

**No new `tmct.toml` section.** The lane has no user-facing tuning surface: the option bounds are
structural, the relation routes are a closed table, and the probe budget rides on the existing
`synthesisBudget` that the learn-on-miss cascade already spends. Adding a `[choice]` section would be
config for its own sake.

---

## 13. Ownership, concurrency and model tiers

File ownership decides what runs at once. One owner per file per round.

| track | owns | depends on | model |
|---|---|---|---|
| F0 fixture | `test-benchmarks/claims/commonsenseqa-sample.jsonl`, `.NOTICE`, `scripts/claims/fetch-commonsenseqa-sample.mjs`, `test/estate/commonsenseqa-fixture.test.mjs` | — | Haiku |
| F1 splitter | `src/domain/choice-question.mjs`, `test/domain/choice-question.test.mjs` | — | Sonnet |
| F2 lane | `src/services/chat.mjs`, `src/domain/dialogue-acts.mjs`, `test/adapters/chat-choice-lane.test.mjs`, `test/adapters/chat-dialogue-act-labels.test.mjs` | F1's exports | Sonnet |
| F3 rig | `scripts/claims/claim-commonsenseqa.mjs`, `results/claims/commonsenseqa.json`, `package.json` | F0, F2 | Sonnet |
| F4 claims block | `scripts/site-pages.mjs`, `scripts/build-demo-site.mjs` | F3's JSON | Haiku |
| F5 removal and corpus | `test/corpus/grammar.jsonl`, the deleted OpenBookQA files, `package.json`'s script entry | F2, F4 | Haiku |
| R1 seed coverage | `corpus/conceptnet/filter-dump.mjs`, `corpus/conceptnet/commonsenseqa-seed.mjs`, `corpus/conceptnet/slice.jsonl`, `corpus/conceptnet/manifest.json`, `src/services/extensions.mjs`, `test/estate/corpus-manifests.test.mjs` | F3 (so the delta is measurable) | Sonnet |
| R2 relation routing | `src/domain/choice-question.mjs`, `src/services/chat.mjs`, both test files | R1 | Sonnet |
| R3 inference depth | `src/services/chat.mjs`, `test/adapters/chat-choice-lane.test.mjs` | R2 | Sonnet |
| R4 wording levers | `src/domain/choice-question.mjs`, `src/services/chat.mjs`, both test files | R3 | Sonnet |
| R5 abstained band | `scripts/claims/claim-commonsenseqa.mjs`, `scripts/build-demo-site.mjs` | R4 | Haiku |

**What runs concurrently.** F0 and F1 start together: F0 touches no code F1 needs, and F1 is a pure
module with no dependency on the fixture. R1 can start alongside F1 and F2, because the corpus re-cut
touches no file either of them owns, though its delta is only measurable once F3 exists.

**What serializes.** Everything touching `src/services/chat.mjs` runs one at a time: F2, then R2,
then R3, then R4. Everything touching `src/domain/choice-question.mjs` runs one at a time: F1, then
R2, then R4. F3 waits for F2 because it measures the lane. F4 waits for F3 because
`test/estate/claims.test.mjs` fails on a declared block with no JSON. F5 runs last so the page never
sits without a block.

**Cross-plan serialization.** `src/services/chat.mjs` has one queue across all three plans, not three.
`PLAN_NEWS_FEED.md`'s phase 4 chat wiring, `PLAN_SYLLOGIST_EL_DL.md`'s 0b, 2, 3b and 5 chain, and
this plan's F2, R2, R3 and R4 interleave in whatever order the coordinator dispatches them. No two
`chat.mjs` rounds from any of the three ever run concurrently. `NEXT.md`'s merge note applies to every
one of them: rebuild the ask bundle, rerun the pack-manifest check, and check for same-name top-level
declarations across branches, because esbuild's duplicate-symbol error at bundle time is the tell.

**Shared vocabulary with the news plan.** `PLAN_NEWS_FEED.md` splits grounding two ways: a term is
**vocab-grounded** when the lexicon resolves it, and **fact-grounded** when the graph holds at least
one fact row for it. Both are term-level. This plan's `sourceEdgePresent` is **pair-level**: a stated
relation between two named terms. The three are different questions and they keep different names:

| name | level | question |
|---|---|---|
| vocab-grounded (news) | term | does the lexicon resolve this word |
| fact-grounded (news) | term | does the graph hold any fact naming this term |
| `sourceEdgePresent` (this plan) | pair | does the graph hold a fact relating these two terms |

The lane uses all three. `isAnchorableTerm` is the existing term-level check and stays the name for
it. Neither plan invents a synonym for the other's concept, and a term-level count in this plan's
`detail` uses the news plan's words.

**Model tiers.** Sonnet is enough for every code track, because this document fixes the data
structures, the routing table and the signatures, which is where the design risk lives. Haiku covers
the five mechanical tracks: the fixture and its fetch script, the claims block wired against two
verbatim precedents in the same function, the deletion sweep and corpus rows, and rung 5's counting
and copy.

Two tracks are worth watching, and if either stalls the answer is a tighter test file rather than a
larger model. F1's negative set is the subtlest work in the plan: `every pet is a cat or a dog` is a
shipped teach capability and the splitter must never take it. Write `test/domain/choice-question.test.mjs`
first, one test per negative row, and let it pin the design before the module exists. F2's placement
is the second: write the "never reaches the teach lane" test before the lane, so the boundary is
asserted rather than assumed.

**Sub-agent discipline.** Every dispatch brief caps testing at `npm run test:fast` plus that track's
own blast radius. The full suite and the e2e tiers are the coordinator's job after the merge. A fresh
worktree has no `corpus/worlds/`, no `corpus/sprites/` and no ask bundle, so every brief says to run
`node scripts/ensure-worlds-pack.mjs`, `node scripts/ensure-sprite-facts.mjs` and
`npm run build:ask-bundle` before any `node --test`.

---

## 14. Costs and risks

- **`chat.mjs` is the bottleneck.** Four of this plan's tracks want it, and two other plans want it
  too. Sequence F2 early so R2, R3 and R4 have somewhere to queue behind, and keep each round small
  enough to merge in one sitting.
- **The distractors are adjacent by construction.** CommonsenseQA's wrong answers were pulled from
  ConceptNet on the same relation as the right one, so edge presence alone is close to no signal. The
  plan answers this with routing, depth and wording rather than with a scoring rule, and the refuse
  count is expected to be large. A design that made the refusals go away by picking a winner would
  score better and be worse.
- **Rung 1 can break a demo.** A ConceptNet cut seeded on commonsense concepts is exactly the change
  that could ground `quokka`. The re-probe list in section 10.1 is not optional, and the fix is a new
  demo miss term rather than a smaller seed.
- **WordNet expansion cuts both ways.** L4 expands right and wrong options alike, so it can move
  `refused` up as fast as it moves `answered`. Measure both on that round and read them together.
- **The slice re-cut is a large diff.** `corpus/conceptnet/slice.jsonl` is 4.2 MB of committed data
  and rung 1 rewrites most of it. The new manifest and its estate test are what make that diff
  reviewable, so land the manifest before the re-cut, not after.
- **The seed artifact is not byte-reproducible.** `public/chat-seed.json` embeds wall-clock
  timestamps, which is why the site build stamps a content hash rather than pinning bytes. Nothing in
  this plan should try to hash-pin it. The corpus cuts underneath it are the layer that gets pinned.

---

## 15. Not in this plan

- The CommonsenseQA train and test splits. The dev split is the fixture and the train split's source
  concepts feed rung 1's corpus seeding. Scoring the full 1,221-question dev split is a later
  decision about run time, not a design question.
- A leaderboard comparison. The claims page reports what tmct does on a committed sample under
  stated conditions. Ranking that against a model leaderboard would need a matched protocol, which is
  its own piece of work.
- Any LLM, in the product path or the scoring path.
- The EL classifier and the DL tableau. `PLAN_SYLLOGIST_EL_DL.md` owns that arc. Rung 3 names this
  fixture as the natural before-and-after for its phase 1 and depends on none of it.
- A `[choice]` config section. Section 12 gives the reasoning.
