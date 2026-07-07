# PLAN_ADVANCED_GRAMMAR — research mechanisms for CEFR C1/C2 comprehension

*(Drafted 2026-07-07, post-0.8.2 gate. Status: RESEARCH PLAN, not yet a build order. This plan
STARTS WHERE THE TRIO ENDS — HANDOVER follow-up #3's pronoun-binding / temporal-over-relative /
discourse-count wave is in flight with measured targets; nothing here begins until those land and
re-measure. Sibling plan drafted concurrently: [[PLAN_INFERENCE_TESTING.md]] — the C1
logic/quantifier-entailment overlap lives THERE, referenced in §4, not duplicated here.)*

**Ground rules, restated because everything below is tempted to violate them.** The product is
no-LLM, permanently (ROADMAP "out of scope"); every mechanism must be deterministic, explainable,
and closed — the 0.8.2 method (closed frames, first-match-wins, unmatched text passes through
byte-unchanged, `src/interpret/normalize.mjs:110-128`) is the licensed pattern. The ladder rule
governs spend: **B1 reliable before judging C-grades** (ROADMAP.md:361-364; GRADED.md "Ladder
gating" — B1 exit = grade mean ≥ ~1.5, all B1 cells dual-draw-agreeing, no v1/promoted
regression). The operator's lever board ranks **C2 ceiling LAST** (ROADMAP.md:366-375). Honest
framing: this is a plan to *earn the right to climb*, mostly by widening what C1 measures and
making B-grade machinery compose — not a plan to "pass C2".

## 1 — Ground truth: what C1/C2 mean here, and what the pool actually measures

CEFR C1/C2 are *human* proficiency bands; GRADED.md:30-37 already adapts them (C1 = deep
composition: 2–3-hop chains, 3-branch coordination, temporal-over-relative, cross-session assert
recall; C2 = ceiling markers: Winograd-style binding, center-embedded relatives). The standard
CEFR phenomenon list is wider. Inventory against the committed pool (`chatbench/graded-pool.jsonl`,
matrix of record GRADED.md:49-58 — C1: temp 50†, rel 25, coord 25, assert 25, neg+rel 25;
C2: pron 25, rel 25; † = census cell):

