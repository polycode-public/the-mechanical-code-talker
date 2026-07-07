# PLAN_INFERENCE_TESTING.md — INFBENCH: classical logic on a 6-band CEFR-shaped ladder

**Goal:** a means to test tmct's classical-logic competence with a 6-band grading system shaped
like chatbench's CEFR ladder (ROADMAP Phase 5 graded pool) but graded **deterministically** like
AGENTBENCH (`agentbench/grade.mjs`) — because a deterministic inference engine is measured by a
deterministic ruler. The engine under test is `src/syllogise.mjs` today (ONE rule:
`rdfs:subClassOf` transitivity, budget/focus/screen-bounded, `entailed:subClassOf` provenance,
trust prior 0.3 in `src/memory/trust.mjs` `SOURCE_PRIOR`) plus the chat-side class↔instance
bridge (`src/chat.mjs` `inheritsChain`/`factReadBack` ~L1238-1350: graph `inherits` edge ∘ taught
isa fact → "yes", both sources named), growing into ROADMAP Phase LATER **tier-5 "the Syllogist"**
(OWL 2 RL forward-chaining, `via:"entailed"` + proof-chain provenance, ~L775-810).

**Ground rule (expressibility):** every testable inference MUST be expressible as taught facts in
the ACE-OWL 8-pattern fragment (`src/grammar/ace.mjs`) over the committed lexicon
(`src/grammar/lexicon-core.json`) + code-graph edges. Every example below was **verified against
`parseAce` with the committed lexicon** (see §5 for the two surprises this shook out, including
ROADMAP's own worked examples failing the check).

---

## 1. The band ladder — INF-A1 … INF-C2

Semantics column: **OWA-honest** = open-world; a miss is reported as "cannot be proven from what
I've been told", NEVER asserted as "no". A "no" answer is only ever a **proof** (disjointness /
max-0 cardinality). This is the house ethos made formal and it is declared PER BAND (§5).

| Band | Certifies (classical logic) | Rules needed | Semantics | Reachable today? |
|---|---|---|---|---|
| **INF-A1** | Direct retrieval + identity: a taught fact read back verbatim, provenance cited | none (lookup) | stated-only | **YES** — `factReadBack` (a)/(c)/(d) |
| **INF-A2** | Single-step subsumption + one-rule modus ponens: ⊑-chain of length 2; instance membership through one taught class axiom | scm-sco (⊑-transitivity), **cax-sco** (type propagation) | OWA-honest | **PARTIAL** — scm-sco = `deriveSubClassClosure`; graph∘taught one-hop = the bridge; cax-sco over two TAUGHT facts is NOT implemented |
| **INF-B1** | Negation + modus tollens + closed-world-honest: provable "no" from disjointness; unknown pair → honest "cannot be proven" (never a guessed no) | cax-dw (x:C₁, C₁ disjointWith C₂ ⊢ x∉C₂); the unproven-report answer shape | OWA-honest; "no" only by proof | **HALF** — the honest miss exists (`factReadBack` returns null, "never a guessed 'no'" is in-source); `owl:disjointWith` is stored but NO rule consumes it |
| **INF-B2** | Multi-premise chains: 3+-hop closures with proof receipts; cross-source composition (graph `inherits` ∘ taught ⊑ ∘ taught ⊑); someValuesFrom application (x verbs y, y:C₂, x:C₁ ⊢ x:C₃) | cls-svf1, chained scm-sco/cax-sco, proof-chain materialization | OWA-honest | NO — tier-5 |
| **INF-C1** | Quantifier interaction: cardinality monotonicity (exactly n ⊢ min n ∧ max n; min 2 ⊢ min 1); max-0 as encoded negation; restriction × subsumption interaction (scm-svf) | cardinality entailment rules, scm-svf | OWA-honest | NO — tier-5 |
| **INF-C2** | Multi-rule proofs (≥3 distinct rules in one chain) + **inconsistency detection**: a contradictory premise set (x:C₁, x:C₂, C₁ disjointWith C₂; or max-0 violated) is REFUSED with the clash named, never answered from | consistency checker over the closure; refusal answer shape | OWA-honest + clash-report | NO — tier-5 |

