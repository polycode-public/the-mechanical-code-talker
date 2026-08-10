# BENCHMARK_CEFR_ENGLISH_5.0.36 — lever round: relative-embedded chain resolution

**Headline: the affected cells judge at 1.792 / 2, up from 1.430 at the base commit. Hard fails
16 to 2. No pass-to-fail regression, on the cells or on the full pool.**

This is a lever cycle, not a re-baseline. It applies lever 1 from
`reports/BENCHMARK_CEFR_ENGLISH_5.0.25.md`'s decision log, the top-ranked one: resolve a relative
clause to real entities before the outer question runs. The measurement is a targeted cell
re-measure rather than another full-pool judged pass. The 5.0.25 dual-draw run cost about 50
minutes of judge fan-out, and the skill's §1 makes the grade x construction cell mean the
comparable cross-cycle statistic, so this round judges the three cells the lever can reach and
guards everything else with the free tier-1 replay over the whole pool.

## Run profile

- lever: relative-embedded chain resolution (`src/domain/ask.mjs`)
- base commit: `80ca2533`; lever commits `e93530cd` and `0d96d32a`
- judged cells: `C1:relative-embedded`, `C1:negation+relative-embedded`, `C2:relative-embedded`
  from `test-benchmarks/chatbench/graded-pool-max.jsonl` (75 cases, the full census of all three)
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case,
  concurrency 12, delta-judged against a scratch copy of `verdict-cache.json` (the committed cache
  is untouched — a 75-case run would have rewritten it down from 635 entries)
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.36/` (gitignored by design) —
  `product-base/`, `product-after/`, `judged-base/`, `judged-after/`, `fullpool-base/`,
  `fullpool-after/`
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-09 23:51 UTC to 2026-08-10 00:27 UTC. The product replays are
  free and fast (75 rows in about 0.5 s, all 1,075 in 4.3 s); the rest is the judge fan-out,
  29 fresh cases on the base arm and 43 on the lever arm.
- Analysis and write-up: 2026-08-10 00:27 UTC to 01:05 UTC.
- Smoke before the run: `test:fast` 222/222; `printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and
  exits 0.

## The lever

Five places resolved a relative clause too late, or not at all. Each is a closed-set change; none
of them adds a general parser.

1. **The `defines` hop reads a symbol's recorded site.** The fixture sites `Button` at
   `app/lib/c.mjs:1-10` and `Widget.render` at `app/lib/b.mjs:5-9` but writes no `defines` edge for
   either. The where-lane already answered "Button is defined in app/lib/c.mjs" off that site, so
   the `defines` hop contradicted it and every chain through "the module that defines X" went
   empty. It now falls back to the site when no edge covers the symbol, per object rather than per
   set.
2. **cochange got its symmetry flip over a set.** `traverse` already flipped subject and object for
   the symmetric `cochange` edge on the flat path. `reverseOverSet` did not, so the composed form
   of the same question answered nothing.
3. **"where is \<relative clause\> defined" resolves the clause first.** It used to hand the whole
   clause to the term resolver as one string, which fuzzy-matched the wordiest name inside it and
   printed a confident five-way ambiguity list about the wrong entities.
4. **A membership owner that is a relative clause resolves as a set.** "list functions in the
   module that imports app/lib/a.mjs" answered `fnAlpha()` — the free-text resolve landed on
   `a.mjs`, the name sitting inside the clause. The honest answer is empty: the importers are
   `b`, `c` and `e`, and none of them defines a function.
5. **A relative clause can sit in the outer verb's subject slot.** "the class that the class that
   inherits from Widget inherits from" leaves the verb dangling with no object. A tight gate claims
   it: the text must end with a whole relation verb phrase and carry a relative pronoun before it.
   A lone "defined in" reduced relative now routes to membership too, which `parseStackedReducedRelative`
   never covered (it needs two such bigrams on one head noun).

