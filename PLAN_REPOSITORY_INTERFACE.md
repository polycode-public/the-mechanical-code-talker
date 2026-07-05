# PLAN_REPOSITORY_INTERFACE.md — seonix inverts into a tmct user

The Phase 8 plan (operator-specified 2026-07-05). tmct v0.1.0 was a whole-package lift OUT of
`@polycode-projects/seonix`; this phase inverts the relationship. seonix reorients as a **user** that
imports the tmct library and exposes its native graph to tmct as a typed service — the mirror image of
`PLAN_CHAT_EXTRACTION.md`, which pulled chat the other way. There, seonix was the host and chat the
tenant; here, tmct is the interpreter and seonix one provider among several. This plan defines, reference-
implements, and tests the **Repository Interface** that makes that inversion a contract rather than a habit.

## Context — what exists to grow from

- **The passive adapter contract** (`docs/adapter-contract.md`, item 14): a provider hands tmct one entities
  payload; `parseEntities()` (`src/codegraph.mjs`) yields `{ individuals, byId, relations, proseIndex }`;
  everything runs off that. Resolution order (`src/source.mjs`): a registered in-process provider
  (`registerProvider`), else `TMCT_GRAPH_FILE`, else `<repo>/.tmct/graph.json`, with ENOENT → the empty
  bootstrap payload. Today the seam is a **payload loader** — a lump of JSON crosses once.
- **The tool surface tmct carried at the lift** (`src/server.mjs`, `dispatchTool`): describe / snippet /
  signature / members / subclasses / exports / impact / callers / callees / calls / cochanges / tests_for /
  untested / architecture / history (file/method/class) / search / context / ask. seonix's own
  `dispatchTool` is still **byte-identical** — the same switch on both sides of the lift. That switch is the
  de-facto draft of the interface; it just isn't named or versioned as one.
- **The shared type system** (`ontology/tmct-core.ttl`, `src/memory/core.mjs`): individuals are typed by
  `tmct:` classes (module / class / function / method / attribute / variable / commit / test) and edges by
  `tmct:` object properties (imports / calls / tests / contains / extends / defines / touches …), each
  `rdfs:seeAlso`-aligned to the code graph's SEON / `mgx:` prop tokens. Because both packages read the same
  OWL vocabulary, the human/code world is **already quantized into shared types** before any wire format.
- **`createSession()`** (`src/chat.mjs`): the session-handle prototype — it already holds `focus`, `last`,
  the memory dir, graph, config, and a `turn()`/`close()` lifecycle with no process-global state. It is the
  thing the interface's lifecycle grows from.

## Why tmct owns the shape (the central seam)

tmct is the **brittle side**: query interpretation, tolerant parsing, the grammar/lexicon/template stack.
The graph producer is the stable side — its data model changes slowly. The brittle side must define and
version the interface it optimizes against, so its instability is absorbed internally rather than leaking
into every provider. So **tmct defines the adapter shape; the producer implements it** — not the reverse.

The OWL grounding is what makes this cheap instead of a bespoke schema war. The interface is **built from the
shared `tmct:` types**, not ad-hoc JSON: a service returns an `Individual` whose `class` is a `tmct:` class
and whose edges carry a `tmct:` object-property kind. Both sides already agree on what a "module" or a
"calls" edge *is* (`tmct-core.ttl` is the contract's type dictionary), so the interface only has to name the
**operations** over those types, not renegotiate the types themselves.

## The service inventory (dispatchTool → the Repository Interface)

The migration is concrete: `dispatchTool`'s switch is a name→handler map today. It becomes a **typed service
object** — the callbacks bundle a provider supplies — where each arm is a method with OWL-grounded args and
results. tmct's own engine already consumes these internally (every `render*` in `codegraph.mjs` calls the
same primitives); the interface simply names the seam between "interpret the query" and "ask the graph for
truth" so the graph half can be swapped. Grouped:

- **Entity resolution / lookup** — `resolve(term) → {match: Individual, candidates: Individual[]}` (the
  `resolveSymbol` seam; every other service takes a resolved id), `describe(id)`, `members(classId)`,
  `subclasses(classId)`, `exports(moduleId)`, `signature(id)`. `Individual = {id, label, class ∈ tmct:Class,
  attributes}`.
- **Edge traversal** — `edges(id, kind) → Edge[]` over the closed `tmct:` object-property kinds
  (calls / callers / callees / imports / impact-closure / tests_for / cochanges / contains / extends).
  `Edge = {subject, object, predicate, prop}`. `impact(moduleId)` is the transitive closure the interpreter
  cannot compute without provider truth.
