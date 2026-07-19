# CAPABILITIES_2.7.12.md — tmct capability audit (refresh 10, re-audit over `CAPABILITIES_2.6.0.md`)

Pinned at `f0910a4`, `package.json` 2.7.12, 2026-07-19. This is a re-audit: every `CAPABILITIES_2.6.0.md`
row carries forward with its status re-checked against the evidence order in
`SKILL_CAPABILITIES_AUDIT.md` §1, and every status that moved is called out with its evidence.

**Audit window (analysis, not a benchmark run):** 2026-07-19. No harness was re-run. This audit reads
the four current `BENCHMARK_*.md` reports, the corpus estate, the tool layer, and the code at this pin.
The work was fanned out across five parallel background agents by capability domain (tool-layer/router,
chat/grammar, games, extension/estate, and a dedicated "what shipped with no row" sweep), per
`SKILL_CAPABILITIES_AUDIT.md` §6 Step 5; the memory/reasoning/inference range was covered directly by
the coordinator after its assigned sub-agent did not report back within the session — noted here rather
than silently absorbed, and re-verified against the same evidence order as every other range (targeted
test runs, corpus keys, and a full read of every kernel-touching commit in the audit window).

## Per-benchmark provenance — where every figure came from

| Benchmark | Latest report | Figure comes from |
| --- | --- | --- |
| AGENT | `BENCHMARK_AGENT_2.7.12.md` | **2.7.12, current** |
| INFERENCE | `BENCHMARK_INFERENCE_2.7.12.md` | **2.7.12, current** |
| CEFR_ENGLISH | `BENCHMARK_CEFR_ENGLISH_2.7.12.md` | **2.7.12, current** |
| CONVERSATION | `BENCHMARK_CONVERSATION_2.7.11.md` | **2.7.11** — measured one version behind, before this session's spider-fly-ecology-v2 and adventure-graphics-and-autoplay work landed. Cited at 2.7.11 throughout this audit, never backdated to 2.7.12 |

`max(2.7.12, 2.7.12, 2.7.12, 2.7.11)` is 2.7.12, so this audit is `CAPABILITIES_2.7.12.md`. Three axes
were freshly measured at 2.7.12 in this same session; the fourth (CONVERSATION) is one version behind
by design — its own report says so and names what it did not yet see. Every CONVERSATION figure below
carries "(2.7.11)" in the same sentence as the number.

Caveats that travel with the four figures:

- **AGENT 2.7.12 measures a router uplift landed earlier in the same session.** The goal driver clears
  every rung — 68/68 (100%), up from 2.6.0's 62/66 (94%) gated at TOOL-7. Case count grew 66→68 (one
  new case confirmed by inspection, `ab-a0-related-sofa`; a second was not individually diffed — the
  report's own backlog item 1 flags this). 0% hallucination held across 272 rows on all four arms.
- **INFERENCE 2.7.12 is byte-identical to 2.6.0 on every case count and template**, with one real
  capability move: INF-4's ceiling-graded count dropped 35→30 (5 cases that used to pass only against
  the declared honest-miss floor now pass as genuine capability). The report's own backlog flagged this
  as unattributed; this audit traces it below (row 168).
- **CEFR_ENGLISH 2.7.12 changed its judge prompt (v1→v2) since 2.6.0's carried 2.5.0 figure**, so the
  raw mean move (1.790/128 → 1.809/138) mixes a real product signal with an instrument change. The
  report itself flags this; this audit repeats the flag wherever the figure is cited, never presenting
  it as a clean lever comparison.
- **CONVERSATION 2.7.11 is a persona sweep that predates this session's two new games' graphical/
  auto-play features** — its own text says so. 25 of 2.6.0's 29 routed items are now fixed (21 clean,
  4 with a residual), 4 are still broken (2 in a materially new shape), and free exploration surfaced
  roughly 60 fresh findings, ranked into a 29-item routed backlog mirrored to `HANDOVER.md`.

## What the four fresh reports change about this audit

The theme of 2.6.0 was: the reformed benchmark ladders measure headroom above the engine instead of
stopping at its edge, with TOOL-7/TOOL-8 and the multi-hop proof ceiling as the named horizons. The
theme of 2.7.12 is: **both named router horizons are now built and measured clean, one inference
ceiling moved for real, two full games shipped from a standing start, and the estate's own drift guard
caught itself doing exactly the job it exists for — twice.**

- **AGENT** closes both rungs 2.6.0 flagged as its highest-priority build targets. TOOL-7's
  conditional-fallback double-fire and TOOL-8's silent tied-candidate pick are fixed in the
  resolver/planner layer (`f85306d`), measured 100% on every arm that reaches them. `tmct_related`
  joined the capability registry (16 capabilities, was 15) and gained NL routing, closing 2.6.0's
  backlog item 5 two ways.
- **INFERENCE** holds every 2.6.0 count byte-identical except one real move: a bounded property-
  inheritance lift (`4edc294`) walks a 2+ hop taught chain instead of one hop, flipping the 5
  `grandparent` ceiling rows from declared floors to live pins — exactly the "deeper property-
  inheritance lift" 2.6.0's own Speculative TO-BE section named.
  named.
- **Two full games shipped from a standing start.** At 2.6.0, `PLAN_ADVENTURE.md` was
  claimed-only/RESEARCH-DESIGN and spider-fly did not exist. Both are now built, playable, corpus-
  pinned, and rendered on the website with a goal-inferring auto-play mode (adventure) and a seeded,
  deterministic predator-prey ecology (spider-fly). Neither is measured by AGENT, INFERENCE, or CEFR;
  CONVERSATION 2.7.11 explicitly did not probe either (built after that sweep was dispatched).
- **The committed ask-bundle drift guard is red again at this pin** — the same finding 2.6.0 made,
  independently reproduced by this audit (`node --test test/estate/generated-artifacts.test.mjs` → 5
  pass / 1 fail, live). Five rebuild commits chased it through this session's merges; the adventure
  browser-hero merge (`c7cccdd`/`ac33ae0`), which landed after the last rebuild, re-touched the import
  closure with none following. The guard is doing its job; it needs one more rebuild at integration.

## 0. Scope note

