# BENCHMARK_CEFR_ENGLISH_5.0.46 — one sentence that claimed two different things

**Headline: an empty answer now says which branch emptied it, and it never claims a kind is
missing. Over the four judged cells, the 68 answers this changes go 1.865 to 1.949 and clear the
set's only hard fail. The 57 byte-identical answers beside them move −0.029, which is the
instrument's own noise measured on the same run. Honesty goes 1.912 to 1.971 and the rephrase hint
1.724 to 1.900; groundedness and correctness do not move at all. 133 of the 1,075 pool answers
change, no verdict moves either way, and tier-1 stays 1075/1075.**

This is a lever cycle over the composite miss lead. The 5.0.42 decision log ranked it first: the
judge objected to it in its own words on every sample of `g-b1-neg-11`, and it headed 121 of the
1,075 pool answers across 15 cells. The same round's item 4 asked for a composition receipt that
reaches past a seed clause plus one qualifier. Both live in the same sentence, so they are one
lever and one measurement.

## Run profile

- lever: the empty-composition receipt and the kind-aware empty lead (`src/domain/ask.mjs`)
- base commit: `94bd043d`; lever commits `91f45a1c`, `bd86d67a`, `a93dfa1d` and `3ab31cf6`
- judged cells: `B2:relative-embedded` (50), `C2:garden-path` (25), `C1:relative-embedded` (25),
  `C1:negation+relative-embedded` (25) and `B1:negation` (25) from
  `test-benchmarks/chatbench/graded-pool-max.jsonl`: 150 cases, the full census of the three cells
  the lead heads hardest, the cell whose every remaining miss is an empty composition, and the cell
  the lever was evidenced on
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case, no verdict
  cache on either arm, so every case is drawn independently on both. A byte-identical answer
  measures the instrument rather than inheriting its own earlier verdict.
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on each lever build
- raw output: `test-benchmarks/chatbench/results/raw/round-*` (gitignored by design):
  `round-base/`, `round-after/`, `round-after2/` (whole-pool replays), `round-head-*/` and
  `round-neg-*/` (the judged 150), `round-judged-base/`, `round-judged-after/` (first lever draw),
  `round-judged-after2/` (the lever as shipped), `round-judged-neg-base/`, `round-judged-neg-after/`
- voided samples: 0 in every arm, across all 850 judge calls
- one thing this round did twice: the lever's own design changed mid-round on the first draw's
  evidence, so the head cells were judged on the base arm once and on the lever twice. Both lever
  draws are reported.

## Timing

- Benchmarking session: 2026-08-10 15:25 UTC to 16:35 UTC. The three whole-pool replays are free
  and fast (1,075 cases in about four seconds each); the rest is the judge fan-out, 250 samples per
  arm with no cache to inherit from.
