# PLAN_CSQA_SELECTION.md — lift the CommonsenseQA number off zero: read the topic, then let a conjunction pick

Status: DESIGN. Nothing in this plan is built. `archive/PLAN_COMMON_SENSE_QA.md` delivered the lane, the
fixture, the rig, the claims block and five rungs, and its last measured state is
`results/claims/commonsenseqa.json`: 0 of 100 correct, 14 answered, 13 refused, 73 abstained, 30
with the gold pair present in the graph, 0 of those 30 picked. That plan's own rungs measured
routing, chain depth and three wording levers as flat. This plan starts from a per-item diagnosis of
those 30 and attacks what the diagnosis actually found.

The finding in one line: the lane mostly never asks about the thing the question is about, and where
it does ask, a single ConceptNet edge cannot tell the gold option from a distractor, because both
were drawn from the same relation.

This plan is written to be built by a Sonnet-tier implementer with no further design work. Every
phase names its module paths, its data structures, its function signatures, its test files, its
corpus rows and its acceptance commands. Where a phase is mechanical enough for Haiku, it says so.

No LLM runs anywhere in this stack, in the product path or the scoring path. Scoring stays a gold-key
label comparison against the committed answer key.

---

## 1. What ships today

### 1.1 The lane, end to end

`src/services/chat.mjs:18438-18498` is the whole choice lane, a bare block in `dispatchTurn` sitting
between the slash-command check and the teach write boundary at `assertTurn`. It resolves the turn on
every branch, so a choice question never reaches the teach cascade.

The branches, in order:

| line | branch | what the user sees |
|---|---|---|
| `18447` | `parsed.sourceTerm` is `""` | "I can't tell what these options are alternatives about …" |
| `18453` | no option grounds | "I don't know how \"X\" relates to any of …" |
| `18457` | more than one option grounds | "More than one of those grounds: …" |
| `18470` | exactly one grounds | the option, plus the deciding fact and its source |

`turn.detail.selectedLabel` (`18493`) is set on the answering path only, which is what the rig scores.
The tie branch fires on **count alone** (`18457`, and the comment above it says so): the lane never
compares two grounded options.

`probeChoiceOptions` (`chat.mjs:3796-3856`) decides what grounds. It takes one subject term, spells
it through `factTermVariants` (`3797`), pulls the child pack once for that term when memory holds
nothing for it (`3800-3803`), and then matches each option against the fact rows:

- `matchFacts` (`3815-3820`) accepts a row whose subject and object are the source term and the
  option in **either direction**, then filters by the routed predicate family when the stem cued one.
- three wording passes run in order (`3822-3840`): the exact/lemma tag set from `choiceTermTags`
  (`3744`), then head-noun backoff through `choiceHeadNounTags` (`3751`), then a WordNet synonym
  expansion through `choiceWordnetTags` (`3788`), each tried only when the one before found nothing.
- an option with no direct edge gets a 2-hop `findIsaChain` chase (`3845-3853`).

### 1.2 Where the subject term comes from

`extractStemSourceTerm` (`src/domain/choice-question.mjs:420-433`) is ten closed templates tried in a
fixed order, first non-empty capture wins. Six read a fronted wh-shape (`255-304`), four read the
postponed and mid-sentence shapes `leadsInterrogative` was widened to accept (`364-413`). Every
template ends in `captureStemNounPhrase` (`242`) or `captureTrailingNounPhrase` (`341`), both capped
at three words by `readStemNounPhrase` (`216`) and both stopping at the first
`PHRASE_BOUNDARY_WORDS` member (`200-209`).

One term comes out. There is no candidate list, no ranking, and no second try if the captured phrase
turns out to name nothing the graph knows.

### 1.3 The rig and what its columns mean

`scripts/claims/claim-commonsenseqa.mjs` seeds `INIT_XL_BANDS` through the same
`resolveExtensions`/`seedActiveCorpusEntries` path `scripts/build-chat-seed.mjs` uses
(`seedInitXlBands`, `:60-75`), runs the 100 committed fixture rows through `runTurn` with a fresh
`sessionId` each (`runSample`, `:100-174`), and writes one claim JSON.

`sourceEdgeGrounded` (`:82-93`) is the column this plan's brief quotes. It is **not** what the lane
probes: it compares the fixture's own `question_concept` and the gold option text under plain
`normFactTerm` equality, in either direction, under any predicate. So `sourceEdgePresent` says "the
answer is stated in the graph, keyed to the term the dataset says the question is about". The lane's
own probe uses a different subject term, and that difference is most of this plan.

### 1.4 What the five rungs measured