This audit covers the three sets `SKILL_CAPABILITIES_AUDIT.md` §3 names: the product capability
catalog, what `PLAN_NLU_BENCHMARKS.md` would measure, and what `PLAN_AGENTS.md` leans on. Rows 1-173
carry forward from `CAPABILITIES_2.6.0.md` (with its own gaps at #63 and merged 21/24 preserved); rows
174-206 are new work since its pin (`bab4a23`), recovered from 124 commit subjects, the corpus
key-group diff (116 → 144 groups, 428 → 495 leaf keys), two full new games, and one new corpus tier.

## 1. Full status table

**Status key:** `implemented` · `partial` · `claimed-only` · `absent` · plus the standing
`reverted` / process labels, unchanged since 2.0.3.

Rows whose status **moved** since 2.6.0 are marked **MOVED** in the change note. Unchanged rows cite
their stable evidence identifier and restate the status.

### Rows 1-33

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline | implemented | rows `grammar.compositional` (grew — new `.but-do-not`, `.but-qualifier`, `.qualifier-head`), `grammar.relaxation`, `grammar.normalize` | unchanged in kind; lane grew this cycle (rows 196-199) |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | row `grammar.ace` (8) | unchanged |
| 3 | ACE-OWL parser as a standalone MPL-2.0 package | reverted | `packages/` absent (confirmed) | unchanged |
| 4 | OWL 2/RDF/RDFS + SEON ontology grounding | implemented | `test/adapters/grammar-ontology.test.mjs`; `ontology/tmct-core.ttl` | unchanged; no new ontology track this cycle |
| 5 | Template libraries / response phrase book | implemented | `template.*` key families; `test/adapters/corpus-templates.test.mjs` | unchanged |
| 6 | Filtered ConceptNet corpus slice | implemented, opt-in | `test/adapters/extensions-corpus.test.mjs` — 29/29 re-run | unchanged; the `/r/Not*` widening question this row's evidence sits beside is closed (see §4.4) |
| 7 | Conversational memory as an OWL-labelled graph (3 backends) | implemented | `test/adapters/memory-backend-{sqlite,memory}.test.mjs`; `src/adapters/memory/core.mjs` | unchanged |
| 8 | Input normalization pass | partial | row `grammar.normalize` (19+) | unchanged status; CONVERSATION-2.7.11 ratchet item 8 PASSES the regression it was tracking ("wat is a hrose" no longer read as teach-intent), residual named: noun-level typo repair itself ("hrose"→"horse") still absent |
| 9 | Repository Interface adapter contract | implemented | `test/adapters/repository-interface.test.mjs` — 16 services re-counted, `INTERFACE_VERSION` 1.1.0 | unchanged |
| 10 | Runnable conformance suite for RI providers | implemented | `test/adapters/repository-interface.test.mjs` (`runConformance`) | unchanged |
| 11 | Library-first design, stable `exports` map | implemented | `test/estate/pack.test.mjs`; 6 `package.json` exports; `e2e/lib-chat-sqlite.test.mjs` | unchanged |
| 12 | Ink console TUI shell | implemented | `e2e/tui.test.mjs`, `e2e/tui-chat-file.test.mjs` | unchanged |
| 13 | Calculation surfaced as reasoning | implemented | `test/adapters/wiring-templates-via.test.mjs` | unchanged |
| 14 | Optionally running linters/tests to observe | claimed-only | nothing in the estate pins it | unchanged |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | absent (named open spike) | `PLAN_SYLLOGIST.md` §5 (now archived, DELIVERED with §5 open) | unchanged; a research horizon |
| 16 | Response-finishing grammar pass | partial | `test/adapters/finish.test.mjs` | unchanged |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `test/tools/cli-args.test.mjs`; `bin/tmct.mjs --help` | unchanged |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `test/adapters/syllogise.test.mjs` — **124/124 re-run this pass** | unchanged; same ATMS/delta/expandFocus feature set as 2.6.0, no new kernel lever this cycle |
| 19 | `cax-dw` disjointness rule | implemented | `test/adapters/syllogise.test.mjs`; `BENCHMARK_INFERENCE_2.7.12.md` `b1DisjointVeto` 24/24, `dlDisjointProofSoundness` 8/8, both re-confirmed byte-identical | unchanged |
| 20 | `cax-sco` type-propagation rule | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 21/24 | Actor-level, session-scoped source trust | implemented | `test/adapters/chat-inference-trust.test.mjs`; `test/adapters/provenance.test.mjs` | unchanged status; a latent bug fixed — `sourceIdFor` had no `corpusWeak` write-side case, so a corpusWeak-tagged fact's Source silently failed to mint and scored 0 regardless of corroboration (`883f8de`); `SOURCE_PRIOR` count unchanged at 9, corpusWeak was already a read-side kind |
| 22 | Consistency checking / cardinality / proof-chain materialization | implemented | `test/adapters/syllogise.test.mjs`; INF-6 20/20, INF-8 soundness 8/8, both byte-identical (`BENCHMARK_INFERENCE_2.7.12.md`) | unchanged |
| 23 | Unified provenance/trust primitive | implemented | `test/adapters/chat-inference-trust.test.mjs`, `provenance.test.mjs` | unchanged; see row 21/24's corpusWeak fix, same primitive |
| 25 | Memory-tree versioning (`snapshotMemory`) | implemented, Backend A only | `src/adapters/memory/core.mjs` | unchanged |
| 26 | Deterministic contradiction detection | implemented | `test/adapters/provenance.test.mjs` (d) | unchanged |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/adapters/memory/blocks.mjs`; `provenance.test.mjs` (d) | unchanged |
| 28 | Extension-pack / corpus-lexicon loading seam | implemented | `test/adapters/extensions-corpus.test.mjs` — 29/29 | unchanged |
| 29 | Bias-weighted ambiguity resolution | implemented | `test/adapters/bias-weighting.test.mjs` | unchanged |
| 30 | `tmct init --with-persona`, size-tier flag | implemented | `test/tools/cli-args.test.mjs` | unchanged |
| 31 | Tier-2 general-knowledge bundle (legacy) | implemented, legacy | `test/estate/corpus-schema.test.mjs` | unchanged |
| 32 | A wider general-knowledge seed set | implemented, default | `corpus/tier2/manifest.json` — `human` 664, `human-large` 12001 (byte-identical) | unchanged |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `test/adapters/corpus-unknown-ingest.test.mjs` (unit ring only) | unchanged |

### Rows 34-66 (no row 63 — the historical table skips it)

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 34 | SHACL-style declarative ingest gate | implemented | `test/adapters/memory-shacl.test.mjs` | unchanged |
| 35 | Cross-repo HTTP smoke test | implemented | `e2e/server-http-smoke.test.mjs` | unchanged |
| 36 | Machine-readable capability envelope | implemented, estate-guarded | `agentbench/envelope.json` — `caseCount: 68`, `rungReached: TOOL-8`, `gatedAt: null` | **MOVED (quality up)**: was `gatedAt: TOOL-7` at 2.6.0; regenerated for the 68-case ladder, every rung now clears |
| 37 | Ontology tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, ON by default | `test/adapters/wiring-facts-memory.test.mjs` | unchanged |
| 38 | Ontology tracks c+d (SEON spine) | implemented, default-off | `test/adapters/grammar-ontology.test.mjs` | unchanged |
| 39 | Subordination/conditional preamble frames | implemented | rows `grammar.normalize.subordination` (1), `.conditional` (2); **new**: `grammar.noise.subordination` | strengthened: `37bc71b` adds trailing-clause stripping (comma-anchored, not just leading), plus "even though"/"though" to the leading set (row 196) |
| 40 | Construction-grammar template bank | implemented | row `grammar.construction.agent-noun` (2) | unchanged |
| 41 | Chat-taught relations & rules | implemented | `inference.relation` (30), `inference.teach-lane` (13) | unchanged |
| 42 | `findActionPath` (bounded successor BFS), wired to a real domain | implemented | rows `planning.solve.hanoi`, `planning.execute.river` | unchanged mechanism; two new consumers this cycle — spider-fly's greedy movers and adventure-autoplay's exposed-exit-graph pathing reuse the same kernel, no kernel edit |
| 43 | `findReachableSet` | implemented, wired into chat | `src/domain/planning.mjs`; live chat callers | unchanged mechanism; same new-consumer note as row 42 (spider-fly's one-ply reachable set) |
| 44 | Towers-of-Hanoi goal-directed planning loop | implemented | row `planning.solve.hanoi` | unchanged |
| 45 | "I am thinking of a number" closed-loop game | implemented | lane `test/corpus/games/guess-number.test.mjs` — **13/13 re-run** | unchanged status; new evidence — `651395e` retrofits Play/pause/step/reset onto the demo rail (row 188), closing `PLAN_SPIDER_FLY.md` §12's last open step |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `test/adapters/synth-rules.test.mjs` | unchanged |
| 47 | Program synthesis Tracks 2-4 (sandbox) | claimed-only, sign-off-gated | `PLAN_CODE.md` sign-off gate; zero mutation/repair code confirmed absent | unchanged |
| 48 | Completions Stage 0 (broad search + grouping) | implemented | `test/adapters/completions-stage0.test.mjs` | unchanged |
| 49 | Completions Stage 2 (extractive ranking) | implemented | `test/adapters/completions-stage2.test.mjs` | unchanged |
| 50 | Completions wired into a user-facing answer | implemented | `test/adapters/chat-completions-wiring.test.mjs` | unchanged |
| 51 | Capability router — registry + four stages | implemented, corpus-driven | `registry.capabilities()` re-counted **16** (was 15); 11 `planning.route.*` rows; `test/adapters/router-drive.test.mjs` 51/51 | **MOVED**: the 2.6.0 caveat closes — `96d40fe` registers `tmct_related` as a real capability (a `memoryFacts` precondition); `EXCLUDED_FROM_REGISTRY` still lists exactly 3 entries, none of them `tmct_related` |
| 52 | `POST /v1/messages` HTTP shim | implemented | `e2e/server-http.test.mjs` 15/15 | unchanged status; shim-transport arm now 24/68 (35%), was 23/66, same TOOL-3 gate (`BENCHMARK_AGENT_2.7.12.md`) |
| 53 | bedrock-meter $0-rung routing | implemented in sibling repo, not here | `PLAN_AGENTS.md`; no such code in `src/`/`bin/` | unchanged |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md` Phase 5 | unchanged |
| 55 | `seon-mcp` provider adapter | claimed-only | `PLAN_AGENTS.md` | unchanged |
| 56 | marginalia "mechanical chat" replaced by tmct | claimed-only | `PLAN_AGENTS.md` | unchanged |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md` Phase 3 | unchanged |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md` Phase 4 | unchanged |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet) | implemented | `test/adapters/repository-interface.test.mjs` | unchanged |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `test/adapters/source-slice.test.mjs` | unchanged |
| 61 | Telemetry wrapper on every RI service | implemented | `test/tools/telemetry.test.mjs` | unchanged |
| 62 | Chronograph-style temporal diffing | claimed-only, research-horizon | no `temporal.mjs` module | unchanged |
| 64 | Dialogue-flow playtest ladder | implemented | `games.*` lanes across **9 shards** (`adventure`, `compositional`, `drilldowns`, `guess-number`, `messy-user`, `openers`, `relation-touches`, `spider-fly`, `teach-recall`) | grew two shards: `games/adventure` (55 rows) and `games/spider-fly` (17 rows) joined |
| 65 | CHATBENCH graded-pool ladder | implemented | `test/bench/chatbench-graded.test.mjs` 35/35; **mean 1.809/2, 138 cases, 5 hard fails, 136/138 tier-1** (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`) | figure moved from carried-forward (2.5.0) to current, but the judge prompt moved v1→v2 in between — the raw delta is not a clean lever comparison (see intro caveats). Pool regenerated seed 20260704, 964 passing/111 frontier |
| 66 | AGENTBENCH agentic ladder | implemented | `test/bench/agentbench.test.mjs` 40/40; `BENCHMARK_AGENT_2.7.12.md` | **MOVED (quality up)**: goal driver **68/68 (100%)**, up from 62/66 (94%) gated at TOOL-7. Both named 2.6.0 horizons (TOOL-7 replan, TOOL-8 composer) now clear on every arm that reaches them. 0% hallucination held across 272 rows |

### Rows 67-99

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 67 | INFBENCH classical-logic ladder | implemented | row `bench.infbench`; `test/bench/infbench.test.mjs`; `BENCHMARK_INFERENCE_2.7.12.md` | byte-identical case counts to 2.6.0 on every template/band; `--replay` re-confirmed byte-identical across 2 runs; see row 168 for the one real quality move (INF-4 ceiling 35→30) |
| 68 | Strategy-advisor watch process | implemented (process), dormant | `SKILL_AGENT_STRATEGY_ADVISOR.md` | unchanged; `SKILL_PLAYTEST_EDGE_HUNT.md` (row 193) is a sibling process that predates 2.6.0 and never had a row until now |
| 69 | Segmentation IR + concept force | implemented | `test/adapters/concept.test.mjs` (unit ring) | unchanged |
| 70 | Negation as bounded set complement | implemented | row `grammar.negation.set-complement` (5) | unchanged status; CONVERSATION-2.7.11 ratchet item 11 (`is X not imported by Y`) PASSES, generalizes to a fresh instance |
| 71 | Reversible-passive traversal | implemented | 4 rows `grammar.passive.fronted-agent` | unchanged status; new caveat — `BENCHMARK_CEFR_ENGLISH_2.7.12.md` hard fail `g-b2-passive-9`: a passive+relative-clause COMPOUND expected an honest miss and scored 0/0/0; the report names this "a real, recurring capability ceiling" for multi-construction composition, distinct from the 4 pinned single-construction rows |
| 72 | Compound-name resolution in `resolveObject` | implemented | row `grammar.compositional.find` | unchanged |
| 73 | Compound matching in `/describe`'s resolver | claimed-only / named gap | `src/domain/codegraph.mjs` `resolveSymbol` — exact/basename/substring tiers only | unchanged; this session's fixes did not touch this resolver |
| 74 | Reverse-`inherits` "the"-definite forms | claimed-only / documented decline | `src/domain/ask-vocab.mjs` | unchanged; not touched this session |
| 75 | Cochange phrasing variants + "multi-root" over-match | partial | rows `games.drilldown.history`, `games.relation-touch.cochange` (3) | unchanged; the coordination-refusal half still has no named test |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 — "not published or built anywhere this research found" | unchanged |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 | unchanged |
| 78 | Winograd-hard commonsense coreference | claimed-only, research-horizon | `PLAN_AGENTS.md` R3 | unchanged |
| 79 | Shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md` R3 | unchanged |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `test/tools/server.test.mjs` | unchanged |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV, provenance) | implemented, no test | `.gitlab-ci.yml` | unchanged |
| 82 | Predicate "find" queries | implemented | rows `grammar.compositional.find`, `.superlative`, `grammar.superlative.need-verb-inverts` (2) | unchanged status; CONVERSATION-2.7.11 ratchet item 10 (fewest-tests superlative vs `/untested`) PASSES structurally |
| 83 | Single-sourced `fnv1a` + wink browser-loader seam | implemented | `src/domain/hash.mjs` | unchanged; now also the seed for spider-fly's `randomFlyWander`/`greedySpiderAvoid` (row 187) |
| 84 | SQLite memory Backend C | implemented | `test/adapters/memory-backend-sqlite.test.mjs` | unchanged |
| 85 | In-memory Backend B | implemented | `test/adapters/memory-backend-memory.test.mjs` | unchanged |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `e2e/import-file.test.mjs` | unchanged |
| 87 | Default human-world persona + size tiers | implemented | `corpus/tier2/human*.jsonl`, `manifest.json` | unchanged |
| 88 | `graphService` wired into completions | implemented | `test/adapters/chat-completions-graphservice.test.mjs` | unchanged |
| 89 | Public completions exports | implemented | `package.json` exports → `src/services/completions.mjs` | unchanged |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | retired (fixes stand) | skill file still absent | unchanged |
| 91 | Persona-sweep as the conversation bench's default | process change | `SKILL_BENCHMARK_CONVERSATION.md`; demonstrated live by `BENCHMARK_CONVERSATION_2.7.11.md` (6 frames, several hundred turns) | evidence upgraded — the 2.6.0 sweep was "in flight"; this one landed |
| 92 | Multi-candidate ambiguity resolution | implemented | row `template.ambiguity.multi-reading` (1); `--gaps`: still no negative row | unchanged status, new caveat — CONVERSATION-2.7.11 ratchet item 23 is **STILL-BROKEN, new shape**: the 2.6.0 did-you-mean commit-hash-noise complaint is fixed and stays pinned green, but the branch-preview auto-expansion now mislabels a candidate and skips previewing one |
| 93 | Memory-graph-aware `spiralExpand` | implemented (library-level, not CLI-wired) | `test/adapters/codegraph.test.mjs` | unchanged |
| 94 | Edge/node provenance timestamps | partial (derived half removed) | `test/adapters/provenance.test.mjs` (a) | unchanged |
| 95 | Reverse fact-cascade query shapes | implemented | rows `inference.reverse-predicate.by-object` + negative guard | unchanged |
| 96 | Forward-shape `entityType` grain-checking | implemented | `test/tools/ask.test.mjs` | unchanged |
| 97 | Possessive-named-instance teach shape | implemented | rows `games.teach-then-infer.possessive` + guard | unchanged |
| 98 | Bare known class/entity name → describe/focus | implemented | key `grammar.bare-entity.camelcase` (3), `.module-path` (2) | unchanged; distinct from the new `template.vocab.bare-noun` (row 202), which is a vocabulary noun, not a code-graph entity |
| 99 | Capability router invocation surface (`tmct plan`, `/plan`, `./plan`) | implemented | `e2e/plan-cli.test.mjs` 5/5; 11 `planning.route.*` rows | unchanged |
| — | `PLAN_ADVENTURE.md` | **MOVED: `claimed-only, RESEARCH/DESIGN` → `implemented`** | `archive/PLAN_ADVENTURE.md` header: "Status: SHIPPED (2.7.0 wave)." All four phases landed 2026-07-18; `games/adventure` corpus lane: **55/55 rows pass** across 22 keys | The plan moved to `archive/`, no longer a root doc — the game is built, playable, corpus-pinned. See rows 175-181 for the individual capabilities that make it up |

