# CHATBENCH_003 — chat tuning cycle 3

## Headline — READ THIS FIRST: the 1.258 is a TRAP, not a regression

- **Combined mean: 1.258 / 2** over 198 judged cases (38 hard fails, **0 voids**). **This number is NOT
  comparable to cycle 1/2's 1.485 / 1.585.** It blends two different measurements:
  - **v1 line (48 targeted cases): STABLE, not improved.** Macro mean (per-case) **1.629**, micro
    mean (per-dimension) **1.549** (report both; cycle-2 macro was 1.585). **47 of 48 v1 answers are
    byte-identical to cycle 2.** The wave did not regress v1 (proven by the byte-diff) and delivered
    **one real recall win (mr-asked-before)**; the macro lift and the hard-fail 2→1 are **judge
    sampling noise on unchanged answers**, not engine improvement — do NOT read v1 as "better."
  - **graded line (150 frontier CEFR cases): mean 1.140, 37 hard fails** — a **NEW first-ever
    full-spectrum reading**, not a regression. The C1/C2 ceiling markers and B1/B2 combination cells
    **fail by design**; this cycle is the first time they have ever been scored.
- Judge pin: **claude-haiku-4-5-20251001**, prompt **judge-prompt-v1**, 3 samples/case. Run stamp:
  `cycle-003`. Dual-draw tier-1; **agreement 27/30 cells (90%)**, 3 cells under-covered (excluded).
- Tier-1 (deterministic): **198/198 pass**; 69 cases carry documented baselineFail turns; **6 baseline
  weaknesses IMPROVED: tf-modles, tf-wat-calls, ns-wondering, ns-hey-tmct, mr-session-count,
  mr-asked-before** (the last is this cycle's one intended new product win).
- **Decision rule (SKILL §1): PASS = mean up vs previous cycle AND no pass→fail regression.**
  On the only comparable surface (v1): **no case regressed** (47/48 byte-identical; the one change is
  an intended miss→hit) ✓, and the hard-fail set did not gain an entrant ✓. **VERDICT: PASS — but a
  "held the line" PASS, not an uplift.** (The graded line has no cycle-2 predecessor to regress
  against — it is a new baseline, per SKILL §1 graded-pool sampling.)

> **Honest read of the v1 PASS (advisor ticks 11–12).** Only **one** v1 answer changed byte-for-byte
> this cycle: `mr-asked-before` turn 2, flipped from a parse-failure miss to the recall frame — the
> intended Phase-4 memory-wiring win (**via:recall, correctness 2/2/2**, though groundedness-capped
> at 1.222 by the judge-context artifact described under Judge integrity). The other 47/48 v1 answers
> are **byte-identical to cycle 2**, so the macro lift (1.585→1.629) is **not engine improvement** —
> it is the stochastic judge re-rolling unchanged answers (conv-what-can-you-do +0.667, gq-impact-a
> +0.667, ns-wondering +0.417 — every one byte-identical). The hard-fail drop 2→1 is the same
> artifact: `gq-functions-call-fnalpha` (0.0→0.25, **unchanged answer, still wrong**) was re-rolled
> across the threshold, not fixed. **The truthful cycle-3 spine: the wave did not regress v1 (proven,
> 47/48 identical) + delivered one recall win + gave us the first CEFR spectrum.**

## BEST EXAMPLES — the most complex sequences that WORKED this cycle

Mined from `product-a.jsonl` (draw A) for the highest-judge-score hard sequences. Each traces to a
judged row.

**1. `mr-asked-before` — cross-session recall (the lever win), judged 0.667 → 1.222**
```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> what did i ask before
last time (session 019f2f3e, 2026-07-04) you asked: "which modules import a.mjs"
```
*Demonstrates:* the Phase-4 memory wiring reading a prior session's utterance back across a process
boundary — the exact case that was a fabricated-limitation miss in cycle 2, now an honest recall.
The recall is **correct 2/2/2**; its case mean is capped at 1.222 only because the judge context
can't see the session id it cites — the same judge-context artifact flagged below (not a product
flaw).

