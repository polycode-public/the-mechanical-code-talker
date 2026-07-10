# PLAN_INFERENCE_TESTING.md — INFBENCH: classical logic on a 6-band CEFR-shaped ladder

> **STATUS (2026-07-10): Stages 0–5 ✅ ALL SHIPPED — the full 6-band ladder now passes the gate.**
> Stages 0–2 (2026-07-08): `cax-sco` + the live `findIsaChain` proof chase closed chat-A2 to 100%,
> 0% fabrication (detail below, unchanged). Stages 3–5 (2026-07-10): `cax-dw` (disjointness,
> `deriveDisjointViolations`) + a LIVE, read-only chat-query wiring closing a real gap where the
> rule existed, unit-tested, but was never reachable from an actual chat turn — INF-B1 moved from a
> stuck **33%** to **100%, 0% fabrication**. `cls-svf1` (someValuesFrom restriction membership,
> `deriveSomeValuesFromApplication`) plus a new positive infbench template (`b2Svf1Apply`) needed to
> measure it at all (the original `b2Svf1` template was permanent negative witnesses only, per a
> strategy-advisor finding — cls-svf1-only would have been unmeasurable without it). A new
> consistency checker (`findConsistencyViolations`) that REFUSES to answer from a subject whose own
> taught/entailed types contradict each other, naming the clash — INF-C2 moved from its 0% ceiling
> to **100%, 0% fabrication**.
>
> **Fresh measurement (version 1.4.1, chat arm, 209 cases):** INF-A1 100%, INF-A2 100%, **INF-B1
> 100%** (was 33%), INF-B2 80%, INF-C1 90%, **INF-C2 100%** (was 0%) — overall 94% completion, 0%
> fabrication, **every band passes the gate, no gating skip anywhere on the ladder** (previously
> gated at INF-B1, blocking everything above it). Kernel arm: INF-A1/A2/B2 all 100%.
>
> **One known, non-gate-blocking gap:** INF-B2's 10 new `b2Svf1Apply` positive cases show
> "unproven" in the chat arm despite `cls-svf1` passing 100% in the kernel arm — `cls-svf1` needs
> the same live chat-query wiring treatment `cax-dw` just got (this session only built that for
> `cax-dw`); documented follow-up, not attempted here. INF-C1's 3 non-passing rows are the
> long-standing, unrelated `-max0-*` "unclear" quirk, unchanged since 0.8.2.

*(Revised 2026-07-07 — mechanizes CASE GENERATION. What changed vs the prior draft: §1's worked
examples are reframed as hand-verified EXPRESSIBILITY WITNESSES, not the case-authoring mechanism;
§2 gains a new case-generation subsection (§2.2) mirroring `chatbench/generate-graded.mjs`'s
discipline, an explicit "what this does NOT mechanize" subsection (§2.3), and a steady-state
workflow contract (§2.4). §1's band table, §2.1's already-mechanical grader bullets, §3, §4's
engine build-staging table, and §5's risk bullets are the PRIOR content, carried forward because it
is still accurate — this is a targeted rewrite of the authoring/workflow framing, not a rewrite
from scratch. All file:line citations below were re-checked against the current tree. Cross-plan
sibling: [[PLAN_ontology-hierarchies.md]] supplies this plan's premises (subsumption/disjointness
facts); [[PLAN_ADVANCED_GRAMMAR.md]] shares its C1 quantifier/entailment pool-growth surface.)*

**Goal:** a means to test tmct's classical-logic competence with a 6-band grading system shaped
like chatbench's CEFR ladder (ROADMAP Phase 5 graded pool) but graded **deterministically** like
AGENTBENCH (`agentbench/grade.mjs`) — because a deterministic inference engine is measured by a
deterministic ruler, and **produced mechanically** like chatbench's graded pool
(`chatbench/generate-graded.mjs`) — because a bench that tests dozens of structurally repetitive
cases across 6 bands should not be typed by hand one JSONL line at a time. The engine under test is
`src/syllogise.mjs` today (ONE rule: `rdfs:subClassOf` transitivity, budget/focus/screen-bounded,
`entailed:subClassOf` provenance, trust prior 0.3 in `src/memory/trust.mjs` `SOURCE_PRIOR`) plus
the chat-side class↔instance bridge (`src/chat.mjs` `inheritsChain`/`factReadBack` ~L1250-1350:
graph `inherits` edge ∘ taught isa fact → "yes", both sources named), growing into ROADMAP Phase
LATER **tier-5 "the Syllogist"** (OWL 2 RL forward-chaining, `via:"entailed"` + proof-chain
provenance, ~L775-810).

