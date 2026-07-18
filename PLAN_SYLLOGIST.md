# PLAN_SYLLOGIST.md — beyond the shipped ladder: making the Syllogist itself smarter

> **STATUS (2026-07-18 delivery run): §2 and §3 are IMPLEMENTED — §2 as semi-naive delta
> evaluation (watermark + relevance frontier, see §2), §3 including the bounded environment sets
> (multiple premise sets per entailed fact, `mgx:factJustification`'s ' | '-separated environments,
> the `maxEnvironments` knob, set-membership retraction with survivor re-grounding —
> `syllogise`/`retractSubClassOf`, `src/domain/syllogise.mjs`; see §3 and the addendum).
> §1/§4/§5 remain notes only —
> and §1's beyond-RL survey now has a deeper sibling doc, `PLAN_SYLLOGIST_EL_DL.md`, which owns the
> EL-classifier/DL-tableau tier; this file owns the incrementality/retraction horizon.
> **2026-07-12: both chat-layer findings routed here from `archive/BENCHMARK_CONVERSATION_1.8.14.md` are now
> CLOSED, not design questions** — (1) "X is not a Y"/"forget that X is a Y" now call
> `retractSubClassOf` for real (`src/services/chat.mjs` teachLane, `RETRACT_NOT_A_RE`/`RETRACT_FORGET_RE`); (2)
> teaching against a subject that's also a real code-graph symbol (e.g. "Task") now stores and
> coexists with the graph fact — root cause was `src/domain/ask.mjs`'s `relaxParse` DROP-UNMATCHED layer
> silently re-reading a malformed declarative teach sentence as a different, valid elliptical
> QUESTION (dropping the taught object entirely) before the miss-gated teach lane ever ran; fixed by
> `runAsk`'s `relaxedTeachCollision` guard (`src/services/chat.mjs`), which restores the original graph answer
> if the teach attempt itself declines. Regression coverage: the retract/"not a"/"forget" rows in
> `test/corpus/inference.jsonl` (the corpus lane that absorbed the standalone teach-retract suite).
> Pulled out of `PLAN_INFERENCE_TESTING.md` on its own retirement, 2026-07-11. That file's own §4/§5
> carried this material as a long aside inside an otherwise-shipped build plan; it has been moved
> here, mostly verbatim (citations exactly as verified there), so it stands on its own instead of
> getting archived alongside a finished plan. Nothing else in this file is scheduled or staffed — it
> is a place to point a future session that wants to make `src/domain/syllogise.mjs` (tmct's forward-
> chaining reasoning engine, the growing "Syllogist") more sophisticated, not a to-do list.

## What problem this solves, and why it matters

