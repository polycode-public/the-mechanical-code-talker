# PLAN_SYLLOGIST_EL_DL.md — beyond OWL 2 RL: an EL classifier, then a DL tableau prover

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.
Sequencing: this tier sits AFTER the two cheaper inference uplifts (complete OWL 2 RL
property reasoning; generalized Horn rule frames — `PLAN_NLU_BENCHMARKS.md` levers L7/L8)
on the effort-per-value ladder. The EL stage is worth doing on its own merits; the DL
stage is a costed option this document makes buildable, not a recommendation to build now.

## Where this sits

`src/domain/syllogise.mjs` today ships seven deterministic kernels, all inside the OWL 2 RL
fragment: subclass transitivity, type propagation, disjointness "provable no",
someValuesFrom application and subsumption, cardinality lower bounds, and max-0 denial —
under budget/focus/screen/trust guards, materializing off the hot path so a query-time
miss becomes a lookup. `PLAN_SYLLOGIST.md` surveys the field (RL is Datalog-shaped and
solved; DL satisfiability is tableau-shaped and solved; tmct's trust/provenance layer is
the part the literature is silent on) and owns the incrementality/retraction horizon.

Everything RL-shaped extends the current architecture with more pure kernels. This plan
covers the two tiers where that stops being true:

- **OWL 2 EL** — polynomial like RL, but a different *algorithm* (saturation-based TBox
  classification), not more forward-chaining rules. Buys reasoning about class
  expressions that were never declared as graph nodes.
- **OWL 2 DL** (target: ALC first, growing toward SHOIQ) — a tableau prover. Buys
  disjunction, complement, and case analysis. Worst-case complexity is NEXPTIME and
  beyond; budgets become part of the semantics, not a tuning knob.

Both stay inside the project ethos: pure JS, no LLM, deterministic (fixed rule-application
and branching order), $0 per query.

## The failure edge today — explicit examples

Each example: what the graph holds, what the user asks, what happens today, and where it
lands after delivery. "Today" behavior is the honest miss wall unless stated otherwise —
which is correct behavior, but these are all questions whose answers genuinely follow
from what tmct was told.

**E1 — nested existential classification (falls to EL).**
Graph: `heart ⊑ ∃hasPart.valve` (every heart has a valve), `valve ⊑ flap` (a valve is a
kind of flap). Ask: *"does a heart have a flap?"*
Today: miss. The shipped `scm-svf1` can only relate two restriction nodes that were BOTH
independently declared in the graph; the restriction `∃hasPart.flap` was never declared,
so nothing derives `heart ⊑ ∃hasPart.flap`. EL saturation constructs and classifies such
expressions as part of the algorithm.
After EL: "yes — every heart has a valve, and a valve is a flap."

**E2 — existential chains (falls to EL with role composition).**
Graph: `heart ⊑ ∃hasPart.valve`, `valve ⊑ ∃hasPart.hinge`. Ask: *"does a heart contain a
hinge, somewhere?"* Today: miss (no reasoning composes two existentials). After EL with a
transitive `hasPart` (or a declared chain axiom): yes. Note the overlap: plain `hasPart`
transitivity alone is RL (`prp-trp`, lever L7); the EL-only part is composing it through
*undeclared* intermediate class expressions as in E1.

**E3 — disjunction elimination (falls to DL).**
Teach: *"every pet is a cat or a dog"*, *"rex is a pet"*, *"rex is not a cat"*. Ask: *"is
rex a dog?"*
Today this fails one step earlier than inference: `unionOf` has no teach frame and no
stored representation ("or" in a teach sentence is not parsed), and "rex is not a cat"
triggers retraction (`RETRACT_NOT_A_RE`), not a negative assertion. So the knowledge
can't even be stated, let alone used. After phase 0 it stores; after DL, the prover
answers yes by case elimination — the first conclusions in tmct's history that require
reasoning by cases.

**E4 — complement classes (falls to DL).**
Teach: *"everything that is not aquatic is terrestrial"*, *"a stone is not aquatic"*.
Ask: *"is a stone terrestrial?"* Today: unrepresentable (`complementOf` does not exist in
the graph vocabulary) → miss. After DL: yes.

**E5 — contradiction through cardinality interplay (falls to DL).**
Graph: `bicycle ⊑ ≥2 hasPart.wheel` (at least two wheels), plus a taught
`beryl rdf:type bicycle` and a max-0 wheels restriction on beryl's class. Today: the
shipped max-0 denial and the ≥m lower-bound check each work alone, but
`findConsistencyViolations` only inspects disjointness — the min/max clash coexists
silently. After DL: the consistency pass reports the contradiction with both premises
named.

**E6 — enumerated classes / nominals (falls to DL).**
Teach: *"the primary colours are exactly red, yellow and blue"*. Ask: *"is teal a primary
colour?"* Today: `oneOf` is unrepresentable → miss. After DL: a provable no — closing a
class by enumeration is the honest route to "no, and I know the complete list", an answer
shape tmct doesn't have for any class today.

## Where the failure edge shifts after delivery

The point of naming the new edge now is that budget-exhausted proofs and out-of-scope
questions must land on the SAME honest miss wall the chat surface already has — a tableau
timeout is a miss, never a guess. Post-delivery, the edge sits at:

- **Arithmetic and datatypes.** *"does the bicycle have more wheels than seats?"* —
  comparing two derived counts needs a counting/arithmetic tier neither stage here
  designs; until one exists these land on the honest miss wall. (Concrete engineering
  does exist to adopt when wanted — SWRL built-ins, Datalog with aggregation.)