### Rows 100-138

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 100 | Five-layer `src/` architecture, downward-only imports | implemented | `test/estate/import-layers.test.mjs`; allowlist still exactly 1 entry | unchanged |
| 101 | Keyed corpus-lane test estate | implemented | `node scripts/corpus-matrix.mjs` — **15 lanes / 1017 rows / 495 keys** | grew: 13/897/428 → 15/1017/495; new lanes `games/adventure` (55) and `games/spider-fly` (17) joined `games/guess-number`; key groups 116 → 144 |
| 102 | e2e tier: real binary + real browser | implemented | `e2e/cli-smoke.test.mjs`, `e2e/browser-chat.test.mjs` | unchanged |
| 103 | README examples run against the live product | implemented | `test/readme/readme.test.mjs`, `e2e/readme-examples.test.mjs` | unchanged |
| 104 | Plan lane — teach, state a goal, solve, step | implemented | rows `planning.solve.hanoi`, `planning.execute.next`, `planning.goal.verbless` | unchanged; not itself touched by adventure/spider-fly work |
| 105 | Generic action interpreter + action `Rule` family | implemented, **extended** | `92e8415` — `domain.mjs` gains a fact-value precondition shape and a literal-valued effect; `RULE_SLOT_SPEC` gains optional `value`/`negate` slots, omitted from storage when untaught (Hanoi/river-crossing byte-identical) | **extended this cycle** — see row 182 for the mechanism's own capability row and its adventure consumer |
| 106 | Taught-action registry seam (`registerCapability`) | partial | row `planning.route.taught-action`; mechanism unit-ring only | unchanged |
| 107 | River-crossing domain | implemented | rows `planning.execute.river`, `.legal.river-constraints` | unchanged |
| 108 | `/capabilities` listing + `tmct plan --tools` | implemented | `planning.capabilities.listing` (2), `.readback` (4) | unchanged, exact counts re-verified |
| 109 | `tmct viz` ledger memory explorer + chat dock | implemented | `e2e/ledger-viz-cli.test.mjs`, `e2e/ledger-viz.test.mjs` | unchanged; a distinct system from the new game viz pages |
| 110 | Animated self-contained plan render + `chat --render/--output` | implemented | `e2e/chat-prompt.test.mjs`; `test/adapters/plan-viz.test.mjs` | unchanged; its shared Play/pause/step primitive is now its own row (188) given it's reused a fourth time |
| 111 | `chat --prompt` one-shot turn runner | implemented | `e2e/chat-prompt.test.mjs` | unchanged |
| 112 | `tmct import --file` | implemented | `e2e/import-file.test.mjs` | unchanged |
| 113 | `--memory-backend` + `tmct.toml [memory]` | implemented | `test/tools/cli-args.test.mjs`, `test/adapters/chat-memory-backend.test.mjs` | unchanged |
| 114 | `extract:facts` / `tmct extract` over a document | implemented | `test/adapters/extract-facts-from-text.test.mjs`; verb still in the usage banner | unchanged |
| 115 | WordNet → ConceptNet-shape conversion | implemented | `test/adapters/corpus-wordnet.test.mjs` — re-run, pass | unchanged |
| 116 | Open English Namenet top-up bundle | implemented | `test/adapters/corpus-namenet.test.mjs` — re-run, pass | unchanged |
| 117 | `init:xl` / `init:xxl` scale presets | implemented | `e2e/init.test.mjs` | unchanged |
| 118 | Seed-side O(n) index + per-turn `factRows` memoisation | implemented | `test/adapters/memory-seed-perf.test.mjs`, `chat-factrows-cache.test.mjs` | unchanged |
| 119 | Defeasible negation | implemented | rows `inference.capability.base-rate`, `.negative-teach` | unchanged |
| 120 | Persisted justification + retraction cascade, 5 rule families | implemented | `test/adapters/syllogise.test.mjs`; rows `inference.retraction.subclass`, `.svf1.*` | unchanged |
| 121 | Taught-fact retraction wired to chat | implemented | rows `inference.retraction.subclass`, `.honest-miss` | unchanged |
| 122 | Multi-valued has/can facts not read as contradictions | implemented | `test/adapters/memory-contradictions-cardinality.test.mjs`; `inference.hasa.*` | unchanged |
| 123 | Verified paraphrase (closure-backed) | partial | unit ring only; no corpus row on the user surface | unchanged |
| 124 | Entity comparison ("how is X different from Y") | partial | unit ring only: `test/adapters/compare.test.mjs` | unchanged |
| 125 | Comparative frame | implemented | rows `grammar.teach.comparative-contraction`, `inference.comparative.yesno` | unchanged |
| 126 | Dynamic memory-class list/count | implemented | rows `template.count.restricted`, `template.recall.count` | unchanged |
| 127 | Plural anaphora | implemented | `grammar.anaphora.*` (16) | unchanged |
| 128 | Deterministic answer-phrasing variety | implemented | `template.conversational` — grew 18 → **19** rows | grew: `7b482f1` adds an ack-preamble ("ok cool thanks") thanks-template row |
| 129 | Canonical query/fact representation echoed on ask and teach | implemented | canonical assertions across lanes | unchanged; still the product's best self-diagnostic |
| 130 | Tool catalog + README tool section generated from `TOOL_DEFINITIONS` | implemented | `test/estate/tool-docs.test.mjs`; `TOOL_DEFINITIONS` still **23** (3 hot, 20 cold) | unchanged since 2.6.0 — no new declared tool this cycle |
| 131 | Browser ask bundle + committed-artifact drift guard | implemented; **guard RED again at this pin** | `test/estate/generated-artifacts.test.mjs` — 5 pass / 1 fail, re-run live at `f0910a4` | **flipped red again**: rebuilt 5 times this session (`67fc540`,`f027066`,`6eb9506`,`4987b71`,`0d6cc63`) chasing drift through the spider-fly/tmct_related/rendering merges; the adventure browser-hero merge (`c7cccdd`/`ac33ae0`), which landed after the last rebuild, re-touched the import closure with none following. Needs one more `npm run build:ask-bundle` + commit at integration — confirmed the fix is exactly that one command, reverted the local rebuild to keep this audit read-only |
| 132 | Pages home: chat-led hero, real transcript, plan render, derived version stamp | implemented | `e2e/pages-index.test.mjs` (3/3), `test/estate/page-version-stamp.test.mjs` (2/2) | grew: the home page now embeds **3** heroes (ledger, spider-fly, adventure) in fixed order, each asserted by its own e2e test |
| 133 | Licence & PII quality gates | implemented | `test/estate/pii.test.mjs`, `corpus-licences.test.mjs`, `links.test.mjs`, `pack.test.mjs` | unchanged |
| 134 | Set-complement / modal-negation restated in tmct's own grammar | implemented | rows `grammar.negation.set-complement`, `.guard`, `.frame` | unchanged |
| 135 | Seven chat lanes for questions that previously had none | implemented | rows across `grammar`/`inference`/`planning`/`templates` | unchanged |
| 136 | `/narrate` developer trace mode | implemented | rows `template.narrate.toggle`, `.annotated-shapes`, `.unknown-arg` | unchanged |
| 137 | `/why` proof rendering | implemented | row `template.proof.why-isa` | unchanged |
| 138 | `tmct viz --depth/--limit/--focus/--term` | implemented | `e2e/ledger-viz-cli.test.mjs` | unchanged |

