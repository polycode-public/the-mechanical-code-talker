# tmct ROADMAP

tmct v0.1.0 was a **whole-package lift** of the seonix chat surface (published
as `@polycode-projects/mct`): identical shape, green tests, new branding. That
was deliberate. It gave every ambition below a working, tested starting point
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
- **The graded benchmark** (case-set v2, operator-specified 2026-07-04): a
  scaled ladder fitted to HUMAN LANGUAGE STANDARDS, not AI-benchmark mechanics
  (bAbI explicitly rejected — it tests expected-AI mechanics and overfits the
  same way our own cases would). Every case carries a **CEFR band (A1–C2)** +
  a **construction specialization** tag (TROG-2/CELF-5 style blocks, adapted:
  naming/vocabulary, SVO queries, pronoun binding, reversible/passive,
  relative/embedded clauses, quantifiers+counting, negation, temporal,
  coordination/compositional, multi-turn discourse reference, declarative
  assert+recall). Multiple questions per grade × specialization with a little
  overlap — authored as a POOL ~10× the per-run need (deterministic generator;
  each run samples ~10% stratified, ≥5 items per populated cell, recorded
  seed), with COMBINATION cells alongside single-area cells so weakness is
  attributable to an area alone or to a specific pairing.
  **Ladder gating:** advanced grades are SKIPPED until every grade
  below passes reliably; when a grade reaches unit-test-level reliability its
  cases become ALWAYS-RUN deterministic tests (judge-free, promoted alongside
  test/showcase.test.mjs). Winograd/WinoGrande items stay as permanent
  ceiling markers; CHILDES as naturalistic easy-band input source. Licence
  rule: TROG/CELF are commercial — borrow the construction taxonomy and
  grading structure, author ORIGINAL items, never copy instrument content.
  A case at 0% is a ceiling marker, not a failure.
- **Retained showcase** (landed): the five most complex achieved sequences are
  frozen as unit-timescale regression tests in `test/showcase.test.mjs`; a
  showcase regression voids a cycle PASS regardless of the mean.

Inside this loop, two earlier ambitions become **tuning levers** rather than
standalone features:

