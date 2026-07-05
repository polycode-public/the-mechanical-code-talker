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

With the shim + a small tool set (graph-query tools: `find_definition`, `find_callers`,
`list_members`…), run tmct up the **agentic ladder (A0→C2)** and record where it actually lands *now*.
Expected: **A0 solid, A1–A2 partial** for the code-navigation domain; nothing above. Use the existing
CHATBENCH / `SKILL_CHAT_PLAYTEST` discipline (deterministic replay, no judge needed for
did-it-complete). Output: an honest "today" row — the baseline every later claim is measured against.

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
| Request → structured intent, **controlled fragment** | **Partial** | ACE parser + tolerant strategies + `shape`. Solid for controlled/declarative input. |
| Parameter binding (slot-filling) | **Partial** | Role labelling from the grammar; brittle for rich arguments. |
| Request → intent, **arbitrary imperative NL** | **Unsolved** | The front-end problem — exactly what LLMs are for. tmct's answer: constrain the input + guide toward it. |
| Open-ended planning, **open world** (C1) | **Unsolved** | Novel errors, unmodelled effects break the closed-world assumption. Escalate. |
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
- **Goal generation.** In the **closed** world, deducible and deterministic. In the **open** world —
  novel situations implying goals no rule declared — it is **unsolved**, and it is exactly where an
  LLM's open-ended judgement wins. Same boundary as C1, one level up.

**Verdict:** the reduction is a real architecture, not hand-waving — closed-world C2 is buildable on
top of a solved C1 + a deduction engine + a threat-aware choice rule. It should be a **Stage 5**, gated
on C1 being genuinely reached and measured. (Deepen-next: add a `docs/references/planning/` entry on
BDI + Goal-Driven Autonomy when we get here.)

---

## What stays genuinely open (say it plainly)

1. **The NL front end.** Arbitrary imperative → structured intent. tmct's answer is a *controlled
   command language* + tolerant guidance toward it — a command router for a declared fragment, not a
   general NL agent. This is the make-or-break, and it is honest to constrain it.
2. **The open-world boundary** (C1 and C2). Novel errors, unmodelled effects, goals nobody declared.
   tmct refuses/escalates; the LLM wins. This is a feature (safety) and a limit (coverage).
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
SATPLAN; semantic parsing to executable forms; OpenAI/Anthropic API-compatible shims.

## Open questions (for tonight)

1. **Input contract** — controlled command language, tolerant-guided, or "any prompt"? *(Lean:
   controlled + guided.)*
2. **Interface** — Anthropic Messages only, or OpenAI adapter too? *(Lean: Messages first.)*
3. **Build vs. pull** — write the resolver/planner, or embed a JS Datalog + defer search to an
   external PDDL solver? *(Lean: pull the mature solver, own the compiler + proofs.)*
4. **Home** — capability ontology + resolver in tmct, or a new package (the `ace-owl` extraction move)?
5. **Smallest demo** — a read-only, cited, sub-10ms **answers** endpoint on a Function URL (Phase A +
   the graph-query slice) is shippable *this week* and turns "feels amazing" into a `curl`. Start there?
