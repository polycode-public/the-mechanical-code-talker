# PLAN_REPO_INDEX.md — tmct grows its own code parsers, ported from seonix

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-12 session. The operator's framing, verbatim:

> port over the repository indexing code from ../seonix. This will violate a few places where we
> have docs that say we are not a code indexer, but I think we need to be a code indexer because the
> graph is coupled to the ontology in tmct so the code part of the ontology should be here and with
> it the parsing tools, seonix ontology linkage schema, and query tools and we need to be able to
> query the code in the chat when a suitable persona is initialised. We'll plan the work to extract
> what we need from ../seonix, then later re-integrate ../seonix to use the rich tmct library but
> still have all it's code benchmarking and the exposure of a tool surface to LLMs, we'll also move
> PLAN_CODE.md into ../seonix as part of the execution of PLAN_REPO_INDEX.md because that seems a
> better fit as a tool.

## The honest baseline, before anything else

The framing above reads as a four-part port: parsing tools, ontology linkage, query tools, and a
later re-integration of seonix as a tmct consumer. Tracing the real code in both repos shows three
of those four are already done. tmct already ships a versioned, OWL-grounded query and interface
layer (`src/domain/ask.mjs`, `src/domain/codegraph.mjs`, `src/adapters/repository-interface.mjs`), its own ontology already
aligns to seonix's code-entity vocabulary term-for-term (`ontology/tmct-core.ttl`), and seonix
already depends on tmct as a library and routes its own chat surface through tmct's (confirmed live
in seonix's `package.json` and `src/chat-shim.mjs`). The one piece that is genuinely, completely
absent from tmct is **parsing** — reading `.py`/`.js`/`.cs`/`.java` source off disk and turning it
into graph entities. Every code graph tmct has ever operated on was produced by something else. This
document's real scope is narrower than "port the repository indexing code" suggests: port the five
language extractors and their orchestration, wire them into a producer function that already exists
in tmct and already has zero real callers, and reconcile the docs that predate this change.

## Part 1 — what tmct already has (the query/consumer side)

Confirmed by direct read of this repo, not assumed:

- **`src/domain/ask.mjs`** (4,694 lines) — a mechanical, zero-model-call natural-language query engine over
  an already-loaded graph. Its own header (`ask.mjs:1-15`) states it compiles free text into a graph
  traversal. It answers "which modules import X" / "what calls Y" style questions today, using an
  OWL/SEON-shaped predicate vocabulary (`src/domain/ask-vocab.mjs`'s `RELATIONS` table: `imports`, `calls`,
  `defines`, `contains`, `inherits`, `tests`, `touches`, each with real verb synonyms). It is browser-
  bundled: `scripts/build-ask-bundle.mjs` esbuild-bundles a narrow entry point
  (`src/ask-browser-entry.mjs`) into `src/ask-browser.bundle.js`, which `src/viz.mjs` inlines into
  `tmct viz`'s "Ask the graph" panel.
- **`src/domain/codegraph.mjs`** (2,405 lines) — `parseEntities(payload)` (`codegraph.mjs:31-63`) takes an
  **already-built** JS object and reshapes it; its own doc comment calls it "pure (no-network, no-fs)
  query logic over the typed `entities` payload that the deterministic indexer writes to
  `<repo>/.tmct/graph.json`." `spiralExpand` is a pure in-memory graph walk. Neither touches a
  source file.
- **`src/adapters/repository-interface.mjs`** (332 lines) — a versioned (`INTERFACE_VERSION = "1.1.0"`,
  line 21) typed contract: 17 named services across six groups (resolution, traversal, source,
  aggregate, temporal, search), a closed `MISS_REASONS` set (`UNRESOLVED_TERM`, `CAPABILITY_ABSENT`,
  `TRUNCATED_GRAPH`, `NO_SOURCE`, lines 36-41), and explicit OWL grounding — "every `Individual.class`
  is a `tmct:` class and every `Edge.predicate` a `tmct:` object property" (lines 6-8).
- **`src/adapters/source.mjs`** — the provider seam. Its own header (lines 6-11) states plainly: "any graph
  producer can feed tmct either by writing the entities-payload JSON where `config.graphFile` points,
  or by registering a custom loader with `registerProvider()` — **no indexer is ever imported here**.
  tmct only READS through this seam." `fetchEntities(config)` (lines 111-146) either calls a
  registered provider or reads and parses `config.graphFile`; a missing file returns an empty
  bootstrap payload, not an error.
