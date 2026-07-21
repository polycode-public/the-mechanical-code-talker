# PLAN_BENCHMARK_LADDERS.md — a domain-appropriate ladder for each of the four benchmarks

Status: DELIVERED — implemented and measured at 2.6.0 (the four `BENCHMARK_*_2.6.0.md` reports; `CAPABILITIES_2.6.0.md` audit §4.3). The body below is the design as written.

## Why this exists

Four benchmarks measure tmct, and three of them wear the same borrowed clothes. CEFR's
`A1…C2` letters were the right vocabulary for the language benchmark (`chatbench/graded.mjs`),
and they leaked from there into AGENTBENCH (`A0…C2` in `agentbench/grade.mjs`) and INFBENCH
(`INF-A1…INF-C2` in `infbench/grade.mjs`) as a local faux-standard. Each skill doc already
carries a paragraph apologising for the collision and telling the reader not to compare an
`AGENT C1` against a `CEFR C1` against an `INF-C1`. A shared letter is doing work a shared
axis does not justify.

This plan does three things:

1. **Part 1** gives AGENT and INFERENCE a taxonomy drawn from their own domain (tool-use
   capability; logic-fragment expressivity), keeps CEFR on CEFR, and renames CONVERSATION's
   flow tiers so all four ladders read as distinct scales. It states how the rename keeps
   comparability with the 2.5.0-era reports.
2. **Part 2** adds two genuinely new top tiers to CEFR, AGENT, and INFERENCE — each a new
   dimension, the way C1+C2 added abstract and nuanced language over B1+B2, not more of the
   same rung.
3. **Part 3** turns CONVERSATION's open-ended Tier 0–6 flow ladder into a bounded, gated
   ladder with a ratchet criterion per tier, and reconciles it with the persona sweep.
4. **Part 4** states the one shared model the four then share: a bounded named ladder plus an
   unbounded edge-search that feeds it.

The current reports the design starts from: `BENCHMARK_CEFR_ENGLISH_2.5.0.md` (mean 1.817,
tier-1 108/109, the pool tests 9 of 23 construction shapes), `BENCHMARK_AGENT_2.5.0.md`
(goal driver 56/56, every rung PASS, C2's 11 cases all green — "the ladder has more headroom
than the corpus tests"), `BENCHMARK_INFERENCE_2.5.0.md` (259/259 chat, 90/90 kernel, INF-C2
flipped from ceiling to live consistency detection), and `BENCHMARK_CONVERSATION_2.5.0.md`
(persona sweep, ~30 dead-ends, and the proof that walks a subclass chain without consulting a
stored `owl:disjointWith`).

All new tiers below sit at the honest-miss floor until the capability behind them ships. A
tier that names a capability tmct does not have yet is a horizon, named with its candidate
build path, never a wall.

---

## Part 1 — a domain-appropriate taxonomy per benchmark

### CEFR-English — keep CEFR, tighten the framing

CEFR stays. This is the one benchmark where the borrowed vocabulary is not borrowed: it
grades an English-language surface, and CEFR is the standard reference vocabulary for
language difficulty. `chatbench/graded.mjs` keeps `GRADES = ["A1","A2","B1","B2","C1","C2"]`
and the construction axis unchanged.

