# CHATBENCH_001 — chat tuning cycle 1

## Headline

- **Mean rubric score: 1.485 / 2** over 48 cases (**hard fails: 6**, voided judge samples: 0).
- Tier-1 (deterministic): 48/48 pass; 0 failing; 9 cases carry documented baselineFail turns
  (`gq-functions-call-fnalpha`, `tf-modles`, `tf-wat-calls`, `ns-wondering`, `ns-hey-tmct`,
  `am-bare-name`, `mt-focus-drift`, `mr-session-count`, `mr-asked-before`).
- Judge pin: **claude-haiku-4-5-20251001**, prompt **judge-prompt-v1**, 3 sample(s)/case. Run stamp: `cycle-001`.
- Decision rule (SKILL §1): **N/A — this is the baseline.** There is no CHATBENCH_000; cycle 2 is
  judged against THIS run's mean (1.485), hard-fail count (6), and tier-1 pass set (48/48).

**What 1.485 means.** The mechanical core is solid where the grammar hits: clean graph queries
(gq-* excluding the one baselineFail) and conversational turns score at or near 2.0, and the
engine never hallucinated an entity anywhere in 48 cases — every zero is a *miss handled badly*,
never an invented fact. The 0.5-point gap to ceiling is concentrated in four seams, all of which
the judge scored as *confidently-wrong-or-unhelpfully-vague below honest-miss*: input repair
(noise/typo), pronoun focus, cross-session memory, and answer-grain disclosure (module-level
"calls" silently hiding a recorded symbol-level caller).

## Lever applied this cycle

**None — baseline establishment run.** No product change was made for this cycle; the run
measures the tree as merged (interpret pipeline + memory + grammar + TUI, unseeded per
STRATEGY_ADVISOR.log tick 6). The known-but-unmeasured gaps stand recorded: seedMemory/corpus
facts are wired nowhere at runtime, `data/templates` + `data/phrasebook` are committed but
unconsumed, and `retrieveBlocks` never feeds an answer — none of these are exercised by any
cycle-1 case, so their absence moves no score here (they are cycle-3+ levers, measurable only
after cases that demand them are appended).

## Predictions vs actuals

| prediction (step 1) | predicted movement | actual movement | verdict |
| --- | --- | --- | --- |
| n/a — baseline run, no lever, no prior cycle | n/a | mean 1.485, 6 hard fails established as the floor | baseline recorded |

The **RANKED LEVER BOARD** at the bottom carries cycle 2's predictions; they become the
predictions-vs-actuals input for CHATBENCH_002.

## Per-tag breakdown

| tag | cases | mean (0–2) | hard fails |
| --- | ---: | ---: | ---: |
| ambiguity | 4 | 1.646 | 0 |
| bootstrap-empty | 2 | 1.834 | 0 |
| conversational | 6 | 1.861 | 0 |
| graph-query | 15 | 1.652 | 1 |
| honesty-miss | 5 | 1.4 | 0 |
| memory-recall | 3 | 0.861 | 1 |
| multi-turn-focus | 5 | 1.233 | 1 |
| noise | 5 | 1.2 | 2 |
| typo-fuzzy | 4 | 1.111 | 1 |

### memory-recall — 0.861 (worst tag)

One bench artifact plus one real product gap, not a broad memory failure:

- **mr-session-count (0.00, hard fail)** — session 2 answers `0 sessions.` against a graph that
  records session 1. Root cause traced and reproduced (see the hard-fail dissection): the
  session IS appended to `graph.json`; session 2 just never re-reads it because the bench runs
  both sessions in one process and `src/source.mjs`'s process-level read cache serves the stale
  pre-session payload. **Bench wiring, not the product's append path.**
- **mr-asked-before (0.75)** — "what did i ask before" gets the full grammar-miss hint dump.
  Judge (s1): "mischaracterized the meta-question about session history as a graph-query parsing
  error … the nudge lists graph patterns but does not help the user get closer." A real gap:
  the memory store holds the utterances (sessions.mjs `recordSessionMemory`), but no recall
  surface reads them.
