# PLAN_AGENTS.md — tmct as the shared deterministic agent substrate

*(Drafted 2026-07-10. Status: sequenced build order, not a research plan — most of what it proposes
is known-how, staged by horizon. It absorbed seven sibling design docs, which `8cd3b36` then deleted
once their content had landed here: the ecosystem-integration plan, the AGI architecture, the
capability router, taught relations, the OSS ACE parser, ontology hierarchies, and advanced grammar.
This file is the only live copy of what they held. `git show 8cd3b36^` has the originals.)*

> **STATUS.** Phase 0 is done. Every item in §3 ships and the tree pins it. The one exception is the
> `ace-owl` extraction, which shipped and was reverted the same day; `src/domain/grammar/ace.mjs` is
> the real implementation again and no `packages/` workspace exists.
>
> Phase 1 is partial. The `[bias]` table, bias-weighted ranking and `tmct init --with-persona` ship.
> Two items stay open: the wider general-knowledge seed set is available but opt-in (a fourth tier2
> bundle, `corpus/tier2/general.jsonl`, 49 rows, config-gated off), and context-preserving unknown-word
> ingestion is built and unit-tested but dormant (`captureUnknownContext` defaults false and no
> production call site sets it).
>
> The chat-surface debt re-measure is done, and its transcripts are now machine-checked rather than
> written down. Nine rows carry it in the corpus lanes: three pin behaviour that works, six freeze
> answers that are still wrong. See §3's debt bullet for the row IDs. The measurement is closed; six
> fixes are open.
>
> Phases 2-5 have not started.

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
   relations/rules machinery that shipped 2026-07-09 (§7).
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
It is a competing-but-kindred capability to `PLAN_CODE.md`'s program synthesis (both are "tmct
produces an artifact" categories). Cross-referenced from Phase 4 (§7) and the research
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

Every mount below rests on the capability set in this table, so the table moves when capabilities
move. `SKILL_CAPABILITIES_AUDIT.md` §5 makes refreshing it a step of the audit cycle: the newest
`CAPABILITIES_<version>.md` is the ground truth here, and this table follows it rather than the
other way round. Conclusions only:

| Capability | Status | Evidence |
|---|---|---|
| `POST /v1/messages` HTTP shim (Anthropic-Messages-API-compatible) | **Shipped**, since 0.8.0 | `src/surfaces/http/server-http.mjs`, `bin/tmct.mjs serve` |
| Repository Interface `INTERFACE_VERSION` 1.1.0 (16 services, closed `EDGE_KINDS`/`MISS_REASONS`) | **Shipped**, since 0.5.0; 1.0.0 → 1.1.0 at v1.4.0 (§2.2) | `src/adapters/repository-interface.mjs` (`SERVICES`, 16), `src/adapters/providers/graph-service.mjs`, `runConformance` in `src/tools/conformance.mjs` |
| Tool layer: declared tool surface + `dispatchTool` | **Shipped** — 23 declared tools (`TOOL_DEFINITIONS`), 3 hot (`tmct_context`, `tmct_snippet`, `tmct_ask`) and 20 cold | `src/tools/definitions.mjs` (`HOT_TOOLS`/`COLD_TOOLS`), `dispatchTool` + `TOOLS` in `src/tools/server.mjs`, catalog rendered by `src/tools/catalog.mjs`; contract tests in `test/tools/`. The router's registry excludes the three hot tools, see `EXCLUDED_FROM_REGISTRY`; `tmct_related` (2.6.0) is dispatched but sits in neither the registry nor the exclusion list yet — `BENCHMARK_AGENT_2.6.0.md` backlog 5 |
| Capability router (STRIPS/PDDL registry, resolver, planner, taught actions, goal-reasoner) | **Shipped** and **invokable**. A request escalates through four stages over the registry's operator model: resolver → planner → taught-action plan → goal-reasoner | `src/domain/router/*` — `registry.mjs` (15 capabilities via `capabilities()`) is the operator model; `drive.mjs` is the shell that runs the four stages; `call-validator.mjs`/`set-algebra.mjs`/`results.mjs` are shared support. Measured on AGENTBENCH; `tmct plan`/chat's `/plan`/`./plan` library export — see §1.3 |
| AGENTBENCH goal-reasoner (the top routing rung) | **Shipped and measured** | 66 cases on the reformed TOOL-0…TOOL-8 ladder: 100% plan / 100% result / 0% hallucination through TOOL-6, gated at TOOL-7 (recovery — no replanning branch yet), 62/66 overall (`BENCHMARK_AGENT_2.6.0.md`) |
| seonix code→graph, driven by tmct | **Shipped, in production**, seonix 0.8.0→0.10.6 | `seonix/src/tmct-provider.mjs` — 37 lines, `createGraphService` reused directly |
| bedrock-meter cost-ordered router with a tmct rank-0 ($0) rung | **Shipped and tested** | `router.mjs`/`router-ladder.mjs`/`routing-target.mjs`, 11 passing tests |
| marginalia's `seon-mcp` self-hosted code graph | Built, **not yet wired to tmct** | near-zero-gap integration, same pattern as seonix (§1.1 below) |
| marginalia's "mechanical chat" replaced by tmct | **Not started** — the real open work | `app/lib/mechanical/`, 1,043 LOC, dark-flagged sub-path today |
| marginalia LLM-decided facts (`typed-edges.mjs`) trust-tagged like tmct's own facts | **Not started** | confidence computed then discarded before persistence — the actual gap |
| Chat-taught relations, rules, backward-chaining query dispatch | **Shipped**, 2026-07-09 | Rule storage (compose2/filter/recursive kinds) + `resolveRelationChase` — see §1.2 |
| Bias-weighted ambiguity resolution across seed sets | **Shipped**, v1.4.0 | `src/domain/memory/bias.mjs`, `tmct.toml` `[bias]` table, `tmct init --with-persona` — see §4 |
| Memory-tree versioning + full actor-level trust | **Shipped**, v1.4.0 | `snapshotMemory()` (manual trigger); session-scoped Source IDs, unconditional — see §2.1 |
| RI wrapper fixes + hub-dampened memory ranking (the (a)-tier uplift) | **Shipped**, v1.4.0 | `INTERFACE_VERSION` 1.1.0; `src/adapters/memory/blocks.mjs` dampening on by default — see §2 |
| Extension-pack seam | **Shipped**, v1.4.0 | `src/services/extensions.mjs`, `[extensions]`/`[bias]` in `tmct.toml`, `tmct extend --validate` — see §3 |