One framing correction, no code change. The report already says the quiet part out loud:
"the grade bands measure construction difficulty rather than a difficulty gradient tmct
experiences" and "the ladder is still not monotonic (A1 at 1.636 sits below C1 at 1.867)".
Make that explicit in `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1 as a one-line statement of what the
CEFR axis is: **CEFR grades the difficulty of the CONSTRUCTION under test, borrowing CEFR as a
difficulty vocabulary. It is not a claim that tmct reads or writes at a CEFR level.** The real
signal lives on the construction axis (the grade × construction cell), which is why the cell
table, not the per-grade marginal, is where the report finds the floor. Nothing renames; the
framing note removes the one reading the letters invite.

### AGENT (AGENTBENCH) — a tool-use capability ladder

The `A0…C2` rungs measure agentic capability: can the router pick and sequence the right tool
call(s) without hallucinating one and without exceeding what it can ground. `grade.mjs`'s own
comments already describe each rung by its tool-use meaning. The rename gives each rung a name
from that meaning and drops the CEFR letters.

Proposed taxonomy — the **TOOL ladder**, `TOOL-0…TOOL-6`:

| new | old | name | what it tests |
|---|---|---|---|
| TOOL-0 | A0 | Direct dispatch | one obvious tool, arguments on a plate |
| TOOL-1 | A1 | Tool selection | pick the right tool from a declared set, bind one entity |
| TOOL-2 | A2 | Scope refusal | refuse cleanly when no declared tool fits or the entity does not resolve (closed-world default-deny) |
| TOOL-3 | B1 | Sequential composition | a bounded multi-step recipe: thread one result into the next call |
| TOOL-4 | B2 | Conditional dispatch | branch on a result; retry |
| TOOL-5 | C1 | Goal planning | compose a plan for a novel goal, closed-world |
| TOOL-6 | C2 | Goal deduction | self-directed: deduce the goal, then plan it |

This is a real capability progression, not a re-lettering. It matches the shape external
tool-use benchmarks grade on: the Berkeley Function-Calling Leaderboard's category axis
(simple call → multiple-function selection → parallel → relevance/irrelevance detection →
multi-turn), API-Bank's three ability levels (call → retrieve-then-call →
plan-retrieve-then-call, Li et al. 2023), and τ-bench's tool-agent-user multi-turn setting
(Yao et al. 2024). The survey framing is Qin et al. 2023, "Tool Learning with Foundation
Models". TOOL-2's "refuse when nothing fits" is BFCL's relevance-detection category and is the
rung that carries tmct's honest-miss promise into the router.

Nothing about the tool set or the gate changes: rungs still run in order, the gate is still
0% hallucination at ≥50% plan-completion (`COMPLETION_FLOOR`), and a clean refusal on an
`expect.refuse` case is still a PASS.

### INFERENCE (INFBENCH) — a logic-fragment expressivity ladder

The `INF-A1…INF-C2` bands measure classical-logic inference, and the natural ladder for that
is the one the repo already reasons about: logic-fragment and description-logic expressivity,
from atomic assertion through OWL 2 RL to EL and DL. `PLAN_SYLLOGIST_EL_DL.md` lays out that
progression exactly (five RL kernels shipped, two steps just outside RL, then EL saturation,
then a DL tableau). The current six bands map cleanly onto fragments, so the rename keeps the
`INF-` prefix (which already reads as "inference", not CEFR) and replaces the CEFR letters with
a fragment name and an ordinal.

Proposed taxonomy — `INF-1…INF-6`, named by fragment:

| new | old | name | fragment / rule | current templates |
|---|---|---|---|---|
| INF-1 | INF-A1 | Assertion | atomic ABox/TBox lookup, no rule fires | `a1Lookup` |
| INF-2 | INF-A2 | Taxonomy | subclass transitivity (RL `scm-sco`) | `a2ChainLen2` |
| INF-3 | INF-B1 | Contradiction & quantifier | disjointness "provable no" (RL `cax-dw`) + existential-not-universal reading | `b1Disjoint`, `b1Existential` |
| INF-4 | INF-B2 | Restriction | someValuesFrom application + long chains (RL `cls-svf`/`scm-svf`) | `b2ChainLenK`, `b2Svf1`, `b2Svf1Apply` |
| INF-5 | INF-C1 | Cardinality | cardinality lower bounds (first step outside RL, monotonicity) | `c1Cardinality`, `c1ScmSvfApply` |
| INF-6 | INF-C2 | Consistency | disjointness-clash detection across stored memory | `c2Inconsistent` |

Grounding: the W3C OWL 2 Profiles recommendation (RL, EL, QL), the description-logic
expressivity names (ALC, SHOIQ, SROIQ) from the DL literature, and the repo's own
`PLAN_SYLLOGIST_EL_DL.md` and `PLAN_SYLLOGIST.md`. The band order and the gate are unchanged:
bands run in order, PASS is 0% fabrication at ≥50% completion, the first failing band gates
those above it, and a clean 0% on an unbuilt capability is a ceiling marker.

### CONVERSATION — name the flow tiers as their own ladder

The Tier 0–6 flow ladder is already domain-appropriate (it grades conversational complexity,
not CEFR), and each tier already has a descriptive label in `SKILL_BENCHMARK_CONVERSATION.md`
§2.1. Two things to do: give the ladder a name that reads as its own scale, and make its
ratchet mechanical (Part 3 below). The name: the **FLOW ladder**, `FLOW-0…FLOW-6`, carrying
the existing tier meanings.

| new | current | name |
|---|---|---|
| FLOW-0 | Tier 0 | Bootstrap (identity, greeting, seeded vocabulary, no graph) |
| FLOW-1 | Tier 1 | Single touch + one drill-down |
| FLOW-2 | Tier 2 | Drill-down chains with anaphora |
| FLOW-3 | Tier 3 | Cross-concept and relation touches |
| FLOW-4 | Tier 4 | Compositional and comparative |
| FLOW-5 | Tier 5 | Teach + recall + reasoning in dialogue |
| FLOW-6 | Tier 6 | The messy real user |

This is a naming and bounding change, not a content change. The tiers, entry points, and the
surface-variation axis (§2.2) stay as written.

### Migration and comparability — how the rename keeps prior reports comparable

The skill docs make the case set sacred and append-only for one reason: editing a case
"invalidates every prior cycle's comparison against it". A pure label rename does not
invalidate a comparison as long as the old label and the new label are known to name the same
rung. So the migration is a labelled bijection landed at a single version boundary, not a
mid-arc case edit.

**Recommendation: rename once, at the next version bump (call it vNext), and commit a
bijective alias map beside each grader. The alias map is the comparability bridge — a
pre-vNext report's `A0` is the same rung as a vNext `TOOL-0`, by definition of the map. The old
letters live on only in already-written reports and in the map.**

Concretely, per benchmark:

- **AGENTBENCH.** `agentbench/cases.jsonl` is hand-maintained (not generated), so its `rung`
  field is updated in a single atomic relabel commit at vNext — `A0`→`TOOL-0`, and so on. Add
  `export const RUNG_ALIASES = { "A0":"TOOL-0", … }` (and its inverse) to `agentbench/grade.mjs`
  beside `RUNGS`, and change `RUNGS` to the `TOOL-*` array. A label relabel with a committed
  bijection is not a semantic case edit: the `request`, `tools`, and `expect` of every case are
  byte-unchanged, so nothing a prior cycle measured moves. Record the migration in the vNext
  `BENCHMARK_AGENT_<version>.md` as a taxonomy migration, not a case-set change.
- **INFBENCH.** `infbench/cases.jsonl` is a build artifact, never hand-edited, so the rename
  lands in the generator: change the `band:` strings in `infbench/generate-cases.mjs` and the
  `BANDS` constant in `infbench/grade.mjs` (`INF-A1`→`INF-1`, …), then regenerate. Add
  `BAND_ALIASES` to `grade.mjs`. `test/estate/generated-artifacts.test.mjs` already guards the
  file's reproducibility, so it will confirm the regenerated set is the intended one and nothing
  else drifted.
- **CHATBENCH.** No rename. CEFR stays, so there is nothing to alias.
- **CONVERSATION.** The FLOW-* names are prose in the skill doc and the report, not a machine
  field, so the rename is a doc edit plus the alias line in the report's ladder-position
  section. No case set to migrate.

The alias maps are small, permanent, and the honest translation for anyone comparing a vNext
report to a 2.5.0-era one. They belong in the grader next to the rung/band constant so a reader
finds them where they look for the ladder.

---

## Part 2 — two new top tiers each for CEFR, AGENT, INFERENCE

Each pair below is a new dimension, not a taller version of the current top. For each: the new
dimension and why it is a real jump, the two tier names in the new taxonomy, example cases
(verbatim input + expected behaviour), and the exact append-only generator change.

### CEFR — a new axis above the construction matrix (pragmatics, then discourse)

**There is no CEFR band above C2, so the uplift is a new axis, not a seventh grade.** Every
construction in the pool today is a single-utterance surface-parse difficulty: naming, passive
voice, quantifier counting, garden-path recovery. The new axis is meaning that is not in the
sentence's literal form (pragmatics) and meaning that spans turns (discourse composition).
That is a genuine jump because the challenge stops being "parse this surface" and becomes
"infer what was meant" and "compose across what was already answered". It is added as a new
construction family layered on the existing grade × construction matrix, and it is explicitly
**not** a claim that tmct handles a super-C2 language level — the CEFR letters still only
vocabulary-grade construction difficulty.

**Tier P1 — Implicature.** The answer depends on what is meant, not what is said: indirect
speech acts, conversational implicature (Grice's maxims), presupposition beyond the parse.
Grounding: Grice 1975 (cooperative principle / implicature), Searle on indirect speech acts,
and the repo's `PLAN_DIALOGUE_ACTS.md`. Example cases (each authored at a real CEFR grade,
construction `pragmatic-implicature`):

- Input: `do you know what calls Widget?` — a yes/no in form, a request for the callers in
  use. Expected: answer the callers, not "yes".
- Input: `I don't suppose store.mjs imports anything?` — a negative-polarity indirect ask.
  Expected: answer the imports, honouring the real question rather than the surface negation.
