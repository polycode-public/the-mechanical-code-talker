# PLAN_AGENTS.md — tmct as the shared deterministic agent substrate

*(Drafted 2026-07-10. Status: sequenced build order, not a research plan — most of what it proposes
is known-how, staged by horizon. Supersedes `PLAN_TMCT_ECOSYSTEM_INTEGRATION.md` and absorbs six
sibling docs — `PLAN_AGI_ARCHITECTURE.md`, `PLAN_CAPABILITY_ROUTER.md`, `PLAN_TAUGHT_RELATIONS.md`,
`PLAN_OSS_ACE_PARSER.md`, `PLAN_ontology-hierarchies.md`, `PLAN_ADVANCED_GRAMMAR.md` — now archived.
See §12, Provenance, for what each contributed.)*

## 0. The architecture, in one picture

tmct is a deterministic, $0, provable NL↔graph engine and tool-loop/completions API. The operator's
intent for this doc is to mount tmct hard into the two sibling repos and stress it deliberately:

> *"I want to go a little too hard on using tmct to the detriment of marginalia and seonix because
> I have no users and this will stress tmct so I can see the edges to improve."*

Four concrete mounts:

1. **seonix mounts its own code→graph** (already shipped, in production since seonix 0.8.0). tmct
   combines that graph with its own lexicon/ontology/seeded graph to become the NL interface over a
   **codebase-specific combined index** — one chat surface over "this repo's code" and "software
   engineering in general" at once (§6).
2. **marginalia gets a web-scrape ingestion tool** (a BeautifulSoup-equivalent) that turns a `GET`
   into clean prose, fed into tmct's existing explicit-teaching surface — the chat-taught
   relations/rules machinery `PLAN_TAUGHT_RELATIONS.md` just shipped (§7).
3. **marginalia's own "mechanical chat" gets replaced by tmct** — an NL→SPARQL front end over
   marginalia's general-knowledge ontology, with real vocabulary bridging work (§5).
4. **tmct becomes a pluggable LLM rung** for tool-routing tasks in Claude Code, Amazon Bedrock (via
   bedrock-meter's already-tested router), and now GitHub Copilot — confirmed BYOK support via
   OpenAI-Chat-Completions-compatible or Ollama-style endpoints, shipped through Copilot App/CLI in
   2026 (§8).

A fifth, sibling track sits alongside these four rather than inside the phase sequence: **mechanical
text generation** — broad search over a prompt, group the results, infer relationships between
groups, mechanically summarize, drop what doesn't contribute, then a grammar/voice pass. Not
LLM-style generation — extractive and compositional, never inventing text beyond what was retrieved.
Detailed in the sibling doc `PLAN_COMPLETIONS.md`, a competing-but-kindred capability to
`PLAN_CODE.md`'s program synthesis (both are "tmct produces an artifact" categories; see
`PLAN_COMPLETIONS.md` §0 for the comparison). Cross-referenced from Phase 4 (§7) and the research
horizon (§9).

A sixth thread, realized mid-session (2026-07-10): tmct's own code-domain specialization was never
a special case — it is one particular seed set with an implicit bias, and the mechanism that makes
it "the code talker" generalizes to any seed set. §4 details a bias-weighted ambiguity-resolution
scheme (`tmct.toml`, named seed sets, declared weights) that turns this into a first-class,
configurable capability, and opens the door to ingesting much wider general-knowledge vocabulary
without abandoning the honest-ambiguity discipline that vocabulary would otherwise strain.

Before any of the above, though, tmct itself has real, verified gaps against its two closest sibling
codebases — §2 catalogs them, code-grounded, and feeds the low-risk items straight into Phase 0.

None of this proposes making marginalia or bedrock-meter no-LLM. tmct's contribution stays the
deterministic, $0, provably-in-envelope slice, with an honest, named escalation boundary to a real
model everywhere tmct cannot answer — same discipline as every other tmct plan.

## 1. Ground truth — what's already real

The two audits this doc supersedes (`PLAN_TMCT_ECOSYSTEM_INTEGRATION.md`,
`PLAN_AGI_ARCHITECTURE.md`, both 2026-07-08) verified this against code, not docs. Conclusions only:

| Capability | Status | Evidence |
|---|---|---|
| `POST /v1/messages` HTTP shim (Anthropic-Messages-API-compatible) | **Shipped**, since 0.8.0 | `src/server-http.mjs`, `bin/tmct.mjs serve` |
| Repository Interface v1.0.0 (15 services, closed `EDGE_KINDS`/`MISS_REASONS`) | **Shipped**, stable since 0.5.0 | `src/repository-interface.mjs`, `src/providers/graph-service.mjs`, `src/conformance.mjs` |
| Capability router (STRIPS/PDDL registry, resolver, planner, guardrail, goal-reasoner) | **Shipped**, all 6 stages | `src/router/*`, measured on AGENTBENCH |
| AGENTBENCH goal-reasoner (Stage 5, the C2 rung) | **Shipped and measured** | 56 cases: 100% plan / 98% result / 0% hallucination, one C2 case deliberately kept result-red (91%) |
| seonix code→graph, driven by tmct | **Shipped, in production**, seonix 0.8.0→0.10.6 | `seonix/src/tmct-provider.mjs` — 37 lines, `createGraphService` reused directly |
| bedrock-meter cost-ordered router with a tmct rank-0 ($0) rung | **Shipped and tested** | `router.mjs`/`router-ladder.mjs`/`routing-target.mjs`, 11 passing tests |
| marginalia's `seon-mcp` self-hosted code graph | Built, **not yet wired to tmct** | near-zero-gap integration, same pattern as seonix (§1.1 below) |
| marginalia's "mechanical chat" replaced by tmct | **Not started** — the real open work | `app/lib/mechanical/`, 1,043 LOC, dark-flagged sub-path today |
| marginalia LLM-decided facts (`typed-edges.mjs`) trust-tagged like tmct's own facts | **Not started** | confidence computed then discarded before persistence — the actual gap |
| Chat-taught relations, rules, backward-chaining query dispatch | **Shipped** (`PLAN_TAUGHT_RELATIONS.md`, 2026-07-09) | Rule storage (compose2/filter/recursive kinds) + `resolveRelationChase` — see §1.2 |
| Bias-weighted ambiguity resolution across seed sets | **Not started** — new this session | tmct's own domain is currently the only implicit bias; see §4 |