### 1.1 Foundational precedent: seonix proves the integration pattern

seonix's cutover (already done) is the
template for every other mount in this doc. `seonix chat`, the `seonix_ask` API, and the website
"Ask the graph" panel all now call tmct; every typed, structural MCP tool (`seonix_describe`,
`seonix_snippet`, `seonix_members`, `seonix_impact`, `seonix_search`, `seonix_context`) stayed
native. The pattern that generalizes: **NL-to-tool-selection routes through tmct; fast, typed,
already-well-shaped tool calls stay native to the host.** tmct's job was never to reimplement
`seonix_impact`'s reverse-closure computation — it was to decide, from natural language, that
impact is what's being asked for and bind the right module. marginalia's `seon-mcp` (§1.1 of the
old ecosystem plan) is a near-1:1 vocabulary match with tmct's own `EDGE_KINDS` for the same
reason — proven twice now, low-risk, staged first (§11).

### 1.2 Foundational precedent: chat-taught relations are a working registry/resolver prototype

The chat-taught relations system just shipped (Rule storage in `src/adapters/memory/core.mjs`, the
backward-chaining query dispatcher `resolveRelationChase`, the bounded successor-function search
`findActionPath`) is structurally the same shape as the capability router's registry (the capability
ontology) and resolver (unification + backward chaining over
capabilities-as-facts), just scoped to family relations instead of tool capabilities. Declare a
named thing with structure (base relation, a property filter, a recursive step ↔ preconditions,
effects, decomposition), then chase a query against taught facts to find what satisfies it — the
same "STRIPS/PDDL operator model" the router doc cites. Generalizing from "person A fathers person
B" to "tool X, given args, produces effect Y" is a real step, but a smaller one than starting from
nothing. Worth remembering when scoping Phase 2's slot-filling work (§5).

### 1.3 How another repo or agent calls the capability router

