# BENCHMARK_CEFR_ENGLISH_5.0.41 — lever round: the negation-scope filter

**Headline: A2 negation judges at 1.988 / 2, up from 1.667, and its four standing hard fails all
clear. `g-c1-neg-rel-19` goes from a wrong answer to the right one, judged 0.000 to 2.000. Across
the four judged cells the mean goes 1.827 to 1.940 and hard fails 9 to 2. Tier-1 over the whole
1,075-case pool holds at 1073/1075 with nothing regressed, and documented weaknesses now passing go
36 to 40.**

This is a lever cycle. It applies levers 4 and 5 from `reports/BENCHMARK_CEFR_ENGLISH_5.0.40.md`'s
decision log as one round, because they are the same defect seen from two sides: the complement was
taken over the wrong set. The measurement follows the 5.0.36 to 5.0.40 pattern — a judged census of
the affected cells at N=2 with the delta-judge, raw and answer-identity-controlled views, and the
free tier-1 replay over the whole pool on both arms as the regression guard.

## Run profile

- lever: the negation-scope filter (`src/domain/ask.mjs`)
- base commit: `ff863113`; lever commit `e5dc2df8`
- judged cells: `A2:negation` (25), `B1:negation` (25), `C1:negation+relative-embedded` (25) and
  `B2:coordination-compositional` (50) from `test-benchmarks/chatbench/graded-pool-max.jsonl` — the
  full census of each. The last two are in scope because changed answers reach them.
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case, concurrency
  12, delta-judged against a scratch copy of `verdict-cache.json` per arm, both copies taken from
  the same committed snapshot, so the committed cache is untouched
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.41/` (gitignored by design) —
  `fullpool-base/`, `fullpool-after/`, `cells-base/`, `cells-after/`, `judged-base/`,
  `judged-after/`
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-10 03:46 UTC to 04:05 UTC. The product replays are free and fast
  (all 1,075 in 4.3 s); the rest is the judge fan-out, 74 fresh cases on the base arm and 91 on the
  lever arm.
- Analysis and write-up: 2026-08-10 04:05 UTC to 04:35 UTC.
- Smoke before the run: `test:fast` 222/222; tools + adapters + corpus + games + domain + bench +
  estate 6,346/6,353 (7 skipped); `printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 in a
  graph-less temp dir and against a fixture graph.

## What the failures actually showed

Five cases, three different scope questions, one root.

| case | question | expected | answered at the base |
|---|---|---|---|
| g-a2-neg-3 | untested methods | a miss | Widget.render(). |
| g-a2-neg-14 | uncovered methods | a miss | Widget.render(). |
| g-a2-neg-24 | which methods are not tested | a miss | Widget.render(). |
| g-b1-neg-9 | how many methods are not tested | 0 methods | 1 method. |
| g-a2-neg-4 | classes inheriting from Base but not tested | a miss | nothing in the index matches that (classes). Try "who touched …" |
| g-c1-neg-rel-19 | modules importing the module that defines fnAlpha but not tested | c.mjs, e.mjs | b.mjs, c.mjs and e.mjs. |

**The complement's universe was too big.** `tests` edges are recorded module to module, so a symbol
is covered when the module it lives in is. Which module that is came from the `defines` edge alone.
A method belongs to its class, not to a module's top-level scope, so `Widget.render` carries a
source site and no defines edge — and an individual with no resolvable module read as "not tested"
rather than as outside the question. Every method therefore sat in every complement, and "untested
methods" named the one method in the fixture, whose module is tested. The same read put every
Commit in the complement too.

**The negation attached to the wrong head.** "modules importing the module that defines fnAlpha but
not tested" is about the importers. The reduced-relative parse swallowed "but not tested" into the
embedded clause, where it filtered the definer instead — a set of one that survives the filter, so
the exclusion silently did nothing and all three importers came back including the tested one.
`g-c1-neg-rel-5` had the same shape at two hops and answered one module too many. The explicit
pronoun order ("modules **that import** … and tested") already split its branches at the matrix
head and already answered correctly, so the two orders were one reading and two parses.

**The receipt had nothing to say when a negation emptied a set.** The 5.0.39 round taught an empty
composition to name the branch that held, but only for the positive polarity. `g-a2-neg-4`'s
verdict was already right and its recovery line pointed at "who touched", which has nothing to do
with the question.

## The scope rule

**Which head.** A trailing branch of bare qualifier adjectives after a relative clause restricts the
matrix head. It lifts out of the relative clause as an ordinary boolean atom, which is the shape the
`named <X>` round gave a branch, so `and` narrows and `but not` excludes with no further machinery.
Only adjectives lift: a trailing branch carrying a verb of its own is a second predicate on the
embedded head and stays where it was written. The reading is the one the fronted adjective spells
out — `g-c1-neg-rel-19` and `g-c1-neg-rel-20` are the same question in the two orders, and the pool
gives them the same answer.