### Item 5 — Calculation surfaced as reasoning
Derived facts presented as lightweight reasoning ("there are a lot of tests
for a codebase of that size", "this module is unusually central") —
calculations, not inference: deterministic, explainable, cheap.

### Item 6 — Optionally running linters/tests to *observe*
Let tmct run linters or tests to observe whether something actually worked,
reporting the observation — measurement, not reasoning.

### Item 11 — Formal logical reasoning over the ontology (Prolog / Progol) — exploratory, gated; matured into Phase LATER tier-5 "entailment-on-miss"
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

## Phase 4 — The wiring wave (operator-directed 2026-07-04)

Five subsystems are built, tested, and consumed by NOTHING in the answer path. They measured
zero on case-set v1 because no case could see them. This phase wires each into answering, with
**unit tests at the seam AND graded-benchmark cells that measure it** (the graded pool creates
the cases that make each lever visible). Wired as one operator-directed wave; cycle-level
attribution resumes per-lever afterwards.

| # | Wiring | Seam | Unit test | Bench coverage |
|---|---|---|---|---|
| W1 | **Templates → render path** | answer rendering consumes `data/templates/responses.jsonl` via `src/corpus/templates.mjs` instead of hardcoded strings (same output first — byte-stable swap — then variation) | render parity + slot lint | every existing case re-measures the swap; `via:"template"` provenance |
| W2 | **retrieveBlocks → miss path** | a bare-question miss consults the memory block index before the honest miss; a hit answers with the recalled block + provenance ("you asked this on …") | recall hit/miss seam | memory-recall cells (mr-asked-before flips) |
| W3 | **seedMemory → bootstrap** | first run in a graph-less repo seeds a capped corpus slice (limit ~500) into `.tmct/memory/`; banner says so honestly | seeded-bootstrap test | bootstrap-empty + vocabulary cells ("what is a cache?") |
| W4 | **Asserted Facts → answers** | "what is a module?" / "is a module a component?" consults remembered `rdfs:subClassOf`/`rdf:type` facts alongside the code graph, cited with provenance | fact-lookup seam | assert-recall cells |
| W5 | **Corpus on-demand** | unknown-term misses may consult the corpus slice (local first; network tier only behind an explicit flag) | on-demand seam, offline-degrades test | naming-vocabulary cells at higher grades |

Answer-path **provenance** lands with W1: every turn record carries `via`
(composed | template | count | recall | fact | corpus) — the field the dual-banding
benchmark (Phase 5) and the memory inspector read.

### Corpus tiering policy (the committed/seeded/on-demand cutoff)

- **Tier 1 — committed & shipped in the npm tarball**: small, load-bearing, licence-clean,
  diffable — the lexicon, response templates, phrasebook, the relation→OWL map, and the CORE
  ConceptNet slice. Budget: **~2 MB total tarball**; rule: what the product needs to be useful
  offline out of the box.
- **Tier 2 — fetched at seed time into install-local folders** (`.tmct/corpus/` per repo, or a
  user-level cache): growable corpora — extended ConceptNet neighbourhoods, acquired template
  libraries (Phase 5), any corpus > ~2 MB. Fetched once by `tmct seed` (or first bootstrap with
  consent), checksummed, provenance-recorded, never committed.
- **Tier 3 — on-demand at question time**: unbounded/live sources (ConceptNet API for unknown
  terms, paper phrase-mining), consulted ONLY behind an explicit opt-in flag, cached down into
  tier 2 after use. **Network failure degrades to the honest miss** — the $0-offline default is
  inviolable; tiers 2-3 are additive, never required.
- **Tier 4 — learn-on-miss (Phase LATER, not now)**: the term IS in the lexicon and the query
  built cleanly, but the graph+memory+corpus all return nothing → web search, clean the fetched
  text into tmct's own dialect (the ACE-ish controlled grammar), store on disk (tier 2), ingest,
  THEN answer — the full acquisition loop at question time. See Phase LATER.

### Memory inspection (seeing into the memory)

Graph-vis exploration hasn't earned its keep; the in-ethos answer is TEXT. A `/memory` chat
command + `tmct memory` CLI: the memory graph grouped by **OWL superclass** (Utterance, Fact,
Session; code classes when present), counts per class with **balanced samples scaled to class
size** (log-scaled so a 10,000-fact class shows ~8 exemplars and a 3-session class shows all 3),
top facts ranked by provenance breadth (corpus+chat-agreed facts first), recent utterance pairs,
and the block-index summary (blocks, tokens, top PageRank blocks). Same renderer serves
`/stats`-style terse and `why`-style verbose.

## Phase 5 — The cycle-4+ tuning arc (near-term: make the floor reliable)

> **STATUS: in progress — the two headline B1 levers shipped.** Negation as a bounded SET
> COMPLEMENT ("which X do not <verb> Y") and reversible-passive traversal ("X is imported by Y")
> are live; the harness meta-fixes and the rest of the ranked lever board continue.

> Detailed plans: **PLAN_CYCLE_4.md** (the tuning arc) and **PLAN_DEPENDENCY_STRATEGY.md**
> (the pre-build dependency audit — verdict: no dep changes now; a standing adoption
> register + avoid-list for phases 6-9; two near-term actions).

The immediate work: drive the graded benchmark up the CEFR ladder, one lever per cycle, per
`SKILL_TUNING_CYCLE.md`. Cycle 3 (post-wiring-wave, CHATBENCH_003) gave the first full-spectrum
reading — A1 1.72 / A2 1.70 / **B1 0.77 (the cliff)** / B2 0.97 / C1 1.07 / C2 0.69 — and two
META-fixes gate everything:

- **Meta-1 — fix the harness artifact BEFORE trusting groundedness.** The judge systematically
  scores TRUTHFUL product output (/describe attributes, recall frames, session ids) as
  fabrication because `FIXTURE_CONTEXT` omits the detail the product legitimately emits.
  Measurement integrity: lands in its own cycle, re-measured, before any product lever — else
  every groundedness delta is confounded. A harness correction, logged as such (like cycle-2's
  H1a/H1b), not a product change.
- **Meta-2 — the ladder rule: get B1 reliable before judging C-grades.** Don't pay to judge a
  ceiling while the floor leaks. A/B grades carry the judged spend; C1/C2 stay tier-1-only
  ceiling markers, judged only occasionally to confirm they're still ceilings (the existing
  `--ladder`/`--grade` flags).