- Input: `is only Widget untested, or are there others?` — the "or are there others" presupposes
  a set. Expected: answer the untested set honestly, resolving the presupposition.

**Tier P2 — Discourse composition.** A query whose meaning is complete only when composed
across several prior turns — not single-hop anaphora (pronoun-binding already covers one
referent), but composing multiple prior ANSWERS into a new inference. Grounding: centering /
discourse-structure theory (Grosz, Joshi & Weinstein; Grosz & Sidner), and it is the axis
CONVERSATION measures qualitatively but CEFR never has. Example cases (construction
`cross-turn-composition`, graded C2):

- Turns: `what does store.mjs import` → `and what do those import` → `which of all those is
  untested`. Expected: the composed untested subset of the transitive import set, carried from
  two prior answers.
- Turns: `who calls createTask` → `who calls them` → `so what is the full call chain into
  createTask`. Expected: the composed call chain, not a re-answer of the last turn alone.

**Exact generator change (append-only).** In `chatbench/graded.mjs`, append two names to
`CONSTRUCTIONS`: `"pragmatic-implicature"` and `"cross-turn-composition"` (and add their cells to
`GRADED_MATRIX` at C1/C2). In `chatbench/graded-pool.jsonl`, append the new cases as ordinary
graded-pool rows (`{ id, grade, construction, turns[], expectations, tags }`); the P2 rows carry
multi-turn `turns[]`. No existing case is touched, satisfying the append-only rule. Record the
addition in the write-up. Until the pragmatic/discourse routing exists in the product, these
cases sit at the honest-miss floor and the judge scores them as misses — the tier is a named
horizon, and the report says so, the same way INF-C2 sat as a ceiling marker before its
capability shipped.