- **mr-graph-intact (1.833)** — the fold-in does NOT corrupt the graph; session 2 re-answers the
  import question perfectly. The subsystem's core invariant holds.

### typo-fuzzy — 1.111

The fuzzy tier is real but uneven: `tf-whcih-imprt` (2.00) repairs two typos flawlessly, while
the other three cases show three distinct repair failures:

- **tf-modles (0.50, hard fail)** — "modles" fuzzy-pivots onto the SCHEMA individual `Module`
  and confidently answers "No — no imports edge found from Module to app/lib/a.mjs" — a question
  the visitor didn't ask. Judge (s3): "confidently answered whether the schema class Module
  imports a.mjs … the correct answer (b.mjs, c.mjs, e.mjs) goes unstated, no repair receipt."
- **tf-wat-calls (0.833)** — "wat" is neither curated noise nor restored by the trigger-typo
  tier, so the turn collapses to "couldn't resolve one of the terms". Judge (s2): "provides no
  guidance to help the user rephrase or recover."
- **tf-fnalpah (1.111)** — the repair itself works ("assuming you meant fnAlpha") but the
  module-grain empty hides the recorded symbol-level caller. Judge (s2): "missed the
  symbol-level call Widget.render → fnAlpha … presenting a partial answer as complete."

### noise — 1.200

A clean strip-works/strip-fails split. `ns-um-hey`, `ns-could-you`, `ns-so-uh-count` all score
2.00 — the noise-strip strategy (`src/interpret/strategies/noise-strip.mjs`) recovers the parse
when every non-grammar token is curated noise. The two hard fails are residual-token failures,
verified directly against `stripNoise()`:

- `"i was wondering what calls fnAlpha"` strips to `"was what calls fnAlpha"` — **"was"
  survives** and defeats the anchored re-parse.
- `"hey tmct, what calls fnAlpha thanks"` strips to `"tmct what calls fnAlpha"` — **the
  product's own name survives** and becomes an unresolvable term.

Both then fall through to "couldn't resolve one of the terms", which the judge zeroes as a
fabricated limitation (see hard-fail dissection).

### multi-turn-focus — 1.233