`archive/PLAN_COMMON_SENSE_QA.md` sections 10.1 to 10.5 record each rung's own before-and-after on the same
fixture. Nothing here re-litigates them; they are the reason this plan looks where it does.

| rung | what it changed | measured effect |
|---|---|---|
| R1 seed coverage | re-cut `corpus/conceptnet/slice.jsonl` off CommonsenseQA train concepts, relational predicates preferred | `sourceEdgePresent` 2 to 30, `correctOfAnswered` 0 |
| R2 relation routing | `routeChoiceRelation` narrows accepted predicates to the family the stem cues | fired on 56 questions, changed no verdict, `correctWhenRouted` 0 |
| R3 inference depth | `findIsaChain` fallback at `maxHops: 2` | no chain ever grounded an option; `byHop` 2 reads 0 answered |
| R4 wording, 3 levers | lemma fold, head-noun backoff, WordNet synonyms | one item moved from abstained to answered-wrong; `matchedBy.wordnet` 1 |
| R5 abstained band | counting and copy only | `abstainedUncued` 35 of 73 |

R4's own record carries the finding that pointed here: the head-noun lever visibly moved the
partition without ever appearing in `matchedBy`, because that column tags only the winning match in
an answered item. A lever can change what grounds and leave every reported column flat. The columns
the rig writes today cannot see a reach change at all: a miss the probe never reached and a miss the
probe reached and found nothing both land in `abstained`.

---

## 2. The 30, diagnosed

### 2.1 How the diagnosis was run

One store seeded once with `INIT_XL_BANDS` through the rig's own exported `seedInitXlBands`, 61,724
facts, the same count the committed JSON reports. Then all 100 fixture rows through `runTurn` in four
foreground chunks of 25, with the parse, the route, the per-option edge sets and the turn's own
verdict recorded per item. The replay reproduces the committed claim exactly: answered 14, refused
13, abstained 73, `sourceEdgePresent` 30, value 0. Every number below comes off that replay.

### 2.2 The failure-mode table

The 30 questions whose answer is stated in the graph, by why the lane did not pick it:

| failure mode | items | where it happens |
|---|---|--:|
| the lane probed a term that is not the question's topic | 10 | `extractStemSourceTerm` captured a phrase from the wrong slot |
| the lane extracted no topic term at all | 9 | all ten templates returned `""`; the turn ends at `chat.mjs:18447` |
| the gold option grounded, and so did one to three distractors | 10 | the tie branch, `chat.mjs:18457` |
| the question never parsed as a choice question | 1 | `coreParse`'s own gates, `choice-question.mjs:488-499` |

So 20 of the 30 fail before the graph is consulted about the right thing, and 10 fail at the tie.
None of them fails because the evidence was found and mis-ranked, because the lane never ranks.

The wrong-term captures are all recognisable slot errors:

| stem | topic | what the lane probed |
|---|---|---|
| "Eating is part of living, but your body doesn't use it all and the next day you will be doing what?" | eating | `doing` |
| "How might a automobile get off a freeway?" | automobile | `off a freeway` |
| "The man laid on the soft moss and looked up at the trees, where was the man?" | moss | `man` |
| "Where do you keep your pizza slice before you eat it?" | pizza | `pizza slice` |
| "If a person isn't able to pay their bills what must they do?" | person | `person isn't able` |
| "Danny is having fun just dancing and singing with his friends … the same as what?" | having fun | `same` |

### 2.3 The 14 answered questions are a coverage band, not a selection band

Every one of the 14 questions the lane answered has **zero** edges between the fixture's own topic
term and the gold option. None of the 14 is in the 30. The lane answered them because a distractor
had an edge and the gold had none, which is what the fixture's construction produces when the seed
holds part of the relation and not the rest. Nothing about selection can fix those; they need edges.

### 2.4 The tie band, opened up

The 10 tied items, with the grounded options and their edge counts:

```
113aaea2 doormat    B:1* E:1              4319eaa3 snake     A:1 C:1 D:1* E:1
1e939cc6 coins      B:1* C:1 D:2 E:1      4d67cdb4 marmot    A:1 B:1 C:1* E:1
5a7f6fd9 river      B:1 D:3* E:1          5c2bc433 shelf     A:1 B:1 C:1*
793672da fox        A:1 B:1 D:1 E:1*      b94a9764 children  A:1* D:1 E:1
eacd87f2 stapler    A:1 B:1*              f61d83f9 buildings A:3 D:1* E:1
```

In eight of the ten the gold and every rival carry exactly one edge, under the same predicate
(`mgx:atLocation` in seven), matched at the same `exact` tier. There is nothing to rank.

### 2.5 The ceiling with a perfect topic read

The decisive measurement. Feed the lane's own evidence rule the fixture's own `question_concept` as
the subject, which is the best any topic reader could ever do, and score it:

