# BENCHMARK_CEFR_ENGLISH_5.0.40 — lever round: a `named <X>` qualifier inside a boolean branch

**Headline: the two frontier rows in C2 relative-embedded both compile. `g-c2-rel-17` goes from a
refusal to the right answer, judged 1.375 to 2.000. The cell judges at 1.907 / 2, up from 1.882.
Exactly two answers changed across the whole 1,075-case pool, and nothing regressed.**

This is a lever cycle. It applies lever 3 from `reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`'s decision
log: a name-equality filter inside a boolean branch. The measurement follows the 5.0.36, 5.0.37 and
5.0.38 pattern — a judged census of the affected cell plus the free tier-1 replay over the whole
pool as the regression guard.

## Run profile

- lever: a `named <X>` qualifier inside a boolean branch (`src/domain/ask.mjs`)
- base commit: `6fc16c8a`
- judged cell: `C2:relative-embedded` (25) from `test-benchmarks/chatbench/graded-pool-max.jsonl` —
  the full census
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case,
  concurrency 12, delta-judged against a scratch copy of `verdict-cache.json` per arm so the
  committed cache is untouched
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.39/` (gitignored by design) —
  `fullpool-base/`, `fullpool-after/`, `judged-base/`, `judged-after/`
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-10 03:02 UTC to 03:10 UTC. The product replays are free and fast
  (all 1,075 in 4.4 s); the rest is the judge fan-out, 21 fresh cases on each arm.
- Analysis and write-up: 2026-08-10 03:10 UTC to 03:35 UTC.
- Smoke before the run: `test:fast` 222/222; ask tier 207/207; `printf 'hi\n/exit\n' |
  node bin/tmct.mjs` greets and exits 0 in a graph-less dir.

## What the failures actually showed

Both cases ask the same shape over the same fixture. `app/unit-tests/b.test.mjs` covers two modules,
`app/lib/b.mjs` and `app/functions/d/handler.mjs`, and the `named` clause says which of the two the
question is about.

| case | question | expected | answered |
|---|---|---|---|
| g-c2-rel-17 | which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named app/lib/b.mjs | Widget | couldn't compile this compositional question |
| g-c2-rel-25 | … and named app/functions/d/handler.mjs | a miss (that module defines no class) | couldn't compile this compositional question |

The reason is one line of the boolean-branch loop. A branch with no verb of its own borrows the
previous branch's verb, which is how "importing X or Y" lets the second branch inherit "importing".
Here the previous branch is "is covered by app/unit-tests/b.test.mjs", so `named app/lib/b.mjs`
became "covered by named app/lib/b.mjs" and stopped parsing. The same borrowing over a plainer
branch gave a worse shape: "which modules import app/lib/a.mjs and named app/lib/b.mjs" compiled to
a reverse `imports` clause whose object was the literal string "named app/lib/b.mjs", and answered
an empty set with full confidence in the parse.

## The qualifier

Inside a boolean or relative predicate, a branch that reads `named <X>` is an identity filter on
that branch's own set: keep the members whose name is X. It is an ordinary set atom, so the existing
boolean fold does the rest — `and` narrows to the named entity, `but not` excludes it, and a
relative chain around it composes unchanged.

Four rules keep it closed:

- **The name is matched exactly.** An exact label, an exact id, or — for a module — the same path
  once normalized. No substring, prose or fuzzy tier runs. A name filter that near-matched would
  hand back a confident answer about a neighbouring entity.
- **The kind comes from the branch's own subject.** "the module … named Widget" looks for a module
  called Widget, and the fixture has a class by that name and no module.
- **An unknown name refuses.** The filter is checked against the graph before the query is
  evaluated, anywhere in the AST. Without that check the intersection would simply come out empty
  and the answer would read "nothing in the index matches that (classes)" about a module that does
  not exist. It now says `no module named "app/lib/zebra.mjs" in this index.` Where the index does
  hold that name under another kind, the refusal says so: `"register" names a variable here, not a
  module.`
- **`called` needs a copula.** "called" also spells the passive of the `calls` verb, so it reads as
  a name only after a copula has declared a predicate adjective ("and **is** called X"). "named"
  carries no second reading and needs no copula. A branch reading "called by X" is never claimed.

The check for an unresolvable name walks the whole AST and reads only the fact set, so it gives the
same answer whichever order the individuals arrive in.

## Judged movement

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| C2 relative-embedded | 25 | 1.882 | 1.907 | +0.025 | 0 | 0 |

The cell had no hard fails left at the base — the 5.0.36 and 5.0.37 rounds cleared them — so this
round is worth a fraction of what those were. The two cases it owns:

| case | base | lever |
|---|--:|--:|
| g-c2-rel-17 | 1.375 | 2.000 |
| g-c2-rel-25 | 1.667 | 1.667 |

`g-c2-rel-17` clears outright: correctness 0.5 to 2, honesty 1 to 2. `g-c2-rel-25` moved from one
refusal to a different one. Both are misses, which is the ground truth, and the judge scored the two
within noise of each other (honesty 2.0 against 1.5, on independently drawn samples). The new
refusal is the better one on its own terms — it comes from a compiled question over a resolved
module, not from a parser that gave up — but the rubric has no dimension that separates them.

**Answer-identity-controlled view.** 23 of the 25 answers are byte-identical across the arms. Their
mean is 1.913 on both arms. Two of those 23 moved individually and cancelled: `g-c2-rel-22` scored
1.834 then 2.000, `g-c2-rel-9` scored 2.000 then 1.834, both on unchanged text. That is the
verdict-cache instrument note below, showing itself in miniature. Restricted to the two cases whose
answers actually changed, the mean goes 1.521 to 1.833.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1073 / 1075 | 1073 / 1075 |
| documented weaknesses now passing | 25 | 26 |

`g-c2-rel-17` joins the documented-weaknesses-now-passing list, so its expectation is enforced from
here on. The two tier-1 failures left are `g-b2-coord-4` and `g-c1-presup-4`, the same two both arms
carried.

No cell's green rate moved. Diffing the two arms' `product.jsonl` case for case, exactly two of the
1,075 answers changed — `g-c2-rel-17` and `g-c2-rel-25` — and nothing that passed at the base fails
on the lever.

## Predictions vs actuals

| prediction | actual |
|---|---|
| both frontier rows compile and `g-c2-rel-17` answers Widget | held |
| the cell mean rises by less than the prior rounds, since the cell has no hard fails left to clear | held: +0.025, against +0.638, +0.362 and +0.590 |
| nothing else in the pool moves, since the shape appears in two cases | held: exactly two answers changed across 1,075 |
| an unknown name refuses rather than emptying the set | held, pinned by three lane tests and a corpus row |
| `g-c2-rel-25` scores higher on a compiled refusal than on a parse failure | missed: the mean is identical. Both are honest misses and the rubric does not separate them |

## Pins

- `test/tools/ask-combo.test.mjs` — 5 lane tests against the committed fixture: the filter picking
  one member of a two-member covered set, the exact-match refusal on an unknown name, the
  wrong-kind refusal naming what it found instead, composition with `and` and `but not`, and
  `called` staying the passive `calls` verb without a copula.
- `test/corpus/games/compositional.jsonl` — 3 rows against `examples/mini-webapp`, keys
  `games.compositional.named-filter` and `named-filter-miss`. One picks between the three modules
  `test/tasks.test.mjs` covers, one runs the filter through both boolean ops, and one pins the two
  refusals.

## Instrument notes

Both carried from earlier rounds, both still open.

**The verdict-cache partition** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md`). The committed cache
holds a verdict for only 4 of this cell's 25 cases, so 21 cases were judged fresh on each arm —
independently, twice over. Two of them landed 0.166 apart on text that never changed. The cell's
raw delta of +0.025 is therefore about the size of the instrument's own noise, which is why the
answer-identity-controlled view above carries the round's claim instead. Judging both arms against
one shared snapshot by construction is still the fix.

