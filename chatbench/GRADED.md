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
| B1 | pronoun-binding (50†), negation (25), reversible-passive (25), temporal (50†), discourse-reference (25) | pronoun-binding+negation (25), discourse-reference+quantifier-counting (25) |
| B2 | reversible-passive (25), relative-embedded (50), coordination-compositional (50), discourse-reference (25), assert-recall (25) | quantifier-counting+temporal (25), noise+pronoun-binding (25) |
| C1 | temporal (50†), relative-embedded (25), coordination-compositional (25), assert-recall (25), subordination (25), conditional (25), ellipsis (25), discourse-deixis (25), presupposition (25) | negation+relative-embedded (25) |
| C2 | pronoun-binding (25 — Winograd-style), relative-embedded (25), garden-path (25) | — |

36 cells, 1075 pool cases. († = **census cells**: B1 pronoun-binding, B1 temporal
and C1 temporal were grown 25→50 and are drawn in FULL every run — cycle-4 pool
growth, see "Sampling" below.) Why these cells: each construction is populated at
the band where it first meaningfully exists in the code-chat domain (per the
band descriptors) and **overlaps into the adjacent band** with harder
surfaces of the same construction — svo/naming/counting A1→A2,
pronoun-binding A2→B1 (and C2 as the ceiling), negation A2→B1,
reversible-passive B1→B2, discourse-reference B1→B2, temporal B1→C1,
relative-embedded B2→C1→C2, coordination B2→C1, assert-recall B2→C1. The
overlap is deliberate: the same construction phrased at adjacent grades
detects band-boundary reliability (an engine that passes pronoun-binding at
A2 but not B1 has a boundary between them, not a construction hole).

**PLAN_ADVANCED_GRAMMAR.md §3 stage 0 (2026-07-07): five new C1 cells + one new
C2 cell.** Growing the pool over the CEFR phenomena the plan's §1 inventory
table found unmeasured — subordination (because/although/while framing of a
real query, stripped to its core meaning), conditional (a universally-
quantified filtered conditional and a counterfactual-deletion
reverse-dependency closure), ellipsis/gapping (multi-turn `mode:"turns"`
fragments — "and b.mjs?", "same for classes?" — re-instantiated into the prior
turn's slot), discourse-deixis ("the second one", "the former"/"the latter",
"that list" over a prior turn's ordered result set), presupposition ("why does
X still import Y" — confirms a true import edge, corrects a false one, and
never silently accommodates an unverifiable nested claim like "the deprecated
Y"), and C2 garden-path (stacked reduced-relative clauses and a lexical
noun/verb ambiguity that an anchored, first-match-wins template resolves
without local misparsing — track (g)'s "garden-path-immune by construction"
claim). Every new cell's expectations are computed from the fixture, never
from engine output, exactly like every existing cell; the generator's replay
marks whatever the current engine doesn't yet handle as `baselineFail` +
`observed` — the honest frontier this stage exists to measure, not something
authored in advance. Two results worth flagging: **presupposition measured
25/25 green at authoring** — the existing "why does X import Y" boolean
edge-check (plus incidental adjective/article stripping on "the deprecated
Y") already satisfies the desired honest-confirm/honest-correct pattern by
accident, with no new mechanism built; **discourse-deixis measured 0/25** — a
clean, full ceiling (no ordinal/former-latter/set-reference resolution exists
today), exactly the mechanism gap the plan predicted. C2 garden-path measured
20/25 green, matching track (g)'s prediction that this cell would mostly
demonstrate existing correctness rather than exercise new mechanism.

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
current shape; per-cell detail is printed by the generator). **The authoritative
counts are always whatever `node chatbench/generate-graded.mjs` prints against the
current engine** — the generator replays every item through the live engine, so
these numbers move as levers land. Re-run the generator to refresh them.

| grade | green / pool | reading |
| --- | --- | --- |
| A1 | 93 / 100 | mostly passing (frontier: meta-vs-predicate ambiguity on "what does *pred* mean") |
| A2 | ~140 / 175 | mostly passing (frontier: restricted counts, entity-name vocabulary traps, "are not tested" phrasings) |
| B1 | grows / 225 | **the frontier band** — pool 175→225 after the cycle-4 growth (pronoun-binding 25→50, temporal 25→50); the negation/reversible-passive levers (cycles 5–6) move it |
| B2 | mixed / 225 | relative-embedded and coordination largely pass; assert-recall, discourse chains and passives-in-relatives fail |
| C1 | 213 / 275 | pool 150→275 (PLAN_ADVANCED_GRAMMAR §3 stage 0, five new cells); deep chains and presupposition largely pass; conditional, ellipsis and discourse-deixis are the new frontier alongside temporal composition |
| C2 | 35 / 75 | pool 50→75 (garden-path added); pronoun-binding stays a clean 0/25 ceiling, garden-path measures 20/25 green — mostly already correct by construction, not a new mechanism |

