# tmct ROADMAP

tmct v0.1.0 was a **whole-package lift** of the seonix chat surface (published
as `@polycode-projects/mct`): identical shape, green tests, new branding. That
was deliberate — it gave every ambition below a working, tested starting point
instead of a green field. v0.2.0 is the **reshape**: the lift's LLM fallback,
extraction stack, and MCP server are gone, and the package, naming, and license
now match the product this document describes.

This roadmap is organized into phases. The original 16 ambition items are
mapped into them (item numbers retained for traceability); the seven sketches
formerly held in `code-talker-ideas.txt` are folded into items 8–11 below and
the file has been deleted.

## The umbrella product definition (item 1)

**A tolerant, ELIZA/PARRY-style chat, obsessed with software.** A best-efforts
conversational surface that guides users toward precision queries.
ELIZA/PARRY-style pattern reflection, but domain-obsessed the way PARRY was
obsessed with the mafia — tmct may heavily assume a narrow context (you are
asking about *this* codebase, or about what tmct itself remembers) and exploit
that assumption to answer cheaply and confidently. Tolerant of loose, fuzzy,
misspelled input; never silently wrong; **no LLM anywhere in the product**.
Every phase below serves this definition.

---

## Phase 0 — Reshape (v0.2.0) — the current work

One commit per step, `npm test` green at each.

- **DONE — Strip the LLM fallback** (`--with-claude` / `--with-copilot` and the
  `hook-augment` mode removed; the product path is now provably model-free).
- **DONE — Drop the extraction/viz stack** *(item 12: shed the codebase-index
  dependency)*: Python `ast`, tree-sitter, Roslyn/Java extractors, walk/viz/
  timeline/temporal modules, `roslyn/`, `java/`, `templates/` all deleted. tmct
  consumes a graph via the provider seam; it produces none.
- **DONE — Drop the MCP server**: `@modelcontextprotocol/sdk` removed;
  `dispatchTool` survives as the plain internal tool switch.
- **DONE — Carve `buildEntities`** into `src/graph-build.mjs`: the pure
  in-memory graph assembly function, kept as the future memory writer
  primitive.
- **DONE — Empty-graph bootstrap** *(item 14, partial)*: a missing graph file
  is no longer an error; tmct starts empty, says so, and creates
  `.tmct/graph.json` from the conversation. The full provider adapter contract
  is Phase 1.
- **DONE — tmct naming purge** *(item 15, widened)*: seonix AND the interim
  "mct" replaced throughout — package
  `@polycode-projects/the-mechanical-code-talker`, bin `tmct`
  (`bin/tmct.mjs`), tool prefix `tmct_*`, artifact dir `.tmct/`, env
  `TMCT_GRAPH_FILE`, prompt `tmct>`.
- **DONE — License swap to MPL-2.0** (from AGPL-3.0): free commercial use,
  file-level publish-and-attribute copyleft.
- **DONE — README rewrite + GitLab Pages home page** (`public/index.html`,
  `pages` CI job): https://polycode-projects.gitlab.io/the-mechanical-code-talker/
- **DONE — `docs/references/` skeleton + `ontology/`**: the reference-library
  index (canonical URL / retrieval date / licence / consumer per entry), OWL 2
  vocabulary notes, ACE-OWL sub-fragment pattern table, ConceptNet relation
  list, and the `ontology/tmct-core.ttl` placeholder. This feeds the Phase 2
  grammar work; the library grows as sources are web-verified.
- **DONE — Publish 0.2.0** under the new name; deprecate
  `@polycode-projects/mct@0.1.0` with a rename pointer.

---

## Phase 1 — Interpretation pipeline + memory foundations

