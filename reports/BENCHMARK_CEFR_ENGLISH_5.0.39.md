# BENCHMARK_CEFR_ENGLISH_5.0.39 — lever round: the conditional-question lane

**Headline: C1 conditional judges at 1.907 / 2, up from 1.282 at the base commit. Hard fails 4 to
1. The cell's tier-1 green rate goes 15/25 to 25/25 — every documented weakness it carried now
passes — and tier-1 over the whole 1,075-case pool holds at 1073/1075 with nothing regressed.**

This is a lever cycle. It applies lever 1 from `reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`'s decision
log: the conditional-question lane, the largest frontier block left outside the cells that are
waiting on a capability. The measurement follows the 5.0.36, 5.0.37 and 5.0.38 pattern — a judged
census of the affected cells at N=2 with the delta-judge, both raw and answer-identity-controlled
views, and the free tier-1 replay over the whole pool on both arms as the regression guard.

## Run profile

- lever: the conditional lane (`src/domain/interpret/normalize.mjs`, `src/domain/ask.mjs`,
  `src/domain/codegraph.mjs`, plus one call site in `src/services/chat.mjs`)
- base commit: `6fc16c8a`; lever commits `37a9470e` and `c5e64e93`
- judged cells: `C1:conditional` (25), `A2:negation` (25) and
  `B2:coordination-compositional` (50) from `test-benchmarks/chatbench/graded-pool-max.jsonl` — the
  full census of each. The second and third are in scope because the empty-composition receipt
  reaches them; the round's own diagnosis was confined to the first.
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case, concurrency
  12, delta-judged against a scratch copy of `verdict-cache.json` per arm, both copies taken from
  the same committed snapshot, so the committed cache is untouched
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.39/` (gitignored by design) —
  `fullpool-base/`, `fullpool-after/`, `cells-base/`, `cells-after/`, `judged-cells-base/`,
  `judged-cells-after/`, plus the first-pass `cell-*`/`judged-*` pair
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-10 02:00 UTC to 02:45 UTC. The product replays are free and fast
  (all 1,075 in 4.4 s); the rest is the judge fan-out, 48 fresh cases on the base arm and 69 on the
  lever arm.
- Analysis and write-up: 2026-08-10 02:45 UTC to 03:15 UTC.
- Smoke before the run: `test:fast` 222/222; tools + adapters + estate + bench + corpus 5,794/5,794;
  `printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 in a graph-less temp dir and against
  the `examples/mini-webapp` fixture graph.

## What the failures actually showed

Ten of the cell's twenty-five cases failed at the base, and they split three ways.

| case | question | answered at the base |
|---|---|---|
| g-c1-cond-5 | what would break if app/functions/d/handler.mjs were removed | couldn't parse this as a graph question. |
| g-c1-cond-10 | what would break if app/lib/b.mjs were removed | couldn't parse this as a graph question. |
| g-c1-cond-15 | what would break if app/lib/c.mjs were removed | couldn't parse this as a graph question. |
| g-c1-cond-23 | what would break if app/lib/f.mjs were removed | couldn't parse this as a graph question. |
| g-c1-cond-24 | what would break if app/lib/a.mjs were removed | couldn't parse this as a graph question. |
| g-c1-cond-1 | if a module imports app/lib/a.mjs, has it got tests | app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs. |
| g-c1-cond-8 | if a module imports app/lib/f.mjs, has it got tests | app/lib/e.mjs. |
| g-c1-cond-18 | if a module imports app/lib/e.mjs, has it got tests | app/lib/f.mjs. |
| g-c1-cond-25 | if Widget were deleted, what would break | No modules found whose module directly imports Widget. |
| g-c1-cond-11 / 12 / 20 | if app/lib/e.mjs (or f.mjs) were deleted, what would break | the other half of the import cycle only |

**Five never parsed.** English puts a conditional either way round, and only the fronted order was
recognized. "what would break if X were removed" fell all the way through to the generic wall.

**Three answered a question nobody asked.** "has it got tests" was swallowed into the entity term —
the receipt read `reverse(imports, entityType=Module, "app/lib/f.mjs has it got tests")` — so the
consequent was dropped and every importer came back, tested or not. `g-c1-cond-8` and
`g-c1-cond-18` are the sharpest form: the ground truth is an empty result, and the answer named a
module. A confident wrong answer is the shape the rubric scores below an honest miss, and the judge
scored both under 0.3.