### 1.1 Foundational precedent: seonix proves the integration pattern

seonix's cutover (`archive/PLAN_CHAT_EXTRACTION.md` in seonix's own repo, already done) is the
template for every other mount in this doc. `seonix chat`, the `seonix_ask` API, and the website
"Ask the graph" panel all now call tmct; every typed, structural MCP tool (`seonix_describe`,
`seonix_snippet`, `seonix_members`, `seonix_impact`, `seonix_search`, `seonix_context`) stayed
native. The pattern that generalizes: **NL-to-tool-selection routes through tmct; fast, typed,
already-well-shaped tool calls stay native to the host.** tmct's job was never to reimplement
`seonix_impact`'s reverse-closure computation — it was to decide, from natural language, that
impact is what's being asked for and bind the right module. marginalia's `seon-mcp` (§1.1 of the
old ecosystem plan) is a near-1:1 vocabulary match with tmct's own `EDGE_KINDS` for the same
reason — proven twice now, low-risk, staged first (§11).

### 1.2 Foundational precedent: PLAN_TAUGHT_RELATIONS is a working Stage 0/1 prototype

The chat-taught relations system just shipped (Rule storage in `src/memory/core.mjs`, the
backward-chaining query dispatcher `resolveRelationChase`, the bounded successor-function search
`findActionPath`) is structurally the same shape as the capability router's Stage 0 (capability
ontology + registry) and Stage 1 (the resolver — unification + backward chaining over
capabilities-as-facts), just scoped to family relations instead of tool capabilities. Declare a
named thing with structure (base relation, a property filter, a recursive step ↔ preconditions,
effects, decomposition), then chase a query against taught facts to find what satisfies it — the
same "STRIPS/PDDL operator model" the router doc cites. Generalizing from "person A fathers person
B" to "tool X, given args, produces effect Y" is a real step, but a smaller one than starting from
nothing. Worth remembering when scoping Phase 2's slot-filling work (§5).

## 2. tmct uplift — what marginalia and seonix already do better

Two deep, code-grounded comparative audits (2026-07-10) surveyed both sibling repos for mechanisms
tmct lacks or has a cruder version of, deliberately separate from the vocabulary/integration gaps
§1 and §5-§8 already cover. Findings are risk-graded — (a) mechanical/low-risk, (b) real but
bounded, (c) genuinely harder — and feed §2.3 below.

### 2.1 From marginalia

- **Memory-tree versioning (b).** `app/lib/s3-tree.mjs` writes immutable, monotonically-versioned
  snapshots with a tiny manifest pointer to the current version; tmct's `.tmct/memory/graph.json`
  overwrites in place — one copy, no rollback, no "what did the graph look like before this fold."
  Port: `graph.v{N}.json` + a `manifest.json` pointer, a contained change to `core.mjs`'s write path,
  no new dependency. Main open design question is a retention/pruning policy.
- **Actor-level, behavior-driven trust (b).** `app/lib/trust.mjs` tracks a persistent, evolving
  per-actor score from behavioral signals (corroboration, guardrail-fire-rate, longevity); tmct's
  `SOURCE_PRIOR` is fact-level/source-type-level only — two different human teachers both tagged
  `teach` get identical trust, and a repeatedly-wrong web source scores no worse than a first-time
  one. Port narrowly: a per-source-id reliability score layered onto the existing `Source`
  individuals, nudged by corroboration/contradiction outcomes over time — not marginalia's full
  actor-lifecycle machinery (no external agents to recontact, so that part doesn't transfer).
- **Gazetteer-based entity/predicate recognition (b).** `app/lib/mechanical/matcher.mjs` builds a
  wink-nlp gazetteer straight from the graph's own entity labels/aliases plus lemma/stem-tolerant
  verb-phrase tables, so new vocabulary flows through with zero new grammar code. tmct's ACE grammar
  (`src/grammar/ace.mjs`) is deliberately strict — a sentence fits one of 8 declared patterns whole
  or falls through by design (a documented ground rule, not an oversight). Not a replacement: a more
  tolerant recall path feeding the strict grammar as an additional front end, not instead of it.
- **Declarative SHACL ingest gate (c).** Every marginalia memory node is validated against a shape
  contract (`app/ontology/shapes.ttl`, via `shacl-engine`) before it enters the shared tree — a
  standards-based, declarative write-boundary contract. tmct's `src/conformance.mjs` is hand-rolled,
  imperative shape validation, not one declarative gate at the write boundary. A new dependency plus
  real schema-authoring effort, not a quick port.
- **Hub-dampening + thin-concept detection (a).** tmct already implements exactly this pattern in
  `src/codegraph.mjs` (degree-quantile hub gating, min-heap frontier expansion) — for the **code**
  graph only. `src/memory/blocks.mjs`'s fact retrieval (PageRank + query-time IDF) has no equivalent,
  so a fact hanging off a heavily-connected subject ranks purely on trust/provenance count, not
  structural specificity. Copy-the-idea-not-the-code into memory ranking: pure JS, no new dependency,
  tmct has already solved this problem once.
- **Contradiction detection — checked explicitly, tmct is ahead here.** marginalia's `mg:contradicts`
  is only ever LLM-proposed at ingest or materialized via symmetric closure — no algorithm actually
  detects disagreement. tmct's `findContradictions` (`src/memory/core.mjs`) is fully automatic and
  deterministic: any two facts sharing (subject, predicate) with a different object, both above a
  trust floor, surface as an explicit unresolved pair on every `/memory` render. Not a finding to
  adopt — confirmation that tmct's own mechanism is more reliable than marginalia's here.

### 2.2 From seonix

Structural note that reframes all of these: seonix depends on tmct as a package
(`seonix/src/tmct-provider.mjs` imports `createGraphService` directly), and seonix's own
`src/codegraph.mjs` is a near-verbatim fork of tmct's `src/codegraph.mjs` (2109 vs 2123 lines, diffs
are naming/gated-feature only). Most findings below are gaps in what tmct's Repository Interface
**wrapper** (`repository-interface.mjs` + `providers/graph-service.mjs`) exposes, not gaps in
algorithmic capability tmct would have to invent — the logic already sits in tmct's own
`codegraph.mjs`, just not wired to the provider surface.