- Analysis and write-up: 2026-08-10 16:35 UTC to 16:55 UTC.
- Smoke: `test:smoke` 8/8; `test:fast` 222/222 (tier budgets 765ms and 3,003ms, both inside
  their ceilings); ask tier 231/231; tools tier 472/472; domain + adapters 4,199/4,199; grammar
  corpus lane 367/367; compositional corpus lane 65/65; drilldowns + messy-user + inference lanes
  337/337; bench-smoke + templates + reference + neutrality + planning lanes 289/289; adventure +
  openers + teach-recall + relation-touches lanes 253/253;
  `printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 in a graph-less temp dir.

## What the one sentence claimed

`nothing in the index matches that (functions)` was the lead of every empty composite set. It reads
as a claim that the index holds no functions. What was true is narrower: the index holds functions,
and none of them was un-exported. The judge said so itself, unprompted, on every sample of
`g-b1-neg-11`:

> tmct claims 'nothing in the index matches that (functions)' but the graph contains fnAlpha.

The same sentence also stood in for a second thing it could not say: which branch of the
composition emptied the set. A receipt existed for one shape only, a seed clause plus one
qualifier, because it re-derived the seed rather than reading what the fold actually held.

## The rules

**A fold keeps what reached every step.** `evalBoolean` now folds through a step record: each atom
carries the set that reached it and the set it left. An empty answer reads the first step that
turned a non-empty set into an empty one straight off that record. That covers an intersection of
two clauses, a difference, and a multi-step fold, none of which the re-derived version could reach.

**The same question is asked of every other composition shape.** A relation hop, a membership hop,
a qualifier over a composed set, a follow-up filter over the previous answer, and a membership
owner all have an input set and a step. The walk goes outside in and stops at the step that emptied
the set; where nothing held anywhere, it bottoms out on the clause that started empty and states
that clause instead.

**A step may only claim what is proven.** A difference names its qualifier only where every member
of the held set really satisfies it, since a member the qualifier does not apply to at either
polarity leaves by the same door. An intersection negates its filter, which is all its members
failing it proves. Both rules carry over from the earlier receipt unchanged.

**Nothing here reads a clock or an arrival order.** Every line is a function of the parse and the
fact set, so the same facts in a different order produce the same sentence.

The closed template set, one entry per shape a composition can end on:

**The verdict leads, the receipt follows.** A receipt on its own reads as a description of the
entity it names, and the judge said so in its own words on the first draw of this round: "tmct
implicitly names e.mjs without acknowledging the correct answer is empty". So the empty comes
first and the receipt explains it.

| the answer is empty because | the line |
|---|---|
| the index holds none of the kind | `no classes in this index.` |
| the kind is there and a qualifier emptied it | `no classes match that. The index has 3 classes, but none of them is static.` |
| the first clause held nothing | `no module in this index imports scripts/g.mjs.` |
| a clause held and the next step emptied it | `no modules match that. 3 modules import app/lib/a.mjs, but none of them imports app/lib/c.mjs.` |
| a difference removed everything that held | `no modules match that. 1 module imports app/lib/b.mjs, but it imports app/lib/c.mjs too.` |
| a hop over the held set found nothing | `no modules match that. 1 module imports app/lib/b.mjs, but no module in this index imports it.` |
| a membership hop found no members | `no functions match that. 3 modules import app/lib/a.mjs, but none of them has any functions.` |
| the held set is a composition no single clause states | `no classes match that. 1 class matched that far (Widget), but it is not exported.` |
| an owner has no members of the kind | `Base has no methods in this index.` |

A held set a clause states offers that clause as a question of its own, in the direction the
question asked it: `Try "which modules import app/lib/a.mjs" for that branch on its own.` for an
active clause, `Try "which modules are imported by app/lib/f.mjs" …` for a passive one. Every
question the receipt offers parses and answers, pinned as a lane test rather than assumed.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1075 / 1075 | 1075 / 1075 |

Diffing the arms' `product.jsonl` case for case, 133 of the 1,075 answers changed, in the same 15
cells the 5.0.42 write-up counted. No turn went from a miss to an answer or from an answer to a
miss: this round changes what an empty answer says, never whether it is empty.

| cell | changed answers |
|---|--:|
| B2 relative-embedded | 23 |
| C2 garden-path | 19 |
| C1 relative-embedded | 16 |
| B2 coordination-compositional | 13 |
| C1 temporal | 12 |
| C1 coordination-compositional | 11 |
| C1 negation+relative-embedded | 10 |
| A2 negation | 7 |
| C1 conditional | 7 |
| A2 svo-query | 4 |
| C2 relative-embedded | 4 |
| B2 reversible-passive | 3 |
| B2 discourse-reference | 2 |
| B1 negation | 1 |
| B1 discourse-reference | 1 |

121 of those are the answers the generic lead headed. The other 12 are the receipts 5.0.42 already
wrote, which now open with the verdict like every other empty.

Every changed answer lands on a specific line, and none falls back to a generic lead: 92 carry a
held-set receipt, 22 state an empty first clause, 13 name the members of a composition no clause
states, 4 count a whole kind, 1 names a membership owner, and 1 states a passive clause that held
nothing.

## Judged — the four head cells

125 cases, both arms drawn fresh, no cache on either side.

| view | n | base | lever | delta | hard fails |
|---|--:|--:|--:|--:|--:|
| whole judged set | 125 | 1.901 | **1.934** | +0.033 | 1 → 1 |
| answer changed | 68 | 1.865 | **1.949** | **+0.084** | 1 → 0 |
| answer byte-identical | 57 | 1.944 | 1.915 | −0.029 | 0 → 1 |

**The controlled view is the one to read.** The 68 changed answers gain +0.084 and clear the set's
one hard fail. The 57 byte-identical answers move −0.029 and pick up a hard fail on text that never
changed, which is the instrument's own noise measured on the same run. The raw +0.033 is those two
numbers mixed together.

Per cell, changed answers only:

| cell | n | base | lever | delta | hard fails |
|---|--:|--:|--:|--:|--:|
| B2 relative-embedded | 23 | 1.870 | 1.980 | +0.110 | 0 → 0 |
| C1 relative-embedded | 16 | 1.875 | 1.969 | +0.094 | 0 → 0 |
| C1 negation+relative-embedded | 10 | 1.883 | 1.967 | +0.083 | 0 → 0 |
| C2 garden-path | 19 | 1.842 | 1.886 | +0.044 | 1 → 0 |

Per dimension, changed answers only:

| dimension | base | lever |
|---|--:|--:|
| groundedness | 1.949 | 1.949 |
| correctness | 2.000 | 2.000 |
| honesty | 1.912 | **1.971** |
| rephrase-hint helpfulness | 1.724 | **1.900** |

Groundedness and correctness do not move, which is the right shape for this lever: the verdicts
were already right and nothing about what the engine knows changed. Honesty and the rephrase hint
are the two dimensions a miss sentence owns, and both rise.

By template family, changed answers only:

| family | n | base | lever | delta |
|---|--:|--:|--:|--:|
| held clause + step | 51 | 1.873 | 1.952 | +0.079 |
| members cited | 6 | 1.722 | 1.945 | +0.222 |
| empty first clause | 11 | 1.909 | 1.940 | +0.030 |

The member-citing form carries the smallest sample and the largest gain, which is the opposite of
the worry that named its own decision-log entry: naming the entities of a composition no clause
states reads better than glossing it, not worse.

### The first draw, and why the design changed mid-round

The first lever build wrote the receipt without a leading verdict. Its numbers on the same 125
cases, same base arm:

| view | n | base | first draw | delta |
|---|--:|--:|--:|--:|
| answer changed | 68 | 1.865 | 1.897 | +0.032 |
| C2 garden-path, changed | 19 | 1.842 | 1.719 | **−0.123** |

Three cells rose and one fell. The judge's rationales on the falling cell all said the same thing,
in its own words: *"tmct implicitly names e.mjs without acknowledging the correct answer is
empty"*, and *"the overall answer should state 'no modules' plainly, not describe modules that
don't satisfy the composite condition"*. The garden-path answers also carried no nudge at all,
because a passive held clause had no branch question, and the rephrase dimension scored 0 for it.

Both were real defects in the lever rather than judge noise: half the samples on those cases still
scored the receipt 2/2/2 and praised it, so the answer was right and its shape was wrong. The
verdict now leads and a passive clause offers its own branch. That cell goes from −0.123 to +0.044,
and its hard fail clears.

## B1 negation — the cell the lever was evidenced on

| view | n | base | lever | delta | hard fails |
|---|--:|--:|--:|--:|--:|
| whole cell | 25 | 1.950 | 1.970 | +0.020 | 0 → 0 |
| answer changed | 1 | 2.000 | 2.000 | +0.000 | 0 → 0 |
| answer byte-identical | 24 | 1.948 | 1.969 | +0.021 | 0 → 0 |

`g-b1-neg-11` is the one changed answer, and it scores a perfect 2.000 on both arms of this draw:
groundedness 2, honesty 2, rephrase-hint 2, on the base text and on the lever text alike.

That is not the number 5.0.42 recorded. That round read honesty 0 on both of its samples of the
same base sentence, and quoted the judge's own words for it. Two draws of the same instrument, on
the same pinned model and prompt, over byte-identical text, disagree across the full range of the
dimension. The instrument note below is where that goes; the short version is that this cell can no
longer be cited as evidence for or against the lever in either direction.

## Predictions vs actuals

| prediction | actual |
|---|---|
| the 121 answers the lead headed all change, and nothing else does | held for the lead's own 121, and the verdict-first fix took the 12 receipts 5.0.42 had already written with it, for 133 in the same 15 cells. No verdict moved either way |
| tier-1 over the whole pool stays 1075 / 1075 | held on the base and on all three lever builds |
| every changed answer lands on a specific line, none on a fallback | held: 92 held-set receipts, 22 empty first clauses, 13 member citations, 4 whole-kind counts, 1 owner, 1 passive clause |
| carrying the fold's intermediate reaches the shapes the re-derived receipt could not | held: an intersection of two clauses, a difference, and a three-atom fold each name their own step, and every miss in `C1:negation+relative-embedded` now carries a receipt |
| the changed answers gain on honesty and the rephrase hint, and leave groundedness and correctness alone | held exactly: honesty +0.059, rephrase +0.176, groundedness and correctness flat |
| the byte-identical control stays flat, so the changed-answer gain is the lever | missed: the control moved −0.029 and picked up a hard fail on unchanged text. The gain still clears it four times over, but this instrument does not sit still |
| the receipt is enough on its own to make an empty answer read as an empty answer | missed, and this is the round's real finding: without a leading verdict the C2 garden-path cell fell 0.123 on its changed answers, and the judge named the reason. The fix landed inside the round and that cell now gains |
| `g-b1-neg-11`'s honesty moves off the 0 that 5.0.42 recorded | missed, and not in the lever's favour: on a fresh draw the base text scores honesty 2, so there was no 0 left to move. The cell is silent on this lever either way. |

## Pins

- `test/tools/ask-combo.test.mjs` — 8 new lane tests against the committed fixture: the empty-kind
  and emptied-filter split, an intersection of two clauses, a difference, a multi-step fold over
  its own intermediate, a relation hop in both directions, the offered branches round-tripping to
  real answers, a membership owner with no members, and a passive clause as the emptying step.
- `test/corpus/games/compositional.jsonl` — 3 new rows against `examples/mini-webapp`, keys
  `games.compositional.relative-chain-miss` (a hop that names the set it carried, and a chain whose
  inner clause held nothing) and `games.compositional.qualifier` (an owner with no members).
- Six existing rows in the compositional and grammar lanes moved to the new wording, each with its
  note rewritten to say what the line now claims.

Decision rule (§1): the judged mean is up on the whole set and up four times as far on the answers
this lever actually changed; the one hard fail on a changed answer clears; every judged cell rises
on its changed answers; tier-1 over the whole pool holds at 1075/1075 and no case regressed there.
The single new hard fail sits on text that never changed, which is the instrument, not the product.
**PASS.**

## Instrument notes

**Both arms were judged without a cache, on purpose.** Every round since 5.0.39 has had to
hand-control for the verdict-cache partition, where a case inherited on one arm and judged fresh on
the other moved up to a full point on text that never changed. Judging both arms fresh removes the
partition: a byte-identical answer now gets an independent draw on each arm, so the difference
between those two numbers IS the instrument's noise, measured rather than argued about. It costs
twice the judge calls, and it is what makes the controlled view below readable.

**The judge context asserts what the pool denies** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`).
Untouched here: rewriting `run.mjs`'s `FIXTURE_CONTEXT` moves `FIXTURE_CONTEXT_VERSION` and
re-judges the pool, which is a re-baseline run rather than a lever round.