**Two read a class as if something imported it.** "if Widget were deleted, what would break"
compiled to "which modules transitively import Widget". Nothing imports a class, so the question
could only miss.

## The lane's grammar

**It accepts three frames, and nothing else.**

1. **The donkey conditional** — `if a/the <kind> <relation-verb> <object>, <consequent>`, where the
   consequent is one of three closed phrasings: "is/are it \<qualifier\>", "has/have it got
   \<noun\>", "does/do it have \<noun\>". It compiles to `<kinds> <gerund> <object> and
   <qualifier>`. Every end is table-validated: an unrecognized kind, verb, qualifier or noun leaves
   the sentence untransformed rather than risking a wrong composition. "has it got tests" and "does
   it have tests" ask what "is it tested" asks, and the graph answers all three off the same tests
   edge, so they now share one frame.
2. **The counterfactual deletion**, either clause order — `if X was/were deleted/removed, what
   would break` and `what would break if X was/were deleted/removed`. Both resolve to the same
   subject through one helper, so the two orders cannot drift.
3. **The counterfactual's reading follows what its subject is.** A module or a symbol reads the
   reverse dependency closure: what breaks is what imports or calls it. A class has no importers,
   so it reads the subclass closure instead — deleting a base class breaks what inherits from it.
   That closure follows the same by-name reading of an unresolved `ext:<Name>` base the direct
   reverse traversal already uses, and it retires the "transitive modifier isn't supported for
   inherits" capability gap: "which classes transitively inherit from X" now walks the real
   hierarchy as a question in its own right.

**It refuses everything else, and says what it can read instead.** The index records what is, so
the one hypothetical world it can evaluate is a deletion — the edges that would break are edges it
already holds. A rename, a speed, a test nobody wrote: nothing in the fact set decides those. At
the base, "if fnAlpha were renamed, would the tests still pass" compiled to a tests question about
a term called "fnAlpha renamed" and answered "couldn't resolve one of the terms" under a receipt
that misdescribed the question. It now says:

> I can't answer that — the index records what is, not what would be. What it can read about
> fnAlpha: "what would break if fnAlpha were deleted" (what calls it), or "/describe fnAlpha" for
> the facts it holds.

The refusal fires only on a subject the **code** graph holds — a module or file, or a symbol some
module contains. An unknown term keeps the ordinary wall ("if the moon were made of cheese, what
would break" is unchanged), and a taught memory subject is never answered with code-graph advice.
That gate is what keeps the refusal from being a new way to guess.

Two adjacent defects sit inside the same cell and are folded into the same round.

1. **An import cycle was invisible to the closure.** `app/lib/e.mjs` imports `app/lib/f.mjs` and
   `f.mjs` imports `e.mjs`, so `e.mjs` is genuinely inside its own reverse closure — but
   `bfsLevels` seeds `visited` with the start node, and the return edge was never walked. The
   return is now placed one level below the shallowest dependent that carries it, and the edge is
   picked in `via` order, so the answer stays a pure function of the fact set. It is scoped to the
   closure reading: an impact **report** lists the other work a change reaches, and the module
   being changed is not other work. Both readings are pinned, and each receipt says which walk it
   made — see the instrument note on the two case sets below.
2. **A closure question that came back empty said "directly".** "No modules found whose module
   **directly** imports X" understated a walk that had gone transitively. It now says transitively
   when it went transitively.

Finally, the lane's own honest miss was its remaining floor, and the second commit fixes it. "1
module imports app/lib/f.mjs, but it is not tested. Try "which modules import app/lib/f.mjs" for
that branch on its own." replaces a blanket "nothing in the index matches that (modules)" beside an
unrelated "who touched" recovery. A clause nothing satisfied keeps the plain message, because there
is no held branch to name; the coverage-grain note keeps precedence over both, because a grain the
graph records nothing at cannot be reported as a filter that rejected anything.

## Judged movement, per cell

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| C1 conditional | 25 | 1.282 | 1.907 | +0.625 | 4 | 1 |
| A2 negation | 25 | 1.660 | 1.667 | +0.007 | 4 | 4 |
| B2 coordination-compositional | 50 | 1.940 | 1.940 | +0.000 | 0 | 0 |
| all three | 100 | 1.705 | 1.863 | +0.158 | 8 | 5 |

The raw and answer-identity-controlled views are the same number this round: twenty of the hundred
cases scored differently across the arms, and every one of them had a changed answer. No case whose
answer text was byte-identical scored differently, so there is nothing for the control to subtract.

The twenty cases that moved:

| case | cell | base | lever |
|---|---|--:|--:|
| g-c1-cond-1 | C1 conditional | 0.000 | 2.000 |
| g-c1-cond-8 | C1 conditional | 0.167 | 2.000 |
| g-c1-cond-25 | C1 conditional | 0.250 | 1.834 |
| g-c1-cond-21 | C1 conditional | 0.500 | 2.000 |
| g-c1-cond-9 | C1 conditional | 0.500 | 1.667 |
| g-c1-cond-24 | C1 conditional | 0.875 | 2.000 |
| g-c1-cond-12 | C1 conditional | 1.000 | 2.000 |
| g-c1-cond-11 | C1 conditional | 1.167 | 2.000 |
| g-c1-cond-23 | C1 conditional | 1.250 | 2.000 |
| g-c1-cond-18 | C1 conditional | 0.292 | 1.000 |
| g-c1-cond-20 | C1 conditional | 1.333 | 2.000 |
| g-c1-cond-15 | C1 conditional | 1.375 | 2.000 |
| g-c1-cond-10 | C1 conditional | 1.500 | 2.000 |
| g-c1-cond-13 | C1 conditional | 1.500 | 2.000 |
| g-c1-cond-5 | C1 conditional | 1.500 | 2.000 |
| g-c1-cond-3 | C1 conditional | 1.667 | 1.834 |
| g-c1-cond-7 | C1 conditional | 1.667 | 1.834 |
| g-a2-neg-16 | A2 negation | 1.834 | 2.000 |
| g-b2-coord-10 | B2 coordination-compositional | 1.834 | 2.000 |
| g-b2-coord-7 | B2 coordination-compositional | 2.000 | 1.834 |

Five hard fails remain on the lever arm. Four are in A2 negation (`g-a2-neg-3`, `-4`, `-14`, `-24`),
byte-identical in both arms and untouched by this round. The fifth is `g-c1-cond-18`, and it is an
instrument disagreement — see below.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1073 / 1075 | 1073 / 1075 |
| documented weaknesses now passing | 25 | 35 |

The two tier-1 failures left are `g-b2-coord-4` and `g-c1-presup-4`, the same two both arms carry.
Nothing that passed at the base fails on the lever, checked case-for-case against the base
`product.jsonl`. Twenty-two answers changed across the whole pool: the sixteen in this cell, plus
`g-a2-neg-16`, `g-a2-neg-19`, `g-b2-coord-7`, `g-b2-coord-10` from the empty-composition receipt,
and `g-c1-cond-13` and `g-c1-cond-21` from the same.

Cell green-rates that moved, and this is the only one that moved anywhere in the pool:

| cell | base | lever |
|---|--:|--:|
| C1 conditional | 15 / 25 | 25 / 25 |

All ten of the cell's documented weaknesses join the improved list — `g-c1-cond-8`, `-10`, `-11`,
`-12`, `-15`, `-18`, `-20`, `-23`, `-24`, `-25` — so their expectations are enforced from here on.

## Predictions vs actuals

| prediction | actual |
|---|---|
| the postposed clause order is the largest single block, and clearing it moves five cases | held: all five parse, four of them to a real answer and one to the honest empty its ground truth asks for |
| the "has it got tests" cases stop naming a module, and an honest miss alone raises the cell | held, and better than predicted: `g-c1-cond-1` answers correctly rather than missing, and `g-c1-cond-8` clears from 0.167 to 2.000 |
| the class counterfactual needs its own closure | held: `g-c1-cond-25` reads Widget's subclasses, `g-c1-cond-9` refuses on a leaf class, and the transitive-inherits capability gap closes as a side effect |
| a hypothetical the graph cannot evaluate refuses without guessing | held, pinned by two lane tests and a corpus row; no pool case uses the phrasing, so the judge does not measure it |
| no other cell moves | missed: the empty-composition receipt reaches A2 negation and B2 coordination-compositional. Both were re-measured in full; the net is +0.007 and +0.000 |
| the cell's floor after the round is the honest miss's own wording | held, and it was worth fixing inside the round: the four cases whose ground truth is an empty result scored the rephrase dimension 0 to 1.5 at the base, and three of them reach 2.000 with a receipt that names the branch that held |

## Pins

- `test/tools/ask-combo.test.mjs` — 11 lane tests against the committed fixture: both word orders
  reading the same closure, the class counterfactual and its leaf-class refusal, the import cycle,
  a module nothing depends on, the three qualifier phrasings agreeing, a consequent no importer
  satisfies, the speculative refusal and its two shapes, an unknown subject keeping the ordinary
  wall, the empty composition naming the branch that held, a clause nothing satisfied keeping the
  plain message, and the impact report and the dependency closure reading a cycle differently on
  purpose.
- `test/tools/ask.test.mjs` — the pin asserting that transitive+inherits is an honest "not
  supported" miss is replaced by the real subclass closure it now walks, over a purpose-built
  three-level hierarchy so the transitive answer reaches a grandchild the direct one never names.
- `test/corpus/games/compositional.jsonl` — 6 rows against `examples/mini-webapp`, keys
  `games.compositional.conditional` and `conditional-miss`. Three pin answers (both clause orders,
  the subclass closure beside a leaf class, the consequent filtering the antecedent set) and three
  pin refusals (the unevaluable hypothetical, an antecedent no member satisfies, and the empty
  composition naming its held branch beside a clause that held nothing).

## Instrument notes

**The same answer to the same ground truth scored 1.000 and 2.000.** `g-c1-cond-18` and
`g-c1-cond-21` are the same question in two phrasings ("has it got tests" / "is it tested"), they
carry the same judge context, and on the lever arm they produce byte-identical answers. Both of
`g-c1-cond-18`'s draws scored correctness 0 and honesty 0; both of `g-c1-cond-21`'s scored 2.
`g-c1-cond-8`, which carries the same four-dimension rubric as `-18` and the same answer shape,
also scored 2. The cell's true movement is understated by roughly one case's worth, and the round's
one remaining hard fail is this disagreement rather than a product defect.

**The delta-judge cache re-draws what it does not inherit.** The conditional cell was judged twice
on the base arm during this round — once alone, once inside the three-cell census — and read 1.288
and 1.282 on the same 25 answers, because the six cases with no cache entry got two independent
draws. The reported numbers are the second pass, where both arms come from the same pair of runs.
Judging both arms against one shared snapshot by construction is still the fix, and it is still
open (carried from `reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md` and `_5.0.38.md`).

**Two committed case sets disagree about the same graph.** The agentbench ladder's
`ab-b2-cond-e-untested-impact` states that "the e<->f import cycle folds to the single dependent";
the graded pool's `g-c1-cond-11`, `-12` and `-20` state that the seed is in its own closure. Both
are right about their own question — one asks for an impact report, the other for a dependency
closure — so the closure carries the return and the report does not, and each receipt says which
walk it made. Neither case set was edited.

**Carried, not fixed: the judge context asserts what the pool denies** on `g-b2-count-temp-1`
(`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`). Fixing it changes `FIXTURE_CONTEXT_VERSION` and voids
every cached verdict in the pool, so it stays out of a round measuring against that cache.

Decision rule (§1): the affected cell's mean is up by 0.625, the three-cell census is up by 0.158,
the hard-fail count is down from 8 to 5, and no previously-passing case regressed on any judged
cell or across the full 1,075-case tier-1 replay. **PASS.**

## Decision log — ranked next levers

1. **C2 pronoun-binding** (13/25 green, 12 frontier). The largest frontier block left outside the
   cells waiting on a capability, and no round in this arc has looked at it. It needs a diagnosis
   pass before it can be ranked on evidence rather than on size.
2. **B2 assert-recall** (16/25 green, 9 frontier). The second-largest block, and its
   performance-vs-production band gap is 0.64 — the widest in the pool — which says the capability
   is there and something in the production path is not reaching it.
3. **A2 negation's four standing hard fails** (`g-a2-neg-3`, `-4`, `-14`, `-24`). They survived this
   round untouched with byte-identical answers, and they are the only hard fails left in the three
   cells this round measured.
4. **C1 ellipsis** (20/25 green, 5 frontier, band gap 0.36) and **A2 naming-vocabulary** (20/25, 5
   frontier, band gap 0.64). Two mid-sized blocks with wide band gaps, same shape of question as
   item 2.
5. **A composition receipt that names an emptied branch beyond the single-qualifier shape.** This
   round's version handles a seed clause plus one qualifier — the shape a conditional compiles to.
   An intersection of two clauses, a difference, and a multi-step fold still fall back to "nothing
   in the index matches that". Carrying the intermediate through `evalBoolean` rather than
   re-evaluating the seed would cover all of them; it touches every composite lane and every miss
   text pinned against them, which is why it is its own piece of work rather than a fold-in here.
6. **`g-b2-coord-4` and `g-c1-presup-4`**, the only two tier-1 failures left in the pool. Two cases
   in two unrelated cells, so this is two small levers rather than one.
7. **Instrument: the judge context's commit-count paragraph**, above. Worth doing on its own, as a
   re-baseline rather than a lever round, since it re-judges the pool.
8. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

## Evidence / transcripts

Discriminating cases first.

### g-c1-cond-8 — judged 0.167 to 2.000

> if a module imports app/lib/f.mjs, has it got tests

Before: app/lib/e.mjs.

After: 1 module imports app/lib/f.mjs, but it is not tested. Try "which modules import
app/lib/f.mjs" for that branch on its own.

The worst shape in the cell. "has it got tests" was read as part of the entity name, so the
consequent vanished and the answer named the one module the question was asking about. Its ground
truth is an empty result: e.mjs imports f.mjs and nothing covers e.mjs.

### g-c1-cond-1 — judged 0.000 to 2.000

> if a module imports app/lib/a.mjs, has it got tests

Before: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.

After: app/lib/b.mjs.

The same dropped consequent with a non-empty answer behind it. Three modules import a.mjs; one of
them is tested.

### g-c1-cond-24 — judged 0.875 to 2.000

> what would break if app/lib/a.mjs were removed

Before: couldn't parse this as a graph question. Try: "which modules import \<name\>" …

After: hypothetically, if app/lib/a.mjs were removed: app/lib/b.mjs and app/lib/c.mjs and
app/lib/e.mjs and scripts/g.mjs and app/functions/d/handler.mjs and app/lib/f.mjs.

The if-clause last. The fronted twin of this question, `g-c1-cond-4`, was already answering
correctly — the two orders were one reading and one parse.

### g-c1-cond-25 — judged 0.250 to 1.834

> if Widget were deleted, what would break

Before: No modules found whose module directly imports Widget.

After: hypothetically, if Widget were removed: in app/lib/c.mjs there is Button.

Nothing imports a class. The subclass closure is what the question was asking for, and Button
extends Widget.

### g-c1-cond-9 — judged 0.500 to 1.667

> if Button were deleted, what would break

Before: No modules found whose module directly imports Button.

After: No classes found whose module transitively inherits Button.

The verdict was already right and the receipt was about the wrong relation. Button is a leaf class,
so nothing inherits from it, and the miss now says which walk came back empty.

### g-c1-cond-11 — judged 1.167 to 2.000

> if app/lib/e.mjs were deleted, what would break

Before: hypothetically, if app/lib/e.mjs were removed: app/lib/f.mjs.

After: hypothetically, if app/lib/e.mjs were removed: app/lib/f.mjs and app/lib/e.mjs.

e.mjs and f.mjs import each other, so e.mjs reaches itself. The closure walked the return edge and
never reported it.

### g-c1-cond-21 — judged 0.500 to 2.000

> if a module imports app/lib/e.mjs, is it tested

Before: nothing in the index matches that (modules). Try "who touched \<a module that actually has
commits\>" or "/describe \<module\>" to see what's in the index.

After: 1 module imports app/lib/e.mjs, but it is not tested. Try "which modules import
app/lib/e.mjs" for that branch on its own.

The verdict never changed — both are an honest empty. What changed is that the answer now says
which of the two branches emptied it and where to look next, and the judge's rephrase score goes 0
to 2.

### if fnAlpha were renamed, would the tests still pass — fixture probe, no pool case

Before: couldn't resolve one of the terms in this question. … Canonical: does "fnAlpha renamed"
tests "pass"? — ask(tests, subject="fnAlpha renamed", "pass")

After: I can't answer that — the index records what is, not what would be. What it can read about
fnAlpha: "what would break if fnAlpha were deleted" (what calls it), or "/describe fnAlpha" for the
facts it holds.

The grammar had reached for the nearest predicate it could see and built a tests question out of a
rename. Both answers are misses; only the second one is about the question that was asked.

### if the moon were made of cheese, what would break — fixture probe, no pool case

> couldn't parse this as a graph question. Try: "which modules import \<name\>" or "what calls
> \<name\>". Type /help for all query shapes.

Unchanged, and deliberately. The refusal above is grounded in an entity the code graph holds; a
subject it has never heard of is an ordinary unknown term, and answering it with code-graph advice
would be a new way to guess.