The router (§1's table) was real and tested since it shipped, but until now nothing outside
`agentbench/` or the test suite could actually call it — an audit finding, closed this cycle. Three
invocation surfaces exist now, all wrapping the same `src/domain/router/drive.mjs`:

- **A human typing in a terminal**: `tmct plan "<request>"` (see `bin/tmct.mjs`'s own `--help`) or
  chat's `/plan <request>` slash command. Not the shape another repo/agent uses — covered here only
  so the three surfaces are listed together.
- **Another repo in this arc, as a library**: `@polycode-projects/the-mechanical-code-talker/plan`
  exports `buildCapabilityPlanCtx({config})` (loads a repo's `.tmct/graph.json` into a
  `{dispatch, resolve, graph}` context — the same context `agentbench/run.mjs`'s own driver
  harness builds) and `runCapabilityPlan(request, tools, ctx)` (runs a request through the
  resolver → planner → goal-reasoner cascade, returning a `{calls, refused, composed, proof, why}`
  loop result — grounded, or an honest refuse, never a guess). This is the shape seonix's
  `tmct-provider.mjs` and bedrock-meter's `routing-target.mjs` already use for other tmct entry
  points (`createGraphService`, the routing ladder) — a thin adapter importing one named export,
  not a new integration pattern.
- **A tool-loop client speaking the Messages API** (Claude Code, Bedrock, the future Copilot shim
  of §8): `tmct serve`'s `/v1/messages` endpoint already dispatches the registry's individual
  capabilities one at a time as `tool_use` calls; a client that wants the ROUTER's own multi-step
  planning (rather than choosing each call itself) calls `runCapabilityPlan` directly via the
  library surface above inside its own agent loop, the same way it would call any other tmct
  function — `tmct serve` itself does not (yet) expose a "plan this whole request" HTTP verb.

## 2. tmct uplift — what marginalia and seonix already do better

Two deep, code-grounded comparative audits (2026-07-10) surveyed both sibling repos for mechanisms
tmct lacks or has a cruder version of, deliberately separate from the vocabulary/integration gaps
§1 and §5-§8 already cover. Findings are risk-graded — (a) mechanical/low-risk, (b) real but
bounded, (c) genuinely harder — and feed §2.3 below.

### 2.1 From marginalia

- **Memory-tree versioning (b) — ✅ shipped v1.4.0.** `app/lib/s3-tree.mjs` writes immutable,
  monotonically-versioned snapshots with a tiny manifest pointer to the current version; tmct's
  `.tmct/memory/graph.json` used to overwrite in place. Shipped as `snapshotMemory(dir)` in
  `src/adapters/memory/core.mjs` — `graph.v{N}.json` + `manifest.json`, `[memory] retention_versions` in
  `tmct.toml` (default 5).
- **Actor-level, behavior-driven trust (b) — ✅ shipped v1.4.0, further than originally scoped.**
  `app/lib/trust.mjs` tracks a persistent, evolving per-actor score from behavioral signals; tmct's
  `SOURCE_PRIOR` was fact-level/source-type-level only. Shipped: session-scoped Source IDs for
  `operator`/`teach` facts (`src:operator-chat:<sessionId>` / `src:teach-chat:<sessionId>`,
  parsed from provenance tags that already carried the session ID but discarded it) plus a bounded
  `mgx:sourceReliability` nudge (`[0.5, 1.5]`, computed from a session's corroborated-vs-contradicted
  fact ratio via Laplace/add-k confidence scaling — a literal saturating formula broke an existing
  trust invariant, caught and fixed during the build). Shipped **unconditionally, no config flag** —
  an explicit operator decision (single consumer, no backward-compat need with an existing graph) —
  not the narrower "layer a score onto existing Source individuals" port originally scoped here.
  marginalia's full actor-lifecycle machinery (recontact scheduling, guardrail-fire-rate) still
  does not transfer — no external agents to recontact in tmct's world.
- **Gazetteer-based entity/predicate recognition (b).** `app/lib/mechanical/matcher.mjs` builds a
  wink-nlp gazetteer straight from the graph's own entity labels/aliases plus lemma/stem-tolerant
  verb-phrase tables, so new vocabulary flows through with zero new grammar code. tmct's ACE grammar
  (`src/domain/grammar/ace.mjs`) is deliberately strict. Not a replacement: a more
  tolerant recall path feeding the strict grammar as an additional front end, not instead of it.
- **Declarative SHACL ingest gate (c) — ✅ shipped 2026-07-10.** Every marginalia memory node is
  validated against a shape contract (`app/ontology/shapes.ttl`, via `shacl-engine`) before it enters
  the shared tree — a standards-based, declarative write-boundary contract. 
- **Hub-dampening + thin-concept detection (a) — ✅ shipped v1.4.0, on by default.** tmct already
  implements exactly this pattern in `src/domain/codegraph.mjs` (degree-quantile hub gating, min-heap
  frontier expansion) — for the **code** graph only. Ported into `src/adapters/memory/blocks.mjs`'s
  `retrieveBlocks` (`/ √(1 + degree)`, degree surfaced from the block-similarity graph's already-
  computed but previously-discarded adjacency). Shipped on unconditionally, per operator decision —
  the build found the original "modest degree, modest penalty" assumption was mathematically wrong
  (a nonzero-degree block can never out-rank a genuinely isolated one on a tie, bounded below √2)
  and redesigned the test corpus around the real math rather than a contrived fixture that happened
  to pass.
- **Contradiction detection — checked explicitly, tmct is ahead here.** marginalia's `mg:contradicts`
  is only ever LLM-proposed at ingest or materialised via symmetric closure — no algorithm actually
  detects disagreement. tmct's `findContradictions` (`src/adapters/memory/core.mjs`) is fully automatic and
  deterministic: any two facts sharing (subject, predicate) with a different object, both above a
  trust floor, surface as an explicit unresolved pair on every `/memory` render. Not a finding to
  adopt — confirmation that tmct's own mechanism is more reliable than marginalia's here.

### 2.2 From seonix

Structural note that reframes all of these: seonix depends on tmct as a package
(`seonix/src/tmct-provider.mjs` imports `createGraphService` directly), and seonix's own
`src/domain/codegraph.mjs` is a near-verbatim fork of tmct's `src/domain/codegraph.mjs` (2109 vs 2123 lines, diffs
are naming/gated-feature only). Most findings below are gaps in what tmct's Repository Interface
**wrapper** (`repository-interface.mjs` + `providers/graph-service.mjs`) exposes, not gaps in
algorithmic capability tmct would have to invent — the logic already sits in tmct's own
`codegraph.mjs`, just not wired to the provider surface.

- **Search/context are stubs relative to logic tmct already owns (a) — ✅ shipped v1.4.0.**
  `graph-service.mjs`'s `search()` was an unranked substring filter with no limit/pagination;
  `context()` unconditionally missed. Now: `search()` calls the same IDF-weighted `scoreModules`/
  `searchModulesRanked` and a newly-extracted structured `scoreSymbolsRanked` (split out of
  `searchSymbols`, which used to fuse scoring and text-rendering); `context()` returns a real
  graph-only hit (siblings/registration/tests/exports/insertion-region) even without source access,
  via `contextPlan`/`sizeBundle` — a deliberate, documented interface contract change, so
  `INTERFACE_VERSION` bumped `1.0.0 → 1.1.0`.
- **Depth-capped impact + source-backed snippets (a) — ✅ shipped v1.4.0.** `impact(moduleId,
  {maxDepth})` now threads through to `impactClosure`'s existing `maxDepth` support. `snippet()`/
  `context()` are source-capable via an injected `{repoRoot, readFile}` on `createGraphService`
  (keeping the module's "pure graph queries, no fs" contract honest — fs access is an explicit,
  injected capability, not an ambient one). Building this surfaced and fixed a real, previously
  unguarded path-traversal gap in `server.mjs`'s inline readers (`src/adapters/source-slice.mjs`'s
  `readSpanSafe`, now the shared, guarded implementation both `server.mjs` and `graph-service.mjs`
  use) — found by the strategy-advisor background agent watching the build, not by the original
  brief.
