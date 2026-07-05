# PLAN_CYCLE_4.md — the B1-cliff arc: fix the instrument, then teach the missing verbs

An operator-directed multi-cycle plan (operator, 2026-07-05: reviewing the CHATBENCH_003 lever
board — "we'll do ALL of them"). Cycle 3 gave us the first full CEFR reading and, with it, a clear
diagnosis: a clean A1/A2 shelf (~1.71), a **cliff at B1 (0.766)**, and a jagged C-tier not worth
chasing yet. This plan turns that diagnosis into a buildable arc — **fix the measurement first, then
land the missing parser verbs one cycle at a time**, per `SKILL_TUNING_CYCLE.md`'s one-lever
discipline. It is not a single pick; it is the sequence and the exit criterion for the whole B1 push.

## Context — what cycle 3 actually established

- The combined 1.258 is a **trap number** (v1 @1.629 blended with a new 150-case graded line @1.140).
  The real signal is the CEFR *cell* profile, not the per-grade rollup: B1 < B2 < C1 is a
  **construction-mix confound**, not a difficulty inversion. B1's mix is loaded with the two cells
  the engine has **no machinery for** — negation (0.200) and reversible-passive (0.478) — and the
  combo cells (pron+neg 0.272, count+temp 0.050) score *far below the product of their parts*,
  proving the weakness is the **pairing of missing verbs**, not the harder area.
- Two of the cycle-3 findings are **not product gaps at all** but instrument defects, and they
  confound every groundedness number on rich answers. They must be settled before we spend judge
  budget attributing product deltas. They are the spine of this arc and come first.
- Dual-draw agreement was 27/30 cells; **3 cells (B1 pronoun-binding, B1 temporal, C1 temporal) are
  under-covered** — excluded as unmeasured, not failed — and need pool growth to re-enter the stat.

## The spine — two META fixes gate everything (measurement integrity before product levers)

**META-1 (cycle 4, its own cycle): fix the judge-context artifact BEFORE trusting groundedness.**
`FIXTURE_CONTEXT` (`chatbench/run.mjs:94–106`) enumerates the graph at **module grain only** — imports
edges, module lists, the single commit entity — and its header asserts the graph "holds exactly these
facts." But the product legitimately emits **symbol-grain** detail: `/describe app/lib/a.mjs` renders
`id: mod-a`, `provenance: git:abc1234, git:def5678`, `mgx:` predicates, `touched by 2 commit(s)`
(verbatim in `CHATBENCH_003_TRANSCRIPTS.md`), and `/describe Widget.render` surfaces params, return
type, `site b.mjs:5-9`, `id m-render` — **every one present verbatim in
`test/fixtures/entities.fixture.json`**. The judge, told the context is exhaustive, scores this
truthful output as fabrication ("asserts id 'a-name', line 2… that do not appear in the graph
context"). It is a **column-wide depressant** on groundedness, not one anomaly: it zeroed A2 naming
(0.60, 5/5 in *both* draws — AGREE, so a systematic miscalibration, not sampling noise), caps
`mr-asked-before` at 1.222 despite a **correct 2/2/2** recall (the judge can't see the session id
`019f2f3e` it cites), and dings every `/describe`-anchored graded case.
- **The change (harness only):** enrich `FIXTURE_CONTEXT` to carry the **full fixture entity detail**
  the product may truthfully emit — per-symbol source sites/line spans, ids, params/returns/raises,
  decorators, self-fields; per-module provenance commit ids; and the **session/memory vocabulary** the
  recall path speaks (session ids, dates, the `Utterance`/`Fact` classes, the recall-frame shape).
  The judge reads `row.judge.context` via `buildPrompt`'s `{{CONTEXT}}` (`chatbench/judge.mjs:76`);
  this is the single artifact to edit. `EMPTY_CONTEXT` stays as-is.
- **This is NOT a product change.** Per the SKILL, harness corrections are logged separately — the
  direct lineage of cycle-2's H1a (cross-session cache clear) and **H1b** (the very same
  `FIXTURE_CONTEXT` def5678 correction, `run.mjs:82–93`), generalized and broadened. Record it as a
  measurement correction, not a lever.