**2. `g-b2-noise-pron-4` — noise + pronoun-binding across a `/describe`, judged 2.0** (B2 combo cell mean **1.80**)
```
> /describe app/lib/a.mjs
  … (full module card) …
> i was wondering who touched it
abc1234.
```
*Demonstrates:* strips conversational filler ("i was wondering"), binds "it" to the just-described
module, and answers from the provenance edge — three seams composing in one turn.

**3. `g-b2-coord-32` — genuine two-constraint intersection, judged 2.0**
```
> modules that import app/lib/a.mjs and import app/lib/f.mjs
app/lib/e.mjs.
```
*Demonstrates:* a real compositional AND — e.mjs is the only module importing *both* a.mjs and
f.mjs. Not a spurious pass (contrast g-c1-coord-1/8 below, which fabricate the same-shaped answer).

**4. `g-b2-rel-31` — relative-clause nesting, judged 2.0**
```
> what uses the module that defines Widget
app/functions/d/handler.mjs.
```
*Demonstrates:* resolves the inner clause ("the module that defines Widget" = b.mjs) then the outer
query (what imports b.mjs) — a two-hop parse landing exactly right.

**5. `mt-describe-then-callers` — multi-turn focus anchor, judged 2.0**
```
> /describe app/lib/a.mjs
  … (full module card) …
> what calls it
scripts/g.mjs.
```
*Demonstrates:* the cycle-2 win holding — the focus set by `/describe` carries into a bare
follow-up, answered from the module-level calls edge.

## The first CEFR profile — a NEW baseline (graded draw A, 150 cases)

Judge rubric mean (/2) per CEFR grade. **This is a new measurement; there is no cycle-2 number to
compare it to.** The shape is the finding: a clean A1/A2 shelf, a **cliff at B1**, and a jagged
C-tier that is not worth chasing until B1 is solid.

> **Read the non-monotonicity correctly (advisor tick 12): B1 (0.77) < B2 (0.97) < C1 (1.07) is a
> construction-MIX confound, NOT a CEFR-difficulty inversion.** The grades are not "harder English"
> in rank order; each grade is populated by a *different mix of constructions*, and B1's mix is
> loaded with the two cells the engine has no machinery for — negation (0.20) and reversible-passive
> (0.48) — while B2's mix includes easy wins like noise+pronoun-binding (**1.80**) and coordination
> (2.0 on genuine intersections). So the dip at B1 measures *which constructions landed in B1*, not
> that B1-grade sentences are harder than B2-grade ones. The cell means below are the real signal;
> the per-grade means are a rollup over an uneven construction mix.

| grade | n | mean /2 | bar |
| --- | ---: | ---: | --- |
| A1 | 15 | **1.719** | `█████████████████░░░` |
| A2 | 30 | **1.700** | `█████████████████░░░` |
| B1 | 35 | **0.766** | `███████░░░░░░░░░░░░░░` ← the trough / cliff |
| B2 | 35 | **0.965** | `██████████░░░░░░░░░░░` |
| C1 | 25 | **1.066** | `███████████░░░░░░░░░░` |
| C2 | 10 | **0.694** | `███████░░░░░░░░░░░░░░` |

**Weakest cells (grade × construction, n=5 each):**

| cell | mean | root cause (judge rationale, verbatim excerpt) |
| --- | ---: | --- |
| B2 quantifier-counting + temporal `[combo]` | **0.050** | counts a symbol/module at the wrong grain: "graph explicitly documents *exactly 0 commit(s) touched fnAlpha*… tmct confidently stated '1 commit'" |
| B2 discourse-reference | **0.194** | pronoun follow-ups after `/describe` bind "it" to a Commit: "No modules found whose module directly imports it. (traversal: imports edges where object = **Commit**)" |
| B1 negation | **0.200** | no negation machinery: "misinterpreted 'not exported' as a search for a module named **'not'**" / "couldn't resolve one of the terms" on a fully-resolvable query |
| B1 pronoun-binding + negation `[combo]` | **0.272** | pronoun *and* negation both required, both absent: "'it' is plainly resolvable… the refusal is a fabricated justification" |
| B1 reversible-passive | **0.478** | object-first phrasing traverses the wrong edge direction: "'are tested by' → searched with the edge direction reversed" |
| C2 relative-embedded | **0.561** | 3-level nesting overflows the parser: "nothing in the index matches that" on a resolvable chain |
| A2 naming-vocabulary | **0.600** | **SUSPECT → verified below: an instrument (judge-context) gap, NOT a product bug** |
| B2 assert-recall | **0.634** | a remembered fact isn't queryable back: "noted — remembered 1 fact… [then] 'component' isn't a term in this graph's own vocabulary" |