**Ground rule (expressibility):** every testable inference MUST be expressible as taught facts in
the ACE-OWL 8-pattern fragment (`src/grammar/ace.mjs`) over the committed lexicon
(`src/grammar/lexicon-core.json`) + code-graph edges. Every example in §1 was **verified against
`parseAce` with the committed lexicon** (see §5 for the two surprises this shook out, including
ROADMAP's own worked examples failing the check). §1's table is retained as proof the fragment can
carry the ladder; it is NOT the mechanism that produces `infbench/cases.jsonl` — that mechanism is
§2.2.

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

### Example utterances per band (hand-verified EXPRESSIBILITY WITNESSES — not the authoring mechanism)

These rows exist to prove the fragment can carry every band; the actual `infbench/cases.jsonl` is
a **generated** artifact holding hundreds of structurally analogous instances of these same shapes
(§2.2), never hand-typed line by line.

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
special-case. ² cax-dw needs the ⊑-lift (x∈mock, mock⊑fixture, fixture disj test) — B1's hardest
cell. Both surface shapes are template families in §2.2's table (row A2/B1), not one-off cases.

**Pass criterion per band (uniform):** the AGENTBENCH metric pair — completion ≥ 50%
(`COMPLETION_FLOOR`, `agentbench/grade.mjs:32`) **at 0% fabrication** — where fabrication = any
answered verdict/entailment not pinned by the case literal (§2.1). A band failing the gate gates
every band above it (§3).

---

## 2. INFBENCH design — deterministic-first, generated-first, AGENTBENCH's ruler

New sibling directory `infbench/` mirroring `agentbench/`, now with a fourth file:
`generate-cases.mjs`, `cases.jsonl`, `grade.mjs`, `run.mjs`, `results/raw/run-<version>/`.
`cases.jsonl` is a **build artifact** of a committed generator run at a fixed seed — it is
regenerated, not hand-edited, exactly as `chatbench/graded-pool.jsonl` is a build artifact of
`chatbench/generate-graded.mjs` (confirmed: `node chatbench/generate-graded.mjs [--seed 20260704]
[--out …]` "rebuilds the pool deterministically — same seed, byte-identical file", `chatbench/
GRADED.md:73`). Artifact naming per the §1 measurement contract of `SKILL_BENCHMARK_CHAT.md`:
**`INFBENCH_<version>.md`**, re-runs `_00N`.

### 2.1 Already mechanical (unchanged by this revision — the grader was close to zero-touch already)

- **Case shape:** `{ id, band, premises: [ACE sentences], graph?: [inherits edges], query,
  expect: { verdict: "yes"|"no"|"unproven"|"inconsistent", entailed?: [triple literals],
  proof?: true } }`. Ids `inf-a1-…`, `inf-c2-…`, mirroring the chatbench cell convention (`` `g-
  ${cell.grade.toLowerCase()}-${cell.slug}-${i+1}` ``, `chatbench/generate-graded.mjs:1802`).
- **Fixture lint (the expressibility gate, at parse time like agentbench `parseCases`):** every
  premise MUST `parseAce` to a clean hit (non-null, `residue: []`) against the committed lexicon
  (+ the case's declared `extra` lexicon block, if any). A premise the grammar can't hold fails
  the LINT, not the run. Every `expect.entailed` literal must use only terms occurring in the
  premises' emitted triples (`normFactTerm`-normalized) — the referential lint, exactly
  agentbench's stale-literal rule (`agentbench/grade.mjs:92-101`).
- **Zero-fabrication gate (the automatic fail):** expected entailments are STATIC literals pinned
  at generation time — `grade.mjs` value-compares, never re-derives; the exact discipline
  agentbench's RESULT-completion axis already runs (`agentbench/grade.mjs:197-224`: "grade.mjs
  imports NO composition function — it only compares the driver's `composed` field to the
  literal, so the check is not the code testing itself"). Any produced entailment outside the
  pinned closure, or a "yes"/"no" verdict on an `unproven` case, is an automatic FAIL — the
  analogue of the hallucinated-call gate (`agentbench/grade.mjs:156-166`).
- **Proof receipts graded for CONNECTEDNESS, not presence:** each proof step =
  `{ rule, premises: [fact ids], conclusion }`; valid iff every step's premises are stated facts
  or earlier conclusions and the chain is rooted in stated facts — extend agentbench
  `proofConnected` (`agentbench/grade.mjs:251-262`, producer must be "graph" or `step-N`) with
  rule-name membership in the declared rule set.
- **Honest-refusal cells:** every band ≥ B1 carries `unproven` cells (pass = the
  cannot-be-proven report, fail = any verdict) and C2 carries `inconsistent` cells (pass =
  refusal naming the clash).
- **Byte-identical replay:** the engine is deterministic (`deriveSubClassClosure` sorts
  candidates before truncation, `src/syllogise.mjs:89`); `run.mjs --replay` runs twice and
  byte-compares the results JSON.
- **Judge tier (optional, never truth):** an LLM judge may score RENDERED proof-chain phrasing for
  readability only. Truth is decided by the deterministic tier alone.
- **Two drive points:** (kernel) the pure closure/prover API; (chat) a thin mirror cell per band
  driving `runTurn`, catching wiring gaps between engine and mouth.
- **`ladderGate` (§3) and `COMPLETION_FLOOR`** (`agentbench/grade.mjs:32,310-324`) are pure
  functions of a rolled-up rows array — nothing about them changes with this revision; they were
  already zero-human-touch and stay that way.

### 2.2 Case generation — NEWLY mechanized this revision

`chatbench/generate-graded.mjs`'s mechanism: `buildTruth(raw)` (`chatbench/generate-graded.mjs:
34-74`) computes ground truth by simple traversal (`importersOf`, `subclassesOf`, …) directly over
the RAW committed fixture, never via the engine (`ask.mjs`/`resolveObject`). Per grade×construction
cell (`GRADED_MATRIX`, `chatbench/graded.mjs:61`) a candidate-builder function enumerates items
combinatorially over the fixture's entities (e.g. `a1Naming` loops schema classes × phrasings,
`chatbench/generate-graded.mjs:124-143`). A seeded PRNG (`mulberry32((seed ^ fnv1a(key)) >>> 0)`,
`:1798`) shuffles and slices to the cell's pool size (`:1799`), and ids are assigned mechanically
(`:1802`). Only AFTER truth+id are fixed does `authorCase` (`:1739-1781`) replay the item through
the CURRENT engine — and that replay never changes the expected value; it only flags
`baselineFail:true` + records `observed` when today's engine misses the ground-truth answer. This
is exactly the discipline the prior §2 zero-fabrication gate already named for INFBENCH (§2.1); the
generator's job is to reproduce it for logic cases instead of graph-lookup cases.

**INFBENCH's fixture is structurally simpler, which is the key mechanization lever.** Bands A2-C2
are entirely STRUCTURAL (a chain of length k, a disjoint pair, a cardinality n) — there is no
pre-existing large graph to traverse, so unlike `buildTruth`'s traversal functions, `expect` here
is a **pure function of the template's own parameters**, fixed at construction time:

- the fixture is the committed common-noun lexicon (`src/grammar/lexicon-core.json` — 173 nouns,
  63 verbs) as class/relation vocabulary, plus synthetic individuals exploiting the tokenizer's
  CODE_REF rule (`src/grammar/ace.mjs:42,71-72`: any token containing `. / \ # : @` is recognized
  as an individual BY FORM, no lexicon entry needed) — a generator mints `e07.mjs`, `e08.mjs`, …
  deterministically and they parse with zero `extra` lexicon block.
- each template picks N distinct nouns (seeded, no repeats within a case) and/or M synthetic
  individuals, string-templates them into the §1-verified surface forms, and derives `expect` from
  the SAME parameters in the SAME function — literally the same object destructured two ways.
  There is no `derive-then-compare` step in generation at all; the only thing separate from
  generation is the replay (mirroring `authorCase`) that runs today's engine over the emitted
  premises+query solely to mark `baselineFail`/ceiling and record `observed`.

| Band | Template (generator fn) | Parameters swept | `expect` derivation (pure fn of params) | Illustrative pool |
|---|---|---|---|---|
| A1 | `a1Lookup` | 1 noun × {subClassOf, typeAssertion, possessive} pattern | verdict is the stated fact, verbatim | ~30 |
| A2 | `a2ChainLen2` | 2-hop noun chain (3 distinct nouns) × {taught-only, graph-bridge} | "yes" via the 2nd noun — a 2-hop chain by construction | ~40 |
| B1 | `b1Disjoint` | 1 disjoint noun pair × {direct member, 1-hop ⊑-lifted member} × 1 unrelated "control" noun | "no"+proof for the paired class; "cannot be proven" for the control noun | ~40 |
| B2 | `b2ChainLenK` / `b2Svf1` | chain length k∈{3,4,5} / someValuesFrom triple (verb from the 63 × 2 nouns) | "yes"+k-step chain / "yes" — ceiling: engine has no cax-sco/cls-svf1 yet, expect stays `unproven`/0% until §4 stage 1/4 | ~40 |
| C1 | `c1Cardinality` | (exactly n, queried min m≤n) / (max 0, queried existence) | "yes" iff m≤n / "no" (max-0 as negation) — ceiling until §4 stage 4 | ~30 |
| C2 | `c2Inconsistent` | contradictory triple {x:C₁, x:C₂, C₁ disjointWith C₂} built by the SAME `b1Disjoint` machinery | "inconsistent", clash = the declared pair — known by construction — ceiling until §4 stage 5 | ~20 |

Determinism: same `--seed` (default recorded in the generator, mirroring `20260704`) →
byte-identical `cases.jsonl`; nothing reads `Date.now` (same discipline as `GRADED.md`'s sha1
verification of `graded-pool.jsonl`).

### 2.3 What generation does NOT mechanize — engine rule code stays hand-written

The generator only produces TEST CASES over rules that already exist or are planned per §1's
"Rules needed" column (scm-sco, cax-sco, cax-dw, cls-svf1, scm-svf, cardinality entailment,
consistency-checking). Writing those rules INTO `src/syllogise.mjs` (§4 stages 1, 3, 4, 5) is a
separate, much harder problem: generating a test case is combinatorial expansion over a template;
generating a sound inference rule is program synthesis, and this repo has already looked at that
door and left it shut (ROADMAP Item 11, Progol/ILP — "exploratory until a spike confirms the
mapping is tractable", kept a SEPARATE far spike, §4's last row, unchanged by this revision). So:
**mechanizing INFBENCH mechanizes the BENCH, never the ENGINE BUILD.** Every stage-1/3/4/5 exit
criterion in §4 still requires a human writing Node.js; nothing in §2.2 shrinks that work, it only
removes the OTHER work (typing dozens of near-identical JSONL lines by hand) that used to compete
for the same attention.

### 2.4 The steady-state workflow contract

Per cycle: `node infbench/generate-cases.mjs --seed <n>` (deterministic, prints per-template
counts — mirroring `generate-graded.mjs`'s printed per-cell counts, which `GRADED.md:94` calls "the
authoritative counts") regenerates `infbench/cases.jsonl`; `node infbench/run.mjs` replays it
through the kernel+chat drive points and grades deterministically, mirroring agentbench's fused
parse→run→grade→write single invocation (`agentbench/run.mjs` `main()`, `:243-318`), writing
`infbench/results/raw/run-<version>/product.jsonl` and printing the per-band rung table plus ladder
receipts to the console (`agentbench/run.mjs:292-293,310-314`). The only human input per cycle is
reading that console table (or the written `INFBENCH_<version>.md`) and deciding: does each band's
green-rate/ceiling match §1's `Reachable today?` column and §3's predicted gate point — ship, or
pick the next §4 stage.

**Honest gap, named rather than assumed away:** neither chatbench nor agentbench today fuses
generate+run+(judge/grade) behind ONE `npm run` command. Chatbench's `generate-graded.mjs`,
`run.mjs`, and `judge.mjs` are three separate `node` invocations — `package.json:86-87` scripts
only `chatbench:run` and `chatbench:judge`; `generate-graded.mjs` has no package.json script at
all, run via `node chatbench/generate-graded.mjs` per `GRADED.md:73`. Agentbench's `agentbench:run`
(`package.json:89`) DOES fuse parse+run+grade+write into one invocation, but it has NO generator
step because its 56 cases are still hand-authored (`agentbench/cases.jsonl`, 56 lines, no
`generate-*.mjs` in `agentbench/`). INFBENCH's proposal — one `npm run infbench` chaining
`generate-cases.mjs` then `run.mjs` — is therefore a **new** convenience this plan introduces, not
a repeat of existing prior art. It is cheap to build (both steps are pure Node with no I/O beyond
writing the two artifact files) but §4 stage 0 must actually add the `package.json` script; it does
not exist yet and should not be assumed.

---

## 3. Ladder gating

Apply chatbench's Meta-2 rule (ROADMAP ~L362: "get B1 reliable before judging C-grades — don't
pay to judge a ceiling while the floor leaks") mechanically, via agentbench's `ladderGate`
(`agentbench/grade.mjs:310-324`): bands run INF-A1→INF-C2; the FIRST band failing the honest gate
(0% fabrication at ≥50% completion) gates every band above it, reported skipped-with-a-receipt.
**Ceiling markers are legitimate:** a 0% band is a marker, not a failure — ROADMAP L256 verbatim
("A case at 0% is a ceiling marker, not a failure"). INF-B2…C2 are **GENERATED NOW** (§2.2's
`b2ChainLenK`/`b2Svf1`/`c1Cardinality`/`c2Inconsistent` templates, run against not-yet-implemented
rules) and expected to sit at 0% until tier-5 lands, exactly as agentbench declared B1-C2 rungs
before any driver could climb them (`agentbench/grade.mjs:24-25`). Dual-draw agreement is NOT
needed at the deterministic tier (one run per arm suffices — `SKILL_BENCHMARK_CHAT.md` §1
deterministic-replay clause); it applies only if a judged phrasing tier is enabled.

---

## 4. Build staging (measure before building — this table is ENGINE work, not mechanized by §2)

| Stage | What | Effort | Exit |
|---|---|---|---|
| 0 | `infbench/` harness + `generate-cases.mjs` + INF-A1/A2 templates, driven against TODAY's engine (`deriveSubClassClosure` kernel + `factReadBack`/bridge via `runTurn`); GENERATE B1-C2 templates too (§2.2 — same generator, run against not-yet-implemented rules, `expect` is honestly `unproven`/ceiling by construction, no per-case authoring); add the `npm run infbench` script (§2.4) | S-M | first INFBENCH_<ver>.md: A1 gate expected PASS, A2 partial, B1+ 0% ceilings — the baseline |
| 1 | **cax-sco** in syllogise.mjs (x rdf:type C₁, C₁⊑C₂ ⊢ x rdf:type C₂) — same budget/focus/screen guards, provenance `entailed:type` (hand-written Node.js — §2.3) | S | INF-A2 gate PASS |
| 2 | **Proof-chain receipts**: derivations carry premise fact-ids + rule name (the tier-5 `via:"entailed"` proof-chain provenance, ROADMAP L788); engage the trust hook already waiting in trust.mjs L103-106 (min(premiseTrusts) × ruleConfidence) | M | proofs grade connected; entailed trust is premise-derived, not the bare 0.3 floor |
| 3 | **B1 rules**: cax-dw (+ its ⊑-lift) and the "cannot be proven" answer shape wired into the miss path (hand-written Node.js — §2.3) | M | ✅ **SHIPPED 2026-07-10** — INF-B1 gate PASS (33%→100%) — unlocks C-band judging per the ladder rule |
| 4 | **Tier-5 proper**: OWL 2 RL subset as semi-naive forward-chaining per ROADMAP's engine choice (L796-803) — cls-svf1, scm-svf, cardinality monotonicity; entailment-on-miss wiring (hand-written Node.js — §2.3) | L | ◐ **PARTIAL 2026-07-10** — cls-svf1 shipped (kernel 100%, chat-arm live-query wiring still needed, follow-up); scm-svf/cardinality-monotonicity skipped as genuinely unmeasurable against today's cases (INF-C1 already 90-93% pre-existing, unrelated `-max0-*` quirk) — INF-B2 gate PASSES (80%, 0% fabrication) |
| 5 | **Consistency checker** over the closure + refuse-on-contradiction (hand-written Node.js — §2.3) | M | ✅ **SHIPPED 2026-07-10** — INF-C2 completion 0%→100%, gate PASS |
| — | Progol/ILP (learning NEW rules) stays a SEPARATE far spike — ROADMAP Item 11's own language ("exploratory until a spike confirms the mapping is tractable") | — | not on this ladder |

**The literature behind stages 3–5 and the Progol row, verified against real sources — most of it
is solved, a narrower slice is genuinely open.** Named honestly so "we haven't built it" is never
conflated with "nobody knows how":

- **OWL 2 RL + DL tableau reasoning is a mature, solved field — reimplementing it here is real
  engineering, not research.** OWL 2 RL was purpose-designed to be implementable as forward-chaining
  Datalog: the W3C's own profile document states the design goal directly ("OWL 2 RL reasoning
  systems can be implemented using rule-based reasoning engines") and proves it — Theorem PR1
  gives soundness+completeness of the rule-based reading for query answering, and §4.3's Tables 4-9
  enumerate the COMPLETE rule set as first-order implications over a ternary triple predicate (W3C,
  *OWL 2 Web Ontology Language Profiles*, Second Edition, 2012, `https://www.w3.org/TR/owl2-profiles/`
  — verified by direct fetch). Stage 4's tier-5 "the Syllogist" is, in the literature's own terms,
  an implementation of an already-published complete rule table, not an open design question. The
  same holds for the harder DL fragments beyond RL: satisfiability/consistency checking for
  expressive DLs is solved by tableau algorithms (Baader & Sattler, "An Overview of Tableau
  Algorithms for Description Logics," *Studia Logica* 69(1):5-40, 2001; Horrocks & Sattler, "A
  Tableau Decision Procedure for SHOIQ," *Journal of Automated Reasoning*, 2007 — both verified),
  and production reasoners built on exactly this theory exist and are widely deployed: Pellet and
  HermiT are tableau-based OWL DL reasoners, RDFox is an in-memory parallel Datalog/OWL-2-RL engine
  materialising up to 6.1M triples/sec (Motik, Nenov, Piro & Horrocks, "RDFox: A Highly-Scalable RDF
  Store," ISWC 2015 — verified), and Apache Jena ships a general rule engine for exactly this rule
  shape. **The genuinely tmct-specific part is narrower than "build a reasoner": these mainstream
  systems assume a single trust tier — a fact is IN the closure or it is not.** tmct's own
  requirement (`memory/trust.mjs` `SOURCE_PRIOR`, corpus 0.7 < teach 0.95 < operator 1.0, entailed
  floor 0.3) that a corpus-sourced entailment must NEVER outrank a taught fact, stay low-trust, and
  remain independently retractable is a governance layer the OWL 2 RL/tableau literature does not
  address at all — it is silent on trust tiers because DL semantics has none. That governance layer
  is this repo's own invention (already shipped), not a gap in the literature to fill.

- **Incrementality (RETE / semi-naive evaluation) is also solved — `syllogise.mjs` just hasn't
  adopted it yet.** `deriveSubClassClosure` (`src/syllogise.mjs:57-103`) re-scans the full
  `succ` adjacency snapshot every pass; the budget/focus/screen guards bound HOW MUCH work a pass
  does but not whether the pass reuses work from the last one — there is no persisted match-state
  across calls. The classical answer (compile the rule set into a discrimination network so a new
  fact only re-triggers the joins it could actually affect) is Forgy's RETE algorithm (Forgy, C.L.,
  "Rete: A Fast Algorithm for the Many Pattern/Many Object Pattern Match Problem," *Artificial
  Intelligence* 19(1):17-37, 1982 — verified) and its Datalog-world descendant, semi-naive
  evaluation, is exactly what ROADMAP L796-803 already names as tier-5's intended engine choice and
  what RDFox's production incremental engine actually runs at scale (Motik et al. 2015, above). This
  session's `edgesOfKind`-style predicate memoization is a real step in this direction (indexing
  facts by predicate so a pass doesn't rescan irrelevant rows) but it is NOT yet an alpha/beta
  network — a genuinely incremental `syllogise()` (new fact in ⇒ only the newly-enabled derivations
  computed, not a re-scan bounded by budget) is a known, citable technique to port, not an open
  question.

- **Retraction-aware consistency under a hard budget and trust tiers is the one piece that is
  genuinely narrower than "known algorithm, not yet ported" — worth naming precisely rather than
  folding into the OWL 2 RL bucket above.** The classical AI answer to "a belief was derived from
  premises, one premise later disappears, what else must be un-believed?" is a Truth Maintenance
  System: Doyle's original JTMS (Doyle, J., "A Truth Maintenance System," *Artificial Intelligence*
  12(3):231-272, 1979 — verified) attaches a justification (its supporting premise set) to every
  derived belief so retracting a premise triggers dependency-directed removal of exactly the beliefs
  that justification supported; de Kleer's ATMS generalizes this to track, per fact, the FULL SET of
  minimal premise-sets ("environments") that would justify it, so a fact survives a retraction as
  long as ANY of its environments still holds (de Kleer, J., "An Assumption-Based TMS," *Artificial
  Intelligence* 28:127-162, 1986 — verified). The database/Datalog literature has its own answer to
  the same shape of problem in the classical two-valued (in/out, one trust tier) setting: DRed
  deletes a superset of affected tuples then selectively rederives them (Gupta, Mumick &
  Subrahmanian, "Maintaining Views Incrementally," ACM SIGMOD 1993 — verified), and RDFox's own
  Backward/Forward algorithm improves on DRed specifically because DRed over-deletes when a fact has
  many alternate derivations (Motik, Nenov, Piro & Horrocks, "Incremental Update of Datalog
  Materialisation: the Backward/Forward Algorithm," AAAI 2015 — verified). **None of these four
  citations natively carries tmct's actual requirement**: multiple co-existing entailments at
  DIFFERENT trust tiers, where retracting a low-trust corpus premise must re-evaluate only the
  derivations that actually depended on it, must never touch a higher-trust taught-only derivation
  that happens to reach the same conclusion, and where the re-evaluation step itself has to be
  boundable under the same hard idle-CPU budget the forward pass already obeys (`syllogise.mjs:10-25`)
  — not "eventually consistent," bounded on every call. That specific conjunction — bounded +
  incremental + trust-tiered + retraction-safe justification tracking over a tiny rule set — is not
  a named, worked problem anywhere the search above surfaced; the building blocks are each 30-45
  years old and individually well understood, but their combination under a hard low-resource budget
  looks like a genuine "no vehicle yet" gap, not a reimplementation task.

  **A concretely speculative, budget-respecting sketch** (offered as a direction, not a design):
  today every entailed fact carries only a flat provenance TAG (`entailed:subClassOf`,
  `syllogise.mjs:32,130-136`) — the pivot class `via` that produced it is computed and returned in
  the pass's report but never persisted onto the fact itself, so there is no stored justification to
  walk at all today. Stage 2 (this table, row 2) already plans to fix that partially: premise
  fact-ids + rule name per derivation, a JTMS-shaped single justification per fact. A further,
  NOT-currently-planned step toward the ATMS proper would track the small SET of alternate premise-
  sets per derived fact rather than just one — cheap for tmct specifically because the rule count is
  tiny (two rules today) so the number of alternate derivations per fact is expected to stay small,
  unlike the general case ATMS was built for. Retraction would then become a set-membership check
  ("does this fact still have any surviving justification after premise X is retracted?") scoped to
  the fact's own small environment set, rather than a whole-graph re-scan — and the environment-set
  size itself could carry a fourth budget knob alongside `depth`/`budget`/`focus`, so the mechanism
  inherits tmct's existing bounded-idle-CPU promise instead of importing an unbounded ATMS
  implementation. This stays within the ground rules (deterministic — justifications are computed
  facts, not heuristics; explainable — a retraction's cause is the exact environment that failed;
  bounded — a capped environment-set size; low-trust/retractable — the whole point). Untested,
  unbuilt, and honestly speculative: nobody has published this exact narrow combination as a working
  system, so there is no citation to verify here beyond the separately-real building blocks above —
  flagged as such rather than dressed up as prior art.

- **Progol/ILP vs. Track 1's CEGIS rule synthesis — related family, genuinely different mechanism,
  worth distinguishing precisely now that Track 1 has actually shipped
  (`src/router/goal-reasoner.mjs` `GOAL_RULES`, `synthbench/rules/enumerate.mjs`,
  `synthesize.mjs`, `oracle.mjs`).** Muggleton's Progol performs Mode-Directed Inverse Entailment:
  given background knowledge and mode declarations, it searches an in-principle-OPEN space of Horn
  clauses via inverse resolution and a most-specific-clause bound, no fixed finite candidate list
  enumerated up front (Muggleton, S., "Inverse Entailment and Progol," *New Generation Computing*
  13:245-286, 1995 — verified). Track 1 is structurally different: `enumerate.mjs` builds a FIXED,
  FINITE candidate set (7,776 rule objects, `enumerate.mjs:1-52`'s own accounting) by nested loops
  over a hand-designed field grammar derived from the registry (focusClass × modes × topic pairs ×
  compose templates) — nothing is generated by inverting a proof the way Progol does; every
  candidate is a member of a pre-declared, closed grammar. `synthesize.mjs`'s narrowing (`survivors
  = survivors.filter(passesExample)` per given example, `synthesize.mjs:41-56`) is textbook
  candidate-elimination over that finite set — the shape Mitchell formalized as version-space search
  (Mitchell, T., "Generalization as Search," *Artificial Intelligence* 18(2):203-226, 1982 —
  verified) and that modern programming-by-example synthesis frameworks still use, symbolically
  rather than by brute enumeration, as "version space algebra" (Polozov & Gulwani, "FlashMeta: A
  Framework for Inductive Program Synthesis," OOPSLA 2015 — verified). The "CEGIS" name Track 1
  borrows (Solar-Lezama, A., *Program Synthesis by Sketching*, PhD thesis, UC Berkeley/MIT, 2008 —
  verified, the term's origin) is honest about the counterexample-guided REFINEMENT LOOP shape but
  not about the mechanism: textbook CEGIS pairs a synthesizer with an SMT solver that adversarially
  MANUFACTURES counterexamples over an unbounded parametrized space; Track 1's "counterexamples" are
  pre-supplied labeled examples (`given`/`heldOut`, agentbench-case-shaped) narrowing an already-
  finite enumerated list — closer to plain filtering than to solver-driven search. **Honest verdict:
  Track 1 is a real, working, deterministic instance of rule learning from labeled examples — same
  FAMILY as ILP (learn a rule from examples + background knowledge, verify against held-out data,
  refuse rather than overfit) — but it is not Progol-style ILP (no inverse entailment, no open
  hypothesis language, no refinement operators over an unbounded clause space) and not full CEGIS
  either (no adversarial counterexample generation, no SMT solver). It sits closest to bounded
  enumerate-and-filter version-space search over a hand-curated finite grammar — genuinely useful
  and shipped, but its tractability rests entirely on the grammar staying small (PLAN_CODE.md §7's
  own risk, quoted verbatim in `enumerate.mjs`'s docblock: "every future capability added to the
  registry linearly grows Track 1's space too"). That means the ROADMAP Item 11 Progol/ILP far-spike is LESS far than
  it read before Track 1 shipped (the underlying idea — synthesize rules from examples instead of
  hand-writing every one — now has a working, if narrow, existence proof in this repo) but it is
  still a distinct, unclaimed spike: nothing here demonstrates inverse entailment, open-ended clause
  learning, or generalization beyond a pre-declared grammar, which is what "Progol/ILP" specifically
  named. Whether Track 1's approach generalizes to `syllogise.mjs`'s OWN rule set (learn `cax-dw`-
  shaped rules from labeled inference examples rather than hand-writing them) is an open question
  this session's shipped code does not answer — the grammar `enumerate.mjs` searches is
  goal-reasoner-shaped (GOAL_RULES' `subGoals`/`compose` fields), not inference-rule-shaped (Horn
  clauses over `rdfs:subClassOf`/`owl:disjointWith`), and porting the technique would need a new,
  separately-designed finite grammar over THAT shape before CEGIS-style narrowing could apply to it
  at all — not on this ladder, but no longer purely speculative either.
  - A field worth naming for completeness, not claimed as directly applicable: the field has largely
    moved toward neuro-symbolic hybrids for the noisy/large-scale case classical ILP struggles with —
    Evans & Grefenstette's ∂ILP learns Horn-clause rules via backpropagation against a
    differentiable relaxation of forward-chaining, explicitly to gain robustness to noisy training
    data that "traditional ILP systems... cannot cope with" (Evans, R. & Grefenstette, E., "Learning
    Explanatory Rules from Noisy Data," *Journal of Artificial Intelligence Research* 61:1-64, 2018
    — verified), and Cropper & Muggleton's own later work (Metagol / Meta-Interpretive Learning,
    2014-2018 — verified via Cropper & Muggleton, "Learning efficient logic programs," *Machine
    Learning*, Springer, 2018) moved ILP itself toward predicate invention and recursion rather than
    Progol's original flat inverse-entailment search. Same pattern already named for the parsing
    frontier elsewhere in this repo's docs: the mainstream research trend augments rather than
    replaces the classical technique. tmct's ground rules (no-LLM, permanently) mean this trend is
    NOT a lever tmct can pull — named here only so it isn't rediscovered later as if unknown, and so
    the honest state is on record: the neuro-symbolic branch is real and active, and out of scope by
    tmct's own house rule, not by ignorance of it.

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
  (disjointWith) is. The fragment also has **no disjunction**, so the classical "C1 case analysis"
  band is RESHAPED to quantifier/cardinality interaction (§1) — test what the grammar can hold,
  don't invent syntax. Growing the fragment is a PRODUCT lever measured by chatbench, never a
  bench-side shim.
- **Found capability:** "every cache has at most 0 queues" parses today (`owl:maxCardinality 0`)
  — an honest encoded negation the C1 band exploits; declare it in case comments so it doesn't
  read as a trick.
- **CWA vs OWA declared per band (§1 table).** tmct is OWA-honest at every band: absence of
  proof is reported as absence of proof. There is no negation-as-failure anywhere on the ladder;
  "no" is always a constructive proof from disjointness or max-0.
- **Mechanizing the bench is not mechanizing the engine (restated, because it is the easiest claim
  to overreach on).** §2.2's generator removes the human-authoring cost of dozens of near-identical
  JSONL cases; it does nothing for §4's stages 1/3/4/5, which stay hand-written Node.js rule
  implementation, effort-rated S/M/L exactly as before. Anyone reading only the headline
  "INFBENCH is now scripted" should not conclude the Syllogist itself got closer to shipping — the
  bench got faster to run, the engine build did not get faster to write.
- **Even C2's ceiling markers template cleanly, but their eventual RICHNESS is staged, not
  instant.** `c2Inconsistent` (§2.2) mechanically constructs a contradictory premise set and knows
  BY CONSTRUCTION that the correct verdict is "refuse, don't answer" — that needs no hand
  verification today, ever, because it's true independent of whether stage 5 exists: an
  unimplemented checker simply fails to produce the refusal, an honest 0% ceiling exactly like
  B2/C1. What DOES need a human, once: confirming stage 5's checker names the RIGHT clash when it
  ships — a one-time acceptance check on the checker's output shape, not a per-case authoring
  burden, since `expect`'s clash literal was already pinned at generation time from the template's
  own declared disjoint pair. No genuine "mostly infeasible" finding turned up here — INFBENCH's
  synthetic, self-constructed premises make it an EASIER mechanization target than chatbench's
  fixed pre-existing codegraph fixture was, precisely because generation and truth-authoring are
  the same act rather than generation-then-traversal.
- **Trust/provenance interaction.** Entailed-from-taught (premises at `teach` 0.95 / `operator`
  1.0) vs entailed-from-graph (`provider` 0.9) vs mixed: the conclusion carries
  min(premises) × ruleConfidence once stage 2 engages the hook — never above its weakest premise,
  never silently mixed with stated facts (the tier-5 gate, ROADMAP L806-808). **Retraction is a
  real gap:** syllogise.mjs promises retractability by provenance but no incremental
  closure-maintenance exists; INFBENCH must NOT test retraction until it does. Name it, stage it
  after stage 4.
- **The frame problem stays named** (ROADMAP L590's own language): the residual hard half of
  entailment-on-miss is RELEVANCE — which axioms to chain from a large base under budget.
  Budget/focus truncation (`deriveSubClassClosure` L57) means a truthful "unproven" may really be
  "unproven within budget"; the answer shape must say which, and §2.2's `unproven` templates pin
  fixtures small enough (bounded chain-length/pair parameters) that budget is never the reason.

---

## 6. Cross-plan sequencing (2026-07-07 sweep)

Stage 0 (harness + generator + A1/A2/ceiling templates + `npm run infbench`) is a **Phase-1 quick
win** — executed alongside [[PLAN_ontology-hierarchies.md]]'s stage-1 synonym wiring,
[[archive/PLAN_PREDICATE_QUERIES.md]]'s core feature, and [[PLAN_ADVANCED_GRAMMAR.md]]'s tracks (a)/(f).
Stage 1 (`cax-sco`) is Phase 2 — real engine code, gated on Stage 0's harness existing to measure
it. Stages 3-5 (`cax-dw`, tier-5 forward-chainer, consistency checker) are Phase 3 — the big rock,
gated on [[PLAN_ontology-hierarchies.md]] stage 2 (disjointness premises) landing first for stage
3 specifically. See `ROADMAP.md`'s near-term section for the live cross-plan picture.