| evidence rule | sole grounded | correct | tied | nothing grounds | gold among the grounded |
|---|--:|--:|--:|--:|--:|
| any predicate, either direction | 33 | **1** | 51 | 16 | 35 |
| any predicate, forward only | 32 | **1** | 50 | 18 | 35 |
| routed predicate when cued, either direction | 32 | **1** | 43 | 25 | 30 |
| routed predicate when cued, forward only | 32 | **1** | 42 | 26 | 30 |

A perfect topic read plus today's evidence rule scores 1 of 100. The average tie holds 2.8 grounded
options. That is the fixture working as designed: CommonsenseQA's distractors were pulled from
ConceptNet on the same relation as the answer, so a single pair edge is close to no evidence, exactly
as `archive/PLAN_COMMON_SENSE_QA.md` section 2.3 predicted before any of it was built.

### 2.6 The discriminator search

Eight ranking rules, each applied to the 38 multi-grounded items produced by a widened topic read,
scored on how often the top-ranked option is the gold one:

| rank rule | picks the gold option |
|---|--:|
| most edges | 13 / 38 |
| fewest edges | 14 / 38 |
| highest option degree in the graph | 14 / 38 |
| lowest option degree in the graph | 9 / 38 |
| best match tier (exact over lemma over head-noun) | 13 / 38 |
| shortest option text | 8 / 38 |
| longest option text | 10 / 38 |
| **first option label** | **14 / 38** |

Picking option A every time scores as well as the best of them. That is the whole result: none of
these rules carries information about the question. Restricting each to a strict separation (break
only when one option is strictly ahead) does not rescue them either. Most edges separates 5 ties and
gets 0 right. Best match tier separates 5 and gets 0.

ConceptNet's own assertion weight, which the child pack carries per fact
(`corpus/child/shards/*.jsonl.gz`, `weight` on every row), separates 20 of 27 ties and gets 6 right,
30 percent against a 32 percent chance baseline for a tie of that average size. Weight is a
popularity prior over the corpus, not a statement about the question, and it measures like one.

One rule beats chance. **Constraint satisfaction**: score each grounded option by how many of the
stem's *other* content terms the graph also links it to, and separate only when one option is
strictly ahead with at least one link. It separates 15 of 53 ties under a perfect topic read and gets
6 right, 40 percent against 32 percent chance. Under the topic reader this plan proposes it separates
6 ties and gets 3, the same 50 percent it scores on the small band.

The reason it is different in kind from the eight rules above: it is not a strength ordering over one
piece of evidence. It asks whether the option satisfies a second thing the question said. "Where can
you find a snake in tall grass" states two constraints, and an option that answers both is grounded
against more of the question than an option that answers one.

---

## 3. The constitution

These bind every phase. They restate `archive/PLAN_COMMON_SENSE_QA.md` section 3 where it holds and sharpen
the tie rule, which is the one this plan touches.

- **No LLM in the product path.** Unchanged, and it is the reason the discriminator search in section
  2.6 had to be run at all.
- **No LLM in the scoring path.** The rig compares a label against `answerKey`. No judge, no
  similarity model, no embedding.
- **A refusal is never partial credit.** A refused or missed question scores zero.
- **The write boundary holds structurally.** The lane stays where it is, ahead of `assertTurn`.
- **Ties are reported, never broken by strength.** Two options that ground the same way are a tie,
  and the lane lists them. It does not pick the heavier edge, the more common word, the earlier
  label, or the shorter phrase. Section 2.6 is the measurement behind that rule, not just its
  principle: every strength ordering tested picks the gold option no more often than picking A.
- **A pick made against more of the question is not a broken tie.** When one option satisfies a
  constraint the stem states and its rivals do not, the options did not ground equally, and saying so
  is an answer rather than a guess. Such a pick **must** cite the extra constraint it satisfied and
  **must** name the runner-up it beat and what the runner-up failed. An answer that cannot name both
  is a refusal.
- **Every figure on the page is read from the JSON.** No number is restated anywhere else.
- **One fixture, unchanged.** Every phase re-runs the same committed 100 rows.

---

## 4. Phase S1 — read the question's topic

**Model tier: Sonnet.** Owns `src/domain/choice-question.mjs` and one new function in `chat.mjs`.

**The problem.** 19 of the 30 diagnosed failures are a topic-reading failure: 10 wrong term, 9 no
term. The ten templates fire in a fixed order on surface shape alone, and when the shape they match
is not the shape the sentence has, the capture lands in the wrong slot with nothing to catch it.

**The change.** Read a *candidate list* off the stem, then pick one by how much the graph knows about
it. One term still reaches the probe. The lane still asks about one thing.

