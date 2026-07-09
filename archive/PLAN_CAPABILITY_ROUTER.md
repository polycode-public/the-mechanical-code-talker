# PLAN_CAPABILITY_ROUTER.md — tmct as a deterministic, no-LLM tool router

> **STATUS: exploratory / RFC — reorganised around the build flow (interface → measure → grade →
> climb). Decisions still open; we finalise tonight.** The point is to sharpen the bet, mark what is a
> solved problem vs. genuinely open, and pick the smallest thing worth building first.

## The idea (restated)

Point a tool-loop client (Claude Code) at a **tmct-backed completions API** and its "model" becomes
rules + an OWL graph + inference — no tokens, no GPU. Parse a request into canonical facts; declare
each **capability** (tool) as facts in the same lexicon; infer which capability satisfies the request
and bind its parameters; emit that as a tool call. Deterministic, offline, $0, and — the whole point —
**able to prove why** it chose the call it did.

## Why it's on-thesis

LLM function-calling is a black box; this is a glass box. Most of the substrate exists — the ACE
parser (request → triples), the lexicon, the graph, provenance/trust, forward-chaining (`syllogise`),
the ambiguity surround, miss-as-value, and the Repository-Interface service muscle. What's new is a
capability registry, a real unification/backward-chaining resolver, an imperative intent-frame
extractor, and the HTTP shim.

---

## THE BUILD FLOW (the spine)

Four phases, each a gate for the next. This is the reorganisation: don't build the engine first —
**speak the protocol, measure where we stand, build the ruler, then climb it.**

### Phase A — Speak the protocol (the common interface)

The common interface is an **Anthropic Messages API-compatible endpoint** (`POST /v1/messages`): a
request carries `model`, `messages[]`, and `tools[]`; a response is `content` blocks — `text` and/or
`tool_use` (with `input` = the bound arguments) — and a `stop_reason`; the caller returns a
`tool_result` block and the loop continues. **Claude Code speaks this**, so it is the target. (OpenAI's
`/v1/chat/completions` with `tool_calls` is the analogue; ship it as an optional second adapter for
reach, not first.)

tmct becomes a **drop-in "model"**: it receives the messages + tool schemas, and for each turn either
answers as `text` (a question it can settle from the graph) or emits `tool_use` blocks with bound
arguments + a proof receipt. **This is a solved problem** — a serialization/HTTP shim, no research —
and it is the surface everything else plugs in behind. Build it first so every later stage is testable
end-to-end against a real client.

### Phase B — Measure where tmct sits today

We already have a **partial Phase-B reading, from real data.** `CHATBENCH_0.7.1.md` measures the chat
surface's **resolution** capability — the very thing the router turns into tool calls (a request →
which graph fact, with which bound entity) — on the CEFR ladder. That baseline transfers directly:

**Inherited assets — what the resolution engine already does (measured, `CHATBENCH_0.7.1`):**

