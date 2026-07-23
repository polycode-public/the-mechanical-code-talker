# CAPABILITIES_2.0.3.md — tmct capability audit (refresh 7, overlay over `CAPABILITIES_1.7.3.md`)

Pinned at `7858087`, `package.json` 2.0.3, 2026-07-16. 399 commits since
`CAPABILITIES_1.7.3.md`'s pin at `981c9b2`.

**This is the first audit in this project's history where every figure is current.** The
per-benchmark provenance table below has no carried-forward row. `CAPABILITIES_1.7.3.md` carried
three of its four forward — its AGENT and INFERENCE numbers were from 1.7.0, and it audited a
capability surface using measurements nobody had taken against that surface. This cycle re-measured
all four axes at 2.0.3 first, then wrote this.

## Per-benchmark provenance — where every figure came from

| Benchmark | Latest report | Figure comes from |
| --- | --- | --- |
| AGENT | `BENCHMARK_AGENT_2.0.3.md` | **2.0.3, current** |
| CEFR_ENGLISH | `BENCHMARK_CEFR_ENGLISH_2.0.3.md` | **2.0.3, current** |
| CONVERSATION | `BENCHMARK_CONVERSATION_2.0.3.md` | **2.0.3, current** |
| INFERENCE | `BENCHMARK_INFERENCE_2.0.3.md` | **2.0.3, current** |

`max(2.0.3, 2.0.3, 2.0.3, 2.0.3)` is 2.0.3, so this audit is `CAPABILITIES_2.0.3.md` and its number
happens to match `package.json` — a coincidence of a fully-measured cycle, not the naming rule.

Three caveats travel with those figures, and every citation below carries them:

- **CEFR 2.0.3 ran at N=1 on the default pool** (operator's choice): 109 cases, 109 judge calls,
  `voidCount` 0. No judge-noise averaging, and the pool tests **9 of 23 construction shapes**. Its
  mean is a baseline, not comparable to `BENCHMARK_CEFR_ENGLISH_1.8.0.md`'s 1.789/2 (N=2). Its
  **tier-1 figures are deterministic and fully comparable** — which is how it caught a regression.
- **INFBENCH's 219/219 includes 50 greens graded against a declared ceiling** (23%). Two bands read
  as capable when they are floors. Never cite INF-C2's 20/20 as consistency checking.
- **No lever was applied anywhere this cycle.** All four reports are re-measurements on the
  operator's instruction, so nothing they found is attributable to work done in the cycle.

## What the four fresh reports change about this audit

The benchmarks measure quality, never existence, so none of them creates a row. Three of them move
one:

- **AGENT** retires the composing gap. The goal driver clears every rung at 100% plan / 100% result
  / 0% hallucination across all 56 cases, and `ab-c2-what-to-test` — the kept honest red named by
  1.4.1, 1.5.7 and 1.7.0 alike — now composes. `PLAN_AGENTS.md`'s §1 table claimed this before any
  benchmark showed it; the plan was right and `BENCHMARK_AGENT_1.7.0.md` was the stale document.
- **CEFR** downgrades the CHATBENCH ladder's quality: tier-1 **109/109 → 107/109**, deterministic,
  bisected to `98df45a`.
- **CONVERSATION** contradicts nothing in the table and adds the sharpest finding of the cycle: a
  plan labelled `3 moves (shortest)` whose first move is illegal.

**The theme across all four, and the single most useful sentence in this audit: tmct's honesty
machinery is in good order, and the risk has moved upstream of it.** The adversarial sceptic spent
55 probes trying to force a role or polarity inversion and could not — active/passive,
forward/reverse, negation and the converse trap all compiled correctly. What fails is *input
discarded before the parser runs*: a sentence boundary, a quantifier, a clause, a modifier, an
article, a qualifier. Each is dropped silently, and each produces a fluent, confident answer to a
question nobody asked. The honesty machinery never engages, because by the time it could, the
evidence that this was a different sentence is gone.

That family now has six independently-found members, from four different frames and two different
benchmarks, plus one found by this audit's own plan review:

| Dropped | Input | Answer |
| --- | --- | --- |
| a sentence boundary | the README's Hanoi board on its own line | `3 moves (shortest)`, illegal on move 1 |
| a quantifier | `some men are fathers` → `is john a father` | `yes`, **with a proof** |
| a clause | `what would break if I change store.mjs` | three people |
| a modifier | `what imports the deprecated legacy model.mjs` | what imports `model.mjs` |
| an article | `tell me about a dog` | "the graph is empty" |
| a qualifier | `how many facts about horses are there` | `664 facts.` — the unrestricted total |

The last row is new here: `answerMemoryCount` (`src/services/chat.mjs:692-701`) matches
`how many …` with no tail check, so the restriction is dropped and the total is returned. Verified
live against a fresh seeded store. It is the smallest diff of the six.

## 0. Scope note

This audit covers the three sets `SKILL_CAPABILITIES_AUDIT.md` §3 names: the product capability
catalog, what `PLAN_NLU_BENCHMARKS.md` would measure, and what `PLAN_AGENTS.md` leans on. Rows
1-99 were fanned out across three background agents, each re-checking cited evidence directly
against the real code at this pin rather than trusting `CAPABILITIES_1.7.3.md`'s word. Rows 100+
are new work.

**A numbering correction.** `CAPABILITIES_1.7.3.md`'s prose says "98 rows", and that is right, but
the numbering is not contiguous: it uses 1-99 with **no row 63** (it jumps 62 → 64), merges rows
21 and 24 into one `21/24` row, and carries one unnumbered `—` row for `PLAN_ADVENTURE.md`. It also
already contains a **row 99** (the capability-router invocation surface), appended after its own pin
by `eed1cd7` without the summary being updated. So 96 numbered + 1 merged + 1 unnumbered = 98, and
**new rows here start at #100**, not #99.

## 1. Full status table

**Status key:** `implemented` · `partial` · `undocumented` · `claimed-only` · `explicit scope
decision`, unchanged since refresh 1.

### Rows 1-33

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline | implemented | rows `grammar.compositional` (51), `grammar.relaxation` (26), `grammar.normalize` (19); `src/domain/interpret/pipeline.mjs:48,72` | unchanged; all five strategy modules present |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | row `grammar.ace` (8); `src/domain/grammar/ace.mjs` | unchanged |
| 3 | ACE-OWL parser as a standalone MPL-2.0 package | reverted (unchanged) | `packages/` absent; revert `f234f35` | unchanged |
| 4 | OWL 2/RDF/RDFS + SEON ontology grounding | implemented | `test/adapters/grammar-ontology.test.mjs`; `ontology/tmct-core.ttl` | unchanged |
| 5 | Template libraries / response phrase book | implemented | 19 `template.*` key families; `test/adapters/corpus-templates.test.mjs` | unchanged |
| 6 | Filtered ConceptNet corpus slice | implemented, opt-in | `test/adapters/extensions-corpus.test.mjs`; `src/services/extensions.mjs:56` | **evidence path stale** (`conceptnet.mjs:32-41` now holds other consts); status holds |
| 7 | Conversational memory as an OWL-labelled graph (3 backends) | implemented | `src/adapters/memory/core.mjs:134-181` | evidence line stale (was `:185-233`) |
| 8 | Input normalization pass | partial | row `grammar.normalize` (19); `src/domain/interpret/normalize.mjs` | unchanged |
| 9 | Repository Interface adapter contract | implemented | `test/adapters/repository-interface.test.mjs` drives `runConformance` over 3 providers | **count stale: row says 15 services; verified 16** |
| 10 | Runnable conformance suite for RI providers | implemented | `test/adapters/repository-interface.test.mjs:39,40,47` | line shifted (`conformance.mjs:56`) |
| 11 | Library-first design, stable `exports` map | implemented, **surface deliberately shrunk 18 → 6** | `test/estate/pack.test.mjs:42`; `package.json:43-50` | **changed**: 18 → 19 (`b0e9a71`) → **6** (`25bbece`). A scope decision; the row's "18 entry points" is wrong |
| 12 | Ink console TUI shell | implemented | `e2e/tui.test.mjs:124` drives a real turn | evidence line stale |
| 13 | Calculation surfaced as reasoning | implemented | `test/adapters/wiring-templates-via.test.mjs:91,106` | **all six cited `chat.mjs` lines dead**; status holds |
| 14 | Optionally running linters/tests to observe | claimed-only | nothing in the estate pins it; no such code in `src/` | unchanged — the only nothing-pins-it row in 1-33 |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | absent (named open spike) | `PLAN_SYLLOGIST.md` §5 frames it a far spike | **changed**: was `claimed-only (deliberate)`; `PLAN_CODE.md`'s "deliberately shut door" framing is gone. Evidence path dead |
| 16 | Response-finishing grammar pass | partial | `test/adapters/finish.test.mjs`; `src/services/finish.mjs:24,29,34` | line shifted |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `test/tools/cli-args.test.mjs`; `bin/tmct.mjs:716,74,817` | lines stale |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `test/adapters/syllogise.test.mjs`; `bin/tmct.mjs:1094-1107` | line stale |
| 19 | `cax-dw` disjointness rule | implemented | `test/adapters/syllogise.test.mjs`; `src/domain/syllogise.mjs:57` | line shifted; 1.7.3's "byte-identical" claim **no longer holds** (justification rewrite) |
| 20 | `cax-sco` type-propagation rule | implemented | `test/adapters/syllogise.test.mjs`; `src/domain/syllogise.mjs:51` | line shifted; same rewrite |
| 21/24 | Actor-level, session-scoped source trust | implemented | `test/adapters/chat-inference-trust.test.mjs`; `src/domain/memory/trust.mjs:75` | line shifted |
| 22 | Consistency checking / cardinality / proof-chain materialization | implemented | `test/adapters/syllogise.test.mjs` drives `findConsistencyViolations`, `proveCardinalityAtLeast`; `syllogise.mjs:407,545,575,598` | newly pinned to lines |
| 23 | Unified provenance/trust primitive | implemented | `test/adapters/chat-inference-trust.test.mjs`; `trust.mjs:40,59` | lines stale |
| 25 | Memory-tree versioning (`snapshotMemory`) | implemented, Backend A only | `src/adapters/memory/core.mjs:470`; throws on sqlite at `:472` | line moved a long way (was `:636`) |
| 26 | Deterministic contradiction detection | implemented | `src/adapters/memory/core.mjs:1536` | line stale; semantics narrowed deliberately at `0f8fb61` |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/adapters/memory/blocks.mjs:174,200` | line stale |
| 28 | Extension-pack / corpus-lexicon loading seam | implemented | `test/adapters/extensions-corpus.test.mjs`; `src/services/extensions.mjs:260` | line stale |
| 29 | Bias-weighted ambiguity resolution | implemented | `test/adapters/bias-weighting.test.mjs`; `src/domain/memory/bias.mjs:28` | line stale |
| 30 | `tmct init --with-persona`, size-tier flag | implemented | `test/tools/cli-args.test.mjs`; `bin/tmct.mjs:790,72` | line stale |
| 31 | Tier-2 general-knowledge bundle (legacy) | implemented, legacy | `test/estate/corpus-schema.test.mjs`; `corpus/tier2/manifest.json` | unchanged |
| 32 | A wider general-knowledge seed set | implemented | `corpus/tier2/manifest.json` — `human` 664 (**default active**), `human-medium` 944, `human-large` 12001 | **status detail changed**: now the default corpus, three tiers |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `test/adapters/corpus-unknown-ingest.test.mjs:153,165,175` | line stale; **rests only on the unit ring — no corpus row drives it** |

### Rows 34-66 (no row 63 — the 1.7.3 table jumps 62 → 64)

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 34 | SHACL-style declarative ingest gate | implemented | `test/adapters/memory-shacl.test.mjs` | **path dead**: moved to `src/adapters/memory/shacl.mjs:79,91` |
| 35 | Cross-repo HTTP smoke test | implemented | `e2e/server-http-smoke.test.mjs` spawns a real `serve` child | **path dead**: `test/` → `e2e/` |
| 36 | Machine-readable capability envelope | implemented (artifact), **unpinned by the estate** | `agentbench/envelope.json:4`; `agentbench/generate-envelope.mjs:100` | **finding**: nothing drives the generator or guards the artifact. Version stamp still `1.4.1` — stale through three audits with nothing to catch it |
| 37 | Ontology tracks a+b (ConceptNet Synonym/SimilarTo) | **implemented, ON by default** | `test/adapters/wiring-facts-memory.test.mjs:146,172` drives `runTurn` live | **changed** from default-off: wired as lane 3b last-resort synonym expansion (`chat.mjs:9748`) |
| 38 | Ontology tracks c+d (SEON spine) | implemented, default-off | `test/adapters/grammar-ontology.test.mjs:129,147` | unchanged |
| 39 | Subordination/conditional preamble frames | implemented | rows `grammar.normalize.subordination`, `grammar.normalize.conditional` | line range dead |
| 40 | Construction-grammar template bank | implemented | row `grammar.construction.agent-noun`; `test/adapters/interpret-constructions.test.mjs` | unchanged |
| 41 | Chat-taught relations & rules | implemented | `inference.hasa.*`, `inference.capability.*`, `inference.relation` (30 rows), `inference.teach-lane` (13) | **path dead**: `PLAN_TAUGHT_RELATIONS.md` archived; rule kinds at `core.mjs:1105-1107` |
| 42 | `findActionPath` (bounded successor BFS) | **implemented AND wired to a real domain** | rows `planning.solve.hanoi`, `planning.execute.river` | **changed** from "not wired to a real domain": `chat.mjs:8983-8986` over `src/domain/domain.mjs` |
| 43 | `findReachableSet` | implemented, wired into chat | `src/domain/planning.mjs:63`; live calls `chat.mjs:6966,6974` | both lines dead; reach GREW — two new consumers |
| 44 | Towers-of-Hanoi goal-directed planning loop | **implemented** | row `planning.solve.hanoi` — teaches 22 facts/rules, then solves to the 7-move optimum with the plan attached | **status change, the biggest in range**: was `claimed-only`. `PLAN_HANOI.md` archived as delivered (`8fec87c`); the 1.7.3 cite is gone and was wrong |
| 45 | "I am thinking of a number" closed-loop game | claimed-only | `PLAN_GUESS_NUMBER.md:3` RESEARCH/DESIGN | unchanged — zero hits for guesser/thinker/bisection |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `test/adapters/synth-rules.test.mjs` reproduces both hand-written rules byte-for-byte on held-out examples | unchanged |
| 47 | Program synthesis Tracks 2-4 (sandbox) | claimed-only | `PLAN_CODE.md:26` | **evidence claim now false as written**: "no playwright in package.json" — playwright 1.61.1 is a devDep (`package.json:74`), used only by the browser e2e tier. Status holds for a different reason |
| 48 | Completions Stage 0 (broad search + grouping) | implemented | `test/adapters/completions-stage0.test.mjs:90,109,131,161,183` | unchanged |
| 49 | Completions Stage 2 (extractive ranking) | implemented | `test/adapters/completions-stage2.test.mjs` | unchanged |
| 50 | Completions wired into a user-facing answer | implemented | `test/adapters/chat-completions-wiring.test.mjs:56,77,95,111` | line dead (`:6475` → `:8596`) |
| 51 | Capability router — registry operator model + four stages (resolver → planner → taught-action plan → goal-reasoner) | implemented, reachable and now corpus-driven | 11 `planning.route.*` rows; `test/adapters/router-drive.test.mjs:41,53,63,78` | **strengthened**: 1.7.3's reachability gap now pinned by real-session rows. New module `src/domain/router/taught.mjs` |
| 52 | `POST /v1/messages` HTTP shim | implemented | `e2e/server-http.test.mjs:49,92,106,122,133` — full tool_use→tool_result→end_turn loop | unchanged |
| 53 | bedrock-meter $0-rung routing | implemented in the sibling repo, not here | `PLAN_AGENTS.md:87`; tmct's own side `:596` Phase 5 "Not started" | line dead |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md:596` Phase 5 | line dead |
| 55 | `seon-mcp` provider adapter | claimed-only | `PLAN_AGENTS.md:88` "Built, not yet wired to tmct" | lines dead |
| 56 | marginalia "mechanical chat" replaced by tmct | claimed-only | `PLAN_AGENTS.md:89` "Not started — the real open work" | line dead |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md:594` Phase 3 | line dead |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md:595` Phase 4 | line dead |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet) | implemented | `test/adapters/repository-interface.test.mjs:52,59,91,117` — absent capability → `miss(CAPABILITY_ABSENT)`, never throws | unchanged; SERVICES 16 |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `test/adapters/source-slice.test.mjs:70` (rejects traversal *before* `readFile`), `:93` (sibling-prefix bypass) | unchanged |
| 61 | Telemetry wrapper on every RI service | **implemented, exercised live** | `test/tools/telemetry.test.mjs:143` (real session, exactly ONE telemetry file), `:175`, `:93` | **changed** from "not exercised live" — now tool-layer evidence plus a live session |
| 62 | Chronograph-style temporal diffing | claimed-only, research-horizon | `PLAN_AGENTS.md:597` R1 "Not started" | unchanged. **Caution**: `src/domain/ask.mjs:17` cites "temporal.mjs" — **no such module ever existed**; do not read that comment as evidence |
| 64 | Dialogue-flow playtest ladder, Tiers 0-6 | implemented, re-homed | `games.opener` (40), `games.drilldown` (51), `games.compositional` (20), `games.teach-then-infer` (36), `games.messy-user` (17), `games.relation-touch` (55), `games.honest-miss` (6) | **path dead, status holds**: all seven `test/chatflow-tier*.test.mjs` purged (`2217bd7`, `fa8559c`) behind an lcov coverage-compare gate. Corpus rows driving the real session are a strictly stronger tier |
| 65 | CHATBENCH graded-pool ladder | implemented; **quality regressed** | `test/bench/chatbench-graded.test.mjs:54,76,86,99`; `BENCHMARK_CEFR_ENGLISH_2.0.3.md` | **changed**: tier-1 **109/109 → 107/109** (deterministic), 1 hard fail (was 0), bisected to `98df45a` |
| 66 | AGENTBENCH agentic ladder (A0-C2) | implemented; **quality improved** | `test/bench/agentbench.test.mjs:51,105,117,143,152`; `BENCHMARK_AGENT_2.0.3.md` | **changed**: goal driver 100%/100% on all 56, every rung PASS for the first time; `ab-c2-what-to-test` closed |