- **Unbounded search/edges responses (a for the cap, b for cost telemetry) — ✅ shipped v1.4.0,
  telemetry wiring built but not yet live in production traffic.** `edges()`/`search()` now accept
  `{limit, offset}`. `src/services/telemetry.mjs` now wraps every `graph-service.mjs` service once at
  construction (optional `tel`, zero overhead when absent) and redacts `snippet()`'s `body` field
  (a real, if previously unreachable, log-leak fix). Caveat worth recording: `server.mjs`'s
  `dispatchTool` branches were deliberately NOT consolidated onto the wrapped `svc.*()` methods (the
  RI's result shapes lack the richer presentation `dispatchTool` needs — candidates, call hints,
  truncation notices — and consolidating risked real regressions for low benefit), so this
  telemetry is real, tested infrastructure, currently exercised only by direct RI callers/tests, not
  by the live chat tool-dispatch path.
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
- **Visualizers (b, optional) — ◐ shipped, then reshaped.** `tmct viz` now renders the ledger
  explorer (`src/services/ledger-viz.mjs`), one self-contained HTML page, with the memory-ask
  browser bundle carrying the embedded "Ask the graph" panel. The earlier node-link memory-graph
  page is retired: `src/viz.mjs` is gone and `bin/tmct.mjs` prints a named error for the flags that
  belonged to it. `tmct plan --prompt` renders plans separately (`src/services/plan-viz.mjs`).
  seonix's standalone Cytoscape ego-neighborhood viewer stays a different shape, and tmct still has
  no code-graph viz mode and no multi-repo incremental re-index (`manifest.mjs`, git-SHA +
  dirty-worktree fingerprinting). Those matter if tmct's own use case grows multi-repo.

### 2.3 What this changes in the phase sequence