`src/domain/syllogise.mjs` (five rules today — scm-sco, cax-sco, cax-dw, cls-svf1, scm-svf1 — see that
file's own header comment) has two structural limits neither `PLAN_INFERENCE_TESTING.md`'s shipped
ladder nor this session's trust-hook fix touched:

1. **It re-scans everything on every pass.** `deriveSubClassClosure` and its siblings recompute
   their whole candidate set from a fresh snapshot every time `syllogise()` runs; the `budget`/
   `focus`/screen guards bound how much work one pass does, not whether that pass reuses anything
   from the last one. There is no persisted match-state across calls.
2. **It has no principled way to retract a low-trust entailment without a full re-derivation.**
   `syllogise.mjs`'s own header comment promises every entailed fact is "fully RETRACTABLE by
   provenance when the source graph moves" — but nothing currently walks "if premise X disappears,
   what derived facts does that invalidate?" Today, un-believing something means re-running the
   whole batch pass and hoping dedup naturally sorts it out; there is no targeted mechanism.

The first is a known, solved problem in the literature — RETE/semi-naive evaluation, below — so it
is real, unstarted work but not a research question. **The second is the one piece of this file that
is genuinely open research, not "known technique, not yet ported," and it is worth being completely
plain about that distinction:** most of what "tier-5, the Syllogist" still needs is documented
engineering against a solved literature; a narrow, specific slice of it (retraction under a
trust-tiered, hard-budget, multi-derivation setting) is not a solved problem anywhere the search
below turned up. Naming that distinction precisely is the whole point of this document — so "we
haven't built it" is never conflated with "nobody knows how," and so the one part that actually
needs new thinking doesn't get lost in a pile of ordinary backlog items.

---

## 1. OWL 2 RL + DL tableau reasoning is a mature, solved field — reimplementing it here is real engineering, not research

OWL 2 RL was purpose-designed to be implementable as forward-chaining Datalog: the W3C's own
profile document states the design goal directly ("OWL 2 RL reasoning systems can be implemented
using rule-based reasoning engines") and proves it — Theorem PR1 gives soundness+completeness of
the rule-based reading for query answering, and §4.3's Tables 4-9 enumerate the COMPLETE rule set
as first-order implications over a ternary triple predicate (W3C, *OWL 2 Web Ontology Language
Profiles*, Second Edition, 2012, `https://www.w3.org/TR/owl2-profiles/` — verified by direct fetch).
Growing "the Syllogist" further is, in the literature's own terms, an implementation of an
already-published complete rule table, not an open design question. The same holds for the harder
DL fragments beyond RL: satisfiability/consistency checking for expressive DLs is solved by tableau
algorithms (Baader & Sattler, "An Overview of Tableau Algorithms for Description Logics," *Studia
Logica* 69(1):5-40, 2001; Horrocks & Sattler, "A Tableau Decision Procedure for SHOIQ," *Journal of
Automated Reasoning*, 2007 — both verified), and production reasoners built on exactly this theory
exist and are widely deployed: Pellet and HermiT are tableau-based OWL DL reasoners, RDFox is an
in-memory parallel Datalog/OWL-2-RL engine materialising up to 6.1M triples/sec (Motik, Nenov, Piro
& Horrocks, "RDFox: A Highly-Scalable RDF Store," ISWC 2015 — verified), and Apache Jena ships a
general rule engine for exactly this rule shape. **The genuinely tmct-specific part is narrower than
"build a reasoner": these mainstream systems assume a single trust tier — a fact is IN the closure
or it is not.** tmct's own requirement (`memory/trust.mjs` `SOURCE_PRIOR`, corpus 0.7 < teach 0.95 <
operator 1.0, entailed floor 0.3) that a corpus-sourced entailment must NEVER outrank a taught fact,
stay low-trust, and remain independently retractable is a governance layer the OWL 2 RL/tableau
literature does not address at all — it is silent on trust tiers because DL semantics has none. That
governance layer is this repo's own invention (already shipped), not a gap in the literature to
fill.

## 2. Incrementality (RETE / semi-naive evaluation) — IMPLEMENTED as semi-naive delta evaluation

The classical answer (compile the rule set into a discrimination network so a new fact only
re-triggers the joins it could actually affect) is Forgy's RETE algorithm (Forgy, C.L., "Rete: A
Fast Algorithm for the Many Pattern/Many Object Pattern Match Problem," *Artificial Intelligence*
19(1):17-37, 1982 — verified) and its Datalog-world descendant, semi-naive evaluation, which is
what RDFox's production incremental engine runs at scale (Motik et al. 2015, above).

`syllogise()` now runs the semi-naive form. The persisted match-state is a WATERMARK — the fact-id
set at the end of the last complete pass (`loadSyllogiseState`/`saveSyllogiseState`, a
backend-dispatched sidecar: `.tmct/memory/syllogise-state.json` on the flat-JSON backend, a handle
field in-memory, a meta row in sqlite). A default unfocused pass whose watermark still matches the
store (id-set diff — a retraction, snapshot restore or hand-edit breaks it and honestly forces
full) evaluates only the delta: scm-sco joins the since-watermark ⊑ rows against the full relation
(`deriveSubClassClosureDelta`, a textbook semi-naive closure with the full kernel's exact
contract), and the four later kernels are scoped by a RELEVANCE FRONTIER (`buildRelevanceFrontier`:
delta terms + their ⊑-descendants + instances typed in those classes + restrictions over those
fillers) as focus plus per-kernel input pre-filters. Conclusions are provably identical to a full
pass (the dedup screens make the frontier's over-approximation harmless; differential tests, one
per rule, pin it). The watermark advances only after an unfocused pass ending at a natural
fixpoint; `--full` forces full evaluation. The honest caveat: the pass still pays the full store
snapshot read — what became delta-proportional is candidate generation and the joins, not the
load. One named gap: a delta-mode cls-svf1 ALTERNATE environment enabled solely by a new filler
type outside the frontier waits for the next full pass (retraction stays correct through its
enumerate/boolean fallbacks). Chat's `/syllogise <term>` keeps its explicit-focus full path and
does not touch the watermark.

## 3. Retraction-aware consistency under a hard budget and trust tiers — the one genuinely open piece

This is worth naming precisely rather than folding into the OWL 2 RL bucket above, because unlike
sections 1-2, nothing found here is a straight port of an existing system.

