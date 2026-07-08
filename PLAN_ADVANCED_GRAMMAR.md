# PLAN_ADVANCED_GRAMMAR — research mechanisms for CEFR C1/C2 comprehension

*(Drafted 2026-07-07, post-0.8.2 gate. Status: RESEARCH PLAN, not yet a build order. This plan
STARTS WHERE THE TRIO ENDS — HANDOVER follow-up #3's pronoun-binding / temporal-over-relative /
discourse-count wave is in flight with measured targets; nothing here begins until those land and
re-measure. Sibling plans drafted concurrently: [[PLAN_INFERENCE_TESTING.md]] — the C1
logic/quantifier-entailment overlap lives THERE, referenced in §4, not duplicated here;
[[PLAN_ontology-hierarchies.md]] — the vocabulary/lexicon layer this plan's tracks (a)/(d) consume
as term reach; [[archive/PLAN_PREDICATE_QUERIES.md]] — a distinct product feature (not a research plan),
sequenced alongside this one's Phase-1 items, see `ROADMAP.md`'s near-term section for the live
cross-plan picture.)*

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

**(c) wink dependency-lite — a negative finding for the home-built chunker, but not because
symbolic parsing is dead; it's because the field walked away from it.** What wink actually
provides (ask-nlp.mjs adapter + wink-model.mjs loader): tokenization, sentence boundaries, POS
tags, lemmas, NER, custom-entity patterns. **No dependency or constituency parse.** A "dep-lite"
built as a home-grown POS-chunker (NP/VP shells → head-attachment heuristics) is L effort with a
known-hard accuracy cliff on exactly the constructions we'd need it for (PP-attachment and
attachment-under-embedding are the textbook hard cases — no amount of hand-tuned heuristic closes
that gap at general-English coverage). Verdict, unchanged: DO NOT build a general chunker. Narrow
admissible slice, unchanged: a POS-gated *clause splitter* (finite-verb counting to segment
subordinate clauses before the frame tables run) — that's an (a) enabler, S effort, keeps wink in
its current advisory role.

*Research frontier, named honestly.* "wink has no dependency parse" reads as a library gap; the
real fact underneath is that **rule-based, non-statistical dependency parsing is a largely
abandoned line of research**, and it was abandoned for funding/publication reasons, not because
it was proven inferior at any fixed data budget:

- Dependency grammar itself is old and symbolic in origin — Tesnière's *Éléments de syntaxe
  structurale* (posthumous, 1959) is the founding text: valency-based government from a verb to
  its actants/circumstants, diagrammed as stemmas, with no statistics anywhere in the formalism.
- **Covington's incremental algorithm** ("A Fundamental Algorithm for Dependency Parsing," *Proc.
  39th ACM Southeast Conference*, 2001; corrected reprint arXiv:2510.19996) is a genuine
  from-scratch symbolic method: process words left-to-right, test each new word against every
  previously-processed word for an attachable dependency, O(n³) worst case but near-linear on
  real sentences. No training data, no statistical model — it's a real, citable, purely
  rule-driven parsing algorithm.