Then the product levers, one per cycle, in ranked order: **(1) B1 negation operator** — the
deepest gap, the engine tokenizes "not"/"don't" as an entity ("no module matching 'not' found");
add set-complement to traversal; predicted B1 0.77→~1.05, ~10 hard fails cleared. **(2)
reversible-passive** ("is imported by" reverses edge direction). **(3) under-covered pool
growth** (B1 pronoun/temporal, C1 temporal — instrument fix, parallelizable). **(4)
assert-recall read-back**, **(5) quantifier+temporal composition**, **(6) the help-text honesty
leak** (hardcoded examples naming non-fixture entities — a real product fabrication, distinct
from meta-1's harness artifact), **C2 ceiling LAST**. Operator decision 2026-07-05: **do all of
them**. Exit criterion in the plan (roughly: B1 grade mean ≥ ~1.5 with all cells dual-draw
agreeing unlocks C-grade judging).

## Near-term actions (from the dependency audit, PLAN_DEPENDENCY_STRATEGY.md)

> **STATUS: both shipped.** The wink browser-loader seam is added (shared model loader with a
> browser registration path) and `fnv1a` is single-sourced into `src/hash.mjs`.

Two concrete, low-risk actions the audit surfaced — not features, not dep changes:

1. **Fix wink's `createRequire` browser-loader gap** — the wink model IS the browser build, but
   our adapters load it via `createRequire(import.meta.url)` (`ask-nlp.mjs:29`, `prose-nlp.mjs:31`),
   which is Node-only. Browser mode needs a bundler `import` path. **A Phase 8 (browser-mode)
   blocker** — budget it into `PLAN_REPOSITORY_INTERFACE.md`; it is a wiring fix, not a dependency
   change (the model is already browser-capable).
2. **Single-source `fnv1a`** — extract the content-address hash to one `src/hash.mjs` so the
   cross-version-stable fact-id contract has a single definition. Trivial refactor, do any time;
   no dependency (the audit confirmed home-grown FNV-1a is the correct choice — sync + browser +
   version-stable, which every library candidate fails).

## Provenance & trust — the unified source-link primitive (cross-cutting)

> **STATUS: shipped.** `mgx:createdAt` universal; `Source` first-class individuals linked by
> `mgx:derivedFrom` / `mgx:statedBy` / `mgx:canonicalisedFrom`; a deterministic `computeTrust`
> (source-type prior × corroboration × recency); retrieval weighted by relevance × trust; the
> `/memory` inspector surfaces contradictions with provenance. Legacy `mgx:factProvenance` kept
> as a compat shim.

> Detailed plan: **PLAN_PROVENANCE_TRUST.md**.

*(Operator-specified 2026-07-05, from the observation that Phase-6 canonicalise-and-link,
tier-4 learn-on-miss, and the ConceptNet slice all share one shape: raw source preserved,
derived form linked back.)* Promote that shape to a FIRST-CLASS primitive used everywhere a
fact enters memory:

- **Every fact/block carries a `Source` and a link to it** — one predicate family
  (`mgx:derivedFrom` / `mgx:canonicalisedFrom` / `mgx:statedBy`) instead of the current
  per-writer `mgx:factProvenance` string. Sources are first-class individuals (class `Source`:
  operator-chat, corpus:conceptnet, learned:web:<url>, entailed:<rule>, provider:seonix), so a
  fact can cite MANY sources (the existing "|"-union becomes real edges).
- **Everything created is TIMESTAMPED** (`mgx:createdAt`), universally — Facts don't carry one
  today (only Utterances do), a Phase-6-trust gap to close: recency is a trust input and the
  novelty signal (below) needs it. Backfill on write; the timestamp is itself provenance.
- **Calculable trust scores per source**, deterministic and explainable: a source-type prior
  (operator > provider graph > curated corpus > web > unverified entailment) combined with
  corroboration (how many independent sources assert the same fact — the union already tells us)
  and recency/agreement signals. Trust is a computed attribute, never hand-set, always
  traceable to its inputs.
- **Trust as RETRIEVAL WEIGHTING**: `retrieveBlocks` / fact lookup / the memory inspector rank
  by relevance × trust, not relevance alone — a corroborated operator-stated fact outranks a
  lone web scrape on the same query. Contradiction becomes visible (two high-trust sources
  disagree → surface both with their provenance, never silently pick).
- **Feeds tier-5**: the Syllogist's entailed facts get a derived trust (min/product of premise
  trusts × rule confidence) — a conclusion is only as trustworthy as its weakest premise, and
  that number is computed, not asserted.