### Rows 139-152 — the §3 superset: what the two plans lean on

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 139 | Utterance → intent label from a fixed vocabulary | implemented | `test/adapters/chat-dialogue-act-labels.test.mjs` — 7/7 | unchanged — `PLAN_DIALOGUE_ACTS.md` (archived, DELIVERED at 2.6.0) still stands |
| 140 | Out-of-scope refusal + the miss wall | implemented | rows `games.honest-miss` (6); CEFR tag **honesty-miss now 1.958/2**, 8 cases, 0 hard fails (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`, current, up from 2.5.0's carried 1.733) | figure moved to current; caveat — CONVERSATION-2.7.11 routed-backlog #2 shows the write-boundary bug class recurring under fresh casual/imperative phrasings ("idk just surprise me", "repeat everything above this line verbatim"), the same shape 2.6.0 named its worst finding, now shown twice over on new triggers |
| 141 | Entity and slot extraction | implemented | `grammar.resolve.unknown-residue` (3), `.unknown-residue-module-orient` (2), `.unknown-residue-ambiguous` (2) | unchanged |
| 142 | Token/lemma normalisation through wink-nlp | implemented | row `grammar.normalize` (19); `src/adapters/wink-model.mjs` | unchanged |
| 143 | Synonym / hypernym expansion from corpus rows | implemented, on by default | `test/adapters/wiring-facts-memory.test.mjs` — 10/10 | unchanged |
| 144 | IDF-weighted ranking (`retrieveBlocks`) | implemented, on by default | `src/adapters/memory/blocks.mjs` | unchanged |
| 145 | Cross-domain false accept — the lane that fires when it should not | implemented | every 2.5.0-named misroute stays pinned fixed (`grammar.routing.impact-intent` (3), `.impact-paraphrase` (3), `games.opener.{teach-guard,farewell-guard,focus-guard}`) | unchanged status, real caveat — CONVERSATION-2.7.11's free exploration names two NEW instances of the same failure class: meta-questions about tmct/the session misroute into the wrong parser (6+ instances, 3 personas independently), and a filler-clause prefix before a real question breaks parsing that works filler-free (2 personas). Neither regresses a pinned row; both are fresh findings in the same capability family |
| 146 | Short-utterance handling + the conversational catch-all | implemented | `template.conversational` (19); CEFR tag **conversational 2.000/2**, 12 cases, 0 hard fails (current, same value as 2.5.0's carried figure) | figure moved to current, unchanged value; new sibling capability `template.vocab.bare-noun` (row 202) sits adjacent |
| 147 | Read-only session guarantee during a scored run | implemented | `chatbench/run.mjs` pure `runTurn()`; `grammar.routing.impact-intent` (3) asserts empty memory post-turn | unchanged |
| 148 | Determinism / byte-identical reruns | implemented | INFERENCE: `--replay` re-confirmed byte-identical across 2 runs (`BENCHMARK_INFERENCE_2.7.12.md`, fresh this cycle). AGENT: not freshly re-measured with an explicit `cmp` this round — the 2.6.0 claim carries forward for that half | note: AGENT-side determinism claim carried forward, not freshly measured at 2.7.12; INFERENCE-side is fresh |
| 149 | OWL property reasoning + Horn-rule teaching | implemented | rows `inference.relation` (30), `inference.teach-lane` (13) | unchanged |
| 150 | Proof rendering + planner consumption of taught records | implemented | row `template.proof.why-isa`; `planning.route.taught-action` | unchanged |
| 151 | Consistency checking as a service (`tmct check` / an MCP tool) | absent (as a service) | no `check` verb in `bin/tmct.mjs`; none of the 23 `TOOL_DEFINITIONS` is a consistency tool | `PLAN_CONSISTENCY_CHECK.md` — re-read, still DESIGN, approved in outline, not built. Detection stays live at the chat layer (INF-6 20/20, INF-8 soundness 8/8) |
| 152 | Explicit-teaching surface a scrape pipeline would feed | partial | `tmct import --file` (112), `tmct extract` (114); learn-on-miss (163) and the new child pack (174) both add shipped-pack acquisition; still no scrape pipeline calls any of them | `PLAN_AGENTS.md` Phase 4, unchanged |

### Rows 153-162

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 153 | Universal quantifier over a module set | implemented | 3 rows `grammar.quantifier.universal-over-set` | unchanged |
| 154 | PROV Source three-way split + `provSourceClassFor` | implemented | `test/adapters/grammar-ontology.test.mjs`; `SOURCE_PRIOR` still total over **9** kinds | unchanged; the corpusWeak write-side bug (row 21/24) sat under this same classifier, now fixed |
| 155 | SKOS concept view | implemented | `test/tools/tmct-related.test.mjs` — 5/5; `src/domain/skos-view.mjs`; corpus: `template.skos.phrasings` (2), `grammar.skos.related` (2), `grammar.skos.honest-miss` (2), **new** `grammar.skos.teach-round-trip` (1) | **MOVED (caveat closed)**: `96d40fe` puts `tmct_related` in the registry, closing the "neither registry nor exclusion list" gap. Separately, `0c8cb3c` ships the 2.6.0 Speculative-TO-BE item "teach-path predicate minting for prepositional verbs" — "cat relates to milk" now mints `mgx:relatedTo` directly, giving the SKOS lane a real teach phrasing |
| 156 | Existential-premise refusal (∃ not stored as ∀) | implemented | row `inference.teach-guard.existential`; INFBENCH `b1Existential` 40+10 carried green | unchanged |
| 157 | Multi-sentence teach line split | implemented | row `planning.teach.multi-sentence-line`; `test/services/sentence-path-splitting.test.mjs` | unchanged status; CONVERSATION-2.7.11 ratchet item 26 (hanoi-3.txt one-liner) PASSES; routed-backlog #27 flags a sibling still-inconsistent case (a syllogism one-liner of the same shape fails) |
| 158 | Multi-hop subclass proof validated against stored `owl:disjointWith` | implemented | rows `inference.disjoint.subclass-chain` (4), `.instance-form`; INFBENCH `b1DisjointVeto` 24/24, `dlDisjointProofSoundness` 8/8, both byte-identical | unchanged |
| 159 | Read-only impact phrasings do not mutate memory | implemented | `grammar.routing.impact-intent` (3), `.impact-paraphrase` (3), `template.command.impact` (1) | unchanged |
| 160 | First-person desire vocabulary openers route to describe, not teach | implemented | rows `template.vocab.{desire-opener, enumerate-known, expansion (3), filler-tolerance, overview-openers}`; **new**: `.graphless-miss-guidance`, `.staccato-swap` (row 203) | unchanged status; caveat — CONVERSATION-2.7.11 ratchet item 18's openers half PASSES; item 15 ("and a cat" pivot) is **STILL-BROKEN, new shape**: the original pivot bug this session's staccato-swap fix targets is fixed once reached, but a NEW earlier dead-end (turn 1 itself, when a repo is loaded) means the scripted sequence never gets there |
| 161 | Multi-candidate stale-modifier residue guard | implemented | rows `grammar.resolve.unknown-residue-ambiguous` (2) | unchanged status; CONVERSATION-2.7.11 ratchet item 12 ("describe the old Task class") PASSES — `ee11fc4` folds `/describe` into this same guard, extending its reach |
| 162 | `test:smoke` / `test:fast` tiers + wall-clock budget guard | implemented | `package.json` scripts; `scripts/check-tier-budgets.mjs`; `test:fast` re-run live — **183/183**, 1494ms | grew: 181 → 183 tests |

### Rows 163-173 — the 2.6.0 "new work" block, re-verified

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 163 | Learn-on-miss from the shipped reference pack | implemented | lane `test/corpus/reference.test.mjs`; `corpus/reference/manifest.json`: 3,887 articles, 337 aliases, 64 shards (byte-identical) | unchanged; a second, keyword-indexed learn-on-miss tier now sits ahead of it in the clean-miss cascade — see row 174 |
| 164 | Browser chat surface + the 3×3 behaviour matrix | implemented | `e2e/chat-browser-bundle.test.mjs`, `e2e/tui-chat-file.test.mjs`, `e2e/lib-chat-sqlite.test.mjs`, `e2e/web-chat-memory.test.mjs` — 16/16 | unchanged; the adventure/spider-fly browser bundles build on the same `scripts/lib/browser-bundle.mjs` seam, additional consumers, not a status change |
| 165 | Bounded ATMS environment sets in syllogise | implemented | `test/adapters/syllogise.test.mjs` — multi-environment justification persistence, `maxEnvironments` cap, set-membership retraction | unchanged |
| 166 | Semi-naive delta evaluation with watermark state | implemented | `test/adapters/syllogise.test.mjs` — delta ≡ full pinned per rule family | unchanged |
| 167 | `expandFocus` — a caller focus run through the relevance frontier | implemented | `test/adapters/syllogise.test.mjs` (`expandFocus` cases) | unchanged |
| 168 | The is-a ladder extensions: reflexive subsumption, universal conditionals, one-hop property inheritance, converse nudges | implemented, **deepened** | chat keys `inference.reflexive.self-subsumption`, `.conditional.universal-subclass`, `.converse.nudge`, `.property.inheritance` (grew: `inference-property-inheritance-lifts-a-bounded-two-hop-chain`); INFBENCH `a2Reflexive` 10, `a1UniversalConditional` 10, `a2Converse` 10, `b2PropertyInheritance` 20 | **MOVED (quality up), attributed**: `4edc294`'s own commit message: "the does-have reader's ⊑-lift walks a bounded chain (4 hops), so a possession two taught hops up reaches the instance with every premise cited; the five infbench grandparent rows flip from ceiling floors to live pins (379/379, INF-4 ceilings 35→30)." This closes 2.6.0's own Speculative TO-BE item ("a deeper property-inheritance lift — flips the 5 `grandparent` ceiling rows") and is the mechanism `BENCHMARK_INFERENCE_2.7.12.md`'s own backlog item 1 asked to have traced |
| 169 | The two parser tails land cleanly | implemented | rows `grammar.quantifier.plural-agreement`, `inference.negative.unknown-subject` | unchanged; both still thin, single-row keys |
| 170 | Board reads + goal frames | implemented | rows `planning.board.{readback, where-rest, clear}`, `planning.goal.{natural-frames, assumed-position-flagged, unknown-token-declines}` | unchanged; Hanoi/river-specific, not consumed by adventure or spider-fly |
| 171 | The logician and casual miss clusters answer or decline by name | implemented | rows `template.capability.ungrounded-decline`, `template.definition.vocab-miss`, `template.orientation.vocab-not-graph` | unchanged status; CONVERSATION-2.7.11 ratchet item 19 PASSES with a residual (dev-flavored parenthetical persists); routed-backlog #28 names a fresh, unrelated soft finding in the same cluster |
| 172 | The reformed benchmark ladders + per-arm `floorExpect` grading | implemented | `RUNGS` TOOL-0…TOOL-8 and bands INF-1…INF-8, unchanged shape; `test/bench/agentbench.test.mjs` 40/40 | unchanged mechanism; the ladder it grades now measures 68/68 (row 66) and INF-4's ceiling moved (row 168) |
| 173 | `npm run roll` release machinery | implemented | `package.json` `roll` script | unchanged; the drift-after-roll limitation it names is reproduced live again this cycle (row 131) — the roll rebuilds the bundle at release time, but mid-session merges after a roll can still drift it, which is exactly what happened |

## Rows 174-206 — new work since `bab4a23`

Recovered from 124 commit subjects across five parallel domain sweeps plus a dedicated "what shipped
with no row" pass, the corpus key-group diff (116 → 144 groups), two full new games, and one new corpus
tier. Every row is new work at 2.7.12, not a prior miss.

| # | Capability | Status | Evidence | Note |
|---|---|---|---|---|
| 174 | Child triples pack — a second, keyword-indexed learn-on-miss tier, consulted before the reference pack | implemented | `corpus/child/manifest.json`: 702 seed terms, 93,161 facts, 47,267 terms, 32 shards, cut from a pinned ConceptNet 5.7.0 dump; loader `src/adapters/corpus/child-pack.mjs`, contract `src/domain/child-pack.mjs`; trust tier `child:conceptnet:<term>` → corpus, 0.7; rows `reference.child.{article-fallback,backend.memory,backend.sqlite,no-pack,triples-answer}` (5); `test/adapters/child-pack.test.mjs` + `chat-child-lane.test.mjs` — 21/21 | `archive/PLAN_CHILD_CORPUS.md`, DELIVERED. The `/r/NotCapableOf` admission decision (§4.4) sits beside this row |
| 175 | Adventure world-loading (lazy worlds pack, `play X` opener, no-matching-world honest decline) | implemented | `4d1da99`; `src/services/adventure.mjs`, `src/domain/worlds-pack.mjs`; key `adventure-open` (10 rows, incl. `adv-missing-pack`, `adv-named-opener-missing-pack-declines-cleanly`, `adv-unknown-play-declines-honestly`, `adv-bare-play-spider-still-reaches-spider-fly`); world provenance parses to the corpus trust tier (`5844914`) | a named `"play X"` opener with no matching world now declines honestly, positioned so it never outguesses a sibling game's own opener (e.g. spider-fly's) |
| 176 | Imperative command grammar | implemented | `77ff22a`/`093971c`; `src/domain/grammar/ace.mjs`; `test/adapters/grammar-imperative.test.mjs` — closed-vocabulary imperative pattern, action-family enumerability | |
| 177 | World interpreter (imperative wiring, snapshot effects, room-look digest) | implemented | `a2277aa`/`55327a7`; `src/services/adventure.mjs`; +17 corpus rows | |
| 178 | NPC scheduler + full worked example | implemented | `af07741`/`069922a`; +3 corpus rows; `adventure-worked-example` key (thin, 1 row) | |
| 179 | Adventure dead-end routing fixes (8 categories, `roomAffordances`, auto-relook) | implemented | `de77743`, DELIVERED per `archive/PLAN_ADVENTURE_ROUTING.md`; `adventure-affordances` (2), `.relook` (2) keys | Turned up by a real play session (`.tmct/session-019f75d9…log`), not a synthetic probe |
| 180 | Examine/talk verb framing follows the verb, not the object's type; applies to carried objects | implemented | `de77743` → `e87a767` (carried-object fix) → `49efce8` (framing follows verb); `adventure-examine` (5), `.talk` (3) | 3 fix rounds across the playtest edge-hunt (row 193) |
| 181 | Verb-synonym / typo tolerance uplift | implemented | `34d7728` (3-4-token idiom coverage, not just a 2-token prefix), `e643a24` (fuzzy-repair reaches a typo on a `VERB_SYNONYMS` surface word, not just a bare closed verb); `adventure-synonym` (2), `.typo` (3) | General imperative-parsing mechanism, not adventure-content-specific |
| 182 | Taught fact-value rule shape (`domain.mjs`) | implemented | `92e8415` — `RULE_SLOT_SPEC` gains optional `value`/`negate` slots (a precondition testing a fact's literal value, an effect writing one), omitted from storage when untaught; `test/adapters/domain.test.mjs`, `test/adapters/memory-rules-action.test.mjs`, `test/adapters/wiring-action-rules.test.mjs`; Ashcombe Hall's `open`/`close` retire hand-checked lock-state and boolean-effect JS onto this, additive — Hanoi (n=1..8) and river-crossing byte-identical | Generic engine extension; adventure is its first consumer, not its whole scope |
| 183 | Spider-fly grid world generation | implemented | `3f45960`; 100 cells + `has-exit-*` edges, seed taxonomy, worlds-pack shard | |
| 184 | Spider-fly headless turn engine (fold, pathfinding, belief, ecology) | implemented | `3bd4fe8`; `src/services/spider-fly.mjs`; `test/services/spider-fly.test.mjs` — 60/60 | |
| 185 | Spider-fly chat-lane integration (4th game lane, cross-game coexistence guards) | implemented | `084a1fb`; corpus rows `sf-declines-while-adventure-active`, `sf-adventure-declines-while-active`, `sf-guess-number-declines-while-active`, `sf-plan-declines-while-active`, all pass | |
| 186 | Spider-fly rendering + pages (sprites, silk-thread plan, POV overlay, chat dock, full-screen page, home embed) | implemented | `cf5a3ab`; `src/services/spider-fly-viz.mjs`; `public/spider-fly.html` generated (gitignored, build-time artifact, same pattern as the adventure page) | |
| 187 | Spider-fly ecology v2 — seeded wandering, spider-avoidance, dynamic 10-turn webs, mass symmetry | implemented | `1828083`, `PLAN_GAMES_UPLIFT_V2.md` Part A; `mulberry32(fnv1a32(...))`, never `Math.random`; priority avoid-spiders > chase-flies > hold-and-build; `hasActiveWebAt` traps a fly on entry; a spider gains exactly the eaten fly's post-decrement mass; `games.spider-fly.*` (17 rows), `test/services/spider-fly.test.mjs` | Fully deterministic and replayable — two runs from the same starting facts produce the byte-identical "random" sequence |
| 188 | Shared play/pause/step/reset ticker primitive | implemented | `src/services/viz-ticker.mjs`, `test/adapters/viz-ticker.test.mjs`; 4 consumers now: the ledger explorer, spider-fly's page, the guess-number retrofit (`651395e`), and the adventure auto-play page | Extracted on demonstrated reuse, not built speculatively — see §4.4's Phase-5 decision note |
| 189 | Adventure graphics renderer — room scene drawn from exactly what the text digest reports | implemented | `22cedcb`; `src/services/adventure-viz.mjs`; `test/adapters/adventure-viz.test.mjs` — 10/10 | Draws exactly what `roomAffordances`/`worldDigestRows` already say, never a second, divergent source of truth. Evidence tier: adapter-level test, no corpus-lane row yet |
| 190 | Adventure sprite-map registry + objective marker fact | implemented | `432bf36`; `src/domain/sprite-map.mjs` +50 lines, purely additive; the existing ancestor-walk resolver needed no code change; `mgx:is-objective` marker fact feeds row 191 | 6 new registry entries: room, furniture, portable, person, adventurer, container |
| 191 | Goal-inferring adventure auto-play (explore / fetch / win / stalled), exposure-gated | implemented | `972db46`; `src/services/adventure-autoplay.mjs`; `test/services/adventure-autoplay.test.mjs` — 11/11, including the safety-property test: "the objective's TRUE room is known to the full store but not yet exposed, and auto-play explores rather than beelining to it" | Executes through the same `runWorldCommand` entry a real chat turn calls — no second interpreter. Evidence tier: adapter-level, no corpus-lane row yet |
| 192 | Adventure browser bundle + full-screen page + home-page embed | implemented | `ac33ae0`; `src/surfaces/web/adventure-browser-entry.mjs`, `scripts/build-adventure-bundle.mjs`; `e2e/pages-index.test.mjs` hero-ordering assertion extended (`.adventure-hero`) | |
| 193 | Playtest edge-hunt as a named, repeatable process | implemented (process) | `SKILL_PLAYTEST_EDGE_HUNT.md`, `EXAMPLE_PLAYTEST_LOG.md` (both predate this audit window but never had a row); `playtests/PLAYTEST_LOG_003.md`–`_007.md` (5 rounds this window, each tied to a real shipped fix: `e87a767`, `49efce8`, `34d7728`, `e643a24`, `84141c4`), closed `ddb5b94` | Same precedent as row 68's strategy-advisor: a process can be a row |
| 194 | TOOL-7 observe-and-replan branch + TOOL-8 tied-candidate composer (router mechanism) | implemented | `f85306d`/`d8d72cf`, `PLAN_TOOL_LADDER_UPLIFT.md` (DELIVERED); `resolver.mjs`'s `testModuleTie()`, `planner.mjs`'s `recover` method; `test/adapters/router-drive.test.mjs`, `test/adapters/router-resolver.test.mjs` | Distinct from row 66 (the benchmark measuring it) — this is the shipped mechanism itself, same relationship as rows 165-167 to row 67 |
| 195 | `resolveMemoryTerm` — a second resolver binding oracle (memory-graph SKOS view, sibling to `resolveObject`'s code-graph binding) | implemented | `e5f84e1`; `src/domain/router/resolver.mjs` (+64 lines); `test/adapters/router-resolver.test.mjs` | Closes the NL-reachability half of `tmct_related`'s 2.6.0 gap (row 51/155 cover the registry half) |
| 196 | Trailing subordinate-clause stripping | implemented | `37bc71b`; `applySubordinationFrames` strips a comma-anchored trailing framing clause, not just a leading one; adds "even though"/"though"; row `grammar.noise.subordination` | |
| 197 | Passive commit-count phrasing normalization | implemented | `7b0dbe7`; "how many commits are recorded for X" → "how many commits touched X"; row `grammar.count.commit-passive` | |
| 198 | Qualifier-only head disambiguation | implemented | `3610bf4`; "tested modules importing X" parses as an adjective stack over the importer set, not a nested reverse-relation clause; row `grammar.compositional.qualifier-head` | |
| 199 | "but do not \<verb\>" / bare "but" coordination split | implemented | `91e123c`; do-support negated coordination reads as difference, a bare "but" before a qualifier branch reads as intersection; rows `grammar.compositional.but-do-not`, `.but-qualifier` | |
| 200 | Trailing discourse-tag stripping + turn-record miss-flag boolean fix | implemented | `56eb4a6`; a trailing bare "then" strips in the shared normalize pre-pass; the relaxed-turn record's `miss` flag is now a real boolean, never a short-circuited `null`; row `grammar.noise.trailing-discourse-tag`, `test/adapters/chat-turn-record-flags.test.mjs` | |
| 201 | Plural-object fold on quantified has-teach | implemented | `a26425f`; "all dogs have tails" now stores the object singular ("tail") as well as the subject, matching how forward/reverse have-questions read it back; row `inference.quantified.has-teach` | Grammar-normalization fix living in the teach layer, corpus-pinned in the `inference` lane |
| 202 | Bare vocabulary noun answers from corpus, not the identity blurb | implemented | `7b482f1`; row `template.vocab.bare-noun` | Distinct from row 98's code-graph bare-entity mechanism |
| 203 | Staccato subject-swap survives a what-else turn | implemented | `7b482f1`; row `template.vocab.staccato-swap` | Fixes the original CONVERSATION-2.7.11 ratchet item-15 pivot bug once a session reaches it (see row 160's caveat for the newer, earlier dead-end) |
| 204 | Detailed app-overview phrasing grounds on the ranked entry-point module | implemented | `4edc294`; row `grammar.routing.app-overview` | "give me a detailed summary of how this app works" now grounds instead of returning a bare module name with no account |
| 205 | Rename-history honest decline | implemented | `aaa64d7`; "what was X called before" (and named/known-as/used-to-be siblings) declines by name instead of confirming a rename that never happened | |
| 206 | Collective-plural union resolution | implemented | `aaa64d7`; "what do the handlers import" answers the disclosed union over every module sharing a path component, instead of a silent single best-match | |

## What moved since 2.6.0

**Status flips — two, both upward, none downward:**

- **51/155 Registry gap: `implemented (caveat)` → `implemented`.** `tmct_related` joined the capability
  registry (16 capabilities, was 15) with a `memoryFacts` precondition (`96d40fe`), and gained NL
  reachability via a new resolver oracle, `resolveMemoryTerm` (`e5f84e1`, row 195). `ab-a0-related-sofa`
  now passes on the resolver and goal AGENTBENCH arms.
- **— `PLAN_ADVENTURE.md`: `claimed-only, RESEARCH/DESIGN` → `implemented`.** The whole adventure game
  shipped, archived, and is corpus-pinned 55/55. See rows 175-181 for its component capabilities.

**Quality-up moves (status held, the number moved):**

- **66 AGENTBENCH: 62/66 (94%, gated TOOL-7) → 68/68 (100%, every rung clears).** Both 2.6.0-named
  horizons (TOOL-7 replan, TOOL-8 composer) are fixed and measured clean.
- **168 The is-a ladder's property lift: 1-hop → a bounded 2+ hop chain.** Flips INF-4's ceiling count
  35→30, attributed to `4edc294`.
- **36 The capability envelope regenerated** for the 68-case ladder, `gatedAt` now `null`.
- **65 CHATBENCH's figure moved from carried-forward to current** (mean 1.809/2, 138 cases) — flagged
  with the judge-prompt v1→v2 caveat, not a clean lever comparison.
- **101 The corpus estate grew two lanes and 28 key groups**: 13/897/428 → 15/1017/495.
- **162 `test:fast` grew 181 → 183 tests.**

**Caveats added on rows that kept their status (real findings, not regressions of a pinned test):**

Rows 8, 71, 92, 140, 145, 157, 160, 171 each carry a fresh CEFR-2.7.12 or CONVERSATION-2.7.11 finding —
either a still-passing pinned test alongside a benchmark-found new-shape dead-end in the same family, or
a residual the ratchet re-check confirms is not yet closed. Listed with full detail in each row above.

**Downward — one, operational, not a capability regression:** row 131's ask-bundle drift guard is red
again at this pin, the same finding 2.6.0 made. This is the guard doing its job, not a capability that
regressed — the underlying browser-ask capability itself is unaffected; only the committed artifact is
stale pending one rebuild.

**New rows 174-206** — 33: the child triples pack, the full adventure game (7 component capabilities:
world-loading, imperative grammar, world interpreter, NPC scheduler, dead-end routing, examine/talk
framing, verb-synonym/typo uplift), the taught fact-value rule shape, the full spider-fly game (5
component capabilities: grid world, turn engine, chat-lane integration, rendering+pages, ecology v2),
the shared ticker primitive, the adventure graphics/auto-play/browser-hero triad (3 capabilities), the
playtest edge-hunt process, the TOOL-7/TOOL-8 mechanism itself, `resolveMemoryTerm`, and 11 chat/grammar
fixes from this session's CONVERSATION/CEFR backlog closure.

## 4.1 Comparative agent-capability table + speculative TO-BE

tmct is a narrow, deterministic, zero-cost system. It cannot fabricate, because it has nothing to
fabricate with: every answer traverses a stored graph, and where the graph is silent it says so. Since
2.6.0, both named router horizons closed, one inference ceiling moved for real, and two full games
shipped from a standing start. Model-column verdicts are **informed estimates from public capability
tiers, not a measured cross-benchmark result** — no run in this repo scores Sonnet or Llama. Columns are
named, specific models, never an umbrella brand or a hosting surface.

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
| **tool use** | 100% plan/result completion, 0% hallucination on every rung, **68/68 (100%), no gate** (`BENCHMARK_AGENT_2.7.12.md`, goal driver — up from 2.6.0's 62/66 gated at TOOL-7). 23 declared tools, 3 dispatched hot, 16 registry capabilities. | **Comparable.** Broader vocabulary; no 0%-fabrication guarantee. | **Weaker.** Malformed calls routine. |
| **planning** | The same 68/68 with a proof; Hanoi to the 2³−1 optimum, river to the classic 7. Both named horizons from 2.6.0 are closed: the replan branch (TOOL-7) and the tied-candidate composer (TOOL-8) both measure 100% on every arm that reaches them (`BENCHMARK_AGENT_2.7.12.md`). | **Comparable-to-stronger.** Plans over open domains tmct cannot represent; weaker on optimality guarantees. | **Weaker.** No reliable decomposition. |
| **reasoning (formal)** | 379/379 chat, 100/100 kernel, 0% fabrication across eight bands (`BENCHMARK_INFERENCE_2.7.12.md`). Read with its ceilings: 56 greens are declared floors (down from 61 at 2.6.0 — a bounded property-inheritance lift flipped 5 to live pins). A proof crossing a stored contradiction still refuses, naming both facts, 8/8. | **Comparable.** Handles the same syllogisms and more, without the closed vocabulary — but without a proof, and will assert an unentailed conclusion. | **Weaker.** Fails multi-hop chains. |
| **reasoning (open-world)** | Absent by construction. Off-vocabulary requests land on the miss wall (`games.honest-miss`); the cleanest miss now consults two shipped, cited packs in sequence — a 93,161-fact child triples tier, then the 3,887-article reference pack — before the wall (rows 163, 174). | **Stronger.** The axis a language model is for. | **Stronger.** |
| **grounding** | groundedness contributes to a **1.809/2 overall mean** over 138 cases (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`; judge prompt moved v1→v2 since 2.6.0, not a clean lever comparison). Every answer carries a source; pack answers cite the article; `reference`/`corpusWeak` provenance ranks below teach/operator by design. | **Comparable.** No per-fact provenance by construction. | **Weaker.** Confabulates sources. |
| **memory** | An OWL-labelled graph on disk with per-fact provenance over 9 source kinds, trust, contradiction detection, and an ATMS-grade retraction story, unchanged and re-confirmed this cycle (`test/adapters/syllogise.test.mjs`, 124/124). A latent corpusWeak Source-minting bug closed (row 21/24). Snapshots Backend-A only. | **Comparable-to-stronger** in practice; no durable, inspectable, retractable store. | **Weaker.** Context only. |
| **instruction-following** | Not a capability tmct has. It follows a grammar. Two full games (adventure, spider-fly) now demonstrate that grammar composing real, stateful, multi-turn interaction, not just single-shot Q&A. | **Stronger.** | **Stronger.** |
| **generation** | Deterministic templates; conversational tag scores **2.000/2**, 12 cases, 0 hard fails (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`, current, same value as 2.5.0's carried figure). | **Stronger**, by a distance. | **Stronger.** |
| **coding** | Absent. tmct reads graphs; seonix indexes code and calls tmct (`README.md`). | **Stronger.** | **Stronger.** |
| **safety / honesty** | **The axis tmct wins.** 0% hallucination across 272 agent rows and 0% fabrication across 479 inference rows, both re-verified at 2.7.12 (`BENCHMARK_{AGENT,INFERENCE}_2.7.12.md`); honesty tag 1.958/2 for the honesty-miss family (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`). The worst remaining live behaviour is not a router pick anymore — it's the write-boundary bug class (CONVERSATION-2.7.11 finding #2), where a casual/imperative phrasing outside the specific 2.6.0 triggers still gets silently written to memory. Named, ranked, and routed, not silent. | **Weaker** — it *can* fabricate and tmct cannot; refusal is trained, not structural. | **Weaker.** |
| **autonomy** | None, deliberately. The only LLM in this repo is the offline judge. A goal-inferring adventure auto-play mode (row 191) now demonstrates bounded, honest autonomy inside a closed world — it explores rather than fabricating a path through facts it has not seen. | **Stronger.** | **Stronger.** |
| **breadth** | 664 default seeded facts, 12,001 at `human-large`, a 93,161-fact child pack, and a 3,887-article reference pack at the miss tier; a closed relation vocabulary. | **Stronger**, by orders of magnitude. | **Stronger.** |
| **cost / determinism** | **$0 per turn.** INFBENCH `--replay` re-confirmed byte-identical across 2 runs this cycle; two new games (spider-fly's ecology, adventure's auto-play) are seeded rather than wall-clock-random, so both stay fully deterministic and replayable under load too. | **Weaker.** Priced per token; not byte-identical across model versions. | **Weaker**, though cheap. |