- **`src/adapters/graph-build.mjs`** — `buildEntities(modules, commits, opts)` (line 33) is "the PURE assembly
  of the typed `entities` payload from **already-parsed** module + commit records. No subprocesses,
  no filesystem, no git" (lines 1-2). This is the function a ported parser would feed. Grepping every
  `.mjs` file in `src/`, `bin/`, `scripts/` for real (non-test) callers of `buildEntities(` returns
  **zero results** — it exists, is fully implemented, and is exercised only by the test suite today.
- **`ontology/tmct-core.ttl`** (336 lines) — tmct's own OWL vocabulary already names the code-graph
  classes (`tmct:module`, `tmct:class`, `tmct:function`, `tmct:method`, `tmct:attribute`,
  `tmct:variable`, `tmct:commit`, lines 213-239) and predicates (`tmct:imports`, `tmct:calls`,
  `tmct:tests`, `tmct:contains`, `tmct:extends`, `tmct:defines`, `tmct:touches`, lines 260-298), each
  `rdfs:seeAlso`-linked to the exact SEON/`mgx:` prop tokens (`seon:hasSuperType`,
  `seon:containsCodeEntity`, `seon:declaresMethod`, `mgx:importsNamespace`, `mgx:callsSymbol`,
  `mgx:testsCoverage`, `mgx:touchesSymbol`) that a code-graph payload actually carries.
- **`src/tools/server.mjs`** — `dispatchTool` (the internal tool switch: `tmct_ask`, `tmct_describe`,
  `tmct_impact`, `tmct_untested`, etc., line 348). A commit in this repo's own history
  (`f7c0ab0 refactor: drop the MCP server surface — dispatchTool is the plain internal tool switch`)
  shows tmct once had an MCP server and deliberately removed it, keeping `dispatchTool` as a plain
  in-process switch. LLM tool exposure is not tmct's job today, by a decision already made.

**The crux question, answered definitively.** No source-code parsing exists anywhere in tmct.
`grep -rln "acorn|esprima|@babel/parser|tree-sitter|meriyah|espree"` across every `.mjs`/`.json` file
(excluding `node_modules`) returns no parser import — the one hit (`corpus/tier2/generate.mjs:9373`)
is an unrelated ConceptNet triple about oak trees. `package.json` dependencies are `ink`, `react`,
`smol-toml`, `wink-eng-lite-web-model`, `wink-nlp` — no AST/parser library. The two committed example
graphs (`examples/mini-webapp/.tmct/graph.json`, `examples/polyglot/.tmct/graph.json`) are hand- or
externally-produced fixtures. `scripts/build-demo-graph.mjs`, the only "graph build" script in this
repo, reads the committed `mini-webapp` fixture and enriches it with schema docs — it does not parse
source. `docs/adapter-contract.md:3` states this as policy: "tmct **consumes** a code graph; it never
produces or mutates one."

**The schema `.tmct/graph.json` must satisfy** is defined in `docs/adapter-contract.md` §1
(lines 22-59): `{generated_at, classes[], vocabulary[], objectProperties[], individuals[],
proseIndex}`. `graph-build.mjs`'s `buildEntities()` is named there (lines 19-20) as "the reference
producer of this shape" — a producer that exists in tmct's own source tree today but has never been
wired to anything that reads real source code.

**Persona / `--repo` wiring — checked precisely, because it changes the scope of this plan.**
`chat --repo <path>` already routes code-graph questions into the same `runTurn` that answers fact
questions, live today, not a TODO: `runAsk` (`src/services/chat.mjs:7417`) calls `ask()` from `ask.mjs`
directly when a graph and focus/context are present (`chat.mjs:7525-7526`), or falls back to
`dispatchTool("tmct_ask", ...)` (`chat.mjs:7529`), which itself calls the identical `ask()`
(`src/tools/server.mjs:478-481`). Both paths converge on one engine. Separately, `--with-persona code` is a
real, shipped preset (`src/services/init.mjs:84-88`, `PERSONA_PRESETS.code = { extensions: { seon: {active:
true}, conceptnet: {active: true} }, bias: { seon: 1.0, conceptnet: 1.0 } }`) — but it activates
fact-corpus bundles (SEON/ConceptNet ontology facts folded into memory), not a code-graph parser. It
is a bias preset on `tmct init`, orthogonal to `--repo`. **The upshot: the chat-routing half of "query
the code in the chat when a suitable persona is initialised" already exists and needs no new code.
The real gap is producing the `.tmct/graph.json` a repo needs in the first place** — exactly what
this document proposes porting.

