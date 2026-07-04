# mct ROADMAP

mct v0.1.0 is a **whole-package lift** of the seonix chat surface: identical
shape, green tests, mct branding. That was deliberate — it gives every ambition
below a working, tested starting point instead of a green field. This document
carries the full set of ambitions for the project; none of them are implemented
in v0.1.0 beyond what the lift already provides.

## The product vision

### 1. A tolerant, ELIZA/PARRY-style chat, obsessed with software repositories
A best-efforts conversational surface that **guides users toward precision
queries**. ELIZA/PARRY-style pattern reflection, but domain-obsessed the way
PARRY was obsessed with the mafia — mct may heavily assume a narrow context (you
are asking about *this* codebase) and exploit that assumption to answer cheaply
and confidently. Tolerant of loose, fuzzy, misspelled input; never silently
wrong.

### 2. Its own well-defined grammar
A first-class, documented grammar for the input language mct accepts and the
query language it maps onto — extracted from the current ad-hoc pattern matching
in `ask.mjs` into an explicit, testable grammar definition.

### 3. Ontologies: OWL-SEON / FAMIX + core OWL/RDF
Ground the vocabulary in real software-engineering ontologies:
- **OWL-SEON** and **FAMIX** for software-entity concepts (classes, methods,
  packages, calls, inheritance, …).
- Core **OWL/RDF** vocabulary for the general relational scaffolding.
This gives mct a principled type system for what it can talk *about*.

### 4. Sentence-fragment template libraries + an SE phrase book
- Libraries of **sentence-fragment templates** for two jobs: matching user
  *input* and generating *responses*.
- A **software-engineering "phrase book"**: the idiomatic ways engineers phrase
  questions and answers about code, curated so mct sounds fluent in the domain.

### 5. Calculation surfaced as reasoning
Present derived facts as lightweight reasoning: "there are a lot of tests for a
codebase of that size", "this module is unusually central". These are
**calculations**, not model inference — deterministic, explainable, cheap.

### 6. Optionally running linters/tests to *observe*
Let mct **run linters or tests** to observe whether something actually worked,
reporting the observation — again without "reasoning", just measurement.

### 7. Data formats: JSONL, TOML, .txt line files
mct's own data (phrase books, template libraries, ontology fragments, session
records) should live in **plain, diffable formats**: mostly **JSONL**, **TOML**,
and **.txt** line files. A graph store is possible later, but is not the default.

## Architectural ambitions

### 8. Shed the codebase-index dependency
mct should keep **no codebase index of its own** and depend on none. Today the
lift still carries seonix's full extraction stack (Python `ast`, tree-sitter,
Roslyn/Java extractors, `codegraph.mjs`, etc.) because the chat surface does not
separate cleanly at the source. Sever that: mct consumes a graph via an
adapter (below) and drops the extraction code entirely.

### 9. The clean chat / primitives split
The lift is intentionally *not* split. At the seonix HEAD it was lifted from:
- `ask.mjs` mixes movable grammar with core primitives (`resolveObject`,
  `edgesOfKind`, `refineToEntities`, `traverse`);
- every slash-command routes through core `dispatchTool` (`server.mjs`);
- the `ask` tests build real graphs via core `buildEntities`.
Pull the movable conversational grammar out of the core primitives into its own
cohesive module(s), so the chat engine stands alone.

### 10. The seonix→mct adapter
Define the **graph-provider touchpoint interface** so seonix (and any other
producer) can feed mct without mct importing an indexer. The grounding for the
lift identified this seam:
- a **loader** yielding `{ individuals, byId, relations, proseIndex }`;
- plus the primitives `relationKind`, `impactClosure`, `resolveObject`, `ask`,
  `rephraseHint`, `fetchEntities`, `dispatchTool`.
v0.1.0 already publishes these as named exports (see `src/index.mjs` and the
`exports` map) so the adapter has a **target surface** to bind to. The adapter
implementation itself is future work, tracked in **both** repos' roadmaps.

### 11. `.mct` artifact directory migration (deferred)
The lifted code writes and reads the graph artifact under `.seonix/`
(`SESSION_LOG_DIR`, session logs, `graph.json`). Renaming it to `.mct/` was
**deferred at v0.1.0** because the name is threaded through many tests and
fixtures, so the swap is not trivially test-safe. Migrate it once the adapter
(item 10) owns artifact-path resolution, updating the fixtures in the same pass.

### 12. Library-first design for extension
mct is designed as a **library for extension** — the `exports` map and the
primitives above are the extension surface. Keep that contract stable and
documented as the internals are refactored.

## Explicitly out of scope (for now)

- No website, no AWS, no benchmark rig — mct is a published npm library only.
- No auto-publish: releasing a version is gated on a deliberate version-bump
  commit plus a configured `NPM_TOKEN` in CI.
