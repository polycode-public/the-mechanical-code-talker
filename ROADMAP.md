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

## Parsing, memory, and reasoning ambitions

These items expand a set of sketched ideas (`code-talker-ideas.txt`) into
concrete scope. They sit between the product vision above and the
architectural ambitions below: they describe how the tolerant chat surface
(item 1), its grammar (item 2), and its ontology grounding (item 3) actually
work end to end.

### 8. Multi-strategy request classification and ranking
Instead of a single best-guess parse, run the request through **all the
classes of thing it could be** — ideally enumerated via an ontology of prose —
parse it with each class's own strategy, execute the strategies that look like
winners, then combine similar result classes and rank the candidate responses
to pick one. This turns the "own grammar" ambition (item 2) into an explicit
multi-candidate pipeline, giving the tolerant chat surface (item 1) a
principled way to try several readings of ambiguous input before committing
to an answer, rather than committing early to one parse.

### 9. Conversational memory as its own graph
Once a request is parsed, record it as an "a-visitor-said" item; responses to
queries are recorded too. With both sides of the exchange captured, future
input can be matched against **prior questions** by text similarity, not just
against the code graph — a second, complementary memory that grows from the
conversation itself rather than from source extraction. This is mct's own
session data, in the JSONL/TOML/.txt formats already scoped in item 7, and is
distinct from the code graph the seonix adapter (item 14) delivers — it is
not written back through that adapter. *(Ambiguity: the ideas file just says
"added to the graph"; I've read this as mct's own conversational graph, kept
separate from the indexed code graph. Worth the operator confirming — if the
intent was instead to annotate the seonix-fed graph itself, that changes the
adapter contract in item 14.)*

### 10. Input normalization pass (grammar / spell / style checks)
Run a grammar check, spell check, and style check over parsed input as a
normalization pass alongside classification (item 8), so misspelled or
ungrammatical input is repaired or scored before it's matched against
templates — a concrete mechanism for the "tolerant of loose, fuzzy, misspelled
input" promise in item 1. The same checks are an obvious fit for the
"observe" ambition (item 6): running them over repo prose (docs, comments,
commit messages) as another observable measurement, alongside linters and
tests over code, not just over user input.

### 11. Formal logical reasoning engine over the ontology (Prolog / Progol)
Apply real logical inference (e.g. modus tollens and other rules of inference)
to a formula extracted from parsed prose, checked against the axioms already
present in the ontology (item 3) — a step beyond the deterministic arithmetic
already scoped as "calculation surfaced as reasoning" (item 5). The sketch is:
map OWL constructs into templates over parameter expressions (Prolog terms or
similar), then use a theorem prover — Progol (inductive logic programming) is
named as a candidate — to prove goals against the parsed prose. This is a
materially bigger lift than item 5 and depends on the ontology work (item 3)
landing first; treat it as exploratory rather than committed scope until a
spike confirms the OWL-to-template mapping is tractable.

## Architectural ambitions

### 12. Shed the codebase-index dependency
mct should keep **no codebase index of its own** and depend on none. Today the
lift still carries seonix's full extraction stack (Python `ast`, tree-sitter,
Roslyn/Java extractors, `codegraph.mjs`, etc.) because the chat surface does not
separate cleanly at the source. Sever that: mct consumes a graph via an
adapter (below) and drops the extraction code entirely.

### 13. The clean chat / primitives split
The lift is intentionally *not* split. At the seonix HEAD it was lifted from:
- `ask.mjs` mixes movable grammar with core primitives (`resolveObject`,
  `edgesOfKind`, `refineToEntities`, `traverse`);
- every slash-command routes through core `dispatchTool` (`server.mjs`);
- the `ask` tests build real graphs via core `buildEntities`.
Pull the movable conversational grammar out of the core primitives into its own
cohesive module(s), so the chat engine stands alone.

### 14. The seonix→mct adapter
Define the **graph-provider touchpoint interface** so seonix (and any other
producer) can feed mct without mct importing an indexer. The grounding for the
lift identified this seam:
- a **loader** yielding `{ individuals, byId, relations, proseIndex }`;
- plus the primitives `relationKind`, `impactClosure`, `resolveObject`, `ask`,
  `rephraseHint`, `fetchEntities`, `dispatchTool`.
v0.1.0 already publishes these as named exports (see `src/index.mjs` and the
`exports` map) so the adapter has a **target surface** to bind to. The adapter
implementation itself is future work, tracked in **both** repos' roadmaps.

### 15. `.mct` artifact directory migration (deferred)
The lifted code writes and reads the graph artifact under `.seonix/`
(`SESSION_LOG_DIR`, session logs, `graph.json`). Renaming it to `.mct/` was
**deferred at v0.1.0** because the name is threaded through many tests and
fixtures, so the swap is not trivially test-safe. Migrate it once the adapter
(item 14) owns artifact-path resolution, updating the fixtures in the same pass.

### 16. Library-first design for extension
mct is designed as a **library for extension** — the `exports` map and the
primitives above are the extension surface. Keep that contract stable and
documented as the internals are refactored.

## Explicitly out of scope (for now)

- No website, no AWS, no benchmark rig — mct is a published npm library only.
- No auto-publish: releasing a version is gated on a deliberate version-bump
  commit plus a configured `NPM_TOKEN` in CI.