**Update, v1.4.0 (2026-07-11): all of the (a)-tier findings shipped, and so did memory versioning
and actor-level trust — further and faster than this section originally staged.** The (a)-tier
findings — hub-dampened memory ranking, RI search/context/impact/snippet wiring, response
pagination — landed as Phase 0 foundations, genuinely low-risk, no new dependency, mostly exposing
logic tmct already owned. Memory versioning and actor-level trust (originally "standing tmct-quality
backlog, not yet phase-assigned") were pulled forward and shipped in the same batch, actor-level
trust in full rather than the narrower port originally scoped. **Update, 2026-07-10: the SHACL
ingest gate also shipped** (§2.1's bullet, above) — all four of this backlog's original items are
now closed except Chronograph-style temporal diffing.

## 3. Phase 0 — Foundations

Near-term, mostly known-how, individually small. No item here requires research.

- ✅ **Cross-repo smoke test — shipped.** `e2e/server-http.test.mjs` spins the real `tmct serve`
  node:http server on an ephemeral port and drives a full request → `tool_use` → `tool_result` →
  `end_turn` loop over `fetch`, with bedrock-meter's `httpDispatch`/`extractUsage` logic mimicked
  inline (no bedrock-meter dependency added). It asserts the block shapes, `stop_reason`, $0 usage
  and malformed-JSON 400 against a real process rather than hand-built fixture objects.
- ✅ **Machine-readable capability envelope — shipped 2026-07-10.** `agentbench/envelope.json` +
  `agentbench/generate-envelope.mjs`, generated from the latest gate-PASS AGENTBENCH goal-driver
  ladder run (`rungReached`/`structuredOk`/`toolsOk` derived from the real hallucination-taxonomy
  checks, not hand-set; `maxContextTokens` deliberately left `null` rather than fabricated, since
  AGENTBENCH does no token accounting).
- ✅ **The extension-pack / corpus-lexicon loading seam — shipped v1.4.0.** `src/services/extensions.mjs`:
  `resolveExtensions()`, an `[extensions]`/`[bias]` table in `tmct.toml`, `seedActiveCorpusEntries`
  replacing `chat.mjs`'s hardcoded two-call corpus bootstrap (this also fixed a real, deliberate bug
  — `tmct init` previously seeded ConceptNet only, never SEON), `mergedLexiconExtra`/
  `loadTemplatesMerged` for lexicon/template bundles, and `tmct extend --validate <dir>` for
  third-party pack validation. Namespacing/provenance verified end-to-end: a conflicting fact from
  two active bundles surfaces via the already-shipped `findContradictions`, never a silent overwrite.
  The three shipped-but-inactive tier2 bundles (aws/python/java corpora) are now genuinely
  activatable, not just committed-and-dead. This is also the config surface §4's bias weighting
  hangs off of, also shipped — see §4.
- ⛔ **`ace-owl` open-source extraction — shipped 2026-07-10, reverted the same day.** Extracted into
  `packages/ace-owl/` (a standalone `@polycode-projects/ace-owl` MPL-2.0 workspace package) with
  tmct's own `src/domain/grammar/ace.mjs`/`lexicon.mjs` left as thin re-export shims. The extraction
  commit itself noted `npm publish` was never run (operator-gated) — but shipped the registry
  dependency anyway, so `npm install` of tmct broke for everyone outside this workspace (a 404 on
  `@polycode-projects/ace-owl`, unpublished). Found and reverted the same day on operator
  instruction: `ace.mjs`/`lexicon.mjs`/`lexicon-core.json` are back in `src/domain/grammar/` as the real
  implementation (not shims), the workspace and dependency are gone. The lesson for any retry: a
  registry dependency cannot ship before the package it names is published.
- ✅ **Ontology-hierarchies tracks a–d — shipped.** Tracks (a) synonym/similarTo activation and (b)
  the phrasebook-synonym wiring were found already shipped from an earlier session; this session
  added a precision follow-up (`SYNONYM_DENYLIST` in `chat.mjs`, closing 9 confirmed-bad
  cross-domain synonym pairs a live spot-check found, e.g. `interpreter`~`compiler`). Tracks (c)
  hand-curated SEON upper-ontology spine (47 new rows: artifact/agent/event/quality/quantity roots
  + part-whole) and (d) `owl:disjointWith` growth (72 new rows, 42→114 total) shipped 2026-07-10.
- ✅ **Advanced-grammar tracks a/d/f — shipped.** Track (a) subordination/conditional frames
  (`SUBORDINATION_FRAMES_RE`/`CONDITIONAL_QUALIFIER_RE` in `src/domain/interpret/normalize.mjs`) found already
  shipped from an earlier session. Track (d) construction-grammar template bank shipped 2026-07-10:
  `data/templates/constructions/agent-noun-relations.toml` + `src/domain/interpret/strategies/
  constructions.mjs`, three new closed templates (T11-T13: "X of Y", "Y's X", "Y X" relation
  phrasings). Track (f) presupposition-as-honest-nudge (`presuppositionNudge`, `src/services/chat.mjs`) also
  found already shipped from an earlier session, not newly built this session.
- ✅ **Re-measure inherited chat-surface debt — done, and now machine-checked.** The capability
  router doc named three gaps (pronoun/focus binding, discourse-count anaphora,
  temporal-over-relative composition) as blocking its later stages. The re-measure ran them as real
  multi-turn conversations, and its transcripts no longer live in prose or in a standalone suite.
  They are nine keyed rows in the corpus lanes, driven through the real session on every `npm test`.
  Five pin behaviour that works:

  | Row | What it pins |
  |---|---|
  | `games/discourse-count-relation-filter` | "how many of those also import Y" counts the prior set |
  | `games/discourse-count-qualifier-filter` | "how many of those are tested" counts the prior set |
  | `games/single-turn-temporal-filter-dated-answers` | single-turn temporal filtering gives dated answers |
  | `games/yesno-call-check-reads-callssymbol-edge` | "does it call X" binds the pronoun and the yes/no check reads the symbol-grain sibling |
  | `games/bare-passive-reads-the-patient` | bare passive with no by-agent clause ("was X touched") reads X as the patient |

  The last two froze wrong answers until `98df45a` fixed the passive branch and the yes/no eval. Both
  rows were renamed to record the behaviour they now pin.

  Four freeze an answer that is still wrong, so a fix has to flip the row deliberately:

  | Row | The bug it freezes |
  |---|---|
  | `games/bare-type-discourse-filter-unbuilt` | a bare entity-type follow-up ("which of them are functions") does not compile |
  | `games/cross-turn-temporal-composition-unbuilt` | "was that before X was touched" is not composed across turns |
  | `games/honest-empty-echoes-raw-pronoun` | the honest-empty template echoes the literal word "it" |
  | `games/temporal-adverb-read-as-object-term` | "was it touched recently" reads "recently" as the object term |

  `src/domain/ask.mjs`'s `KIND_UNIONS` still defines a union for `uses` only, never for bare `calls`.
  No frozen row rests on that now, and the yes/no row passes without it.

  The measurement is closed. Four fixes are open, each named by its row.
- ✅ **RI wrapper fixes from the seonix audit (§2.2) — shipped v1.4.0.** Ranked search, real
  `context()` bundling (`INTERFACE_VERSION` 1.1.0), depth-capped `impact()`, source-backed
  `snippet()`, response pagination on `search()`/`edges()`. Also closed a real path-traversal gap
  found during the build (`src/adapters/source-slice.mjs`).
- ✅ **Hub-dampened memory-fact ranking, from the marginalia audit (§2.1) — shipped v1.4.0, on by
  default.** Ported the degree-based hub dampening tmct's own `codegraph.mjs` already implements for
  the code graph into `memory/blocks.mjs`'s `retrieveBlocks`.
- ✅ **Benchmark/skill doc unification** — shipped 2026-07-10 (this restructuring itself, §12).

## 4. Phase 1 — Bias-weighted ambiguity resolution & wider general-knowledge seed sets

The realization driving this phase, in the operator's own framing: tmct's own code-domain
specialization was never a special case — it is one particular seed set with an implicit bias. The
mechanism that makes tmct "the code talker" generalizes to any seed set, including a future one
that isn't code at all.

- ✅ **The default stays honest ambiguity over guessing — confirmed, unchanged.** §2.2 already
  confirmed this is the right posture — tmct's resolver refuses and lists candidates on a genuine
  tie, and seonix's own conversational path delegates to tmct's resolver for exactly this reason.
- ✅ **`tmct.toml` `[bias]` table — shipped v1.4.0.** `src/domain/memory/bias.mjs` (`biasForSourceId`,
  `biasForRow`, `rankByBiasThenTrust`), wired into `chat.mjs`'s fact-listing lanes (`factAnswer`,
  `factReadBack`'s listing branches, `describedFacts`, plus the count/quantifier-recall single-winner
  sites). Verified by control-flow tracing, not just code review: `rankByBiasThenTrust` is a pure
  map→sort chain with no `filter()` — structurally cannot drop a fact, only reorder it. The
  lower-biased sense stays reachable and disclosed, never silently dropped. A tied/absent bias is
  byte-identical to pre-bias behavior (regression-tested).