The membership fix uncovered the mirror of the first one, folded into the same round: a module
carries `defines` edges for the classes it declares but not always for their methods, so "methods
in app/lib/b.mjs" read empty while the where-lane placed `Widget.render` in exactly that module.
`membershipOwnSet` now falls back to the symbols a module sites, which puts the flat and the
composed form on the same answer.

## Judged movement, per cell

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| C1 relative-embedded | 25 | 1.350 | 1.797 | +0.447 | 6 | 0 |
| C2 relative-embedded | 25 | 1.117 | 1.755 | +0.638 | 9 | 1 |
| C1 negation+relative-embedded | 25 | 1.823 | 1.823 | +0.000 | 1 | 1 |
| all three | 75 | 1.430 | 1.792 | +0.362 | 16 | 2 |

The negation cell is the control. It shares the construction family and sat above the floor
already, and the lever left it byte-identical, which is what an attributable change looks like.

Seventeen cases moved by 0.25 or more, all upward. Eleven went from a judged 0 or near-0 to a
judged 2. The two hard fails left are `g-c2-rel-5`, blocked on "belongs to", and
`g-c1-neg-rel-19`, unmoved from the base.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1066 / 1075 | 1066 / 1075 |
| documented weaknesses now passing | 11 | 19 |

The nine tier-1 failures are the same nine cases in both arms: seven in the
`quantifier-counting+temporal` cell (the window-boundary lever, ranked 4 in the 5.0.25 log), plus
`g-b2-coord-4` and `g-c1-presup-4`. Nothing that passed at the base fails on the lever.

Cell green-rates that moved, and only these moved:

| cell | base | lever |
|---|--:|--:|
| C2 relative-embedded | 15 / 25 | 23 / 25 |
| C1 relative-embedded | 22 / 25 | 25 / 25 |
| B2 relative-embedded | 48 / 50 | 50 / 50 |
| A2 quantifier-counting | 21 / 25 | 22 / 25 |

Eight cases outside the judged cells improved as a side effect of the site-backed membership
fallback: `g-b2-rel-6`, `g-b2-rel-10`, `g-a2-count-3` and five `C2:garden-path` cases.

## Predictions vs actuals

| prediction | actual |
|---|---|
| C1 and C2 relative-embedded both move, since one lever serves both | held: +0.447 and +0.638 |
| the largest hard-fail cluster in the 5.0.25 run clears | held: 15 of the 16 cell hard fails cleared |
| the sibling negation cell stays put, so the movement is attributable | held: identical mean, identical hard-fail count |
| no other cell moves | missed in the good direction: three more cells improved through the shared membership primitive, none went down |

## Pins

- `test/tools/ask-combo.test.mjs` — 8 lane tests against the committed fixture: the site-backed
  defines hop flat and chained, cochange symmetry over a set, the dangling-verb subject relative,
  the membership owner as a set, the where-over-a-clause lane, and two that must stay honest
  misses.
- `test/corpus/games/compositional.jsonl` — 6 rows against `examples/mini-webapp`, keys
  `games.compositional.relative-chain`, `relative-chain-miss`, `where-relative` and
  `where-relative-miss`. Two of the six pin a refusal, one of them checking that no module name
  leaks into the miss text.

## Decision log — ranked next levers

1. **Converse verb readings** (`C2:relative-embedded`, `g-c2-rel-5`). "belongs to" has no reading
   at all, and "is part of" / "lives in" are registered as plain `contains` verbs, so they compile
   to a forward traversal when they mean the reverse. One converse table plus its wiring in the
   clause parsers. This is verb-direction semantics rather than chain resolution, which is why it
   stayed out of this round: folding it in would have blurred what the measured delta belongs to.
2. **Conditional-question lane** (C1 conditional, unchanged at 15/25 green with 10 frontier).
   "if a module imports app/lib/f.mjs, has it got tests" still answers a bare module name. A
   confident wrong answer is the worst rubric shape; an honest miss alone would raise the cell.
