# BENCHMARK_CEFR_ENGLISH_5.0.25 — dual-draw run against the full pool

**Headline: judged mean 1.78 / 2 over draw A (225 cases), 11 hard fails, 0 voided samples.**
Draw B's 95 unique cases judge at 1.712 / 2 with 3 hard fails. Across the 320 distinct judged
cases the weighted mean is 1.76 / 2 with 14 hard fails. Tier-1 (deterministic expectations):
draw A 224/225, draw B 224/225 — one counting miss in each draw, both in the same
quantifier-counting+temporal cell.

This is a **measurement run, not a lever cycle**: the higher-confidence dual-draw profile
against the full `graded-pool-max.jsonl` (1,075 cases), run to re-baseline 5.0.25 before a
batch of plan work lands. No product change was applied between this run and 5.0.25's HEAD
(6cea893e). The prediction going in: the go-to profile's picture (a clean floor through B2,
frontier at C1/C2 discourse and embedding) holds at full-pool coverage. It did, with one
instrument finding and two product findings the decision log ranks.

## Run profile

- pool: `test-benchmarks/chatbench/graded-pool-max.jsonl` (1,075 cases)
- sampling: stratified dual draw, fraction 0.1 (cell floor 5, census cells in full),
  seeds A 3693117961 / B 3693117962, stamp `5.0.25`