## Decision log — ranked next levers

1. **The judge's own reliability on text that did not change.** This round measured it twice over.
   24 byte-identical B1-negation answers moved +0.021 and 57 byte-identical head-cell answers moved
   −0.029 with a hard fail, all with no product change, and the case that motivated the whole item
   read honesty 0 in 5.0.42 and honesty 2 here, on the same sentence, the same pinned model and the
   same pinned prompt. Every small-signal claim in this arc
   currently rests on the controlled split alone. The work is to give a round its own error bar:
   two independent draws per arm on the cells that decide it, with the spread reported beside the
   mean, and N raised where the spread is wide.
2. **C2 pronoun-binding** (13/25 green, 12 frontier). Carried from the 5.0.42 board and still the
   largest frontier block outside the cells waiting on a capability. It needs a diagnosis pass
   before it can be ranked on evidence rather than on size.
3. **B2 assert-recall** (16/25 green, 9 frontier). Its performance-vs-production band gap is 0.64,
   the widest in the pool, which says the capability is there and something in the production path
   is not reaching it.
4. **The two empty leads this round did not reach.** `whereSet` still answers "nothing in the index
   matches that clause (classes), so there is no location to cite" and `temporal` still answers
   "nothing in the index matches the inner set". The walk that would name their branch already
   exists; each renderer has a tail sentence of its own to compose with. Small, and now cheap.