- **A-shelf resolution is solid:** A1 **1.885** / A2 **1.933** — naming/definition (`A1 count 2.00`,
  `naming 1.90`), SVO graph queries (`what calls X` / `what imports X`), aggregate/**count** (`2.00`),
  and — the 0.7 levers — **negation** (`A2 neg 2.00`) and **passive** (`B1 passive 1.93`) clearing even
  above their home grade. Rich multi-fact answers land (`gq-impact-a 2.00`).
- **It refuses instead of guessing:** honest ambiguity (`am-tests-cover` → "narrow the term"), honest
  empties, and guiding non-answers (`conv-why-empty`). This is the router's non-negotiable property —
  never emit a wrong call — *already demonstrated on the answer surface*.
- **Determinism + speed:** sub-millisecond per graded turn; the whole run is seconds and free.

So the router's **A0 solid, A1–A2 within reach** is evidence-backed, not hoped: the hard part of A1/A2
(resolve the request to the right grounded fact + entity) is already at ~1.9. Phase B's remaining work
is narrow: the shim (Phase A) + a small declared toolset, then run the **tool-loop** ladder
specifically (answer-emission is measured; `tool_use`-emission is not yet).

**Inherited debt — the chat-surface weaknesses that *gate router rungs* (from `CHATBENCH_0.7.1`):**

| Weakness (measured) | Router rung it blocks | Why it's router-critical |
| --- | --- | --- |
| **Pronoun / focus binding** — `B1 pron 1.24`, the "it → Commit" mis-bind | **A2 → B1** | A tool loop threads a prior `tool_result` into the next call's arguments; a mis-bound antecedent binds the **wrong argument**. Must be fixed before B1 recipes are trustworthy. |
| **Discourse-count/filter anaphora** — the 2 tier-1 misses ("count them" over a listing → grammar wall) | **B1** | "do X, then count/filter the result" is the minimal recipe; threading a prior answer's *set* into the next step is exactly B1. |
| **C1 temporal-over-relative composition** — `C1 temp 0.31` (10 hard-fails) | **C1** | Two-hop compositional resolution is what the closed-world planner leans on to satisfy chained open conditions. |

These are not new work for the router — they are the **same next-lever ranking `CHATBENCH_0.7.1`
already recommends**, now doubling as router prerequisites: (1) pronoun/focus binding, (2)
discourse-count anaphora, (3) C1 temporal composition. Fixing them on the chat surface *is* raising the
router's floor.

### Phase C — The grading ladder (the agentic benchmark)

Build the ruler before the engine. A graded benchmark for the **tool loop**, the direct analogue of
CHATBENCH's CEFR ladder — but the levels are the **A0→C2 rungs** and the reference bands are the
**comparable models** (tiny-local / 8B-open / Nova-micro / Nova-lite / Haiku) as illustrative anchors.

- **A case** = a request + a declared toolset + the expected outcome (which call(s), which bound args).
- **The grade** = did the loop *complete the rung's task*: correct call(s), **zero hallucinated
  calls**, terminated, and a **valid proof chain**. Hallucinating a call is an automatic fail (the one
  thing a deterministic router must never do); refusing-when-unsure is a pass at the honest-miss level.
- **Regression-protected**, exactly like the language ladder: a rung once reached must stay reached.

This makes "climbing" a number, not a vibe — and it is what lets us say, honestly and measurably,
"tmct-backed is at the Nova-lite rung on the declarable slice."

### Phase D — Climb the ladder (the tech, ordered by the rung it unlocks)

Each stage is gated by Phase C showing the rung is actually reached.

| Stage | Builds | Unlocks | Solved by |
| ----- | ------ | ------- | --------- |
| **0** | Capability ontology + registry (`Capability`/`Parameter`/`Precondition`/`Effect`) | A1 *representation* | STRIPS/PDDL operator model — [`docs/references/planning/STRIPS_PDDL.md`](docs/references/planning/STRIPS_PDDL.md) |
| **1** | The resolver — unification + backward chaining over capabilities-as-facts | A1–B1 *matching* | Datalog/SLD resolution; open-condition satisfaction (POP) |
| **2** | Imperative intent frames + parameter slot-filling | A2–B1 *binding* | Semantic parsing (partial — see open problems) |
| **3** | The planner — POP/HTN over operators + Steel & Ho monitor-and-replan | **closed-world C1** | Classical planning — the three planning refs |
| **4** | The guardrail — validate an LLM's proposed `tool_use` against declared capabilities + preconditions | the hybrid fast-path | Precondition checking (STRIPS) |
| **5** | The goal-reasoner (the C2 speculation, below) | **closed-world C2** | BDI / Goal-Driven Autonomy + long-chain deduction |

**Prerequisites carried from Phase B** (the `CHATBENCH_0.7.1` inherited debt): Stage 1–2 (A2→B1) is
**gated on fixing pronoun/focus binding and discourse-count anaphora** — a router that threads results
across turns cannot ship on a resolver that mis-binds "it" or drops "count them". Stage 3 (C1) inherits
the temporal-over-relative composition ceiling. Land these chat-surface levers first; they *are* the
router's floor-raising, and they are already the benchmark's recommended next work.

---

## Solved vs. unsolved — the honest map

| Area | Status | How / why |
| ---- | ------ | --------- |
| The common interface (`/v1/messages` shim) | **Solved** | Documented protocol; deterministic JSON serialization. Engineering. |
| Capability representation | **Solved** | STRIPS/PDDL operators (preconditions→effects) = capabilities-as-facts. 50-year-old model. |
| Capability selection (single-shot) | **Solved** | Unification + backward chaining (Datalog/SLD). Well-understood; buildable. |
| Conflict detection between calls | **Solved** | POP **threats** + promotion/demotion. |
| Bounded multi-step recipes (B1) | **Solved** | HTN methods (declared decomposition) — NONLIN/SHOP2. |
| Conditional / retry (B2) | **Solved** | Steel & Ho conditional plans + outcome monitoring → re-plan. |
| Open-ended planning, **closed world** (C1) | **Solved** | Classical planning (POP/HTN/PDDL) is sound/complete inside a declared operator model. See below. |
| Request → structured intent, **controlled fragment** | **Partial (measured)** | ACE parser + tolerant strategies + `shape`. **A1/A2 ~1.9 on the chat surface (`CHATBENCH_0.7.1`)** — naming, SVO, count, negation, passive all resolve. |
| Parameter binding (slot-filling) | **Partial** | Role labelling from the grammar; brittle for rich args. **Known debt: pronoun/focus binding (`B1 pron 1.24`, the "it → Commit" mis-bind)** — must fix before B1. |
| Cross-turn threading (anaphora / focus) | **Partial (known bugs)** | Threading a prior `tool_result` into the next call. **Debt: discourse-count anaphora (2 tier-1 misses) + the focus mis-bind** — the A2→B1 gate. |
| Request → intent, **arbitrary imperative NL** | **Unsolved** | The front-end problem — exactly what LLMs are for. tmct's answer: constrain the input + guide toward it. |
| Open-ended planning, **open world** (C1) | **Unsolved — see "The open-world boundary" below** | Novel errors, unmodelled effects break the closed-world assumption. The underlying obstruction is the **frame problem** in its relevance-bounding form, not just missing engineering. Escalate. |
| Autonomous agency (C2) | **Speculative** | Reachable closed-world via the reduction below; goal-*generation* in open worlds stays open. |

The pattern: **almost everything above the front-end is a solved problem in the planning/KR
literature.** The genuinely open work is (1) the NL front end and (2) the open-world boundary. tmct's
whole strategy is to sidestep both by *declaring the domain* and *refusing past its edge*.

---

## The C1 cliff — solved by classical planning (closed world)

We earlier proposed climbing C1 with **templates for graph queries**. The planning references say we
can do better, and cleanly:

- **Templates are the B1 special case.** A pre-authored query/recipe *is* a declared HTN method or a
  macro-operator: you hand-write the whole plan. That reaches B1, and reaches C1 only for the goals
  you happened to template.
- **Planning is the C1 general case.** Declare **operators** (fine-grained atoms: preconditions →
  effects) instead of whole recipes, and a **POP/PDDL planner composes them** into a plan for *any
  reachable goal* — including goal combinations nobody templated. That is precisely the leap from
  "run a canned recipe" (B1) to "generate a plan for a novel goal" (C1), and it is **deterministic and
  complete inside the declared world**.
- **Causal links = the proof chain** (why each step), **threats** = conflict handling,
  **least commitment** = don't over-order the loop. All three come free with POP.
- **Steel & Ho closes the execution loop:** monitor each `tool_result` against the operator's expected
  effect; on divergence, re-plan from the observed state (that is B2, and it is what makes C1 robust
  rather than brittle).
- **The one real risk is operator-model *fidelity*, not the planner.** Preconditions are easy to
  declare; **effects are hard** — what does `bash <cmd>` actually change in world-state? And classical
  planning assumes a *static, fully-observable, deterministic* world, which live tool execution is not.
  That is not a reason to distrust planning; it is precisely *why the Steel & Ho monitor-and-replan
  layer is mandatory, not optional*: the planner proposes against the modelled effects, execution
  checks reality, and divergence forces a re-plan. Pure STRIPS is the skeleton; **POP/HTN +
  monitoring** is the system. The difficulty migrates to authoring honest effects (the knowledge-
  engineering cost), not to the search.

**Recommendation:** adopt the operator model (Stage 0), keep **templates as declared HTN methods /
macro-operators** for common paths (they're faster and give the cleanest proofs), and fall back to
**first-principles POP/PDDL planning** for novel goals — optionally deferring the hard search to a
mature external solver (Fast Downward) while tmct stays the NL→domain compiler + proof renderer. So:
**C1 closed-world is a solved problem we adopt, not invent.** The residual — open-world C1 — stays a
refuse/escalate boundary.

---

## The C2 speculation — autonomy as a fixed meta-loop

The operator's proposed reduction: **"self-directed" is not magic — it is a canned meta-loop.**

1. Ask the fixed self-question: **"What are the current goals?"**
2. For each deduced goal, **plan to reach it** (this is C1 — assumed solved as the *gate* before C2).
3. **Choose among the unique first steps** of those plans; execute one; observe; repeat.

This is sound, and it has a name: it is essentially a **BDI agent** (Belief–Desire–Intention: Rao &
Georgeff) crossed with **Goal-Driven Autonomy** (Aha, Molineaux, Cox) and **continual/online
planning**. The elegance of the reduction is real: it collapses "autonomy" into *C1 + a
goal-deduction step + an action-selection rule*, so the only genuinely new part is **"what are the
current goals?"** — and in a **closed world that is itself a deduction**: goals fall out of a declared
goal model (maintenance goals, triggers, unmet desired-states) evaluated by **long-chain deduction**
over the KB. That is exactly the "long-chain deduction library" the operator flags — a Datalog /
Prolog (tau-prolog) / forward-chaining (RETE) engine, or an extension of `syllogise`.

So the honest claim mirrors C1: **closed-world C2 is reachable** by this reduction —
deduce-goals (long-chain inference) → plan-each (C1) → arbitrate-first-steps → act → loop. Two parts
need care, and both are literature-covered:

- **First-step arbitration.** Collect the first action of each goal's plan, dedupe, and pick by:
  (a) **keystone** — the step shared by the most goal-plans; (b) **decision-theoretic** — Steel & Ho
  expected-utility; or (c) **declared goal priority**. It must be **threat-aware**: don't pick a first
  step that clobbers another live goal's plan (POP threats lifted to the meta-level — planning over a
  conjunction of goals).
- **Intention persistence.** The raw loop (deduce → plan → act → repeat) **thrashes**: goals flicker
  and the first-step choice oscillates if everything is re-derived from scratch every tick. The **I in
  BDI is a *commitment*** — once an intention is adopted, persist with it until it is achieved, becomes
  impossible, or its goal lapses. Without this the agent is *busy, not autonomous*. This is the part
  the raw reduction misses and the BDI literature supplies.
- **Goal generation.** In the **closed** world, deducible and deterministic. In the **open** world —
  novel situations implying goals no rule declared — it is **unsolved**, and it is exactly where an
  LLM's open-ended judgement wins. Same boundary as C1, one level up.

**Verdict:** the reduction is a real architecture, not hand-waving — closed-world C2 is buildable on
top of a solved C1 + a deduction engine + a threat-aware, persistent choice rule. The sharpest thing to
carry forward: **goal *generation* is where autonomy actually lives** — everything else reduces to
solved machinery. That single step is the seam where tmct stays deterministic (closed-world goal-rules)
and an LLM earns its cost (open-world novel goals). (Deepen-next: add a `docs/references/planning/`
entry on BDI + Goal-Driven Autonomy when we get here.)

> **STATUS (0.9.5, was "gated on C1 being genuinely reached and measured"): Stage 5 SHIPPED.**
> `src/router/goal-reasoner.mjs` builds exactly the meta-loop above — deduce-goals → plan-each (C1) →
> threat-aware persistent first-step arbitration → execute one, observe, repeat — and is rule-general
> (0.8.2): two declared goal-rules (`coverage-invariant`, `cochange-risk-invariant`) selected by pure
> `applicableRules` deduction, honest refusals at both failure modes (0 applicable = open-world,
> >1 = ambiguous), zero request keywords. Measured: goal driver 100% plan / 98% result / 0%
> hallucination over 56 AGENTBENCH cases (`AGENTBENCH_0.8.2.md`).
>
> It also shipped with a real confident-wrong gap (Bug 8, found live via `demo/agentic-loop-demo.mjs`):
> `applicableRules` deduces a goal-rule from the DECLARED TOOLSET alone; in **global mode** (no focus
> entity bound — the *"goal generation is unsolved in the open world"* seam this section itself calls
> out) nothing checked whether the REQUEST ITSELF had any connection to the deduced goal, so an
> unrelated request ("write a haiku about pizza") sharing the coverage-invariant rule's declared
> toolset got a confident, well-formatted "biggest testing risk" answer instead of an honest refusal —
> exactly the open-world-goal-generation failure mode this section predicted, just surfacing as a false
> POSITIVE (answering) rather than a missing capability. **Now fixed**: a global-mode DOMAIN GATE reuses
> ask.mjs's own compositional NL grammar (`parseQuery` — the same primitive the C1 resolver already
> parses every request with) as a structural relevance check — the request must parse to a shape naming
> the candidate rule's declared `focusClass`, or it refuses at the open-world seam rather than borrow
> someone else's goal. Scoped mode was never affected (a bound focus is already proof of relevance);
> the fix adds zero request keywords, keeping the "deduction, not keyword-match" discipline this module
> was built on. Regression-tested in `test/goal-reasoner.test.mjs`; the 56-case AGENTBENCH baseline
> above is unchanged.

---

## The shared shape — both ideas locate the escalation boundary

The two reductions are the *same move*, and that is the real result. Each collapses a scary capability
into **(solved deterministic machinery) + (a residual that concentrates at exactly one place: the
open-world boundary)**:

- **C1** = classical planning (solved) + **open-world planning** (residual).
- **C2** = C1 + threat-aware goal-arbitration (solved) + **open-world goal-generation** (residual).

The residual is never scattered — it always lands at the same seam: *novelty the declared model does
not cover.* So beyond climbing a rung, both ideas do something more valuable for the **guardrail /
fast-path** framing: they **precisely locate where the deterministic core must hand off to an LLM.**
Knowing *where* to escalate is worth more than climbing one more rung — it lets the cheap, auditable,
$0 core run with confidence over everything it can prove, and spends the metered model *only* at the
open-world boundary where it is genuinely irreplaceable. That boundary — not the ladder height — is the
router's real deliverable.

---

## The open-world boundary — naming the real problem

"Unsolved. Escalate." is honest but underspecifies *what* is unsolved. Three things hide behind
that one phrase, and they are not equally hard — the point of this section is to separate them.

**Not actually open — known-hard, not unknown-how.** Planning under incomplete knowledge of the
*initial* state has real, published algorithms: belief-space heuristic search (Bonet & Geffner,
"Planning with Incomplete Information as Heuristic Search in Belief Space", AIPS 2000) generalizes
classical forward search from states to sets of possible worlds; Conformant-FF (Hoffmann &
Brafman, "Conformant Planning via Heuristic Forward Search: A New Approach", *Artificial
Intelligence* 170(6–7), 2006) makes conformant planning practical without any sensing; Petrick &
Bacchus's PKS ("A Knowledge-Based Approach to Planning with Incomplete Information and Sensing",
AIPS/ICAPS 2002) tracks the planner's *knowledge* rather than enumerating possible worlds, and
handles sensing actions directly. These are harder than STRIPS — belief space is exponentially
larger than state space — but they are **solved** in the research sense: a *declared-but-uncertain*
world, not an undeclared one. tmct doesn't have this yet; that is engineering debt to pull off the
shelf (Stage 3's "optionally defer search to Fast Downward" note applies equally to a
belief-space/conformant solver), not a research frontier.

**The genuinely open core: the frame problem, in its relevance-bounding form.** McCarthy & Hayes
coined "the frame problem" in 1969 ("Some Philosophical Problems from the Standpoint of Artificial
Intelligence", *Machine Intelligence* 4, Edinburgh University Press, 463–502) as the difficulty of
stating what *doesn't* change after an action without enumerating it. That narrow reading is
solved: situation calculus's successor-state axioms (Reiter, "The Frame Problem in the Situation
Calculus: A Simple Solution (Sometimes) and a Completeness Result for Goal Regression", 1991)
collapse the frame-axiom count from actions×fluents to actions+fluents; the event calculus
(Kowalski & Sergot, "A Logic-based Calculus of Events", *New Generation Computing* 4(1), 1986)
does the analogous thing for narrative/database updates; STRIPS's own add/delete lists (Fikes &
Nilsson, "STRIPS: A New Approach to the Application of Theorem Proving to Problem Solving",
*Artificial Intelligence* 2, 1971) are the original special case. None of these generalize past a
**declared** effect model — which is exactly tmct's closed-world assumption already, restated. What
none of them touch is the deeper reading McCarthy himself flagged as open: given an *undeclared*
world, how does a reasoner decide *which* of the unbounded facts that could be true are relevant to
consider at all, without an oracle telling it what to ignore? That is not a frame-*axiom* problem —
it's a **relevance-bounding** problem, and it has no algorithmic solution in the general case. This
is the frame problem's living core, and it is the actual content of "open-world planning" once the
closed-world engineering above is stripped away.

**The recent, rigorous treatment says this may not be a matter of degree.** Relevance realization
has its own citable literature, and it is not just popular-science framing: Vervaeke, Lillicrap &
Richards ("Relevance Realization and the Emerging Framework in Cognitive Science", *Journal of
Logic and Computation* 22(1):79–99, 2012) argue relevance realization is the problem cognitive
science has converged on as central — a peer-reviewed synthesis across the contributing
disciplines, not the popular *Awakening from the Meaning Crisis* material built on top of it.
Jaeger, Riedl, Djedovic, Vervaeke & Walsh ("Naturalizing relevance realization: why agency and
cognition are fundamentally not computational", *Frontiers in Psychology*, 2024) go further and
make the frame problem the paper's own frame: "the frame problem, defined in its most general form
as the problem of relevance" cannot, they argue, be solved algorithmically at all — turning an
ill-defined (semantic) problem into a well-defined (syntactic) one is itself the un-formalizable
step, by an argument they liken to Gödelian incompleteness. Treat that as a serious, contestable
philosophical argument, not a proof. But it is exactly the honest register this doc uses elsewhere:
not "we haven't built it", but "there is a live, peer-reviewed argument that it cannot be built as
an algorithm at all". Read this way, tmct's "Unsolved. Escalate." is not a cop-out — it may be the
only defensible position for a system that refuses to guess.

**The sibling problem on the goal side: open-world goal *recognition*.** tmct's goal-reasoner
(`src/router/goal-reasoner.mjs`) already does closed-world goal *selection* — deduce which of a
small **declared** set of goal-rules applies via `applicableRules`, refuse on 0 or >1 matches. The
harder, less-solved sibling is open-world goal *recognition*: given an arbitrary request, infer
intent from a world of **undeclared** possible goals. The closed-world version is well studied:
Ramírez & Geffner ("Plan Recognition as Planning", IJCAI 2009) compile goal recognition into a
planning problem — given a *declared* set of candidate goals and a domain theory, find which
goal's optimal plan best explains the observed actions; Keren, Gal & Karpas ("Goal Recognition
Design", ICAPS 2014, using their "worst-case distinctiveness" measure) study the dual problem —
designing the domain itself so recognition is fast. **Both assume the true goal is a member of the
declared candidate set.** Bug 8 (fixed this session, `src/router/goal-reasoner.mjs`'s domain gate)
was exactly a symptom of this boundary: `applicableRules` deduced a goal-rule from the declared
toolset alone, without checking the request itself was actually *about* that goal's domain — an
open-world-goal-generation failure surfacing as a confident false positive rather than a missing
capability.

**Symbolic + open-world + no-LLM is a narrower, mostly-abandoned research niche — say so plainly.**
The field's trajectory over the last two years has been to reintroduce an LLM specifically to plug
the open-world gap in an otherwise-symbolic planner, not to solve the open-world case symbolically.
Chen, Yang, Jia, Hu, Chen, Zhang, Wang & Pan ("Language-Augmented Symbolic Planner for Open-World
Task Planning", RSS 2024) is a clean example: a classical symbolic planner handles everything it
can, and an LLM is invoked precisely where action preconditions, objects, or properties are
incomplete — i.e., precisely at tmct's own escalation seam. This is independent confirmation from a
different research community that "closed-world symbolic, escalate at the open-world edge" is the
state-of-the-art *shape*, not a compromise unique to tmct. What's genuinely absent from the
literature is a competitive **purely symbolic, no-LLM** answer to the open-world case: searching
turns up open-set recognition / novelty detection as a live subfield, but it is a *statistical/ML*
one (Bendale & Boult, "Towards Open World Recognition", CVPR 2015 — reject-then-incrementally-learn
unknown classes), with essentially no cross-pollination into the classical goal-recognition-as-
planning literature above, which still assumes a closed candidate-goal set. That gap — not "nobody
has thought about it" but "the specific combination of open-set rejection + symbolic
goal-recognition-as-planning has no dedicated line of published work this research could find" — is
real, and it shapes the speculative angle below.

**A speculative angle that hasn't had a vehicle: bounded (N+1) goal recognition.** Full open-world
goal recognition is out of reach for a deterministic system — that's the honest boundary above. But
tmct's own architecture already narrows the problem in a way the literature doesn't: it never needs
to recognize an *arbitrary* goal, only to decide, for a small **declared** set of N goal-rules,
whether a request matches goal 1..N or belongs to an explicit **(N+1)th "none of the above,
escalate"** class — precisely the shape the Bug 8 domain gate ad-hoc-solved once, generalized.
Ramírez & Geffner's plan-recognition-as-planning gives a real mechanism for scoring "does this
request's parse best explain goal *i*'s declared plan" for *i* in 1..N; the missing piece — and the
part with no citable prior technique this research could find — is a *principled* reject rule for
the (N+1)th class, derived the same way the rest of tmct proves things (structurally, from the
grammar, never a learned score). One tractable, deterministic, no-LLM candidate: borrow the
*structure* of open-set recognition (reject when no known class's decision region contains the
input) but implement the "decision region" symbolically — a goal-rule's region is the **set of
parse shapes** that name its declared `focusClass`/toolset (exactly what the Bug 8 domain gate
already computes, reusing `ask.mjs`'s `parseQuery`), and reject-to-escalate is what happens when
the request's parse shape falls in *none* of the N regions — deterministically, not probabilistically.
This has not been published or built anywhere this research could find; it would be a genuine
new combination: symbolic, N+1-bounded, explainable goal recognition, built from grammar-shape
membership instead of either a candidate list assumed exhaustive (Ramírez & Geffner) or a learned
open-set classifier (Bendale & Boult). It stays inside tmct's ground rules — deterministic, no LLM,
every accept/reject decision traces to a parse-shape match — and it is a *narrower* claim than
"solve open-world goal recognition": it only ever answers "is this one of my N declared goals,
yes/no", never "what new goal is this". That bound is the whole point, and it is the next spike to
scope, not a result to claim yet.

---

## What stays genuinely open (say it plainly)

1. **The NL front end.** Arbitrary imperative → structured intent. tmct's answer is a *controlled
   command language* + tolerant guidance toward it — a command router for a declared fragment, not a
   general NL agent. This is the make-or-break, and it is honest to constrain it.
2. **The open-world boundary** (C1 and C2) — the frame problem / relevance realization, per "The
   open-world boundary" above. Novel errors, unmodelled effects, goals nobody declared. tmct
   refuses/escalates; the LLM wins. This is a feature (safety) and a limit (coverage), and the
   underlying research question (bounding relevance without an oracle) has a real argument, not
   yet refuted, that it is not algorithmically solvable at all — not merely unbuilt.
3. **Parameter-binding coverage** for rich arguments beyond what the grammar labels.

## Positioning (the strongest story)

Not "replace the LLM." Either a **standalone deterministic router** where reproducibility / offline /
audit / cost dominate, or — the lead — a **deterministic fast-path / guardrail in front of an LLM tool
loop**: tmct handles what it can prove (fast, free, auditable), validates the LLM's proposed calls
against declared preconditions, and escalates the rest. This de-risks coverage and is useful even at
low coverage.

## Prior art

Attempto Controlled English (tmct's lineage); Datalog / Prolog SLD-resolution + unification;
STRIPS/PDDL + POP + HTN (see [`docs/references/planning/`](docs/references/planning/README.md)); Steel
& Ho (plan-vs-execute); BDI (Rao & Georgeff) + Goal-Driven Autonomy (Aha/Molineaux/Cox); GraphPlan /
SATPLAN; semantic parsing to executable forms; OpenAI/Anthropic API-compatible shims. **On the
open-world boundary specifically** (see "The open-world boundary" above for full citations):
McCarthy & Hayes (1969, the frame problem); Reiter (1991, successor-state axioms); Kowalski &
Sergot (1986, event calculus); Fikes & Nilsson (1971, STRIPS); Bonet & Geffner (2000) and Hoffmann
& Brafman (2006) and Petrick & Bacchus (2002) (contingent/conformant/sensing-action planning);
Vervaeke, Lillicrap & Richards (2012) and Jaeger, Riedl, Djedovic, Vervaeke & Walsh (2024)
(relevance realization); Ramírez & Geffner (2009) and Keren, Gal & Karpas (2014) (goal recognition
/ goal recognition design); Chen, Yang, Jia, Hu, Chen, Zhang, Wang & Pan (2024, LLM-augmented
symbolic planning for open worlds); Bendale & Boult (2015, open-set/open-world recognition).

## Open questions (for tonight)

1. **Input contract** — controlled command language, tolerant-guided, or "any prompt"? *(Lean:
   controlled + guided.)*
2. **Interface** — Anthropic Messages only, or OpenAI adapter too? *(Lean: Messages first.)*
3. **Build vs. pull** — write the resolver/planner, or embed a JS Datalog + defer search to an
   external PDDL solver? *(Lean: pull the mature solver, own the compiler + proofs.)*
4. **Home** — capability ontology + resolver in tmct, or a new package (the `ace-owl` extraction move)?
5. **Smallest demo** — a read-only, cited, sub-10ms **answers** endpoint on a Function URL (Phase A +
   the graph-query slice) is shippable *this week* and turns "feels amazing" into a `curl`. Start there?