- **mt-focus-drift (0.00, hard fail)** — after "what calls it", turn 3's "which modules import
  it" binds "it" to the wrong entity: the answer receipt reads `traversal: imports edges where
  object = Commit`. The pronoun drifted from the focused module to a Commit.
- **mt-describe-then-callers (0.667)** — turn 2 is CORRECT (`scripts/g.mjs`), but the judge
  zeroed groundedness on turn 1's `/describe` output for claiming "touched by 2 commit(s)" and
  citing `git:def5678`. **This is a judge-context artifact, not product fabrication**: the
  fixture (`test/fixtures/entities.fixture.json:115`) really does carry
  `derived_from: ["git:abc1234", "git:def5678"]` on mod-a, plus the cochange edges — but
  `FIXTURE_CONTEXT` in `chatbench/run.mjs:67-68` tells the judge "One commit: abc1234 …
  no other commits". The judge scored faithfully against an unfaithful summary. The same
  artifact contaminates turn 1 of mt-focus-drift (harmless there — turn 3 alone zeroes it) and
  one gq-impact-a sample.
- The rest of the tag works: `mt-ask-then-touched` (2.00) and `mt-why-expand` (2.00) show focus
  threading and why-expansion are healthy on the happy path.

### honesty-miss — 1.4

No hard fails, but two cheap honesty leaks: **hm-unknown-fn (0.778)** answers a function
question with a module-shaped miss ("no module matching \"nonExistentFn\"") — judge (s2): "a
category error … hides the actual limitation and answers a different question". And
**hm-empty-result-calls (1.111)** gives the honest module-grain empty while the graph holds a
symbol-grain caller — judge (s2): "the traversal receipt … conceals that symbol-level callers
exist". Both point at the same answer-grain disclosure gap as gq-functions-call-fnalpha.

### The healthy tags

conversational 1.861, bootstrap-empty 1.834, graph-query 1.652 (13 of 15 at 1.5+), ambiguity
1.646. One note for later: **conv-what-can-you-do (1.167)** — the orientation text's example
questions name `walk.mjs` and `buildContextBundle`, which don't exist in the loaded graph; two
of three judge samples dinged honesty for it. The examples are hardcoded, not graph-derived.

## Hard fails (6)

- **gq-functions-call-fnalpha** (graph-query): mean 0 — "which functions call fnAlpha" →
  "No functions found whose module directly calls fnAlpha." The fixture records a symbol-level
  `callsSymbol` edge Widget.render → fnAlpha; the answer path only traverses module-grain calls
  edges, so a recorded fact is denied with confidence. Judge zeroed all four dims on the
  **groundedness anchor** (contradicts a recorded fact) + **wrong-confident-below-honest-miss**
  anchor: "a wrong answer delivered with false certainty about what was searched" (s1).
- **mr-session-count** (memory-recall): mean 0 — session 2 answers "0 sessions." **Root cause
  (verified by reproduction): bench wiring, not the product append.** Evidence: (1) after
  session 1, the temp dir's `graph.json` contains the Session individual and
  `classes[] = {name:"Session",count:1}` — `appendSessionToGraph` (chat.mjs:636 →
  sessions.mjs:154) works; (2) `runTurn` over a freshly parsed copy of that artifact answers
  "1 session." correctly (`answerCount`, chat.mjs:142, counts Session via COUNT_NOUNS); (3) the
  failure reproduces only because `chatbench/run.mjs` runs both sessions in ONE process and
  `src/source.mjs:75` returns the process-cached pre-session payload for the same
  `config.graphFile` — session 2 never re-reads the file; (4) inserting
  `clearCache()` (exported at source.mjs:19) between sessions yields exactly "1 session.",
  the case's expected answer. In real usage sessions are separate CLI processes, so the cache
  never spans them. (The advisor's tick-8 framing "sessions never get appended into the graph"
  is refuted by (1) — they are appended; the second session never *reloads*.) Judge anchor:
  wrong-but-confident ("'0 sessions.' contradicts the recorded commit history", s2).
  Residual product note: the same cache would stale any long-lived multi-session process
  (server.mjs) — worth a product-side invalidation eventually, but the *measured* failure is
  the harness's.
- **mt-focus-drift** (multi-turn-focus): mean 0 — turn 3 answers "No modules found whose module
  directly imports it. (traversal: imports edges where object = Commit)": the literal pronoun
  was resolved to a Commit instead of the focused a.mjs. Judge anchor: wrong-but-confident, and
  it "directly contradicts its own Turn 1 output (which listed 3 importers)" (s2). Turn 1's
  "fabrication" complaints are the FIXTURE_CONTEXT artifact (see multi-turn-focus above); turn 3
  alone justifies the zero.
- **ns-hey-tmct** (noise): mean 0 — "couldn't resolve one of the terms" after `stripNoise`
  leaves the residual token "tmct". Judge anchor: **fabricated limitation** — "fnAlpha is
  explicitly defined … the claim that it 'couldn't resolve one of the terms' is false and
  delivered confidently" (s3). Note the judge scores user-facing truth, not engine internals:
  a truthful report of a parse failure still zeroes when the terms are objectively resolvable.
- **ns-wondering** (noise): mean 0 — identical failure shape; the residual token is "was"
  ("i was wondering …" strips to "was what calls fnAlpha"). Same fabricated-limitation anchor:
  "tmct fabricated a parsing obstacle that does not exist" (s1).
- **tf-modles** (typo-fuzzy): mean 0.5 — the schema-term trap described under typo-fuzzy.
  Groundedness 2 (the claim about the Module class is technically true) but correctness 0 AND
  honesty 0 across all samples → hard fail by definition (confidently wrong): it "answered a
  question the visitor did not ask" (s3) with no repair receipt.

All six hard fails are **unanimous**: every one of the 18 judge samples involved scored the
identical dim vector. None is a judge-noise casualty.

## Tier-1 failures (0)

None. 48/48 as authored; the 9 baselineFail cases behaved exactly as documented (0
`improvedBaselineTurns`).

## Judge integrity

- **Voids: 0 / 144 samples.** No refusals, no format failures, no dimension-mask voids.
- **Hard-fail robustness:** all 6 hard fails are 3/3-sample unanimous on every dimension (see
  above) — the headline failure count owes nothing to judge noise.
- **Sample variance:** 16 of 48 cases show a ≥1.0 spread on at least one dimension across the 3
  samples; mean per-case spread of case-means is **0.194**. The two worst (case-mean spread
  1.50): `gq-impact-a` (sample 3 read the depth-2 "(imports it)" rendering as a claim of direct
  imports and zeroed groundedness; samples 1–2 gave 2/2) and `conv-what-can-you-do` (honesty
  1/0/2 — samples disagree on whether the non-graph example questions are an honesty violation).
  A full 2.0 swing on one case moves the 48-case mean by ±0.042, and these two contribute at
  most ~±0.03 jointly.
- **Verdict: judge noise is NOT material at this cycle's scale.** The cycle-2 predicted delta
  (+0.13 to +0.17) is ~4–5× the plausible noise floor. It WOULD become material for any cycle
  claiming a delta under ~0.05 — flag for later cycles as levers get finer.
- **One systematic bias found (not noise): FIXTURE_CONTEXT infidelity.** `run.mjs:59-70` tells
  the judge "One commit: abc1234 … no other commits", but the committed fixture carries
  `git:def5678` provenance on mod-a and cochange edges — content `/describe` faithfully renders.
  The judge therefore *systematically* zeroes groundedness on truthful /describe output
  (mt-describe-then-callers 0.667 is mostly this; it also contaminates mt-focus-drift turn 1 and
  gq-impact-a sample 3's framing). This is a harness accuracy bug: the judge context must
  describe the fixture as it is. Fixing it changes judge input — record the change in
  CHATBENCH_002 and treat affected cases' deltas as partly measurement-correction, not lever
  effect.

## Per-lever analysis (baseline root causes — no lever applied this cycle)

The four root causes behind the weak tags, each verified in source or by reproduction:

1. **Noise-strip residual tokens** (`src/interpret/strategies/noise-strip.mjs`): `stripNoise`
   drops curated filler but keeps "was" (aux verb) and "tmct" (the product's own name), so two
   of five noise cases fail; "wat" is neither noise nor a restored trigger typo. Three cases,
   one seam.
2. **Bench single-process session replay × product read cache** (`chatbench/run.mjs`
   `runSessionCase` × `src/source.mjs:16,75`): sessions share one process, so session 2 reads
   the cached pre-session graph. One case (mr-session-count); one-line harness fix
   (`clearCache()` between sessions) verified to flip it.
3. **Fuzzy schema-term trap** (`src/ask.mjs` resolution tiers): a lowercase kind-noun typo
   ("modles") can fuzzy-hit a schema-class INDIVIDUAL and silently pivot the question. One
   case; the guard is cheap (don't pivot to a schema individual on a fuzzy-only match when a
   kind-noun reading exists).
4. **Answer-grain disclosure** (module-grain calls traversal): the engine holds
   `callsSymbol` (Widget.render → fnAlpha) but "which functions call fnAlpha" only walks
   module-grain edges and denies the fact; every honest module-grain empty also *conceals* the
   symbol-grain hit. Directly zeroes gq-functions-call-fnalpha and depresses
   hm-empty-result-calls (1.111), tf-fnalpah (1.111), and the ceiling of every "calls fnAlpha"
   noise/typo case.

Plus the pronoun-focus bug (mt-focus-drift: "it" resolved to a Commit) and the missing recall
surface (mr-asked-before) — real, but costlier levers.

## Top discriminating transcripts

### gq-functions-call-fnalpha (graph-query)

```
> which functions call fnAlpha
No functions found whose module directly calls fnAlpha. (traversal: callsSymbol edges where object = fnAlpha)
```

### mr-session-count (memory-recall)

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> how many sessions are there
0 sessions.
```