**The judge context asserts what the pool denies** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`).
`run.mjs`'s `FIXTURE_CONTEXT` calls "touched by 2 commit(s)" truthful for `app/lib/a.mjs` while the
pool's own expectation is `^1 commit\.$`. Untouched here: rewriting it moves
`FIXTURE_CONTEXT_VERSION` and re-judges the pool, which is a re-baseline run rather than a lever
round.

Decision rule (§1): the cell mean is up, the hard-fail count is unchanged at 0, and no
previously-passing case regressed on the judged cell or across the full 1,075-case tier-1 replay.
**PASS.**

## Decision log — ranked next levers

1. **Conditional-question lane** (C1 conditional, 15/25 green with 10 frontier). "If a module
   imports app/lib/f.mjs, has it got tests" still answers a bare module name. A confident wrong
   answer is the worst rubric shape, and an honest miss alone would raise the cell.
2. **C2 pronoun-binding** (13/25 green, 12 frontier). The largest frontier block outside the
   capability-waiting cells, and no round in this arc has looked at it. It needs a diagnosis pass
   before it can be ranked properly against the conditional lane.
3. **B2 assert-recall** (16/25 green, 9 frontier). Third-largest block, and its perf-vs-prod gap of
   0.64 says the harness and the product disagree about it more than any other measured cell —
   worth a look at which of the two is wrong before treating it as product work.
4. **A negation-scope filter for "do not define anything"** (B1/B2 negation). The complement is
   taken over the wrong set. Small, self-contained, two cells carry it.
5. **`g-c1-neg-rel-19`** (C1 negation+relative-embedded). "Modules importing the module that defines
   fnAlpha but not tested" answers b, c and e; the tested importer b.mjs should be excluded, so the
   "but not tested" branch filters the wrong set. It passes tier-1 on its answerMatch pins and fails
   the judge.
6. **`g-b2-coord-4` and `g-c1-presup-4`**, the only two tier-1 failures left in the pool. Two cases
   in two unrelated cells, so this is two small levers rather than one.
7. **Instrument: judge both arms against one verdict-cache snapshot**, above. This round is the
   clearest case yet for doing it — the noise it leaves is the same size as the signal a small
   lever produces.
8. **Instrument: the judge context's commit-count paragraph**, above. A re-baseline run rather than
   a lever round, since it re-judges the pool.
9. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

## Evidence / transcripts

Discriminating cases first.

### g-c2-rel-17 — judged 1.375 to 2.000

> which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named
> app/lib/b.mjs

Before: couldn't compile this compositional question (a clause in the combination didn't parse). …

After: Widget.

The test module covers b.mjs and d/handler.mjs. The name picks b.mjs, and Widget is the class sited
there.

### g-c2-rel-25 — judged 1.667 to 1.667

> which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named
> app/functions/d/handler.mjs

Before: couldn't compile this compositional question (a clause in the combination didn't parse). …

After: nothing in the index matches that (classes). Try "who touched \<a module that actually has
commits\>" or "/describe \<module\>" to see what's in the index.

The same sentence with the other covered module named. d/handler.mjs defines no class, so the empty
answer is the ground truth. The parse now reaches it instead of refusing at the gate.

### an unknown name — fixture probe, no pool case

> which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named
> app/lib/zebra.mjs
>
> → no module named "app/lib/zebra.mjs" in this index.

The cheap way to make the filter work would let this fall out as an empty intersection and report
"nothing in the index matches that (classes)", which reads as a fact about b.test.mjs's coverage
rather than about a module that was never there.

### a name the index holds under another kind — fixture probe, no pool case

> which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named
> register
>
> → no module named "register" in this index. "register" names a variable here, not a module.

`register` is a global variable in the fixture. The filter takes its kind from the branch's subject,
so it looks for a module and finds none, and the refusal says which kind does carry the name.

### the boolean ops — mini-webapp probe, no pool case

> which modules import src/core/model.mjs and named src/core/store.mjs → src/core/store.mjs.
> which modules import src/core/model.mjs but not named src/core/store.mjs → src/core/validate.mjs,
> src/handlers/tasks.mjs and src/handlers/users.mjs.

The filter is an ordinary set atom, so `but not` differences it out with no extra machinery.

### `called` without a copula — fixture probe, no pool case

> which modules import app/lib/a.mjs and are called app/lib/b.mjs → app/lib/b.mjs.
> which functions are called by Widget.render → fnAlpha.

"called" is the passive of a real verb in this vocabulary. The copula is what separates the two
readings, so the second query is untouched.
