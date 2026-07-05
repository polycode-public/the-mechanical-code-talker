# PLAN_CAPABILITY_ROUTER.md — tmct as a deterministic, no-LLM tool router

> **STATUS: exploratory / RFC — decisions OPEN, we should chat more.** This captures an operator
> idea (2026-07-05) and evaluates it honestly. Nothing here is committed; the point is to sharpen the
> bet, name the hard parts, and pick the smallest thing worth building. Do not treat the stage sketch
> as a schedule.

## The idea (operator, in their words, restated)

Accept a chat prompt that is a **request**. Parse it — with tmct's existing machinery — into canonical
sentences and OWL graph facts. Capture a set of **capabilities** (tools) as canonical facts *in the
same lexicon*. Add a substrate of domain-specific knowledge and the ability to **forward- and
backward-chain**. Then *infer* which capability satisfies the request, use **subject replacement** to
fill a sentence template and **token replacement** to populate a *parameterised* capability — i.e.
bind the tool's arguments from the parsed request. Expose the whole thing behind an
**Anthropic-compatible completions API** that emits `tool_use` blocks, and tmct can drive a **tool
loop**: a deterministic, offline, $0 "function-calling model."

## Why it's on-thesis (the compelling part)

tmct's whole bet is *deterministic, offline, explainable, no-LLM*. A tool router that **shows its
proof** — *why* it chose this capability and *how* it bound each parameter — is a real, differentiated
thing: auditable, reproducible, air-gappable, $0. LLM function-calling is a black box; this would be a
glass box. And most of the substrate already exists:

- **request → triples**: the ACE controlled-English parser (`src/grammar/ace.mjs`) + the tolerant
  strategies + the `shape` field already turn text into OWL-labelled `(subject, predicate, object)`.
- **capabilities as facts in the same lexicon**: a tool described in the same vocabulary lives in the
  *same semantic space* as the request, so matching is **graph unification, not embedding similarity**.
- **inference**: `tmct syllogise` already forward-chains `rdfs:subClassOf`; provenance/trust already
  ranks and explains facts; the **"if you mean X then …" ambiguity surround** already handles the
  multiple-match case; **miss-as-value** already handles "I can't map this" without throwing.
- **expose as a service**: the Repository Interface (Phase 8) is the muscle for shipping a versioned,
  machine-readable service contract — an Anthropic-compatible shim is the same move at a new endpoint.

## The pipeline

1. **INGEST** — request → tolerant parse → canonical sentence(s) → an **intent frame**:
   `(action, patient/object, modifiers/constraints, named entities)`. Reuses the ACE parser + the
   `shape` field; the imperative mood is the new bit (§ hard problem 1).
2. **CAPABILITY REGISTRY** — each tool declared as canonical facts: its action verb(s), the type of
   its object, its **parameters** (name, type, required, which request-role fills it), its
   **preconditions** and **effects**. Stored as OWL individuals (`Capability`, `Parameter`) in the
   same graph, with provenance/trust.
3. **MATCH (inference)** — **unify** the intent frame against the capability signatures. Forward-chain
   the request's entities up their type/`subClassOf` lattice; backward-chain from a capability's
   precondition/effect to test whether the request satisfies/wants it. A capability matches when its
   action subsumes the request's action and its object-type subsumes the request's object. Rank by
   specificity × trust. Multiple matches → the ambiguity surround. No match → an **honest refusal**.
4. **BIND (parameterise)** — slot-fill: map the parsed roles (subject / object / modifiers / named
   entities) onto the capability's parameters by role + type. **Subject replacement** into a confirm-
   back sentence template; **token replacement** into the parameterised tool signature → a concrete
   `tool_use` with arguments. An unbound *required* parameter → **ask for it** (guided), never guess.
5. **EMIT** — an Anthropic `/v1/messages` assistant turn: either a text answer (a query tmct can
   answer from the graph directly) or one-or-more `tool_use` blocks with bound arguments + an optional
   **proof/receipt**. Take the `tool_result` on the next call; continue the loop.

## What exists vs. what is genuinely new

- **Exists:** ACE parser, lexicon, tolerant strategies + `shape`, graph memory, provenance/trust,
  forward-chaining (`subClassOf`), the ambiguity surround, miss-as-value, the service-contract muscle.
- **New:** (a) a **capability ontology** (`Capability`/`Parameter`/`Precondition`/`Effect`) + a
  declaration format; (b) a real **unification + backward-chaining resolver** — a mini Datalog/SLD
  engine *with variables* (today's chainer is `subClassOf`-only, groundless); (c) an **imperative
  intent-frame extractor** (verbs + roles), where the grammar is currently tuned for declaratives and
  queries; (d) **parameter slot-filling**; (e) the **Anthropic-compatible HTTP shim** + the tool-loop
  turn state.

## The hard problems (be honest, or this fails quietly)

1. **The front end is the whole ballgame.** Arbitrary NL imperative → structured intent is *exactly*
   what LLMs are good at and rule systems are brittle at. tmct's honest position is "controlled input
   + tolerant guidance toward it." So **v0 must accept a constrained command language** (tmct nudges
   the user toward it via the same surround), NOT "any prompt." This is a **command router for a
   controlled fragment, not a general NL agent** — say so plainly, or over-promise and drown in
   coverage misses.