## Part 2 — what seonix has that tmct doesn't (the parsing side)

Read directly from `<sibling-checkout>/seonix` (a full sibling repo):

- **Five language backends**, dispatched by a registry (`src/extract_lang.mjs:19-23`, `REGISTRY`)
  and unioned by `src/extract.mjs`:
  - **Python** — `src/extract_ast.py`, stdlib `ast`, zero dependencies. Emits one JSON doc per repo:
    `{modules:[{path, dotted, imports, defines:[{name, kind, lineno, decorators}], calls}]}`.
  - **JS/TS** — `src/jsts_tsc.mjs`, the TypeScript compiler API (`meta = {id:"tsc", ...}`,
    `jsts_tsc.mjs:325`).
  - **C#** — two backends: `src/cs_roslyn.mjs` (Roslyn via a built .NET tool, preferred) and
    `src/cs_treesitter.mjs` (npm `tree-sitter` + `tree-sitter-c-sharp`, fallback). Selected by
    `chooseCs` (`extract_lang.mjs:29-36`): Roslyn if its tool is present, else tree-sitter.
  - **Java** — `src/java_javaparser.mjs` (JavaParser+SymbolSolver via a JDK helper, preferred) and
    `src/java_treesitter.mjs` (`tree-sitter` + `tree-sitter-java`, fallback), selected the same way
    (`extract_lang.mjs:38-46`).
  - All four non-Python extractors emit the same contract: `{modules:[{path, dotted, imports,
    defines, calls, exports}]}` (`extract_lang.mjs:1-5`), merged by `ingestRepo()`
    (`extract_lang.mjs:52-78`). `src/extract.mjs` then resolves imports/calls against an in-repo
    registry and adds git-history edges (a 300-commit module-level scan, a 120-commit symbol-level
    line-range intersection, `extract.mjs:44-64`). No LLM call anywhere in this path
    (`extract.mjs:4`).
- **`ontology/seonix-core.ttl`** — a real OWL/Turtle vocabulary: classes `CodeEntity`, `Module`,
  `Package`, `Class`, `Function`, `Method`, `Attribute`, `GlobalVariable`, `Commit`
  (`seonix-core.ttl:37-74`); object properties `contains`, `declares`, `subclassOf`,
  `importsNamespace`, `callsCoarse`, `callsSymbol`, `testsCoverage`, `touchedByCommit`,
  `touchesSymbol`, `changeCoupledWith`, `reExports` (`seonix-core.ttl:78-135`); custom annotation
  properties `seonix:extraction`, `seonix:valueTier`, `seonix:jsonToken` tie each OWL term to the
  literal JSON token its extractors emit. **This is not a different shape from tmct's own
  `tmct-core.ttl` — it is the same vocabulary tmct's own ontology already `rdfs:seeAlso`-links to.**
  No translation layer is needed; a ported parser needs to emit the `seon:`/`mgx:` prop tokens
  `docs/adapter-contract.md` already documents, which `tmct-core.ttl` already grounds.