**Which universe.** The coverage pivot for an individual is the module it lives in: the `defines`
edge first, the recorded source site second. An individual the index places in no module at all is
outside the coverage question at both polarities, the way a test module already was. So a Commit is
neither tested nor untested, and "who touched the module that defines fnAlpha but not tested" misses
honestly instead of listing every commit.

**What the receipt may claim.** A negated qualifier that empties a clause now names the entities the
clause held, and the sentence states only what is proven. A difference may name the qualifier only
where every held member really satisfies it — a member the qualifier does not apply to at either
polarity leaves by the same door, and calling it tested would be a guess about a fact nothing
records. An intersection's members are proven to fail the filter, so the sentence negates it, except
where the filter is already a negative adjective and every held member carries the positive one: "but
it is tested" replaces the double negative "but it is not untested". A one-member set keeps the
preposition its plural neighbour carries, so it reads "1 class inherits from Base".

The pivot walk and the receipt's checks read only the fact set, so they give the same answer
whichever order the individuals arrive in.

## Judged movement, per cell

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| A2 negation | 25 | 1.667 | 1.988 | +0.322 | 4 | 0 |
| B1 negation | 25 | 1.787 | 1.897 | +0.110 | 3 | 1 |
| C1 negation+relative-embedded | 25 | 1.823 | 1.933 | +0.110 | 1 | 0 |
| B2 coordination-compositional | 50 | 1.930 | 1.940 | +0.010 | 1 | 1 |
| all four | 125 | 1.827 | 1.940 | +0.112 | 9 | 2 |

**Answer-identity-controlled view.** 104 of the 125 answers are byte-identical across the arms, and
they score 1.933 against 1.940 — a delta of 0.007, which is the instrument, not the lever. Three of
those 104 moved individually on unchanged text: `g-b1-neg-12` scored 0.500 then 1.250, `g-b2-coord-7`
2.000 then 1.834, `g-b2-coord-10` 1.834 then 2.000. Restricted to the 21 cases whose answers actually
changed, the mean goes **1.306 to 1.939**. That is where this round's claim sits.

The same control applies to the hard-fail count. Seven of the nine cleared, but one of the seven —
`g-b1-neg-12`, "which modules do not define anything" — has a byte-identical answer that matches the
pool's expectation exactly on both arms, so its base hard fail was the judge, not the product. Six
cleared on a changed answer.

The 21 cases that moved:

| case | cell | base | lever |
|---|---|--:|--:|
| g-a2-neg-3 | A2 negation | 0.000 | 2.000 |
| g-a2-neg-4 | A2 negation | 0.000 | 2.000 |
| g-a2-neg-14 | A2 negation | 0.000 | 2.000 |
| g-a2-neg-24 | A2 negation | 0.000 | 1.875 |
| g-b1-neg-9 | B1 negation | 0.000 | 2.000 |
| g-c1-neg-rel-19 | C1 negation+relative-embedded | 0.000 | 2.000 |
| g-c1-neg-rel-5 | C1 negation+relative-embedded | 1.250 | 2.000 |
| g-a2-neg-21 | A2 negation | 1.667 | 2.000 |
| g-b2-coord-19 | B2 coordination-compositional | 1.667 | 2.000 |
| g-c1-neg-rel-6 | C1 negation+relative-embedded | 1.667 | 1.834 |
| g-c1-neg-rel-22 | C1 negation+relative-embedded | 1.667 | 1.834 |
| g-b2-coord-8 | B2 coordination-compositional | 1.834 | 2.000 |
| g-c1-neg-rel-9 | C1 negation+relative-embedded | 1.834 | 1.667 |
| g-c1-neg-rel-16 | C1 negation+relative-embedded | 1.834 | 1.667 |
| g-a2-neg-19 | A2 negation | 2.000 | 1.834 |
| g-a2-neg-16 | A2 negation | 2.000 | 2.000 |
| g-c1-neg-rel-3 | C1 negation+relative-embedded | 2.000 | 2.000 |
| g-c1-neg-rel-13 | C1 negation+relative-embedded | 2.000 | 2.000 |
| g-c1-neg-rel-17 | C1 negation+relative-embedded | 2.000 | 2.000 |
| g-c1-neg-rel-18 | C1 negation+relative-embedded | 2.000 | 2.000 |
| g-c1-neg-rel-24 | C1 negation+relative-embedded | 2.000 | 2.000 |

Nine of the eleven C1 rows are cases whose verdict never changed. What changed is the receipt line,
from `composite(reverseSet)` to `composite(boolean)`, because the question really is a filter over
the importers. Five scored identically, two gained 0.167 and two lost it — the noise band the
verdict cache leaves.