- **N-ary events and time.** *"alice gave bob a book yesterday; who had the book last
  week?"* — n-ary relations, fluents, temporal ordering. A further tier with known
  candidate literatures (reification, event calculus); lands on the miss wall until
  designed.
- **Defaults and exceptions.** *"birds fly; penguins are birds; penguins don't fly"* —
  non-monotonic. DL makes this a reportable *contradiction* (an improvement over silent
  coexistence) without resolving it by preferring the specific rule; defeasible
  reasoning is its own tier (default logic, answer-set programming are the candidate
  literatures, none yet settled into an obvious deterministic fit).
- **Budget-exhausted proofs.** Any query whose tableau exceeds its step budget returns
  "can't prove or disprove within budget" — surfaced as an honest miss with a distinct
  marker so chatbench can count them separately from parse misses.
- **Full FOL, probability, induction.** Open research horizons with no generally
  accepted engineering to adopt today; nothing in this plan depends on them, and their
  absence is benchmark-observable rather than something to legislate here.

## Design

**Stage EL — a saturation classifier (`src/el-classify.mjs`).**
ELK-style: normalize the TBox to EL canonical forms (`C ⊑ D`, `C1 ⊓ C2 ⊑ D`,
`C ⊑ ∃p.D`, `∃p.C ⊑ D`), then saturate with the EL completion rules to a fixpoint.
Polynomial; same operational shape as `syllogise()` (batch pass off the hot path,
budget/focus caps, deterministic ordering, conclusions written under `entailed:el-*`
provenance with `min(premiseTrusts) × ruleConfidence` trust, retractable by provenance).
Output is materialized subsumptions/memberships, so the existing ask lanes consume them
as ordinary lookups — no query-time changes at all.

**Stage DL — a bounded tableau prover (`src/tableau.mjs`).**
ALC first (⊓ ⊔ ¬ ∃ ∀), extending toward SHOIQ (transitive roles, role hierarchies,
nominals, qualified cardinality) in separately-tested increments. Query-time only, not
materialized in this plan's stages — a case-split conclusion depends on every branch of
its proof, and batch provenance/retraction for that shape is an open design problem a
later tier can take on with the JTMS groundwork as its starting point. Determinism:
fixed expansion-rule priority, lexicographic branch ordering, no randomization. Every
call returns a tri-state: proved (with the premise set, for trust and for a plain-English
proof rendering), disproved, or budget-exhausted (→ the honest miss above). Wired behind
an explicit `/prove` chat command first; only after chatbench shows it safe does it
become an automatic fallback on ask-lane misses.

**Shared groundwork (phase 0) — representation before inference.**
Teach frames and graph vocabulary for `unionOf` ("every X is a Y or a Z"), `complementOf`
("everything that is not X is Y"), `oneOf` ("the Xs are exactly A, B and C"), negative
type assertions ("rex is not a cat" as an assertion, today only a retraction trigger —
this is the "negative-capability data model" already on the deferred list), and
`differentFrom`. Everything stores, reads back, and round-trips with zero inference —
useful on its own (the graph can finally *hold* this knowledge) and prerequisite to both
stages.

## Steps

0. Phase-0 representation: vocabulary, teach frames, read-back, round-trip tests.
1. EL normalizer + saturation kernels, unit-tested against the OWL 2 conformance suite's
   EL subset; batch `tmct classify` verb beside `tmct syllogise`.
2. Wire EL conclusions into ask (E1/E2 become lookups); chatbench cases for the E1/E2
   shapes; measure groundedness movement.
3. ALC tableau core with tri-state + budgets; `/prove` command with plain-English proof
   rendering; conformance subset for ALC.
4. SHOIQ increments (transitivity, hierarchies, nominals, qualified cardinality), each
   with its own conformance slice — E3 through E6 land across these.
5. Consistency surfacing: extend the violation report to tableau-found contradictions
   (E5), with both premises quoted.

## Costs and risks

- **Size.** Stage EL is comparable to `src/domain/syllogise.mjs` today. Stage DL is the largest
  single component since `ask.mjs` — a real engine plus a conformance corpus. That cost
  is the reason for the sequencing note at the top.
- **Worst-case blowup is a semantics problem, not a perf problem.** SHOIQ is
  NEXPTIME-hard; budgets must be part of the contract from day one, and every
  budget-exhaustion must be observable (counted in chatbench) so silent weakening is
  impossible.
- **Trust for case-split proofs.** A disjunction-derived fact rests on all branches; the
  premise set for trust is the union. Decided before stage 3, not during.
- **Open-world honesty is load-bearing.** The CLINC out-of-scope result
  (`PLAN_NLU_BENCHMARKS.md`) is won by refusing what tmct can't ground. Nothing in
  phase 0 or the provers may introduce closed-world assumptions outside explicitly
  enumerated (`oneOf`) or explicitly negated knowledge.
- **Overlap discipline.** E2-style cases partially fall to cheaper L7 property rules;
  every example above gets a chatbench case tagged with the tier that should first solve
  it, so a cheaper tier landing early is visible and this plan shrinks accordingly.

## Not in this plan

- FOL, arithmetic, temporal/event reasoning, defaults, probabilistic weighting — each a
  further tier past DL; the "where the edge shifts" section above names the candidate
  literatures for whichever gets designed next.
- Incremental/RETE materialization and retraction algorithms (`PLAN_SYLLOGIST.md` owns
  that horizon).
- LLM involvement, including for proof rendering — proofs render through the same
  template machinery as every other answer, per the project's no-LLM product path.