## Phase 6 — Formulaic competence: the template-acquisition learning loop

> **STATUS: shipped.** A technical (C1) register of templates and productive/performance
> dual-banding (computed from the `via` provenance) are live in the benchmark.

> Detailed plan: **`PLAN_FORMULAIC_COMPETENCE.md`**.

The operator's insight upgraded to the strategy: a consistently-failed C1/C2 graded cell whose
answer EXISTS as a stable phrasing in technical prose is not a ceiling — it is a
**template-acquisition lever**. tmct learns the way human learners do: formulaic chunks first
(Wray's formulaic sequences), productive competence later.

- **Dual banding**: every graded score splits into a **productive band** (composed answers only)
  and a **performance band** (templates allowed), computed from the `via` provenance (W1). The
  band GAP is a first-class metric: how much fluency is memorized vs generated.
- **Template-lane benchmarking**: cases that target templated capability are TAGGED as such —
  a template-carried C1 pass counts in the performance band and never inflates the productive
  band; template-lane cells get their own agreement/reliability treatment (they are additional
  benchmarking, not replacements — a level we would otherwise expect to fail at is being
  deliberately faked, and the bench must say so).
- **The shopping list**: each cycle, the write-up extracts consistently-failed C1/C2 cells and
  ranks them by template-acquirability (does a stable technical-prose phrasing exist? is the
  slot structure mechanical — counts, comparisons, provenance we already compute?). Acquiring
  the template IS the lever; the graded bench measures the flip in the performance band.
- **Mechanical conclusions at paragraph grade**: counting + comparison + superlatives (item 5)
  composed through acquired C1-register templates — "X has 340 tests across 12 suites, unusually
  dense for a codebase this size" — tech-domain answers can be genuinely advanced while the CEFR
  banding tells us honestly how good the conversation AROUND them is.
- **Generalization path**: fixed tech domain first (templates hand-picked from technical-paper
  register); then template acquisition generalizes — mining candidate templates from corpus
  blocks (tier-2), scored by slot-fillability, promoted into `data/templates/` with provenance.

## Phase 7 — Response finishing: the grammar pass (tone of voice dropped for now)

> **STATUS: shipped.** Answers segment into typed spans (prose vs protected); the grammar-rule
> pass runs on prose spans only under a protected-span invariance guard. The a/an article fix is
> active; broader voice/agreement rules are implemented-but-parked.

> Detailed plan: **`PLAN_RESPONSE_FINISHING.md`**.

*(Refined 2026-07-05; decisions settled with the operator. Fact invariance is achieved by
CONSTRUCTION, not by hope. Finishing operates over a SEGMENTED answer, never a raw string.
Tone-of-voice synonym substitution is DROPPED: once every term with technical significance is
protected — entities, paths, vocabulary, receipts, provenance — the substitutable surface is
mostly connectives: high accuracy risk, thin reward. "Keen on the trickery to make a helpful
product, but not at the cost of accuracy." Moved to Phase LATER should a provably-safe subset
ever emerge.)*

- **The segmentation IR (the foundation, lever 1)**: every answer becomes a list of typed spans
  before it becomes text — `prose` vs PROTECTED (`entity`, `path`, `number`, `code`,
  `provenance`, `receipt`). Protected spans are byte-copied through finishing; only prose spans
  are ever touched. The W1 template renderer is already slot-aware (slots ARE the protected
  spans); composed renders adopt segmentation progressively via a conservative masker. Phase 5's
  dual banding reads the same spans.
- **Grammar pass (lever 2)**: a data-driven rule table (TOML, item-7 formats) over prose spans —
  article selection ("a artifact" → "an artifact", an observed defect class), subject–verb
  agreement against slot plurality, capitalization, list/terminal punctuation. Grammar
  corrections IMPROVE accuracy (they fix our own generated defects); that is why they survive
  the tone cut. Neutral behavior is byte-stable except where a rule fixes a genuine defect —
  each rule lands as a bench-measured lever.
- **Memory decision (settled)**: memory stores BOTH — the **as-spoken** turns live as larger
  prose blocks on the graph (the honest record), and the **canonical** form is derived and
  LINKED to its source prose blocks (canonise + link, never replace). Recall and folding read
  canonical; provenance walks back to as-spoken.
- **Verification**: unit invariance checker (protected-span multiset identical pre/post) +
  golden files per rule + the graded bench measuring each grammar rule as a lever.

## Phase 8 — The Repository Interface (seonix inverts to a tmct user)

> **STATUS: shipped.** A versioned (1.0.0), OWL-grounded service contract
> (`docs/repository-interface.md` + `.schema.json`); a typed graph-service with a first-class
> miss contract (a miss is a value, not a throw); fixture + bootstrap reference providers; a
> runnable conformance/compatibility suite; and `tmct init` (scaffold `.tmct/`, `tmct.toml`,
> tier-1 seed, provenance).

> Detailed plan: **`PLAN_REPOSITORY_INTERFACE.md`**.

*(Operator-specified 2026-07-05; upgraded from research item to a build phase. tmct was spun OUT
of seonix; this inverts the relationship: seonix reorients as a USER that imports the tmct
library and exposes its graph to tmct as a typed service. Grows item 14's provider adapter from
a passive payload loader into the product's primary integration surface.)*

**Phase deliverables — define, reference-implement, and test the interface:**
1. **The interface DEFINITION**: the typed, OWL-grounded service contract as a versioned
   document + machine-readable shape (docs/repository-interface.md + a JSON-schema/typedef of
   every service, its arguments, result types, and error contract) — tmct owns and versions it.
2. **A REFERENCE IMPLEMENTATION tmct ships itself**: the in-repo provider (fixture graph +
   bootstrap/empty graph) implementing EVERY service of the interface — the executable
   specification any external producer reads first.
3. **The contract test suite (the compatibility kit)**: a runnable suite any implementation is
   tested against — tmct's reference implementation passes it in `npm test`; seonix runs the
   SAME suite against its native implementation to claim conformance. Conformance = the suite,
   not prose.
4. **The session-handle lifecycle**, implemented: create/dispose context handles (focus, last,
   memory dir, lexicon), provider-owned caching, documented re-entrancy — proven by the
   contract suite's concurrent-session cases.
5. **`tmct init`** shipped as part of this phase (it is the interface's onboarding surface).

- **tmct defines the adapter shape** — not the producer. Rationale: tmct is the brittle side
  (query interpretation), so it must own and optimize around a STABLE interface; because the
  vocabulary is OWL-grounded, the human/code world is already quantized into types both sides
  understand, so the interface is built from those shared types, not ad-hoc JSON.
- **A rich instruction set, translated from what seonix already exposes**: survey seonix's
  native tool surface (describe / members / subclasses / impact / callers / callees / tests-for /
  untested / history / exports / architecture / search / context / snippet / locate / digest —
  the dispatchTool catalog tmct carried at the lift) and translate it into tmct's language as
  the REPOSITORY INTERFACE: a consistent set of typed services any graph producer implements
  natively (seonix first; the empty/bootstrap and fixture providers are degenerate
  implementations tmct ships itself).
- **The flow** (LLM-agent front door): Claude Code et al. is briefed to use seonix → when the
  agent judges it useful, seonix's "ask" tools pass NATURAL LANGUAGE to tmct → seonix calls the
  tmct library in-process with the query PLUS a callbacks object (functions implementing the
  repository interface over its native graph) → tmct resolves the query mechanically, calling
  back into seonix's services for graph truth → results return through seonix to the LLM agent.
  The mechanical interpreter becomes the NL front-end for any agent-facing graph tool; the LLM
  stays outside tmct, exactly as the no-LLM ethos requires.
- **In-process lifecycle research (the hard part)**: seonix calls tmct directly, and the
  interface is wider than the in-house chat — so define explicitly what is HELD IN MEMORY
  between function calls: an explicit session/context handle (focus, last-answer, memory dir,
  loaded lexicon) created and disposed by the caller instead of process-global state; graph
  caching delegated to the provider (tmct never caches provider truth — the known source.mjs
  process-cache staleness in long-lived servers becomes the provider's concern, by contract);
  re-entrancy and concurrent-session guarantees documented per service.
- **seonix chat becomes tmct chat + a pointer**: seonix's chat surface loads tmct's chat with
  the repository-interface handle — one chat implementation, N graph backends.
- **Browser mode**: the same inversion works in seonix's browser/code-browser surface — seonix
  finds its own graph (it already ships one to the page) and embeds an OFF-THE-SHELF tmct: the
  engine core (interpret / ask / render, lexicon, templates) is already pure JS with no
  node-only dependency — wink's eng-lite-web-model is literally the browser build — so the
  repository interface + a browser storage seam for memory (or provider-supplied persistence)
  is all that separates the npm package from running in the page. The fs/readline/child_process
  seams stay node-side; the browser gets the library surface, not the shell.
- **Distribution: `tmct init`** — a CLI command that initializes a local directory for tmct:
  seeds/links the text corpuses (tier-1/2 policy applies), writes the externalized configuration
  (tmct.toml — the seonix.toml pattern), creates `.tmct/`, and records provenance — so a host
  package (seonix) or a bare user gets a working install with one command.

## Phase 9 — Speculative inference: a step toward the Syllogist

> **STATUS: shipped.** `tmct syllogise [--depth n] [--budget n]` — an offline, bounded,
> deterministic maintenance job that forward-chains the `rdfs:subClassOf` closure into low-trust,
> retractable entailed facts; runs once after seeding, never on the chat hot path.

*(Operator-specified 2026-07-05. Tier-5 entailment answers a MISS on demand; this is the step
before it — PROACTIVELY extending memory with inferences that will be useful later, forward and
backward chaining over the OWL base during idle/fold time rather than at query time.)*

> Detailed plan: **`PLAN_SPECULATIVE_INFERENCE.md`**.

**A maintenance job, not a query-time cost.** Speculative inference runs as an explicit
batch — `npx tmct syllogise --depth <N>` (default depth bounded, e.g. 32) — and **once
automatically after seeding** (the W3 bootstrap seed is the natural trigger: a fresh corpus is
exactly when pre-deriving the useful closure pays off). Never on the chat's hot path.

**The selection criterion, sharpened by the operator (2026-07-05):** the guiding question is
*"what do the assertions of the sources I TRUST allow me to infer about this topic that is of
RELEVANCE"* — so **novelty × trust is the primary driver**: the pass walks
outward from high-trust premises (the provenance primitive) toward novel, relevant conclusions,
timestamping each so recency and novelty stay computable. The mechanics are the easy half
(bounded forward chaining materializes entailments; backward chaining from frequent query shapes
pre-derives likely answers). **The residual hard half is still the FRAME PROBLEM / relevance
realization — unsolved in the general case and not pretended otherwise;** trust+novelty+relevance
are the tractable approximation, not a solution. The plan's job is
to make it TRACTABLE in tmct's narrow, closed world, not to solve it: usefulness is approximated
from what the system actually gets asked (query-shape frequency), what connects to recent focus,
what a cheap forward step yields that isn't already stored, and a hard
budget (inference is bounded, its output trust-scored via the provenance primitive, and anything
speculative is retractable and never outranks a stated fact). Everything else is deferred to the
plan's open questions, where the relevance problem is named as the open research risk it is.

### Open-source the ACE-OWL parser as a standalone library
> **STATUS: deferred follow-up** — not yet started; still gated on the Phase 8 library-surface
> work settling the extraction boundary. See `PLAN_OSS_ACE_PARSER.md`.

*(Operator-specified 2026-07-05, from the dependency audit's publish-not-replace finding.)* The
pure-JS, ESM, dependency-free ACE-OWL controlled-grammar parser (`src/grammar/ace.mjs` +
`lexicon.mjs`) that turns controlled-English sentences into OWL-labelled triples is a RARE thing:
the reference implementation (APE) is GPL + SWI-Prolog (native), so there is no permissive,
browser-capable, npm-installable ACE→OWL parser in the JS ecosystem. tmct's is exactly that.
Extract it to its own MPL-2.0 package (tmct depends on it back), so the wider RDF/OWL/semantic-web
JS community gains a controlled-natural-language front-end that runs in the browser. Gated on the
Repository Interface library-surface work (Phase 8) settling the extraction boundary; see
`PLAN_OSS_ACE_PARSER.md`. Sibling publish-candidates (the bounded-Damerau fuzzy matcher, the
PageRank+IDF block ranker) may follow the same path if there is demand.

## Phase LATER — recognized, deferred, not now

Features we have deliberately shaped seams for but will not build until the phases above have
earned them:

### Tone-of-voice adaptation (dropped from Phase 6, 2026-07-05)
Per-voice synonym/phrase substitution over prose spans. Dropped because tmct's protected-span
analysis leaves too little safely-substitutable text: any term with technical significance is
untouchable, and accuracy outranks helpfulness trickery. Revisit only if a provably-safe
substitutable subset emerges (e.g. connective-only voice profiles, or per-voice template
overrides authored as whole alternatives rather than substitutions). The grammar-preference
half of the idea survives inside Phase 6's rule table.

### Tier-4 corpus: learn-on-miss acquisition
The strongest miss signal tmct can emit is: *lexicon term recognized, query built cleanly,
zero matches anywhere* — the question was well-formed and the knowledge is simply absent. The
tier-4 loop answers it by learning: web search on the resolved term → clean the fetched text
into tmct's own dialect (normalize into the ACE-OWL controlled grammar; whatever survives the
grammar becomes Facts, whatever doesn't becomes tier-2 text blocks under the PageRank index) →
store on disk with source provenance → ingest → answer the original question from the newly
learned material, citing what was just learned and from where. Strictly opt-in, network tier
rules apply (offline default inviolable; failure degrades to the honest miss). Prerequisites:
W1-W5 wired and measured, the Phase-5 template/dialect cleaning machinery (the "clean dialect"
IS the acquisition format), and a provenance-trust policy for web-sourced facts (never blended
silently with graph/operator facts — the `via`/provenance discipline extends to "learned:web").

### Tier-5: entailment-on-miss — "the Syllogist" (deductive inference over the OWL base)
*(Item 11 matured from exploratory sketch to a designed tier; the "theorem-prove against
parsed prose" thread of the original code-talker ideas.)*

**The concept, classically:** answering from the **deductive closure** of a knowledge base —
KB ⊨ φ ("the knowledge base *entails* φ") — content that is nowhere ASSERTED in the graph,
memory, or corpus, but is a logical CONSEQUENCE of what is. Deductive inference (modus ponens,
modus tollens, syllogistic chains) predates ELIZA by ~2,300 years (Aristotle's syllogisms →
Frege's predicate logic → Robinson's resolution principle 1965 → Kowalski's "logic as a
programming language" → Prolog's SLD resolution; on the rules side, forward-chaining production
systems and the Rete algorithm; on the OWL side, description-logic reasoners and the RDFS/OWL
entailment regimes). tmct's version: a well-formed query misses everywhere → run the inference
layer over the OWL-encoded facts + axioms → if the answer is ENTAILED, materialize it as a Fact
with `via:"entailed"` and a **proof-chain provenance** (the applied rules + premise facts,
renderable as a chain of thought in words: "every cache is a store; every store is a component;
so a cache is a component") → the same query now yields an answer that shows its derivation.

**Worked shape (modus tollens over the code graph):** axiom "every tested module is covered by
a suite"; fact "m.mjs is covered by no suite" ⊨ "m.mjs is not tested" — never asserted,
honestly derived, provenance = the two premises + the rule name.

**Engine choice (the Prolog / graph-query question):** the classical candidates are embedded
Prolog (SLD, backward-chaining, item 11's original sketch), a graph query syntax (SPARQL under
entailment regimes / datalog / openCypher), or a description-logic tableau reasoner. The
recommended target is **OWL 2 RL** — the profile DESIGNED to be implemented as forward-chaining
rules (datalog-style semi-naive materialization, polynomial, decidable): pure-JS implementable,
mechanical, explainable rule-by-rule — exactly in ethos. Prolog-style backward chaining stays
the fallback for query-time-only derivation if materialization proves too eager. Progol/ILP
(learning NEW rules from examples) remains a separate, further-out spike.

**Gates:** the full-domain lexicon + OWL encoding in a queriable structure (Phases 2+4+5 and
tier-4's acquisition feed it), the provenance-trust policy (entailed facts must never silently
mix with asserted ones — a wrong axiom poisons the closure, so entailments are retractable by
provenance), and bench cells that measure inference specifically (premises in, conclusion
asked, derivation shown).

## Explicitly out of scope (for now)

- No AWS, no benchmark rig — tmct is a published npm library + CLI with a
  static GitLab Pages home page only.
- No auto-publish: releasing a version is gated on a deliberate version-bump
  commit plus a configured `NPM_TOKEN` in CI.
- No MCP server, no LLM in the product path — permanently out of scope, not
  just "for now".