### Item 8 — Multi-strategy request classification and ranking → `src/interpret/`
Instead of a single best-guess parse, run the request through **all the classes
of thing it could be**, parse it with each class's own strategy (grammar parse,
keyword picking, noise-word removal, fuzzy matching — later the ACE strategy
from Phase 2), execute the strategies that look like winners, then **merge
same-class results** and surround **distinct-class results** with "if you mean
X then …". Grows from `ask.mjs`'s existing 2-way merge into
`interpret/pipeline.mjs` + `interpret/merge.mjs` + `interpret/strategies/*`.
*(Covers sketch 1 of the former `code-talker-ideas.txt`: "request → all the
classes of things it could be → parse using each class-specific strategy →
execute winners → combine similar result classes and rank".)*

### Item 13 — The clean chat / primitives split
Pull the movable conversational grammar out of the core primitives
(`resolveObject`, `edgesOfKind`, `refineToEntities`, `traverse`) so the chat
engine stands alone. `chat.mjs` slims to the conversational layer + `runTurn`
orchestration.

### Item 10 — Input normalization pass (grammar / spell / style checks)
Run a grammar check, spell check, and style check over input as a
normalization pass alongside classification (item 8), so misspelled or
ungrammatical input is repaired or scored before template matching — the
concrete mechanism behind item 1's "tolerant of loose, fuzzy, misspelled
input" promise. The same checks later serve the "observe" ambition (item 6)
over repo prose. *(Covers sketches 3, 4, and 5 of the former ideas file:
grammar check, spell check, style check.)*

### Item 9 — Conversational memory as its own graph → `src/memory/`
Record every parsed request as an "a-visitor-said" item and every response
alongside it, in tmct's own OWL-labelled graph (`memory/core.mjs`), with text
blocks under a PageRank-style relevance index (`memory/blocks.mjs`) and
session-log cleaning/folding (`memory/fold.mjs`). Future input can then match
against **prior questions** by similarity, not just against a provided code
graph. This is tmct's own data under `.tmct/`, distinct from any
provider-supplied graph and not written back through the provider adapter.
*(Covers sketch 2 of the former ideas file: "once parsed the text is added to
the graph as a-visitor-said item; responses from queries go in the graph; text
matching may find similar questions".)*

### Item 14 (finish) — The graph-provider adapter contract
Define the provider touchpoint interface — a loader yielding
`{ individuals, byId, relations, proseIndex }` plus the published primitives —
so seonix or any other producer can feed tmct without tmct importing an
indexer. Phase 0 shipped the bootstrap seam; this finishes the contract.

### Item 16 — Library-first design for extension
Keep the `exports` map and the primitives stable and documented as the
internals are refactored.

### Shell work
- **Ink console shell** (`src/tui/app.mjs`, ink + react, no build step) around
  the shared session sink; readline `runChat` stays as `--plain` and as the
  test surface. *(Decision: OpenTUI ruled out — `@opentui/core` depends on Bun
  FFI (`bun-ffi-structs`, native Zig renderer), not Node-clean; revisit when it
  runs under plain Node.)*
- Fold the surviving `bin/cli.mjs` arms into `bin/tmct.mjs`; delete `cli.mjs`.

---

## Phase 2 — Grammar → OWL + corpus

### Item 2 — Its own well-defined grammar → `src/grammar/ace.mjs`
A first-class, documented, testable grammar — an **ACE-inspired controlled
fragment** (~8 sentence patterns; see
`docs/references/schemas/ace-owl-fragment.md`) that emits **OWL-labelled
triples** when text fits it, backed by a declared lexicon
(`grammar/lexicon.mjs`, TOML/JSONL data). Plugs into the item-8 pipeline as
one strategy among several: fitting the grammar is a strong signal, missing it
falls back to the tolerant strategies.

### Item 3 — Ontology grounding: core OWL/RDF + SE vocabularies
Ground the memory vocabulary in real ontologies: core **OWL 2 / RDF / RDFS**
scaffolding plus software-entity concepts (the SEON-derived terms the graph
already uses — `seon:`, `mgx:` prefixes — with **OWL-SEON** and **FAMIX** as
reference vocabularies). Deliverable: `ontology/tmct-core.ttl`.

### Items 4 + 7 — Template libraries, phrase book, plain data formats
Sentence-fragment template libraries for matching input and generating
responses, plus a software-engineering phrase book — all in plain, diffable
formats (**JSONL**, **TOML**, **.txt** line files).

### ConceptNet corpus slice
A committed, filtered English/tech-domain **ConceptNet slice** (CC-BY-SA 4.0
notice, size-budgeted) with the ~35-row relation→ACE-OWL-pattern mapping table
(`src/corpus/conceptnet.mjs` + `conceptnet-map.toml`; relation list in
`docs/references/schemas/conceptnet-relations.md`). The corpus seeds the
bootstrap graph so an empty tmct still has a vocabulary.

### Reference library growth
Grow `docs/references/` with web-verified sources: ACE/APE papers, ConceptNet
docs, ELIZA/PARRY lineage papers (only redistributable licences committed) —
and finish `ontology/tmct-core.ttl` alongside the grammar work.

---

## Phase 3 — Chat tuning cycle (autonomous)

The measurement loop that turns the above into a tunable product — specified
in `SKILL_TUNING_CYCLE.md`:

- a fixed, versioned **chatbench case set** (`chatbench/cases.jsonl`);
- a **deterministic replay runner** over `runTurn` (the product is
  deterministic — one run per arm suffices);
- **LLM-as-judge** scoring (N≥3 samples per case; groundedness / correctness /
  honesty-on-miss / rephrase-hint helpfulness). The judge lives in the **eval
  harness only** — the product stays no-LLM;
- `CHATBENCH_0NN.md` artifacts and an autonomous cycle loop (no hard pause;
  each cycle logs its ranked decision menu and continues).

Inside this loop, two earlier ambitions become **tuning levers** rather than
standalone features:

### Item 5 — Calculation surfaced as reasoning
Derived facts presented as lightweight reasoning ("there are a lot of tests
for a codebase of that size", "this module is unusually central") —
calculations, not inference: deterministic, explainable, cheap.

### Item 6 — Optionally running linters/tests to *observe*
Let tmct run linters or tests to observe whether something actually worked,
reporting the observation — measurement, not reasoning.

### Item 11 — Formal logical reasoning over the ontology (Prolog / Progol) — exploratory, gated
Apply real rules of inference (modus tollens, etc.) to formulas extracted from
parsed prose, checked against the axioms in the ontology (item 3) — a step
beyond item 5's arithmetic. The sketch: map OWL constructs into templates over
parameter expressions (Prolog terms or similar), then use a theorem prover —
Progol (inductive logic programming) is the named candidate — to prove goals
against parsed prose. Materially bigger than item 5 and dependent on the
Phase 2 ontology landing; **exploratory until a spike confirms the
OWL-to-template mapping is tractable**. *(Covers sketches 6 and 7 of the
former ideas file: "reasoning as the application of logic rules to the formula
created from prose against the set of axioms in the graph, possibly search
using Prolog" and "fit OWL constructs into templates / parameter expressions,
then use Progol to theorem-prove against parsed prose".)*

---

## Explicitly out of scope (for now)

- No AWS, no benchmark rig — tmct is a published npm library + CLI with a
  static GitLab Pages home page only.
- No auto-publish: releasing a version is gated on a deliberate version-bump
  commit plus a configured `NPM_TOKEN` in CI.
- No MCP server, no LLM in the product path — permanently out of scope, not
  just "for now".