- draws: A 225 cases, B 225 cases; 130 rows shared (the census cells, identical by
  construction, judged once via draw A), 95 unique to B
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=3 samples per case,
  concurrency 12; refusals/format failures would void, and none occurred
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.25/` (gitignored by design;
  `product-a.jsonl`, `product-b.jsonl`, `agreement.json`, `summary.json`, `judged-b/`,
  `timings.json` all on disk at write-up time)

## Timing

- Benchmarking session: 2026-08-08, 17:49 UTC → 18:42 UTC (product replay 2.1 s wall for both
  draws — 450 rows, mean 16.7 ms/row; the rest is the judge fan-out, 675 + 285 calls)
- Analysis and write-up: 2026-08-08, 18:42 UTC → 19:00 UTC
- Smoke before the run: `test:fast` 220/220 green; CLI greet-and-exit pipes pass in a
  graph-less temp dir and a fixture-graph dir (exit 0 both)

## Best examples

Three transcripts from this run's perfect-scoring cases, the demo reel first:

**Three-turn discourse anaphora over a result set** (`g-b2-disc-2`, B2 discourse-reference) —
list, filter the listed set, then count the filtered set, all through "those":

> list the classes → Base, Widget and Button.
> which of those are tested → Widget.
> how many of those → 1 class.

**Teach then count through the taught subsumption** (`g-b2-assert-17`, B2 assert-recall):

> every method is a artifact → noted — remembered 1 fact: method rdfs:subClassOf artifact
> how many artifacts are there → 1 artifacts.

**Ellipsis continuation** (`g-c1-ellip-18`, C1 ellipsis) — the second turn is just "and
app/lib/c.mjs" and the lane re-applies the prior question's frame:

> which modules import app/lib/b.mjs → app/functions/d/handler.mjs.
> and app/lib/c.mjs → app/functions/d/handler.mjs.

## Per-grade judged rollup (draw A)

| grade | cases | judged mean | hard fails |
|---|--:|--:|--:|
| A1 | 15 | 1.89 | 0 |
| A2 | 30 | 1.92 | 0 |
| B1 | 35 | 1.82 | 0 |
| B2 | 35 | 1.81 | 1 |
| C1 | 95 | 1.77 | 5 |
| C2 | 15 | 1.29 | 5 |

The ladder is not monotonic and is not expected to be (the CEFR letters grade construction
difficulty, not a difficulty gradient the product experiences). The signal is in the cells:

- **C2 relative-embedded is the floor**: 4 of its 5 draw-A cases hard-fail (nested chains like
  "what imports the module that defines the method that calls fnAlpha" miss or, worse, answer
  the wrong link in the chain).
- **C1 relative-embedded and C1 conditional** carry the other C1 hard fails; `g-c1-cond-8`
  ("if a module imports app/lib/f.mjs, has it got tests") answers a bare module name — a
  confident wrong answer, the shape the rubric scores below an honest miss.
- **B1 negation** (`g-b1-neg-12`, "which modules do not define anything") lists modules that
  do define things — confident wrong, judged 0.17, though not a rubric hard fail.
- **C1 discourse-deixis** sits at 0/5 green in tier-1 in both draws — the known P-axis-adjacent
  frontier, scored as misses, unchanged.
- **The temporal census cells** (B1, C1: 50 cases each, run in full every draw) are 50/50 and
  48-50/50 green — the cycle-4 promotion holding at full census.

## Dual-draw agreement (the instrument's self-test)

35/36 cells agree within the 0.2 tolerance — **97% agreement**, the run's reliability score.
One cell disagrees: **C2 relative-embedded, draw A 1/5 vs draw B 3/5 (Δ 0.40) —
UNDER-COVERED**. Per the contract that is an instrument failure, not product signal: the cell
is excluded from this run's pass/fail statistics and the prescription is to grow its pool or
per-run sample (the same route the B1/C1 census cells took in cycle 4).

## Tier-1 regressions

No compare base exists for 5.0.25 (this is its first measurement) and no earlier same-pool
dual-draw run is directly comparable case-for-case. The two tier-1 fails are recorded as this
run's baseline: `g-b2-count-temp-1` (draw A, answered "2 commits." where the fixture expects
1) and `g-b2-count-temp-18` (draw B, answered non-zero where the fixture expects 0) — both
temporal-windowed commit counting, both off by exactly the window boundary.

## Predictions vs actuals

| prediction | actual |
|---|---|
| full-pool coverage confirms the go-to profile's floor: green through B2, frontier at C1/C2 discourse and embedding | held: A1-B1 carry zero hard fails; C1/C2 carry 10 of 14 |
| census temporal cells stay green at full census | held: 50/50 and 48-50/50 |
| dual-draw agreement holds at n=5 cells | one cell disagreed (C2 relative-embedded, Δ 0.40) — UNDER-COVERED, instrument prescription below |

## Decision log — ranked next levers

1. **Relative-embedding chain resolution** (C1/C2 relative-embedded): resolve "the module that
   defines the method that calls X" by chaining two graph hops before the outer question runs.
   Largest hard-fail cluster in the run (7 of 14), and both a C1 and a C2 cell move together.
2. **Conditional-question lane** (C1 conditional): "if a module imports X, has it got tests"
   currently falls through to a lookup that answers a module name. A confident wrong answer is
   the worst rubric shape; an honest miss alone would raise the cell.
3. **Negation-scope filter for "do not define anything"** (B1/B2 negation): the complement is
   being taken over the wrong set. Small, self-contained, and two cells carry it.
4. **Temporal window boundary in commit counting** (B2 quantifier-counting+temporal): both
   draws' only tier-1 fails, off-by-one at the window edge — likely one comparison operator in
   the temporal filter.
5. **Instrument: grow the C2 relative-embedded pool or set its `CELL_SAMPLE` to census**, so
   the cell re-enters the pass/fail statistic; until then every run leaves it unmeasured.
6. **C1 discourse-deixis** stays at the honest-miss floor pending its capability
   (`PLAN_DIALOGUE_ACTS.md` horizon) — not a lever this loop can pull by tuning.

The pick, when the tuning loop next runs: lever 1. This run was measurement-only, so no lever
was applied and the §1 decision rule (mean up, no pass→fail regression) has no comparison to
apply; the numbers above are the baseline the next cycle measures against.

## Evidence / transcripts

Discriminating cases first — the hard-fail shapes the decision log ranks.

### g-c1-rel-4 — C1 relative-embedded (judged mean 0)

> functions defined in the module that imports app/lib/a.mjs

No — no imports edge found from Module to app/lib/a.mjs.

The chain inverted: it looked for what a.mjs imports instead of what imports a.mjs, then
answered "No" to a list question.

### g-c2-rel-4 — C2 relative-embedded (judged mean 0.083)

> what imports the module that defines the method that calls fnAlpha

nothing in the index matches that. Try "who touched \<a module that actually has commits\>" or
"/describe \<module\>" to see what's in the index.

A three-hop chain the resolver never attempts; the miss text also points at an unrelated
recovery ("who touched").

### g-c1-cond-8 — C1 conditional (judged mean 0.083)

> if a module imports app/lib/f.mjs, has it got tests

app/lib/e.mjs.

Answered a module name to a yes/no conditional — confident, wrong shape, wrong content.

### g-b2-count-temp-1 — B2 quantifier-counting+temporal (judged mean 1.667, tier-1 FAIL)

> how many commits touched the module that defines fnAlpha

2 commits.

The fixture's expectation is 1 commit inside the asked window; the count ignored the window
boundary. The judge partially credits the well-formed grounded shape, which is why this is a
tier-1 fail but not a rubric hard fail.

### g-b1-neg-12 — B1 negation (judged mean 0.167)

> which modules do not define anything

app/lib/c.mjs, app/functions/d/handler.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs and
app/unit-tests/b.test.mjs.

The complement set is wrong (it lists definers); confident wrong list.

### g-b2-disc-6 — B2 discourse-reference (judged mean 2)

> list the modules → app/lib/a.mjs, app/lib/b.mjs, app/lib/c.mjs, app/functions/d/handler.mjs,
> app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs and app/unit-tests/b.test.mjs.
> why → (expanding: list the modules) … matches (8): app/lib/a.mjs [Module] …
> which of those are tested → app/lib/b.mjs and app/functions/d/handler.mjs.

The "why" meta-turn expands its own prior answer, then the set-anaphor filter still resolves
over the original result set two turns back.

### g-b2-disc-14 — B2 discourse-reference (judged mean 2)

> which modules import app/lib/e.mjs → app/lib/f.mjs.
> what does it import → app/lib/a.mjs and app/lib/f.mjs.
> who touched that → No modules found whose module directly touches app/lib/e.mjs. …

Two pronoun hops resolve; the third turn's miss is honest and names its subject — the
miss-over-guess contract visible inside a passing case.