### Rows 67-99

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 67 | INFBENCH classical-logic ladder | implemented (**ceiling-qualified**) | row `bench.infbench`; `BENCHMARK_INFERENCE_2.0.3.md` — kernel 80/80, chat 219/219, 0% fabrication | **changed**: now measured at 2.0.3 (was 1.7.0). Numbers identical, but 2.0.3 discloses **50 of the 219 greens (23%) grade against a declared ceiling**. "Every band passes" must never be read without that |
| 68 | Strategy-advisor watch process | implemented (process), dormant | `STRATEGY_ADVISOR.log` (20 lines, truncated 2026-07-16); no live process | evidence detail changed |
| 69 | Segmentation IR + concept force | implemented | `test/adapters/concept.test.mjs` (unit ring); `src/domain/concept.mjs:129` | unchanged |
| 70 | Negation as bounded set complement | implemented | row `grammar.negation.set-complement` (5) | **rung upgraded** source-only → keyed corpus lane |
| 71 | Reversible-passive traversal | **partial** (postposed works, fronted-agent broken) | rows `grammar.passive.agent` (2), `grammar.passive.questioned-agent`, `grammar.passive.guard` — **all pin the postposed form**; `BENCHMARK_CEFR_ENGLISH_2.0.3.md` | **status change, `implemented` → `partial`.** `by which modules is X imported` answers the inverse confidently; bisected to `98df45a`. Cited test `test/ask-negation-passive.test.mjs` is gone. **No row pins the fronted-agent form — which is why the estate stayed green through the regression** |
| 72 | Compound-name resolution in `resolveObject` | implemented | row `grammar.compositional.find` (4) | line shifted; new coordination-refusal guard at `ask.mjs:2149-2168` |
| 73 | Compound matching in `/describe`'s resolver | claimed-only / named gap | `src/domain/codegraph.mjs:149` `resolveSymbol` — no compound tier | unchanged |
| 74 | Reverse-`inherits` "the"-definite forms | claimed-only / named gap | `src/domain/ask-vocab.mjs:14-23`, `:169-172` — named but unreachable | unchanged |
| 75 | Cochange phrasing variants + "multi-root" over-match | claimed-only (the fix shipped, **unpinned**) | coordination refusal `src/domain/ask.mjs:2149-2168`, shipped `7f90b03` | **changed**: `7f90b03` makes `is A called by B and C` decline instead of answering about B alone — the exact over-match this row named. **No test drives it**, so by the hard rule the fix is `claimed-only`. Cochange phrasing still unpinned (zero corpus keys mention cochange) |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md:598` R1 | citation refreshed |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md:598` R1 | citation refreshed |
| 78 | Winograd-hard commonsense coreference | claimed-only | `PLAN_AGENTS.md:541,600` R3 | citation refreshed |
| 79 | Shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md:543,600` R3 | citation refreshed |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `test/tools/server.test.mjs:10,22` drives `dispatchTool` + `TOOLS` (rung 1) | **rung upgraded** source-only → tool-layer contract test |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV, provenance) | implemented, no test | `.gitlab-ci.yml:33,55,68-80,187` | unchanged — CI config, nothing in the estate drives it |
| 82 | Predicate "find" queries | implemented, **with a known surface divergence** | rows `grammar.compositional.find` (4), `grammar.compositional.superlative` (4) | **changed**: `show me the untested modules` → 9, `/untested` → 7 (`BENCHMARK_CONVERSATION_2.0.3.md`). No row pins either count |
| 83 | Single-sourced `fnv1a` + wink browser-loader seam | implemented | `src/domain/hash.mjs:13,24,139` | lines shifted |
| 84 | SQLite memory Backend C | implemented | `test/adapters/memory-backend-sqlite.test.mjs` | line shifted |
| 85 | In-memory Backend B | implemented | `test/adapters/memory-backend-memory.test.mjs` | line shifted |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `e2e/import-file.test.mjs`; `e2e/chat-prompt.test.mjs:21` drives the real binary | **rung upgraded** source-only → e2e |
| 87 | Default human-world persona + size tiers | implemented | `corpus/tier2/human*.jsonl`, `manifest.json` | **path dead**: `PLAN_SEED.md` archived (`8cfc8c4`) then removed |
| 88 | `graphService` wired into completions | implemented | `test/adapters/chat-completions-graphservice.test.mjs:41,61,78,105` | **rung upgraded** source-only → wiring test |
| 89 | Public completions exports | implemented | `package.json:46-47` | **changed**: both now resolve to `./src/services/completions.mjs` |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | **process retired** (the fixes stand) | skill deleted at `5bd853a`; commits `21eb6a2`, `d04a926` still in history | **status change**: `implemented` → retired. Evidence path dead |
| 91 | Persona-sweep as the conversation bench's default | process change | `SKILL_BENCHMARK_CONVERSATION.md:49,412` | unchanged; `BENCHMARK_CONVERSATION_2.0.3.md` ran as a sweep, confirming it in practice |
| 92 | Multi-candidate ambiguity resolution | implemented | row `template.ambiguity.multi-reading` — asserts both "could mean more than one thing" and each reading's real answer | **rung upgraded** source-only → keyed row. `--gaps`: `template.ambiguity` has **no negative row** |
| 93 | Memory-graph-aware `spiralExpand` | implemented (library-level, not CLI-wired) | `test/adapters/codegraph.test.mjs:1280` drives it over a real memory graph | **evidence changed**: two of three cited symbols **gone** (`b8a4b9a`); generalization survives as params at `codegraph.mjs:670-678` plus a new `hubDegree` gate. Still one `src/` caller |
| 94 | Edge/node provenance timestamps | **partial** (derived half removed) | `test/adapters/memory-core.test.mjs`; `core.mjs:25,816-846,692,777` | **status change**: `implemented` → `partial`. `derivedUpdatedAt` dropped at `56b4365`; a stale comment at `core.mjs:83` still points at it. Stamping half intact |
| 95 | Reverse fact-cascade query shapes | implemented | rows `inference.capability.corpus-readers`, `inference.hasa.corpus-readers`, `inference.reverse-predicate.by-object`, `.guard` (negative) | **rung upgraded** source-only → four keyed rows incl. a guard |
| 96 | Forward-shape `entityType` grain-checking | implemented | `test/tools/ask.test.mjs:1325` — declines honestly, never names the wrong grain (rung 1) | **rung upgraded** source-only → tool-layer test |
| 97 | Possessive-named-instance teach shape | implemented | rows `games.teach-then-infer.possessive` + a negative guard ("my cat is fluffy" must not teach) | **rung upgraded** commit citation → two keyed rows |
| 98 | Bare known class/entity name → describe/focus | implemented, **thin evidence** | row `grammar.bare-entity.camelcase` | **rung upgraded** commit → keyed row. `--gaps` flags `grammar.bare-entity` as **both thin and having no negative key** |
| 99 | Capability router invocation surface (`tmct plan`, `/plan`, `./plan`) | implemented | `e2e/plan-cli.test.mjs`; 11 `planning.route.*` rows | pre-existing row appended to 1.7.3 post-pin by `eed1cd7`; now corpus-driven |
| — | `PLAN_ADVENTURE.md` | claimed-only, RESEARCH/DESIGN | `PLAN_ADVENTURE.md` header | unchanged; all four of its own gaps re-checked open (no `parseImperative`, no NPC scheduler, no Ashcombe corpus, no `hasExit`) |

### Rows 100-138 — new work since `981c9b2`

Found by reading all 399 commit subjects, diffing the corpus key list, and checking `exports`,
npm scripts, CLI verbs and the `TOOLS` table. Every row here is **new work, not a prior miss**:
none of these capabilities existed at 1.7.3, so there was no row to get wrong.

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 100 | Five-layer `src/` architecture, downward-only imports enforced | implemented | `test/estate/import-layers.test.mjs`; `test/estate/layer-allowlist.mjs` carries **1** violation | NEW — no layering existed to check at 1.7.3. The allowlist can only shrink; its one entry is a documented decision (`createRequire` keeps wink out of the 477KB browser bundle), not open work |
| 101 | Keyed corpus-lane test estate | implemented | `test/corpus/run-lane.mjs`, `test/estate/corpus-schema.test.mjs`, `scripts/corpus-matrix.mjs --gaps`; **11 lanes / 784 rows / 368 keys** | NEW — the whole estate postdates the pin. ~60 flat scripted-dialogue suites purged behind an lcov coverage-compare gate |
| 102 | e2e tier: real binary + real browser | implemented | `e2e/cli-smoke.test.mjs`, `e2e/browser-chat.test.mjs` | NEW |
| 103 | README examples run against the live product | implemented | `test/readme/readme.test.mjs`, `e2e/readme-examples.test.mjs` | NEW — a documented example that stops working now fails the suite |
| 104 | Plan lane — teach a game, state a goal, solve it, step it | implemented | rows `planning.solve.hanoi`, `planning.execute.next`, `planning.goal.verbless` | NEW — retires row 44's `claimed-only` verdict |
| 105 | Generic action interpreter + action `Rule` family | implemented | rows `planning.legal.one-ply`, `planning.legal.river-constraints`; `test/adapters/memory-rules-action.test.mjs` | NEW |
| 106 | Taught-action registry seam (`registerCapability`) | partial | row `planning.route.taught-action`, `e2e/domain-crates.test.mjs`; mechanism itself unit-ring only | NEW |
| 107 | River-crossing domain | implemented | rows `planning.execute.river`, `planning.legal.river-constraints`; `e2e/domain-river.test.mjs` | NEW — solves in the classic 7 |
| 108 | `/capabilities` listing + `tmct plan --tools` taught names | implemented | rows `planning.capabilities.listing`, `.readback`; `e2e/plan-cli.test.mjs` | NEW |
| 109 | `tmct viz` ledger memory explorer + in-page chat dock | implemented | `e2e/ledger-viz-cli.test.mjs`, `e2e/ledger-viz.test.mjs`, `e2e/browser-chat.test.mjs` | NEW — supersedes the node-link page |
| 110 | Animated self-contained plan render + `chat --render/--output` | partial | `e2e/chat-prompt.test.mjs` drives `--render`; `test/adapters/plan-viz.test.mjs` | NEW. A board-geometry defect fixed today (`564abce`) had no benchmark scalar — see §4.4 |
| 111 | `chat --prompt` one-shot turn runner | implemented | `e2e/chat-prompt.test.mjs` | NEW |
| 112 | `tmct import --file` | implemented | `e2e/import-file.test.mjs` | NEW |
| 113 | `--memory-backend` + `tmct.toml [memory]` | implemented | `test/tools/cli-args.test.mjs`, `test/adapters/chat-memory-backend.test.mjs`, `e2e/init.test.mjs` | NEW — surfaces rows 84/85's backends to a real user |
| 114 | `extract:facts` over a document | partial | `test/adapters/extract-facts-from-text.test.mjs` drives `main()` in-process; **no real-binary e2e** | NEW |
| 115 | WordNet → ConceptNet-shape conversion | implemented | `e2e/init.test.mjs:729`; `test/adapters/corpus-wordnet.test.mjs` | NEW |
| 116 | Open English Namenet top-up bundle | implemented | `e2e/init.test.mjs:734`; `test/adapters/corpus-namenet.test.mjs` | NEW |
| 117 | `init:xl` / `init:xxl` scale presets | implemented | `e2e/init.test.mjs:643-708` (±10% bundle totals) | NEW |
| 118 | Seed-side O(n) index + per-turn `factRows` memoisation | implemented | `test/adapters/memory-seed-perf.test.mjs` (min-of-5), `test/adapters/chat-factrows-cache.test.mjs` | NEW — `PLAN_GRAPH_SCAN.md` Phases 1-3. `init:xl` 8m25s → 16.6s |
| 119 | Defeasible negation — a negative is a source disagreeing | implemented | rows `inference.capability.base-rate`, `.negative-teach`; `test/adapters/capability.test.mjs` | NEW — `archive/PLAN_DEFEASIBLE_NEGATION.md` DELIVERED |
| 120 | Persisted justification + retraction cascade, 5 rule families | implemented | `test/adapters/syllogise.test.mjs:1089-1200,1233`; rows `inference.retraction.subclass`, `inference.svf1.*` | NEW — `PLAN_SYLLOGIST.md` §3's JTMS slice |
| 121 | Taught-fact retraction wired to chat | implemented | rows `inference.retraction.subclass`, `.honest-miss` | NEW |
| 122 | Multi-valued has/can facts no longer read as contradictions | implemented | `test/adapters/memory-contradictions-cardinality.test.mjs`; `inference.hasa.*` (11 rows) | NEW |
| 123 | Verified paraphrase (closure-backed) | partial | unit ring only: `test/adapters/paraphrase.test.mjs`, `ask-describe-paraphrase.test.mjs` | NEW — **and already chat-wired** at `src/services/chat.mjs:10411-10429`, which `PLAN_PARAPHRASE_VERIFICATION.md` frames as wholly future. No corpus row pins the user-facing surface |
| 124 | Entity comparison ("how is X different from Y") | partial | unit ring only: `test/adapters/compare.test.mjs` | NEW — no corpus row |
| 125 | Comparative frame (teach and ask "X is bigger than Y") | implemented | rows `grammar.teach.comparative-contraction`, `games.relation-touch.comparative`, `inference.comparative.yesno` | NEW |
| 126 | Dynamic memory-class list/count | partial | unit ring only: `test/adapters/ask-memory-class-query.test.mjs` | NEW. **`answerMemoryCount` has a live wrong answer** — see §4.4 |
| 127 | Plural anaphora ("those"/"them") | implemented | `grammar.anaphora.*` (16 rows) | NEW |
| 128 | Deterministic answer-phrasing variety across 8 hit templates | implemented | `templates` lane; `template.conversational` (18 rows) | NEW |
| 129 | Canonical query/fact representation echoed on ask and teach | implemented | canonical assertions across `grammar`/`inference`/`planning`/`templates`; `planning.goal.no-canonical` | NEW — computed at 1.7.3, never shown. **This is now the product's best self-diagnostic**: it exposed both the modal-negation inversion and the fronted-agent passive by printing `forward` where the question asked for `reverse` |
| 130 | Tool catalog + README tool section generated from `TOOL_DEFINITIONS` | implemented | `test/estate/tool-docs.test.mjs` | NEW — the docs derive from the declared surface instead of describing it by hand |
| 131 | Browser ask bundle + committed-artifact drift guard | implemented | `test/estate/generated-artifacts.test.mjs:47`, `e2e/memory-ask-browser-bundle.test.mjs` | NEW |
| 132 | Pages home: chat-led hero, real transcript, plan render, derived version stamp | implemented | `e2e/pages-home.test.mjs`, `test/estate/page-version-stamp.test.mjs` | NEW |
| 133 | Licence & PII quality gates | implemented | `test/estate/pii.test.mjs`, `corpus-licences.test.mjs`, `links.test.mjs`, `pack.test.mjs` | NEW |
| 134 | Set-complement / modal-negation restated in tmct's own grammar | implemented | rows `grammar.negation.set-complement` (5), `.guard` (3), `.frame` | NEW — extends row 70 to the chat surface. `playtests/PLAYTEST_LOG_002.md` |
| 135 | Seven chat lanes for questions that previously had none | implemented | rows across `grammar`/`inference`/`planning`/`templates`/`games.drilldown` at `02d7601` | NEW |
| 136 | `/narrate` developer trace mode | implemented | rows `template.narrate.toggle`, `.annotated-shapes`, `.unknown-arg` | NEW |
| 137 | `/why` proof rendering | implemented | row `template.proof.why-isa` | NEW |
| 138 | `tmct viz --depth/--limit/--focus/--term` | implemented | `e2e/ledger-viz-cli.test.mjs` | NEW |

### Rows 139-152 — the §3 superset: what the two plans lean on

`SKILL_CAPABILITIES_AUDIT.md` §3 asks for a status on everything `PLAN_NLU_BENCHMARKS.md` would
measure and everything `PLAN_AGENTS.md` leans on, **including capabilities the product does not
have** — marked `absent`, with the plan that wants them named. That is the point: both plans then
rest on a foundation that tracks reality rather than recollection.

| # | Capability | Status | Evidence | Wanted by |
|---|---|---|---|---|
| 139 | Utterance → intent label from a fixed vocabulary | absent | no `nlubench/`, no intent-label vocabulary; `clinc`/`hwu64` appear only in plan prose | `PLAN_NLU_BENCHMARKS.md` |
| 140 | Out-of-scope refusal + the miss wall (`miss: true`, `WALL_MISS_RE`) | implemented | rows `games.honest-miss` (6), `template.miss`; CEFR tag `honesty-miss` **2.000/2** (n=5, `BENCHMARK_CEFR_ENGLISH_2.0.3.md`) | `PLAN_NLU_BENCHMARKS.md` |
| 141 | Entity and slot extraction | partial | `resolveObject` (`src/domain/ask.mjs:2387`) resolves entities; no slot-filling layer. **The sceptic showed unknown-token residue is dropped rather than slotted** (`BENCHMARK_CONVERSATION_2.0.3.md`) | `PLAN_NLU_BENCHMARKS.md` |
| 142 | Token/lemma normalisation through wink-nlp | implemented | row `grammar.normalize` (19); `src/adapters/wink-model.mjs` | `PLAN_NLU_BENCHMARKS.md` |
| 143 | Synonym / hypernym expansion from corpus rows | implemented, on by default | `test/adapters/wiring-facts-memory.test.mjs:146,172` — live `runTurn` lane 3b (row 37) | `PLAN_NLU_BENCHMARKS.md` |
| 144 | IDF-weighted ranking (`retrieveBlocks`) | implemented, on by default | `src/adapters/memory/blocks.mjs:174,200` — relevance × connectivity × trust, hub-dampened | `PLAN_NLU_BENCHMARKS.md` |
| 145 | Cross-domain false accept — the lane that fires when it should not | **partial, and this cycle found live instances** | no false-accept inventory exists; but see the six-member dropped-input family above — `what would break if I change X` firing the `touches` lane is exactly this | `PLAN_NLU_BENCHMARKS.md` |
| 146 | Short-utterance handling + the conversational catch-all | implemented | CEFR tag `conversational` **2.000/2** (n=6); rows `template.conversational` (18) | `PLAN_NLU_BENCHMARKS.md` |
| 147 | Read-only session guarantee during a scored run | implemented | `chatbench/run.mjs:4-11` — turns-mode drives pure `runTurn()` against the committed fixture, no session side-effects | `PLAN_NLU_BENCHMARKS.md` |
| 148 | Determinism / byte-identical reruns | implemented | verified this cycle: the AGENT goal arm re-ran byte-identical (stamp stripped); INFBENCH 0 verdict changes across 299 rows vs 1.7.0 | both plans |
| 149 | OWL property reasoning + Horn-rule teaching | implemented | rows `inference.relation` (30), `inference.teach-lane` (13); `test/adapters/memory-rules.test.mjs` | `PLAN_NLU_BENCHMARKS.md` |
| 150 | Proof rendering + planner consumption of taught records | implemented | row `template.proof.why-isa`; `planning.route.taught-action`; `src/domain/router/taught.mjs` | both plans |
| 151 | Consistency checking as a service (`tmct check` / an MCP tool) | absent | `consistencyCheck` has zero hits in `src`/`test`/`bin`/`scripts`. The kernel exists (row 22) but no service surfaces it | `PLAN_CONSISTENCY_CHECK.md`; INFBENCH's 20 INF-C2 cases are a ceiling waiting to grade it |
| 152 | Explicit-teaching surface a scrape pipeline would feed | partial | `tmct import --file` (row 112) and `extract:facts` (row 114) both exist; no scrape pipeline calls either | `PLAN_AGENTS.md` Phase 4 |

## 4.1 Comparative agent-capability table

tmct is a narrow, deterministic, zero-cost system. It does one thing a general model does not:
**it cannot make anything up, because it has nothing to make things up with.** Every answer is a
traversal of a stored graph, and where the graph is silent the product says so. That is worth
placing on a scale a reader already knows, and the placement is lopsided by design — tmct is
stronger than a frontier model on exactly one axis and weaker on nearly every other. This is not an
"as smart as" claim, and the shape of the table is the point rather than any single cell.

Model-column verdicts are **informed estimates from public capability tiers, not a measured
cross-benchmark result** — no run in this repo scores Sonnet or Llama. They are re-confirmed
against the current capability each cycle rather than copied forward. Columns are named, specific
models: never an umbrella brand (`Anthropic` is a company) and never a hosting surface
(`AWS Bedrock` hosts several vendors).

### Quick reference — verdict word only, relative to tmct

```
                          tmct    Claude Sonnet 5           Llama 3.1 8B Instruct