### Example utterances per band (all `parseAce`-verified; taught facts use declared lexicon words)

| Band | Premises (taught, ACE) + graph | Query | Expected |
|---|---|---|---|
| A1 | "every controller is a handler" | "is a controller a handler" | yes + provenance |
| A1 | "chat.mjs is a module" | "what kind of thing is chat.mjs" | module, cited |
| A1 | "chat.mjs's owner is Antony"¹ | "who owns chat.mjs" | Antony, cited |
| A2 | "every controller is a handler", "every handler is a component" | "is a controller a component" | yes, via handler |
| A2 | "redis.mjs is a cache", "every cache is a component" | "is redis.mjs a component" | yes (cax-sco) |
| A2 | graph: `TaskController inherits Controller`; taught "every controller is a handler" | "is TaskController a handler" | yes, both sources (bridge, live TODAY) |
| B1 | "no cache is a queue", "redis.mjs is a cache" | "is redis.mjs a queue" | **no** + proof (cax-dw) |
| B1 | "every controller is a handler" | "is a worker a handler" | "cannot be proven" — honest, not "no" |
| B1 | "no test is a fixture", "every mock is a fixture" | "is a mock a test" | no (mock⊑fixture, fixture disj test)² |
| B2 | "every controller is a handler", "every handler is a component", "every component is a part" | "is a controller a part" + why | yes + 3-step rendered chain |
| B2 | "every module that imports a test is a suite", "chat.mjs imports parse.test.mjs", "parse.test.mjs is a test", "chat.mjs is a module" | "is chat.mjs a suite" | yes (cls-svf1 + intersection) |
| C1 | "every suite has exactly 2 tests" | "does every suite have at least 1 test" | yes (cardinality monotonic) |
| C1 | "every cache has at most 0 queues" | "does a cache have a queue" | no (max-0 as negation) |
| C2 | "no cache is a queue", "redis.mjs is a cache", "redis.mjs is a queue" | anything touching redis.mjs | REFUSE: premises inconsistent, clash named |
| C2 | "every module that imports a test is a suite", "no suite is a helper", "util.mjs is a module", "util.mjs is a helper", "util.mjs imports a.test.mjs", "a.test.mjs is a test" | detect the entailed clash | REFUSE with the derivation |

¹ pattern-7 possessive; "owner" is a declared object-property noun; "Antony" needs a properName
lexicon entry (one-line addition) or an `extra` lexicon block in the fixture — declare it, don't
special-case. ² cax-dw needs the ⊑-lift (x∈mock, mock⊑fixture, fixture disj test) — B1's hardest cell.

**Pass criterion per band (uniform):** the AGENTBENCH metric pair — completion ≥ 50%
(`COMPLETION_FLOOR`, grade.mjs L32) **at 0% fabrication** — where fabrication = any answered
verdict/entailment not pinned by the case literal (§2). A band failing the gate gates every band
above it (§3).

---

## 2. INFBENCH design — deterministic-first, AGENTBENCH's ruler

New sibling directory `infbench/` mirroring `agentbench/` (`cases.jsonl`, `grade.mjs`, `run.mjs`,
`results/raw/run-<version>/`). Artifact naming per the §1 measurement contract of
`SKILL_TUNING_CYCLE.md`: **`INFBENCH_<version>.md`**, re-runs `_00N`.

- **Case shape:** `{ id, band, premises: [ACE sentences], graph?: [inherits edges], query,
  expect: { verdict: "yes"|"no"|"unproven"|"inconsistent", entailed?: [triple literals],
  proof?: true } }`. Ids `inf-a1-…`, `inf-c2-…` (the chatbench `g-<grade>-<construction>` cell
  convention, graded-pool.jsonl).