- **This is the missing piece the WordNet-rejection rationale didn't have** (§3's ontology-hierarchies
  bullet; R3's 2M-word-ontology entry, §9).
  That rationale rejected wide general vocabulary because it reintroduces word-sense noise a narrow,
  curated corpus was built to avoid. Bias weighting doesn't eliminate that noise — it gives tmct a
  declared, inspectable way to rank through it instead of needing to avoid it by staying narrow. Next
  time R3's 2M-word-ontology assessment is revisited, this changes what it should weigh — not a green
  light to build it, but a genuine change in the calculus.
- ◐ **A wider general-knowledge seed set — available, still opt-in.** The three tier2 bundles
  (`corpus/tier2/aws.jsonl`, `python.jsonl`, `java.jsonl`) are activatable end-to-end through the
  extension-pack seam (§3). A fourth, `corpus/tier2/general.jsonl`, carries 49 curated
  everyday-knowledge facts (animals, weather, natural world, common objects) with no code-domain
  framing, under the same checksum and provenance discipline as the other three. This grows the
  available seed content. All four stay config-gated off, so the default corpus is unchanged.
- ◐ **Context-preserving ingestion for unknown words — built, unit-tested, dormant.**
  `src/adapters/corpus/unknown-ingest.mjs` turns a term that only ever appears in a row `toFacts()`
  drops into a real Fact tagged with the passage it came from. `seedMemory` in
  `src/adapters/corpus/conceptnet.mjs` calls it behind `captureUnknownContext`, which defaults false.
  Only `test/adapters/corpus-unknown-ingest.test.mjs` ever sets it true, so no production path
  activates it.
  The code works; nothing reaches it.
