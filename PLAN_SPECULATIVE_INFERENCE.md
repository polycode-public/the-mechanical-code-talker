# PLAN_SPECULATIVE_INFERENCE.md — thinking ahead about the right things

The Phase 8 plan (operator-specified 2026-07-05). Phase LATER's tier-5 — **the Syllogist** — answers
a query-time MISS by deductive inference on demand: a well-formed question misses everywhere, so run
the inference layer over the OWL-encoded facts + axioms and, if the answer is *entailed*, materialize
it with a proof-chain. Phase 8 is the step BEFORE that: instead of waiting for the miss, PROACTIVELY
extend memory during idle/fold time with inferences that will be useful later — forward chaining
(materialize entailments from facts + axioms) and backward chaining (from the query shapes we actually
get asked, pre-derive the answers). Same inference engine as the Syllogist (OWL 2 RL forward-chaining
recommended there — datalog-style, polynomial, decidable, rule-by-rule explainable), run
*speculatively* rather than *reactively*. This plan is deliberately modest: the mechanics are the easy
half, and it says so.

## Context — where this sits

- **The engine is shared, not new.** Phase 8 does not design an inference layer; it schedules the one
  tier-5 defines. If the Syllogist isn't built yet, Phase 8's first rule (below) is a legitimate
  minimal seed of it — the two plans converge on the same OWL 2 RL materializer.
- **The write path exists.** `memory/core.mjs`'s `appendFact({subject,predicate,object,provenance})`
  already RDF-reifies a triple, dedupes by content hash, and unions provenance across writers. A
  speculative pass is just a caller of `appendFact` with an `entailed:<rule>` provenance tag — no new
  storage shape. The facts it reads are the same reified `Fact` individuals, and the axioms are the
  OWL constructs the ACE grammar emits (`rdfs:subClassOf`, `owl:Restriction`/`someValuesFrom`,
  `owl:disjointWith`, cardinalities — `docs/references/schemas/ace-owl-fragment.md`, grounded in
  `ontology/tmct-core.ttl`).
- **The idle hook exists.** `memory/fold.mjs`'s `foldSessionLogs()` already runs at session end — it
  cleans the session's turns into a corpus block. That seam is tmct's natural idle moment: the human
  has stopped talking, the CPU is free, and we already know exactly *what the session touched*. Phase 8
  hangs a bounded speculative pass off the same hook, scoped to that session's footprint.
- **The query shapes are legible.** `ask.mjs`'s `parseQuery` compiles a question to a structured parse
  (`{shape, kind, entityType, object[, subject]}`, or the compositional AST); `memory/core.mjs` already
  stores each request's parse under `mgx:utteranceParsed`. So "what shape of question do we get asked"
  is *already recorded* — backward chaining has data to mine without new instrumentation.

## Why do it at all

Two payoffs, both concrete. (1) **It makes tier-5 cheap.** Pre-materialized entailments turn the
Syllogist's on-demand proof into a lookup — the answer is already a `Fact` with its chain attached, so
the miss never happens. (2) **It is measured by the graded bench** (Phase 3): inference-shaped cells
(premises asserted, conclusion asked, derivation expected) flip from miss to hit *before* the question
is asked. If pre-derivation never flips a real cell, Phase 8 has earned nothing and should not ship —
that is the honest kill criterion, and the first-steps section makes it the very first measurement.

## The central problem, named honestly — this is the plan's spine

The forward/backward chaining machinery is a solved, mechanical thing. **The hard part is the
SELECTION CRITERION: of the vast space of things that COULD be derived, which are worth deriving.** This
is not an engineering detail we've left for later — it is the **frame problem** (McCarthy & Hayes,
*Some Philosophical Problems from the Standpoint of Artificial Intelligence*, 1969) and its modern
restatement as **relevance realization**: an agent cannot, in general, enumerate what is relevant to a
situation without already having solved the problem relevance was meant to make tractable. Concretely
for tmct:

- **The deductive closure is combinatorially explosive.** You cannot materialize the full closure of a
  rich KB — even a modest axiom set generates unboundedly many true consequences under transitivity and
  restriction chaining. Materializing everything balloons memory (and `appendFact` rewrites the whole
  store, an O(N) cost the corpus agent already measured — every speculative fact taxes every future
  write).
- **Most entailments are TRUE but USELESS.** "a module is a module" (reflexive subsumption), "a cache
  is a cache-or-a-buffer" (subsumption into a disjunction), the class that is a subclass of every
  superclass of its superclass — all valid, all worthless. Truth is not the filter; usefulness is, and
  usefulness is exactly what no closed-form rule captures in the general case.

**This plan does not pretend to solve relevance realization.** It cannot; nobody can. Its job is to make
the problem *tractable* inside tmct's narrow, closed, tech-domain world — a world where the vocabulary
is a declared lexicon, the axioms are few, and (crucially) we have a RECORD of what questions actually
get asked. In that box, "useful" can be cheaply *approximated* well enough to be worth some idle CPU,
provided we bound the cost hard and never overclaim the result. Everything the approximations miss is
named, below, as standing open research risk — not quietly assumed away.

## Tractable usefulness heuristics (approximations, stacked, each cheap + explainable)

None of these is *correct*. Each is a cheap, inspectable proxy for usefulness; stacked, they narrow the
derivation frontier from "the closure" to "a handful per idle cycle". A candidate derivation must earn
its keep against all of them.

- **Query-shape frequency** — *usefulness ≈ "would this answer a question of a shape we actually get
  asked".* Mine the recorded parses (`mgx:utteranceParsed`, session telemetry) for frequent
  `(relation, kind)` query shapes; backward-chain along ONLY those shapes. The system learns what to
  think about from what it is asked — the same data the Phase-3 tuning loop already collects. (Its risk
  — overfitting to the past — is an open question, below.)