- **seonix's own `src/domain/codegraph.mjs`** is a real, independent duplicate. Its header states: "Ported
  ≈verbatim from marginalia seon-mcp/src/domain/codegraph.mjs" — the same shared ancestor tmct's own
  `codegraph.mjs` was lifted from (`git log`, this repo: `116af35 feat: initial lift of the seonix
  chat surface as @polycode-projects/mct (v0.1.0)`). A diff of the first 100 lines of each shows real
  divergence: seonix's carries `expandGraphPayload` wire-format expansion and `mgx:serves`/
  `mgx:callshttp` interface edges (from seonix's own `PLAN_UNTYPED_INTERFACES.md`) that tmct's copy
  does not have; tmct's carries memory-specific `CREATED_AT_PROP`/`UPDATED_AT_PROP` imports seonix's
  does not need. **This is a real, live duplication this plan does not attempt to resolve** — see
  Non-goals.
- **Query tools** — `src/domain/codegraph.mjs`'s `resolveSymbol`/`renderDescribe`/`renderImpact`/
  `renderSearch`/etc., exposed via `bin/cli.mjs`'s `dispatchTool` dispatch and a `seonix ask`
  sub-mode. `src/tools/server.mjs:14-15` documents directly that this NL sub-mode **already calls tmct's
  own `ask` engine**: "`seonix_ask` ... now tmct's ask engine." Query tools are not something to port
  — seonix's own now points at tmct's.
- **LLM tool-calling surface** — a real MCP server (`src/tools/server.mjs`, `@modelcontextprotocol/sdk`,
  `StdioServerTransport`). A tiered "C4" surface: only `seonix_context`, `seonix_snippet`,
  `seonix_ask` register as first-class MCP tools (`server.mjs:65-102`); roughly 11 more stay reachable
  only via CLI `dispatchTool`, deliberately kept off the MCP tool list.
- **Benchmarking harness** — `bench/run.mjs`, isolated git worktrees of five pinned real corpora
  (Django/Python, eShopOnWeb/C#, aws-cdk-examples/TS, commander+express/JS, gson/Java), runs Claude
  Code with/without seonix as an MCP arm, grades correctness via the repo's own pytest suite (Tier A)
  or SWE-bench Verified via `swebench.harness` (Tier B, Docker-gated). Entirely separate from
  `npm test`/`npm run smoke`.
- **seonix already depends on tmct.** `seonix/package.json`: `"@polycode-projects/the-mechanical-
  code-talker": "^1.3.0"`. Two integration points: `src/tmct-provider.mjs` wraps seonix's parsed
  graph as a tmct Repository-Interface provider via `createGraphService`; `src/chat-shim.mjs` makes
  `seonix chat` literally launch tmct's own `runChat` over seonix's graph. This confirms
  `archive/PLAN_REPOSITORY_INTERFACE.md` (this repo, status line: "**STATUS: shipped (Phase 8)**")
  already executed the query/chat inversion the operator's framing calls "later re-integrate ../seonix
  to use the rich tmct library." That part is done. See Part 4 below for exactly what that plan
  covered and what it leaves for this one.
- **seonix already carries `@playwright/test` as a devDependency** (`seonix/package.json`). This
  matters directly for the PLAN_CODE.md relocation below.

## Part 3 — `PLAN_CODE.md`, read in full

`PLAN_CODE.md` (491 lines, this repo) is titled "program synthesis over tmct's closed DSLs (and,
now, JS/HTML/CSS)." It is **not about code indexing** — it is a different capability entirely:
synthesizing `GOAL_RULE`/`PHRASING_FRAMES` entries for tmct's own chat-routing DSL (Track 1), then
three newer, unshipped tracks about writing and testing arbitrary program code in a sandbox (Tracks
2-4). Its own status banner: "Track 1 ✅ SHIPPED — all 5 staged units (`synthbench/`)."

- **Track 1** (`PLAN_CODE.md:49`, "synthesizing a `GOAL_RULE` or `PHRASING_FRAMES` entry") — shipped
  and tested. `synthbench/rules/{synthesize,enumerate,oracle}.mjs` and `synthbench/phrasing/
  {synthesize,examples}.mjs` exist; `test/synth-phrasing.test.mjs` (4 tests) and `test/synth-
  rules.test.mjs` (12 tests) all pass. It needs no sandbox at all (`PLAN_CODE.md:52`) — it is about
  tmct's own request-routing grammar, unrelated to source-code parsing or a target codebase.
- **Track 2** (`PLAN_CODE.md:123`, mutation search / program repair, JS), **Track 3**
  (`PLAN_CODE.md:219`, small JS snippet synthesis from I/O examples), **Track 4**
  (`PLAN_CODE.md:269`, HTML/CSS fragment synthesis) — none implemented. `grep -rln
  "mutation.*template|GenProg|APR|program.repair"` across every `.mjs` file returns zero hits, and
  `playwright` appears nowhere in tmct's `package.json` or source. All three depend on a sandboxed
  headless browser (`PLAN_CODE.md` §5, lines 334-368), explicitly named as a real, unresolved
  dependency decision the operator has not signed off on: adopting Playwright means "a large new
  devDependency (multi-hundred-MB browser binaries)" and tmct's "first untrusted-code-execution
  surface" (§8, lines 475-479).
- **`ROADMAP.md`'s own one-line summary is stale in a way worth naming here too** (`ROADMAP.md:54-
  55`): "small JS-function and HTML/CSS-fragment synthesis via a sandboxed headless browser (Track 1,
  program synthesis, already shipped)" reads as if the sandboxed JS/HTML/CSS work is what shipped.
  In fact Track 1 (the part that shipped) needs no sandbox at all; the sandboxed work is Tracks 2-4,
  unshipped. This is a real, independent stale claim, not part of Part 1's "not a code indexer"
  sweep, but it directly affects how PLAN_CODE.md's relocation should be described in ROADMAP.md
  once this plan executes.

**Why this matters for "move PLAN_CODE.md into seonix":** Track 2-4's blocker — a sandbox dependency
tmct doesn't want to carry — is not a blocker in seonix. seonix already ships `@playwright/test`,
already has a benchmarking harness built for exactly this shape of correctness grading (SWE-bench
Tier B, pytest Tier A), and already has an MCP tool surface to expose a working synthesis/repair tool
to an LLM agent. Track 1, by contrast, has nothing to do with code indexing or synthesis-over-a-
target-codebase — it is tmct's own chat-routing DSL, already shipped, already tested, and has no
sandbox dependency to resolve. Moving the whole file and treating Track 1 as done-and-staying is more
accurate than trying to split the document.

## Part 4 — the reconciliation: every stale "not a code indexer" claim, named

This repo's own discipline (`archive/TOO_HARD_AUDIT.md`) is to name a stale claim precisely once a real
architectural change supersedes it, not to leave it sitting. Every claim below is real, verified
directly, and every one becomes false the moment Phase 1 below ships a working parser.

| # | Location | Exact text | Verdict once this plan ships |
|---|----------|------------|-------------------------------|
| 1 | `README.md:386` | "**It is not an indexer.** tmct keeps no codebase index of its own. It consumes a graph via a provider seam ... building that graph is a different tool's job." | Superseded. Reword to: tmct can build its own code graph via a ported indexer (name the languages), and still consumes a graph via the same provider seam for any other producer (seonix, CI, hand-written JSON). Both are true after this plan; the "different tool's job" clause is the part that goes. |
| 2 | `README.md:513` | "tmct is not an indexer, so it consumes a graph through a typed contract any producer can implement." | Superseded. The typed contract stays exactly as-is (this plan adds a producer, not a new consumer path) — reword only the "not an indexer" clause. |
| 3 | `docs/adapter-contract.md:3` | "tmct **consumes** a code graph; it never produces or mutates one." | Directly false after Phase 1. This is the document that most needs a rewrite: it should state that `graph-build.mjs`'s `buildEntities()` is now a real producer with a real caller (the ported parsers), and that the provider seam remains the path for any *other* producer. |
| 4 | `src/adapters/source.mjs:9` | "no indexer is ever imported here. tmct only READS through this seam." | This one should probably stay true and be preserved as an architectural boundary: `source.mjs` is the read seam; a new `src/index/` (or similar) module tree is the write/producer side, and `source.mjs` itself is not where the parser lives. Reword the comment to say so explicitly rather than delete it, since the boundary itself (reader vs. producer as separate modules) is worth keeping. |
| 5 | `bin/tmct.mjs:556` | `// with every other subcommand. No --graph: memory reads no code graph.` | Not stale — this is a true statement about the `memory` subcommand specifically, unaffected by this plan. No change needed. |
| 6 | `bin/tmct.mjs:842` | `// accepts --config for symmetry (syllogise reads no code graph either).` | Same as above — true, subcommand-scoped, no change needed. |
| 7 | `src/services/chat.mjs:557-558` | `"I can't count \"${noun}\" — no code graph is loaded yet, so there's nothing to count (point me at one with --repo, or run \"npm run example:mini\")."` | Stays accurate as a *live-session* message (a repo with no graph still has no graph loaded until indexed), but the CLI should eventually offer to index on the spot rather than only pointing at an external `--repo`. Reword once a `tmct index` command exists, to mention it as an option. |
| 8 | `src/services/chat.mjs:1565-1566` | `"For code structure (imports, calls, definitions) point me at a repo with --repo <path> ... tmct reads graphs; it doesn't index code itself. /help for commands."` | Directly false after Phase 1-2 below ship. Reword the "doesn't index code itself" clause; keep the `--repo` pointer language, since consuming an externally-produced graph remains supported. |
| 9 | `src/services/chat.mjs:8317` | `"(this repo has no code graph — for structure, point me at a .tmct/graph.json with --repo <path> or run npm run example:mini; tmct doesn't index code itself.)"` | This is the exact live message the operator saw this session. Directly false after this plan ships. Reword to mention `tmct index` (or equivalent) as the first-class option, with `--repo` pointing at an externally-produced graph kept as a fallback. |
| 10 | `src/services/chat.mjs:9482,9489,9494` | Startup-banner variants of the same "tmct reads graphs, it doesn't index code" message. | Same verdict as #9 — reword together, they are the same message family. |

None of these are reworded in this document — this is design only, and the operator's own scope
boundary for this task excludes touching any file but this one. Phase 4 of the plan below is where
the rewording happens.

## Part 5 — what gets ported, concretely

Split into the three things the operator's framing named, checked separately because they turn out
to need very different amounts of new work:

**1. Parsing — genuinely new work, the actual gap.** Port, in order of dependency weight (lightest
first):

- `seonix/src/extract_ast.py` (Python, stdlib `ast`, zero new dependencies) — first, because it adds
  no new npm/pip dependency at all and proves the seam end to end.
- `seonix/src/extract_lang.mjs` (registry/dispatch pattern) and `seonix/src/extract.mjs`
  (import/call resolution, git-history edges) — the orchestration layer every language backend needs;
  port this once, generalized over whichever backends are ported.
- `seonix/src/jsts_tsc.mjs` (JS/TS via the TypeScript compiler API) — a real new dependency
  (`typescript`), but a common, well-understood one.
- `seonix/src/cs_roslyn.mjs` + `seonix/src/cs_treesitter.mjs` (C#, preferred + fallback) and
  `seonix/src/java_javaparser.mjs` + `seonix/src/java_treesitter.mjs` (Java, preferred + fallback) —
  the heaviest ports: Roslyn needs a built .NET tool, JavaParser needs a JDK helper, and the
  tree-sitter fallbacks add `tree-sitter`/`tree-sitter-c-sharp`/`tree-sitter-java` as real
  dependencies tmct does not carry today. Each is independently portable and independently testable.

A ported parser's job is narrow: emit the `{modules:[{path, dotted, imports, defines, calls,
exports}]}` shape `graph-build.mjs`'s `buildEntities(modules, commits, opts)` already consumes
(`graph-build.mjs:33-46`). `buildEntities` itself needs no changes — it already exists, is already
tested, and has simply never had a real caller.

**2. Ontology linkage — already done, confirmed directly, no new work needed.** `ontology/tmct-
core.ttl` already grounds every class and predicate `seonix-core.ttl` defines, via explicit
`rdfs:seeAlso` links to the same `seon:`/`mgx:` tokens (Part 1 above). A ported parser emits those
same tokens through `graph-build.mjs`; no translation layer, no new ontology file, no schema
negotiation. The one open item: seonix's `mgx:serves`/`mgx:callshttp` interface edges (from
`PLAN_UNTYPED_INTERFACES.md`, seonix-only today) are not yet named in `tmct-core.ttl` — flagged as an
open risk below, not designed further here, since it only matters once/if HTTP-route extraction is
ported.

**3. Query tools — already done, exceeds seonix's own now-legacy engine.** `ask.mjs`,
`codegraph.mjs`, and `repository-interface.mjs` already cover everything seonix's own query surface
does; seonix's own `seonix_ask` already calls tmct's `ask()` (Part 2 above, `server.mjs:14-15`). This
plan does not port any query code — there is nothing left in seonix's query layer that tmct doesn't
already have, or already have a superior version of.

## Part 6 — the persona-gated chat integration, designed precisely

Confirmed in Part 1: `chat --repo <path>` already threads `ask()` into `runTurn` via `runAsk`
(`chat.mjs:7417`, `7525-7526`, `8922`) and `dispatchTool("tmct_ask", ...)` (`server.mjs:478-481`).
This is live today for any repo that already has a `.tmct/graph.json`, produced by any means. **No
new chat-routing code is needed.** The gap this plan closes is producing that artifact.

The design: once Phase 1-2 below ship a real parser and a `tmct index` command (name TBD, see
phasing), tie it to the persona mechanism that already exists rather than inventing a new one:

- `tmct init --repo <path> --with-persona code` (both flags already real and independently working,
  `bin/tmct.mjs:610-615`, `src/services/init.mjs:84-88`) should, once this plan ships, **also run the new
  indexer** and write `.tmct/graph.json` from the repo's real source — so one command produces a
  `.tmct/` directory that is both bias-tuned toward code vocabulary (`seon`/`conceptnet` corpora,
  the persona's existing job) and backed by a real code graph (the indexer's new job). These are two
  independent, already-separable mechanisms (a corpus bias preset and a graph producer) that this
  plan composes into one onboarding path, without merging their implementations.
- `chat --repo <path>` continues to work exactly as it does today for a graph produced any other way
  (seonix, CI, hand-written) — the provider seam (`source.mjs`) is untouched by this plan.
- No change to `runTurn`, `runAsk`, `ask.mjs`, or `dispatchTool` — verified precisely in Part 1 that
  this routing already exists and is not the gap.

## Part 7 — Phase 2: seonix as a thin consumer, sequenced

The operator's framing names this as later work: "later re-integrate ../seonix to use the rich tmct
library but still have all it's code benchmarking and the exposure of a tool surface to LLMs."

**Most of this already happened.** `archive/PLAN_REPOSITORY_INTERFACE.md`, status line "**STATUS:
shipped (Phase 8)**," already executed exactly this inversion for the query/chat/ontology side:
seonix imports tmct (`^1.3.0`), seonix's chat surface is a thin wrapper over tmct's own `runChat`
(`seonix/src/chat-shim.mjs`), and seonix's graph is exposed to tmct's Repository Interface via
`createGraphService` (`seonix/src/tmct-provider.mjs`). What that plan explicitly kept in seonix
(`archive/PLAN_REPOSITORY_INTERFACE.md`, "What moves vs what stays," lines 141-151): the parsers
(`extract_ast.py` and friends), the benchmarking harness (`bench/`), and the MCP tool surface
(`src/tools/server.mjs`, `@modelcontextprotocol/sdk`) — precisely the things the operator's framing says
must stay in seonix. Nothing in this document changes that division.

**What remains, sequenced as this plan's own Phase 2 (not this phase's scope, named for later):**

1. Once tmct has a working parser (this plan's Phase 1-3), seonix gains the *option* to call tmct's
   parser instead of, or alongside, its own `extract.mjs` pipeline for the languages tmct now covers.
   This is explicitly not a rip-and-replace on day one — seonix's own extractors are more mature for
   C#/Java (real Roslyn/JavaParser backends, not just tree-sitter) and are exercised by seonix's own
   five pinned benchmark corpora. Whether seonix ever switches is seonix's own call, made once tmct's
   ported versions have real mileage.
2. `PLAN_CODE.md` relocates to seonix in full (the operator's explicit instruction), with a stated
   split on arrival: Track 1 (shipped, tmct's own chat-routing DSL, no sandbox dependency) is noted
   as already-shipped-and-staying-in-tmct, not something seonix re-implements; Tracks 2-4 (unshipped,
   sandboxed JS/HTML/CSS synthesis and mutation repair) become seonix's design problem, unblocked by
   seonix's existing `@playwright/test` dependency, `bench/` harness, and MCP tool surface — all three
   of which were the exact things blocking Tracks 2-4 inside tmct.
3. `ROADMAP.md`'s stale PLAN_CODE.md summary (Part 3 above) gets corrected as part of this move, not
   before it — the summary should describe Track 1 as tmct-owned and shipped, and Tracks 2-4 as
   seonix's, once the file actually moves.

## Non-goals

- **No change to tmct's no-LLM-in-product charter.** The ported parsers (stdlib `ast`, the TypeScript
  compiler API, Roslyn, JavaParser, tree-sitter) are exactly as deterministic and model-free as
  `ask.mjs`/`codegraph.mjs` already are — zero model calls anywhere in seonix's own extraction path
  today (`seonix/src/extract.mjs:4`), and this plan changes nothing about that.
- **No MCP server revival in tmct.** tmct deliberately dropped its MCP surface
  (`f7c0ab0`, Part 1 above); LLM tool-calling exposure stays seonix's job, unchanged by this plan.
- **No consolidation of the two divergent `codegraph.mjs` forks** (Part 2 above) — a real, named,
  live duplication between tmct and seonix, explicitly left alone here. Worth its own follow-up, not
  bundled into this plan.
- **Not a rip-and-replace of seonix's own parsers.** seonix keeps its own extraction pipeline; this
  plan ports a copy into tmct, it does not delete or deprecate seonix's.
- **Track 1 of `PLAN_CODE.md` does not move.** It is tmct's own chat-routing synthesis DSL, already
  shipped, unrelated to code indexing. Only the plan document (with Tracks 2-4's disposition) moves.
- **No new chat-routing code.** Verified precisely in Part 1/Part 6: `chat --repo` already wires
  `ask()` into `runTurn`. This plan produces the graph artifact; it does not touch the routing.
- **Not a decision on the sandboxed-browser question for Tracks 2-4.** That decision moves to seonix
  along with the file; this document does not make it.

## Phased implementation plan

**Phase 1 — one language, prove the seam.** Port `seonix/src/extract_ast.py` (Python, stdlib `ast`,
zero new dependencies) and a minimal version of `extract_lang.mjs`'s dispatch pattern. Wire its
output into `graph-build.mjs`'s existing, currently-uncalled `buildEntities()`. Exit criterion: a
real Python repo produces a `.tmct/graph.json` that passes the existing Repository Interface
conformance suite (`archive/PLAN_REPOSITORY_INTERFACE.md`'s contract kit) without modification to
the interface itself.

**Phase 2 — the CLI surface.** A new command (`tmct index [--repo <path>]`, or extending `tmct init
--repo` to run it) that writes `.tmct/graph.json` from real source, using Phase 1's Python backend.
Exit criterion: `npm run example:mini`-equivalent smoke test against a real small Python repo,
`npm test` green throughout.

**Phase 3 — the remaining four language backends.** Port `extract.mjs`'s full merge/resolve layer
(import/call resolution, git-history edges), then `jsts_tsc.mjs` (JS/TS), then `cs_roslyn.mjs`/
`cs_treesitter.mjs` (C#), then `java_javaparser.mjs`/`java_treesitter.mjs` (Java) — each independently
testable, each against a subset of seonix's own pinned bench corpora (Django, eShopOnWeb,
aws-cdk-examples, commander/express, gson) as a real-world correctness check, not synthetic fixtures
only. Exit criterion per language: the same conformance suite passes against a real repo in that
language.

**Phase 4 — doc reconciliation.** Reword every stale claim in Part 4's table (README, `docs/adapter-
contract.md`, `src/adapters/source.mjs`, the `src/services/chat.mjs` live strings) now that they are genuinely false.
Follows `archive/TOO_HARD_AUDIT.md`'s own discipline: name the claim, state the supersession, reword —
already done in Part 4 above; this phase is where the actual file edits land. `npm test` green
throughout (some tests likely assert the old strings — expect to update pinned-string tests here).

**Phase 5 — the persona-gated onboarding path.** Wire `tmct init --repo <path> --with-persona code`
to run Phase 2's indexer, per Part 6's design. No changes to `runTurn`/`runAsk`/`ask.mjs`. Exit
criterion: one command produces a repo whose chat session answers both a fact question ("what is a
dog") and a code-structure question ("which modules import X") in the same session, backed by a
self-produced graph.

**Phase 6 — `PLAN_CODE.md` relocates, and Phase 2 of this plan (seonix-side) begins.** Move
`PLAN_CODE.md` to seonix per Part 7, with the Track 1 / Tracks 2-4 split stated in the moved file's
own status line. Correct `ROADMAP.md`'s stale summary (Part 3) in the same step. Sequencing Tracks
2-4's actual design work is seonix's own plan-doc process from here, not designed further in this
document.

## Open risks / unresolved questions

- **The `codegraph.mjs` duplicate-fork risk** (Part 2) is real today, independent of this plan, and
  gets slightly more relevant once tmct's own parser exists and both repos are producing graphs.
  Not resolved here.
- **Whether tmct should eventually adopt seonix's more mature C#/Java backends (Roslyn, JavaParser)
  wholesale, or build and maintain a leaner subset** — left to Phase 3's own findings, not decided in
  advance. Roslyn and JavaParser both need external toolchains (a built .NET tool, a JDK helper)
  that add real operational weight tmct has never carried.
- **The `mgx:serves`/`mgx:callshttp` ontology gap** (Part 5) — only matters if/when HTTP-route
  extraction is ported; flagged, not designed.
- **Dependency footprint growth.** tmct's current dependency list is deliberately small (`ink`,
  `react`, `smol-toml`, `wink-eng-lite-web-model`, `wink-nlp`). Adding `typescript`, `tree-sitter` and
  its language grammars is a real, measurable change to that footprint — worth an explicit sign-off
  moment before Phase 3, similar to the sign-off `PLAN_CODE.md` itself required for Playwright.
- **Unverified, needs follow-up:** the exact content of seonix's `PLAN_LARGE_CODEBASE.md`,
  `PLAN_TUNE_SEARCH_SPACE.md`, and the other seonix-side plan docs found during this research but not
  read in full — one of them may already be the natural home for PLAN_CODE.md's Tracks 2-4 once it
  moves, rather than a brand-new seonix plan doc. Worth a read before Phase 6 executes.