| CEFR phenomenon | band | measured today? | in-domain for a code-graph QA bot? |
| --- | --- | --- | --- |
| Multi-hop embedded relatives | C1/C2 | YES — g-c1-rel, g-c1-neg-rel, g-c2-rel (center-embedded, symbol grain) | yes — core |
| 3-branch coordination, precedence | C1 | YES — g-c1-coord (precedence-agnostic items only admitted) | yes |
| Temporal composition over relatives | C1 | YES — g-c1-temp (census, 50; 9 reds are trio targets) | yes |
| Cross-session assert+recall | C1 | YES — g-c1-assert (also a stale judged tag, CHATBENCH_0.8.2 deferral) | yes |
| Winograd-class coreference | C2 | YES — g-c2-pron, by design permanent ceiling | markers only (§2g) |
| Complex subordination (because/although/while/whereas) | C1 | **NO** | yes — causal/concessive framing of real queries |
| Conditionals, incl. counterfactual ("if X were deleted, what breaks") | C1 | **NO** | yes — reads naturally as hypothetical graph queries |
| Ellipsis / gapping ("and b.mjs?", "same for tests") | C1 | **NO** | yes — high-frequency developer register |
| Stacked modality + passive ("which modules might have been left untested") | C1 | **NO** | partial — modality mostly reduces to the plain query + hedged render |
| Discourse deixis ("the former", "the second one", "that list") | C1 | **NO** (only those/them/these — ask-vocab.mjs:620 ANAPHORA_TRIGGERS) | yes |
| Presupposition ("why does a.mjs still import the deprecated store?") | C1/C2 | **NO** | yes — as honest-nudge (§2f) |
| Idiomaticity, irony, register play | C2 | **NO** | **mostly OUT** — a code bot has no license to read irony; misreading it is worse than walling. Idioms only as closed WRONG_WORDS-style corrections |
| Garden-path robustness | C2 | **NO** | partial — worth a small adversarial cell (anchored templates are actually garden-path-immune by construction; measure, don't build) |
| Implicit arguments ("who reviewed?" ← reviewed *what*) | C2 | **NO** | partial — resolvable only from discourse state (§2b), else honest miss |

Surprise from the inventory, stated plainly: **the C2 band is only two constructions** (pron +
rel), so "C2 0.69" (cycle-3, ROADMAP.md:352) measures Winograd failure + center-embedding — not
"C2 English". And **five of the six unmeasured C1 rows are in-domain**; the C1 mean is currently
computed over the five things we're best at. Growing the pool FIRST (§3) is not optional
book-keeping — today's C1 number would be *flattered* by any mechanism work that dodges the gaps.

## 2 — Mechanism research tracks

Summary table; detail below. Effort S/M/L; feasibility = deterministic-no-LLM feasibility.

| # | track | unlocks | feasibility | precedent | effort | risk |
| --- | --- | --- | --- | --- | --- | --- |
| a | Closed frames → subordination + conditionals | C1 subordination, conditional cells | HIGH | 0.8.2 preamble frames, PHRASING_FRAMES (normalize.mjs:189-290), NEGATION_SET (316-336) | S–M | frame-table sprawl; ordering bugs |
| b | DRT-lite typed discourse record | C1 discourse deixis, ellipsis substrate, implicit args, better pron | HIGH | ask() `prev` id array (ask.mjs:967-975), chat focus (chat.mjs:74-118), router bindAnaphor (planner.mjs:116) | M | state poisoning (recall-hygiene lesson) |
| c | wink dependency-lite parsing | freer word order, unanchored clauses | **LOW-MED** — wink-eng-lite gives tokens/POS/lemma/NER/sentence, **no dependency parse**; a dep-lite is home-built POS-chunking | none beyond ask-nlp.mjs lemma/POS tier | L | accuracy cliff; competes with (a)/(d) which are cheaper for the same cells |
| d | Construction-grammar template banks | per-construction closed coverage at data-not-code cost | HIGH | data/templates/grammar-rules.toml + responses.jsonl; Phase-6 formulaic competence (dual banding already separates template-carried passes) | M | performance-band inflation; must stay template-lane-tagged |
| e | Ellipsis/gapping resolution | C1 ellipsis cell; huge feel win ("and the tests?") | MED-HIGH, **after (b)** | discourse-count anaphora (trio); merge.mjs same-class dedupe | M | wrong-antecedent = confident-wrong (worse than wall) |
| f | Presupposition as honest-nudge renders | C1/C2 presupposition cells, honesty dimension | HIGH | 0.8.2 wall-kindness nudges (riskiest/opinion/why-untested); honest-empty receipts | S | thin reward if cells stay unjudged; kill-criterion applies |
| g | Winograd / world knowledge | nothing — by design | N/A (frame problem) | ROADMAP.md:590; graded-language-measures.md:18 | 0 | only risk is forgetting they're markers |

**(a) Scale the closed-frame method to subordination + conditionals.** The 0.8.2 evidence is that
delimiter/phrase-anchored frames rewriting onto canonical shapes clears whole cells without
touching the grammar (preamble frames flipped playtest walls; determiner dedupe; the B1
set-complement frame is the same species). Subordinate clauses in this domain are mostly
*strippable framing* ("since we're refactoring, which modules import x?" → strip) or *reorderable
conditions* ("if a module imports store, is it tested?" → "which modules import store" ∘ tested
filter — an AST composition the compositional grammar's qualifier machinery already half-owns,
ask-vocab.mjs QUALIFIERS:499, BOOLEAN_CONNECTIVES:484). Counterfactuals ("if a.mjs were deleted,
what would break") compile to reverse-dependency closure — a real traversal, honestly renderable
with a hypothetical marker in the answer. Deliverable: a SUBORDINATION_FRAMES table + a
CONDITIONAL frame family compiling to existing AST nodes; refuse (honest miss) any conditional
whose consequent isn't a computable traversal. This track is first because it's the proven method
at its next size up.

**(b) DRT-lite discourse record.** Today's discourse state is three scattered singletons: chat
focus `{id,label}` (chat.mjs), ask()'s `prev` id array threading (evalAnaphora, ask.mjs:967 —
"no-prev → honest miss"), and the router's `bindAnaphor(text, lastEntity)` (planner.mjs:116).
The trio's pronoun work deepens the binder; this track TYPES the record: a small append-only
per-session structure `{entities:[{id,kind,turn}], sets:[{ids,sourceQuery,turn}], times:[…],
propositions:[{asserted,turn}]}` — DRT's discourse referents, minus the logic (which is
[[PLAN_INFERENCE_TESTING.md]]'s side of the seam). Everything downstream reads it: discourse
deixis ("the second one" = sets[last].ids[1]; "the former" = ordered entity mentions), implicit
arguments (unfilled slot → most recent type-compatible referent, else honest miss naming the gap),
and (e). Guardrails learned from 0.8.2 recall hygiene: walls/misses never enter the record; the
record is per-session, never persisted to `.tmct/`; every binding is surfaced in the answer
("them = the 3 modules from your last question") so a mis-bind is *visible*, in ethos.

**(c) wink dependency-lite — mostly a negative finding, recorded so we stop re-asking.** What
wink actually provides (ask-nlp.mjs adapter + wink-model.mjs loader): tokenization, sentence
boundaries, POS tags, lemmas, NER, custom-entity patterns. **No dependency or constituency
parse.** A "dep-lite" would be a home-built POS-chunker (NP/VP shells → head-attachment
heuristics) — L effort, and its accuracy on the exact constructions we care about (attachment
under embedding) is the known-hard part of parsing. Verdict: DO NOT build a general chunker.
Narrow admissible slice: a POS-gated *clause splitter* (finite-verb counting to segment
subordinate clauses before the frame tables run) — that's an (a) enabler, S effort, and keeps
wink in its current advisory role (tiers off gracefully when the model is absent, the standing
viewer-bundle boundary).

**(d) Construction-grammar template banks.** Per-construction closed template families as
*data* (`data/templates/constructions/*.toml`: pattern → AST skeleton, slot types validated
against ENTITY_TO_TYPE/VERB_TO_KIND), loaded into a strategy beside grammar.mjs's anchored T1–T8.
This is how (a)'s frame tables avoid becoming a 2,000-line normalize.mjs: same semantics, moved
to committed data with provenance, mirroring Phase 6's acquisition path (mined candidates promoted
into data/templates/). Interaction with honesty: any template-carried pass stays in the
performance band, never productive (GRADED.md dual banding, `isTemplateLane`) — but note these
templates parse *questions* rather than render answers, so most passes will still be
`via:"composed"` and legitimately productive; the banding question only bites for canned renders.