3. **The temporal window boundary in commit counting** (B2 quantifier-counting+temporal). Seven of
   the pool's nine tier-1 failures sit in this one cell, all off by the window edge.
4. **A negation-scope filter for "do not define anything"** (B1/B2 negation). The complement is
   taken over the wrong set. Small, self-contained, two cells carry it.
5. **A `named <X>` qualifier** (`g-c2-rel-17`). "the module that is covered by X and named Y" needs
   a name-equality filter inside a boolean branch. The chain around it now resolves; only this
   filter is missing.
6. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

Instrument note: the 5.0.25 run marked `C2:relative-embedded` UNDER-COVERED at a 5-case sample
(draw A 1/5 vs draw B 3/5). This round judged all 25 of that cell, so the number above is a census,
not a sample, and the cell is measured rather than excluded.

Decision rule (§1): the mean is up on both moved cells and no previously-passing case regressed, on
the judged cells or across the full 1,075-case tier-1 replay. **PASS.**

## Evidence / transcripts

Discriminating cases first.

### g-c2-rel-4 — C2 relative-embedded, judged 0.000 to 2.000

> what imports the module that defines the method that calls fnAlpha

Before: nothing in the index matches that. Try "who touched \<a module that actually has
commits\>" …

After: app/functions/d/handler.mjs.

The three-hop chain: the method that calls fnAlpha is Widget.render, sited in app/lib/b.mjs,
and app/functions/d/handler.mjs imports it. The middle hop is the one that needed the site.

### g-c2-rel-14 — C2 relative-embedded, judged 0.125 to 2.000

> where is the class that inherits from Widget defined

Before: this could mean more than one thing: 1) as where "the class that inherits from Widget":
"the class that inherits from Widget" matches more than one module ambiguously — did you mean
Widget, Widget.render, Widget.name, Class and inherits? … 1) Widget: Widget is defined in
app/lib/b.mjs at lines 1-30. …

After: Button is defined in app/lib/c.mjs at lines 1-10.

The old answer is the shape the rubric punishes hardest: five confident locations, none of them
the answer, and the real one absent.

### g-c1-rel-9 — C1 relative-embedded, judged 0.000 to 0.500

> list functions in the module that imports app/lib/a.mjs

Before: fnAlpha().

After: no functions in this index.

The ground truth is an empty result. The old answer read the clause as one term, landed on
a.mjs, and listed what a.mjs defines. The judge still scores the new answer low for its thin
rephrase hint, and that is fair, but it is a miss instead of a fabrication.

### g-c1-rel-4 — C1 relative-embedded, judged 0.000 to 2.000

> functions defined in the module that imports app/lib/a.mjs

Before: No — no imports edge found from Module to app/lib/a.mjs.

After: nothing in the index matches that (functions). …

Same ground truth, an empty result. The old answer inverted the chain and then said "No" to a
list question.

### g-c2-rel-11 — C2 relative-embedded, judged 0.000 to 2.000

> which module defines the class that the class that inherits from Widget inherits from

Before: nothing in the index matches that (modules). …

After: app/lib/b.mjs.

Button inherits Widget, Widget is defined in app/lib/b.mjs. The inner relative sits in the
subject slot with "inherits from" dangling.

### g-c2-rel-20 — C2 relative-embedded, judged 0.000 to 2.000

> which modules cochange with the module that defines the function that Widget.render calls

Before: nothing in the index matches that (modules). …

After: app/lib/b.mjs and app/lib/c.mjs.

Two fixes at once: the site-backed defines hop reaches app/lib/a.mjs, then the symmetric
cochange scan finds the partners the flat query had always found.

### g-c2-rel-5 — C2 relative-embedded, judged 0.083 to 0.083

> which tests cover the module that defines the class that Widget.render belongs to

Before and after: couldn't compile this compositional question (inner clause didn't parse). …

The one cell hard fail left. The chain shape is now supported end to end; "belongs to" is not a
verb this vocabulary reads, so the query refuses rather than guessing. Lever 1 in the decision log.
