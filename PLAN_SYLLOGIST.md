# PLAN_SYLLOGIST.md — beyond the shipped ladder: making the Syllogist itself smarter

> **STATUS: research/design notes — §3's own JTMS-shaped, VERIFY-backed slice (single justification
> per scm-sco fact, dependency-directed removal, bounded) is now IMPLEMENTED and tested
> (`retractSubClassOf`, `src/domain/syllogise.mjs`; see §3 for scope). §1/§2/§4/§5 remain notes only —
> and §1's beyond-RL survey now has a deeper sibling doc, `PLAN_SYLLOGIST_EL_DL.md`, which owns the
> EL-classifier/DL-tableau tier; this file owns the incrementality/retraction horizon.
> **2026-07-12: both chat-layer findings routed here from `BENCHMARK_CONVERSATION_1.8.14.md` are now
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

## 2. Incrementality (RETE / semi-naive evaluation) is also solved — `syllogise.mjs` just hasn't adopted it yet

`deriveSubClassClosure` (`src/domain/syllogise.mjs`) re-scans the full `succ` adjacency snapshot every
pass; the budget/focus/screen guards bound HOW MUCH work a pass does but not whether the pass
reuses work from the last one — there is no persisted match-state across calls. The classical
answer (compile the rule set into a discrimination network so a new fact only re-triggers the joins
it could actually affect) is Forgy's RETE algorithm (Forgy, C.L., "Rete: A Fast Algorithm for the
Many Pattern/Many Object Pattern Match Problem," *Artificial Intelligence* 19(1):17-37, 1982 —
verified) and its Datalog-world descendant, semi-naive evaluation, is exactly what ROADMAP already
names as tier-5's intended engine choice and what RDFox's production incremental engine actually
runs at scale (Motik et al. 2015, above). `syllogise.mjs`'s predicate-indexed edge-building (keying
facts by predicate so a pass doesn't rescan irrelevant rows) is a real step in this direction but it
is NOT yet an alpha/beta network — a genuinely incremental `syllogise()` (new fact in ⇒ only the
newly-enabled derivations computed, not a re-scan bounded by budget) is a known, citable technique
to port, not an open question.

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
cardinality monotonicity, and cax-maxc0 too — `PLAN_INFERENCE_TESTING.md` itself was pruned from
`archive/` in the 2026-07-14 doc cleanup, so it now lives only in git history), which is a
JTMS-shaped single justification per fact in spirit, though not yet a persisted, walkable one. A
further, NOT-currently-planned step toward the ATMS proper would track the small SET of alternate
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

**LANDED: the single-justification JTMS step — first for scm-sco, extended to all five rules
2026-07-15 (see the addendum).** The paragraph above's
first sentence — "today every entailed fact carries only a flat provenance TAG... never persisted
onto the fact itself, so there is no stored justification to walk at all" — is no longer true for
scm-sco: `syllogise()` now persists each scm-sco conclusion's two premise fact ids as
`mgx:factJustification` (`memory/core.mjs` `factIdForTriple`/`appendFacts`' `justification` param),
and `retractSubClassOf` (`src/domain/syllogise.mjs`) walks it — dependency-directed removal, bounded by
`budget`/`depth`, cascading through multi-hop chains. It does NOT stop at a bare justification walk
(the naive JTMS failure mode this file itself names, citing de Kleer): each candidate is re-VERIFIED
against the surviving graph (`buildAncestorCloser`, reused) before being removed, so a fact with a
genuine second derivation path, or one later independently taught, survives. Still open,
exactly as scoped above and NOT attempted: the true ATMS generalization (persisting every
alternate justification SET per fact, not just one — this slice's VERIFY step gets the same answer
for scm-sco's small rule set by re-deriving locally instead, which is cheap here but does not
generalize to a rule set where that local re-derivation itself gets expensive). Justification
tracking for the other four rules (cax-sco/cax-dw/cls-svf1/scm-svf1) landed 2026-07-15 — see the
addendum at the end of this file. Tests for both the retracting and the surviving
(independently derivable) cases live in `test/adapters/syllogise.test.mjs`'s `retractSubClassOf`
block.

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
filler ⊑ premise. A multi-hop ⊑ premise is cited as its direct edge, which scm-sco materializes in
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

Still on the horizon, unchanged from §3: the ATMS generalization (tracking every alternate
justification set per fact, de Kleer 1986). One concrete symptom this slice inherits from single
justifications: a survivor keeps its now-stale justification, so a later retraction of its OTHER
supporting path will not re-examine it, and the fact lingers until a fresh `syllogise` pass or an
ATMS-shaped re-grounding step is designed. Until such a tier exists, retraction stays a bounded
local check, and a lingering fact remains low-trust and retractable by provenance like every other
entailment.
