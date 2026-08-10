# BENCHMARK_CEFR_ENGLISH_5.0.37 — lever round: converse verb readings

**Headline: the two affected cells judge at 1.851 / 2, up from 1.768 at the base commit. Hard fails
5 to 1. Five case answers changed, all five upward, and no answer anywhere in the 1,075-case pool
regressed.**

This is a lever cycle. It applies lever 1 from `reports/BENCHMARK_CEFR_ENGLISH_5.0.36.md`'s decision
log: a verb phrase that states a relation from its object's side compiled to a forward traversal, so
the answer came back as the mirror of the question asked. "belongs to" had no reading at all. The
measurement follows the 5.0.36 pattern, a targeted judged cell re-measure plus the free tier-1
replay over the whole pool as the regression guard.

## Run profile

- lever: converse verb readings (`src/domain/ask-vocab.mjs`, both interpret strategies, `src/domain/ask.mjs`)
- base commit: `834301af`; lever commit `a9ecc17a`
- judged cells: `C2:relative-embedded` (25) and `A2:svo-query` (50) from
  `test-benchmarks/chatbench/graded-pool-max.jsonl` — the full census of both
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case,
  concurrency 12, delta-judged against a scratch copy of `verdict-cache.json` so the committed
  cache is untouched
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.37/` (gitignored by design) —
  `product-after/`, `judged-base/`, `judged-after/`, `fullpool-after/`
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-10 00:58 UTC to 01:16 UTC. The product replays are free and fast
  (75 rows in under a second, all 1,075 in 4.3 s); the rest is the judge fan-out, 48 fresh cases on
  the base arm and 53 on the lever arm.
- Analysis and write-up: 2026-08-10 01:16 UTC to 01:45 UTC.
- Smoke before the run: `test:fast` 222/222; ask + adapters + estate 3,939/3,939; corpus 921/921.

## The lever

`CONVERSE_VERBS` (`src/domain/ask-vocab.mjs`) names every verb phrase that states its relation
backwards, and `readConverse` turns a built parse round: the two named roles swap in the yes/no
shape, and a set question changes direction while keeping its asked kind filter. Both parse
strategies hand their parse through it, so one table serves the anchored grammar and keyword-spot
alike. The `inherits` reverse phrasings ("is a superclass of") were already swapping in the yes/no
shape only; they now flip in the set shapes too, which is why "which classes are a superclass of
Button" answers Widget instead of listing Button's subclasses.

"belongs to" and "belong to" join `RELATIONS.contains.verbs`. They had no entry, so every question
carrying them refused.

The placement phrasings keep their forward reading. A taught locative fact stores the located thing
as its subject ("ann lives in paris" is `ann mgx:life-in paris`), so "live in" and "sit inside" mean
the direction they already had, and a converse entry would invert every taught placement answer.
"define" is no placement verb, so "is defined in" sits in the converse table.

Two more direction bugs turned up while checking the first, and are folded into the same round.

1. **A module-grain membership question never reached the site fallback.** The `defines` hop already
   read a symbol's recorded source site when the index carried no edge. `contains` did not, so
   "which module contains Widget.render" answered nothing while the where-lane placed it in
   app/lib/b.mjs. Both membership relations now share that hop.
2. **A passive participle with a prepositional complement was read as active SVO.** "is Widget
   defined in app/lib/b.mjs" named its agent after the preposition, and the parse made Widget the
   subject, answering a confident "No" to a true statement. `REDUCED_RELATIVE_CLAUSES` already
   curates which participle-plus-preposition bigrams read that way, so the fix consults the table
   that exists rather than adding one. No pool case uses this phrasing, so the fix is pinned by
   lane tests and a corpus row and is unmeasured by the judge.

## Judged movement, per cell

Five of the 75 judged answers changed. The judge scored four unchanged answers differently across
the two arms, which is the delta-judge cache's own partition showing through: a case judged fresh on
one arm and inherited on the other gets two independent draws. The second table holds those cases at
their base score, so what is left is the movement the product actually caused.

Raw, every case scored on its own arm's draw:

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| A2 svo-query | 50 | 1.754 | 1.878 | +0.124 | 4 | 1 |
| C2 relative-embedded | 25 | 1.797 | 1.797 | +0.000 | 1 | 0 |
| both cells | 75 | 1.768 | 1.851 | +0.083 | 5 | 1 |

Answer-identity controlled, a byte-identical answer keeping its base score:

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| A2 svo-query | 50 | 1.754 | 1.872 | +0.118 | 4 | 1 |
| C2 relative-embedded | 25 | 1.797 | 1.895 | +0.098 | 1 | 0 |
| both cells | 75 | 1.768 | 1.880 | +0.111 | 5 | 1 |

The five cases that moved:

| case | cell | base | lever |
|---|---|--:|--:|
| g-a2-svo-25 | A2 svo-query | 0.000 | 2.000 |
| g-a2-svo-37 | A2 svo-query | 0.000 | 2.000 |
| g-a2-svo-14 | A2 svo-query | 0.125 | 2.000 |
| g-c2-rel-5 | C2 relative-embedded | 0.375 | 2.000 |
| g-c2-rel-22 | C2 relative-embedded | 0.667 | 1.500 |

Four of the five were hard fails at the base. The one hard fail left is `g-a2-svo-3`, whose answer
is byte-identical in both arms: "which classes does app/lib/a.mjs define" reports no defines edges,
and the judge scores that 0 on both.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1066 / 1075 | 1066 / 1075 |
| documented weaknesses now passing | 19 | 23 |

The nine tier-1 failures are the same nine cases in both arms: seven in the
`quantifier-counting+temporal` cell, plus `g-b2-coord-4` and `g-c1-presup-4`. Nothing that passed at
the base fails on the lever.

Cell green-rates that moved, and only these moved:

| cell | base | lever |
|---|--:|--:|
| A2 svo-query | 46 / 50 | 49 / 50 |
| C2 relative-embedded | 23 / 25 | 24 / 25 |

## Predictions vs actuals

| prediction | actual |
|---|---|
| the two remaining 5.0.36 hard fails clear | half held: `g-c2-rel-5` cleared. `g-c1-neg-rel-19` is not a converse case, and it still answers app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs where the tested importer b.mjs should be excluded |
| C2 relative-embedded moves | held on the controlled view, +0.098; the raw view reads +0.000 because judge noise on four unchanged answers cancels it |
| no other cell moves | missed in the good direction: A2 svo-query gained three cases through the shared module-membership hop |
| a verb with no converse entry stays a refusal | held: "is owned by" and "report to" still miss, pinned by a lane test and a corpus row |

## Pins

- `test/tools/ask-combo.test.mjs` — 8 lane tests against the committed fixture: the chain hop
  through "belongs to", the yes/no role swap, a set question changing direction, the
  reverse-inherits phrasings, the module-grain site fallback, the passive prepositional agent, the
  placement verb keeping its forward reading, and a relation with no converse staying an honest
  miss. The 5.0.36 pin asserting that "belongs to" refuses is replaced by the positive reading it
  now has.
- `test/corpus/games/compositional.jsonl` — 4 rows against `examples/mini-webapp`, keys
  `games.compositional.converse-verb` and `converse-verb-miss`. One pins the chain hop, one the
  direction flip beside its untouched forward phrasing, one the passive prepositional agent, and one
  a refusal. The existing `relative-chain-miss` row moves to "is owned by", a phrase with no
  converse entry.

## Decision log — ranked next levers

1. **The temporal window boundary in commit counting** (B2 quantifier-counting+temporal). Seven of
   the pool's nine tier-1 failures sit in this one cell, all off by the window edge. It is now the
   largest single cluster left and nothing else competes on size.
2. **Conditional-question lane** (C1 conditional, 15/25 green with 10 frontier). "if a module
   imports app/lib/f.mjs, has it got tests" still answers a bare module name. A confident wrong
   answer is the worst rubric shape; an honest miss alone would raise the cell.
3. **A `named <X>` qualifier** (`g-c2-rel-17`, `g-c2-rel-25`). "the module that is covered by X and
   named Y" needs a name-equality filter inside a boolean branch. Both cases still refuse to
   compile, and they are the last two frontier rows in C2 relative-embedded.
4. **A negation-scope filter for "do not define anything"** (B1/B2 negation). The complement is taken
   over the wrong set. Small, self-contained, two cells carry it.
5. **`g-c1-neg-rel-19`** (C1 negation+relative-embedded). "modules importing the module that defines
   fnAlpha but not tested" answers b, c and e; the tested importer b.mjs should be excluded, so the
   "but not tested" branch is filtering the wrong set. It passes tier-1 on its answerMatch pins and
   fails the judge, which is why it survived the 5.0.36 round.
6. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

Instrument note: the delta-judge cache produced two independent draws for four cases whose answer
text never changed, worth ±0.9 on a single case's mean. Judging both arms against the same cache
snapshot would remove it. Until then, a cell's raw mean can move on judge noise alone, and the
answer-identity control above is what separates the two.

Decision rule (§1): the mean is up on both cells under the answer-identity control and up overall
raw, and no previously-passing case regressed across the full 1,075-case tier-1 replay. **PASS.**

## Evidence / transcripts

Discriminating cases first.

### g-c2-rel-5 — C2 relative-embedded, judged 0.375 to 2.000

> which tests cover the module that defines the class that Widget.render belongs to

Before: couldn't compile this compositional question (inner clause didn't parse). …

After: app/unit-tests/b.test.mjs.

The chain shape was already supported end to end after 5.0.36. "belongs to" was the one hop with no
reading, so the whole question refused. It now reads Widget.render's containing class, that class's
defining module, and the tests covering it.

### g-a2-svo-25 — A2 svo-query, judged 0.000 to 2.000

> which module contains Widget.render

Before: No modules found whose module directly contains Widget.render. Try "who touched \<a module
that actually has commits\>" …

After: app/lib/b.mjs.

The index writes no module-side contains edge for a method. The where-lane already placed
Widget.render in app/lib/b.mjs off its recorded site, and the membership question now reads the same
site.

### g-a2-svo-37 — A2 svo-query, judged 0.000 to 2.000

> which module contains register

Before: No modules found whose module directly contains register. …

After: app/lib/b.mjs.

Same fix over a function rather than a method.

### g-c2-rel-22 — C2 relative-embedded, judged 0.667 to 1.500

> which commit touched the module that defines the class that Widget.render belongs to

Before: couldn't compile this compositional question (inner clause didn't parse). …

After: nothing in the index matches that (commits). Try "who touched \<a module that actually has
commits\>" …

The case's ground truth is an empty result: no commit entity touches app/lib/b.mjs at module grain.
The chain now resolves and the answer is an empty set with a receipt, where before the question
never compiled.

### is Widget defined in app/lib/b.mjs — fixture probe, no pool case

Before: No — no defines edge found from Widget to app/lib/b.mjs.

After: Yes — defines edge from app/lib/b.mjs to Widget.

A true statement got a confident "No". The participle's agent sits after "in", so the sentence's
leading term is the relation's object. No graded case uses this phrasing, so the lane test and the
corpus row are the only measurement of it.

### which classes are a superclass of Button — fixture probe, no pool case

Before: No classes found whose module directly inherits Button. …

After: Widget.

The reverse-inherits verbs swapped roles in the yes/no shape and nowhere else, so the set form
answered Button's subclasses. It answers Button's base class now.