**(e) Ellipsis/gapping over the discourse record.** "which modules import store?" → "and b.mjs?"
/ "same for classes" / "what about tests?". Resolution = re-instantiate the previous parsed AST
(kept in the (b) record as the set's `sourceQuery`) with the fragment substituted into the
type-matching slot. Deterministic, explainable ("reading that as: which modules import b.mjs"),
and refusal-friendly (no type-compatible slot → honest miss). Depends hard on (b); the 0.8.2
determiner-dedupe "what about the logger" path is the single-frame ancestor.

**(f) Presupposition/implicature as honest nudges.** We never *accommodate* silently; we NAME the
presupposition — "why does a.mjs still import the deprecated store?" → "checking the
presupposition first: a.mjs does import store (yes); store deprecated — I have no fact saying so"
— then answer what survives. Fits the honesty ethos exactly (0.8.2's why-untested/opinion nudges
are the render precedent); S effort as a render-layer pass over failed/partial presupposition
checks of definite descriptions and *still/again/stop* triggers (a closed trigger lexicon —
Levinson's classic list is small and finite).

**(g) The permanent ceiling, kept honest.** Winograd-class items need world knowledge —
graded-language-measures.md:18 ("pronoun resolution requiring world knowledge — the permanent
TOO-HARD ceiling markers") and ROADMAP.md:590's frame-problem language ("unsolved in the general
case and not pretended otherwise"). g-c2-pron stays 25 marker items, judged rarely, expected red;
a mechanism that "fixes" them via fixture-specific heuristics is overfit by definition and gets
reverted. Same bucket: irony, register, genuine idiomatic creativity. The C2 *number* will never
be pretty; its job is to stay on the record as the boundary of the machine.

## 3 — Measurement-first staging

**Stage 0 (with the trio, no new mechanisms): grow the C1/C2 pool.** New cells via
generate-graded.mjs (deterministic, auto-authored expectations, frontier items keep
`baselineFail` + `observed`): C1 subordination (25), C1 conditional (25, incl. counterfactual
items), C1 ellipsis (25 — multi-turn `mode:"turns"`), C1 discourse-deixis (25), C1
presupposition (25), C2 garden-path (25, adversarial), and grow g-c2-rel toward 50 if surface
variation allows. That takes C1 from 150 → ~275 and gives every §2 track a target *before* it
exists — expectations authored from fixture ground truth, so today's engine reds are honest
frontier, not failures. Also per CHATBENCH_0.8.2: the four under-covered dual-draw cells
(incl. C1 coordination-compositional) get pool/sample growth here.

**Ladder discipline (unchanged, restated).** All new C-cells run **tier-1-only** (free,
dual-draw) until the B1 exit criterion clears. Current honest B1 state: the last full-spectrum
*judged* reading is still cycle-3 (B1 0.77); since then negation + reversible-passive shipped
(ROADMAP Phase-5 status), 0.8.2 flipped B1/C1 side-effect cells deterministically, the 0.8.1
judged record is STALE on graded assert cells, and the trio targets the remaining 18 g-b1-pron +
5 g-b1-temp reds. **Whether B1 has actually cleared ≥1.5 is unknown until the post-trio judged
re-baseline** — that re-judge (bundled with HANDOVER follow-up #1's stale-tag re-judge) is this
plan's gate, and nothing in §2 buys judged C-spend before it.

**Per-stage exit criteria + predictions** (SKILL_TUNING_CYCLE.md step-1: prediction recorded
BEFORE each cycle, predictions-vs-actuals in the write-up):

| stage | ships | exit criterion (tier-1 unless noted) |
| --- | --- | --- |
| 0 | pool growth + trio re-measure | all C-cells dual-draw AGREE; B1 judged re-baseline taken; baseline green-rates recorded per new cell |
| 1 | (a) frames + (c-narrow) clause splitter | subordination + conditional cells ≥ 0.8 green; zero regression on 334-case v1 line + promoted A1/A2 |
| 2 | (b) discourse record + (e) ellipsis | ellipsis + discourse-deixis cells ≥ 0.6 green; no recall-hygiene regressions (mr-* anchors) |
| 3 | (d) template banks (refactor of a) + (f) nudges | frame tables data-driven, byte-identical behavior; presupposition cell green; judged honesty non-regressing on hm-* |
| 4 | judged C1 re-read (only if B1 exit held ≥ 2 cycles) | C1 judged mean over the WIDENED pool ≥ cycle-3's 1.07 — beating the old mean on a harder pool is the real bar |

## 4 — Sequencing and dependencies

1. **Waits on the trio**: (b) extends the trio's binder; the temporal-over-relative fix defines
   which g-c1-temp reds remain; discourse-count's re-measure feeds the (e) baseline. Starting (b)
   mid-trio would collide on the same seams (ask.mjs prev/focus threading) — serialize.
2. **Shared surface with [[PLAN_INFERENCE_TESTING.md]]**: C1 quantifier/entailment items
   ("every module that imports X…", monotonicity, assert-then-infer) belong to that plan's
   Syllogist-adjacent track; this plan's (b) record is the *carrier* (propositions land in it),
   that plan owns what follows from them. One pool-growth pass, two owners — coordinate cell
   naming so no construction is double-counted in both plans' exit criteria.
3. Order inside this plan: 0 → 1 → 2 → 3 → 4 (3's template-bank refactor deliberately trails 1
   so the data format is extracted from working frames, not designed speculatively).

## 5 — Risks / honesty

- **Judged-tier cost**: re-judge touched tags only (the standing bench-reuse rule, HANDOVER);
  census C-cells judged once per run (draw B adds nothing, GRADED.md); C2 judged only to confirm
  it's still a ceiling.
- **Overfit-to-judge / overfit-to-pool**: generator-authored items come from fixture ground
  truth, never engine output — keep it that way; any frame written to a specific red item's
  phrasing (rather than a construction family) is the bAbI failure mode GRADED.md §licence was
  built to avoid.
- **Kill-criterion (the tone-of-voice precedent, ROADMAP Phase LATER)**: a mechanism that
  doesn't move its target cells' green-rate/mean within its cycle is parked, written up, and its
  seam kept — dropped for thin reward is a *good* outcome, not a failure. Prime suspects: (c)
  beyond the clause splitter, (f) if the presupposition cells prove rare in real playtests.
- **Confident-wrong is the cardinal sin**: (b)/(e) mis-binds must render their binding visibly;
  the 0.8.2 fuzzy-entity FALSE EMPTY residual (HANDOVER follow-up #2.2) is the cautionary class.