## The B1 CLIFF — dissection (the analytical centerpiece)

A1/A2 sit at ~1.71; B1 collapses to **0.766**. This is not noise — both dual-draw draws see it
(27/30 cells AGREE). Three distinct structural gaps, each traceable to judge rationales, explain it,
and the pattern **validates the combination-cell design**: the worst cells are *pairings*, not areas.

**1. Negation has near-zero machinery (cell mean 0.200).** tmct has no operator for "not / don't /
which … don't". It fails two ways, both dishonest-confident:
- *Literal-token trap:* `g-b1-neg-11` "which functions are **not** exported" → "no module matching
  **'not'** found in the index." Judge (3/3): "misinterpreted the query as a search for a module
  named 'not'… confidently wrong." `g-b1-neg-6` "modules that don't import anything" → same.
- *False refusal:* `g-b1-neg-13` "which modules do **not** import app/lib/c.mjs" → "couldn't resolve
  one of the terms." Judge: "'modules', 'import', and 'app/lib/c.mjs' are all explicitly defined… the
  refusal is unjustified and **dishonest**." The correct answer (7 modules) is deterministic.

**2. Reversible-passive traverses the wrong direction (cell mean 0.478).** Object-first phrasing
("X is tested **by** Y", "imported **by**") is read as subject-first. `g-b1-passive-4` "which module
is covered by app/unit-tests/b.test.mjs" → "No modules found… (traversal: tests edges where object =
b.test.mjs)". Judge: "the traversal explanation reveals tmct searched with the edge direction
**reversed**." The graph plainly records b.test.mjs covers b.mjs and d/handler.mjs.

**3. The composition penalty — the design-validating result.** Combination cells score *far below*
the product of their parts, proving the weakness is the *pairing*, not merely the harder area:
- **B2 quantifier-counting + temporal = 0.050** vs A1/A2 counting cells at **2.0** and temporal
  cells at 1.0–1.8 *individually*. Asked "how many commits touched fnAlpha", it answers "1 commit"
  by conflating module-grain provenance with symbol-grain truth (0 commits touch fnAlpha). Judge:
  "conflates module-grain facts… with symbol-grain facts, which are distinct in the graph."
- **B1 pronoun-binding + negation = 0.272** vs pronoun-binding alone (A2 pron cells ~2.0) and
  negation alone (0.200). `g-b1-pron-neg-1`: `/describe a.mjs` → "which modules don't import **it**"
  → "couldn't resolve one of the terms." The pronoun resolves *and* the negation is needed; the two
  failures stack.

The takeaway: **B1 is a capability wall, not a tuning gap.** Negation and passive-direction are
missing verbs in the parser; the combo cells show the frontier is exactly where two required
operations meet.

## Predictions vs actuals

| prediction (cycle-2 decision log) | predicted | actual | verdict |
| --- | --- | --- | --- |
| **cycle-3 pick: L4 answer-grain surfacing → mean ~1.68 (band 1.66–1.71), hard fails 2→1** | ~1.68 | **SUPERSEDED** | **superseded-not-missed** — the instrument (48→198 cases, dual-draw, CEFR pool) AND the product (Phase-4 wiring wave) both changed; L4 was not the lever applied. Recorded per the discipline, not scored as a miss. |
| the wiring wave (operator-directed, Phase-4) | *no numeric prediction* | **mr-asked-before 0.667→1.222; mr-session-count held 2.0; memory-recall tag 1.389→1.574** | delivered exactly one intended v1 flip against a zero-measured expectation; 47/48 v1 answers byte-identical |
| v1 continuity (implicit: hold the line) | hold | **47/48 byte-identical; 0 regressions; 1 intended miss→hit** | **HIT** — held the line (the macro 1.585→1.629 is judge noise, not uplift) |