- **Source spans** — `snippet(id) → {path, span, body}` and the `context(symbol)` edit bundle. These reach
  past the graph into the working tree; a provider that has no source (fixture, browser) returns spans-absent
  honestly rather than throwing.
- **Aggregates / architecture** — `architecture({package})`, `untested()`, `stats()` (per-`tmct:class`
  counts, read straight from the payload's `classes[]`/`vocabulary[]`).
- **History / temporal** — `history(id)`, `file_history` / `method_history` / `class_history`, over
  `tmct:commit` individuals and `tmct:touches` edges.
- **Search / locate** — `search(query, {kind, name, decorator}) → Individual[]` (lexical, provider-local),
  the `proseIndex` free-text tier, and `ask(query)` — the composed NL round-trip that is tmct's whole reason
  to exist. `locate` / `digest` are `context` in another dress (see open questions on v1 scope).

Each service gets a typed arg record, a typed result, and an **error contract**: a clean miss (empty result +
reason) is a first-class return, never an exception — the honest-miss ethos is in the interface, not bolted on.

## The flow (LLM agent → seonix → tmct library → back)

1. An LLM agent (Claude Code et al.) is briefed to use seonix's agent-facing tools.
2. When the agent judges it useful, seonix's `ask`-family tools pass **natural language** — not a structured
   query — to tmct.
3. seonix calls the **tmct library in-process** with `(query, callbacks)`, where `callbacks` implements the
   Repository Interface over seonix's native graph.
4. tmct resolves the query **mechanically** (interpret → strategy pipeline → render), calling **back** into
   the callbacks for every piece of graph truth it needs.
5. Results return through seonix to the agent.

The LLM stays entirely **outside** tmct — exactly as the no-LLM ethos (ROADMAP item 1) requires. tmct becomes
the deterministic NL front-end for *any* agent-facing graph tool; seonix is just the first host. This is the
inversion stated plainly: seonix used to *contain* the interpreter; now it *calls* it.

## The in-process lifecycle (the research heart)

The interface is **wider than the in-house chat**, so between-call state that `runChat` kept implicit must
become explicit. seonix is a long-lived host calling tmct repeatedly; there is no process to own globals.

- **An explicit session/context handle**, created and disposed by the caller — `focus`, `last-answer`, memory
  dir, loaded lexicon — grown from `createSession()`'s returned object (already global-free). No
  process-global state; concurrent sessions each hold their own handle.
- **Provider-owned caching, by contract.** tmct **never caches provider truth** — the `source.mjs`
  per-process file cache and its known staleness in long-lived hosts is *resolved by moving the concern to
  where it belongs*: a registered provider already returns uncached and "owns its own refresh policy"
  (`fetchEntities`). The interface promotes that from a footnote to a rule — a live provider re-indexes on its
  own cadence; tmct reads through, never behind.
- **Re-entrancy and concurrency documented per service.** Each service declares whether it is safe to call
  concurrently across handles (all reads are; the handle is the only mutable state). Proven, not asserted —
  the contract suite's concurrent-session cases are the evidence.

## The five deliverables (from ROADMAP Phase 7)

1. **The interface DEFINITION** — `docs/repository-interface.md` (versioned prose) **plus a machine-readable
   shape**: a JSON-schema / typedef of every service, its args, result types, and error contract, generated
   from and grounded in `tmct-core.ttl`. tmct owns and versions it.
2. **A REFERENCE IMPLEMENTATION tmct ships** — the in-repo providers (the fixture graph + the empty/bootstrap
   graph) implementing **every** service. These are the executable specification an external producer reads
   first; they are degenerate providers (bootstrap returns honest empties, fixture returns a small real graph).
3. **The contract test suite (the compatibility kit)** — a runnable suite any implementation is tested
   against. tmct's reference passes it in `npm test`; **seonix runs the SAME suite** against its native
   implementation to claim conformance. **Conformance = passing the suite, not matching prose.** This is the
   load-bearing deliverable: it is what lets the interface evolve without a coordination meeting.
4. **The session-handle lifecycle, implemented** — create/dispose, provider-owned caching, documented
   re-entrancy, proven by the suite's concurrent-session cases.
5. **`tmct init`** — the interface's onboarding surface (below).

## seonix chat = tmct chat + a pointer; and browser mode

- **One chat, N backends.** seonix's chat surface stops being a fork of the chat code and becomes tmct's chat
  loaded with a repository-interface handle over seonix's graph. One chat implementation, many providers.
- **Browser mode.** The same inversion runs in seonix's code-browser page. The engine core (interpret / ask /
  render, lexicon, templates) is **already pure JS** with no node-only dependency — wink's
  `eng-lite-web-model` *is* the browser build. The `fs` / `readline` / `child_process` / Ink seams stay
  node-side; the browser gets the **library surface, not the shell**. seonix already ships its graph to the
  page, so it supplies the callbacks in-page. The only genuinely new piece is a **browser storage seam for
  memory** (or provider-supplied persistence) — tmct's own memory (`.tmct/memory/`) has no filesystem in the
  browser.