- **The re-measure that isolates artifact from real gap:** re-run cycle-3's **`product-a.jsonl`
  UNCHANGED** through the enriched judge and quantify **how much of the graded groundedness column
  re-floats**. Predicted: A2 naming 0.60→~1.8, un-caps `mr-asked-before` 1.222→~1.9, lifts every
  `/describe`-anchored case. Whatever does *not* re-float is the honest product gap the later levers
  own. This baseline re-read is the whole point of spending a cycle on it alone.

**META-2 (cycle 4, alongside): the LADDER RULE — get B1 reliable before judging C-grades.** Don't pay
to judge a ceiling while the floor leaks. Gate the judged spend against the flags already in
`run.mjs`: `--ladder` runs grades ascending and skips above the first unreliable grade
(`runGradedDraw`, `run.mjs:471–495`, `gradeReliability`); `--grade <band>` runs one band. Concretely:
**judged cycles focus A/B grades until B1 clears the exit threshold; C1/C2 stay tier-1-only (free)
ceiling markers**, judged only occasionally to confirm they are still ceilings. Tier-1 agreement is
free and always runs; buying judged-mean agreement on C-cells is deferred until a verdict hinges on
them (`GRADED.md` judge-cost note). This keeps every downstream cycle's paid samples on the
load-bearing rung.

## The product levers — one per cycle, ranked, each a mini-spec

**Cycle 5 — B1 negation operator (rank 1, the deepest structural gap).**
- *What changes:* teach the parser a **negation frame** for set queries — "which X do **not** <verb>
  Y", "X that don't <verb> Y", "un-<verb>ed X", "modules … but not tested" — that computes a **SET
  COMPLEMENT**: the bounded universe of entities of the kind MINUS the positive result set.
- *Where — the good news: the traversal machinery already exists; only the parse marker is missing.*
  `evalBoolean` (`ask.mjs:725`) **already implements set difference** (`op === "difference"` →
  `acc.filter((i) => !oids.has(i.id))`), and `evalSet`'s `allOfClass` node (`ask.mjs:696` →
  `graph.individuals.filter((i) => i.class === entityType)`) is a **ready-made bounded universe** of a
  kind — the same idiom `resolveObject`'s pool and the superlative path use. So "functions that do not
  call X" is exactly `allOfClass(Function)` **difference** `reverseSet(call, X)`; both operands exist,
  and `splitBoolean` (`ask.mjs:585`) already parses "but not"/"and not"/"without"/"except" as
  difference. **The only missing piece is a parse-level negation marker** that builds that AST from a
  bare "do not / don't / un-<verb>ed" set query. The intercept seam is **before object resolution**:
  `applyNegationFrames` (`src/interpret/normalize.mjs:85`, driven by `NEGATION_FRAMES`
  `ask-vocab.mjs:379`), run once at `parseQuery` (`ask.mjs:171`) ahead of every strategy. Today "not"
  is neither a `STOPWORD` (`normalize.mjs:99`) nor consumed, so `parseKeywordSpot`'s `sideText`
  (`keywords.mjs:137-143`) leaves it in a term and `resolveObject` (`ask.mjs:907`) misses — dying as
  `no <kind> matching "not" found` (`ask.mjs:1485`) or, in the two-term `"ask"` shape, `couldn't
  resolve one of the terms` (`ask.mjs:1569`). Note `NEGATION_FRAMES` today is a **rhetorical
  double-negative rewriter only** ("there isn't anything calling it" → "what calls it") — it *removes*
  negation and must not be overloaded to compute a complement (its docblock forbids scope parsing);
  the new marker recognizes the set-negation and routes it to the `allOfClass`-minus-positive AST. The
  generator already encodes the exact desired truth (`b1Negation`, `generate-graded.mjs:474` —
  `mods.filter((x) => !t.importersOf(m).includes(x))`), so the product just has to match a ground
  truth the bench already computes.
- *Prediction on record:* B1 negation 0.20→~1.6 (5 cells), B1 pron+neg 0.27→~1.2, **B1 grade
  0.77→~1.05**, ~10 graded hard fails cleared (neg-5/6/11/13/19, pron-neg-1/5/7). Unlocks the negation
  verb inside the B2/C1 combos (neg+relative, coord). Combined mean ~1.32.