The shape is unchanged from 2.6.0: tmct's cells are narrow and its numbers high inside that narrowness.
What changed is that both router horizons closed and the safety/honesty row's one remaining live gap
moved from a router pick to a chat-lane write boundary — narrower, but not yet zero.

### Speculative TO-BE

Drawn from the four fresh reports' own backlogs and `HANDOVER.md`'s open items. Not a roadmap
commitment; each checked against the tree as not-yet-shipped.

- **The write-boundary bug class's admission criteria, tightened generally.** CONVERSATION-2.7.11's own
  "Next" section: exclude interrogative markers, imperative-verb-led sentences, and self-referential
  meta-sentences from the bare-declarative teach lane before it falls through, rather than patching each
  new trigger phrase as it's found — the pattern recurring under entirely new triggers each cycle
  suggests the lane's admission criteria, not the phrase list, are the real target.
- **A recognizer for meta-questions about tmct/the session itself** (CONVERSATION-2.7.11 finding #3) —
  six-plus real, answerable questions about tmct's own commands and session state currently misroute
  into the teach or relation-query parser rather than declining or answering, even though the underlying
  capabilities all work when invoked directly.
- **Investigate `g-b2-count-temp-1`'s undercounting** (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`'s highest-
  priority next lever) — a regex-shaped pass the judge caught as a wrong answer (graph records 2 derived-
  from commits, the answer said 1).
