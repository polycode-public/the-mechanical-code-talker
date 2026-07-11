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

## Working model: coordinator + background sub-agents

Standing orders for every session working this repo (copied verbatim from this repo's own
`CLAUDE.md` on 2026-07-10, at the operator's request, so the discipline is visible directly in
the project's own operating docs and not just the config file):

Run big tasks in **concurrent background sub-agents** and keep the main chat free — the main
session is the COORDINATOR (plans, launches, integrates, answers the operator), not the worker.

- Decompose into workstreams with **clear file-ownership boundaries**; serialize on shared
  files (one agent owns `package.json`, `src/`, `bin/`, `test/` sequences; docs/site tracks
  run in parallel).
- **Keep the chat for chat**: anything long-running (benchmarks, judge passes, builds, test
  sweeps) executes as a BACKGROUND task at maximum safe concurrency (the chatbench judge
  defaults to `--concurrency 12`); the main session launches it, keeps coordinating and
  conversing, and collects results on the completion notification. Never block the
  conversation on a run.
- Commit per completed step with the repo-local identity (`antony@polycode.co.uk` /
  `Antony at Polycode`); keep `npm test` green at every commit.
- Push/publish is gated on the operator (CI publishes on version bump on `main`).
- **Version bump timing:** only bump the version (`package.json` + `package-lock.json`) at the
  moment of actually pushing a release — the bump commit is part of that same push, not a
  separate step staged in advance. Default to a patch bump unless the batch is clearly
  feature-level (minor) or breaking (major). Do NOT pre-stage a future version number and leave
  it sitting unpushed in git between releases — that produced confusing "linking to a version
  that doesn't exist yet" noise in practice and was reverted by operator instruction 2026-07-09.
  Between pushes, `package.json`'s version should always equal whatever's actually live on npm.

## Recently shipped capabilities

Status legend: **DONE** = shipped and verified/measured; **PARTIAL** = shipped but with a known
gap; **TODO** = not started. Each entry points at the plan doc, benchmark report, or test file
that carries the full design/measurement detail rather than repeating it here. For the exact
current published/pushed version, see `HANDOVER.md`'s version-state note.

### Chat surface & dialogue flow

- **Dialogue-flow playtest ladder — DONE, tiers 0-6** (`SKILL_BENCHMARK_CEFR_ENGLISH.md`'s
  playtest section, `test/chatflow-tier*.test.mjs`). Bootstrap/identity through the messy
  real-user tier all pass. The ladder's own hardening history is worth keeping: a recurring
  `resolveObject` substring-match weakness (short connectives like "and"/"it" hijacking
  conversational focus) took several passes to root-cause and fix; the later tiers also caught two
  real correctness bugs (a word-overlap fallback with no exclusion for common code-noun suffixes
  like "module"; an over-eager property-adjective matcher discarding an already-correct
  graph-computed answer).
- **First-run/onboarding experience — DONE** (extends Phase 10 below). Identity/capability-led
  greeting before any caveat, an explicit "no LLM involved" answer for the identity/AI-ID family,
  a `vocabExampleHint` that only offers terms confirmed to resolve in the session's actual seed
  state, and broadened conversational recognition (dialect, register, slang, elongation, a
  bounded-fuzzy typo layer) — all curated closed-set additions, per this project's standing
  preference over general grammar rules.
- **Compound-name / multi-word resolution — DONE**. `resolveObject` (`src/ask.mjs`) gained a
  multi-word compound-term tier alongside its existing basename-exact/prefix-suffix and
  derivational-stem tiers, so "the payment system" resolves `PaymentSystem`,
  `payment-system`, compound paths, and interface-style names. `test/ask-compound-resolve.test.mjs`.
  `/describe`'s own resolver doesn't share this tier yet — see Next steps below.
- **Vocabulary growth via chat teaching — DONE**. New terms mint bidirectionally: a known-object
  side (`redis is a cache`) and, via `unknownObjectFallback`, a known-subject/unknown-object side
  too (`every cache is a store`), gated on a genuine universal quantifier so it can't reopen the
  general lexicon bypass. Quantifier phrasings ("some/a few Xs are Ys", "your X is a Y") and
  quantifier recall ("how many Xs are Ys" → "A few.") are supported. `test/chat-teach-quantifier.test.mjs`.
- **General verb-to-predicate teaching — DONE**. Any verb, not just the closed is/has/are set, can
  become a taught predicate through ordinary chat ("remember margo eats ribs" mints its own
  predicate); the query side answers yes/no and "what does X verb" off the same store.
- **Live in-browser chat demo — DONE**. The GitLab Pages homepage runs the real `src/ask.mjs`
  query engine client-side (wink-nlp via `esm.sh`, an import-map shim for 3 Node-only static
  imports); visitors get a genuine interactive input box computing real answers. No backend on
  GitLab Pages — stated plainly rather than implied.
- **Goal-inference line — DONE**. Every structural/vocabulary answer carries a short
  "Goal (inferred): ..." line, distinct from the opt-in `/narrate` full-trace mode.
- **Inherited-member disclosure — DONE**. A membership query against a class with no own matching
  members (e.g. "public methods of TaskController") walks `ancestorsOf` nearest-first and
  discloses the inherited source out loud, never presenting it as the class's own.
- **Seonix dogfooding backlog — mostly DONE**. Seonix (a sibling project consuming tmct as a real
  dependency) ran 17 rounds of dogfooding against a real 27,929-module production estate; the
  backlog was triaged into 5 batches. Batches 1-3 (existence-query correctness, bare-noun/reverse
  `inherits` parsing, purpose/identity phrasing, recent-commit rendering) are DONE. Batch 4/5's
  cross-graph disambiguation-ranking fix is DONE (a new committed fixture graph,
  `test/fixtures/large-scale/`, reproduces and regression-covers it); cochange phrasing variants
  and one unverified "multi-root" substring case remain — see Next steps below.

### Teaching, memory & reasoning

- **Teaching new relations/rules via chat — DONE, all 6 items** (`PLAN_TAUGHT_RELATIONS.md`).
  Relational fact teach + query readback ("ahab is the father of john"); relation alias/union
  chase (a taught "father ⊑ parent" lets "is ahab a parent of john" resolve); adjective-mint for
  new properties; fixed-hop `compose2` composition rules ("a grandparent is a parent of a
  parent", hop-counted `findActionPath` search); property-filtered composition rules ("a
  grandfather is a grandparent who is male", via a generic recursive `resolveRelationChase`); and
  recursive/reachability rules ("a descendant is a parent, or a parent of a descendant",
  enumerated via `findReachableSet`). The reverse query shape ("who is the grandparent of X") is
  also wired. `test/chat-taught-relations.test.mjs` (26 cases, including a full family-tree
  integration test) covers the whole scope end-to-end. See `PLAN_TAUGHT_RELATIONS.md` for the full
  design.
- **INFBENCH ladder — gated at INF-B1 (33% completion)**, unchanged across several
  re-measurements since none of the taught-relations work touches that band; chat/INF-A2 is at
  100%. A genuine INF-C1 fabrication regression (the general-verb-to-predicate query lane
  answering a confident "no" on an absent fact instead of declining) was found and fixed, back to
  its honest 93%-completion/0%-fabrication ceiling. Beyond Phase 9's initial OWL 2 RL build (below),
  further inference rules have since landed and are chat-wired: disjointness (`cax-dw`),
  someValuesFrom restriction membership (`cls-svf1`), a consistency checker that refuses to answer
  from a subject whose own taught types contradict each other (INF-C2), and
  `scm-svf1`/cardinality monotonicity/`cax-maxc0` (kernel arm 100%, chat arm 99%). See the dated
  `INFBENCH_*.md` reports and `archive/PLAN_INFERENCE_TESTING.md` (fully shipped and archived) for
  the measured history.
- **Planning kernels — DONE at the kernel level, not yet wired into a domain**. `findActionPath`
  (bounded on-demand-successor state-space search) and its sibling `findReachableSet` (open-ended
  reachability enumeration, no fixed goal) both live in `src/planning.mjs`, proven against toy
  graphs (`test/planning.test.mjs`). Neither Hanoi nor guess-the-number (the two domains these
  kernels were built for) is wired up yet — both stay design-only, see `PLAN_HANOI.md` /
  `PLAN_GUESS_NUMBER.md`.
- **Completions (extractive multi-sentence answers) — DONE, Stages 0-3** (`archive/PLAN_COMPLETIONS.md`).
  `src/completions/` runs a search → group → infer → prune → complete pipeline: connected-components
  grouping over the memory block-similarity graph, a closed 4-relation cross-group inference
  vocabulary (supports/contradicts/elaborates/exemplifies), PageRank+IDF extractive ranking, and an
  auditable assembly/grammar pass — every output sentence traces to a source span. A
  `graphService` adapter (`src/completions/graph-adapter.mjs`) grounds "give me a detailed summary
  of X" in the graph/taught facts on a subject's first mention in a session.

### Distribution, persona & memory backends

- **Default human-world persona — DONE, all three size tiers** (`archive/PLAN_SEED.md`). `tmct
  init` with no flags seeds a genuine everyday-knowledge persona by default (Small: 664 facts,
  650-word lexicon, 120 WordNet-sourced example sentences; Medium: 1,608 facts; Large: 13,609
  facts with real multi-hop WordNet hypernym chains), with SEON/ConceptNet now opt-in rather than
  default. A working cross-ontology bridge test proves `scm-sco` composes WordNet's and
  Schema.org's independently-built taxonomies. Full design, exact numbers, and merge-conflict
  detail: `archive/PLAN_SEED.md`.
- **Unified CLI/config model — DONE**: a single `--repo`/`--graph`/`--config` flag model
  (replacing four duplicated `configFor` implementations), multi-graph loading, a new `ontology`
  extension kind, and a `tmct import` verb. The `createSession`→`initRepo` auto-init convergence
  means a programmatic `runChat()`/`createSession()` call on a bare directory now runs the same
  full init path as the CLI, leaving a real `tmct.toml` + `.tmct/init.json`.
- **Memory persistence backends — DONE**: a pure in-memory store with zero disk I/O, and a SQLite
  store (schema adapted from a working store in the sibling repo seonix, adjusted for tmct's
  write-heavy per-turn accumulation pattern) whose read side caches its payload on the handle and
  patches it incrementally instead of reconstructing it per call.
- **Actor-level trust + memory-tree versioning — DONE**: full session-scoped actor trust (no
  config flag, shipped unconditionally) and manual-trigger memory-tree versioning
  (`snapshotMemory()`).
- **Extension-pack seam — DONE**: `src/extensions.mjs`, `[extensions]`/`[bias]` in `tmct.toml`,
  `tmct extend --validate`; bias-weighted fact ranking (`src/memory/bias.mjs`, verified to never
  drop a fact, only reorder it).
- **Repository Interface hardening — DONE**: ranked `search()`, a real graph-only `context()`
  (`INTERFACE_VERSION` 1.1.0), depth-capped `impact()`, source-backed `snippet()`,
  `edges()`/`search()` pagination, telemetry wiring, hub-dampened memory-fact ranking (on by
  default). A path-traversal security fix (`src/source-slice.mjs`) was found and closed along the
  way.
- **Package export surface — DONE**: `generateCompletion`/`createCompletionsGraphAdapter` are
  public `exports` subpaths now, verified with a real `npm pack` + fresh install + deep import.
- **Doc consolidation**: `PLAN_AGENTS.md` is the governing plan for tmct's next major arc —
  absorbed six sibling plan docs (now `archive/`) and sequences Phase 0 (foundations) through
  Phase 4 (a pluggable LLM rung for Claude Code/Bedrock/Copilot) plus a tiered research horizon
  (R1-R3). Benchmark/skill doc naming is unified project-wide
  (`BENCHMARK_AGENT`/`BENCHMARK_CEFR_ENGLISH`/`BENCHMARK_CONVERSATION`/`BENCHMARK_INFERENCE`,
  `SKILL_BENCHMARK_*.md`). `CAPABILITIES_AUDIT_2026-07-10.md` catalogs 83 distinct capabilities
  against every doc claim and the actual code (57 implemented, 21 claimed-only, 3 partial) — the
  reference to check before trusting any capability claim in this roadmap.

## Next: open follow-ups

1. **Judged CHATBENCH re-run.** Several recent chat-surface changes touch answer text on judged
   surfaces (onboarding/identity responses, teach-lane wording, new relation phrasings), so the
   next judged pass needs to re-derive its stale set from answer-text diffs rather than assume
   anything carries over from the last recorded baseline.
2. **The reverse-`inherits` verb family's "the"-definite forms** ("is the superclass of") aren't
   wired into `VERB_TO_KIND` yet — doing so leaked the bare word "the" into `ask.mjs`'s
   CONTENT_VOCAB and broke the relaxation cascade's noise-strip tests, so a CONTENT_VOCAB fix is
   needed first.
3. **Seonix batch 4/5's remaining items**: cochange phrasing variants, and one unverified
   "multi-root" substring over-match.
4. **Extend compound-symbol matching to `/describe`'s own resolver.** `/describe`'s resolver
   (`resolveSymbol` in `codegraph.mjs`) is separate from and stricter than `resolveObject`, so
   "describe the payment system" doesn't yet benefit from the compound-name tier above. Not a
   regression, just not covered yet.

## Later: deferred by design, staged inside each plan

Each plan doc stages its own later phases; this list just points to them rather than repeating
their tables.

- **infbench stages 1-5 — all shipped** (`archive/PLAN_INFERENCE_TESTING.md` §4, archived
  2026-07-11 once every stage's exit criterion was met). The disjointness proof rule (B1),
  proof-chain materialization, cardinality entailment, and consistency checking all landed and are
  chat-wired; the one remaining open research question (retraction-aware incremental reasoning)
  moved to `PLAN_SYLLOGIST.md`. The repeatable measure/gate/advance cycle for this ladder
  is still captured as an invokable skill, `SKILL_BENCHMARK_INFERENCE.md`.
- **Advanced-grammar tracks b/d/e** (`PLAN_ADVANCED_GRAMMAR.md`). The constructions not landed
  this wave: stacked modality/passive, implicit arguments, and the rest of the CEFR inventory
  audit table.
- **Ontology stage 3+** (`PLAN_ontology-hierarchies.md`). Beyond the synonym-wiring and
  disjointness growth already shipped.
- **`PLAN_CODE.md` tracks 2/3.** Small JS-function synthesis and HTML/CSS-fragment synthesis, both
  via a Playwright-sandboxed headless browser. Explicitly staged well behind Track 1, each gated
  on its own operator sign-off.

## Incidents & lessons

- **The `ace-owl` extraction and revert (2026-07-10).** An earlier commit extracted the ACE-OWL
  grammar parser (`src/grammar/ace.mjs`/`lexicon.mjs`) into a new, unpublished npm workspace and
  pointed tmct's own `package.json` at it as a registry dependency — breaking `npm install` of
  tmct for anyone outside that workspace for five days. Found and reverted the same day it was
  found; the parser is back in `src/grammar/` as the real implementation, verified with a real
  `npm pack` + fresh install. Full account: `HANDOVER.md`'s Discipline section,
  `PLAN_OSS_ACE_PARSER.md`.

## Release history

- **v0.8.0**: capability router A0-C1 (96% plan completion, 0% hallucination, closed-world). The
  `/v1/messages` shim + Stage-0 registry + resolver/guardrail/planner; three chat levers; the
  `bedrock-meter` $0 rung. `CEFR_ENGLISH_0.8.0.md`, `AGENTBENCH_0.8.0.md`.
- **v0.8.1**: AGENTBENCH grades the executed result, not just the call-plan (97% plan / 91% result
  / 0% hallucination). Stage 5 goal-reasoner (+10pp result-completion); Stage 2 imperative intent
  frames at 100%/95%/0%. `CEFR_ENGLISH_0.8.1.md`, `AGENTBENCH_0.8.1.md`.
- **v0.8.2**: the chat-feel wave + rule-general C2. Tier-1 CHATBENCH 334/334 + 285/285, zero
  regressions. Recall hygiene, preamble/politeness frames, author lane, wall kindness, teach-lane
  widening. AGENTBENCH ladder grew 43→56 cases; goal driver 100%/98%/0%, all rungs gate-PASS.
  `CEFR_ENGLISH_0.8.2.md`, `AGENTBENCH_0.8.2.md`.
- **v1.0.0-1.0.7**: the first-run UX rewrite (identity-led onboarding), new-term teaching +
  quantifier phrasings, the always-on Goal-inference line, the dialogue-flow playtest tiers 0-4,
  the live in-browser chat demo, Seonix batch 1.
- **v1.4.0**: the first `PLAN_AGENTS.md` uplift batch — Repository Interface hardening, a
  path-traversal security fix, hub-dampened memory-fact ranking, memory-tree versioning,
  session-scoped actor trust, the extension-pack seam, bias-weighted fact ranking, `tmct init
  --with-persona`.
- **v1.4.1-1.5.5**: `PLAN_CHAT_FEEL.md` fully archived; `archive/PLAN_COMPLETIONS.md` shipped
  end-to-end (Stages 0-3); `archive/PLAN_INFERENCE_TESTING.md` stages 3-5 (`cax-dw`, `cls-svf1`,
  the consistency checker); the `ace-owl` extraction was tried, found to break `npm install`, and
  reverted the same day it was found (see `HANDOVER.md`'s Discipline section for the incident).
- **v1.5.6-1.6.0 — persona + memory-backend batch**: the default human-world persona (all 3 tiers,
  `archive/PLAN_SEED.md`), the unified CLI/config model, the in-memory + SQLite memory backends,
  the `scm-svf1`/cardinality monotonicity/`cax-maxc0` inference rules, and multi-candidate ambiguity
  resolution (`PLAN_DID_YOU_SEE_HER_DUCK.md`).
- **Doc consolidation**: `PLAN_AGENTS.md` absorbed six sibling plan docs; benchmark/skill doc and
  capability-audit naming unified project-wide (`BENCHMARK_<TYPE>_<version>.md`,
  `CAPABILITIES_<version>.md`).

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

## Phase 0 — Reshape — DONE (v0.2.0)

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
in `SKILL_BENCHMARK_CEFR_ENGLISH.md` (renamed from `SKILL_TUNING_CYCLE.md`):

- a fixed, versioned **chatbench case set** (`chatbench/cases.jsonl`);
- a **deterministic replay runner** over `runTurn` (the product is
  deterministic — one run per arm suffices);
- **LLM-as-judge** scoring (N≥3 samples per case; groundedness / correctness /
  honesty-on-miss / rephrase-hint helpfulness). The judge lives in the **eval
  harness only** — the product stays no-LLM;
- `CEFR_ENGLISH_0NN.md` artifacts and an autonomous cycle loop (no hard pause;
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
> are live; the harness meta-fixes and the rest of the ranked lever board (levers 3–6 + the C2
> ceiling, below) continue. **This section is the durable home for the tuning arc** — the detailed
> cycle-4 plan was archived to `archive/PLAN_CYCLE_4.md` once its substance lived here.

> The dependency audit that also fed this phase is archived at `archive/PLAN_DEPENDENCY_STRATEGY.md`
> (verdict: no dep changes now; a standing adoption register + avoid-list for phases 6-9; two
> near-term actions, both shipped — see below).

The immediate work: drive the graded benchmark up the CEFR ladder, one lever per cycle, per
`SKILL_BENCHMARK_CEFR_ENGLISH.md`. Cycle 3 (post-wiring-wave, CEFR_ENGLISH_003) gave the first full-spectrum
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

## Near-term actions (from the dependency audit, archive/PLAN_DEPENDENCY_STRATEGY.md)

> **STATUS: both shipped.** The wink browser-loader seam is added (shared model loader with a
> browser registration path) and `fnv1a` is single-sourced into `src/hash.mjs`.

Two concrete, low-risk actions the audit surfaced — not features, not dep changes:

1. **Fix wink's `createRequire` browser-loader gap** — the wink model IS the browser build, but
   our adapters load it via `createRequire(import.meta.url)` (`ask-nlp.mjs:29`, `prose-nlp.mjs:31`),
   which is Node-only. Browser mode needs a bundler `import` path. **A Phase 8 (browser-mode)
   blocker** — budget it into `archive/PLAN_REPOSITORY_INTERFACE.md`; it is a wiring fix, not a dependency
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

> Detailed plan: **archive/PLAN_PROVENANCE_TRUST.md**.

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

> Detailed plan: **`archive/PLAN_FORMULAIC_COMPETENCE.md`**.

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

> Detailed plan: **`archive/PLAN_RESPONSE_FINISHING.md`**.

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

> Detailed plan: **`archive/PLAN_REPOSITORY_INTERFACE.md`**.

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

> Detailed plan: **`archive/PLAN_SPECULATIVE_INFERENCE.md`**.

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
realization — unsolved in the general case and not pretended otherwise.** This is not one problem
but two, of different hardness (full literature + citations in `PLAN_CAPABILITY_ROUTER.md`'s "The
open-world boundary" section):

- **The frame-*axiom* problem — solved, inside a declared world.** McCarthy & Hayes named it in
  1969 ("Some Philosophical Problems from the Standpoint of Artificial Intelligence", *Machine
  Intelligence* 4); Reiter's 1991 successor-state axioms and Kowalski & Sergot's 1986 event
  calculus (*New Generation Computing* 4(1)) both solve the narrow reading — stating what changes
  without enumerating what doesn't — inside a **declared** effect/predicate model. That's exactly
  the OWL base the Syllogist forward-chains over: the axioms and rules are declared, so applying
  them is mechanical, bounded, and already shipped (`src/syllogise.mjs`).
- **The relevance-*bounding* problem — genuinely open, and possibly not just unbuilt.** Given the
  unbounded set of entailments a rich KB licenses, which ones are worth materializing *before
  anyone asks* — without an oracle telling the pass what matters? That is McCarthy's deeper,
  unsolved reading, and it has no known algorithm. It is also, independently, the central problem
  a live cognitive-science literature has converged on: Vervaeke, Lillicrap & Richards ("Relevance
  Realization and the Emerging Framework in Cognitive Science", *Journal of Logic and Computation*
  22(1):79–99, 2012) frame it as the pervasive problem cognitive science keeps rediscovering: Jaeger,
  Riedl, Djedovic, Vervaeke & Walsh ("Naturalizing relevance realization: why agency and cognition
  are fundamentally not computational", *Frontiers in Psychology*, 2024) go further and argue —
  contestably, but rigorously, not as a popular-science claim — that relevance realization
  *cannot* be an algorithmic process at all, by an analogy to Gödelian incompleteness. Take that as
  a live, unresolved argument, not a proof: the honest position is that tmct doesn't know whether
  this is "hard" or "impossible", and says so.

trust+novelty+relevance (query-shape frequency, recent-focus connectivity, a hard depth/budget
cap) are the **tractable approximation** the plan actually ships — a proxy for relevance, not a
solution to it, and openly so. **A speculative angle, still respecting no-LLM-in-product:** the
same bounded-region trick sketched for the router's open-world goal recognition
(`PLAN_CAPABILITY_ROUTER.md`) applies here. Instead of trying to bound relevance globally (the
open problem above), bound it *per query-shape*: a query shape already declares which
predicates/fluents it touches — it's how `parseQuery` resolves it — so restricting speculative
forward-chaining to premises reachable within N hops of an **observed** query shape's declared
predicates is a *structurally*-bounded relevance filter, not a learned or statistical one. It is
narrower than "what's relevant in general" (that stays open) but might be enough to keep
materialization from drifting into computing entailments nobody will ever ask about — trading
"relevant to anyone" (unsolved) for "relevant to what this system has actually been asked"
(a proxy, but a principled, deterministic one). This has not been built or measured; it is a
candidate for the plan's next spike, not a claimed result. Everything else is deferred to the
plan's open questions, where the relevance problem is named as the open research risk it is.

### Open-source the ACE-OWL parser as a standalone library
> **STATUS: tried, reverted (2026-07-10).** A session extracted `ace.mjs`/`lexicon.mjs` into
> `packages/ace-owl`, a new npm workspace, and pointed tmct's own `package.json` at it as a
> registry dependency — but never published the package. That broke `npm install` for tmct
> itself (`@polycode-projects/ace-owl` 404s on the public registry, since it only ever existed as
> a local workspace symlink). Folded back into `src/grammar/` the same day, on operator
> instruction, once the break was found. If this is worth doing again, publish the package FIRST
> (or in the same change), never split the two steps across a batch. See `PLAN_OSS_ACE_PARSER.md`.

*(Operator-specified 2026-07-05, from the dependency audit's publish-not-replace finding.)* The
pure-JS, ESM, dependency-free ACE-OWL controlled-grammar parser (`src/grammar/ace.mjs` +
`lexicon.mjs`) that turns controlled-English sentences into OWL-labelled triples is a RARE thing:
the reference implementation (APE) is GPL + SWI-Prolog (native), so there is no permissive,
browser-capable, npm-installable ACE→OWL parser in the JS ecosystem. tmct's is exactly that.
Extracting it to its own MPL-2.0 package (tmct depending on it back) would give the wider
RDF/OWL/semantic-web JS community a controlled-natural-language front-end that runs in the
browser — genuine value, but only once actually published; see `PLAN_OSS_ACE_PARSER.md` for the
full design and the note above for what went wrong the first attempt. Sibling publish-candidates
(the bounded-Damerau fuzzy matcher, the PageRank+IDF block ranker) are lower priority than getting
this one right before trying another.

## Phase 10 — Conversational competence & onboarding — this batch DONE, the capability itself is an ongoing target

Conversational competence is never fully "done" by design — `SKILL_BENCHMARK_CONVERSATION.md`
exists specifically to keep probing it, and it still has real open findings (see `HANDOVER.md`'s
open items). The batch below shipped and stays shipped; treat it as a closed foundation, not a
closed capability.

*(Operator-directed, from live new-user testing.)* Once a graph is loaded the engine is strong;
the weak surfaces were the FIRST RUN and the VAGUE question. This phase makes the miss graceful,
the empty state honest, and the vague touch a guided answer — realising item 1's "tolerant, guides
you toward precision" promise on the conversational surface.

- **Onboarding UX — DONE:** the grammar wall moved behind `/help` (a short, tailored miss
  instead); intent lanes for memory/teach ("remember that X"), meta/self ("what is this codebase",
  "what do you know"), routed only when a graph query would miss; empty/degenerate-graph
  orientation that distinguishes CODE STRUCTURE (needs a `.tmct/graph.json` via a producer or
  `--repo`; tmct reads graphs, it does not index code) from VOCABULARY (`tmct init`/bootstrap seeds
  concepts); `TMCT_GRAPH_FILE` honoured by chat; slash-optional commands (`stats`≡`/stats`);
  `/memory` explore hooks; up/down-arrow prompt history in the TUI.
- **Knowledge — DONE:** the curated `corpus/seon` ontology — a software-sense
  definition for EVERY lexicon term, language-neutral (Java/C#/Python `class` → one concept); the
  ConceptNet slice quality-filtered (word-sense noise cut) and regrown to ~40k facts; tier-2
  specialised corpuses (aws/python/java) with `tmct init --corpus`; batched `appendFacts` (one
  write, 419s→2.5s) enabling **seed-all** so a fresh repo knows the whole curated vocabulary.
- **The concept force — DONE:** a vague touch on a concept X, where tmct knows X and has instances,
  answers in three bands — **the definition** (from `corpus/seon`), **the examples** (real code-graph
  + memory instances of X), and **a soft guided follow-up** ("Want to go deeper?" + 2–3 questions
  built from the real instances × the query shapes valid for that kind, each pre-validated to
  resolve). Applies to NOUN concepts (`what is a class` → define + Base/Widget/Button + drill-ins)
  AND **RELATION concepts** (`what about imports` / `what calls are there` → the verb definition +
  example edges + guided queries), fixing the vague-query dead-ends. Fact rendering is
  de-anthropomorphised (no first-person "i learned:" over-claim — corpus facts read as data +
  provenance; `you told me` stays for operator-asserted facts); listings cap at 32 with a "say
  'more'" pagination that holds the remainder in session state.
- **Dead-end routing + read-only demos — DONE:** natural drill-down phrasings are routed
  onto the canonical shapes they mean — `what functions are in X` → members-of-class, `what defined
  X` → where-is-X-defined, a no-context `what about X` → the concept/relation force (the discourse
  continuation still wins when there IS a prior answer). `tmct chat --ephemeral` (and the
  `npm run example:*` demos) reads a graph but writes nothing back, so a checked-in example is never
  dirtied by a demo run.
- **The dialogue-flow loop — DONE, since evolved into `SKILL_BENCHMARK_CONVERSATION.md`** (renamed
  from `SKILL_CHAT_PLAYTEST.md`): a fast, qualitative tuning loop that
  complements the LLM-judge benchmark — Claude plays a curious user, hunts *dead-ends* (walls,
  "unknown qualifier", phrasing-misses, invited follow-ups the engine can't take), fixes them by
  ROUTING to existing capabilities, replays the same conversations until they flow, freezes them as
  regression transcripts, then ratchets the complexity tier. The drill-down transcript above is its
  first frozen fixture (`test/chatflow-drilldown.test.mjs`).
- **Measured** by the version-matched benchmark (`CEFR_ENGLISH_<version>` per `SKILL_BENCHMARK_CEFR_ENGLISH.md`),
  with new graded cells for the miss / empty-graph / concept-touch surfaces so these become
  regression-protected levers, not one-off polish.

## Phase 11 — The capability router & the agentic bench — DEMONSTRATED (closed-world C1, scope-capped)

*(Operator-directed 2026-07-06; built the same day across five concurrent tracks.)* tmct as a **deterministic, no-LLM
tool router** behind an Anthropic-compatible API — the workstream specified in
`PLAN_CAPABILITY_ROUTER.md`, grounded in `docs/references/planning/`. This is a **new capability on a
new axis** (driving a tool loop, not answering a chat turn), so it gets its **own benchmark**:
**`AGENTBENCH`**, a sibling to CHATBENCH — same versioned-naming + grading discipline
(`AGENTBENCH_<version>.md`, `_00N` for re-runs), but the levels are the **A0→C2 agentic rungs** and a
**hallucinated tool call is an automatic fail**.

**Status: DEMONSTRATED, with a stated scope caveat.** The router is built and measured, grading
both the call-plan and the executed result (97% plan / 91% result / 0% hallucination,
`AGENTBENCH_0.8.1.md`); the closed-world ladder is cleared to **C1**. The gate the phase was
staked on — a **0% hallucination rate on a real domain** (the graph-query toolset over the
fixture) — **is met.** The honest scope line, still true: the B1/B2/C1 rungs are **thin (2–3
cases)**. So "closed-world C1" means *the router provably selects, binds, and executes the right
tool sequence*, not *open-ended multi-step reasoning at scale* — that boundary, not a raw pass
rate, is the real deliverable. All five tracks below, including Track 4's two research-agent
stages, are built.

### Track 1 — chat-surface levers (next CHATBENCH; all three)

> **STATUS: PARTIAL.** The surrounding chat-feel surface (`PLAN_CHAT_FEEL.md` items **1–5, 7, 8**:
> recall hygiene, preamble frames, call-relation self-consistency, author lane, wall kindness,
> teach-lane widening, honest nudges) is DONE, gate-verified deterministically
> (`CEFR_ENGLISH_0.8.2.md`). **The trio below is TODO**, deferred with measured targets (advisor
> tick-4): pronoun red set = 18 g-b1-pron ids; temporal = g-b1-temp ×5 + g-c1-temp ×9;
> discourse-count re-measure first — it sampled 0/5 red and is likely already green. See
> HANDOVER follow-up #3.

The three levers `CEFR_ENGLISH_0.7.1` measured + ranked — which **double as router prerequisites** (they
gate the A2→B1→C1 rungs, per Phase B of the router plan):
1. **Pronoun / focus binding** — the "it → Commit" mis-bind (`B1 pron 1.24`); biggest movable mass.
2. **Discourse-count anaphora** — "count them / how many of those" over a prior listing (clears the 2
   `CEFR_ENGLISH_0.7.1` tier-1 misses).
3. **C1 temporal-over-relative composition** — the two-hop ceiling (`C1 temp 0.31`).
Land all three (not just #1); they raise the chat floor *and* the router's floor at once.

### Track 2 — the router build (the within-horizon slice, in order)

> **STATUS: DONE.** The C1 composition gap is closed: the **member-filter HTN method + per-member
> callees hop** flips the standing C1 red in both drivers (resolver floor A0–C1 all 100/100); the
> ladder covers 56 fixture-linted cases; the bench-import smell is inverted
> (`src/router/call-validator.mjs` + `set-algebra.mjs`).

Built with a frontier model as co-author (see PLAN §"solved vs unsolved"):
- **Phase A — the shim.** An Anthropic Messages API endpoint (`/v1/messages`, `tool_use`/`tool_result`
  blocks). **Extended:** also present as a **`bedrock-meter`-compatible routing target** (see below).
- **Phase B — the measured baseline** (`AGENTBENCH_0.7.2.md`). Shim + a small graph-query toolset
  up the A0→C2 ladder, against the honest starting point (A0 solid, A1–A2 partial, per the
  CEFR_ENGLISH_0.7.1 inherited assets).
- **Phase C — the grading ladder.** The AGENTBENCH benchmark itself (rungs as levels, comparable
  local/hosted models as reference bands, zero-hallucination gate).
- **Stage 0 — capability registry** (`Capability`/`Parameter`/`Precondition`/`Effect` = STRIPS/PDDL
  operators as facts).
- **Stage 1 — the resolver** (unification + backward chaining / a mini Datalog).
- **Stage 4 — the guardrail** (validate an LLM's proposed `tool_use` against declared preconditions —
  the hybrid fast-path; cheap once 0–1 exist).
- **Stage 3 — the planner** (POP/HTN over operators + Steel & Ho monitor-and-replan → **closed-world
  C1**; optionally defer search to an external PDDL solver).

### Phase A extension — the `bedrock-meter` deployment surface
`../bedrock-meter` is pre-flight Bedrock cost metering + capping, with a **roadmap optimiser** that
"cheaply assesses a task's complexity … and routes to the lowest-cost capable model" (it already
meters Nova Lite + Nova Micro). tmct — **benchmarked against agent capabilities by AGENTBENCH** — slots
in as the **$0 floor *below* Nova-micro** in that routing ladder: for a request class AGENTBENCH proves
in-envelope, the optimiser routes to tmct (deterministic, ~$0, ms latency) instead of any metered
model. So Phase A's shim is built **bedrock-meter-pluggable**, and AGENTBENCH is what defines the
envelope the optimiser is allowed to trust. This is the concrete "near-free alternative" deployment.

### Track 3 — playtest alongside the build (`git worktree`)
Run `SKILL_BENCHMARK_CONVERSATION.md` **in a parallel `git worktree`** while the router is built — the
dialogue-flow dead-end hunt keeps running without blocking the build, and its fixes **merge back**.
(The worktree is auto-cleaned if unchanged; merge the frozen `test/chatflow-*` transcripts in.)

### Track 4 — research agents (the "at the edge" stages)
Two stages need design judgment + exploration, so they run as **background research agents**, off the
critical build path:
- **Stage 2 — intent frames, controlled fragment** — imperative NL → structured intent for the
  controlled command language (the front-end; the general case stays out-of-scope / escalate).
- **Stage 5 — goal-reasoner, closed-world C2** — BDI + Goal-Driven Autonomy: deduce-goals (long-chain
  deduction) → plan-each (C1) → threat-aware, *persistent* first-step arbitration.

> **STATUS: DONE.** Both research stages are built and measured. Stage 2 (imperative intent
> frames) is live. Stage 5's goal-reasoner is **rule-general, not single-rule**: two declared
> goal-rules (`coverage-invariant`, `cochange-risk-invariant`) selected by pure `applicableRules`
> deduction, with honest refusals at both failure modes (0 applicable = open-world, >1 = ambiguous),
> zero request keywords. Goal driver: 100% plan / 98% result / 0% hallucination over 56 cases.
> See `AGENTBENCH_0.8.1.md` / `AGENTBENCH_0.8.2.md`.

## Phase LATER — recognized, deferred, not now

Features we have deliberately shaped seams for but will not build until the phases above have
earned them. **Not everything below is deferred for the same reason** — the design horizon,
stated explicitly (2026-07-08 research pass):

**`PLAN_AGENTS.md` (2026-07-10) is the governing plan for tmct's next major arc** — mounting tmct
hard into `../marginalia` and `../seonix` as their shared NL↔graph engine and tool-loop/completions
API, plus a pluggable LLM rung for Claude Code, Amazon Bedrock, and GitHub Copilot. It sequences
Phase 0 (foundations — an extension-pack/corpus-lexicon seam, RI wrapper fixes, several other
small known-how items) through Phase 4 (the LLM-rung protocol shims), a "tmct uplift" section
grounded in fresh comparative audits of both sibling repos, and a tiered research horizon (R1–R3).
It supersedes the six phase/track pointers below that reference now-archived docs — treat this
paragraph as the up-to-date entry point, and the items below as historical record of how those six
docs' scope was reached before consolidation.

### Future direction: a genuine planning/agentic loop

Out of scope for the routing-level `GOAL_BY_COMMAND`/Goal-inference line above, which only labels
an already-computed answer's intent and never plans ahead of one: infer the goal, read the
relevant subgraph, reason about candidate action-paths and their effects, pick the next step,
execute, repeat.

Three companion research docs scope this against minimal benchmark domains before anything
domain-general is attempted; one of the three is now fully built, the other two remain design-only:
- `PLAN_HANOI.md` — TODO, the OPEN-LOOP case (a whole solution path is computable up front from
  the start state). Recommends representing state as taught facts in the memory store (not the
  read-only, provider-owned code graph), a new `restsOn` edge encoding stack order, and genuine
  bounded state-space search over hard-coding Hanoi's known closed-form recursive solution, so the
  result is an actual generalizable planner, not a Hanoi-shaped trick.
- `PLAN_GUESS_NUMBER.md` — TODO, the CLOSED-LOOP case ("I am thinking of a number," both as
  guesser — belief-interval bisection over repeated higher/lower observations — and as thinker —
  tmct holds a secret and gives honest feedback, no search needed). Recommends a new parallel
  session-state slot (`game`) threaded through `createSession`/`runTurn` exactly the way `focus`
  already is, kept deliberately separate from the `pending` pagination field since a game must
  survive an aside mid-play, unlike a listing remainder.
- `PLAN_TAUGHT_RELATIONS.md` — **DONE**, see "Teaching, memory & reasoning" above. Teaching tmct
  brand-new relations and rules through ordinary chat needed a successor function SYNTHESIZED from
  data the user taught in an earlier turn, rather than hand-written per domain the way Hanoi's
  `legalMoves` and guess-number's interval-update rule would be — plus a genuine new sibling
  kernel, `findReachableSet`, for open-ended enumeration ("list the descendants of X," no fixed
  goal) since `findActionPath` only ever searches toward one goal. Both kernels shipped and are
  proven against toy graphs (`src/planning.mjs`).

All three docs converged on one genuinely new primitive that didn't exist anywhere in tmct before:
something that computes a SUCCESSOR STATE (apply a chosen action, produce the next graph/belief to
reason over) — every prior traversal (`ancestorsOf`, `computeFind`, `findIsaChain` itself) was
read-only. That primitive now exists (`findActionPath` + `findReachableSet`, `src/planning.mjs`)
and is wired into the taught-relations domain; Hanoi and guess-the-number still need their own
wiring. A still-open recognition question for both: how tmct notices "the user wants goal-directed
action" at all, and whether multi-step execution needs confirmation before running.

### The design horizon

**Before the horizon — known-how, not-yet-built, no research risk.** Sequencing or engineering
debt: the technique exists (in tmct's own prior work or the wider literature), building it is a
matter of scheduling and effort, not discovery. Every DONE capability in "Recently shipped
capabilities" above falls in this bucket, plus: tone-of-voice adaptation (below — deliberately dropped by design choice, not unsolved);
tier-4 learn-on-miss (below — prerequisites not yet met, not research-blocked); `PLAN_CODE.md`
Tracks 2–4 (mutation search/repair, JS/HTML/CSS synthesis — APR and CEGIS are established
techniques); `PLAN_OSS_ACE_PARSER.md` (pure extraction/packaging); OWL 2 RL forward-chaining and
DL tableau consistency checking (`archive/PLAN_INFERENCE_TESTING.md` stages 3–5, all now shipped —
literature review moved to `PLAN_SYLLOGIST.md` §1 — the W3C's own OWL 2 RL profile is a
published, complete rule table; Pellet/HermiT/RDFox/Jena are real production reasoners built on
solved theory); RETE/incremental forward-chaining (`PLAN_SYLLOGIST.md` §2 — Forgy 1982 is a
citable, portable algorithm, not yet ported); contingent/conformant planning under initial-state uncertainty
(`PLAN_CAPABILITY_ROUTER.md` — Bonet & Geffner 2000, Hoffmann & Brafman 2006, Petrick & Bacchus
2002 all have working algorithms); ordinary closed-domain anaphora resolution (`nextFocus`,
already shipped, plus a real theoretical grounding available in Grosz/Joshi/Weinstein's centering
theory, 1995).

**After the horizon — genuinely unsolved in the field, or abandoned by the field in favor of
approaches tmct's no-LLM ethos rules out.** Named as real research targets, with citations, not
stop signs (full detail + full citation lists in each owning doc):
- **The frame problem / relevance realization** — the open-world planning boundary
  (`PLAN_CAPABILITY_ROUTER.md`'s "The open-world boundary" section; this doc's tier-5 Syllogist
  paragraph below). McCarthy & Hayes 1969 named it; Jaeger, Riedl, Djedovic, Vervaeke & Walsh
  (2024) argue it may not be algorithmically solvable in the general case at all. Speculative
  angle recorded: bounded (N+1) goal recognition — recognize declared goal 1..N, or reject to an
  explicit "escalate" class, via parse-shape membership (the same mechanism Bug 8's domain gate
  already uses) — not published anywhere found.
- **Symbolic (non-neural) dependency parsing at real coverage** — `PLAN_ADVANCED_GRAMMAR.md`
  track (c). Largely abandoned by mainstream NLP research once neural parsers won CoNLL
  2017/2018, not disproven at any fixed data budget. Speculative angle: a hand-built,
  closed-vocabulary disjunct/category dictionary (Link Grammar/CCG-style) scoped only to tmct's
  own closed relation vocabulary, registered as another additive interpretation strategy.
- **Winograd-hard commonsense coreference** — `PLAN_ADVANCED_GRAMMAR.md` track (g). Genuinely
  open without either massive statistical priors (ruled out) or a full commonsense KB (Cyc's
  decades-long cautionary history). Speculative angle: tmct's own closed, complete graph makes a
  *narrow slice* of Winograd-shaped ambiguity a graph-query-filtering problem rather than
  open-domain commonsense reasoning — explicitly not the same as solving Winograd.
- **Bounded, incremental, trust-tiered, retraction-safe justification tracking** —
  `PLAN_SYLLOGIST.md` §3 (moved out of `PLAN_INFERENCE_TESTING.md` on that plan's own
  retirement, once its build stages all shipped). Doyle's JTMS (1979) and de Kleer's ATMS
  (1986) solve retraction; DRed/RDFox's Backward-Forward solve incremental Datalog maintenance;
  nobody has published the specific combination with tmct's multi-trust-tier, hard-budget
  requirement. Speculative angle: an ATMS-lite extension to `syllogise.mjs`'s currently-flat
  provenance tag, sketched but unbuilt.
- **A shared ~2M-word cross-domain ontology (1M general-English base + 1M
  technical/scientific/engineering/programming-language/slang)** — `PLAN_ontology-hierarchies.md`
  §7, additive to (not a revision of) that doc's existing track (e), which stays about importing
  raw WordNet into tmct's own small tier-1 corpus specifically. Walked into, not avoided: merging
  two 1M-word vocabularies collides senses of lexically-shared words (`class`, `cache`, `thread`,
  `wave`, `cell`, `field`, `state`, …) across general/CS/physics/biology/slang registers —
  knowledge-based (non-neural) WSD is real but measurably weaker than supervised/neural WSD (Lesk
  1986; Raganato, Camacho-Collados & Navigli, EACL 2017), and BabelNet (Navigli & Ponzetto,
  *Artificial Intelligence* 193, 2012) proves automatic cross-resource sense merging at this scale
  is achievable — but its own pipeline moved toward statistical/graph-ML methods as it scaled,
  solves the cross-*lingual* not cross-*domain* axis, and carries a non-commercial licence, so it
  is a precedent, not a usable vehicle. Speculative angle recorded: mutual disambiguation from
  already-resolved neighbouring terms in tmct's own closed graph (a structurally-bounded,
  deterministic reading of Gale/Church/Yarowsky's "one sense per discourse/collocation"
  regularities) — not published anywhere found for this application.

Every item above is honestly labeled speculative — a direction recorded so it isn't
re-discovered from scratch, not a committed build plan. None of it is scheduled; the phases above
this line are still the actual near-term work.

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