**Why the old pick is superseded, not missed:** CHATBENCH_002 predicted 1.68 for L4 on a
*48-case, single-draw* instrument. Cycle 3 replaced both terms of the comparison — the case set grew
to 198 with a stratified graded pool, went dual-draw, and the product absorbed the Phase-4 memory
wave. There is no valid 48-case L4 run to score the 1.68 against; per the process discipline it is
logged as superseded. The v1 subset is the only thing that carries forward, and it passed.

## Per-tag breakdown

| tag | cases | cycle-2 | cycle-3 | Δ | hard fails | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ambiguity | 4 | 1.604 | 1.542 | −0.062 | 0 | judge drift (0 answers changed) |
| bootstrap-empty | 2 | 1.834 | 1.834 | = | 0 | identical |
| conversational | 6 | 1.833 | 1.945 | +0.112 | 0 | judge drift (conv-what-can-you-do +0.667, unchanged answer) |
| **graded** | **150** | **— (NEW)** | **1.140** | **n/a** | **37** | first CEFR reading; see profile above |
| graph-query | 15 | 1.563 | 1.620 | +0.057 | 0 | judge drift (gq-impact-a +0.667, unchanged) |
| honesty-miss | 5 | 1.511 | 1.444 | −0.067 | 0 | judge drift |
| **memory-recall** | 3 | 1.389 | **1.574** | **+0.185** | 0 | **the real product move — mr-asked-before flip** |
| multi-turn-focus | 5 | 1.367 | 1.422 | +0.055 | 1 | mt-focus-drift still 0.111 (last v1 hard fail) |
| noise | 5 | 1.533 | 1.583 | +0.050 | 0 | judge drift (ns-wondering +0.417, unchanged) |
| typo-fuzzy | 4 | 1.695 | 1.660 | −0.035 | 0 | judge drift (tf-wat-calls −0.250) |

Every non-graded tag except memory-recall moved on **judge re-scoring of byte-identical answers**
(tick-11 byte-diff: only mr-asked-before changed). memory-recall is the sole product-driven tag move.

## Per-lever analysis (the wiring wave)

The cycle applied the **Phase-4 memory/wiring wave** (operator-directed, multiple workstreams), not a
single scored lever. **Note on attribution method:** the ROADMAP references a `via:recall / via:fact /
via:template` provenance tag, but **that field is not present in the recorded product output**
(`product-a.jsonl` turn records carry only say/answer/miss/resolvedIds/answeredIds/focusLabel). I
therefore attribute by **answer signature**:

- **via:recall — the clean win.** `mr-asked-before` now emits the recall frame `last time (session
  …) you asked: "…"` — a session-memory read across the process boundary. 0.667→1.222 (+0.555), the
  one byte-changed v1 answer. `mr-session-count` ("1 session.") held at 2.0. This is the wave landing.
- **via:fact — seeded declarative asserts, mixed.** The B2/C1 assert-recall cells show the assert
  *path* works ("noted — remembered 1 fact: function rdfs:subClassOf component") but the **read-back
  is unqueryable**: the follow-up "what is a component" returns "'component' isn't a term in this
  graph's own vocabulary" (`g-b2-assert-20`, 0.167). The fact is stored but not surfaced — assert
  writes, no assert reads. This is the top-ranked cycle-4 seam per the advisor.
- **via:template — vocabulary answers.** Schema-doc answers ("what does touchesSymbol mean",
  `g-a1-naming-11` 1.667; "what is an Attribute", 1.5) score well at A1 — the templated vocabulary
  surface is solid where the fixture context enumerates the term.

## Judge integrity

- **Voids: 0 / 594 samples** (198 cases × 3) — third consecutive clean run.
- **Dual-draw parallel-forms reliability: 27/30 cells AGREE (90%).** 3 cells DISAGREE beyond the 0.2
  tolerance and are **excluded as under-covered (instrument failure, not product signal):**
  **B1 pronoun-binding** (a 0.6 / b 0.2), **B1 temporal** (a 1.0 / b 0.6), **C1 temporal** (a 0.6 /
  b 0.2). Prescription: grow those cells' pool / per-run sample (a parallel cycle-4 instrument fix).