- **Multi-set (3-way) cross-turn composition and multi-construction compounds** (passive+relative-clause,
  filler-clause prefixes) — a recurring capability ceiling several B2/C2 CEFR constructions and multiple
  CONVERSATION personas both independently surfaced.
- **The EL and DL stages** (`PLAN_SYLLOGIST_EL_DL.md`) — flip the 26 INF-7/INF-8 horizon rows, unchanged
  this cycle (14/14, 12/20).
- **Attribute the ask-bundle drift's recurring root cause**, not just rebuild it again — five rebuilds
  this session alone suggests the rebuild-on-merge discipline itself, not any one merge, is the gap.
- **Give the two new games a corpus-lane row for their adapter-tier-only capabilities** (rows 189, 191 —
  the adventure graphics renderer and auto-play are unit/adapter tested but have no keyed chat-surface
  row yet).
- **Fold spider-fly and adventure into the next CONVERSATION sweep** — the 2.7.11 report explicitly did
  not probe either; both are now measurable.

## 4.2 Per-benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md`
- Reformed nine-rung ladder measured on all four arms, 68 cases, 0% hallucination across 272 rows — **complete** (`BENCHMARK_AGENT_2.7.12.md`)
- Goal driver 100% through every rung, no gate — **complete** (`BENCHMARK_AGENT_2.7.12.md`)
- The tied-candidate composer (TOOL-8) and the replanning branch (TOOL-7), both 2.6.0's top build targets — **complete** (row 194)
- Identify the second new case precisely (append-only discipline) — **todo** (report's own backlog item 1)
- Fixture module-id alignment; the SKOS positive case — **complete** (rows 155, 195; `fe76171`, `e5f84e1`)

### `SKILL_BENCHMARK_CEFR_ENGLISH.md`
- Product replay + judge fan-out at concurrency 12, 138 cases, mean 1.809/2, 5 hard fails, 0 voided — **complete** (`BENCHMARK_CEFR_ENGLISH_2.7.12.md`)
- A precise like-for-like recomputation over 2.6.0's exact 128-case subset — **todo** (report's own gap, not prioritized under its time budget)
- Investigate `g-b2-count-temp-1`'s undercounting — **todo**
- Attribute the judge-prompt v1→v2 change precisely — **todo**