- ✅ **Config surface, concretely — shipped v1.4.0.** Each named extension/seed set gets an optional
  `bias` weight in `tmct.toml`'s `[bias]` table (a flat bundle-name → weight table, not nested under
  `[extensions.*]` — a deliberate simplification versus this doc's own illustrative sketch).
- ✅ **CLI ergonomics: `tmct init --with-persona <name>` — shipped v1.4.0.** `PERSONA_PRESETS.code`
  (today's implicit default, made explicit: empty extension overrides, `bias: {seon: 1.0, conceptnet:
  1.0}`). Zero-flag `tmct init` output stays byte-identical (persona sections only appear when
  requested). Unknown persona name → loud stderr error + non-zero exit, mirroring `--corpus`'s
  existing error style.

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
  a SPARQL-backed implementation of the 16 Repository Interface services, comparable in size to
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
- **RI wrapper fixes — already shipped (§3), worth re-verifying against the combined graph
  specifically once it exists.** Depth-capped impact, source-backed snippets, and pagination all
  landed in Phase 0/v1.4.0.
- **tmct becomes the NL surface over the combined index** — the same escalation discipline as
  everywhere else in this doc: answer what's provably in the combined graph/ontology, decline
  honestly outside it, never guess.

## 7. Phase 4 — marginalia web-scrape → tmct learning pipeline

- **A scraping tool** (a BeautifulSoup-equivalent, or a Node/JS HTML-extraction library) that turns
  a web `GET` into clean prose blocks.
- **Feed scraped prose into tmct's existing explicit-teaching surface** — the chat-taught
  relations/rules mechanism (§1.2), and typed-edge extraction's
  explicit-teaching half (marginalia's own capability audit already found "X is the Y of Z"-style
  explicit teaching moves cleanly to tmct + effort). This phase wires a new ingestion source to
  capability tmct already has.
- **Also a natural Stage-1 input source for the mechanical text-generation
  pipeline** once that track is scoped — scraped web content is exactly the kind of broad-search
  material that pipeline's grouping/inference/summarization stages consume.

## 8. Phase 5 — tmct as a pluggable LLM rung

Three targets, each a protocol-adapter problem, not a research problem. MCP is the dominant 2026
tool-integration standard (spec 2025-11-25, donated to the Linux Foundation's Agentic AI Foundation
in December 2025, near-universal adoption across Anthropic/OpenAI/Google/Microsoft) — worth keeping
in view for how these shims are shaped, even though tmct's existing shim speaks the Messages API
directly rather than MCP.

- **Claude Code** — already solved. The `/v1/messages` shim, tool dispatch, and capability router
  have shipped since 0.8.0. This phase validates real Claude Code tool_use proposals against
  declared capabilities, not just AGENTBENCH's synthetic cases. `call-validator.mjs`'s
  `hallucinationsIn` is the check; what's missing is a seam that feeds it an externally-proposed
  call. Today the router resolves every call itself, so nothing proposes one.
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
  kin to the mechanical text-generation pipeline's inference between retrieved-text groups — both
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
  ambiguity, and none is expected to.
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

- **Sibling publish candidates from the ACE-parser work** (a bounded-Damerau fuzzy matcher, a
  PageRank+IDF block ranker) — both have permissive JS alternatives already, unlike ACE. Not a phase
  here. (The block ranker specifically is un-pruned and re-scoped inside the mechanical
  text-generation track, where it has a real job.)
- **Duplicate WordNet/SEthesaurus rejection rationale** — stated once (§9, R3), not repeated across
  every doc that touches ontology scale.
- **The taught-relations build narrative.** The work shipped and §1.2 covers what's durable. Its
  phase-by-phase session log was a historical record rather than active planning content, so it went
  with the doc.
- **marginalia's full actor-lifecycle trust machinery (§2.1)** — the behavioral-signal scoring and
  recontact-scheduling apparatus is scoped for an ecosystem with external agents to track; tmct
  adopts only the narrower per-source reliability idea, not the whole system.
- **Bias weighting silently overriding honest refusal (§4).** Explicitly rejected: bias only breaks
  ties in ranking; a genuine tie in declared bias still refuses and lists candidates, exactly as
  today. Bias is not a license to guess confidently.

## 11. Sequencing

| Phase | What ships | Status | Depends on | Repo(s) |
|---|---|---|---|---|
| 0 | Foundations (§3): smoke test, envelope.json, extension-pack seam, ace-owl extraction, ontology tracks a–d, grammar tracks a/d/f, debt re-measure, RI wrapper fixes + hub-dampened memory ranking (§2) | **Done.** Every item ships and the tree pins it. The ace-owl extraction shipped and was reverted the same day, so it is not tracked as done. The debt re-measure is closed and its nine rows run on every `npm test`; six of them freeze bugs that are still open. | Nothing (all build on shipped work) | tmct |
| 1 | Bias-weighted ambiguity resolution & wider seed sets (§4): `tmct.toml` `[bias]` table, wider general-knowledge corpus, context-preserving unknown-word ingestion | **Partial.** `[bias]` table, ranking and `--with-persona` ship. The wider seed set is available and opt-in (four tier2 bundles, all config-gated off). Context-preserving ingestion is built and unit-tested but dormant: `captureUnknownContext` defaults false and only tests set it. | Phase 0's extension-pack seam | tmct |
| 2 | tmct as marginalia's interpreter (§5): seon-mcp adapter, Formulate validation, mechanical-chat replacement | Not started | Phase 0's extension-pack seam | tmct, marginalia |
| 3 | tmct × seonix combined index (§6): mount seonix's (multi-language) graph, re-verify RI depth at scale | Not started | Phase 0's extension-pack seam | tmct, seonix |
| 4 | marginalia scrape→teach pipeline (§7) | Not started | Chat-taught relations (shipped, §1.2); Phase 1 for context-preserving ingestion specifically | marginalia |
| 5 | Pluggable LLM rung — Claude Code hardening, Bedrock integration test + assessor, Copilot shim (§8) | Not started | Phase 0's envelope.json (Bedrock); nothing new (Claude Code, Copilot) | tmct, bedrock-meter |
| Backlog | Chronograph-style temporal diffing (§2) — memory versioning + actor-level trust shipped v1.4.0, SHACL ingest gate shipped 2026-07-10, no longer backlog | Partial — 3 of 4 original items shipped | None — independent tmct-quality work | tmct |
| R1 | Bounded goal recognition spike, DRT-lite discourse record | Not started | Phase 2 (validation target) | tmct |
| R2 | Dependency/categorial grammar idea, cross-repo trust vocabulary | Not started | LLM-decision provenance gap (§9) | tmct, marginalia |
| R3 | Open-world planning, Winograd coreference, shared ontology scale — recorded, not scheduled | Not started, not scheduled | — | — |

## 12. v1.4.0 build record (2026-07-11)

The (a)-tier uplift items from §2, plus Phase 0's extension-pack seam and Phase 1's bias-weighted
ranking, were built as four parallel, worktree-isolated background tracks, merged sequentially into
`main`, watched throughout by a background strategy-advisor agent (`SKILL_AGENT_STRATEGY_ADVISOR.md`,
full tick-by-tick record in `STRATEGY_ADVISOR.log`). 1543/1543 tests green at the final merge.

- **Track A — security fix + Repository Interface wrapper + telemetry.** 7 commits. Closed a real,
  previously unguarded path-traversal gap in `server.mjs`'s inline file readers (extracted into
  `src/adapters/source-slice.mjs`). Wired real ranking/pagination/depth into `search()`/`edges()`/`impact()`;
  made `context()` a graph-only hit even without source access (`INTERFACE_VERSION` → 1.1.0, a
  deliberate, documented interface change); wired telemetry (redacts `snippet()` bodies; wraps every
  RI service once at construction, currently exercised only by direct callers/tests, not the live
  `dispatchTool` path — a deliberate scope cut, not an oversight, see §2.2).
- **Track B — hub-dampened block ranking.** 1 commit. Shipped on by default. Found the original
  "modest degree, modest penalty" assumption was mathematically wrong (proved analytically and
  numerically: a nonzero-degree block can never out-rank a genuinely isolated one on a tie, bounded
  below √2) and redesigned the test corpus around the real math.
- **Track C — memory versioning + actor-level trust.** 5 commits. `snapshotMemory()` (manual
  trigger only). Session-scoped Source IDs for operator/teach facts, shipped unconditionally (no
  config flag — operator decision, single consumer). Caught and fixed two regressions the literal
  brief would have introduced: a saturating trust-reliability formula (redesigned with Laplace/add-k
  confidence scaling) and a Fact/Rule staleness bug in the trust-refresh step.
- **Track D — extension-pack seam + bias-weighted ranking + persona init.** 7 commits. Needed one
  resume cycle: two parts (`tmct extend --validate`, `tmct init --with-persona`) were left
  uncommitted/unbuilt at the track's first "done" report, caught by the coordinator's merge-time
  verification, finished on request.
- **One real merge conflict**, in `src/services/chat.mjs`: Track A threaded a `tel` param through
  `runAsk`/`runCommand`/`runTurn`'s signatures at the same time Track D threaded a `biasByBundle`
  param through the same functions. Resolved by keeping both in every signature/ctx object/call site
  — verified end-to-end, not just merged and trusted.
- **One bug found by the strategy advisor, not the original brief, fixed during merge**: `src/
  source-slice.mjs`'s path-traversal guard failed closed incorrectly (rejecting *legitimate* reads,
  not just traversal attempts) when `TMCT_GRAPH_FILE` was a relative path, because nothing resolved
  it to absolute before the containment check. Fixed at the source (`src/adapters/config.mjs`) and
  defensively in the guard itself, with regression tests for both.

Version: `1.3.2 → 1.4.0` (minor — real feature work). Full commit range: `0c31d79..b1b6a95`.