- **Search/context are stubs relative to logic tmct already owns (a).** `graph-service.mjs`'s
  `search()` is an unranked substring filter with no limit/pagination; `context()` unconditionally
  misses. IDF-weighted lexical scoring (`scoreModules`) and context bundling (`contextPlan`/
  `sizeBundle`) already exist verbatim in tmct's own `codegraph.mjs`, used by tmct's standalone
  `src/server.mjs` — this is a call-site fix, pointing the wrapper's methods at logic tmct already
  owns, not new design.
- **Depth-capped impact + source-backed snippets (a).** Both repos run the identical `impactClosure`
  BFS reverse-dependency closure — seonix threads an opt-in `depth` argument through (e.g. one-hop
  only); tmct's RI `impact(moduleId)` takes none. seonix's snippet tool reads real source via
  `sourceAccess:true`; tmct's RI `snippet()` always returns `body:null` because no provider defaults
  it on, even though the exact readFile+slice code exists in tmct's own `src/server.mjs`. Both are a
  few hours of call-site work, following seonix's own pattern almost verbatim.
- **Unbounded search/edges responses (a for the cap, b for cost telemetry).** `edges()`/`search()`
  return every match with no limit or pagination, unlike seonix's `SEARCH_LIMIT`/page cursors and
  per-call token-cost telemetry. tmct already has the same telemetry module (`src/telemetry.mjs`),
  just not wired to any tool-dispatch surface — the cap is a contained fix; wiring telemetry needs
  tmct to first decide what its tool-dispatch surface even is.
- **Real multi-language AST extraction (b, genuine engineering scope).** seonix parses Python/
  TypeScript/C#/Java via real compiler front ends (a Python `ast`-based extractor, the TS compiler
  API, a compiled Roslyn tool, JavaParser+`JavaSymbolSolver` for real semantic call resolution).
  tmct's `graph-build.mjs` explicitly does no parsing at all — "no subprocesses, no filesystem, no
  git: data in, graph out." tmct is a pure downstream graph consumer, never a graph builder from
  source. Wiring seonix's parsers to feed `graph-build.mjs` is plumbing (subprocess orchestration,
  multi-runtime packaging for JVM/dotnet tools), not new algorithm design — the assembly logic is
  already duplicated between the repos.
- **Chronograph temporal diffing (c, genuinely hard).** seonix's `chronograph/lib/temporal.mjs`
  gives every node/edge a validity interval and computes real structural diffs between arbitrary
  commits (added/removed/changed, wired/unwired/rewired edges) plus deterministic prose narration
  and a scrubbable Cytoscape browser. tmct's `history(id)` RI service is a single one-hop "commits
  that touched this" lookup — no diffing. Requires a validity-interval graph model tmct's provider
  contract doesn't currently supply, plus a browser front end — multi-day, not a quick win, and
  seonix itself hasn't wired this as an MCP tool either.
- **Disambiguation — checked explicitly, tmct is ahead here.** tmct's `resolveObjectCore` has 5+
  resolution tiers (compound-word joining, derivational stemming, prose-token overlap, bounded fuzzy
  matching) plus a hard refuse-and-list-candidates on ties; seonix's own conversational path already
  delegates to tmct's resolver. Nothing to port except an optional frequency-based tie-break, which
  conflicts with tmct's "honest ambiguity over guessing" principle — a judgment call, not a clear
  win. (§4 adds a different, complementary answer to the same question — a declared bias rather than
  a frequency heuristic.)
- **Visualizers + repo-level incremental sync (b, optional).** seonix ships a standalone Cytoscape
  ego-neighborhood viewer (`viz.mjs`, distinct from Chronograph) and multi-repo incremental re-index
  (`manifest.mjs`, git-SHA + dirty-worktree fingerprinting); tmct has neither — no graph-rendering
  capability at all, and no multi-repo shape. Relevant if/when tmct's own use case grows multi-repo
  or needs visual output; not urgent today.

### 2.3 What this changes in the phase sequence