- **The systematic judge-context-completeness artifact (the biggest instrument finding this cycle).**
  `FIXTURE_CONTEXT` enumerates the code graph at *module* grain only. It omits per-symbol attribute
  detail — line numbers, ids, params, docstrings — and it omits the session/provenance vocabulary the
  memory path emits. Its header says the graph "holds exactly these facts," so the judge scores **any
  truthful product output richer than a raw module-edge fact as fabrication**. This is not one
  anomaly; it is a **column-wide depressant on groundedness** that hits at least: the A2 naming cell
  (below), every `/describe`-anchored graded case, and even the mr-asked-before recall win (correct
  2/2/2 but groundedness 1/1/0 because the judge can't see the session id `019f2f3e` it cites). It is
  the cycle-2 H1b/FIXTURE_CONTEXT bug, generalized and broader. **Fix = enrich the judge context with
  full attribute/id/provenance/session detail** (cycle-4 harness lever, rank 3 — cheap, and it
  re-floats trust in the entire graded groundedness column).
- **A2 naming-vocabulary 0.60 anomaly — VERDICT: the artifact above, NOT a product bug, and NOT the
  help-text leak the brief hypothesized.** Verified from transcripts + fixture:
  - The four cells are **`/describe` outputs**, not the hardcoded help block. `g-a2-naming-16`
    `/describe Widget.render` surfaces params `self, mode='full'`, returns `str`, raises
    `ValueError`, self_fields `name, size`, decorators `property`, doc, site `b.mjs:5-9`, id
    `m-render`. **Every one of these is present verbatim in `test/fixtures/entities.fixture.json`
    (individual `m-render`).** Same for `a-name` (site `b.mjs:2`) and `cls-button` (site
    `c.mjs:1-10`). **The product is 100% grounded — it is reading real graph facts.**
  - The judge scores them 0 for groundedness because `FIXTURE_CONTEXT` (the summary handed to the
    judge) enumerates modules/edges at *module* grain but never lists per-symbol source spans, line
    numbers, ids, or method signatures — and its header says the graph "holds exactly these facts."
    So the judge reads truthful symbol-grain detail as fabrication: "asserts specific id 'a-name',
    line 2… that do not appear in the graph context — wrong-but-confident."
  - This is the **cycle-2 H1b lesson generalized**: every fact the context omits is something a
    truthful answer gets dinged for. It is reliably reproduced (A2 naming 5/5 green in *both* draws,
    AGREE) — a systematic miscalibration, not sampling noise. **Fix is a harness fix** (enumerate
    symbol-attribute grain in FIXTURE_CONTEXT), not a product change.
- **Distinct from the real help-text leak.** The genuine honesty leak (hardcoded `walk.mjs` /
  `buildContextBundle` examples, absent from the fixture) hits `conv-what-can-you-do` (1.667),
  `am-bare-name` (1.167), and the pronoun-miss fall-throughs `g-b1-pron-24` (0.917) / `g-b1-pron-14`
  (1.083) — ~4 scattered cases. It is a cheap product fix but does **not** touch the A2 naming cell.

## Hard fails (38) — summary

37 graded + 1 v1. The v1 hard fail is **mt-focus-drift** (0.111): turn 3's "which modules import it"
still binds "it" to a Commit (`traversal: imports edges where object = Commit`). The 37 graded hard
fails concentrate exactly on the B1 cliff and the combo cells dissected above: **B1 negation** (neg-5/13/19
all 0.0), **B1 pron+neg** (pron-neg-1 0.0), **B2 count+temp** (12/18/21/22 all 0.0), **B2 passive**
(4/12 0.0), **C1 coord** (1/8 0.0), **C2 relative-embedded** (rel-8/20 0.0). Full per-case list with
transcripts in `CHATBENCH_003_TRANSCRIPTS.md`.

## RANKED LEVER BOARD (decision log) — re-ranked from cycle-3 evidence

The CEFR profile re-orders the board around one principle: **fix the missing construction verbs
before the ceilings.** The B1 trough (0.77) is a construction-mix artifact, not a difficulty rung —
but the constructions loaded into it (negation 0.20, reversible-passive 0.48) are **missing parser
verbs that recur inside the B2/C1 combo cells** (pron+neg, coord, neg-rel). Land those verbs and the
frontier lifts across grades at once; chase a C-grade ceiling first and you measure nothing (3 of
those cells are already instrument-under-covered). Two of the top three levers are also **cheap
harness fixes** that unblock trust in the graded column itself.

| rank | lever (ROADMAP item) | prediction (cells that flip, grade-mean Δ) | justification |
| ---: | --- | --- | --- |
| **1** | **B1 negation operator** — parse "not/don't/which … don't" as set-complement; kill the literal-'not' token trap and the false "couldn't resolve" refusal | B1 neg 0.20→~1.6 (5 cells), B1 pron+neg 0.27→~1.2, feeds C1 coord & neg-rel; **B1 grade 0.77→~1.05** | deepest *structural* gap, **generalizes** — negation is a required operator inside 4 combo families; every failure is dishonest-confident (worst rubric class) |
| **2** | **Reversible-passive direction** — read object-first "X is tested/imported by Y" with correct edge direction | B1 passive 0.48→~1.7 (5 cells), B2 passive 0.0→~1.6; **B1 grade +~0.18** | a single edge-direction fix in the passive parser; cleanly attributable; second-cheapest B1 win |
| **3** | **Judge-context enrichment** (harness) — add per-symbol sites/params/ids/docs AND session/provenance vocabulary to FIXTURE_CONTEXT | A2 naming 0.60→~1.8, every `/describe`-anchored graded case, and un-caps mr-asked-before (1.222→~1.9); **column-wide groundedness correction** | the single most leveraged instrument fix — the artifact depresses groundedness on ANY rich answer; cheap, parallel to product work, and it restores trust in the whole graded groundedness column |
| **4** | **Under-covered pool growth** (harness) — grow B1 pronoun-binding, B1 temporal, C1 temporal | restores 3 excluded cells to the PASS/FAIL statistic | instrument fix (DISAGREE = unmeasured); parallelizable, zero product risk |
| **5** | **assert-recall read-back** — make declared facts queryable ("every X is a Y" → "what is a Y") | B2 assert 0.63→~1.5, C1 assert 0.5→~1.4 (2 cells); **the advisor's #1** | real product gap extending the Phase-4 wiring that just won on mr-asked-before; ranked below B1 because it does not generalize across the cliff |
| **6** | **Quantifier + temporal composition** — count at the grain the question asks (symbol vs module) | B2 count+temp 0.05→~1.4 | the 0.05 combo cell; needs grain-aware counting — a genuine capability, deferred until B1 verbs land |
| **7** | **C2 relative-embedded / ceiling** — deepen nested-clause parse | C2 rel 0.56→~1.2 | **LAST**: hardest, lowest generalization, expected-low grade; not worth judging until B1 is reliable (ladder-gating) |

**Pick: B1 negation operator (rank 1).** Predicted: B1 negation cell 0.20→~1.6, B1 grade
0.77→~1.05, ~10 graded hard fails cleared, combined mean ~1.32; v1 line held at 48/48 tier-1.

### Diff vs the advisor's tick-11 cycle-4 ranking

The advisor (tick 11) ranked: **(1) assert-recall, (2) B1 negation, (3) under-covered pool growth,
(4) B1 discourse-reference, (5) C2 pronoun-binding last.** My re-ranking **agrees on the tails**
(under-covered pool growth mid-board; C2 ceiling last) but **differs at the top**:

- **I promote B1 negation from #2 to #1, and demote assert-recall from #1 to #5.** Evidence: the CEFR
  profile shows B1 is *the* trough (0.77) and negation is a **missing parser verb that recurs inside
  4 combo families** (pron+neg, coord, neg-rel) — it generalizes up the ladder. assert-recall is a
  real gap but touches only **2 isolated cells** and does not unblock the cliff. Ladder-gating says
  fix the load-bearing rung first.
- **I add two levers the advisor's list omits:** the **judge-context symbol-grain fix (#3)** —
  surfaced by verifying the A2 anomaly as an instrument bug, not the help-text leak — and
  **reversible-passive (#2)**, the second-cheapest B1 win, which the advisor folded into the general
  "B1 trough" note. Both are directly evidenced by cycle-3 rationales.
</content>