- *Regression watch / tier-1 traps:* the honest-empty cases MUST stay honest. "which functions are
  not exported" is a **true empty result** (`b1Negation` marks it `miss:true` with
  `answerNotMatch: ['matching "not"']` — `generate-graded.mjs:500`): the complement operator must
  return an honest miss there, never invent a member and never re-trip the literal-'not' trap. Do not
  flip any existing empty-result / honest-miss expectation to a confident answer.

**Cycle 6 — reversible-passive direction (rank 2, the second-cheapest B1 win).**
- *What changes:* detect **passive voice + agent phrase** ("X is imported/tested/covered **by** Y",
  "imported by Z", "Base is inherited by which classes") and **swap subject/object roles before
  traversal**. Object-first phrasing is currently read subject-first, so the edge is traversed
  backwards: "which modules are tested by b.test.mjs" → `No modules found whose module directly tests
  by b.test.mjs. (traversal: tests edges where object = b.test.mjs)` — the traversal receipt literally
  shows the reversed direction.
- *Where:* the `shape` field decides direction — `reverse` returns edge *subjects*, `forward` returns
  *objects*. `parseKeywordSpot` assigns it from surface word order (`keywords.mjs:159-166`); `traverse`
  reads it (forward `e.subject === objMatch.id`, reverse `e.object === objMatch.id` — `ask.mjs:1300`,
  `:1329`). The fix: a passive auxiliary + agent-marking "by" must **flip the resulting shape**
  (reverse↔forward) at `parseKeywordSpot` before it returns — or, cleaner, add a passive rewrite as a
  sibling frame table beside `COMMIT_CONTENT_FRAMES` in `applyNegationFrames` (`normalize.mjs:85`) so
  both strategies see the swapped canonical form for free. `traverse` already has a kind-specific
  role-swap precedent (`ask.mjs:1233-1236`, the touches/Commit flip) — this generalizes it to a
  surface-cued passive. Cleanly attributable to one direction decision.
- *Prediction on record:* B1 reversible-passive 0.48→~1.6 (5 cells), B2 passive 0.0→~1.6; B1 grade
  +~0.18. Clears passive-4/24/25 and the B2 passive hard fails.
- *Regression watch:* active-voice queries ("which modules import X") must keep their current
  direction — the passive detector fires only on genuine agent-marked passives, never on a bare
  "by" that is part of an entity or filler.

**Parallel throughout — under-covered pool growth (harness, rank 4, zero product risk).**
Grow the B1 pronoun-binding, B1 temporal, and C1 temporal cells' pool / per-run sample so the two
draws agree (the |Δ green-rate| ≤ 0.2 gate, `GRADED.md`). These cells are **excluded-as-unmeasured**,
not failed; restoring them returns 3 cells to the PASS/FAIL statistic. Runs alongside any product
cycle — it touches `graded.mjs`/`generate-graded.mjs`/`graded-pool.jsonl`, disjoint from the
interpreter. Must land before we can claim the B1 exit criterion (below) is *measured*.