The classical AI answer to "a belief was derived from premises, one premise later disappears, what
else must be un-believed?" is a Truth Maintenance System: Doyle's original JTMS (Doyle, J., "A Truth
Maintenance System," *Artificial Intelligence* 12(3):231-272, 1979 — verified) attaches a
justification (its supporting premise set) to every derived belief so retracting a premise triggers
dependency-directed removal of exactly the beliefs that justification supported; de Kleer's ATMS
generalizes this to track, per fact, the FULL SET of minimal premise-sets ("environments") that
would justify it, so a fact survives a retraction as long as ANY of its environments still holds (de
Kleer, J., "An Assumption-Based TMS," *Artificial Intelligence* 28:127-162, 1986 — verified). The
database/Datalog literature has its own answer to the same shape of problem in the classical
two-valued (in/out, one trust tier) setting: DRed deletes a superset of affected tuples then
selectively rederives them (Gupta, Mumick & Subrahmanian, "Maintaining Views Incrementally," ACM
SIGMOD 1993 — verified), and RDFox's own Backward/Forward algorithm improves on DRed specifically
because DRed over-deletes when a fact has many alternate derivations (Motik, Nenov, Piro & Horrocks,
"Incremental Update of Datalog Materialisation: the Backward/Forward Algorithm," AAAI 2015 —
verified). **None of these four citations natively carries tmct's actual requirement**: multiple
co-existing entailments at DIFFERENT trust tiers, where retracting a low-trust corpus premise must
re-evaluate only the derivations that actually depended on it, must never touch a higher-trust
taught-only derivation that happens to reach the same conclusion, and where the re-evaluation step
itself has to be boundable under the same hard idle-CPU budget the forward pass already obeys
(`syllogise.mjs`'s own BUDGET/FOCUS/SCREENS guards) — not "eventually consistent," bounded on every
call. That specific conjunction — bounded + incremental + trust-tiered + retraction-safe
justification tracking over a tiny rule set — is not a named, worked problem anywhere the search
above surfaced; the building blocks are each 30-45 years old and individually well understood, but
their combination under a hard low-resource budget looks like a genuine "no vehicle yet" gap, not a
reimplementation task.

**A concretely speculative, budget-respecting sketch** (offered as a direction, not a design): today
every entailed fact carries only a flat provenance TAG (`entailed:subClassOf`, etc.) — the pivot
class `via` that produced it is computed and returned in the pass's report but never persisted onto
the fact itself, so there is no stored justification to walk at all today. `PLAN_INFERENCE_TESTING.md`
§4 stage 2 already closed part of this: derivations now carry the premise trust figures needed for
`min(premiseTrusts) × ruleConfidence` (this session's own trust-hook fix extended that to scm-svf1,
cardinality monotonicity, and cax-maxc0 too (tmct's own name for the class-level generalization of
the real W3C `cls-maxc1`, not a W3C rule id) — `PLAN_INFERENCE_TESTING.md` itself was pruned from
`archive/` in the 2026-07-14 doc cleanup, so it now lives only in git history), which is a
ATMS-shaped single justification per fact in spirit (de Kleer's monotonic ⟨consequent, antecedents,
informant⟩, no outlist — not Doyle's JTMS), though not yet a persisted, walkable one. A
further step toward the ATMS proper (since landed — see below) tracks the small SET of alternate
premise-sets per derived fact rather than just one — cheap for tmct specifically because the rule
count is tiny (five rules today) so the number of alternate derivations per fact is expected to stay
small, unlike the general case ATMS was built for. Retraction would then become a set-membership
check ("does this fact still have any surviving justification after premise X is retracted?") scoped
to the fact's own small environment set, rather than a whole-graph re-scan — and the environment-set
size itself could carry a fourth budget knob alongside `depth`/`budget`/`focus`, so the mechanism
inherits tmct's existing bounded-idle-CPU promise instead of importing an unbounded ATMS
implementation. This stays within the ground rules (deterministic — justifications are computed
facts, not heuristics; explainable — a retraction's cause is the exact environment that failed;
bounded — a capped environment-set size; low-trust/retractable — the whole point). Untested,
unbuilt, and honestly speculative: nobody has published this exact narrow combination as a working
system, so there is no citation to verify here beyond the separately-real building blocks above —
flagged as such rather than dressed up as prior art.

**LANDED: the bounded ATMS proper — environment SETS per fact, all five rules.** The sketch above
is now the shipped mechanism. Every entailed fact persists its full set of independent premise-id
environments as `mgx:factJustification` (' | '-separated lists; a legacy single-list value parses
as one environment, so old stores upgrade on read with no rewrite). The set is capped by the
fourth budget knob the sketch asked for — `maxEnvironments`, default 4, `--max-environments` on
the CLI verb — kept deterministic: currently-stored environments first, newly discovered ones in
canonical enumeration order, deduped by canonical key, truncated at the cap. `syllogise()` grows
the sets: after the five kernels, an alternate-discovery step (spending its own copy of the budget
number, never the derivation budget) enumerates additional premise environments for the pass's
conclusions and for stored purely-entailed facts still under the cap. `retractSubClassOf` consumes
them exactly as §3 predicted — retraction is now a set-membership check first: a candidate whose
stored environment survives untouched is kept without any re-derivation, a candidate with no
intact environment gets a fresh enumeration from the survivors, and only then does the boolean
closure-walk re-VERIFY (the previous slice's mechanism) act as the final authority, so a
derivable fact still never falls to a stale citation. A survivor whose environments changed is
re-grounded — its pruned or fresh environments written back through the store's optional
`appendFacts` seam, with the best surviving environment's premise trusts re-stated for the three
premise-discounted rules so trust re-derives from what actually still supports the fact. Tests:
`test/adapters/syllogise.test.mjs` (environment persistence, cap determinism, set-membership
survival, re-ground trust) and the `inference.retract.stale-justification` corpus row.

## 4. Relevance under budget is the same open question wearing a different hat

`PLAN_INFERENCE_TESTING.md` used to carry two separate-looking bullets that are really one and the
same problem, restated: "the frame problem stays named" (which axioms to chain from a large base
under a hard budget — budget/focus truncation means a truthful "unproven" may really be "unproven
within budget," and the answer shape must say which) and "retraction is a real gap" (§3, above).
Both are asking the identical question from opposite directions: **given a bounded amount of work
per call, which facts matter right now** — forward, "which axioms should this pass chase" or
backward, "which derived facts does this one retracted premise actually touch." A retraction
mechanism that tracks per-fact justification sets (§3's sketch) would answer BOTH questions with the
same data structure: forward relevance becomes "which facts are reachable from the justifications
already indexed near the focus set," and retraction becomes "which facts cite the retracted premise
in their justification." That is the real reason this file treats them as one open question rather
than two separate stubs — solving the retraction problem well is very likely to also solve the
relevance problem, because they are the same graph walk run in opposite directions.

## 5. Progol/ILP — learning new rules, a separate and much smaller spike

Learning NEW inference rules (rather than executing hand-written ones) is a genuinely different
topic: Progol-style Inductive Logic Programming, adjacent to the shipped CEGIS rule synthesis
(`src/domain/router/goal-reasoner.mjs`, `synthbench/`) but not the same thing. It stays a separate far
spike from everything above; nothing in this document depends on it or blocks on it.

---

## Addendum, 2026-07-15 — justification landed for all five rules; the retraction cascade follows

The four rules that carried no persisted justification (cax-sco, cax-dw, cls-svf1, scm-svf1) now
persist one, the same way scm-sco already did: `syllogise()` writes each conclusion's premise fact
ids (content-addressed via `factIdForTriple`) as `mgx:factJustification`. Each rule cites its own
premise shape: cax-sco the type premise plus the direct ⊑ edge; cax-dw the type premise, the
disjointWith premise (orientation-resolved, since the symmetric relation is stored one way) and the
⊑-lift when there is one; cls-svf1 the property edge, the filler's type, the restriction's two
scaffolding rows and the ⊑-lift; scm-svf1 the two restrictions' four scaffolding rows plus the
filler ⊑ premise. A multi-hop ⊑ premise is cited as its direct edge, which scm-sco materialises in
the same pass; a citation left dangling by budget truncation is inert, because retraction
re-verifies every candidate rather than trusting the citation.

`retractSubClassOf`'s cascade now covers all five rules' conclusions, keeping the same bounded,
re-verified local check: per round it collects purely-entailed facts whose justification cites a
removed id, then re-derives each candidate against the surviving facts using the rule family that
owns its predicate (`buildSurvivorDerivabilityCheck` in `src/domain/syllogise.mjs`). A conclusion still
independently derivable survives. The entry point stays subClassOf-rooted, because chat's
recognized retraction phrasings ("X is not a Y", "forget that X is a kind of Y") retract ⊑ facts;
from there the cascade reaches propagated types, disjointness violations, and restriction
membership/subsumption. Tests: one per rule in `test/adapters/syllogise.test.mjs`, each with a
retracting half and a surviving (independently derivable) half; the pre-existing scm-sco retraction
tests run unchanged.

The ATMS generalization this addendum used to leave on the horizon has since landed (see §3): a
fact now tracks its SET of alternate premise environments (de Kleer 1986, bounded by the
`maxEnvironments` knob), and the stale-justification symptom named here is closed — a survivor is
re-grounded onto its surviving or freshly enumerated environments, so a later retraction of its
other supporting path finds and removes it. Retraction stays a bounded local check; the boolean
re-derivability walk remains the final authority beneath the set-membership fast path.