The (a)-tier findings — hub-dampened memory ranking, RI search/context/impact/snippet wiring,
response pagination — fold straight into Phase 0 (§3) as additional foundations: genuinely low-risk,
no new dependency, mostly exposing logic tmct already owns rather than building anything new. The
(b)/(c)-tier findings — memory versioning, actor-level trust, the SHACL ingest gate, multi-language
AST extraction, Chronograph-style temporal diffing — are real, scoped engineering. Multi-language
extraction and RI depth/telemetry feed Phase 3 (§6, the seonix combined index) most directly;
memory versioning, actor trust, and the SHACL gate are standing tmct-quality backlog, not yet
phase-assigned, independent of any specific integration. None of this is research — every item
above cites an existing, working mechanism in a sibling repo, not a proposal to invent something
new.

## 3. Phase 0 — Foundations

Near-term, mostly known-how, individually small. No item here requires research.

- **Cross-repo smoke test** — a real `tmct serve` process, hit over HTTP by bedrock-meter's
  `httpDispatch`, proving the documented response shape holds outside hand-built fixture objects.
  Cheapest, highest-value gap to close first; everything else assumes this wire contract is real.
- **Machine-readable capability envelope** (`agentbench/envelope.json`) — generated from the latest
  gate-PASS AGENTBENCH rungs (`maxContextTokens`, reasoning depth, `structuredOk`/`toolsOk`), so
  bedrock-meter's hand-set `TMCT_ENVELOPE` calibration stops drifting from tmct's actual measured
  capability every release.
- **The extension-pack / corpus-lexicon loading seam** — the one genuinely new tmct primitive this
  whole plan hinges on. Today tmct's corpus, lexicon, and templates are committed inside the package
  and loaded by hardcoded paths (`src/chat.mjs`, `src/grammar/lexicon.mjs`,
  `src/corpus/templates.mjs`); there is no `[extensions]` config surface, no `registerExtension()`,
  no host-declared-lexicon knob of any kind. A host package can supply its own **graph** through the
  provider seam already, but not its own **vocabulary**. This phase adds: an `[extensions]` table in
  `tmct.toml` (or `registerExtension()` for the library path) naming extra corpus JSONL, lexicon
  entries, and template rows in the same shapes tmct's own core files already use; namespacing so
  extension facts enter with a distinct `Source` (e.g. `corpus:marginalia`) and never silently
  shadow core vocabulary — a conflicting definition surfaces as a visible contradiction, the
  already-shipped provenance behavior; and `tmct extend --validate` running the same shape checks
  the core corpus already gets, so a malformed extension pack fails at build time, not query time.
  This is the first time tmct's answer surface can be shaped by data its own maintainers didn't
  author or review — the namespacing/provenance design is load-bearing, not a nice-to-have. **This
  is also the config surface §4's bias weighting hangs off of** — each named extension becomes a
  named seed set a bias weight can attach to.
- **`ace-owl` open-source extraction** — pulling tmct's ACE-OWL controlled-English parser
  (`src/grammar/ace.mjs` + lexicon) out into a standalone, MPL-2.0, dependency-free npm package.
  Nothing like it exists as a permissive, ESM, browser-capable English-to-OWL-triples parser (the
  reference implementation, APE, is GPL/LGPL and SWI-Prolog-native). Was gated on the Repository
  Interface's library-surface discipline existing first (so `ace-owl` is the second proof of the
  same boundary, not inventing it twice) — that gate shipped, so this is now unblocked. Both seonix
  and marginalia are plausible consumers of a standalone NL-to-OWL parser.
- **Ontology-hierarchies tracks a–d** — activate ConceptNet `/r/Synonym`/`/r/SimilarTo`; wire the
  already-parsed but unused phrasebook synonyms; hand-curate the SEON upper-ontology spine; grow
  `owl:disjointWith` premises. All rated high feasibility, small-to-medium effort, direct feeders
  for the "combined lexicon, ontology, seeded graph" vision in §6. Track (e), importing WordNet
  wholesale, is rejected — wrong tier, would reintroduce the word-sense noise the ConceptNet filter
  exists to avoid. (§4 revisits this rejection's premise for the wider-seed-set question
  specifically — the objection was to noise with no way to rank through it, not to breadth itself.)
- **Advanced-grammar tracks a/d/f** — subordination/conditional frames, construction-grammar
  template banks, presupposition-as-honest-nudge. High feasibility, small-to-medium effort, direct
  precedent in shipped 0.8.2 code. Cheap comprehension wins that raise the floor everything else in
  this doc is built on.
- **Re-measure inherited chat-surface debt** — the capability router doc named three specific gaps
  (pronoun/focus binding, discourse-count anaphora, temporal-over-relative composition) as blocking
  its later stages, measured back in CHATBENCH_0.7.1. The Tier 5/6 dialogue-flow playtest closures
  landed since then plausibly fixed some of these as a side effect. Nobody's checked. Cheap,
  informative, tells us whether the router's stated floor is already higher than assumed — do this
  before scoping new comprehension work.
- **RI wrapper fixes from the seonix audit (§2.2)** — ranked search, real `context()` bundling,
  depth-capped `impact()`, source-backed `snippet()`, response pagination on `search()`/`edges()`.
  All (a)-tier: point the Repository Interface wrapper at logic that already exists in tmct's own
  `codegraph.mjs`, no new dependency.
- **Hub-dampened memory-fact ranking, from the marginalia audit (§2.1)** — port the degree-based hub
  dampening tmct's own `codegraph.mjs` already implements for the code graph into `memory/blocks.mjs`'s
  fact retrieval, so a fact off a heavily-connected subject ranks on structural specificity, not just
  trust/provenance count. Pure JS, no new dependency, copy-the-idea-not-the-code.
- **Benchmark/skill doc unification** — this restructuring itself (§12).

## 4. Phase 1 — Bias-weighted ambiguity resolution & wider general-knowledge seed sets