tool use                  ----    Comparable                Weaker
planning                  ----    Comparable-to-stronger    Weaker
reasoning (formal)        ----    Comparable                Weaker
reasoning (open-world)    ----    Stronger                  Stronger
grounding                 ----    Comparable                Weaker
memory                    ----    Comparable-to-stronger    Weaker
instruction-following     ----    Stronger                  Stronger
generation                ----    Stronger                  Stronger
coding                    ----    Stronger                  Stronger
safety / honesty          ----    Weaker                    Weaker
autonomy                  ----    Stronger                  Stronger
breadth                   ----    Stronger                  Stronger
cost / determinism        ----    Weaker                    Weaker
```

### The full table

| Axis | tmct (every cell cites a report + version) | Claude Sonnet 5 | Llama 3.1 8B Instruct |
|---|---|---|---|
| **tool use** | 56/56 cases, 100% plan-completion, 100% result-completion, **0% hallucination** on every rung A0→C2 (`BENCHMARK_AGENT_2.0.3.md`, goal driver). 22 declared tools, 3 dispatched hot. | **Comparable.** Broader tool vocabulary and handles undeclared tools; but no 0%-fabrication guarantee — it will invent a plausible call. | **Weaker.** Tool-calling is unreliable at this size; malformed calls are routine. |
| **planning** | Same 56/56 with a proof attached. Hanoi solves to the 2³−1 optimum, river crossing to the classic 7 (`BENCHMARK_AGENT_2.0.3.md`, `BENCHMARK_CONVERSATION_2.0.3.md`). **But**: a board taught across two lines yields `3 moves (shortest)`, illegal on move 1 (`BENCHMARK_CONVERSATION_2.0.3.md`). | **Comparable-to-stronger.** Plans over open domains tmct cannot represent at all, and is not derailed by a sentence boundary. Weaker on optimality guarantees. | **Weaker.** No reliable multi-step decomposition. |
| **reasoning (formal)** | 219/219 chat, 80/80 kernel, 0% fabrication, all six bands (`BENCHMARK_INFERENCE_2.0.3.md`). **Read with its ceiling**: 50 of the 219 greens grade against a declared floor. | **Comparable.** Handles the same syllogisms and much more, without the closed vocabulary — but not soundly: no proof, and it will assert an unentailed conclusion. | **Weaker.** Fails multi-hop chains. |
| **reasoning (open-world)** | Absent by construction. Off-vocabulary requests land on the honest miss wall (`games.honest-miss`). | **Stronger.** This is the axis a language model is for. | **Stronger.** |
| **grounding** | groundedness **1.857/2** over 98 scored cases (`BENCHMARK_CEFR_ENGLISH_2.0.3.md`, N=1). Every answer carries a source; an empty graph says it is empty (`bootstrap-empty` **2.000/2**). | **Comparable.** Excellent grounding with a retrieval surface; no per-fact provenance by construction. | **Weaker.** Confabulates sources. |
| **memory** | An OWL-labelled graph on disk with per-fact provenance, trust, contradiction detection and retraction cascade (rows 22-27, 119-122). Snapshots are Backend-A only. | **Comparable-to-stronger** in practice: larger effective context and better recall over unstructured history — but no durable, inspectable, retractable store. | **Weaker.** Context only. |
| **instruction-following** | Not a capability tmct has. It follows a grammar, not instructions. | **Stronger.** | **Stronger.** |
| **generation** | rephrase **1.767/2** over 30 scored cases (`BENCHMARK_CEFR_ENGLISH_2.0.3.md`). Deterministic templates with 8 phrasing variants (row 128). | **Stronger**, by a distance. | **Stronger.** |
| **coding** | Absent. tmct reads graphs; it does not index code (`README.md`). seonix does the indexing and calls tmct. | **Stronger.** | **Stronger.** |
| **safety / honesty** | **The axis tmct wins.** honesty **1.883/2** (n=60); `honesty-miss`, `bootstrap-empty`, `typo-fuzzy`, `conversational` all **2.000/2** (`BENCHMARK_CEFR_ENGLISH_2.0.3.md`). 0% hallucination across 168 agent rows and 0% fabrication across 299 inference rows. An adversarial sceptic could not force a role or polarity inversion in 55 probes (`BENCHMARK_CONVERSATION_2.0.3.md`). | **Weaker** — not because it is careless, but because it *can* fabricate and tmct cannot. Refusal is a trained behaviour, not a structural one. | **Weaker.** |
| **autonomy** | None, deliberately. No loop in the product path; the only LLM in this repo is the offline judge. | **Stronger.** | **Stronger.** |
| **breadth** | 664 default seeded facts (`human`), 12,001 at `human-large`; a closed relation vocabulary of 10 and 11 edge kinds. | **Stronger**, by orders of magnitude. | **Stronger.** |
| **cost / determinism** | **$0 per turn, and byte-identical on rerun** — verified this cycle (the AGENT goal arm re-ran byte-identical; INFBENCH showed 0 verdict changes across 299 rows vs 1.7.0). Product replay of 109 cases: **877ms**. | **Weaker.** Priced per token; temperature-0 is not byte-identical across model versions. | **Weaker**, though cheap. |

**The honest summary of this table**: tmct's cells are narrow and its numbers are high inside that
narrowness. The single row where it beats both models is safety/honesty, and the six confident-wrong
answers this cycle found are all attacks on exactly that row — which is why they matter more than
their small count suggests. None of them is a fabrication; all are the product answering a question
it misread. That is a different failure mode, and a fixable one.

### Speculative TO-BE

Drawn from the four current reports' own decision lines and `NEXT.md`'s ranked follow-ups.
**Not a roadmap commitment.** Each was checked against the tree to confirm it has not already
shipped.

- **Restore the fronted-agent passive** — `BENCHMARK_CEFR_ENGLISH_2.0.3.md`'s named pick. Bisected,
  mechanism understood, sits in the pool's worst construction (1.600).
- **Split a teach-only line into sentences** — the Hanoi board collapse. The single highest-value
  fix in the cycle: it is the only finding where a proof-shaped artifact is illegal on move one.
- **Distinguish ∃ from ∀ on the teach side** — stop `some men are fathers` becoming a universal that
  the reasoner then proves.
- **Grow CHATBENCH to the 14 untested shapes** — `graded-pool-max.jsonl` already holds all 36 cells;
  the lightest full-coverage run is 315 cases. A blind spot is where the next `98df45a` lands
  unnoticed, and this one already did.
- **A consistency checker** (`PLAN_CONSISTENCY_CHECK.md`) — INFBENCH's 20 INF-C2 cases are a ceiling
  built to grade it the day it exists.
- **A deeper INFBENCH band** — at 219/219 the ladder measures the generator's reach, not the
  prover's.
- **Pin the fronted-agent passive and the `/untested` divergence with corpus rows** — both are
  unpinned surfaces, which is why both drifted silently.

## 4.2 Per-benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md`
- Ladder A0→C2 across three drivers, 56 cases each, 0% hallucination on every rung — **complete** (`BENCHMARK_AGENT_2.0.3.md`)
- Goal driver clears C2; `ab-c2-what-to-test` composes, retiring the standing red — **complete** (`BENCHMARK_AGENT_2.0.3.md`)
- Resolver floor gates at C2 by design; stub floor at B1 (a new arm this report) — **complete** (`BENCHMARK_AGENT_2.0.3.md`)
- Determinism verified byte-identical on rerun — **complete** (`BENCHMARK_AGENT_2.0.3.md`)
- A case set that still discriminates: all 11 C2 cases are green, so the ladder now has more headroom than the corpus — **todo**
- The resolver floor's `ab-c2-what-to-test` plan regression (36% → 27%), unexplained — **todo**