### 4.1 New pure exports in `src/domain/choice-question.mjs`

```js
/** Words that never name a question's topic: articles, pronouns, auxiliaries,
 *  modals, wh-words, and the light verbs a stem uses to frame a question
 *  ("find", "put", "get") rather than to name its subject. A closed set, in
 *  the house style of every other table in this module. */
export const STEM_TOPIC_STOPWORDS;

/**
 * Every phrase in `stem` that could name what the question is about, in stem
 * order, longest first at each position. Drops STEM_TOPIC_STOPWORDS members,
 * words of two letters or fewer, and every word that also appears in an
 * option — an option term is an answer candidate, never the topic.
 *
 * @param {string} stem
 * @param {Array<{label: string, text: string}>} options
 * @returns {Array<{ text: string, position: number, words: 1 | 2 }>}
 */
export function stemTopicCandidates(stem, options);

/** The stem's other content terms once `topic` is taken out: the constraints
 *  the question states beyond naming its subject. Same filtering as
 *  stemTopicCandidates, minus the topic's own words. Phase S2 reads this. */
export function stemConstraintTerms(stem, topic, options);
```

Both are pure, import only `./interpret/normalize.mjs` and the module's own tables, and keep
`test/estate/import-layers.test.mjs` green.

### 4.2 The pick, in `chat.mjs`

Salience needs the fact store, so the pick lives beside `probeChoiceOptions`:

```js
/**
 * Picks the one candidate the question is about: the candidate the graph
 * holds the most facts about, counting rows where the term is the subject or
 * the object under any predicate. Ties in that count go to the phrase
 * extractStemSourceTerm captured (a structural read beats a graph count when
 * the graph cannot separate), then to the longer phrase, then to the leftmost.
 * Returns "" when no candidate is named in the store at all, which the lane
 * reports as the no-topic miss it already has.
 *
 * Pure in the fact set: the same rows in any order give the same topic, the
 * discipline sortFactIndividualsById already holds the store to.
 *
 * @returns {Promise<{ topic: string, salience: number, runnerUp: string }>}
 */
async function chooseChoiceTopic(candidates, { memoryDir, cache, templateCapture });
```

**Why salience and not a structural rule.** Measured over the fixture, with ties refused and nothing
else changed:

| topic rule | answered | correct | refused | miss |
|---|--:|--:|--:|--:|
| **highest salience** | 21 | **7** | 29 | 50 |
| rightmost content term | 17 | 5 | 11 | 72 |
| leftmost content term | 12 | 1 | 19 | 69 |
| scan the candidates until one grounds an option | 27 | 4 | 55 | 18 |
| the fixture's own `question_concept` (an oracle, not buildable) | 23 | 1 | 53 | 24 |

Salience wins on both the value and the rate: 7 of 21 answered, against 20 percent for a blind guess
among five options. It beats the oracle because the oracle names a ConceptNet concept the seed often
holds nothing about, while salience by construction picks a term the seed does hold.

**The runner-up, and why it is not the default.** Scanning the candidates until one grounds an option
answers 42 and gets 10, more raw value than salience gets. It is rejected: it lets the option set
choose the subject, so the lane ends up answering a question about whichever stem word happened to
touch an option. The citation would then be true and irrelevant, which is the failure the whole
honest-miss design exists to avoid. If a later round wants it, it needs its own argument and its own
measured precision, not a value comparison.

**One deliberate consequence.** `extractStemSourceTerm` stays, and its capture is the salience
tie-break rather than the primary read. It is right about a fronted "where would you find X" stem and
those are exactly the stems where salience has several similar candidates.

### 4.3 Tests

`test/domain/choice-question.test.mjs` gains:

- `"a stem's topic candidates exclude every word that appears in an option"`
- `"a stem's topic candidates keep two-word phrases ahead of their own first word"`
- `"a stem made only of stopwords yields no topic candidate"`
- `"constraint terms exclude the topic's own words"`
- `"the same stem twice yields the same candidate order"`

`test/adapters/chat-choice-lane.test.mjs` gains:

- `"the topic is the stem term the graph holds most facts about"`
- `"two candidates with equal salience defer to the template capture"`
- `"a stem naming nothing the graph knows returns the no-topic miss"`
- `"feeding the same facts in two insertion orders picks the same topic"`

### 4.4 Acceptance

```
npm run build:ask-bundle
npm run test:fast
node --test test/domain/choice-question.test.mjs
node --test test/adapters/chat-choice-lane.test.mjs
node --test "test/estate/*.test.mjs"
```