The realization driving this phase, in the operator's own framing: tmct's own code-domain
specialization was never a special case — it is one particular seed set with an implicit bias. The
mechanism that makes tmct "the code talker" generalizes to any seed set, including a future one
that isn't code at all.

- **The default stays honest ambiguity over guessing.** §2.2 already confirmed this is the right
  posture — tmct's resolver refuses and lists candidates on a genuine tie, and seonix's own
  conversational path defers to tmct's resolver for exactly this reason. This phase does not weaken
  that default. It adds one new ranking input ahead of the existing tie-break: a declared bias.
- **`tmct.toml` gets a `[bias]` table** naming active seed sets (Phase 0's `[extensions]` entries, or
  tmct's own built-in code-domain vocabulary) and a numeric weight each — e.g. `code = 1.0, general =
  0.6`. A polysemous lexicon entry — the operator's own example: "class" mapping to both a code
  construct and a school class, one sense contributed by each of two seed sets — resolves toward the
  higher-weighted sense by default. The lower-weighted sense stays reachable and is disclosed in the
  answer, never silently dropped: bias changes ranking, not truth. A tied bias falls back to today's
  honest-refusal behavior, unchanged.
- **This is the missing piece the WordNet-rejection rationale didn't have** (§3's ontology-hierarchies
  bullet; the archived `PLAN_ontology-hierarchies.md` track (e); R3's 2M-word-ontology entry, §9).
  That rationale rejected wide general vocabulary because it reintroduces word-sense noise a narrow,
  curated corpus was built to avoid. Bias weighting doesn't eliminate that noise — it gives tmct a
  declared, inspectable way to rank through it instead of needing to avoid it by staying narrow. Next
  time R3's 2M-word-ontology assessment is revisited, this changes what it should weigh — not a green
  light to build it, but a genuine change in the calculus.
- **A wider general-knowledge seed set becomes worth ingesting on these terms** — not to replace
  tmct's code-domain depth, but to sit alongside it as a lower-biased-by-default general layer, the
  "any seed set" framing above made concrete. Grow the committed/seeded corpus tiers (`ROADMAP.md`'s
  4-tier corpus policy) with a broader ConceptNet slice or comparable general-purpose source, gated
  by the same shape-validation discipline `tmct extend --validate` (§3) already applies to extension
  packs.
- **Context-preserving ingestion for unknown words — new, not yet built.** When a wider seed set (or
  Phase 4's scraped web content, §7) introduces a term tmct doesn't recognize, it should not be
  silently dropped. It enters the graph as a real individual tagged with the passage it was found in
  (a stored context paragraph, as provenance), and other words — known or unknown — co-occurring in
  that same passage get linked to it. This is deliberately **not** distributional/embedding-style
  meaning induction — that would cross into LLM-shaped territory. It is a bounded, structural
  provenance mechanism: a future resolution pass, or an explicit teaching turn, has real context to
  work from instead of a bare, contextless token. Scoped honestly: this buys traceable context, not
  automatic sense disambiguation, and should be graded on that basis, not oversold as understanding.
- **Config surface, concretely.** Extends Phase 0's `[extensions]` table — each named
  extension/seed set gets an optional `bias` weight. The resolver's existing tie-break logic (already
  principled — refuse-and-list-candidates on a genuine tie, §2.2) gets one new input ahead of that
  tie-break: prefer the sense whose owning seed set has the higher declared bias, falling back to
  today's honest-refusal behavior only when biases are equal or absent.

## 5. Phase 2 — tmct as marginalia's interpreter

Two paired within-horizon efforts: both are "point a real external NL→structured-query surface at
tmct" rather than validate against synthetic benchmarks.

- **`seon-mcp` provider adapter** — marginalia's self-hosted code graph (~694 LOC:
  `codegraph.mjs`/`api.mjs`/`server.mjs`/`config.mjs`, three tools `seon_describe`/`seon_impact`/
  `seon_search`) wired to tmct the same way seonix's `tmct-provider.mjs` is: a thin,
  `createGraphService`-compatible adapter, no extension pack needed. Its vocabulary is a near-1:1
  match with tmct's `EDGE_KINDS` — `imports/calls/defines/tests/touches` overlap directly, and its
  classes align via `owl:equivalentClass` to the same SEON vocabulary tmct's own
  `ontology/tmct-core.ttl` already cites. Proven pattern, 2 for 2 (seonix, then this), staged first
  for the lowest-risk marginalia integration.
- **marginalia's NL→SPARQL "Formulate" as the real Stage-2 validation target.** Marginalia's own
  deterministic fallback (`formulate-grammar.mjs`, 174 lines) already proves a real subset of
  text-to-query is tractable without an LLM — an actual external consumer waiting for tmct's
  intent-frame/slot-filling stage, which beats validating that stage against invented test cases.
  Use it to drive real coverage measurement, not just AGENTBENCH's synthetic ladder.
- **The mechanical-chat replacement itself** — the single biggest chunk of new engineering in this
  doc. marginalia's `app/lib/mechanical/` (matcher.mjs, answer.mjs, render.mjs, refs.mjs,
  formulate-grammar.mjs, mine-turns.mjs) is a dark-flagged sub-path of marginalia's real chat (which
  calls Bedrock); the mechanical rung is tried first only when `mechanical_first` is on, and a
  grammar miss falls through to Bedrock unchanged. Replacing it does not mean marginalia stops using
  an LLM — it means the deterministic pre-filter gets tmct's CEFR-graded chat surface, router, and
  memory/provenance/trust layer instead of a 1,043-line homegrown one; the Bedrock fallback stays
  for genuinely open-ended chat outside tmct's provable envelope.

  The vocabulary gap is real and specific: marginalia's domain ontology (`app/ontology/ontology.ttl`,
  `app/lib/vocab.mjs`) is general-knowledge (`Person`/`Organisation`/`Place`/`Event`/`Concept`/…),
  zero overlap with tmct's code-only classes, plus its own closed relation vocabularies
  (`TYPED_EDGES`, `ENTITY_OBJECT_PROPS`) disjoint from tmct's 11-member `EDGE_KINDS`. But most of the
  bridging is mechanical, not hand-authored: `ENTITY_CLASSES` is already an ISA hierarchy
  structurally identical to `corpus/seon/concepts.jsonl` rows, so a small compiler emits corpus rows
  and definitions directly from `vocab.mjs`'s existing `{name, parent, comment}` shape. Verb trigger-
  phrase lists (`ENTITY_OBJECT_PROPS`/`TYPED_EDGES`'s `verbs: [...]` arrays, e.g. `mg:dependsOn:
  ["depends on", "requires", "relies on", ...]`) become lexicon entries the same mechanical way, and
  marginalia's own `vocab-sync.test.mjs` drift guard already keeps this source of truth fresh — the
  extension's freshness is solved on marginalia's side, not a new burden. What needs real authoring:
  a `Capability` entry per relation (mirroring the router's `registry.mjs` pattern — precondition
  "focus entity resolved," effect "adds dependsOn topic") so the resolver picks the right predicate
  by deduction over declared preconditions/effects, not keyword-matching; and the provider adapter
  itself, since marginalia's individuals live in oxigraph as RDF, not tmct's in-memory graph shape —
  a SPARQL-backed implementation of the 15 Repository Interface services, comparable in size to
  marginalia's own `formulate-grammar.mjs` + `matcher.mjs` (387 lines combined). A multi-day task,
  not a code-generation exercise. Gated on Phase 0's extension-pack seam existing.

## 6. Phase 3 — tmct × seonix combined codebase index

- **Mount seonix's code→graph** through the Phase-0 extension-pack seam alongside tmct's own
  ontology/lexicon/seeded graph, so one chat surface answers both "what does this repo's code do"
  and "what does this software-engineering term mean" without the visitor needing to know which
  question is which.
- **Guiding principle, backed by 2026 research**: AST-derived deterministic graph construction
  (Tree-sitter-style static analysis — parsing, symbol resolution, dependency extraction) beats
  LLM-extracted knowledge graphs on both completeness and speed. A 2026 comparison found AST-derived
  graphs build in seconds (2.8s–13.8s across three real codebases) while LLM-generated graphs took
  substantially longer and exhibited "probabilistic indexing incompleteness" — files silently
  skipped. This directly validates tmct's no-LLM philosophy applied to seonix's own graph-build step
  too, not just tmct's chat surface.
- **Real multi-language AST extraction, from the seonix audit (§2.2).** seonix already runs real
  compiler front ends (Roslyn for C#, JavaParser+SymbolSolver for Java, the TS compiler API,
  Python's `ast`) that tmct's own `graph-build.mjs` has none of — it is a pure downstream graph
  consumer today. Wiring seonix's extraction pipeline to feed tmct's graph-build step is the
  concrete engineering this phase needs for the combined index to cover more than one language.
- **Depth-capped impact, source-backed snippets, and cost telemetry, from the seonix audit (§2.2).**
  Once the combined index is real, the Repository Interface's own thinness (unbounded traversal, no
  source access by default, no per-call cost accounting) stops being a paper cut — these are the
  same fixes as Phase 0's RI wrapper items, worth re-verifying against the larger combined graph
  specifically once it exists.
- **tmct becomes the NL surface over the combined index** — the same escalation discipline as
  everywhere else in this doc: answer what's provably in the combined graph/ontology, decline
  honestly outside it, never guess.

## 7. Phase 4 — marginalia web-scrape → tmct learning pipeline

- **A scraping tool** (a BeautifulSoup-equivalent, or a Node/JS HTML-extraction library) that turns
  a web `GET` into clean prose blocks.
- **Feed scraped prose into tmct's existing explicit-teaching surface** — the chat-taught
  relations/rules mechanism from `PLAN_TAUGHT_RELATIONS.md`, and typed-edge extraction's
  explicit-teaching half (marginalia's own capability audit already found "X is the Y of Z"-style
  explicit teaching moves cleanly to tmct + effort). This phase wires a new ingestion source to
  capability tmct already has.
- **Also feeds §4's context-preserving unknown-word ingestion** once that lands — scraped prose is
  exactly the source material that mechanism is meant for: unknown terms enter the graph tagged with
  the scraped passage they came from, not dropped.
- **Also a natural Stage-1 input source for `PLAN_COMPLETIONS.md`'s mechanical text-generation
  pipeline** once that track is scoped — scraped web content is exactly the kind of broad-search
  material that pipeline's grouping/inference/summarization stages consume.
- **Explicit honesty boundary, carried over from marginalia's own capability audit**: open-world
  NER (finding named people/places in free prose) and implicit relation mining from arbitrary
  scraped text both stay beyond horizon — tmct resolves an already-named term, it doesn't go find
  one. This phase is strictly about wiring a new ingestion source to existing explicit-pattern
  extraction, not new NLU capability. Don't scope-creep it into open-world extraction.

## 8. Phase 5 — tmct as a pluggable LLM rung

Three targets, each a protocol-adapter problem, not a research problem. MCP is the dominant 2026
tool-integration standard (spec 2025-11-25, donated to the Linux Foundation's Agentic AI Foundation
in December 2025, near-universal adoption across Anthropic/OpenAI/Google/Microsoft) — worth keeping
in view for how these shims are shaped, even though tmct's existing shim speaks the Messages API
directly rather than MCP.

- **Claude Code** — already solved. The `/v1/messages` shim, tool dispatch, and capability router
  have shipped since 0.8.0. This phase is hardening, not building: thicken the guardrail (capability
  router Stage 4) to validate real Claude Code tool_use proposals against declared capabilities, not
  just AGENTBENCH's synthetic cases.
- **Amazon Bedrock** — bedrock-meter's router already has a tested tmct routing target (the rank-0,
  $0 rung, envelope-gated). This phase closes two named gaps: no live integration test (only
  injected-dispatch unit tests — the wire format has never been proven compatible end-to-end between
  the two independently-released packages), and no upstream "assessor" (the raw-request→`{score,
  confidence, needs}` classifier `route()` consumes but nothing yet produces). tmct's own
  `isConversational`/`selectTool` heuristic is a legitimate, free, zero-latency first check the
  assessor step could run before paying for a model call — not a substitute for the general
  assessor, but a real free pre-filter.
- **GitHub Copilot** — new. Confirmed in 2026: Copilot App and CLI both support BYOK against
  OpenAI-Chat-Completions-compatible endpoints or Ollama-style local hosts (Settings → Model
  Providers, or environment variables for the CLI). tmct needs a second protocol shim translating
  between the OpenAI Chat Completions JSON shape and tmct's existing internal `runTurn`/`dispatchTool`
  engine — the same kind of mechanical adapter the Messages-API shim already is, not a new capability.

## 9. Research horizon

Tiered by hardness. Each item gets one paragraph here; full literature and citations live in the
new shared reference doc, `docs/references/research-horizon.md`, cross-linked rather than repeated
(three archived docs independently grew near-identical essays on this territory — see §12).

**R1 — nearest, worth a scoping spike soon:**

- **Bounded (N+1) goal recognition** — a symbolic, deterministic goal-recognition scheme bounded to
  N declared goals plus an explicit reject class. Not published or built anywhere this research
  found. The capability router's own next spike to scope, not a result to claim yet.
- **DRT-lite typed discourse record** — a bounded discourse-representation structure for tracking
  entities/relations across turns, feeding better slot-filling for Phase 2's marginalia work. Close
  kin to `PLAN_COMPLETIONS.md`'s Stage 3 (inference between retrieved-text groups, §1.3 there) — both
  track relationships between spans of text, one across chat turns, one across retrieved groups;
  worth designing together if both are ever scoped.

**R2 — harder, real but distant:**

- **Hand-built closed-domain dependency/categorial grammar** — rule-based dependency parsing is a
  largely abandoned line of research, not because it was proven inferior, but because research
  incentives shifted to reward statistical approaches. A hand-built, closed-domain disjunct/
  categorial grammar is a genuinely unbuilt additive idea, recorded so it isn't rediscovered from
  scratch — not a green light to build it.
- **Cross-repo shared trust vocabulary** — a `SOURCE_PRIOR`-style scale shared between tmct and
  marginalia so "how much to believe this fact" means the same thing regardless of which ontology
  answered. Needs the LLM-decision provenance tagging (below) to land first.

**R3 — frontier-open, record-not-commit:**

- **Open-world planning / the frame problem** — the capability router's central named boundary.
  Closed-world planning (STRIPS/PDDL, HTN, POP) is solved and shipped; open-world relevance-bounding
  is argued by cited literature to be possibly algorithmically unsolvable, not just unbuilt.
- **Winograd-hard coreference** — no symbolic/deterministic system has solved Winograd-class pronoun
  ambiguity, and none is expected to. One speculative sub-angle worth a future PLAN, not scheduled
  here: grounding pronoun disambiguation in tmct's own closed, complete graph rather than open
  commonsense.
- **A shared ~2M-word cross-domain ontology** — no one has published the combination this idea
  needs (general + technical vocabulary, merged, at this scale, under a no-LLM constraint). Unknown,
  unattempted — the actual open question, not a commitment to build. §4's bias-weighting mechanism is
  a genuinely new input to this question — not a solution, but a real change in what "merged, at
  this scale" would mean if disambiguation no longer had to rely on narrowness alone.
- **"All of a typical human's knowledge"** — the operator's own AGI framing, checked honestly: Cyc
  (40 years, ~100M hand-encoded assertions) is remembered mainly as a cautionary tale of effort vs.
  payoff at that scale; WordNet's own scope problem reintroduces the same sense-disambiguation noise
  domain-scoped ontologies exist to avoid. The pragmatic reading of the operator's own architecture
  is already compositional, not monolithic: tmct's software-domain ontology + marginalia's
  general-knowledge ontology, each independently scoped and quality-filtered, is a more defensible
  shape than one universal graph — and it's the shape that already exists.

**Also research-adjacent, not yet tiered — the LLM-decision provenance gap.** Marginalia's
`typed-edges.mjs` computes an LLM classification confidence at extraction time, then explicitly
discards it before persistence — no trust score, no `derived_by` tag survives on the stored fact.
tmct's `SOURCE_PRIOR` (`{operator: 1.0, teach: 0.95, provider: 0.9, corpus: 0.7, web: 0.4, entailed:
0.3}`) is a candidate template: a new `llm-decided` tier, marginalia keeping `edge.confidence`
instead of dropping it, a `derived_by: "llm"` provenance tag, and a principled trust-weighted
retraction path instead of an admin hide-flag. Not research — an integration spec between two
existing systems — staged into Phase 0/R2 depending on how it lands.

## 10. Non-goals

Explicit pruning record, so these aren't re-asked:

- **PLAN_CAPABILITY_ROUTER's "Open questions (for tonight)" section** — a same-session decision
  list, stale now that Stage 5 shipped. Dropped entirely, not carried forward.
- **PLAN_OSS_ACE_PARSER's "sibling publish candidates"** (a bounded-Damerau fuzzy matcher, a
  PageRank+IDF block ranker) — both have permissive JS alternatives already, unlike ACE. Reduced to
  a single ROADMAP backlog line, not a phase here. (The block ranker specifically is un-pruned and
  re-scoped inside `PLAN_COMPLETIONS.md` §1.4, where it has a real job — see that doc, not this one.)
- **Duplicate WordNet/SEthesaurus rejection rationale** — stated once (§9, R3), not repeated across
  every doc that touches ontology scale.
- **Making marginalia or bedrock-meter no-LLM.** Never proposed, not proposed here. Both keep their
  own LLM usage; tmct's contribution is the deterministic floor with an honest escalation boundary.
- **PLAN_TAUGHT_RELATIONS' full build narrative.** The doc is fully shipped and archived as-is
  (§1.2 covers what's durable); its phase-by-phase session log is historical record, not active
  planning content.
- **marginalia's full actor-lifecycle trust machinery (§2.1)** — the behavioral-signal scoring and
  recontact-scheduling apparatus is scoped for an ecosystem with external agents to track; tmct
  adopts only the narrower per-source reliability idea, not the whole system.
- **Bias weighting silently overriding honest refusal (§4).** Explicitly rejected: bias only breaks
  ties in ranking; a genuine tie in declared bias still refuses and lists candidates, exactly as
  today. Bias is not a license to guess confidently.

## 11. Sequencing

| Phase | What ships | Depends on | Repo(s) |
|---|---|---|---|
| 0 | Foundations (§3): smoke test, envelope.json, extension-pack seam, ace-owl extraction, ontology tracks a–d, grammar tracks a/d/f, debt re-measure, RI wrapper fixes + hub-dampened memory ranking (§2) | Nothing (all build on shipped work) | tmct |
| 1 | Bias-weighted ambiguity resolution & wider seed sets (§4): `tmct.toml` `[bias]` table, wider general-knowledge corpus, context-preserving unknown-word ingestion | Phase 0's extension-pack seam | tmct |
| 2 | tmct as marginalia's interpreter (§5): seon-mcp adapter, Formulate validation, mechanical-chat replacement | Phase 0's extension-pack seam | tmct, marginalia |
| 3 | tmct × seonix combined index (§6): multi-language AST extraction, combined graph/ontology | Phase 0's extension-pack seam | tmct, seonix |
| 4 | marginalia scrape→teach pipeline (§7) | PLAN_TAUGHT_RELATIONS (shipped); Phase 1 for context-preserving ingestion specifically | marginalia |
| 5 | Pluggable LLM rung — Claude Code hardening, Bedrock integration test + assessor, Copilot shim (§8) | Phase 0's envelope.json (Bedrock); nothing new (Claude Code, Copilot) | tmct, bedrock-meter |
| Backlog | Memory-tree versioning, actor-level trust, SHACL ingest gate, Chronograph-style temporal diffing (§2) | None — independent tmct-quality work | tmct |
| R1 | Bounded goal recognition spike, DRT-lite discourse record | Phase 2 (validation target) | tmct |
| R2 | Dependency/categorial grammar idea, cross-repo trust vocabulary | LLM-decision provenance gap (§9) | tmct, marginalia |
| R3 | Open-world planning, Winograd coreference, shared ontology scale — recorded, not scheduled | — | — |

## 12. Provenance

What this doc absorbed from each archived source, and what was cut:

- **`PLAN_AGI_ARCHITECTURE.md`** → §1.2 (five-part architecture verification, kept as one line: four
  of five parts already exist, just not unified), §9's LLM-decision-provenance gap and R3's Cyc/
  WordNet framing. Cut: the full five-part verification table narrative (condensed to §1).
- **`PLAN_CAPABILITY_ROUTER.md`** → §1 (shipped-stage evidence), §8 (Claude Code/Bedrock hardening),
  §9 R1/R3 (bounded goal recognition, open-world boundary). Cut: the "Open questions (for tonight)"
  section (§10); the full open-world-boundary literature review moved to
  `docs/references/research-horizon.md`.
- **`PLAN_TAUGHT_RELATIONS.md`** → §1.2 (the Stage 0/1 prototype insight) only. Archived as-is
  (operator decision) — its 70KB build narrative is historical record, not carried forward.
- **`PLAN_OSS_ACE_PARSER.md`** → §3 (now-unblocked ace-owl extraction). Cut: the "sibling publish
  candidates" section (§10).
- **`PLAN_ontology-hierarchies.md`** → §3 (tracks a–d), §9 R3 (the 2M-word ontology question). Cut:
  the duplicated WordNet-rejection rationale; the full §9 literature review moved to
  `docs/references/research-horizon.md`.
- **`PLAN_ADVANCED_GRAMMAR.md`** → §3 (tracks a/d/f), §9 R2/R3 (dependency grammar, Winograd). Cut:
  the full literature reviews for tracks (c) and (g), moved to `docs/references/research-horizon.md`.
- **Two 2026-07-10 comparative audits of marginalia and seonix** (not archived docs — fresh
  research this session) → §2 in full.
- **The operator's bias-weighting realization** (2026-07-10, mid-session, not from any archived
  doc) → §4 in full, plus the R3 revisit note.