### `SKILL_BENCHMARK_CEFR_ENGLISH.md`
- Judge pinned (`claude-haiku-4-5-20251001`, `judge-prompt-v1`), `voidCount` 0 — **complete** (`BENCHMARK_CEFR_ENGLISH_2.0.3.md`)
- Mean 1.801/2 over 109 cases; 81 of 109 score a clean 2/2 — **complete** (`BENCHMARK_CEFR_ENGLISH_2.0.3.md`)
- The deterministic tier-1 comparison against 1.8.0, which caught the regression the judge mean would have hidden — **complete** (`BENCHMARK_CEFR_ENGLISH_2.0.3.md`)
- Coverage of the 14 untested construction shapes — **todo**
- Judge sampling at N≥2 (the operator chose N=1 this cycle) — **todo**
- The fronted-agent passive regression, bisected to `98df45a` — **todo**

### `SKILL_BENCHMARK_CONVERSATION.md`
- Persona-sweep mode, five genuinely different frames in parallel, ~200 probes — **complete** (`BENCHMARK_CONVERSATION_2.0.3.md`)
- §0.1's mandatory canonical examples tested verbatim before any exploration — **complete** (`BENCHMARK_CONVERSATION_2.0.3.md`)
- Tier 0 greeting/identity clean in both the seeded and `TMCT_NO_SEED=1` states; the 0.9.12 dead-end is genuinely fixed — **complete** (`BENCHMARK_CONVERSATION_2.0.3.md`)
- Ratcheting the ladder above Tier 0 — **todo** (`tell me about a dog`)
- The README headline `what talks to the payment module?` — **todo**

