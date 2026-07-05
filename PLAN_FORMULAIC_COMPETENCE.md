# PLAN_FORMULAIC_COMPETENCE.md — templates first, productive composition later

> **STATUS: shipped (Phase 6).** A technical (C1) register of templates plus dual-banding
> (productive band = composed answers only; performance band = templates allowed) in the
> benchmark, computed from the `via` provenance.

The Phase 6 plan (operator, 2026-07-04, refined 2026-07-05). The graded benchmark (Phase 3) grades
the conversation on a human CEFR ladder; the wiring wave (Phase 4) gave every turn a `via`
provenance field and made the template renderer load-bearing. This plan reads those two together
and turns the operator's inversion — *a consistently-failed ceiling cell whose answer already exists
as a stable technical phrasing is not a ceiling, it is a lever* — into tmct's central learning
strategy. tmct acquires fluency the way human learners do: memorized chunks first, generated
competence later, and the bench is built to tell the two apart honestly.

## Context — what the pieces are today

- **The template renderer** (`src/corpus/templates.mjs` + `data/templates/responses.jsonl`, 64 rows):
  W1 made the answer path consume `render(id, slots)` instead of hardcoded strings: strict slots, a
  thrown slot is a programming error not a user-facing miss. Registers today are `terse|friendly`
  only; there is no C1/technical-paper register yet.
- **The `via` provenance** (`src/chat.mjs`): every turn record already carries
  `via ∈ {composed, template, count, recall, fact, corpus, command, conversational, assert}`. This is
  the exact field the dual banding reads. Phase 5 does not need new plumbing to know *how* an answer
  was produced, only to aggregate it.
- **The graded benchmark** (`chatbench/GRADED.md`): a CEFR A1–C2 ladder × TROG/CELF-adapted
  construction taxonomy, 30 cells / 850 pool cases, stratified seeded sampling with a **dual-draw
  agreement gate** (two independent draws must agree per cell or the cell is UNDER-COVERED and
  excluded from PASS/FAIL). Baseline: B1 is the frontier band (48/175 green); C1 mixed (68/125);
  C2 ceiling (12/50). The cell-level green-rate is the cross-cycle comparable statistic.
- **The tuning cycle** (`CHATBENCH_002.md`): single-seam levers move exactly their predicted cases;
  the operator's own verdict on cycle 2 is that the *mechanical floor is honest* (zero hallucinated
  graph entities across 96 runs) and the ceiling is a coverage problem. Movement past ~1.85 mean
  "requires new wiring *and new cases to measure it*." Phase 5 is that wiring, made into a loop.

## Why — formulaic competence is a real acquisition mechanism

Human language testing distinguishes **productive** competence (what a learner can generate from
grammar) from **performance** enabled by **formulaic sequences** — Wray's memorized multi-word chunks
that let a speaker perform *above* their productive level ("I'd like to book a table" fluent long
before the syntax that composes it is). CEFR raters and clinical instruments are built to see through
this: a chunk-carried utterance is graded as performance, not as generative command. tmct's learning
curve is the same shape. In a tech domain a paragraph-grade answer — counting + comparison +
superlative composed through a C1-register template, *"X has 340 tests across 12 suites, unusually
dense for a codebase this size"* (item 5's mechanical conclusions) — is legitimately advanced output;
the CEFR banding then tells us honestly how good the conversation *around* it is. The point is not to
inflate the grade. The point is to acquire real capability the cheap way and **measure the two kinds
of fluency separately** so the acquisition is never mistaken for generation.

## The central seam — dual banding, and the band gap as a first-class metric

Every graded score splits into two bands, computed from the `via` provenance (no re-run — it is an
aggregation over the existing product rows):

- **Productive band** — the score counting `via:"composed"` answers only. Template/count/recall/
  fact/corpus-carried passes are *excluded* from this band. This is what tmct can generate.
- **Performance band** — the score with templates (and the other formulaic vias) allowed. This is
  what tmct can *say*, by any means.

The **gap between the bands is itself a headline metric**. It quantifies how much of tmct's fluency
is memorized versus generated, per cell and per grade. A template-carried C1 pass raises the
performance band and **never touches the productive band**; that invariant is the honesty guarantee.
The design question this seam forces — settled as a rule, flagged as an open one below — is *whether a
pattern, once tmct can compositionally reproduce it, should ever be re-credited to the productive
band* (the "chunk becomes grammar" moment in child language). The default is no: a template stays a
template in the accounting even after its slots are understood, unless a composed rederivation is
independently demonstrated.

## Template-lane benchmarking — the bench must say a level is being faked