## What moves vs what stays

- **Moves / is newly defined:** the named, versioned Repository Interface + its machine shape; the callbacks
  object as a first-class parameter to the library entry point; the explicit session handle; the reference
  providers; the contract suite; `tmct init`.
- **Stays put:** every `render*` and primitive in `codegraph.mjs`, the interpret/ask/template stack, the OWL
  vocabulary. **tmct's own memory never enters the interface** — the utterance/fact/block graph under
  `.tmct/memory/` is tmct-owned output, never a provider's to supply (per adapter-contract §5). The provider
  gives *code-graph truth*; memory is tmct's alone.
- **Deprecates:** the passive "payload loader" framing of item 14 — it survives as the simplest provider (a
  file that returns one payload), a degenerate case of the richer service interface.

## Versioning / evolution policy

The interface must change **without breaking conformant providers**. Two mechanisms:

- **Additive by default.** New services and new optional args are additive; the suite for version *N* stays
  green under *N+1*. Providers advertise a **capability set** (which services they implement); the interpreter
  degrades a query whose capability is absent to an honest miss or a lesser strategy, never an error. This is
  the same tolerance the answer path already has for missing edges.
- **Capability negotiation, not a version wall.** A handle carries the provider's declared capabilities; tmct
  plans around them. A breaking change is a new *major* interface version with its own suite; a provider
  claims the versions it conforms to. The corpus-tiering discipline (ROADMAP Phase 4) is the precedent: absent
  capability = defaults, never failure.

## First steps (when this track opens)

1. **Name the interface off the existing switch.** Extract `dispatchTool`'s arms into a typed service object
   and re-express tmct's internal callers against it — a refactor with no behaviour change, `npm test` green.
   This makes the de-facto interface explicit before it is documented.
2. **Draft `docs/repository-interface.md` + the machine shape** from that service object, grounded in
   `tmct-core.ttl`; enumerate the six groups with typed args/results and the shared error contract.
3. **Stand up the reference providers** (fixture + bootstrap) implementing every service; wire them into the
   contract suite; make tmct's reference pass in `npm test`.
4. **Prototype the session handle** by generalizing `createSession()`'s return object into the caller-owned
   handle; add concurrent-session cases to the suite.
5. **Have seonix import tmct and pass the suite** against its native graph — the first real conformance claim.
6. **Ship `tmct init`**: seed/link the tier-1/2 corpuses (Phase 4 policy), write `tmct.toml` (the
   `seonix.toml` externalized-config pattern), create `.tmct/`, record provenance — one command to a working
   install for a host package or a bare user.

## Open questions

- **Sync vs async service signatures.** seonix's graph is in-memory (sync); a file/HTTP provider is async.
  Does the interface mandate async everywhere (uniform, but forces `await` on hot in-memory reads) or allow
  sync with an async-lifting wrapper? Leaning uniform-async for one contract.
- **v1 surface vs capability extensions.** Do `digest` / `locate` / `context` (working-tree-reaching, source-
  span services) belong in interface v1 or in a **source-access capability** a graph-only provider can omit?
  A provider with no working tree should conform without them.
- **Error taxonomy.** The honest-miss-as-value rule needs a small closed set of miss reasons
  (unresolved term / capability absent / truncated graph / no source) that the interpreter can render — not
  free-text errors.
- **How memory relates to the interface.** Settled in principle (memory is tmct's, never the provider's) but
  the handle carries the memory dir — the interface must expose *where* memory lives without ever routing
  memory *through* a provider. Keep the two graphs strictly separate at the type level.
- **Interaction with Phases 5 and 6.** The `via` provenance the dual-banding bench reads
  (`PLAN_FORMULAIC_COMPETENCE.md`) and the segmented answer IR (`PLAN_RESPONSE_FINISHING.md`) both live on
  tmct's side of the seam — the interface returns graph truth; finishing and banding happen after. Confirm no
  service result needs to carry finishing/banding metadata back to the provider (it should not).