### AGENT — recovery, then composition under ambiguity

AGENT tops out: the goal driver clears TOOL-6 (old C2) at 56/56, all 11 top-rung cases green,
and the 2.5.0 report says the ladder has more headroom than the corpus. The two new tiers add
the dimensions a clean straight-line plan never exercises.

**Tier TOOL-7 — Recovery and replanning.** New dimension: a plan step fails at execution — a
tool returns empty or an error, or the first branch does not resolve — and the driver must
observe the failure and replan (a different tool, a fallback path) rather than terminate on the
dead branch. Every tier up to TOOL-6 assumes a plan that executes cleanly; TOOL-7 is the first
tier where a step can fail and the run must notice and recover. Grounding: the observe-act
literature (ReAct, Yao et al. 2022; Reflexion, Shinn et al. 2023) and τ-bench's multi-turn
recovery. Example cases (`rung: "TOOL-7"`):

- Request: `find the callers of Widget, and if it has none, list its exports instead`. Tools:
  `[tmct_callers, tmct_exports]`. Expected: call `tmct_callers{symbol:"Widget"}`, observe empty,
  then `tmct_exports{module:…}`; result-completion is the exports. (Recovery on an empty result.)
- Request: `describe the module that defines createTask; if that symbol is unknown, say so`.
  Expected: resolve `createTask` → module, then `tmct_describe`; on a non-resolving symbol, a
  clean refusal naming the unknown symbol — recovery as an honest refuse, never a hallucinated
  call.
- Request: `list the untested symbols in Widget's module, and if it is fully covered, say so`.
  Expected: `tmct_untested` scoped to the module, observe an empty set, compose the
  "fully covered" report rather than emit a bare empty.