2. **Matching a single tool is tractable; achieving a goal is planning — but planning is a solved,
   deterministic field, not a research bet.** Single-shot selection = unification + subsumption
   (Datalog-ish, buildable). Multi-step goal achievement (chain N tools via their effects) =
   **classical AI planning** — STRIPS/PDDL operators, partial-order planning, HTN/NONLIN — a 40-year
   body of *no-LLM, goal-directed* work (see [`docs/references/planning/`](docs/references/planning/README.md)).
   The honest limit is **not planning, it is the closed-world assumption**: inside a declared operator
   model a planner is sound/complete and deterministic (reachable C1); the moment the world is open —
   an unmodelled effect, a novel error — it breaks and tmct escalates. **Scope v0 to single-shot**;
   the planner is a later stage, and when it comes it is *engineering against a mature literature*,
   not open research.
3. **Parameter binding coverage.** Role→param slot-filling works when the grammar labels roles; it is
   brittle for rich arguments. Controlled input helps; complex tools will still fray.
4. **Termination & safety.** A router that **refuses or asks when unsure is *safer* than an LLM** — no
   hallucinated calls. Lean into that. But coverage is lower, and the proof-chain is the whole point:
   every emitted call carries *why this tool* and *how each argument was bound*.

## Positioning (the strongest product story)

Not "replace the LLM." Two framings, and the second is probably the lead:

- **(a) Standalone deterministic router** where reproducibility / offline / safety / audit dominate:
  regulated or air-gapped environments, CI automations, high-volume cost-sensitive routing.
- **(b) A deterministic FAST-PATH / guardrail in FRONT of an LLM tool loop** — tmct handles the
  requests it can *prove* (fast, free, auditable) and **escalates the rest** to the LLM; and/or it
  **validates the LLM's proposed `tool_use`** against declared capabilities + preconditions before it
  runs. This *de-risks the coverage problem* and is immediately useful even at low coverage.

## Prior art to lean on (don't reinvent)

Attempto Controlled English (ACE — tmct's own lineage); Datalog / Prolog SLD-resolution + unification;
STRIPS / PDDL planning; semantic parsing to executable forms (text-to-SQL, λ-DCS, AMR); the
function-calling / `tool_use` JSON schema; OpenAI/Anthropic-API-compatible shims; RDF/SPARQL
query-by-unification.

## A staged sketch (NOT a schedule — a de-risking order)

- **Stage 0 — capability ontology + registry.** `Capability`/`Parameter`/`Precondition`/`Effect`
  classes; a declaration format (ACE sentences or TOML); register a toy toolset (e.g. file ops) as
  facts. *Cheap, unblocks everything, proves the representation.*
- **Stage 1 — the resolver.** A unification + backward-chaining engine (mini Datalog with variables)
  over the existing graph: forward-chain types, backward-chain preconditions, ranked matches, the
  ambiguity surround, honest refusal. *The load-bearing new capability.*
- **Stage 2 — intent frames + binding.** Imperative verb+role extraction on the controlled fragment;
  parameter slot-filling; proof-chain assembly.
- **Stage 3 — the shim.** Anthropic-compatible `/v1/messages` with `tools`; one `tool_use` per turn;
  the tool-loop state; a runnable demo toolset end-to-end.
- **Stage 4 (fork) — the guardrail.** Validate/pre-filter an LLM's proposed `tool_use` against
  declared capabilities + preconditions — the hybrid story, useful even if standalone coverage is low.
- **Stage 5 — the planner (engineering, not research).** Multi-step goal achievement over declared
  capabilities-as-operators: POP (least-commitment, causal-link proofs) or HTN (SHOP2-style
  decomposition of composite capabilities), possibly deferring the hard search to a mature external
  PDDL solver (Fast Downward) while tmct stays the NL→domain compiler + proof-chain renderer. Reaches
  **closed-world C1**; open-world C1 still escalates. Grounded in
  [`docs/references/planning/`](docs/references/planning/README.md). Only if the single-shot router
  earns it.

**Kill criterion:** build the smallest honest DEMO first (a file-ops toolset: *"remove the test file
for the http module"* → `delete_file(path=test/http.test.mjs)` with a proof chain, refusing when
ambiguous). If controlled-fragment coverage on a realistic toolset is so low that every request needs
the LLM anyway, the **standalone** story dies — but the **guardrail/fast-path** story (Stage 4) can
still stand on its own.

## Open questions (for the chat)

1. **Input contract** — controlled command language, tolerant-guided, or "any prompt"? *(Lean:
   controlled + guided.)*
2. **Scope** — single-shot router first, or commit to the planner? *(Lean: single-shot v0.)*
3. **Product shape** — standalone router, or LLM fast-path/guardrail as the lead? *(Lean: guardrail
   leads, standalone is the purist demo.)*
4. **Home** — does the capability ontology + resolver live in tmct, or a new package (the same
   extraction move as [[PLAN_OSS_ACE_PARSER]])?
5. **Build vs. pull** — how much of the unification/backward-chaining core do we write vs. adopt a JS
   Datalog?
6. **Smallest compelling demo** — what toolset makes the glass-box pitch land in one screen?