Two hard fails remain, both carried from the base arm and both byte-identical across it.
`g-b2-coord-4` is one of the pool's two standing tier-1 failures. `g-b1-neg-11`, "which functions are
not exported", answers the right empty set under a recovery line about commits.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1073 / 1075 | 1073 / 1075 |
| documented weaknesses now passing | 36 | 40 |

`g-a2-neg-3`, `g-a2-neg-14`, `g-a2-neg-24` and `g-b1-neg-9` join the documented-weaknesses-now-passing
list, so their expectations are enforced from here on. The two tier-1 failures left are
`g-b2-coord-4` and `g-c1-presup-4`, the same two both arms carry.

Diffing the two arms' `product.jsonl` case for case, 21 of the 1,075 answers changed and nothing that
passed at the base fails on the lever.

Cell green-rates that moved, and these are the only ones that moved anywhere in the pool:

| cell | base | lever |
|---|--:|--:|
| A2 negation | 22 / 25 | 25 / 25 |
| B1 negation | 24 / 25 | 25 / 25 |

`C1:negation+relative-embedded` reads 25/25 on both arms. Its two wrong answers passed tier-1 because
their pins are `answeredIdsInclude` and `answerMatch`, which a superset satisfies — the extra module
was only ever visible to the judge, which had the exact ground truth in its context and scored
`g-c1-neg-rel-19` at 0.000.

## Predictions vs actuals

| prediction | actual |
|---|---|
| the four A2 negation hard fails clear, since three are the same wrong-universe complement | held: all four, 0.000 to 2.000, 2.000, 1.875 and 2.000 |
| `g-c1-neg-rel-19` excludes the tested importer | held: 0.000 to 2.000, and `g-c1-neg-rel-5` came with it at two hops |
| the trailing-qualifier lift and the fronted adjective agree on every case in the cell | held, pinned by two lane tests and a corpus row |
| the cell mean rises less than the conditional round's, since three of the four fails are one defect | missed in direction: A2 negation moves +0.322 against that round's +0.625, but the census of four cells moves +0.112 on 125 cases |
| no other cell moves | missed: the receipt reaches B1 negation and B2 coordination-compositional. Both were measured in full; the net is +0.110 and +0.010 |
| a coverage question the index cannot ground refuses rather than answering the universe | held: a commit is now neither tested nor untested, pinned by a lane test and a corpus row |

## Pins

- `test/tools/ask-combo.test.mjs` — 8 lane tests against the committed fixture: the trailing
  qualifier restricting the matrix head beside its fronted paraphrase, the lift at two hops and under
  an intersection, a branch with its own verb staying inside the relative clause, the refusal when the
  exclusion empties the chain, the complement's universe at method grain and over a commit, a symbol
  still reading its defining module's coverage, the grain note, the held-branch receipt, and a
  negation over a clause nothing satisfied keeping the plain message.
- `test/tools/ask.test.mjs` — the coverage-grain pin is replaced by the receipt the same query now
  produces: "1 function calls loadStore, but it is tested", with no double negative.
- `test/corpus/games/compositional.jsonl` — 3 rows against `examples/mini-webapp`, keys
  `games.compositional.negation-scope` and `negation-scope-miss`. One pins the chain against its
  fronted paraphrase, one pins the complement's universe at method grain and over a commit, and one
  pins the held-branch receipt.

## Instrument notes

Both carried from earlier rounds, both still open.

**The verdict-cache partition** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md`). The committed cache
covered 51 of the 125 cases on the base arm and 34 on the lever arm, so about 40 cases were judged
fresh on both arms independently, twice over. Three of them landed up to 0.75 apart on text that
never changed, and one of those crossed the hard-fail line. This round is large enough that the noise
does not decide it — the controlled view moves +0.633 on the changed answers against +0.007 on the
unchanged ones — but the hard-fail count needed the same control applied by hand to stay honest, and
a smaller lever would not survive it. Judging both arms against one shared snapshot by construction
is still the fix.

**The judge context asserts what the pool denies** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`).
`run.mjs`'s `FIXTURE_CONTEXT` calls "touched by 2 commit(s)" truthful for `app/lib/a.mjs` while the
pool's own expectation is `^1 commit\.$`. Untouched here: rewriting it moves
`FIXTURE_CONTEXT_VERSION` and re-judges the pool, which is a re-baseline run rather than a lever
round.

Decision rule (§1): the four-cell census is up by 0.112, every affected cell's mean is up, the
hard-fail count is down from 9 to 2, and no previously-passing case regressed on any judged cell or
across the full 1,075-case tier-1 replay. **PASS.**

## Decision log — ranked next levers

1. **C2 pronoun-binding** (13/25 green, 12 frontier). The largest frontier block left outside the
   cells waiting on a capability, and no round in this arc has looked at it. It needs a diagnosis pass
   before it can be ranked on evidence rather than on size.