Then the rig, chunked, section 10's protocol. Expected: `answered` about 21, `correctOfAnswered`
about 7, `refused` about 29, `abstained` about 50. A round that lands 0 correct is a measured result
and gets recorded as one.

---

## 5. Phase S2 — pull the evidence the constraints need

**Model tier: Sonnet.** Owns one function in `chat.mjs`. Depends on S1's `stemConstraintTerms`.

**The problem.** The lane pulls the child pack for the topic term only (`chat.mjs:3800-3803`), and
the comment there gives the reason: pulling per option would seed the graph from the question's own
distractors and ground everything for free. That reasoning holds for options. It does not hold for
the stem's *other* terms, which are constraints the question stated, not answers it offered.

Measured, the difference matters. Scored over the shipped lane's own 13 refusals, with only the
seeded store to read, constraint counting separates 4 ties and gets 1 right, because the modifier
terms have almost no edges in the seed. With the child pack pulled for those terms, the same rule
separates 15 of 53 ties and gets 6, and it is the only rule in section 2.6 above chance.

**The change.**

```js
/**
 * Pulls the child pack once per constraint term, so the constraint check in
 * phase S3 has rows to read. Bounded three ways: at most
 * CHOICE_CONSTRAINT_PULL_BUDGET terms per turn, in stemConstraintTerms order;
 * nothing pulled for a term memory already holds a fact for; nothing pulled
 * for any option term, ever, which is the discipline probeChoiceOptions'
 * own docblock already states.
 *
 * @returns {Promise<string[]>} the terms actually pulled, for the trace note
 */
async function pullChoiceConstraintFacts(terms, { memoryDir, env, cache, synthesisBudget });
```

`CHOICE_CONSTRAINT_PULL_BUDGET = 5`, a module constant in `chat.mjs` beside `AUTO_SYNTHESIS_BUDGET`
(`:12914`). Five covers every constraint term the fixture's stems carry after stopword filtering, and
the cap is what stops a long stem from turning one turn into a bulk import.

**The cost.** A pack pull is an index hit plus one shard read, both cached per process
(`src/adapters/corpus/child-pack.mjs:48-92`). The pulls only happen on a turn that already reached a
tie, so the common paths pay nothing.

### 5.1 Tests

`test/adapters/chat-choice-lane.test.mjs` gains:

- `"a constraint term already in memory is not pulled again"`
- `"an option term is never pulled, even when it names a pack term"`
- `"a stem with more constraint terms than the budget pulls the first five in stem order"`

### 5.2 Acceptance

```
npm run test:fast
node --test test/adapters/chat-choice-lane.test.mjs
node --test test/adapters/chat-child-lane.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 6. Phase S3 — separate on constraints, or refuse

**Model tier: Sonnet.** Owns the tie branch in `chat.mjs:18457-18469`. Serialized behind S1 and S2.

**The change.** The tie branch stops being a count check. When more than one option grounds, score
each grounded option by how many constraint terms the graph links it to, and:

- exactly one option strictly ahead, with at least one constraint satisfied — answer, citing the
  grounding edge **and** the constraint edge, and naming the runner-up and what it failed;
- anything else (a shared top score, a top score of zero, more than one option level) — refuse and
  list, exactly as today.

```js
/**
 * Splits a tie by how much of the question each grounded option answers.
 * `satisfied` is the constraint terms the graph links that option to, each
 * with the fact row that proves it, so the answer can cite them. Returns
 * null when no option is strictly ahead, or when the leader satisfies
 * nothing — both of which stay refusals.
 *
 * @returns {null | {
 *   winner: { label, text, facts, satisfied: Array<{ term, fact }> },
 *   runnerUp: { label, text, satisfied: Array<{ term, fact }> },
 *   missedByRunnerUp: string[],   // constraint terms the winner met and it did not
 * }}
 */