**The tail (ranked, after B1 is reliable):**
- **assert-recall read-back (rank 5).** The via:fact path *writes* ("noted — remembered 1 fact:
  function rdfs:subClassOf component") but the read-back is unqueryable ("'component' isn't a term in
  this graph's own vocabulary") — assert writes, no assert reads. Make declared facts queryable
  ("every X is a Y" → "what is a Y"). Extends the Phase-4 wiring that won on `mr-asked-before`; ranked
  below the cliff because it touches only 2 isolated cells (B2 assert 0.63, C1 assert 0.5) and does
  not generalize up the ladder.
- **quantifier + temporal composition (rank 6).** The 0.050 combo cell counts at the wrong grain
  ("1 commit" for fnAlpha when 0 commits touch the *symbol*). Needs grain-aware counting; deferred
  until the B1 verbs land.
- **help-text honesty leak (a real product fabrication, distinct from META-1's artifact).** The
  hardcoded `walk.mjs` / `buildContextBundle` examples (help block / `buildContextBundle`) name
  entities **absent from the fixture** — the engine emitting non-fixture names. Judges dock it 0/0/0
  where it appears: `conv-what-can-you-do`, `am-bare-name`, and the B1-pronoun fall-throughs
  (`g-b1-pron-24`, `g-b1-pron-14`). Cheap product fix; it does **not** touch the A2 naming cell (that
  is META-1). Fold in with the tail.
- **C2 relative-embedded / ceiling (rank 7, LAST).** Hardest, lowest generalization, expected-low
  grade — not worth judging until B1 is reliable (that is exactly what META-2 gates).

## Sequencing and the exit criterion

- **Cycle 4:** META-1 (enrich `FIXTURE_CONTEXT`) + META-2 (ladder gating wired into the run cadence).
  Re-baseline by re-judging cycle-3 `product-a` unchanged; publish the re-floated groundedness column
  as the new comparison baseline. No product change this cycle.
- **Cycle 5:** B1 negation. **Cycle 6:** reversible-passive. Pool growth runs parallel across 4–6.
- **Then the tail:** assert-recall → quantifier+temporal → help-text leak → C2 ceiling last.
- **EXIT CRITERION for "B1 reliable" (what unlocks C-grade judged spend):** the **B1 grade mean ≥
  ~1.5** with **every B1 cell dual-draw-agreeing** (|Δ green-rate| ≤ 0.2 — no B1 cell flagged
  under-covered) **and no pass→fail regression** on the v1 line or the promoted A1/A2 always-run set.
  Only when B1 holds that bar does META-2 lift the ladder gate and C1/C2 return to the judged budget.

## Integration, first steps, open questions

First steps, in order: (1) enrich `FIXTURE_CONTEXT` from `entities.fixture.json` — symbol sites/ids/
signatures, module provenance, memory vocabulary — keeping the "holds exactly these facts" header
*true* of the fuller enumeration; (2) re-judge cycle-3 `product-a.jsonl` unchanged through the
enriched judge and record the per-cell re-float (the artifact-vs-gap split); (3) wire `--ladder` into
the standing run invocation and set C1/C2 to tier-1-only; (4) then, cycle 5, land the negation frame
with the honest-empty regression guard green first. Keep `npm test` and the two smoke pipes
(graph-less + fixture-graph) green at each step; snapshot raw judge output to
`chatbench/results/raw-004/` before re-running.

Genuinely open questions (last, by design):
- **Does set-complement need a bounded universe to stay honest on big graphs?** On the fixture the
  kind's universe is tiny; on a real estate "which modules do not import X" could return thousands.
  The complement must have a defined, bounded universe (the queried kind within the loaded graph) and
  an overflow discipline (`OVERFLOW_CAP`, `compositeList` already cap rendering) — this ties directly
  to `PLAN_REPOSITORY_INTERFACE.md` (what "all modules" *means* at repository scale). A concrete edge
  already visible: the `Change` pseudo-type (`ask-vocab.mjs`) is a wildcard, **not a stored class**, so
  it is not independently enumerable — a complement over "changes" is ill-defined and must be refused
  honestly, not answered over an empty universe. Decide the universe boundary before shipping negation
  past the fixture.
- **Should META-1 pin a judge-context VERSION** the way `PROMPT_VERSION` (`judge-prompt-v1`) pins the
  prompt? A `FIXTURE_CONTEXT` version stamped on every judged row would make "which context scored
  this" auditable and let cross-cycle comparisons state which context grain they used. Leaning yes —
  cheap, and it is the honest bookkeeping for the next question.
- **Does fixing the judge artifact retroactively invalidate cycle 1–3 groundedness comparisons?** The
  honest answer: **partly yes** — every rich-answer groundedness number from cycles 1–3 was scored
  against the module-grain context, so their *absolute* groundedness is artificially low and not
  directly comparable to cycle-4-onward numbers. It does **not** invalidate the cross-cycle *deltas on
  unchanged answers* (the v1 byte-identical spine) or correctness/honesty dimensions. The write-ups
  must handle this explicitly: mark cycle 4 as a **groundedness re-baseline** (like the v1→graded
  break in cycle 3), report the enriched-judge re-read of cycle-3 `product-a` as the bridge datapoint,
  and never silently compare a v1-context groundedness mean to a v2-context one.