- **Link Grammar** (Sleator & Temperley, "Parsing English with a Link Grammar," CMU tech report
  1991/1993, arXiv:cmp-lg/9508004) is the strongest existing proof this isn't vaporware: a
  dictionary of per-word "connector" disjuncts (jigsaw-piece link requirements) that a search
  procedure satisfies into a planar linkage — fully rule-based, no treebank training, LGPL C
  library still actively maintained today (v5.12.x, 2024; bindings for Python/Java/Node; used by
  AbiWord's grammar checker and the OpenCog project). It is real, embeddable, and *not neural* —
  worth naming specifically because it's the counter-example to "no symbolic parser survived."
  Its ceiling is coverage and ambiguity ranking on genuinely open English, not architecture.
- **Combinatory Categorial Grammar** (Steedman, *The Syntactic Process*, MIT Press, 2001) is the
  other live symbolic framework — categories carry their own combination rules (application,
  composition, type-raising), so syntax and semantics build in lockstep. CCG's own most-cited
  *application*, though, is Zettlemoyer & Collins's statistically-trained semantic parser
  ("Learning to Map Sentences to Logical Form: Structured Classification with Probabilistic
  Categorial Grammars," UAI 2005) mapping ATIS-style database queries to logical form — telling,
  because it shows CCG's natural home is a **closed query domain**, not open text, and that even
  there the field reached for statistics rather than a hand-built lexicon.
- The honest field-level fact, checked rather than assumed: the CoNLL 2017/2018 Universal
  Dependencies shared tasks were won outright by neural graph-based (biaffine) parsers, and every
  competitive dependency parser since is neural. Nobody is publishing hand-built symbolic
  dependency parsers anymore — not because Covington's algorithm stopped working, but because
  research incentives (leaderboards, treebank-scale eval, funding) all reward statistical
  approaches. **That abandonment is itself the finding worth recording**: this is a "known how,
  nobody kept building it" gap, not a "provably impossible" one — closer to an open frontier than
  a solved-and-discarded idea.
- The closed-domain angle this licenses, not built anywhere we can find: tmct's queries are not
  open English — they're a bounded vocabulary over a fixed relation set (imports/calls/tests/
  inherits/…, `ENTITY_TO_TYPE`/`VERB_TO_KIND`). **Grammar induction restricted to a closed
  domain lexicon is a much smaller problem than general parsing** — a Link-Grammar-style disjunct
  dictionary or a CCG-lite lexicon written BY HAND (not induced statistically) over tmct's own
  closed relation vocabulary is tractable at S–M effort precisely because the vocabulary is
  closed and the grammar doesn't need to cover the long tail of general English. Attempto
  Controlled English (Fuchs & Schwitter, "Attempto Controlled English — Not Just Another Logic
  Specification Language," 1996 onward, arXiv:cmp-lg/9603003) is the concrete existence proof for
  this pattern at large: a restricted, unambiguous English subset with a hand-built grammar that
  compiles deterministically to first-order logic, deployed for requirements specs and the
  semantic web for decades. tmct's ACE-OWL strategy (`src/grammar/ace.mjs`, wired in as its own
  additive class via `src/interpret/strategies/ace.mjs` and `src/interpret/pipeline.mjs`'s
  precedence-ordered `STRATEGIES` array) is already the same species of thing — a hand-written
  controlled fragment, own-class, clean-parse-or-null, never displacing the tolerant strategies.
  A "dep-lite" strategy scoped the same way — bounded disjunct/category dictionary over the
  closed relation vocabulary only, registered as another additive class beside `ace-fact`,
  refusing (returning null) rather than guessing outside its lexicon — would be a genuine step
  toward real dependency structure without inheriting general-parsing's accuracy cliff, because
  the cliff is a function of open vocabulary and unbounded ambiguity, neither of which this domain
  has. Nobody appears to have published this specific combination (symbolic dependency/categorial
  grammar, hand-built not induced, scoped to a closed code-relationship query domain as an
  additive strategy in a multi-strategy interpreter) — a real "no vehicle yet" idea, not a
  rediscovery of prior art. It is NOT scheduled (§4 still parks track (c) beyond the clause
  splitter) — this paragraph records the idea so it isn't re-discovered from scratch, not a green
  light to build it.

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

**(g) The permanent ceiling, kept honest — and named as a real research frontier, not just a
wall.** Winograd-class items need world knowledge —
graded-language-measures.md:18 ("pronoun resolution requiring world knowledge — the permanent
TOO-HARD ceiling markers") and ROADMAP.md:590's frame-problem language ("unsolved in the general
case and not pretended otherwise"). g-c2-pron stays 25 marker items, judged rarely, expected red;
a mechanism that "fixes" them via fixture-specific heuristics is overfit by definition and gets
reverted. Same bucket: irony, register, genuine idiomatic creativity.

*What the literature actually says, checked rather than recalled.* The Winograd Schema Challenge
was proposed as a *deliberately* statistics-resistant test: Levesque, Davis & Morgenstern, "The
Winograd Schema Challenge," KR-2012 (expanded from a Commonsense-2011 talk) — designed so
schema pairs are "Google-proof," i.e. "no obvious statistical test over text corpora … will
reliably disambiguate these correctly," specifically to rule out the co-occurrence shortcut a
frequency-count or embedding-similarity trick would take. That design goal is exactly why it's
the right ceiling marker for a no-LLM, no-statistics product: tmct is structurally the kind of
system the WSC was built to defeat, by intent, not by accident.

Is it "solved" now? Only partially, and the literature is explicit about the caveat. By ~2019,
transformer language models fine-tuned on WSC-style data crossed 90% — but Sakaguchi, Le Bras,
Bhagavatula & Choi built **WinoGrande** ("WinoGrande: An Adversarial Winograd Schema Challenge at
Scale," AAAI 2020, arXiv:1907.10641) specifically because the original 273-item WSC set turned
out to be small enough and stylized enough that models could be exploiting annotation artifacts
rather than reasoning; WinoGrande's AFLITE adversarial-filtering algorithm at 44k items closes
much of that gap and is measurably harder. Even more directly on point: Kocijan, Davis,
Lukasiewicz, Marcus & Morgenstern, "The Defeat of the Winograd Schema Challenge," *Artificial
Intelligence* 325 (2023) 103971 (arXiv:2201.02387) — a retrospective by two of the challenge's own
co-authors — concludes that LLM success on WSC-derived benchmarks is confounded by dataset bias
and "knowledge leakage" from web-scale pretraining that has since absorbed huge numbers of
Winograd-style sentences and their answers, not demonstrated proof of general commonsense
reasoning. **Read plainly: nobody has shown a system solves Winograd-class ambiguity by reasoning
from a closed, inspectable knowledge source; the systems that score well do so by having ingested
statistical traces of approximately this exact problem at planetary scale.** That is precisely the
resource tmct's no-LLM, no-training-data ground rule forbids, so the ceiling is not a tooling gap
tmct failed to build past — it's the one form of "success" on this benchmark that is fundamentally
unavailable to a deterministic, explainable system, and the field's own most careful authors say
the observed "success" elsewhere may not be real understanding either.

The other symbolic path — build a genuine commonsense knowledge base and reason over it instead of
using statistics — has a real, decades-long, largely-cautionary data point: **Cyc** (Lenat, from
1984; spun off as Cycorp in 1995), an explicit attempt to hand-encode on the order of 100 million
commonsense assertions in symbolic form, auditable and rule-based rather than statistical — the
closest thing that exists to "the WSC problem, taken seriously, at Cyc's scale of ambition." Forty
years on, Cyc is remembered in the field largely as a cautionary tale: enormous engineering effort,
modest and narrow deployed payoff, no publicly demonstrated general-commonsense breakthrough at
the scale originally promised. This is the honest ceiling on the *other* side of the tradeoff:
avoiding statistics by hand-building a knowledge base doesn't reliably work either, at least not at
anything like the effort tmct can spend. So the frame-problem framing already in this document is
correct on both branches, not just the statistical one — there is, as of this research pass, no
demonstrated third way that is both symbolic/deterministic and general-purpose.

*The genuinely speculative angle worth recording, scoped to what tmct actually has.* Every WSC
treatment in the literature above assumes an OPEN general-knowledge domain — that's the whole
point of the challenge, and why Cyc-scale effort was seen as the only symbolic answer. tmct's
situation is different in one structural way worth naming: its "world" is not open text, it's a
**complete, closed, already-loaded graph** (`.tmct/` OWL-labelled JSON — every entity, class, and
relation the reasoner will ever be asked about is already a node it can traverse, not a fact it
must retrieve or infer from unbounded background knowledge). A code-domain analogue of a Winograd
pair — "the function calls the module before it initializes; what does 'it' refer to?" — is not
actually open-domain commonsense in tmct's world: the antecedent candidates are a finite,
enumerable set of graph individuals with known classes and known relations to each other, and the
disambiguating "commonsense" fact (does a function initialize a module, or can a module initialize
itself; which relations are typically valid arguments for "initializes") is exactly the kind of
fact tmct's own schema (`ENTITY_TO_TYPE`/`VERB_TO_KIND`, class-gated focus per `nextFocus`,
`src/chat.mjs:268`) already encodes as data, not as reasoning. This reframes a subset of
Winograd-shaped ambiguity — NOT the general case, NOT irony/idiom/register, only the sliver where
disambiguation turns on a fact already present as a graph edge or a class constraint — as a
graph-query filtering problem rather than a commonsense-reasoning problem. We could not find this
angle built anywhere: the WSC and its successors are evaluated exclusively over open natural-language
sentences with no accompanying structured world model the reasoner is presumed to already possess
completely; grounding pronoun disambiguation in a closed, complete, already-available relational
graph — rather than either statistical priors or a hand-authored general commonsense KB — is a real
"no vehicle yet" idea specific to structured-domain chatbots. It would not touch the g-c2-pron
ceiling markers (those are deliberately open-world-flavored fixture items, by design unsolvable
this way) but could, as a DISTINCT and separately-named mechanism, extend track (b)'s DRT-lite
discourse record (typed entities/sets/times/propositions) with a class-constraint disambiguation
pass for the narrower "which graph-typed antecedent is relation-plausible" cases — worth a future
PLAN, not scheduled here, and must never be presented as "solving Winograd" since it explicitly
isn't the same problem.

*A closer, real theoretical grounding for what tmct already ships.* Ordinary anaphora resolution
over a small closed set of recent discourse referents — which is what `nextFocus`
(`src/chat.mjs:268`, this session's pronoun-binding fix) and the router's `bindAnaphor`
(`planner.mjs:116`) already do reasonably well — is NOT the frontier described above; it's
tractable and largely solved territory, and conflating it with Winograd-hard cases would be
dishonest. It does, however, have a real symbolic theory it currently only informally resembles:
**centering theory** (Grosz, Joshi & Weinstein, "Centering: A Framework for Modeling the Local
Coherence of Discourse," *Computational Linguistics* 21(2), 1995) formalizes exactly
`nextFocus`'s intuition — each utterance has a ranked list of "forward-looking centers"
(candidate referents) and a single "backward-looking center" (Cb, the standing topic); pronouns
preferentially realize the Cb, and a discourse is "coherent" (CONTINUE) when the Cb persists
across turns, versus SHIFT when it changes. `nextFocus`'s rule — a newly-resolved entity becomes
focus unless it's not focus-worthy AND a standing focus-worthy entity already exists — is a
two-rule, hand-specialized approximation of centering's ranking-plus-Cb-continuity preference,
with `FOCUS_WORTHY_CLASSES` doing the work centering theory would do with a general
salience/grammatical-role ranking. This is a genuine, cheap, low-risk opportunity distinct from
the Winograd frontier above: track (b)'s typed discourse record could adopt centering's Cb/Cf
vocabulary directly (rank forward-looking centers by graph-relation salience, not just recency;
track Cb continuity as a coherence signal for scoring which discourse-deixis reading is more
likely) — giving existing ad-hoc code real theoretical grounding, not new capability. Small,
citable, and worth doing inside track (b) rather than as new scope.

The C2 *number* will never
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
4. **Cross-plan phasing (2026-07-07 sweep):** track (a) (closed-frame subordination/conditionals),
   track (f) (presupposition nudges), and this plan's stage 0 pool growth are Phase-1 quick wins,
   executed alongside [[PLAN_ontology-hierarchies.md]]'s synonym-wiring stage,
   [[PLAN_INFERENCE_TESTING.md]]'s INFBENCH-harness stage 0, and [[archive/PLAN_PREDICATE_QUERIES.md]]'s
   core feature. Track (b) (DRT-lite) is Phase 2, still gated on the trio landing first as stated
   above. Track (e) (ellipsis, depends on (b)) and track (d)'s template-bank refactor are Phase 3.
   Track (c) beyond the narrow clause-splitter stays a recorded negative finding, not scheduled.
   See `ROADMAP.md`'s near-term section for the live cross-plan picture.

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