Cycle-4 pool growth (archive/PLAN_CYCLE_4.md): the pool went **850 → 925 cases** — the
three dual-draw UNDER-COVERED cells (B1 pronoun-binding, B1 temporal, C1 temporal)
were each grown 25 → 50 and are now **census cells** (sampled in full every run,
see "Sampling"), restoring all three to the PASS/FAIL statistic.

PLAN_ADVANCED_GRAMMAR.md §3 stage 0 pool growth (2026-07-07): the pool went
**925 → 1075 cases** across **30 → 36 cells** (the five new C1 cells + the one
new C2 cell above). The same pass also re-measured B1 discourse-reference+
quantifier-counting (`g-b1-disc-count`) per HANDOVER follow-up #3's note that
it sampled 0/5 red at tick-4 and was "likely already green": its pool is
already at full size (25 candidate items = 25 pool items, so every generator
run replays the WHOLE cell, not a sample) and now measures **25/25 green, 0
frontier** — the suspicion is confirmed, the cell is fully green at the
current engine baseline.

Schema additions over v1 (`parseCases` lints them): `grade` (A1–C2),
`construction` (one taxonomy entry or a two-part `a+b` combo), the `graded`
tag (valid everywhere, deliberately not part of the v1 TAGS coverage
registry), and turn-level `observed` (frontier record only).

## Sampling: stratified, seeded, dual-draw

A bench run never replays all 1075: `run.mjs` draws a stratified sample —
per cell, `max(cellFloor, round(fraction × poolSize))` items where `cellFloor`
is the cell's `CELL_SAMPLE` override else 5 (fraction default 0.1 → exactly 5 per
cell, the statistical floor per populated area), seeded per cell with
`seed ^ fnv1a(cellKey)`. The seed defaults to `fnv1a(stamp)` and is **recorded on
every graded product row** (`sampling: {seed, fraction, draw}`), so any run is
exactly reproducible from its stamp or its recorded seed.

**Census cells (`CELL_SAMPLE`, cycle-4 pool growth).** Three cells — B1
pronoun-binding, B1 temporal, C1 temporal — carry a `sample` equal to their pool
size (50) in `GRADED_MATRIX`, so both draws hold the **full cell** every run.
These cells are *irreducibly heterogeneous* (a scattered mix of passing and
frontier items): no partial sample makes two independent draws reliably agree
(verified across 500 seeds), so at n=5 the instrument correctly flagged them
UNDER-COVERED. Drawing the full census makes `|Δ green-rate| = 0` for every seed —
they always AGREE and stay in the PASS/FAIL statistic. Like promotion, this trades
sampling-independence for full coverage. Judged-cost note: a census cell is the
identical set in draw A and draw B, so it only needs to be **JUDGED once** (draw A);
draw B adds no judged information for those cells.

**Dual draw (default for graded runs; `--single` opts out):** every graded
measurement executes twice — draw A (seed) and draw B (seed+1), sampled
without replacement across the draws within each cell where the pool allows,
so the two samples share no item. Products land in the same run dir as
`product-a.jsonl` (v1 cases + draw A) and `product-b.jsonl` (draw B only; v1
is not re-run), plus `agreement.json`.

**Timings (`timings.json`, cycle-005):** every run also writes a wall-clock
timing rollup — the total **run wall-time** (a monotonic clock wrapped around the
whole product replay, both draws) plus, per CEFR band A1..C2 and for the **v1
spine** (the ungraded frozen `cases.jsonl` set), the row count, total ms and
**mean ms per row** of the deterministic per-row product replay time (each row's
own `timingMs`). Buckets partition exactly — `spine.totalMs + Σ grades.totalMs ==
all.totalMs`. These numbers are **wall-clock**: they vary run to run and are
deliberately kept OUT of every determinism / row-equality assertion (the runner
also prints the same rollup to stdout). Shape: `{ wallMs, all, spine, grades[],
stamp }`, each bucket `{ label, n, totalMs, meanMs }`.

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
`SKILL_BENCHMARK_CHAT.md` §1 for graded cases; v1 cases are untouched):

1. **Promoted always-run grades are FIXED** — cells of `PROMOTED_GRADES`
   contribute their fixed promoted subset to every draw (never sampled out);
   they are the instrument's anchor across cycles.
2. **Cross-cycle pass→fail regression is checked on the INTERSECTION of the
   two cycles' sampled sets** (`--compare` already keys by caseId, so
   non-intersecting cases report as "new", never as regressions).