- **Fixture lint (the expressibility gate, at parse time like agentbench `parseCases`):** every
  premise MUST `parseAce` to a clean hit (non-null, `residue: []`) against the committed lexicon
  (+ the case's declared `extra` lexicon block, if any). A premise the grammar can't hold fails
  the LINT, not the run — no case may smuggle in an inexpressible premise. Every
  `expect.entailed` literal must use only terms occurring in the premises' emitted triples
  (`normFactTerm`-normalized) — the referential lint, exactly agentbench's stale-literal rule
  (grade.mjs L92-101).
- **Zero-fabrication gate (the automatic fail):** expected entailments are STATIC literals pinned
  by the author — grade.mjs value-compares, never re-derives (no circularity; agentbench
  L197-224's discipline). Any produced entailment outside the pinned closure, or a "yes"/"no"
  verdict on an `unproven` case, is an automatic FAIL regardless of everything else — the
  analogue of the hallucinated-call gate.
- **Proof receipts graded for CONNECTEDNESS, not presence:** each proof step =
  `{ rule, premises: [fact ids], conclusion }`; valid iff every step's premises are stated facts
  or earlier conclusions and the chain is rooted in stated facts — extend agentbench
  `proofConnected` (grade.mjs L251-262, producer must be "graph" or `step-N`) with rule-name
  membership in the declared rule set. A disconnected or dangling proof fails even when the
  verdict is right: right answer, unearned, is still a fail.
- **Honest-refusal cells:** every band ≥ B1 carries `unproven` cells (pass = the
  cannot-be-proven report, fail = any verdict) and C2 carries `inconsistent` cells (pass =
  refusal naming the clash). Refusing-when-unsure passes at the honest-miss level — agentbench
  rule 3.
- **Byte-identical replay:** the engine is deterministic (`deriveSubClassClosure` sorts
  candidates before truncation); `run.mjs --replay` runs twice and byte-compares the results
  JSON. Any diff voids the run as an instrument failure.
- **Judge tier (optional, never truth):** an LLM judge may score the RENDERED proof-chain
  phrasing ("every cache is a component; every component is a part; so…") for readability only —
  chatbench rubric machinery, clamped to the rephrase/phrasing dimension. Truth is decided by
  the deterministic tier alone. Product stays no-LLM; judge lives in the harness (CLAUDE.md).
- **Two drive points:** (kernel) the pure closure/prover API — the primary, fully deterministic
  surface; (chat) a thin mirror cell per band driving `runTurn` with the taught premises then the
  query, verifying the answer sentence names the verdict + sources — catches wiring gaps between
  engine and mouth.

---

## 3. Ladder gating

Apply chatbench's Meta-2 rule (ROADMAP ~L362: "get B1 reliable before judging C-grades — don't
pay to judge a ceiling while the floor leaks") mechanically, via agentbench's `ladderGate`
(grade.mjs L310-324): bands run INF-A1→INF-C2; the FIRST band failing the honest gate
(0% fabrication at ≥50% completion) gates every band above it, reported skipped-with-a-receipt.
**Ceiling markers are legitimate:** a 0% band is a marker, not a failure — ROADMAP L256 verbatim
("A case at 0% is a ceiling marker, not a failure"). INF-B2…C2 are AUTHORED NOW and expected to
sit at 0% until tier-5 lands, exactly as agentbench declared B1-C2 rungs before any driver could
climb them (grade.mjs L24-25). Dual-draw agreement is NOT needed at the deterministic tier (one
run per arm suffices — SKILL_TUNING_CYCLE §1 deterministic-replay clause); it applies only if a
judged phrasing tier is enabled.

---

## 4. Build staging (measure before building)

| Stage | What | Effort | Exit |
|---|---|---|---|
| 0 | `infbench/` harness + INF-A1/A2 cells, driven against TODAY's engine (`deriveSubClassClosure` kernel + `factReadBack`/bridge via `runTurn`); author B1-C2 cells as ceiling markers | S-M | first INFBENCH_<ver>.md: A1 gate expected PASS, A2 partial, B1+ 0% ceilings — the baseline |
| 1 | **cax-sco** in syllogise.mjs (x rdf:type C₁, C₁⊑C₂ ⊢ x rdf:type C₂) — same budget/focus/screen guards, provenance `entailed:type` | S | INF-A2 gate PASS |
| 2 | **Proof-chain receipts**: derivations carry premise fact-ids + rule name (the tier-5 `via:"entailed"` proof-chain provenance, ROADMAP L788); engage the trust hook already waiting in trust.mjs L103-106 (min(premiseTrusts) × ruleConfidence) | M | proofs grade connected; entailed trust is premise-derived, not the bare 0.3 floor |
| 3 | **B1 rules**: cax-dw (+ its ⊑-lift) and the "cannot be proven" answer shape wired into the miss path | M | INF-B1 gate PASS — unlocks C-band judging per the ladder rule |
| 4 | **Tier-5 proper**: OWL 2 RL subset as semi-naive forward-chaining per ROADMAP's engine choice (L796-803) — cls-svf1, scm-svf, cardinality monotonicity; entailment-on-miss wiring | L | INF-B2/C1 gates |
| 5 | **Consistency checker** over the closure + refuse-on-contradiction | M | INF-C2 completion > 0 |
| — | Progol/ILP (learning NEW rules) stays a SEPARATE far spike — ROADMAP Item 11's own language ("exploratory until a spike confirms the mapping is tractable") | — | not on this ladder |

**Unlocks:** chat "why" answers rendered from proof chains (the ROADMAP L790 chain-of-thought-in-
words); AGENTBENCH C2 goal deduction over taught rules (the router deducing a plan from axioms —
same closure, different consumer); tier-4 learn-on-miss gets a truth filter (a learned sentence
contradicting the closure is quarantined, not blended).

---

## 5. Risks and honesty

- **Expressibility ceiling — measured, and it bit twice already.** (a) ROADMAP's canonical
  Syllogist example "every cache is a store" does NOT parse: `store` is not in
  lexicon-core.json (`parseAce` → `residue: ["store"]`). (b) ROADMAP's worked modus tollens
  ("every tested module is covered by a suite; m.mjs is covered by no suite") is NOT in the
  fragment — passives and sentence-level negation don't exist; only class-level "no N₁ is a N₂"
  (disjointWith) is. The fragment also has **no disjunction** (no owl:unionOf pattern), so the
  classical "C1 case analysis" band is RESHAPED to quantifier/cardinality interaction (§1) —
  test what the grammar can hold, don't invent syntax. Growing the fragment (a passive arm, a
  "does not" arm) is a PRODUCT lever measured by chatbench, never a bench-side shim.
- **Found capability:** "every cache has at most 0 queues" parses today (`owl:maxCardinality 0`)
  — an honest encoded negation the C1 band exploits; declare it in case comments so it doesn't
  read as a trick.
- **CWA vs OWA declared per band (§1 table).** tmct is OWA-honest at every band: absence of
  proof is reported as absence of proof. There is no negation-as-failure anywhere on the ladder;
  "no" is always a constructive proof from disjointness or max-0. Any future CWA cell (e.g.
  closed-world counting over a complete fixture) must say so in its id and rubric.
- **Trust/provenance interaction.** Entailed-from-taught (premises at `teach` 0.95 / `operator`
  1.0) vs entailed-from-graph (`provider` 0.9) vs mixed: the conclusion carries
  min(premises) × ruleConfidence once stage 2 engages the hook — never above its weakest premise,
  never silently mixed with stated facts (the tier-5 gate, ROADMAP L806-808). **Retraction is a
  real gap:** syllogise.mjs promises retractability by provenance but no incremental
  closure-maintenance exists; INFBENCH must NOT test retraction until it does (an authored
  retraction cell today would be a fabricated capability). Name it, stage it after stage 4.
- **The frame problem stays named** (ROADMAP L590's own language): the residual hard half of
  entailment-on-miss is RELEVANCE — which axioms to chain from a large base under budget.
  Budget/focus truncation (`deriveSubClassClosure` L57) means a truthful "unproven" may really be
  "unproven within budget"; the answer shape must say which, and INFBENCH's `unproven` cells pin
  fixtures small enough that budget is never the reason.
