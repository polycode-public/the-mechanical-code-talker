# GRADED.md — the graded benchmark (chatbench case-set v2)

Operator-specified 2026-07-04 (ROADMAP Phase 3, "The graded benchmark"): a
scaled ladder fitted to **human language standards**, not AI-benchmark
mechanics — bAbI was explicitly rejected (it tests expected-AI mechanics and
overfits the same way self-authored cases do; see
`docs/references/papers/graded-language-measures.md`). Every graded case
carries a **CEFR band (A1–C2)** and a **construction** tag from a
TROG-2/CELF-5–adapted taxonomy.

Code home: `chatbench/graded.mjs` (registries + pure logic),
`chatbench/generate-graded.mjs` (the pool generator),
`chatbench/graded-pool.jsonl` (the committed pool),
`test/chatbench-graded.test.mjs` (lint + promoted always-run set).
The v1 48 cases in `cases.jsonl` are untouched and always run.

## The licence rule

TROG-2 and CELF-5 are commercial instruments; the Winograd Schema Challenge
items are someone else's items. We borrow the **construction taxonomy and
grading structure only** and author **original items over the code domain**
(the committed entities fixture). No instrument content is ever copied; the
C-band Winograd-STYLE items are original schemas over code entities (e.g.
"app/lib/b.mjs can't be deleted because it is still imported — which of them
is still imported?"). CHILDES remains an approved naturalistic easy-band
input source; CEFR band labels are an open framework (Council of Europe).

## CEFR band descriptors, adapted to the code-chat domain

| band | descriptor (what a visitor at this level asks) |
| --- | --- |
| A1 | Names and single facts: what a vocabulary term means, one subject–verb–object question over one entity, bare counting/enumeration of a kind. |
| A2 | The same intents with everyday complications: recognizing named entities outside the schema, pronoun follow-ups one turn back, simple negation ("untested classes"), scoped counts and superlatives, questions wrapped in politeness/filler noise. |
| B1 | Grammar that reverses or negates roles: reversible passives ("imported **by**"), negated set queries, commit-history (temporal) questions, discourse reference to a previous **answer set** ("which of those are tested"), pronoun binding under harder verbs. |
| B2 | Composition: relative/embedded clauses ("the module that defines X"), boolean coordination (and/or/but-not), passives inside relatives, multi-turn discourse chains, declarative **assert + recall** ("every module is a component" → "how many components are there"), counting composed with history. |
| C1 | Deep composition: 2–3-hop embedded chains, coordination with three branches (only precedence-agnostic items are admitted, so either reading is fair), temporal questions over relative clauses, cross-session assert recall. |
| C2 | Ceiling markers: original Winograd-style pronoun binding (the final question is answerable **only** by resolving the pronoun) and center-embedded relative chains through symbol grain. A case at 0% here is a ceiling marker, not a failure. |

## The populated matrix

Registry of record: `GRADED_MATRIX` in `chatbench/graded.mjs` (the lint in
`test/chatbench-graded.test.mjs` enforces that the pool matches it exactly).
Pool size is 50 where the fixture offers wide surface variation, 25 where the
space is narrower (min the operator allows). Combo cells (marked `+`) pair a
construction with another area — including `noise`, a v1 surface dimension —
so a weak area is diagnosable as weak **alone** or **in combination**: the
rollups and the agreement table always separate single from combo cells.

| grade | single-construction cells (pool) | combo cells (pool) |
| --- | --- | --- |
| A1 | naming-vocabulary (25), svo-query (50), quantifier-counting (25) | — |
| A2 | naming-vocabulary (25), svo-query (50), quantifier-counting (25), pronoun-binding (25), negation (25) | noise+svo-query (25) |
| B1 | pronoun-binding (25), negation (25), reversible-passive (25), temporal (25), discourse-reference (25) | pronoun-binding+negation (25), discourse-reference+quantifier-counting (25) |
| B2 | reversible-passive (25), relative-embedded (50), coordination-compositional (50), discourse-reference (25), assert-recall (25) | quantifier-counting+temporal (25), noise+pronoun-binding (25) |
| C1 | temporal (25), relative-embedded (25), coordination-compositional (25), assert-recall (25) | negation+relative-embedded (25) |
| C2 | pronoun-binding (25 — Winograd-style), relative-embedded (25) | — |

30 cells, 850 pool cases. Why these cells: each construction is populated at
the band where it first meaningfully exists in the code-chat domain (per the
band descriptors) and **overlaps into the adjacent band** with harder
surfaces of the same construction — svo/naming/counting A1→A2,
pronoun-binding A2→B1 (and C2 as the ceiling), negation A2→B1,
reversible-passive B1→B2, discourse-reference B1→B2, temporal B1→C1,
relative-embedded B2→C1→C2, coordination B2→C1, assert-recall B2→C1. The
overlap is deliberate: the same construction phrased at adjacent grades
detects band-boundary reliability (an engine that passes pronoun-binding at
A2 but not B1 has a boundary between them, not a construction hole).

## The pool + the generator (authoring discipline)

`node chatbench/generate-graded.mjs [--seed 20260704] [--out …]` rebuilds the
pool **deterministically** — same seed, byte-identical file (verified by
sha1; nothing reads Date.now). Per cell it enumerates original candidate
items (entity permutations × phrasing variants), seeded-shuffles, takes the
pool size, then **auto-authors tier-1 expectations by replaying each item
through the current engine**, mirroring the v1 discipline:

- the **desired** expectation is computed from the fixture's ground truth
  (never from engine output), and every desired empty-result carries
  `answerNotMatch: ["I answer questions about"]` so the generic orientation
  blurb can never false-pass as an honest empty;
- an item the engine satisfies keeps the desired expectation, enforced;
- an item the engine fails keeps the desired expectation with
  `baselineFail: true` on the failing turns and the honest current answer
  recorded as `turn.observed` — these are the ladder's frontier;
- judge dimensions follow v1: groundedness+correctness for answerable items,
  +honesty+rephrase for frontier and desired-miss items; every case carries a
  timeless ground-truth `judge.context`.

Baseline distribution at generation (green cases / pool — the ladder's
current shape; per-cell detail is printed by the generator):

| grade | green / pool | reading |
| --- | --- | --- |
| A1 | 93 / 100 | mostly passing (frontier: meta-vs-predicate ambiguity on "what does *pred* mean") |
| A2 | 138 / 175 | mostly passing (frontier: restricted counts, entity-name vocabulary traps, "are not tested" phrasings) |
| B1 | 48 / 175 | **the frontier band** (reversible passives answer the reversed question; set-anaphora "those" is not threaded; negated set queries don't parse) |
| B2 | 131 / 225 | mixed (relative-embedded and coordination largely pass; assert-recall, discourse chains and passives-in-relatives fail) |
| C1 | 68 / 125 | mixed (deep chains largely pass; temporal composition and cross-session recall fail) |
| C2 | 12 / 50 | ceiling (all Winograd-style items fail, as is their job) |

Schema additions over v1 (`parseCases` lints them): `grade` (A1–C2),
`construction` (one taxonomy entry or a two-part `a+b` combo), the `graded`
tag (valid everywhere, deliberately not part of the v1 TAGS coverage
registry), and turn-level `observed` (frontier record only).

## Sampling: stratified, seeded, dual-draw

A bench run never replays all 850: `run.mjs` draws a stratified sample —
per cell, `max(5, round(fraction × poolSize))` items (fraction default 0.1 →
exactly 5 per cell, the statistical floor per populated area), seeded per
cell with `seed ^ fnv1a(cellKey)`. The seed defaults to `fnv1a(stamp)` and is
**recorded on every graded product row** (`sampling: {seed, fraction, draw}`),
so any run is exactly reproducible from its stamp or its recorded seed.

**Dual draw (default for graded runs; `--single` opts out):** every graded
measurement executes twice — draw A (seed) and draw B (seed+1), sampled
without replacement across the draws within each cell where the pool allows,
so the two samples share no item. Products land in the same run dir as
`product-a.jsonl` (v1 cases + draw A) and `product-b.jsonl` (draw B only; v1
is not re-run), plus `agreement.json`.

### The agreement gate — the instrument's self-test (parallel-forms reliability)

Two independent draws over the same engine must AGREE per cell; disagreement
means the benchmark under-covers that cell's volatility — an **instrument
failure, not product signal**. Per grade×construction cell, the tier-1
pass-rate compared is the **green rate**: a case is green only when tier-1
passed AND every documented weakness it carries actually improved (a frontier
case whose weakness still reproduces is not green — that is its job).

- default tolerance: |Δ green-rate| ≤ 0.2 per cell (1 item of 5) → AGREE;
- \> 0.2 → **DISAGREE**: the cell is flagged UNDER-COVERED with the standing
  prescription "grow this cell's pool and/or per-run sample", and the cell is
  **excluded from cycle PASS/FAIL statistics until it agrees** (unmeasured,
  not failed);
- the **overall agreement rate is the benchmark's own reliability score** and
  must be reported in every CHATBENCH write-up alongside the product mean.
- judge-cost note, honestly: dual draws double the judged items for graded
  cells (~2 × 150 sampled cases at N samples each). Tier-1 agreement is FREE
  and is always the first-line check; judged-mean agreement is only worth
  buying when a cycle's verdict actually hinges on graded cells.

Observed at authoring: agreement is draw-dependent — the `graded-smoke` stamp
agreed 30/30 cells, while a different stamp's seeds produced 5 DISAGREEING
cells (all mixed cells: B1 discourse-reference, B1 pronoun-binding,
B1 reversible-passive, B2 quantifier-counting+temporal,
C1 coordination-compositional). That is the instrument telling us those
mixed cells sit at the n=5 boundary; growing their per-run sample (or pool)
is the standing prescription before trusting their cell means.

### The SKILL §1 amendment for graded cases

Sampling changes the regression contract (this section amends
`SKILL_TUNING_CYCLE.md` §1 for graded cases; v1 cases are untouched):

1. **Promoted always-run grades are FIXED** — cells of `PROMOTED_GRADES`
   contribute their fixed promoted subset to every draw (never sampled out);
   they are the instrument's anchor across cycles.
2. **Cross-cycle pass→fail regression is checked on the INTERSECTION of the
   two cycles' sampled sets** (`--compare` already keys by caseId, so
   non-intersecting cases report as "new", never as regressions).
3. **Cell-level green-rates (and judged cell means) are the comparable
   statistic across cycles** — robust under sampling — not per-item identity.
   A cell currently flagged UNDER-COVERED is excluded from the comparison.

## Ladder gating (`--ladder`)

Grades run ascending (A1 → C2). A grade is **reliable** when every
non-frontier sampled case passes tier-1 (frontier cases never block the
climb — a grade of only ceiling markers is vacuously reliable; its job is to
stay on the record). When grade N is unreliable, every grade above it is
SKIPPED with a receipt: `grade B2 skipped: B1 at 4/5`. `--grade <band>` runs
one band alone. At the authoring baseline every grade is reliable **by
construction** (failures were marked frontier at authoring), so the ladder
gates nowhere; its job begins the first time a lever regresses an enforced
expectation.

## Promotion (cell-level)

When a cell passes reliably across two cycles' samples, its whole pool
becomes promotion-eligible; promotion makes its **fixed 5-item promoted
subset** (the first 5 non-frontier cases by id — deterministic and stable)
an ALWAYS-RUN, judge-free unit test in `test/chatbench-graded.test.mjs`,
running through the same runner machinery in unit timescale. Promoting a
future grade = appending its band name to the one `PROMOTED_GRADES` array in
`chatbench/graded.mjs`. Currently promoted: **A1 and A2** (9 cells × 5 =
45 always-run cases; every A1/A2 cell's promoted subset passes today).
Demotion (a promoted cell regressing) fails `npm test` — that is the point.