### `SKILL_BENCHMARK_CONVERSATION.md`
- Persona sweep, 6 frames, re-verifying 2.6.0's full 29-item backlog — **complete** (`BENCHMARK_CONVERSATION_2.7.11.md`)
- 25 of 29 items net-fixed (21 clean, 4 residual); 4 still broken (2 in a materially new shape) — **complete** (measured, routed)
- Ratcheting FLOW-0 clean (three fresh conversations, zero dead-ends) — **todo**, unchanged from 2.6.0; new FLOW-0 edges keep surfacing under fresh phrasing
- Probing the two new games (spider-fly, adventure graphics/auto-play) — **todo**, explicitly out of scope for this sweep (built after it was dispatched)

### `SKILL_BENCHMARK_INFERENCE.md`
- Reformed eight-band ladder, both arms: 379/379 chat, 100/100 kernel, 0% fabrication, byte-identical replay — **complete** (`BENCHMARK_INFERENCE_2.7.12.md`)
- Case set held byte-identical, no lever applied to the generator — **complete**
- The named lifts: the bounded property-inheritance lift shipped, flipping INF-4's ceiling 35→30 — **complete** (row 168)
- Attribute the INF-4 move to its actual commit — **complete** (this audit; `4edc294`)
- The EL and DL stages (`PLAN_SYLLOGIST_EL_DL.md`) — **todo**, unchanged (14/14, 12/20)

## 4.3 Per-plan feature-support (Done / Doing / Todo)

Re-checked against the tree at this pin.

- **`PLAN_TOOL_LADDER_UPLIFT.md`** — pinned at `d8d72cf`, banner **DELIVERED**. **Done**: both build
  targets (TOOL-8 tied-candidate composer, TOOL-7 observe-and-replan branch) are live code, measured
  100% on every arm that reaches them (row 194). **Todo**: nothing in-plan, but its own banner is stale
  on two counts — cites 67 cases (now 68) and reads as if every case passes on the resolver driver
  (false by design; the resolver floor still gates at TOOL-6, 36%, needing the goal-reasoner's own
  composition). Flagging both for the coordinator rather than editing the plan doc myself. Candidate
  for `archive/` once those two lines are fixed.