**Tier TOOL-8 — Composition under ambiguity.** New dimension: the goal is underspecified or the
entity is ambiguous, and the correct behaviour is to enumerate the tied readings
(`candidateResults`, one dispatched read per tied candidate — the shape the skill already
blesses) or to refuse-with-a-nudge, never to pick one arbitrarily and never to hallucinate.
TOOL-7 recovers from a known failure on a resolved entity; TOOL-8 faces genuine
underspecification where there is no single right plan. Grounding: BFCL's relevance/irrelevance
detection, τ-bench's underspecified-goal handling, and tmct's own ambiguous-refusal-with-
candidates invariant in `SKILL_BENCHMARK_AGENT.md` §1. Example cases (`rung: "TOOL-8"`):

- Request: `what depends on store` where both `src/core/store.mjs` and a `Store` class resolve.
  Tools: `[tmct_importers, tmct_callers]`. Expected: a refusal carrying `candidateResults` (one
  dispatched read per tied candidate), not an arbitrary pick. PASS = ambiguous refusal with both
  candidates.
- Request: `clean up the dead code`. Expected: a clean refusal — no tool fits the vague
  imperative — naming what it can do instead (list untested or unused symbols) and asking which
  was meant; zero hallucinated call.
- Request: `compare the two handlers` with three handler modules present. Expected:
  refuse-with-candidates or ask to disambiguate; never silently compare an arbitrary two.

**Exact generator change (append-only).** Append `TOOL-7` and `TOOL-8` to `RUNGS` in
`agentbench/grade.mjs` (after `TOOL-6`). Append the new cases to `agentbench/cases.jsonl`.
TOOL-7 cases need a small grader extension: an optional `expect.recover` marker naming the
fallback branch that must fire after the first branch returns empty/error, and a check in
`grade.mjs` that the fallback call actually fired. TOOL-8 cases reuse the existing
`expect.refuse` plus `expect.candidateResults` shape; extend the grader so an ambiguous case
PASSES iff the driver refuses AND the candidate set matches (no arbitrary pick, no hallucinated
call). Fixture-lint every `expect.result` literal by running it, per the skill's rule. No
existing case is edited. Both tiers gate at the honest floor on the current goal driver until
the recovery and disambiguation capabilities ship — named horizons, with the router work
(a replanning branch in `src/domain/router/planner.mjs`; a tied-candidate composer in the goal
reasoner) as the build path.

### INFERENCE — constructed restrictions (EL), then reasoning by cases (DL)

INFERENCE tops out at INF-6 (Consistency), 259/259, every band green. The two new tiers are
exactly the two stages `PLAN_SYLLOGIST_EL_DL.md` designs, plus the one live soundness gap the
CONVERSATION sweep found.

**Tier INF-7 — Constructed restriction (OWL 2 EL).** New dimension: classify through class
expressions that were never declared as graph nodes — nested existentials and existential
chains — which needs EL saturation, a different algorithm from more forward-chaining. Every
band up to INF-6 relates nodes or restrictions that were explicitly declared; EL constructs and
classifies undeclared expressions. Grounding: `PLAN_SYLLOGIST_EL_DL.md` Stage EL (examples E1,
E2), the W3C OWL 2 EL profile, and the ELK classifier. Example cases:

- Premises: `every heart has a valve`, `every valve is a flap`. Query: `does a heart have a
  flap?` Expected: `yes`, entailed `heart ⊑ ∃hasPart.flap`. (This is E1; a miss today, so a
  ceiling marker until Stage EL ships.)
- Premises: `every heart has a valve`, `every valve has a hinge`, `hasPart` transitive. Query:
  `does a heart contain a hinge?` Expected: `yes`. (E2, existential chain.)
- Control (minimal pair, provable within declared nodes today): `every heart is an organ`,
  `every organ has a cell`, query stays within declared nodes → `yes` now. The control makes the
  tier discriminate: an engine that refused everything would fail it, so only a real EL classifier
  clears both the probe and the control.

**Tier INF-8 — Reasoning by cases (OWL 2 DL) and disjointness-sound proof.** New dimension:
case analysis — disjunction elimination, complement classes, enumerated classes — which needs a
tableau prover with branching (⊔, ¬), the first tmct conclusions that require reasoning by
cases. INF-7's EL is still Horn and deterministic-saturation; INF-8 introduces branching.
Grounding: `PLAN_SYLLOGIST_EL_DL.md` Stage DL (examples E3, E4, E6), the ALC → SHOIQ → SROIQ
progression, and the DL literature. Example cases:

- Premises: `every pet is a cat or a dog`, `rex is a pet`, `rex is not a cat`. Query: `is rex a
  dog?` Expected: `yes` by case elimination. (E3; needs phase-0 union/negative-assertion
  representation and then the tableau — a ceiling marker until Stage DL.)
- Premises: `everything that is not aquatic is terrestrial`, `a stone is not aquatic`. Query:
  `is a stone terrestrial?` Expected: `yes`. (E4, complement.)
- **The disjointness-sound-proof case (from `BENCHMARK_CONVERSATION_2.5.0.md`, routed item 1):**
  Premises: `rex is a dog`, `every dog is a cat`, `no dog is a cat`. Query: `is rex a cat?`
  Expected verdict: `inconsistent`, or a refusal naming the disjoint clash — NOT `yes with a
  proof`. This pins soundness: a subclass proof must consult `owl:disjointWith` on the resolved
  chain before it certifies a conclusion. This one is a **near-term live discriminator**, not a
  far-horizon DL item: it flips from ceiling to live the moment the proof-path fix the CONVERSATION
  sweep already routed lands, well before the full tableau exists. It is the concrete cross-benchmark
  link — a defect the persona sweep found becomes a pinned INFBENCH case.

**Exact generator change (append-only).** Append `INF-7` and `INF-8` to `BANDS` in
`infbench/grade.mjs`. In `infbench/generate-cases.mjs`, append new templates: `elNestedExistential`
and `elExistentialChain` emitting `band:"INF-7"`; `dlDisjunction`, `dlComplement`, and
`dlDisjointProofSoundness` emitting `band:"INF-8"`. Each template pins `expect.verdict` to the
honest floor (`unproven`/miss) until its capability ships, exactly as `b2ChainLenK` pins the
"cannot be proven" floor today; the `dlDisjointProofSoundness` template pins `inconsistent` and is
a live discriminator as soon as the proof-path fix lands. Regenerate; `test/estate/
generated-artifacts.test.mjs` confirms the file is reproducible. No existing template is edited.

---

## Part 3 — CONVERSATION: a bounded, gated FLOW ladder