### mt-focus-drift (multi-turn-focus)

```
> /describe app/lib/a.mjs
app/lib/a.mjs — Module (id: mod-a)
attestation: touched by 2 commit(s)
attribute: dotted = app.lib.a [mgx:dotted]
edges:
  defines [seon:declaresMethod] (1) → fnAlpha
  cochange [mgx:changeCoupledWith] (2) → app/lib/b.mjs, app/lib/c.mjs
  ← imports [mgx:importsNamespace] (3) by app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs
  ← calls [mgx:callsCoarse] (1) by scripts/g.mjs
  ← touches [mgx:touchedByCommit] (1) by abc1234
provenance: git:abc1234, git:def5678
> what calls it
scripts/g.mjs.
> which modules import it
No modules found whose module directly imports it. (traversal: imports edges where object = Commit)
```

### ns-hey-tmct (noise)

```
> hey tmct, what calls fnAlpha thanks
couldn't resolve one of the terms in this question.
```

### ns-wondering (noise)

```
> i was wondering what calls fnAlpha
couldn't resolve one of the terms in this question.
```

## RANKED LEVER BOARD (decision log)

My ranking from this run's evidence, then the diff against the advisor's independent tick-8
board. Predicted per-case means feed CHATBENCH_002's predictions-vs-actuals.