- **`PLAN_GAMES_UPLIFT_V2.md`** — pinned at `565aa31`, banner reads "DESIGNED, build in progress" —
  **stale**, both parts are fully merged. **Done**: Part A (spider-fly ecology v2, `ca25909`) — all
  §A.3-listed files present, tests pass (rows 187). Part B (adventure graphics + auto-play, `c7cccdd`)
  — all §B.5-listed files present, tests pass (rows 189-192). Its own "Non-goals for this pass" section
  (not a general graphical adventure engine, not a general-purpose goal-inference framework, not a
  redesign of spider-fly's told-fact chat-integration seam) is still accurate against the tree — checked
  each independently. **Todo**: nothing in-plan remains open by the plan's own file-touch lists.
- **`PLAN_SYLLOGIST_EL_DL.md`** — pinned at 2.6.0, banner RESEARCH/DESIGN, unchanged. **Done**: nothing
  new this cycle. **Doing**: nothing. **Todo**: INF-7/INF-8 measure its absence as 26 declared-floor
  rows, unchanged (14/14, 12/20) — this plan has a benchmark seat waiting for it, same as 2.6.0.
- **`PLAN_CONSISTENCY_CHECK.md`** — DESIGN, approved in outline, not built as a service (row 151) —
  unchanged. Detection stays live at the chat layer.
- **`PLAN_EMBEDDINGS.md`** — design only, banner exactly true, unchanged — every similarity mechanism in
  `src/` is still a closed table. A research horizon.
- **`PLAN_REPO_INDEX.md`** — RESEARCH/DESIGN, not implemented, unchanged. No parser dependency, no
  `extract_ast*` file, no `tmct index` verb — matches its own stated baseline exactly.
- **`PLAN_MUD.md`** — RESEARCH/DESIGN, not implemented, unchanged. No `server:` memory-backend branch.
- **`PLAN_CLASS_QUERY.md`** — RESEARCH/DESIGN, not implemented, unchanged. All 5 phases still open.
- **`PLAN_PARAPHRASE_VERIFICATION.md`** — RESEARCH/DESIGN, general verifier not built, unchanged. The one
  narrow slice already shipped at 2.6.0 (`verifySubClassParaphrase`) is confirmed still present.
- **`PLAN_CODE.md`** — Track 1 SHIPPED (row 46); Tracks 2-4 sign-off-gated (row 47), unchanged.
- **`PLAN_NLU_BENCHMARKS.md`** — RESEARCH/DESIGN, nothing live, unchanged. Its own "as-is estimate"
  section cites stale counts (15 registry capabilities, 22 declared tools — both now 16 and 23); flagged
  to the coordinator rather than edited, outside this audit's scoped deliverable.
- **`PLAN_AGENTS.md`** — refreshed by this audit (§5, below): the capability-registry count, the
  `tmct_related` caveat, and the AGENTBENCH case count were stale; corrected this commit.
- **Archived since `bab4a23`** — `PLAN_ADVENTURE.md` (SHIPPED, 2.7.0 wave), `PLAN_CHILD_CORPUS.md`
  (DELIVERED), `PLAN_ADVENTURE_ROUTING.md` (DELIVERED), `PLAN_GRAPH_SCAN.md` (SHIPPED, unchanged from
  2.6.0's own note), `PLAN_25_BACKLOG.md` (DELIVERED), `PLAN_DIALOGUE_ACTS.md` (DELIVERED),
  `PLAN_GUESS_NUMBER.md` (DELIVERED), `PLAN_LEARN_ON_MISS.md` (DELIVERED), `PLAN_SYLLOGIST.md`
  (DELIVERED). `PLAN_BENCHMARK_LADDERS.md`'s stale archived banner (flagged at 2.6.0) was fixed this
  window (`26c4296`).
- **`PLAN_SPIDER_FLY.md`** — archived, banner **BUILT**, but not a one-line pointer: its own §13 names
  three items that stay explicitly open — the vision radius (`radius=4`) was never measured against the
  real rendered page and drifts as both agents move; the four-lane `planState` pattern is flagged "watch,
  not solved"; the spatial teach-frame's full phrasing coverage was never edge-hunted the way the
  adventure grammar was. None of these closed this cycle.

## 4.4 Non-benchmarked capabilities

Real, shipped work no benchmark scalar reaches.

- **The child-pack build pipeline** (row 174's supply side): a keyword-indexed shard cut from a pinned
  ConceptNet 5.7.0 dump, `/r/NotCapableOf` admitted as the one ConceptNet negative for the child pack
  (the other four `/r/Not*` relations are ConceptNet's own deprecated relations, documented "do not
  build on" — this closed a `HANDOVER.md` open item, `998301e`/`c527984`). The pack's integrity is an
  estate property, not a benchmark score.
- **Two `HANDOVER.md` open items closed as design decisions, not deferrals** (`c527984`): the Phase-5
  "unifying agent-loop abstraction" question, closed as not warranted — evidenced by row 188's shared
  ticker primitive and the taught-rule engine (row 182) both being extracted only on demonstrated second
  use across four independent systems (Hanoi/river, guess-number, adventure, spider-fly), never built
  speculatively ahead of a real second consumer. The `/r/Not*` widening question, closed above.
- **The reference-pack and browser-bundle build pipelines** (rows 163-164, carried) — unchanged.
- **The dialogue-act ontology co-declaration** (row 139, carried) — unchanged.
- **The roll machinery** (row 173, carried) — this cycle showed its limit again: the bundle drifted
  behind post-roll commits a second time, and the estate guard caught it a second time (row 131).
- **Determinism and cost.** $0 per turn, byte-identical on rerun, re-verified in the INFERENCE report
  this cycle; both new games are seeded rather than wall-clock-random for the same reason.
- **The `Canonical:` line** (row 129, carried). Still the product's best self-diagnostic.

## 5. `PLAN_AGENTS.md` — refreshed

Walked against this audit's status table, per `SKILL_CAPABILITIES_AUDIT.md` §5. Corrections applied in
this commit:

- **§1's ground-truth table, tool-layer row** — the caveat "`tmct_related` (2.6.0) is dispatched but
  sits in neither the registry nor the exclusion list yet" is deleted; it is false as of `96d40fe`.
  `tmct_related` sits in the registry with a real `memoryFacts` precondition, and `EXCLUDED_FROM_REGISTRY`
  still lists exactly its original 3 entries. `TOOL_DEFINITIONS` count (23, 3 hot / 20 cold) was already
  accurate and needed no change.
- **§1's capability router row** — "15 capabilities via `capabilities()`" corrected to **16**, confirmed
  live.
- **§1's AGENTBENCH row** — "67 cases" corrected to **68**, confirmed against `agentbench/envelope.json`'s
  `generatedFrom.caseCount`.
- **Every cited `src/` path re-checked and resolves** — no renames since 2.6.0's own refresh.
- **Status block vs. body** — no new contradiction found; "Phase 0 done / Phase 1 partial / Phases 2-5
  not started" still matches the body and §11's sequencing table.

## 6. Summary — real counts, grepped

Counts obtained by grepping the status column of the two status tables above (rows 1-173 and 174-206).

**205 rows** (172 carried forward from `CAPABILITIES_2.6.0.md` — its own sequence has no #63 and merges
21/24 — plus 33 new at #174-206):

| Status | Rows |
|---|--:|
| `implemented` (incl. sub-variants: opt-in, on-by-default, extended, deepened, estate-guarded) | **177** |
| `partial` | 9 |
| `claimed-only` | 14 |
| `absent` | 2 |
| `reverted` | 1 |
| retired / process change | 2 |

Counts re-verified by grepping the Status column of both tables (`awk -F'|'` over every data row), not
eyeballed — 177 + 9 + 14 + 2 + 1 + 2 = 205, the full row count.

`implemented` rose 143 → **177** (+34): the `PLAN_ADVENTURE.md` pointer row flipping from `claimed-only`
to `implemented` (-1 from that bucket, +1 to this one — 2.6.0's 15 `claimed-only` rows included this
one unnumbered pointer, so `claimed-only` falls to 14 accordingly), plus all 33 new rows (174-206)
landing `implemented`. Row 51/155's registry-gap closure is a caveat closing, not a bucket move — 2.6.0
already counted row 51 as `implemented` with a named caveat, so it stays in the same bucket. `partial`
and `absent` counts hold exactly at 2.6.0's own figures — no row moved into or out of those buckets this
cycle. **No row moved downward** in capability terms; row 131's guard is red again, an operational (not
capability) regression, called out explicitly above and in its own row.

### What flipped since `CAPABILITIES_2.6.0.md`

**Upward** — the registry-gap closure (rows 51/155) and the `PLAN_ADVENTURE.md` pointer, plus five
quality-up moves with no status change (36, 65, 66, 101, 162, 168) — listed with evidence in *What moved
since 2.6.0* above.

**Downward** — one, operational: row 131's ask-bundle drift guard, red again at this pin. Not a
capability regression; the guard is doing exactly the job it exists for.

**New — 33 rows (174-206).**

### The three findings this audit would lead with

1. **Both router horizons 2.6.0 named as its highest-priority build targets are closed, and the gap they
   left behind moved somewhere new.** TOOL-7's double-fire and TOOL-8's silent pick both measure 100%
   clean. The worst remaining live safety/honesty gap is no longer a router pick — it's the write-
   boundary bug class, shown recurring under fresh casual/imperative phrasings even after its 2.6.0
   triggers were fixed (CONVERSATION-2.7.11 finding #2). Fixing named triggers treats the symptom; the
   report's own "Next" section names the real lever (tighten the teach lane's admission criteria
   generally).
2. **Two full games shipped from a standing start, and neither is measured by three of the four
   benchmarks.** The adventure game and spider-fly are built, playable, corpus-pinned (72 rows across
   two new shards), and rendered on the website with goal-inferring auto-play and a seeded ecology. AGENT,
   INFERENCE, and CEFR don't touch games; CONVERSATION 2.7.11 explicitly predates both. This is real,
   shipped capability that "no benchmark moved" would otherwise make invisible — exactly what §4.4 exists
   to name.
3. **The estate's drift guard caught the exact same class of drift twice**, which is a genuine signal
   about the release discipline, not a fluke. Five rebuild commits chased the ask bundle through this
   session's own merges; the guard is doing its job every time, but the pattern (a rebuild lands, then
   an unrelated later merge re-drifts it) suggests the fix is in the merge discipline, not in rebuilding
   harder.

`npm test`: run in the foreground for this audit; see the coordinator's own report for the live count —
this document is written before that final gate, per `SKILL_CAPABILITIES_AUDIT.md` §9 ("this is not a
benchmark run"). `npm run test:fast` at this pin: **183 pass / 0 fail** (~1.5s, re-run live during this
audit). CLI smoke (`printf 'hi\n/exit\n' | node bin/tmct.mjs`) greets and exits 0 per the standing e2e.