- **Focus-connection / spreading activation** — derive OUTWARD from the entities the session just
  focused on and the facts it just asserted, not across the whole graph. This is the classic
  spreading-activation relevance heuristic (Collins & Loftus, 1975; Anderson's ACT-R activation);
  `codegraph.mjs` already does exactly this shape of bounded proximity re-ranking (import/call/prose
  adjacency nudges). The fold hook hands us the footprint for free — the touched entities ARE the
  activation seeds.
- **Cheap-yield** — a candidate must be a bounded forward step (depth 1–2) that produces a NON-TRIVIAL
  fact: not already stored (the `appendFact` content-hash tells us), and not trivially true (filter
  reflexive subsumption, subsumption-of-self, disjunction-widening — a small tautology screen). No
  yield, no derivation.
- **Novelty × trust** — prefer derivations whose premises are HIGH-TRUST and whose conclusion is NOVEL.
  Trust is the cross-cutting **Provenance & trust** primitive (ROADMAP): a conclusion inherits
  `min(premise trust) × rule confidence` — only as trustworthy as its weakest premise, computed, never
  asserted. A derivation from two corroborated operator-stated facts is worth more idle CPU than one
  resting on a lone web scrape.

## Hard guardrails — non-negotiable, and the honesty of the design

These are not tuning knobs; they are what make speculation safe to ship.

- **Strict inference BUDGET.** Bounded derivations per idle cycle (the first-steps seed: 50), bounded
  total materialization size. Memory cannot balloon, and a fold must stay fast — the pass has a
  wall-clock and a count ceiling and stops at whichever comes first, deterministically.
- **Everything speculative is TRUST-SCORED and RETRACTABLE.** Every derived fact carries
  `provenance = entailed:<rule>` (a first-class `Source`, low prior) and a derived trust. It NEVER
  outranks a stated fact and NEVER silently presents as ground truth: `via:"entailed"`, and the answer
  shows its derivation chain in words (the Syllogist's proof rendering — "every cache is a store; every
  store is a component; so a cache is a component").
- **Scoped and reversible by provenance.** A wrong axiom poisons the closure. Because every speculative
  fact is tagged with the rule and premises that produced it, materialization is reversible: retract by
  provenance when the source graph changes or an axiom is corrected — no orphaned entailments left
  asserting a falsehood.
- **Offline, $0.** This is idle CPU and nothing else. No LLM, no network — permanently, exactly as the
  product ethos requires. Speculative inference that needed a model would violate the whole premise.

## Where it runs

- **The fold seam (session end).** After `foldSessionLogs()` folds a session, run a bounded speculative
  pass over what that session TOUCHED (focus-connected seeds), writing via `appendFact` with
  `entailed:<rule>` provenance. Natural idle, naturally scoped.
- **`tmct think` — explicit batch inference.** A CLI verb for a deliberate, budget-capped pass over the
  whole memory graph (or a named focus), for when the operator wants to pre-derive ahead of a session.
  Same engine, same guardrails, bigger budget by explicit request.
- **Integration.** Consumes the Provenance & trust primitive (sources + derived trust); feeds tier-5
  (pre-materialized entailments make the Syllogist instant); measured by the graded bench (does
  pre-derivation flip inference-shaped cells before they're asked?). It does not touch the provider's
  code graph — speculation writes ONLY to `.tmct/memory/`, like every other memory writer.

## First steps — start absurdly narrow

1. **ONE rule.** `rdfs:subClassOf` transitivity, forward-chained: (a ⊑ b), (b ⊑ c) ⊨ (a ⊑ c). Nothing
   else. It is the simplest OWL 2 RL rule, it is exactly what the ACE grammar's pattern 1 emits, and it
   is the Syllogist's own worked example.
2. **At fold, budget 50 derivations, over focus-connected classes only** — the classes the just-folded
   session touched, one transitive step out. Tautology-screened, dedup-screened, `entailed:subClassOf`
   provenance, low trust.
3. **MEASURE whether it ever answers a real query.** Run the graded bench's subclass-chain cells with
   and without the speculative pass. If a pre-derived fact flips a cell that was a miss, Phase 8 has
   drawn blood and earns generalization (more rules, backward chaining from query shapes, `tmct think`).
   **If it never flips a cell, stop** — the honest outcome is that eager materialization wasn't worth it
   and tier-5's lazy on-demand derivation is the whole answer. Do not generalize on faith.

## Open questions — the standing research risk, last and unresolved

- **The relevance criterion itself.** The heuristics above are proxies, and the frame problem guarantees
  they will sometimes derive the useless and skip the useful. Whether the *stack* of cheap proxies is a
  good-enough approximation in tmct's narrow world — or whether relevance realization reasserts itself
  the moment the axiom set grows past the trivial — is the open research risk this plan explicitly does
  not close. It fences the problem; it does not defeat it.
- **Does query-frequency derivation overfit to the past?** Deriving only along shapes we've been asked
  means we never pre-derive along shapes we've never been asked but soon will — the system stops
  exploring. Is there a cheap exploration budget (derive a little off-distribution) that doesn't just
  reintroduce the explosion? Unknown.
- **Eager materialization vs lazy on-demand (Phase 8 vs tier-5).** If tier-5's query-time derivation is
  fast enough, pre-materializing is wasted memory and wasted idle CPU. The real tradeoff — how much to
  pre-derive vs derive-on-miss — is empirical and can only be settled once BOTH exist and the bench can
  compare them. Phase 8 may rationally shrink to almost nothing.
- **Garbage-collecting stale speculative facts.** When the source graph changes, entailments derived
  from the old graph go stale. Provenance makes them *retractable* — but WHEN, and triggered by what?
  Blanket-retract-and-re-derive every fold is simple but wasteful; incremental invalidation by premise
  is correct but is itself a truth-maintenance problem (Doyle's TMS) we have not scoped.