5. **Instrument: the judge context's commit-count paragraph**
   (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`). It cost a full point on `g-c2-garden-3` this round:
   one sample scored the answer 0 across the board because the context calls a provenance ref
   truthful that the pool's own ground truth denies. A re-baseline run rather than a lever round,
   since it re-judges the pool.
6. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

## Evidence / transcripts

Every case below is a byte-for-byte arm difference, and every verdict stays exactly what it was.

### g-b2-rel-15 — a hop that found nothing, over an inner set that held

> which modules import the module that imports app/lib/b.mjs

Before: nothing in the index matches that (modules). Try "who touched \<a module that actually has
commits\>" or "/describe \<module\>" to see what's in the index.

After: no modules match that. 1 module imports app/lib/b.mjs, but no module in this index imports
it. Try "which modules import app/lib/b.mjs" for that branch on its own.

The index holds eight modules. The old line was read as saying it holds none. The inner clause did
hold one, and the hop off it is where the answer ran out, which is also the branch worth asking on
its own.

### g-c2-garden-4 — the case that changed the design mid-round

> modules imported by app/lib/f.mjs tested by app/unit-tests/b.test.mjs

Before: nothing in the index matches that (modules).

First draw: 1 module is imported by app/lib/f.mjs, but it is not tested by app/unit-tests/b.test.mjs.

After: no modules match that. 1 module is imported by app/lib/f.mjs, but it is not tested by
app/unit-tests/b.test.mjs. Try "which modules are imported by app/lib/f.mjs" for that branch on its
own.

Every fact in the first draft was grounded and the judge said so. It still marked the answer down,
because a sentence that opens by naming a module reads as an answer about that module. The verdict
now leads, and the passive clause offers its own branch instead of no nudge at all.

### g-c1-neg-rel-22 — a difference over a composed set

> modules importing the module that defines Widget but not tested

Before: nothing in the index matches that (modules).

After: no modules match that. 1 module matched that far (app/functions/d/handler.mjs), but it is
tested.

The held set is a two-hop composition no single clause states, so the receipt names its member
instead of glossing how it got there. The module is cited for what removed it, never offered as the
answer. Every remaining miss in this cell is one of these.

### g-b1-neg-11 — the case the whole lever was evidenced on

> which functions are not exported

Before: nothing in the index matches that (functions). Try "which functions are exported" for that
branch on its own.

After: no functions match that. The index has 1 function, but it is exported. Try "which functions
are exported" for that branch on its own.

The verdict was always right: fnAlpha is the only function and d/handler.mjs re-exports it, so the
empty set is the ground truth. The sentence that reported it is what the judge scored 0 for
honesty on both arms of 5.0.42. It now states the population it holds and the fact that empties the
question.

### g-c1-rel-4 — a membership hop

> functions defined in the module that imports app/lib/a.mjs

Before: nothing in the index matches that (functions).

After: no functions match that. 3 modules import app/lib/a.mjs, but none of them has any functions.
Try "which modules import app/lib/a.mjs" for that branch on its own.

### g-b1-disc-13 — a follow-up filter over the previous answer

> which of those are tested

Before: nothing in the index matches that (modules).

After: no modules match that. 2 modules matched that far (app/lib/a.mjs and app/lib/f.mjs), but none
of them is tested.

The set this filter emptied is the previous answer, not the index, and the line now says so by
naming its members.

### g-a2-svo-41 — an owner with no members

> public methods of Base

Before: nothing in the index matches that (methods).

After: Base has no methods in this index.

### g-c1-cond-2 — a first clause that held nothing

> if a module imports scripts/g.mjs, is it tested

Before: nothing in the index matches that (modules).

After: no module in this index imports scripts/g.mjs.

Nothing imports scripts/g.mjs, so the qualifier never got a set to reject and there is no held
branch to name. The clause itself is the answer, and it is a much narrower claim than the line it
replaces.

### the branch a receipt offers has to answer — fixture probe, no pool case

> which modules import app/lib/b.mjs → app/functions/d/handler.mjs.
> which modules define Widget → app/lib/b.mjs.
> which classes inherit from Base → Widget.
> which modules are imported by app/lib/f.mjs → app/lib/e.mjs.

A receipt that named an unsupported phrasing would trade one dead end for another. Every branch the
receipt offers is built from the clause the parser already compiled, and a lane test round-trips
them.