CONVERSATION today has an open-ended qualitative flow ladder (FLOW-0…FLOW-6, ratchet "only
when the tier is clean") plus a persona sweep and a capped sprint. The open-endedness is the
gap: "clean" is a judgment call, and there is no mechanical gate the way the other three
benchmarks have one. This part gives it the same shape: a bounded ladder with an explicit
per-tier ratchet criterion, fed by the persona sweep as its edge-search.

### The ladder is bounded

Seven named tiers, FLOW-0 through FLOW-6 (Part 1). There is no open "FLOW-7": FLOW-6 (the messy
real user) is the top, and new complexity that does not fit an existing tier grows that tier's
content, it does not add a rung. The ladder measures; it is bounded by construction so it can.

### The ratchet criterion (mechanical, per tier)

A FLOW tier **ratchets clean** — unlocking the tier above — when both hold:

1. **Fresh conversations flow.** At least three fresh conversations at this tier, from
   distinct entry points, replay with zero dead-ends (§0/§1b's definition: every turn answers
   or gives a guiding nudge).
2. **Every routed dead-end at this tier is frozen and green.** Each dead-end the edge-search
   found at this tier, and that a later session fixed, has a `test/chatflow-*.test.mjs`
   regression tagged to the tier, and it passes on the current tree.

Criterion 2 is what makes the ratchet mechanical rather than a vibe. A tier is not "clean
because it felt clean this run"; it is clean because its accumulated regressions are green and
a fresh pass finds nothing new. This mirrors the other three ladders: INFBENCH's gate is a
grader receipt, AGENTBENCH's is the 0%-hallucination-at-50% metric pair, and CEFR's is the
tier-1 deterministic row. FLOW's gate is "fresh-flow-clean AND frozen-regressions-green".

### The gate order

FLOW tiers ratchet strictly FLOW-0 → FLOW-6. A tier that is not clean gates every tier above
it, and the report says where the ladder currently sits and why — the same
skipped-with-a-receipt discipline the other three use. At 2.5.0 the ladder sits at FLOW-0: the
`i wanna know about a horse` teach-misroute (routed item 8) is a confident-wrong at Tier 0, so
by criterion 1 the tier is not dead-end-free, and nothing above it is measured as ratcheted.

### An honest-guiding-nudge is a pass, a wall is not

A FLOW tier can name a capability tmct does not have yet. There the bar is not "answer" — it is
"guide": an honest miss that offers a nudge, a repair, or an offer to learn keeps the
conversation alive and counts as flow. A bare wall does not. A capability genuinely missing is
routed to a `PLAN_*.md` as a horizon (the completions pipeline and the multi-hop proof
materialisation are the standing examples), never marked a permanent ceiling.

### Reconciling the ladder with the persona sweep

The persona sweep (§3.4) is not a second ladder. It is the **edge-search that feeds the
ladder**. The loop:

1. The persona sweep runs several genuinely different frames in parallel and finds new
   dead-ends — the frames reach cases a single-frame ladder pass never would (the `john is a
   man` miss, the `blast radius` teach-misroute, the disjointness-blind proof).
2. Each dead-end is routed (§1 Step 4) to a `NEXT.md` open item or a `PLAN_*.md`.
3. A later session fixes it and freezes a `test/chatflow-*.test.mjs` regression, tagged to the
   FLOW tier the dead-end belongs to.
4. That frozen regression becomes ladder content: it is exactly what criterion 2 counts when
   the tier next tries to ratchet.

So the sweep is unbounded (it keeps finding new edges across new frames) and the ladder is
bounded (it accumulates the fixed edges as gated content). The capped sprint (§3) and full
ladder (§2) modes stay as they are; the sweep is the default single-run edge-search, and the
FLOW ladder is what its findings graduate into. This is the same "a ladder plus a playtest
edge-search" shape the other three benchmarks have — CONVERSATION just names both halves now.

---

## Part 4 — the unifying frame

Every benchmark, after this plan, has two parts:

- **a bounded, named ladder** in a taxonomy drawn from its own domain, gated so the first
  failing rung gates those above it, and append-only so cross-version comparison holds; and
- **an unbounded edge-search** that finds new failures, which then graduate into ladder
  content.

The four instances:

| benchmark | ladder taxonomy | its edge-search |
|---|---|---|
| CEFR-English | CEFR grade × construction, plus the P-axis (implicature, discourse) | the full-pool `graded-pool-max.jsonl` sweep and new-construction authoring |
| AGENT | TOOL-0…TOOL-8 tool-use tiers | adversarial and corpus-depth case authoring against the goal driver |
| INFERENCE | INF-1…INF-8 logic-fragment tiers | the `PLAN_SYLLOGIST*` research horizon and generator-template growth |
| CONVERSATION | FLOW-0…FLOW-6 flow tiers | the persona sweep (§3.4) |

The ladder is the ruler: bounded, so it produces a number and a gate. The edge-search is the
horizon-walker: unbounded, so it keeps finding what the ruler does not yet measure. A finding
graduates from the second into the first when it is understood well enough to pin — a generator
template, a case row, a frozen regression. That is the single model the four now share, and it
is why a taxonomy per benchmark matters: each ladder should read as a ruler for its own domain,
not a borrowed set of letters.

---

## Implementation order and the evidence each change needs

Sequenced cheapest-and-safest first. Evidence tiers are per `SKILL_CAPABILITIES_AUDIT.md` §1:
(1) tool-layer contract tests, (2) corpus lane rows, (3) the estate structure guards, (4)
benchmarks measure quality, not existence.

1. **The taxonomy rename (Part 1), at the vNext boundary.** Lowest risk: a relabel plus alias
   maps, no behaviour change. Changes `agentbench/grade.mjs` (`RUNGS` + `RUNG_ALIASES`),
   `agentbench/cases.jsonl` (the `rung` field, one atomic commit), `infbench/generate-cases.mjs`
   and `infbench/grade.mjs` (`band` strings + `BANDS` + `BAND_ALIASES`, then regenerate), and the
   two skill docs plus CONVERSATION's report prose. Evidence: the agentbench case-lint and the
   `grade.mjs` unit tests pass with the new `RUNGS` (tier 1); `test/estate/generated-artifacts.
   test.mjs` confirms the regenerated `infbench/cases.jsonl` is reproducible under the new band
   strings (tier 3); a new unit assertion that each alias map is a bijection over its rung/band
   set (tier 3). This is a rename, so no capability-existence claim moves.

2. **CONVERSATION's bounded ladder and ratchet (Part 3).** A doc change plus the discipline of
   tagging `test/chatflow-*.test.mjs` regressions to a FLOW tier. No product change. Evidence:
   the existing and future `test/chatflow-*.test.mjs` rows are the tier-2 corpus evidence the
   ratchet criterion counts; the report records the ladder position with a receipt. The first
   concrete win to freeze is the routed backlog already in `BENCHMARK_CONVERSATION_2.5.0.md`.

3. **CEFR's P-axis (Part 2), append-only.** Additive: two construction names in
   `chatbench/graded.mjs`, new rows in `chatbench/graded-pool.jsonl`. Nothing else must change to
   MEASURE the tier — the cases sit at the honest-miss floor until the pragmatic/discourse routing
   exists, and the report names them as a horizon. Evidence: the graded-pool cases are tier-4
   quality signal; when a routing capability lands, whoever lands it freezes a corpus lane row
   (tier 2) and cites it. Watch the tier budgets — a new construction family must not push
   `test:fast` past its budget; `npm run check:budgets` holds it, and a tier over budget is a bug
   in the tier, cut content rather than raise the number.

4. **AGENT's TOOL-7 / TOOL-8 (Part 2), append-only plus a grader extension.** Additive cases,
   two new `RUNGS` entries, and the `expect.recover` / `expect.candidateResults` grading checks.
   The tiers gate at the honest floor on the current goal driver until the recovery and
   disambiguation capabilities ship. Evidence: unit tests in `agentbench/grade.mjs` for the new
   recovery and candidate-set checks (tier 1); fixture-lint every `expect.result` by running it
   (the skill's own rule); the router build (a replanning branch, a tied-candidate composer) is a
   separate, later change with its own regression tests, not part of authoring the cases.

5. **INFERENCE's INF-7 / INF-8 (Part 2), append-only.** New generator templates and two new
   `BANDS` entries. INF-7 and most of INF-8 sit at ceiling markers until `PLAN_SYLLOGIST_EL_DL.md`
   Stage EL and Stage DL land; the `dlDisjointProofSoundness` case is the near-term exception,
   live as soon as the CONVERSATION-routed proof-path fix ships. Evidence: the generator
   regenerates byte-identical, guarded by `test/estate/generated-artifacts.test.mjs` (tier 3); the
   kernel-arm and chat-arm gradings are the tier-4 benchmark signal; when the proof-path fix lands,
   its corpus lane row (tier 2) is the existence evidence and the INF-8 soundness case is its
   benchmark witness.

Across all five: any commit that reaches `main` runs the full `npm test`; a checkpoint or a
worktree commit runs `test:fast` plus the blast radius (the touched generator's regeneration
guard, the touched grader's unit file). The rename in step 1 is the one change whose blast
radius is wide by construction — it touches a shared, generated artifact (`infbench/cases.jsonl`)
— so follow the generator, not the diff.

### Open questions for the operator

1. **AGENT relabel on a sacred case set.** The `rung` field on the hand-maintained
   `agentbench/cases.jsonl` gets rewritten in the migration. This plan argues a bijective relabel
   is not a semantic case edit (request/tools/expect are byte-unchanged, and the alias map
   preserves every prior comparison), so it is compatible with the append-only rule. That reading
   is the operator's to confirm, since the case set is called sacred. The alternative — keep `A0`
   as the machine key forever and show `TOOL-0` only in rendering — leaves the borrowed CEFR
   letters in the data, which defeats the rename's point; this plan does not recommend it, but names
   it.
2. **Author the INF-8 disjointness-soundness case now, or wait for Stage DL?** It is a live
   discriminator the moment the CONVERSATION-routed proof-path fix lands, long before the tableau.
   This plan recommends authoring it now, at the ceiling marker, so the fix has a benchmark witness
   the day it ships. Confirm.
3. **The CEFR P-axis on a benchmark named CEFR_ENGLISH.** Adding a pragmatics/discourse axis to a
   benchmark whose name and grades are CEFR is a naming tension worth a decision: keep it inside
   CHATBENCH as a new construction family (this plan's choice, lowest friction), or split the
   pragmatics/discourse axis into its own benchmark later. The plan frames it as a new axis, not a
   super-C2 claim, but the housing is the operator's call.
4. **The two new AGENT tiers need new `expect` fields** (`recover`, and the `candidateResults`
   grading path). Confirm the grader extension is in scope with the case authoring, or whether the
   cases land first at a declared ceiling and the grader extension follows.