Cases that target a *templated capability* are **tagged** as template-lane. The operator's framing is
load-bearing: *"it's faking a level we would expect a fail at, so the bench must say so."* So template
-lane cells get their own dual-draw agreement treatment (`GRADED.md`'s parallel-forms self-test),
reported as an **additional** measurement alongside the standard cells, never a replacement for them.
A template-lane C1 cell that passes tells us the performance band cleared C1 there; the co-located
non-template cell (or the productive-band read of the same cell) tells us the productive band did not.
Both numbers ship in the CHATBENCH write-up. The agreement gate applies unchanged: a template-lane
cell that disagrees across draws is UNDER-COVERED and excluded until its pool grows, exactly like any
other cell.

## The learning loop — the shopping list is the failed ceiling cells

The operator's inversion, upgraded to the per-cycle strategy. Each cycle's write-up already extracts
consistently-failed cells; Phase 5 adds a ranking pass over the failed **C1/C2 graded** cells by
**template-acquirability**:

1. Does a **stable technical-prose phrasing** of the answer exist in the C1-register (a real sentence
   pattern from the technical-paper register, not an ad-hoc string)?
2. Is the **slot structure mechanical** — counts, comparisons, superlatives, provenance — i.e. values
   tmct *already computes* (item 5) and can fill strictly?
3. Is it licence-clean to author as an original phrasing (never copied instrument or source content)?

Cells scoring high on all three are the **shopping list**. Acquiring the template *is* the lever: one
template-acquisition per cycle keeps the attribution clean (`CHATBENCH_002`'s single-seam discipline),
and the graded bench measures the flip **in the performance band**. A cell that flips performance but
not productive is the expected, honest outcome. The write-up records both, and the band gap for that
cell widens by exactly the acquired chunk. Failed ceiling cells stop being a scoreboard of shame and
become an ordered backlog of acquirable phrasings.

## Generalization path — fixed domain first, then mined

- **Phase 5a — fixed tech domain.** Templates are hand-picked in the technical-paper (C1) register,
  authored as **original phrasings** (the `GRADED.md` licence rule extends here: borrow register and
  structure, never copy source text). This requires a new `register` value. The strict loader's
  `REGISTERS` set (`terse|friendly` today) grows a `technical` band with its own slot-lint.
- **Phase 5b — mined templates.** Template acquisition generalizes: candidate templates are **mined
  from tier-2 corpus blocks** (the fetched-at-seed-time corpora of the ROADMAP's tiering policy),
  scored by **slot-fillability** against what tmct computes, and the survivors are **promoted into
  `data/templates/` with provenance**, the same committed/diffable discipline, plus a `via:"corpus"`
  or acquired-template provenance stamp so a mined chunk is always distinguishable from a hand-authored
  one in both the memory inspector and the dual banding.

## Integration points

- **Builds on W1** (renderer + `via`): dual banding is an aggregation over provenance that already
  exists; template-lane cases are ordinary graded cases with a tag.
- **Consumes PLAN_RESPONSE_FINISHING.md's segmentation IR**: acquired-template slots ARE the protected
  spans of that plan's typed-span model. Cite that plan for the span taxonomy and the invariance
  checker; do not respecify it here. A C1 template renders into `prose` + protected (`number`,
  `entity`, `provenance`) spans and rides finishing's grammar pass unchanged.
- **Feeds the tuning cycle as levers**: one template-acquisition per cycle, ranked by the shopping
  list, measured by the performance-band flip. The acquisition loop is a *kind* of tuning lever, not
  a parallel process.
- **Adjacent to PLAN_REPOSITORY_INTERFACE.md**: the values templates fill (counts, comparisons,
  provenance) come through the repository interface's typed services. See that plan for the service
  contract that supplies the slot data.

## First steps (when this track opens)

1. **Dual-banding aggregation** in the graded rollup: split every cell's score into productive
   (`via:"composed"` only) and performance (all vias) bands from the existing product rows; emit the
   per-cell and per-grade **band gap**; add both to the CHATBENCH write-up template.
2. **The `template-lane` tag** in `chatbench/graded.mjs` + the lint, with its own dual-draw agreement
   line in `agreement.json`.
3. **The `technical` register**: extend `REGISTERS` in `templates.mjs`, add the slot-lint, author the
   first 3–5 C1 technical-paper templates over item-5 mechanical conclusions (count/compare/superlative
   + provenance), original phrasings, licence-clean.
4. **The acquirability ranking pass** in the cycle write-up: rank consistently-failed C1/C2 cells by
   the three-part test above; the top-ranked acquirable cell is the next cycle's pick.
5. Author one template-lane graded cell per acquired template so the flip is visible (the graded pool
   creates the cases that make the lever measurable, per Phase 4's contract).

## Open questions (settle before 5b)

- **Register validation**: is a template's C1 register enforced by a **judge dimension** (register/
  tone scored in the eval harness) or by **golden files** (an authored exemplar per template that the
  render must match)? The no-LLM-in-product rule keeps any judge in the eval harness only; a golden
  file is cheaper and deterministic but does not generalize to mined templates.
- **The chunk-becomes-grammar promotion**: should the productive band *ever* absorb a template once its
  pattern is compositionally reproduced? And if so, what independent evidence of composition (a
  rederivation over held-out slots?) is required before the re-credit is honest?
- **Diminishing returns**: how many templates per cell before acquisition stops moving the performance
  band, i.e. when does a cell's slot space saturate, and does the shopping list need a per-cell
  acquisition cap the way the tuning cycle caps levers per cycle?
- **Mining precision (5b)**: what slot-fillability threshold promotes a mined tier-2 candidate, and how
  is a mined template's register validated when there is no human author in the loop?
- **Reference debt**: `docs/references/papers/graded-language-measures.md` should gain a Wray
  *formulaic sequences* row (and the language-testing productive-vs-performance distinction) so the
  banding has a cited basis, web-verified when the reference library grows.