3. **Cell-level green-rates (and judged cell means) are the comparable
   statistic across cycles** — robust under sampling — not per-item identity.
   A cell currently flagged UNDER-COVERED is excluded from the comparison.

## Ladder gating (`--ladder`) and the judged-spend cadence (META-2)

Grades run ascending (A1 → C2). A grade is **reliable** when every
non-frontier sampled case passes tier-1 (frontier cases never block the
climb — a grade of only ceiling markers is vacuously reliable; its job is to
stay on the record). When grade N is unreliable, every grade above it is
SKIPPED with a receipt: `grade C1 skipped: B1 at 4/6`. `--grade <band>` runs
one band alone. At the authoring baseline every grade is reliable **by
construction** (failures were marked frontier at authoring), so the ladder
gates nowhere; its job begins the first time a lever regresses an enforced
expectation. The gating is implemented in `runGradedDraw` (`run.mjs`, injectable
runner for unit-testing) and the pure `ladderGate` (`graded.mjs`); the
`test/chatbench-graded.test.mjs` `runGradedDraw` test exercises it end-to-end.

**The standing cadence (archive/PLAN_CYCLE_4.md §META-2 — don't pay to judge a ceiling
while the floor leaks).** Tier-1 (and its dual-draw agreement) is FREE and always
runs for every grade. **Judged** spend is where discipline matters:

- **Judged cycles focus the A/B grades until B1 clears its exit threshold.** Run
  the standing invocation with `--ladder`, so a regression at any lower rung gates
  the paid samples off the higher ones automatically.
- **C1/C2 stay tier-1-only ceiling markers** — run for tier-1 agreement (free) but
  NOT judged, judged only occasionally to confirm they are still ceilings. A verdict
  that hinges on a C-cell is the only reason to buy its judged-mean agreement.
- The **B1 exit criterion** that lifts the ladder gate and returns C1/C2 to the
  judged budget: B1 grade mean ≥ ~1.5, every B1 cell dual-draw-agreeing (no B1 cell
  UNDER-COVERED — the cycle-4 census-cell growth is what makes that measurable), and
  no pass→fail regression on the v1 line or the promoted A1/A2 always-run set.

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

## Dual banding — productive vs performance (archive/PLAN_FORMULAIC_COMPETENCE.md)

Every graded score splits into two bands, computed from the `via` provenance the
product already stamps on each turn (threaded onto each product row as `row.via` =
the answering turn's via; no re-run, pure aggregation in `gradedRollup`):

- **Productive band** — greens whose answering `via` is `"composed"` (the ask
  engine generated it). This is what tmct can *generate*.
- **Performance band** — greens by ANY via (template/count/recall/fact/corpus/…
  included). This is what tmct can *say*, by any means.

Both are reported per cell and per grade as `perf G/n vs prod G/n, gap` — the
**band gap** (`performance rate − productive rate`, always ≥ 0) quantifies how much
of the fluency is memorized versus generated. `bandScore()` is the primitive;
`isProductiveRow(row)` = `via === "composed"`.

**Template-lane** (`isTemplateLane`, the `template-lane` tag, valid everywhere).
A case tagged `template-lane` targets a *templated* capability — "the bench must
say a level is being faked". A template-carried pass **raises the performance band
and NEVER the productive band** (the honesty guarantee, asserted in
`test/chatbench-graded.test.mjs`). Template-lane cells get their own parallel-forms
**agreement line** (`agreement.templateLane` + the `template-lane …` rows in the
rendered table), reported ALONGSIDE the standard cells, never replacing them.
`templateLaneLint(rows)` flags a template-lane row that passed `via:"composed"` —
it is not actually faking the level (either mis-tagged, or a genuine
chunk-becomes-grammar acquisition to record). The agreement gate applies unchanged:
a template-lane cell that disagrees across draws is UNDER-COVERED until its pool grows.

## The judge context and its version (META-1, archive/PLAN_CYCLE_4.md)

The groundedness judge scores against `FIXTURE_CONTEXT` (`run.mjs`) — a faithful
prose ENUMERATION of the fixture. Cycle-4 META-1 broadened it from module grain to
the **full fixture entity detail the product may truthfully emit** (per-symbol ids,
source sites/line spans, params/returns/raises/decorators/self-fields, per-module
provenance commit ids, and the Session/Utterance/Fact memory vocabulary the recall
path speaks). "Holds exactly these facts" stays true of the fuller enumeration.
This is a **harness correction to judge INPUT, not a product change** (the lineage
of cycle-2's H1a/H1b). Every judged row is stamped with `judge.contextVersion`
(`FIXTURE_CONTEXT_VERSION`, currently `fixture-context-v2`) so a cross-cycle
comparison can state which context grain scored it — and cycle 4 is a groundedness
**re-baseline**: v1-context means are not comparable to v2-context means.