| rank | lever | expected movement (cases/tags) | justification |
| ---: | --- | --- | --- |
| 1 | **L1 noise-strip robustness — THE PICK** (`src/interpret/strategies/noise-strip.mjs` + the trigger-typo restore): strip aux-verb residue ("was"), the product's own names ("tmct"), and restore "wat"→"what" | ns-wondering 0→~1.2, ns-hey-tmct 0→~1.2, tf-wat-calls 0.833→~1.2; noise 1.200→~1.68; clears 2 of 6 hard fails | 3 cases, 1 seam, cheapest high-value; failure mode verified token-by-token against `stripNoise()` |
| 2 | **H1 harness corrections** (bench-side, zero product risk): (a) `clearCache()` between session-mode sessions in `run.mjs`; (b) fix `FIXTURE_CONTEXT` to state the def5678 provenance + cochange edges | (a) mr-session-count 0→~1.9 (clears a hard fail; verified by reproduction); (b) mt-describe-then-callers 0.667→~1.7; memory-recall 0.861→~1.5, multi-turn-focus 1.233→~1.44 | Both are measurement bugs, not levers: (a) makes the bench match the real one-process-per-session world; (b) stops the judge zeroing truthful /describe output. Record both as harness changes in CHATBENCH_002 |
| 3 | **L3 tf-modles schema-trap guard**: never pivot to a schema-class individual on a fuzzy-only match when a kind-noun reading of the typo exists; emit a repair receipt ("read as: which modules import a.mjs") | tf-modles 0.5→~1.8 (clears a hard fail); typo-fuzzy 1.111→~1.53 (with L1) | Confidently-wrong is the rubric's worst anchor — the honesty risk the advisor flagged; guard is small and testable |
| 4 | **L4 callsSymbol surfacing** — CUT to cycle 3, with a scoping warning: surface symbol-grain callers for "which functions call X", and add a one-line disclosure ("a symbol-level caller exists: Widget.render") to module-grain empties. **Do NOT make bare "what calls X" return symbol callers** — hm-empty-result-calls expects `miss:true` + the module-grain empty at tier 1, and flipping it is a pass→fail regression = automatic cycle FAIL | gq-functions-call-fnalpha 0→~1.8 (last easy hard fail); lifts hm-empty-result-calls 1.111→~1.7, tf-fnalpah 1.111→~1.7; raises the ceiling of every "calls fnAlpha" case L1 fixes | Highest single-case value after rank 1–3, but touches the answer path — one focused pass shouldn't carry it alongside L1+L3 |
| 5 | **L5 mt-focus-drift pronoun/focus** — CUT to cycle 3 | mt-focus-drift 0→~1.8 (needs H1b landed to cash the judge score) | Medium: focus-threading semantics, regression-prone around mt-ask-then-touched/mt-describe-then-callers |
| 6 | **mr-asked-before recall surface** (read the memory store for "what did i ask before"; honest "I can't recall" as the floor) — CUT to cycle 3+ | mr-asked-before 0.75→~1.5 | Real product gap; needs memory read-path design, not a patch |
| 7 | **Cheap honesty polish batch** — CUT: hm-unknown-fn kind-correct miss phrasing ("no function matching…"), am-bare-name entity acknowledgement, conv-what-can-you-do graph-derived examples, L8 Utterance/Fact CLASS_DOCS | +0.05–0.08 mean spread across 4 cases | Each is small but they're scattered; batch them when a cycle needs a filler lever |
| 8 | **L7 retrieveBlocks + templates/phrasebook runtime wiring** — CUT/defer | no current case demands it | High latent value, cross-cutting risk; unmeasurable until cases exist (case-set additions are the real prerequisite) |