function separateChoiceTie(grounded, constraintTerms, rows);
```

Determinism: `satisfied` is built by iterating `constraintTerms` in `stemConstraintTerms` order over
`rows` sorted the way the store already returns them, and the runner-up is the highest-scoring loser
with the earliest label. Feed the same rows in two orders and the same winner and runner-up come
back. That check is a test, not an assumption.

### 6.1 What the answer says

The winning text has three obligations: the option, the grounding, and the beaten rival.

```
forest — moss is at location forest (source: corpus:conceptnet), and the question also
says trees, which forest is at location for. The other option that grounds is field,
and I hold nothing linking field to trees.
```

Rendered through the existing `factPhrase` (`chat.mjs:7915`) and `citationProvenance` (`:7968`), the
same two the rest of chat cites with. No new renderer, and no new provenance vocabulary.

`turn.detail` gains `separatedBy: constraintTerms.filter(...)` and `runnerUpLabel`, so the rig can
count the band without re-deriving it.

### 6.2 Why this is not a broken tie

The constitution's rule bans picking between options that ground equally. Under this rule they do not
ground equally: one answers two things the question said and the other answers one. The pick is
reported with both citations and with the rival named, so a reader can see the whole basis and
disagree with it. A pick that cannot name the rival, or that rests on a score with no cited fact
behind it, is refused instead.

The rules this does **not** open the door to, and the measurements that closed them
(section 2.6): edge count, ConceptNet weight, term frequency, match tier, option length, label order.
Each of those ranks the same evidence harder. None of them may be added later as a fallback for a
constraint check that came back level; a level constraint check is a refusal.

### 6.3 Tests

`test/adapters/chat-choice-lane.test.mjs` gains:

- `"two options ground and only one meets a second term the stem names, so the lane answers"`
- `"the answer names the runner-up and the constraint it failed"`
- `"two options meeting the same number of constraints stay a refusal"`
- `"a leader satisfying no constraint at all stays a refusal"`
- `"a heavier edge never breaks a tie on its own"`
- `"the same facts in two insertion orders separate the same way"`

The heavier-edge test is the existing `grammar.choice.miss-tie-never-broken` invariant restated at
the unit level, and it must keep passing unchanged.

### 6.4 Acceptance

```
npm run build:ask-bundle
npm run test:fast
node --test test/adapters/chat-choice-lane.test.mjs
node --test test/corpus/grammar.test.mjs
node --test "test/estate/*.test.mjs"
```

Then the rig. Expected: `answered` about 27, `correctOfAnswered` about 10, `refused` about 23,
`abstained` about 50, with about 6 answers coming from the separated band and about 3 of those
correct. The separated band is small, so a round that comes back level is a real possibility and gets
recorded as one rather than retried with a different rule.

---

## 7. Phase S4 — the rig columns and the claims block

**Model tier: Haiku.** Wiring against the existing payload and one block in the same function.

### 7.1 New `detail` columns

`buildClaimDetail` (`scripts/claims/claim-commonsenseqa.mjs:180-201`) gains five, each read off the
run rather than re-derived:

| column | what it counts |
|---|---|
| `topicRead` | questions where the lane read a topic term at all |
| `topicIsQuestionConcept` | of those, how many equal the fixture's own `question_concept` after `normFactTerm` |
| `separated` | ties the constraint check split |
| `correctWhenSeparated` | of those, how many matched `answerKey` |
| `refusedTie` | ties left standing, which is `refused` |

`topicIsQuestionConcept` is a diagnostic, never a scorer. It exists because section 2.2's biggest
failure mode is invisible in today's columns, and a later round needs to see it move.

`runSample` reads `topicRead` and `separated` off `result.detail`, the same way it already reads
`hop` and `matchedBy` (`:142-148`). A field the turn did not set is dropped rather than guessed at,
which is the discipline that function's own comment states.

### 7.2 The block

`scripts/build-demo-site.mjs:835-843` keeps its shape, its `L2` kicker and its five existing
`data-source` citations. Two edits:

1. The split sentence at `:839` keeps its first clause and gains the topic column, because "the
   answer was in the graph and the lane asked about something else" is a different statement from
   "the answer was in the graph and the lane could not choose":

   > Of the 100 questions, `sourceEdgePresent` had the answer stated in the graph at all;
   > `correctWhenSourceEdgePresent` of those got picked. The lane read the question's own topic in
   > `topicIsQuestionConcept` of them.

2. A sentence on the separated band, with its own `data-source` attributes:

   > `separated` of the ties were split because one option answered something else the question said,
   > and `correctWhenSeparated` of those were right. Every other tie is reported as a tie.

The "What this does not mean" paragraph keeps its distractor-construction sentence unchanged. It is
the paragraph section 2.5 measured and confirmed.

### 7.3 Tests

`test/estate/claims.test.mjs` needs no new assertion; it reads `CLAIMS_PAGE_BLOCKS` and validates
whatever the JSON holds. Confirm the block renders every new figure from the JSON by checking the
built page carries the five `data-source` attributes.

### 7.4 Acceptance

```
npm run claim:commonsenseqa
npm run demo:build
node --test test/estate/claims.test.mjs
node --test "test/estate/*.test.mjs"
npm run check:links
```

---

## 8. Phase S5 — the corpus rows

**Model tier: Haiku.** Mechanical, against seven existing rows in the same key group.

`test/corpus/grammar.jsonl` carries seven `grammar.choice.*` rows (`:339-346`). Three more, in the
same shape, each using `setup.teach` so the premises are visible in the row:

| key | id | turns |
|---|---|---|
| `grammar.choice.topic-read` | `grammar-choice-topic-is-the-term-the-graph-knows-most-about` | teach facts about two stem terms, ask a choice question naming both, assert the answer cites the better-known one |
| `grammar.choice.constraint-separated` | `grammar-choice-second-stated-term-separates-two-grounded-options` | teach two options grounded on the topic and one of them linked to a second stem term; assert the answer and the named runner-up |
| `grammar.choice.constraint-level-refuses` | `grammar-choice-two-options-meeting-the-same-constraints-still-refuse` | the same setup with both options linked to the second term; assert the refusal |

`npm run corpus:matrix:gaps` should show the group carrying a negative case, which the third row is.

### 8.1 Acceptance

```
npm run test:fast
node --test test/corpus/grammar.test.mjs
node scripts/corpus-matrix.mjs
npm run corpus:matrix:gaps
node --test "test/estate/*.test.mjs"
```

---

## 9. What this plan does not try, and why the measurement says so

Each of these was measured during the diagnosis and came back at or below chance. They are recorded
here so a later round starts from the number rather than the idea.

- **Rank the tie by edge count.** 13 of 38, against 14 for picking option A. Strictly applied it
  separates 5 ties and gets 0.
- **Rank by ConceptNet assertion weight.** 6 of 20 separations, 30 percent against a 32 percent
  chance baseline. Weight is a corpus popularity prior.
- **Rank by match tier.** 13 of 38; strictly applied, 5 separations and 0 right.
- **Rank by how much the graph knows about the option.** 14 of 38 for the common end, 9 for the rare
  end. The two ends of the same axis bracket chance, which is what a non-signal looks like.
- **Require the routed predicate before an option may ground.** Already shipped as R2; with a perfect
  topic read it drops `goldGrounded` from 35 to 30 and leaves correctness at 1.
- **Require the edge to run forward from the topic.** Drops two grounded options across the fixture
  and moves correctness by nothing.

What would move the abstained band is a different question from selection, and
`archive/PLAN_COMMON_SENSE_QA.md` section 10.5 already names the two research horizons behind it (affective
and evaluative inference; situation and script inference). Nothing here changes that band.

---

## 10. The measurement contract

**One fixture, unchanged.** `test-benchmarks/claims/commonsenseqa-sample.jsonl`, all 100 rows, every
phase. A fixture change is its own decision with its own commit.

**One rig, one JSON.** Every phase writes `results/claims/commonsenseqa.json` through `writeClaim`.
New evidence goes in `detail`; the top-level `value` stays `correctOfAnswered`.

**How to run it.** The rig seeds 61,724 facts before the first question, which takes several minutes,
so a phase measures the way `archive/PLAN_COMMON_SENSE_QA.md`'s own rungs did: seed one persisted store once,
run the fixture in foreground chunks of 25 under the 600s cap, tee every chunk, merge the per-item
outcomes through the rig's own exported `buildClaimDetail`, and write once. The rig's exports
(`loadFixture`, `questionFor`, `seedInitXlBands`, `runSample`, `buildClaimDetail`,
`assertPartitioned`) exist for exactly this and need no change.

**Thresholds ratchet.** The committed threshold rises to the value a phase lands, so a later change
that gives it back fails `npm run claims`. A phase that trades correctness for coverage lowers the
threshold in the same commit, which puts the trade in the diff.

**What counts as a phase landing.** All four:

1. `npm run claim:commonsenseqa` completes and the fresh `value` is at or above the committed
   threshold.
2. `value` rose, or `refused` fell into `answered` without `correctOfAnswered` falling.
3. The phase's own `detail` columns are present and populated from the run.
4. The phase's tests and the estate tier pass.

A phase that moves nothing is a measured result and gets written into this document as one.

**Determinism.** Two runs at the same commit on the same machine give the same `value`, the same
`missedIds` and the same `exampleStems`. The topic pick and the constraint separation are both
read-time resolvers over the fact store, so both take the check `CLAUDE.md` requires: feed one fact
set in two orders, demand the same answer.

---

## 11. Config knobs

| knob | where | why it exists |
|---|---|---|
| `CHOICE_CONSTRAINT_PULL_BUDGET` | module constant, `src/services/chat.mjs` | Caps how many child-pack pulls one tied turn may spend. A constant rather than config: it bounds work per turn, which is a design decision, not a preference. |
| `STEM_TOPIC_STOPWORDS` | frozen set, `src/domain/choice-question.mjs` | Decides what can never be a topic. A closed table in the same style as `CHOICE_RELATION_ROUTES`. |
| `AUTO_SYNTHESIS_BUDGET` | existing, `src/services/chat.mjs:12914` | Already governs the learn-on-miss pull the constraint pull rides on. Extended in reach, not replaced. |

**No new `tmct.toml` section.** Nothing here has a user-facing tuning surface, and a `[choice]`
section would be config for its own sake. `archive/PLAN_COMMON_SENSE_QA.md` section 12 made the same call for
the same reason.

---

## 12. Ownership, concurrency and model tiers

| phase | owns | depends on | model |
|---|---|---|---|
| S1 topic reader | `src/domain/choice-question.mjs`, `src/services/chat.mjs`, `test/domain/choice-question.test.mjs`, `test/adapters/chat-choice-lane.test.mjs` | — | Sonnet |
| S2 constraint pull | `src/services/chat.mjs`, `test/adapters/chat-choice-lane.test.mjs` | S1 | Sonnet |
| S3 separation | `src/services/chat.mjs`, `test/adapters/chat-choice-lane.test.mjs` | S2 | Sonnet |
| S4 rig and page | `scripts/claims/claim-commonsenseqa.mjs`, `scripts/build-demo-site.mjs`, `results/claims/commonsenseqa.json` | S3 | Haiku |
| S5 corpus rows | `test/corpus/grammar.jsonl` | S3 | Haiku |

**What serializes.** S1, S2 and S3 all touch `src/services/chat.mjs` and run one at a time, in that
order. Each is its own measured round, and a round that bundles two phases cannot say which one paid,
the same one-lever discipline `archive/PLAN_COMMON_SENSE_QA.md` section 10.4 used for the wording levers.

**Cross-plan serialization.** `src/services/chat.mjs` has one queue across every plan, not one per
plan. No two `chat.mjs` rounds from any plan run concurrently. `NEXT.md`'s merge note applies to all
of them: rebuild the ask bundle, rerun the pack-manifest check, and check for same-name top-level
declarations across branches, because esbuild's duplicate-symbol error at bundle time is the tell.

**What runs concurrently.** S5 can be written against S3's landed behaviour while S4 wires the page,
because they share no file.

**Model tiers.** Sonnet covers the three engine phases: this document fixes the data structures, the
signatures and the pick rules, so the remaining risk is in a large file rather than in the design.
Haiku covers the rig columns, the block wiring and the corpus rows, each against a verbatim precedent
beside it.

**Sub-agent discipline.** Every dispatch brief caps testing at `npm run test:fast` plus that phase's
own blast radius; the full suite and the e2e tiers are the coordinator's job after the merge. A fresh
worktree has no `corpus/worlds/`, no `corpus/sprites/` and no ask bundle, so every brief says to run
`node scripts/ensure-worlds-pack.mjs`, `node scripts/ensure-sprite-facts.mjs` and
`npm run build:ask-bundle` before any `node --test`.

---

## 13. Costs and risks

- **The separated band is small.** Six separations and three correct is the projection, on a rule
  measured at 15 and 6 under an oracle topic. A round that comes back level is a real outcome, and
  the response is to record it, not to reach for a strength ranking section 2.6 already priced.
- **Salience picks a term the seed knows, which is not always the term the question is about.** It
  scores better than the oracle for exactly that reason, and that is a fact about the seed rather
  than about the reader. `topicIsQuestionConcept` is the column that keeps it visible, and it should
  be read alongside `value` on every round.
- **A wider topic read changes the refusal text.** The no-topic miss at `chat.mjs:18447` fires far
  less often, and the "I don't know how X relates to" miss names a different X. Two e2e pins and the
  `grammar.choice.honest-miss` row read that text; re-probe them in the same round.
- **The constraint pull costs shard reads on tied turns.** Bounded at five terms and cached per
  process, but it is new I/O on a hot path, so measure a turn's wall clock before and after on a tie
  and keep it inside the lane's existing budget.
- **`chat.mjs` is the bottleneck.** Three phases want it, and other plans want it too. Keep each
  round small enough to merge in one sitting.
- **The value can rise while the product gets worse.** Answering more often at chance precision would
  do it, which is why the scan-until-grounded topic rule is rejected in section 4.2 despite scoring
  higher. Read `value` next to `answered` on every round, and treat a rate at or below 20 percent as
  a result that did not land.

---

## 14. Not in this plan

- The abstained band. `archive/PLAN_COMMON_SENSE_QA.md` section 10.5 holds it and names its two research
  horizons.
- More seed coverage. The 14 answered-wrong questions in section 2.3 need edges the seed does not
  hold, which is R1's axis and a separate decision about corpus size.
- The CommonsenseQA train and test splits, and the full 1,221-row dev split. The committed 100 stay
  the fixture.
- Any LLM, in the product path or the scoring path.
- A leaderboard comparison.
- A `[choice]` config section.