### `SKILL_BENCHMARK_INFERENCE.md`
- Six-band ladder, both arms, 219/219 chat and 80/80 kernel at 0% fabrication — **complete** (`BENCHMARK_INFERENCE_2.0.3.md`)
- Drift check against 1.7.0: 0 verdict changes across 299 rows — **complete** (`BENCHMARK_INFERENCE_2.0.3.md`)
- `b2ChainLenK`'s ceiling — chat-layer proof materialization for chains the kernel already derives — **todo**
- `c2Inconsistent`'s ceiling — a consistency checker — **todo**
- A band deeper than INF-C2, and an existential probe (INFBENCH's ladder is green through C2 and does not see `some men are fathers`) — **todo**
- `infbench/cases.jsonl` reproducibility: the generator re-draws every case when the lexicon moves — **todo**

## 4.3 Per-plan feature-support (Done / Doing / Todo)

Fourteen live root plans, plus `archive/`'s single file. Each pin is the last commit that touched
the plan file. Where a plan's own account and the tree disagree, **the tree wins and the bullet
says so**. `PLAN_PURGE.md` is untracked, owned by another session, and deliberately excluded.

**Three plans understate what already shipped, all in the same direction** — a plan is likelier to
be stale about its own delivery than about its remaining scope. And two plans argue from a premise
the tree has overtaken.

#### `PLAN_ADVENTURE.md` — pinned at `6d6fff8`
- **Done** — only the generic substrate it relies on: snapshot-per-step world state (`planning.execute.next`), taught action rule kinds (`core.mjs:1112-1118`), router registration (`src/domain/router/taught.mjs`).
- **Doing** — none.
- **Todo** — all four of its own gaps, re-checked open: no `parseImperative` (`lexicon-core.json:8548` still holds an empty `"imperative": {}` stub), no NPC scheduler, no Ashcombe Hall corpus, no `hasExit`/`currentlyIn`.

#### `PLAN_AGENTS.md` — pinned at `6d6fff8`
- **Done** — HTTP shim (`e2e/server-http.test.mjs`, 10 tests on a real port); RI 1.1.0 / 16 services / 4 miss reasons; tool layer 22/3 (`test/tools/`, 16 files); router 15 capabilities invokable three ways (`e2e/plan-cli.test.mjs`); extension-pack seam, bias ranking, memory versioning, actor trust; the source-slice traversal guard.
- **Doing** — Phase 1, both items dormant and accurately described: unknown-word ingestion behind `captureUnknownContext = false` with no production caller; the wider seed set registered `active: false`.
- **Todo** — Phases 2-5 not started (no `seon-mcp`, `copilot`, `chat/completions` in `src/` or `bin/`). **Its "six fixes are open" count is stale — four are**: `98df45a` flipped two frozen-wrong rows, which were renamed to record the new behaviour. Still genuinely frozen-wrong: `games/honest-empty-echoes-raw-pronoun`, `games/temporal-adverb-read-as-object-term`, `games/bare-type-discourse-filter-unbuilt`, `games/cross-turn-temporal-composition-unbuilt`. §1's goal-reasoner row is now independently true (`BENCHMARK_AGENT_2.0.3.md`).

#### `PLAN_CHILD_CORPUS.md` — pinned at `0f8fb61`
- **Done** — nothing, and it claims none. Its pipeline citations resolve.
- **Doing** — none.
- **Todo** — all five steps. `NEXT.md`'s framing checks out: steps 1 and 4 are decisions gating everything mechanical after them. **Its baseline numbers need a correction pass before they can serve as its own step-5 re-measure target**: most verify exactly (664 facts; 44,947 slice lines; 231 `CapableOf`; zero `fly` in the slice), but "1 kind of bird (`owl`), zero capabilities on it" is wrong — `human.jsonl` seeds `owl` **and** `swift`, and `owl` carries `CapableOf hunt_at_night`. The argument survives; the acceptance test does not.

#### `PLAN_CLASS_QUERY.md` — pinned at `6d6fff8`
- **Done** — the item it was commissioned to design shipped before it (`dec95e8`): `resolveDynamicClass`/`dynamicClassQuery` (`ask.mjs:3705-3721`), pinned by `test/adapters/ask-memory-class-query.test.mjs`.
- **Doing** — none.
- **Todo** — all five phases. **Its Finding 2 is a live wrong answer and the smallest diff in this audit**: `answerMemoryCount` (`chat.mjs:692-701`) has no tail check, so `how many facts about horses are there` returns the unrestricted total (verified live). Findings 1/3/4 rest on a repro table with no row or test behind it — located, not established.

#### `PLAN_CODE.md` — pinned at `6d6fff8`
- **Done** — Track 1, all five staged units: `synthbench/rules/*`, `synthbench/phrasing/*`, pinned by `test/adapters/synth-{rules,phrasing}.test.mjs` (16 tests). The default-preserving `ruleSet` seam is real (`goal-reasoner.mjs:86,165`).
- **Doing** — none.
- **Todo** — Tracks 2-4. **§5's load-bearing premise has gone stale**: it argues tmct carries no browser-adjacent dependency, but `package.json:74` now has playwright 1.61.1 for the browser e2e tier. The dependency-weight tradeoff it stages as the big ask has already been paid for an unrelated reason. What is still a first for this repo is the untrusted-code-execution surface (§8).

#### `PLAN_CONSISTENCY_CHECK.md` — pinned at `0f8fb61`
- **Done** — nothing built. Its "mostly assembly" inventory resolves.
- **Doing** — none. `consistencyCheck` has zero hits in `src`/`test`/`bin`/`scripts`.
- **Todo** — build steps 1-4, plus two open questions it raises: backend layering (the store is one backend at a time) and the MCP-vs-`serve` surface decision. Its hardest prerequisite is already met — the sourced negatives it needs ship (`archive/PLAN_DEFEASIBLE_NEGATION.md`).
- **Benchmark tie** — `BENCHMARK_INFERENCE_2.0.3.md`: `c2Inconsistent`'s 20 INF-C2 cases grade 20/20 against a ceiling that expects the engine to answer from contradictory memory *without noticing*. The band is built to grade a checker the moment one exists. **Those 20 greens are not evidence of any capability here.**

#### `PLAN_GRAPH_SCAN.md` — pinned at `4d98b3b`
**Its banner is false.** It reads "RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code." All three phases shipped.
- **Done** — Phase 1 seed-side index (`MEMORY_INDEX`, `core.mjs:552-573`, `6ee6610`), pinned by `test/adapters/memory-seed-perf.test.mjs:65`. Phase 2 per-turn memoisation (`factRows`, `chat.mjs:4916`, `426e9dc`), pinned by `test/adapters/chat-factrows-cache.test.mjs:33,85`. Phase 3's exit criterion met and beaten: `init:xl` 72,075 facts in **16.6s** (was ~8m25s); `init:xxl` 238,866 in **38.5s** (was unfinished past 70 minutes).
- **Doing** — none.
- **Todo** — nothing in its build scope. Housekeeping: the banner, and pre-refactor line numbers throughout. The original query-side question — what made "what is a horse" take 13 minutes — is nowhere recorded as resolved; the seed-side numbers make the premise moot in practice without answering it.

#### `PLAN_GUESS_NUMBER.md` — pinned at `6d6fff8`
- **Done** — the shipped planner it builds on, not its own scope.
- **Doing** — none.
- **Todo** — all three phases; its banner is exactly true. Zero hits for `guesser`, `thinker`, `bisect`, `lastHint`, `thinking of a number`.

#### `PLAN_MUD.md` — pinned at `4d98b3b`
- **Done** — only the backend baseline: `createInMemoryStore`/`createSqliteMemoryStore`/`openMemoryBackend` (`core.mjs:155,180,200`), pinned by two adapter suites.
- **Doing** — none.
- **Todo** — all six phases. No `dynamodb`/`@aws-sdk`/`identityPoolId` anywhere; the backend flag is still closed-set; no `handle:` provenance kind (`chat.mjs:4855` hardcodes `you told me:`); no `tmct server create`.

#### `PLAN_NLU_BENCHMARKS.md` — pinned at `c2d88e4`
- **Done** — nothing in-repo. `nlubench/` does not exist.
- **Doing** — none.
- **Todo** — steps 0-5, levers L1-L8. Its own spike table is **self-declared unreproducible** ("scripts not yet in-repo") and every ladder delta is measured against it, so no figure in that section is established evidence. Stale on the estate it describes: "723 rows" is now **784 / 11 lanes / 368 keys**; "the grammar lane's 224 rows" is now **233**.
- **Unincorporated finding** — `BENCHMARK_CEFR_ENGLISH_2.0.3.md` reports CHATBENCH blind to 14 of 23 shapes, with a real tier-1 regression sitting unnoticed behind that blind spot. That is this plan's own confident-wrong failure family, already measured on an existing scale.

#### `PLAN_PARAPHRASE_VERIFICATION.md` — pinned at `6d6fff8`
- **Done** — the isa-family slice, and it reaches further than the plan says. `verifySubClassParaphrase`/`paraphraseVerifiedSubClass` (`src/domain/paraphrase.mjs:73,94`), pinned by `test/adapters/paraphrase.test.mjs` — including that swap detection is a closure-derived contradiction, not string inequality. **The slice is already live-wired into chat** (`chat.mjs:10411-10429`), which the plan frames as wholly future.
- **Doing** — none beyond that slice.
- **Todo** — Phases 1, 2, 4, and Phase 5, correctly unbuilt (its generator does not exist). `verifyParaphrase`: zero hits.

#### `PLAN_REPO_INDEX.md` — pinned at `6d6fff8`
- **Done** — nothing of its own, correctly. Its baseline crux verifies: no parser (`acorn`/`@babel/parser`/`tree-sitter`/`typescript` all absent), and `buildEntities()` has zero non-test callers.
- **Doing** — none.
- **Todo** — all six phases. **Its citations have drifted enough to mislead a verifier**: "17 named services" is **16**; `ask.mjs` is 3,869 lines (doc says 4,694); Part 4's README refs do not hold the cited text; Part 1 describes `src/viz.mjs`, a file that no longer exists. Where this plan and `PLAN_AGENTS.md` §2.2 contradict each other, the tree backs `PLAN_AGENTS.md`.
- **A rationale gone stale** — Part 3/7's "playwright appears nowhere in tmct's `package.json`" is false. The "move `PLAN_CODE.md` to seonix" argument rests on it and needs re-making on other grounds.

#### `PLAN_SYLLOGIST.md` — pinned at `4d98b3b`
- **Done** — §3's JTMS-shaped single-justification slice, complete and tested: `retractSubClassOf` (`syllogise.mjs:997`) with a bounded re-verified cascade (`:894`, called `:1026`), pinned by `test/adapters/syllogise.test.mjs:1089-1200` (no-op when absent, cascade, multi-hop, a second derivation surviving, budget-truncated). Per-rule retraction across all five families.
- **Doing** — none. No half-landed slice.
- **Todo** — §2 incrementality (no alpha/beta network; `deriveSubClassClosure` still takes a fresh snapshot per call — RETE is a citable algorithm, Forgy 1982, not yet ported). §3's ATMS generalization: `justification` is a single flat id list, last-write-wins, not an environment set. §4 and §5 are notes only. No settled engineering exists yet for the combination §3 wants — multi-trust-tier, hard-budget, retraction-safe: Doyle's JTMS and de Kleer's ATMS solve retraction, DRed/RDFox solve incremental maintenance, and nobody has published the join. Until a tier is designed, these land on the honest miss wall.

#### `PLAN_SYLLOGIST_EL_DL.md` — pinned at `bfe70da`
- **Done** — nothing; verified zero-code, exactly as its banner says. Its negative claims all check out (`unionOf`/`complementOf`/`oneOf`/`differentFrom` return zero hits across `src/**` and `ontology/*.ttl`).
- **Doing** — none.
- **Todo** — steps 0-5; step 0 (phase-0 representation) is the real gate and fully open. One correction: its "Where the edge shifts" section still lists defaults and exceptions (*birds fly; penguins don't*) as an undesigned future tier — that shipped and is archived.

#### Archived, no open scope
- **`archive/PLAN_DEFEASIBLE_NEGATION.md`** (pinned at `0f8fb61`) — DELIVERED, correctly archived. All five build items are test- or corpus-backed (`src/domain/memory/capability.mjs`, `test/adapters/capability.test.mjs`, eight `inference.capability.*` keys). The strongest evidence is that the pin it said must be rewritten *was* rewritten rather than deleted: `inference.capability.negative-teach` now asserts `^no —` plus both premises — the exact inversion of the refusal it documented as the starting state.

## 4.4 Non-benchmarked capabilities

Real, shipped work no benchmark's scalar reaches. Named so that "no benchmark moved" does not read
as "nothing happened" — this cycle, a great deal happened that no number here records.

- **The five-layer `src/` re-home** (row 100). The largest single change in the 399 commits, and the
  reason the tree is 2.0.0. No benchmark scores architecture. Its evidence is the ratchet: a
  downward-only import checker whose allowlist can only shrink and currently holds one documented
  decision. INFBENCH's 0-verdict-changes-across-299-rows is the closest thing to a measurement that
  the re-home broke nothing in the prover.
- **The corpus-lane estate itself** (row 101). 784 rows across 11 lanes replaced ~60 flat
  scripted-dialogue suites, each purge gated by an lcov A-vs-B compare proving no legacy-only
  covered lines. The estate is the instrument the benchmarks are scored against; nothing scores the
  instrument.
- **The ledger and plan-viz surfaces** (rows 109, 110, 138). No benchmark scalar touches a rendered
  page. A real defect fixed today (`564abce`) shows why that matters: the plan board was drawing
  **every individual in memory** as an anchor, so a memory taught a vocabulary put every noun it
  knew on the Hanoi board and squeezed the three real pegs to x=2, 5 and 9 on a 640px board. Caught
  by looking at it. Five regression tests now pin it.
- **The CI quality pipeline** (rows 81, 133). `semgrep-sast`, `secret_detection`, `dep:audit` +
  OSV-Scanner, `pii:lint`, `license:deps`, `links:check`, `pack:contents`, `publish --provenance`.
  Eight jobs, and the estate drives none of them — they are CI config, so they are `implemented, no
  test` by the audit's own rule.
- **Determinism and cost.** $0 per turn and byte-identical on rerun is a property no rung measures,
  and it is the property the whole design exists to buy. Verified twice this cycle rather than
  assumed.
- **The `Canonical:` line** (row 129). Computed at 1.7.3 and never shown; now printed on every ask
  and teach. No benchmark scores it, and it is the product's best self-diagnostic: it exposed both
  the modal-negation inversion (`playtests/PLAYTEST_LOG_002.md`) and the fronted-agent passive by
  printing `forward` where the question asked for `reverse`. A capability that makes other bugs
  visible is worth more than its own row suggests.
- **The seed-side performance work** (row 118). `init:xl` went from ~8m25s to 16.6s and `init:xxl`
  from "unfinished past 70 minutes" to 38.5s. No benchmark has a wall-clock rung; `PLAN_GRAPH_SCAN`'s
  own exit criterion is the only record, and its banner still says the work is unimplemented.

## 5. Refreshing `PLAN_AGENTS.md`

Walked against this table, per `SKILL_CAPABILITIES_AUDIT.md` §5 — a step of this cycle, not a
follow-up.

- **Its ground-truth table (§1) is accurate and needs no correction.** All 16 counts and version
  strings check out against executed code: `INTERFACE_VERSION` 1.1.0, `SERVICES` 16, `EDGE_KINDS`
  11, `MISS_REASONS` 4, `TOOL_DEFINITIONS` 22 (3 hot / 19 cold), registry 15 capabilities. **All ten
  cited `src/` paths resolve** — the five-layer move did not break them.
- **One row was ahead of its evidence and is now vindicated.** §1's AGENTBENCH row claimed "56 cases:
  100% plan / 100% result / 0% hallucination across every rung (fixed 2026-07-12 — no case held
  back)" while `BENCHMARK_AGENT_1.7.0.md` said 98% with `ab-c2-what-to-test` held back.
  `BENCHMARK_AGENT_2.0.3.md` measures 100%/100% on all 56. **The plan was right and the benchmark
  was the stale document** — the reverse of the failure §5 exists to catch.
- **One count is wrong and needs fixing**: §3 claims six open frozen-wrong rows; four are real.
  `98df45a` flipped `games/yesno-call-check-reads-callssymbol-edge` and
  `games/bare-passive-reads-the-patient`, both renamed to record the new behaviour. §3's root-cause
  diagnosis is half-stale with them: `KIND_UNIONS` (`ask.mjs:75`) still omits the edge it names, but
  the yes/no row passes regardless, so that no longer explains an open bug.
- **Its status block does not contradict its body.**

For `PLAN_NLU_BENCHMARKS.md`, where this audit touches what it measures (§3b): its estate figures
are stale (723 → 784 rows; grammar lane 224 → 233), its spike table is self-declared
unreproducible, and `BENCHMARK_CEFR_ENGLISH_2.0.3.md` hands it a live worked example of its own
central failure family — a confident-wrong answer hiding behind a coverage blind spot.

**Both corrections are recorded here rather than applied to the plan files.** This cycle's operator
instruction is measure-and-log; editing `PLAN_AGENTS.md`'s count is a change, and it is mirrored to
`NEXT.md` instead.

## 6. Summary — real counts, grepped

Counts obtained by grepping the status column of the table above, not by eyeballing it.

**151 rows** (98 carried forward from `CAPABILITIES_1.7.3.md`, 39 new work at #100-138, 14 §3
superset rows at #139-152):

| Status | Rows |
|---|--:|
| `implemented` | **114** |
| `claimed-only` | 17 |
| `partial` | 14 |
| `absent` | 3 |
| `reverted` | 1 |
| retired (process) | 1 |
| process change | 1 |

### What flipped since `CAPABILITIES_1.7.3.md`

**Upward — five:**

- **44** Towers-of-Hanoi planning loop: `claimed-only` → `implemented`. The biggest single flip.
  `PLAN_HANOI.md` was archived as delivered (`8fec87c`), so 1.7.3's citation ("not yet implemented")
  no longer resolves and was already wrong when written. Pinned by `planning.solve.hanoi`.
- **42** `findActionPath`: "not wired to a real domain" → wired (`chat.mjs:8983-8986`).
- **61** Telemetry: "not exercised live" → driven by a tool-layer test and a live session.
- **37** ConceptNet Synonym/SimilarTo: default-off → **on by default**, as lane 3b.
- **66** AGENTBENCH ladder: 98% → 100%/100% on every rung.

**Downward — three:**

- **71** Reversible-passive: `implemented` → **`partial`**. The fronted agent answers the inverse,
  confidently. Bisected to `98df45a`. Reported as directly as the progress above, because an audit
  that only tracks one direction is not worth reading.
- **94** Provenance timestamps: `implemented` → **`partial`**. `derivedUpdatedAt` was dropped
  (`56b4365`); a stale comment still points at it.
- **90** `SKILL_AGENT_FAST_LOOP.md`: `implemented` → **retired**. The process is gone; its two fixes
  stand.
- **65** CHATBENCH ladder quality: tier-1 109/109 → 107/109 (a quality move, not a status flip).

### The three findings this audit would lead with

1. **Everything green is only as good as what pins it.** Row 71 regressed because no corpus row
   pinned the fronted-agent passive — four `grammar.passive.*` rows exist and all four pin the
   postposed form. The estate stayed green through a confident inverse for the whole 1.8.x-2.0.x
   line. Row 82's `/untested` divergence (7 vs 9) is unpinned on both sides. Row 75's fix is
   unpinned. Row 36's envelope has been stale for three audits with nothing to catch it.
   `--gaps` names **12 thin keys and 44 key groups with no negative row**; that list is the map of
   where the next silent regression will land.
2. **Citation rot is near-total, and the verdicts survived it.** Roughly half the rows cite a line
   that no longer points at its symbol, and a dozen cite files that no longer exist
   (`test/ask-negation-passive.test.mjs`, `PLAN_SEED.md`, `PLAN_HANOI.md`, `SKILL_AGENT_FAST_LOOP.md`,
   `PLAN_TAUGHT_RELATIONS.md`, `PLAN_VIZ.md`). The statuses were nearly all right anyway. One
   citation points at a module that **never existed at all** — `ask.mjs:17` names a `temporal.mjs`
   with no history in git. That is the sharpest illustration of the evidence order's fifth rung:
   source reading locates a capability and never establishes it, and a comment establishes nothing
   whatsoever.
3. **The honesty machinery holds; the input pipeline is where the risk lives.** 0% hallucination
   across 168 agent rows, 0% fabrication across 299 inference rows, and an adversarial sceptic who
   could not force a single role or polarity inversion in 55 probes. Every one of this cycle's six
   confident-wrong answers is a dropped token, not an invention — and the two worst are
   proof-shaped, which is the one thing this product cannot afford to get wrong.

`npm test`: **2450 pass / 0 fail**, read in the foreground. CLI smoke: `printf 'hi\n/exit\n' | node
bin/tmct.mjs` greets and exits 0.

Every open item this audit found is mirrored one line each into `NEXT.md`, which is the next
session's pickup list.