**Pick:** **L1 + L3 (product) with H1a+H1b (harness corrections) landing alongside** — bounded to
one focused implementation agent in one pass: two small interpretation-repair diffs with tests,
plus two harness lines. Explicit cut line: L4 and everything below it waits for cycle 3.

**Cycle-2 prediction (the predictions-vs-actuals input):** mean **1.485 → 1.60–1.66** (point
estimate ~1.63, +0.146 = +7.0 case-mean points: ns-wondering +1.2, ns-hey-tmct +1.2, tf-wat-calls
+0.37, tf-modles +1.3, mr-session-count +1.9, mt-describe-then-callers +1.0); hard fails **6 → 2**
(gq-functions-call-fnalpha and mt-focus-drift remain, by choice); tier-1 stays 48/48 with
**5 of 9 baselineFail cases flagged `improvedBaselineTurns`** (ns-wondering, ns-hey-tmct,
tf-wat-calls, tf-modles, mr-session-count). Regression watch: tf-whcih-imprt and ns-um-hey /
ns-could-you / ns-so-uh-count must stay 2.0 (L1/L3 touch their code path); mr-graph-intact and
be-honest-empty must survive H1a. Predicted tag deltas: noise 1.200→~1.68, typo-fuzzy
1.111→~1.53, memory-recall 0.861→~1.49, multi-turn-focus 1.233→~1.44.

### Diff vs the advisor's independent board (STRATEGY_ADVISOR.log tick 8)

- **L1 top pick — AGREE**, strengthened with the exact mechanism: the residual tokens are "was"
  and "tmct" (verified against `stripNoise()`), and "wat" needs the trigger-restore tier, not
  the noise list.
- **L2 (session-append/recall wiring) — DISAGREE on mechanism and side.** The advisor's tick-8
  correction said "sessions never get appended into the graph the second bench session loads"
  and left the side open. Verified: the append WORKS (Session individual present in the temp
  dir's graph.json after session 1); the failure is the **read side** — `src/source.mjs`'s
  process-level cache serving the stale payload because the bench replays both sessions in one
  process. The fix is one bench line (`clearCache()` between sessions), verified to produce the
  expected "1 session." Also split the lever: mr-session-count is harness; mr-asked-before is
  a real product gap (rank 6) that no wiring fix touches — the advisor's "L2 fixes 2 cases"
  overstates by one.
- **L3 — AGREE** (my rank 3, advisor rank 3).
- **L4 — AGREE on value, ADD a regression trap the advisor missed**: unscoped symbol-caller
  surfacing flips hm-empty-result-calls' tier-1 `miss:true` expectation → pass→fail regression →
  automatic cycle FAIL under SKILL §1. Deferred to cycle 3 with the scoping note.
- **L5, L6, L7, L8 — AGREE with the advisor's ordering/deferral**; L6+L8 folded into the rank-7
  polish batch.
- **NEW, not on the advisor's board**: H1b FIXTURE_CONTEXT infidelity (the judge scores against
  a summary that contradicts the committed fixture — a systematic bias worth ~1 case-point) and
  the conv-what-can-you-do hardcoded-examples honesty leak.
- Advisor's "two levers clear 5 of 9 baselineFail" — CONFIRMED in substance, but the two are
  L1+L3 plus a harness line, not L1+L2.