2. **B2 assert-recall** (16/25 green, 9 frontier). Its performance-vs-production band gap is 0.64, the
   widest in the pool, which says the capability is there and something in the production path is not
   reaching it.
3. **`g-b1-neg-11`**, "which functions are not exported" — the last hard fail this round's cells carry
   that is a product line rather than judge noise. The verdict is the right empty set; the recovery
   points at commits. The same held-branch receipt this round extended would cover it once an
   `exported` complement can say what it checked.
4. **A composition receipt that names an emptied branch beyond the single-qualifier shape.** This
   round widened it to the negative polarity; an intersection of two clauses, a difference of two
   clause sets, and a multi-step fold still fall back to "nothing in the index matches that". Every
   miss in `C1:negation+relative-embedded` is one of those, so the cell's floor is this receipt.
   Carrying the intermediate through `evalBoolean` covers all of them.
5. **`g-b2-coord-4` and `g-c1-presup-4`**, the only two tier-1 failures left in the pool. Two cases in
   two unrelated cells, so this is two small levers rather than one.
6. **Instrument: judge both arms against one verdict-cache snapshot**, above. Two rounds in a row have
   now had to hand-control for it, and this one had a hard fail flip on unchanged text.
7. **Instrument: the judge context's commit-count paragraph**, above. A re-baseline run rather than a
   lever round, since it re-judges the pool.
8. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

## Evidence / transcripts

Discriminating cases first.

### g-c1-neg-rel-19 — judged 0.000 to 2.000

> modules importing the module that defines fnAlpha but not tested

Before: app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.

After: app/lib/c.mjs and app/lib/e.mjs.

Three modules import a.mjs, where fnAlpha is defined. b.test.mjs covers b.mjs, so b.mjs is the one the
exclusion is for. The receipt also changes, from `composite(reverseSet)` to `composite(boolean)` —
the question is a filter over the importers, and now it compiles to one.

### g-c1-neg-rel-5 — judged 1.250 to 2.000

> modules importing something that imports app/lib/a.mjs but not tested

Before: app/functions/d/handler.mjs and app/lib/f.mjs.

After: app/lib/f.mjs.

The same shape at two hops. d/handler.mjs is covered by b.test.mjs. Tier-1 passed this on both arms:
its pins name f.mjs, and a superset satisfies them.

### g-a2-neg-3 — judged 0.000 to 2.000

> untested methods

Before: Widget.render().

After: nothing in the index matches that (methods). This index records tests edges module to module,
so a method counts as covered exactly when the module it lives in is tested — ask about that module to
see the coverage itself.

Widget.render lives in b.mjs, which is tested. The method carries a source site and no defines edge,
so the pivot never resolved and the complement kept it. `g-a2-neg-14` ("uncovered methods") and
`g-a2-neg-24` ("which methods are not tested") are the same defect in two more phrasings, and all
three scored 0.000 at the base — a confident wrong answer is the shape the rubric scores lowest.

### g-b1-neg-9 — judged 0.000 to 2.000

> how many methods are not tested

Before: 1 method.

After: 0 methods.

The count over the same complement. Its expectation `^0 methods\.$` has been in the pool as a
documented weakness since the case was written.

### g-a2-neg-4 — judged 0.000 to 2.000

> classes inheriting from Base but not tested

Before: nothing in the index matches that (classes). Try "who touched \<a module that actually has
commits\>" or "/describe \<module\>" to see what's in the index.

After: 1 class inherits from Base, but it is tested. Try "which classes inherit from Base" for that
branch on its own.

The verdict never changed — both are an honest empty, which is the ground truth. What changed is that
the answer says which branch emptied it and where to look next.

### g-a2-neg-21 — judged 1.667 to 2.000

> modules importing app/lib/b.mjs but not tested

Before: nothing in the index matches that (modules). Try "who touched …"

After: 1 module imports app/lib/b.mjs, but it is tested. Try "which modules import app/lib/b.mjs" for
that branch on its own.

The same receipt over a plain relation clause. `g-b2-coord-8` and `g-b2-coord-19` are the same
sentence in another cell, which is how a round scoped to negation reached
`B2:coordination-compositional`.

### a commit is neither tested nor untested — fixture probe, no pool case

> who touched the module that defines fnAlpha but not tested
>
> → nothing in the index matches that. Try "who touched \<a module that actually has commits\>" or
> "/describe \<module\>" to see what's in the index.

Before the round this listed every commit in the index. Nothing places a commit in a module, so the
coverage question does not reach it at either polarity — the same exclusion a test module already had.

### a branch with its own verb stays put — fixture probe, no pool case

> modules importing the module that defines fnAlpha but not importing app/lib/f.mjs
>
> → app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.

Only adjectives lift. This trailing branch carries a verb, so it reads as a second predicate and the
chain answers unchanged.
