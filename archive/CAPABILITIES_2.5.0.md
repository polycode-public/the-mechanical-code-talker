# CAPABILITIES_2.5.0.md — tmct capability audit (refresh 8, re-audit over `CAPABILITIES_2.0.3.md`)

Pinned at `d133c6c`, `package.json` 2.5.0, 2026-07-17. This is a re-audit: every `CAPABILITIES_2.0.3.md`
row carries forward with its status re-checked against the evidence order in
`SKILL_CAPABILITIES_AUDIT.md` §1, and every status that moved is called out with its evidence.

**Audit window (analysis, not a benchmark run):** 2026-07-17, ~22:14 → ~22:30 CEST. No harness was
re-run. This audit reads the four fresh `BENCHMARK_*.md` reports, the corpus estate, the tool layer
and the code at this pin.

**Method for carried-forward rows.** `CAPABILITIES_2.0.3.md` recorded near-total citation rot in its
own line numbers (its finding 2), while the statuses held. This re-audit does not re-verify every
2.0.3 line number — it owns no code and re-pinning ~150 dead line refs is out of scope. Instead it
re-checks each status against the **stable** evidence identifiers (a corpus row `key`, a test file
name, a tool-layer contract test), which do not rot, and it re-verifies from the code every row the
2.5.0 work is said to have moved. Where a row is unchanged, it restates the status with its stable
citation and moves on, per §8.

## Per-benchmark provenance — where every figure came from

| Benchmark | Latest report | Figure comes from |
| --- | --- | --- |
| AGENT | `BENCHMARK_AGENT_2.5.0.md` | **2.5.0, current** |
| CEFR_ENGLISH | `BENCHMARK_CEFR_ENGLISH_2.5.0.md` | **2.5.0, current** |
| CONVERSATION | `BENCHMARK_CONVERSATION_2.5.0.md` | **2.5.0, current** |
| INFERENCE | `BENCHMARK_INFERENCE_2.5.0.md` | **2.5.0, current** |

`max(2.5.0, 2.5.0, 2.5.0, 2.5.0)` is 2.5.0, so this audit is `CAPABILITIES_2.5.0.md`. Every axis was
re-measured at 2.5.0 before this was written; no figure is carried forward.

Three caveats travel with those figures:

- **CEFR 2.5.0 ran at N=1 on the default pool** (operator's choice, matching 2.0.3): 109 cases, 109
  judge calls, `voidCount` 0. The pool tests **9 of 23 construction shapes**. Its mean (1.817/2) is a
  baseline, not comparable to N=2 runs, but its **tier-1 figures are deterministic and fully
  comparable** — which is how it confirmed the passive recovery and caught the `be-honest-empty`
  frozen-expectation drift.
- **INFBENCH's 259/259 includes 30 greens graded against a declared ceiling** (`b2ChainLenK`, down
  from 50 at 2.0.3). Read INF-B2's 50/50 as 20 real proofs plus 30 honest declines. INF-C2's 20/20 is
  **now a live consistency detection**, no longer a ceiling.
- **One lever was applied this cycle, on one axis.** CEFR re-measures the committed fronted-agent
  passive fix (`7c05ffd`); its tier-1 passive recovery is attributable to that fix. AGENT and
  INFERENCE are pure re-measurements (no code changed); CONVERSATION measures and routes only.

## What the four fresh reports change about this audit

The theme of 2.0.3 was: the honesty machinery holds, and the risk sits in *input discarded before the
parser*. The theme of 2.5.0 is: **every one of those input-discard defects is fixed and pinned, and
the risk moved one level in** — from words dropped before parsing to routing/recognition gaps and one
proof emitted *after* parsing that never checked a fact the store already held.

- **CEFR** records the one deterministic win of the cycle: the fronted-agent passive is fixed.
  `reversible-passive` **1.600 → 2.000**, tier-1 8/10 → 10/10, the 2.0.3 hard fail gone. tier-1
  overall 107/109 → 108/109 (+2 passive, −1 a new frozen-expectation drift on `be-honest-empty`).
- **INFERENCE** grew two real discriminators and passes both: the **existential probe** (`b1Existential`,
  40 chat + 10 kernel) — `some N1s are N2s` no longer becomes a universal proof, it is refused — and
  **INF-C2 flipped from declared ceiling to live consistency detection** (20/20 `inconsistent`
  observed). 259/259 chat, 90/90 kernel, 0 fabrication. `infbench/cases.jsonl` is byte-identical on
  regeneration and now estate-guarded.
- **AGENT** moved no verdict: 56/56 goal driver, every rung gated PASS, 0% hallucination across 168
  rows, re-measured at 2.5.0.
- **CONVERSATION** confirms all eight 2.0.3 headline defects fixed, and is the source of the cycle's
  headline finding: an adversarial persona sweep (6 frames, ~410 probes) found **11 new confident-wrong
  routing/soundness gaps**. The worst is proof-shaped: a taught subclass chain proves a conclusion the
  store holds `owl:disjointWith`.

The single most useful sentence in this audit: **tmct's input pipeline is now honest end to end, and
the remaining risk is routing recognition plus one un-wired consistency check on the multi-hop proof
path.** None of the 11 new gaps is a fabrication; ten are misroutes to capabilities tmct already has,
and one (item 1) is a real soundness gap in the proof path.

## 0. Scope note

This audit covers the three sets `SKILL_CAPABILITIES_AUDIT.md` §3 names: the product capability
catalog, what `PLAN_NLU_BENCHMARKS.md` would measure, and what `PLAN_AGENTS.md` leans on. Rows 1-152
carry forward from `CAPABILITIES_2.0.3.md`; rows 153+ are new work since its pin (`7858087`),
recovered from the 130 commit subjects, the corpus key diff, and new `exports`/verbs/plans.

## 1. Full status table

**Status key:** `implemented` · `partial` · `claimed-only` · `absent` · plus the standing
`reverted` / process labels, unchanged since 2.0.3.

Rows whose status **moved** since 2.0.3 are marked **MOVED** in the change note. Unchanged rows cite
their stable evidence identifier and restate the status.

### Rows 1-33

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline | implemented | rows `grammar.compositional` (51), `grammar.relaxation` (27), `grammar.normalize` (19) | unchanged |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | row `grammar.ace` (8) | unchanged |
| 3 | ACE-OWL parser as a standalone MPL-2.0 package | reverted | `packages/` absent | unchanged |
| 4 | OWL 2/RDF/RDFS + SEON ontology grounding | implemented | `test/adapters/grammar-ontology.test.mjs`; `ontology/tmct-core.ttl` | unchanged |
| 5 | Template libraries / response phrase book | implemented | `template.*` key families; `test/adapters/corpus-templates.test.mjs` | unchanged |
| 6 | Filtered ConceptNet corpus slice | implemented, opt-in | `test/adapters/extensions-corpus.test.mjs` | unchanged |
| 7 | Conversational memory as an OWL-labelled graph (3 backends) | implemented | `test/adapters/memory-backend-{sqlite,memory}.test.mjs`; `src/adapters/memory/core.mjs` | unchanged |
| 8 | Input normalization pass | partial | row `grammar.normalize` (19) | unchanged |
| 9 | Repository Interface adapter contract | implemented | `test/adapters/repository-interface.test.mjs` drives `runConformance` over 3 providers, 16 services | unchanged |
| 10 | Runnable conformance suite for RI providers | implemented | `test/adapters/repository-interface.test.mjs` (`runConformance`) | unchanged |
| 11 | Library-first design, stable `exports` map | implemented | `test/estate/pack.test.mjs`; `package.json` exports | unchanged (surface deliberately shrunk to 6) |
| 12 | Ink console TUI shell | implemented | `e2e/tui.test.mjs` drives a real turn | unchanged |
| 13 | Calculation surfaced as reasoning | implemented | `test/adapters/wiring-templates-via.test.mjs` | unchanged |
| 14 | Optionally running linters/tests to observe | claimed-only | nothing in the estate pins it; no such code in `src/` | unchanged |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | absent (named open spike) | `PLAN_SYLLOGIST.md` §5 frames it a far spike | unchanged; a research horizon, not a wall |
| 16 | Response-finishing grammar pass | partial | `test/adapters/finish.test.mjs` | unchanged |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `test/tools/cli-args.test.mjs`; `bin/tmct.mjs` | unchanged |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 19 | `cax-dw` disjointness rule | implemented | `test/adapters/syllogise.test.mjs`; `src/domain/syllogise.mjs` | unchanged |
| 20 | `cax-sco` type-propagation rule | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 21/24 | Actor-level, session-scoped source trust | implemented | `test/adapters/chat-inference-trust.test.mjs`; now also `test/adapters/provenance.test.mjs` (c) | strengthened: trust materialised + auditable |
| 22 | Consistency checking / cardinality / proof-chain materialization | implemented | `test/adapters/syllogise.test.mjs` (`findConsistencyViolations`, `proveCardinalityAtLeast`) | **MOVED (quality up)**: the chat-surface half now measured live — INF-C2 20/20 `inconsistent` (`BENCHMARK_INFERENCE_2.5.0.md`). Still un-wired into the multi-hop subclass-proof path (row 158) |
| 23 | Unified provenance/trust primitive | implemented | `test/adapters/chat-inference-trust.test.mjs`, `provenance.test.mjs` | unchanged |
| 25 | Memory-tree versioning (`snapshotMemory`) | implemented, Backend A only | `src/adapters/memory/core.mjs` (throws on sqlite) | unchanged |
| 26 | Deterministic contradiction detection | implemented | `test/adapters/provenance.test.mjs` (d) — both kept, never silently resolved | unchanged |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/adapters/memory/blocks.mjs`; `provenance.test.mjs` (d) | unchanged |
| 28 | Extension-pack / corpus-lexicon loading seam | implemented | `test/adapters/extensions-corpus.test.mjs` | unchanged |
| 29 | Bias-weighted ambiguity resolution | implemented | `test/adapters/bias-weighting.test.mjs` | unchanged |
| 30 | `tmct init --with-persona`, size-tier flag | implemented | `test/tools/cli-args.test.mjs` | unchanged |
| 31 | Tier-2 general-knowledge bundle (legacy) | implemented, legacy | `test/estate/corpus-schema.test.mjs` | unchanged |
| 32 | A wider general-knowledge seed set | implemented, default | `corpus/tier2/manifest.json` — `human` 664 default, `human-large` 12001 | unchanged |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `test/adapters/corpus-unknown-ingest.test.mjs` (unit ring only) | unchanged — no corpus row drives it |

### Rows 34-66 (no row 63 — the historical table skips it)

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 34 | SHACL-style declarative ingest gate | implemented | `test/adapters/memory-shacl.test.mjs` | unchanged |
| 35 | Cross-repo HTTP smoke test | implemented | `e2e/server-http-smoke.test.mjs` | unchanged |
| 36 | Machine-readable capability envelope | implemented, **now estate-guarded** | `test/estate/generated-artifacts.test.mjs` guards the envelope against generator drift | **MOVED (up)**: was "unpinned by the estate" for three audits; `6ed8f41` added the drift guard, so the version-stamp staleness 2.0.3 flagged can no longer slip |
| 37 | Ontology tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, ON by default | `test/adapters/wiring-facts-memory.test.mjs` (live `runTurn`, lane 3b) | unchanged |
| 38 | Ontology tracks c+d (SEON spine) | implemented, default-off | `test/adapters/grammar-ontology.test.mjs` | unchanged |
| 39 | Subordination/conditional preamble frames | implemented | rows `grammar.normalize.subordination`, `.conditional` | unchanged |
| 40 | Construction-grammar template bank | implemented | row `grammar.construction.agent-noun` | unchanged |
| 41 | Chat-taught relations & rules | implemented | `inference.relation` (30), `inference.teach-lane` (13) | unchanged |
| 42 | `findActionPath` (bounded successor BFS), wired to a real domain | implemented | rows `planning.solve.hanoi`, `planning.execute.river` | unchanged |
| 43 | `findReachableSet` | implemented, wired into chat | `src/domain/planning.mjs`; live chat callers | unchanged |
| 44 | Towers-of-Hanoi goal-directed planning loop | implemented | row `planning.solve.hanoi` (teaches, solves to 7-move optimum) | unchanged |
| 45 | "I am thinking of a number" closed-loop game | claimed-only | `PLAN_GUESS_NUMBER.md` RESEARCH/DESIGN; zero hits for guesser/thinker/bisection | unchanged |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `test/adapters/synth-rules.test.mjs` | unchanged |
| 47 | Program synthesis Tracks 2-4 (sandbox) | claimed-only, sign-off-gated | `PLAN_CODE.md` sign-off gate | unchanged |
| 48 | Completions Stage 0 (broad search + grouping) | implemented | `test/adapters/completions-stage0.test.mjs` | unchanged |
| 49 | Completions Stage 2 (extractive ranking) | implemented | `test/adapters/completions-stage2.test.mjs` | unchanged |
| 50 | Completions wired into a user-facing answer | implemented | `test/adapters/chat-completions-wiring.test.mjs` | unchanged |
| 51 | Capability router — registry + four stages | implemented, corpus-driven | 11 `planning.route.*` rows; `test/adapters/router-drive.test.mjs` | unchanged |
| 52 | `POST /v1/messages` HTTP shim | implemented | `e2e/server-http.test.mjs` (full tool_use→tool_result→end_turn) | unchanged |
| 53 | bedrock-meter $0-rung routing | implemented in sibling repo, not here | `PLAN_AGENTS.md`; tmct side not started | unchanged |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md` Phase 5 | unchanged |
| 55 | `seon-mcp` provider adapter | claimed-only | `PLAN_AGENTS.md` | unchanged |
| 56 | marginalia "mechanical chat" replaced by tmct | claimed-only | `PLAN_AGENTS.md` | unchanged |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md` Phase 3 | unchanged |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md` Phase 4 | unchanged |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet) | implemented | `test/adapters/repository-interface.test.mjs` — absent capability → `miss`, never throws | unchanged; SERVICES 16 |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `test/adapters/source-slice.test.mjs` (rejects traversal before `readFile`) | unchanged |
| 61 | Telemetry wrapper on every RI service | implemented, exercised live | `test/tools/telemetry.test.mjs` (real session, exactly one telemetry file) | unchanged |
| 62 | Chronograph-style temporal diffing | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 "Not started" | unchanged; no `temporal.mjs` module exists (do not read the `ask.mjs` comment as evidence) |
| 64 | Dialogue-flow playtest ladder, Tiers 0-6 | implemented, re-homed | `games.*` lanes across 7 shards | unchanged (rows driving the real session) |
| 65 | CHATBENCH graded-pool ladder | implemented; **tier-1 partly recovered** | `test/bench/chatbench-graded.test.mjs`; `BENCHMARK_CEFR_ENGLISH_2.5.0.md` | **MOVED (quality up)**: tier-1 107/109 → 108/109 (+2 passive recovery, −1 new `be-honest-empty` frozen-expectation drift). Mean 1.801 → 1.817 (inside N=1 noise) |
| 66 | AGENTBENCH agentic ladder (A0-C2) | implemented | `test/bench/agentbench.test.mjs`; `BENCHMARK_AGENT_2.5.0.md` — 56/56 goal, every rung PASS, 0% halluc | unchanged; re-measured at 2.5.0, no verdict moved |

### Rows 67-99

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 67 | INFBENCH classical-logic ladder | implemented | row `bench.infbench`; `BENCHMARK_INFERENCE_2.5.0.md` — chat 259/259, kernel 90/90, 0 fabrication | **MOVED (quality up)**: was ceiling-qualified at 50/219; now **30/259 ceiling-graded** (`b2ChainLenK` only). New `b1Existential` band (40+10) refuses the false-premise proof; INF-C2 grades live consistency (20/20 `inconsistent`); `cases.jsonl` byte-identical on regen and estate-guarded |
| 68 | Strategy-advisor watch process | implemented (process), dormant | `STRATEGY_ADVISOR.log`; no live process | unchanged |
| 69 | Segmentation IR + concept force | implemented | `test/adapters/concept.test.mjs` (unit ring) | unchanged |
| 70 | Negation as bounded set complement | implemented | row `grammar.negation.set-complement` | unchanged |
| 71 | Reversible-passive traversal | **implemented** | 4 rows `grammar.passive.fronted-agent` (incl. a postposed-never-reads-as-fronted guard); `BENCHMARK_CEFR_ENGLISH_2.5.0.md` reversible-passive 1.600 → 2.000 | **MOVED (up), the headline fix**: `partial` → `implemented`. `7c05ffd` fixed the fronted agent; the regression the estate stayed green through is now pinned by keyed rows including a guard, closing exactly the gap 2.0.3 named |
| 72 | Compound-name resolution in `resolveObject` | implemented | row `grammar.compositional.find` | unchanged |
| 73 | Compound matching in `/describe`'s resolver | claimed-only / named gap | `src/domain/codegraph.mjs` `resolveSymbol` — no compound tier | unchanged |
| 74 | Reverse-`inherits` "the"-definite forms | claimed-only / named gap | `src/domain/ask-vocab.mjs` — named but unreachable | unchanged |
| 75 | Cochange phrasing variants + "multi-root" over-match | claimed-only (fix shipped, unpinned) | coordination refusal in `src/domain/ask.mjs` | unchanged; cochange phrasing still unpinned |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 | unchanged |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 | unchanged |
| 78 | Winograd-hard commonsense coreference | claimed-only, research-horizon | `PLAN_AGENTS.md` R3 | unchanged |
| 79 | Shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md` R3 | unchanged |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `test/tools/server.test.mjs` drives `dispatchTool` + `TOOLS` | unchanged |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV, provenance) | implemented, no test | `.gitlab-ci.yml` (CI config; OSV bumped to v2.4.0, `2ccee08`) | unchanged — nothing in the estate drives CI config |
| 82 | Predicate "find" queries | implemented, with a known surface divergence | rows `grammar.compositional.find`, `.superlative` | **MOVED (up)**: the `show me the untested modules` (9) vs `/untested` (7) divergence 2.0.3 named is **closed** — both return 7 (`06d7584`, confirmed `BENCHMARK_CONVERSATION_2.5.0.md`) |
| 83 | Single-sourced `fnv1a` + wink browser-loader seam | implemented | `src/domain/hash.mjs` | unchanged (fact id widened to a 64-bit SHA-256 truncation, `88842f3`) |
| 84 | SQLite memory Backend C | implemented | `test/adapters/memory-backend-sqlite.test.mjs` | unchanged |
| 85 | In-memory Backend B | implemented | `test/adapters/memory-backend-memory.test.mjs` | unchanged |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `e2e/import-file.test.mjs`; `e2e/chat-prompt.test.mjs` | unchanged |
| 87 | Default human-world persona + size tiers | implemented | `corpus/tier2/human*.jsonl`, `manifest.json` | unchanged |
| 88 | `graphService` wired into completions | implemented | `test/adapters/chat-completions-graphservice.test.mjs` | unchanged |
| 89 | Public completions exports | implemented | `package.json` exports → `src/services/completions.mjs` | unchanged |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | retired (fixes stand) | skill deleted; commits in history | unchanged |
| 91 | Persona-sweep as the conversation bench's default | process change | `SKILL_BENCHMARK_CONVERSATION.md`; `BENCHMARK_CONVERSATION_2.5.0.md` ran a 6-frame sweep | unchanged; the new returning-user frame joined the rotation this cycle |
| 92 | Multi-candidate ambiguity resolution | implemented | row `template.ambiguity.multi-reading` | unchanged; `--gaps`: `template.ambiguity` still has **no negative row** |
| 93 | Memory-graph-aware `spiralExpand` | implemented (library-level, not CLI-wired) | `test/adapters/codegraph.test.mjs` | unchanged; still one `src/` caller |
| 94 | Edge/node provenance timestamps | partial (derived half removed) | `test/adapters/provenance.test.mjs` (a) — createdAt first-write-wins pinned; `derivedUpdatedAt` still absent | unchanged status; evidence strengthened by the new provenance suite |
| 95 | Reverse fact-cascade query shapes | implemented | rows `inference.reverse-predicate.by-object` + a negative guard | unchanged |
| 96 | Forward-shape `entityType` grain-checking | implemented | `test/tools/ask.test.mjs` — declines honestly, never names the wrong grain | unchanged |
| 97 | Possessive-named-instance teach shape | implemented | rows `games.teach-then-infer.possessive` + a negative guard | unchanged |
| 98 | Bare known class/entity name → describe/focus | implemented, thin evidence | row `grammar.bare-entity.camelcase` | unchanged; `--gaps` flags `grammar.bare-entity` thin + no negative key |
| 99 | Capability router invocation surface (`tmct plan`, `/plan`, `./plan`) | implemented | `e2e/plan-cli.test.mjs`; 11 `planning.route.*` rows | unchanged |
| — | `PLAN_ADVENTURE.md` | claimed-only, RESEARCH/DESIGN | `PLAN_ADVENTURE.md` header | unchanged; all four of its gaps re-checked open |

### Rows 100-138 — carried forward from the 2.0.3 "new work" block

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 100 | Five-layer `src/` architecture, downward-only imports enforced | implemented | `test/estate/import-layers.test.mjs`; allowlist carries 1 violation | unchanged |
| 101 | Keyed corpus-lane test estate | implemented | `scripts/corpus-matrix.mjs`; **11 lanes / 837 rows / 391 keys** | **grew**: 784/368 → 837/391 rows/keys since 2.0.3 |
| 102 | e2e tier: real binary + real browser | implemented | `e2e/cli-smoke.test.mjs`, `e2e/browser-chat.test.mjs` | unchanged |
| 103 | README examples run against the live product | implemented | `test/readme/readme.test.mjs`, `e2e/readme-examples.test.mjs` | unchanged |
| 104 | Plan lane — teach a game, state a goal, solve it, step it | implemented | rows `planning.solve.hanoi`, `planning.execute.next`, `planning.goal.verbless` | unchanged |
| 105 | Generic action interpreter + action `Rule` family | implemented | rows `planning.legal.one-ply`, `.river-constraints` | unchanged |
| 106 | Taught-action registry seam (`registerCapability`) | partial | row `planning.route.taught-action`; mechanism unit-ring only | unchanged |
| 107 | River-crossing domain | implemented | rows `planning.execute.river`, `.legal.river-constraints` | unchanged |
| 108 | `/capabilities` listing + `tmct plan --tools` | implemented | rows `planning.capabilities.listing`, `.readback` | unchanged |
| 109 | `tmct viz` ledger memory explorer + chat dock | implemented | `e2e/ledger-viz-cli.test.mjs`, `e2e/ledger-viz.test.mjs` | unchanged |
| 110 | Animated self-contained plan render + `chat --render/--output` | implemented | `e2e/chat-prompt.test.mjs`; `test/adapters/plan-viz.test.mjs`; `test/pages` — the render draws the puzzle, not the whole memory (`5c45354`) | **MOVED (up)**: `partial` → `implemented`. The board-geometry defect 2.0.3 fixed is now pinned by the pages test that the plan render draws the puzzle only |
| 111 | `chat --prompt` one-shot turn runner | implemented | `e2e/chat-prompt.test.mjs` | unchanged |
| 112 | `tmct import --file` | implemented | `e2e/import-file.test.mjs` | unchanged |
| 113 | `--memory-backend` + `tmct.toml [memory]` | implemented | `test/tools/cli-args.test.mjs`, `test/adapters/chat-memory-backend.test.mjs` | unchanged |
| 114 | `extract:facts` / `tmct extract` over a document | implemented | `test/adapters/extract-facts-from-text.test.mjs`; `tmct extract` verb at `bin/tmct.mjs` (`311167a`) | **MOVED (up)**: `partial` → `implemented`. `extract-facts` promoted to a first-class `tmct extract` verb. Caveat: still no real-binary e2e, only the in-process adapter test |
| 115 | WordNet → ConceptNet-shape conversion | implemented | `test/adapters/corpus-wordnet.test.mjs` | unchanged |
| 116 | Open English Namenet top-up bundle | implemented | `test/adapters/corpus-namenet.test.mjs` | unchanged |
| 117 | `init:xl` / `init:xxl` scale presets | implemented | `e2e/init.test.mjs` (±10% bundle totals) | unchanged |
| 118 | Seed-side O(n) index + per-turn `factRows` memoisation | implemented | `test/adapters/memory-seed-perf.test.mjs`, `chat-factrows-cache.test.mjs` | unchanged |
| 119 | Defeasible negation — a negative is a source disagreeing | implemented | rows `inference.capability.base-rate`, `.negative-teach` | unchanged |
| 120 | Persisted justification + retraction cascade, 5 rule families | implemented | `test/adapters/syllogise.test.mjs`; rows `inference.retraction.subclass`, `.svf1.*` | unchanged |
| 121 | Taught-fact retraction wired to chat | implemented | rows `inference.retraction.subclass`, `.honest-miss` | unchanged |
| 122 | Multi-valued has/can facts no longer read as contradictions | implemented | `test/adapters/memory-contradictions-cardinality.test.mjs`; `inference.hasa.*` (11) | unchanged |
| 123 | Verified paraphrase (closure-backed) | partial | unit ring only; already chat-wired; no corpus row on the user surface | unchanged |
| 124 | Entity comparison ("how is X different from Y") | partial | unit ring only: `test/adapters/compare.test.mjs` | unchanged; no corpus row |
| 125 | Comparative frame (teach and ask "X is bigger than Y") | implemented | rows `grammar.teach.comparative-contraction`, `inference.comparative.yesno` | unchanged |
| 126 | Dynamic memory-class list/count | **implemented** | rows `template.count.restricted`, `template.recall.count`; `5f1c84f` | **MOVED (up)**: `partial` → `implemented`. The live wrong answer (`how many facts about horses` → unrestricted total) is fixed; a restricted count no longer returns the total, now pinned. Confirmed `BENCHMARK_CONVERSATION_2.5.0.md` (`3 facts. (about "horses")`) |
| 127 | Plural anaphora ("those"/"them") | implemented | `grammar.anaphora.*` (16) | unchanged |
| 128 | Deterministic answer-phrasing variety across 8 hit templates | implemented | `template.conversational` (18) | unchanged |
| 129 | Canonical query/fact representation echoed on ask and teach | implemented | canonical assertions across lanes | unchanged; still the product's best self-diagnostic — the `Canonical:` line reading `reverse` is how CEFR confirmed the passive fix |
| 130 | Tool catalog + README tool section generated from `TOOL_DEFINITIONS` | implemented | `test/estate/tool-docs.test.mjs` | unchanged |
| 131 | Browser ask bundle + committed-artifact drift guard | implemented | `test/estate/generated-artifacts.test.mjs` | unchanged; bundle rebuilt this cycle for the passive/qualifier fixes and PROV/SKOS closure |
| 132 | Pages home: chat-led hero, real transcript, plan render, derived version stamp | implemented | `e2e/pages-home.test.mjs`, `test/estate/page-version-stamp.test.mjs`, `test/pages` (`01f4006` — the demo box answers are the engine's) | unchanged |
| 133 | Licence & PII quality gates | implemented | `test/estate/pii.test.mjs`, `corpus-licences.test.mjs`, `links.test.mjs`, `pack.test.mjs` | unchanged |
| 134 | Set-complement / modal-negation restated in tmct's own grammar | implemented | rows `grammar.negation.set-complement`, `.guard`, `.frame` | unchanged |
| 135 | Seven chat lanes for questions that previously had none | implemented | rows across `grammar`/`inference`/`planning`/`templates` | unchanged |
| 136 | `/narrate` developer trace mode | implemented | rows `template.narrate.toggle`, `.annotated-shapes`, `.unknown-arg` | unchanged |
| 137 | `/why` proof rendering | implemented | row `template.proof.why-isa` | unchanged |
| 138 | `tmct viz --depth/--limit/--focus/--term` | implemented | `e2e/ledger-viz-cli.test.mjs` | unchanged |

### Rows 139-152 — the §3 superset: what the two plans lean on

| # | Capability | Status | Evidence | Wanted by |
|---|---|---|---|---|
| 139 | Utterance → intent label from a fixed vocabulary | absent | no `nlubench/`, no intent-label vocabulary | `PLAN_NLU_BENCHMARKS.md` |
| 140 | Out-of-scope refusal + the miss wall | implemented | rows `games.honest-miss` (6); CEFR tag `honesty-miss` 1.733/2 (n=5, N=1 draw, tier-1 5/5, `BENCHMARK_CEFR_ENGLISH_2.5.0.md`) | `PLAN_NLU_BENCHMARKS.md` |
| 141 | Entity and slot extraction | partial | `resolveObject`; **single-candidate unknown-token residue now declines and names the unknown words** (fixed, `grammar.resolve.unknown-residue`); multi-candidate half still drops it (row 161) | `PLAN_NLU_BENCHMARKS.md` |
| 142 | Token/lemma normalisation through wink-nlp | implemented | row `grammar.normalize` (19); `src/adapters/wink-model.mjs` | `PLAN_NLU_BENCHMARKS.md` |
| 143 | Synonym / hypernym expansion from corpus rows | implemented, on by default | `test/adapters/wiring-facts-memory.test.mjs` (lane 3b) | `PLAN_NLU_BENCHMARKS.md` |
| 144 | IDF-weighted ranking (`retrieveBlocks`) | implemented, on by default | `src/adapters/memory/blocks.mjs`; `provenance.test.mjs` (d) | `PLAN_NLU_BENCHMARKS.md` |
| 145 | Cross-domain false accept — the lane that fires when it should not | **partial** | the 2.0.3 six-member input-discard family is **closed at the top** (rows 71, 110, 126, 141 fixed); the risk moved to routing misfires — `blast radius`→teach, `impact`→`import`, board reads→code frame (rows 158-161, `BENCHMARK_CONVERSATION_2.5.0.md`) | `PLAN_NLU_BENCHMARKS.md` |
| 146 | Short-utterance handling + the conversational catch-all | implemented | CEFR tag `conversational` 2.000/2 (n=6); rows `template.conversational` (18) | `PLAN_NLU_BENCHMARKS.md` |
| 147 | Read-only session guarantee during a scored run | implemented | `chatbench/run.mjs` turns-mode drives pure `runTurn()` | `PLAN_NLU_BENCHMARKS.md`. **Caveat, product-side, not bench-side**: `blast radius of X` mutates memory in the interactive session (row 159) |
| 148 | Determinism / byte-identical reruns | implemented | AGENT goal arm byte-identical; INFBENCH `--replay` byte-identical; `cases.jsonl` regenerates byte-identical (`BENCHMARK_{AGENT,INFERENCE}_2.5.0.md`) | both plans |
| 149 | OWL property reasoning + Horn-rule teaching | implemented | rows `inference.relation` (30), `inference.teach-lane` (13) | `PLAN_NLU_BENCHMARKS.md` |
| 150 | Proof rendering + planner consumption of taught records | implemented | row `template.proof.why-isa`; `planning.route.taught-action` | both plans. **Caveat**: the multi-hop subclass proof does not validate against stored disjointness (row 158) |
| 151 | Consistency checking as a service (`tmct check` / an MCP tool) | absent (as a service); **detection now measured live at the chat layer** | no `tmct check` / `consistencyCheck` service; but INF-C2 20/20 `inconsistent` observed (`BENCHMARK_INFERENCE_2.5.0.md`) | `PLAN_CONSISTENCY_CHECK.md` |
| 152 | Explicit-teaching surface a scrape pipeline would feed | partial | `tmct import --file` (row 112) and `tmct extract` (row 114) both exist; no scrape pipeline calls either | `PLAN_AGENTS.md` Phase 4 |

### Rows 153-162 — new work since `7858087`

Recovered from the 130 commit subjects, the corpus key diff, and new verbs/exports/ontology terms.
Every row is new work at 2.5.0, not a prior miss.

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 153 | Universal quantifier over a module set (`is every X a Y`, answers no + names counterexamples) | implemented | 3 rows `grammar.quantifier.universal-over-set` (incl. a guard that it is neither the duplicated ambiguous parse nor the bare total, and grounds its object) | NEW — `39e5e86 feat(ask): universal quantifier over a module set` |
| 154 | PROV Source three-way split (AgentSource/DocumentSource/ActivitySource) + `provSourceClassFor` | implemented | `test/adapters/grammar-ontology.test.mjs` pins the read-side triples and the classifier; total over `trust.mjs` SOURCE_PRIOR (8 values) | NEW — `a92c180` §7.5. Derivable from disk, no migration |
| 155 | SKOS derived-view concept identity (`buildSkosConceptView`) | partial (library projection; no consumer surface) | pinned nine ways against a real in-process store (`a92c180`); `ontology/tmct-core.ttl` skos: block | NEW — §7.6. A pure read-time projection: synonym→altLabel, relatedTo/similarTo→skos:related, antonym unmapped. **"A consumer surface is the remaining step"** — no user-facing caller yet |
| 156 | Existential-premise refusal (∃ not stored as ∀) | implemented | row `inference.teach-guard.existential`; INFBENCH `b1Existential` 40 chat + 10 kernel, all refuse the existential and prove the universal control (`BENCHMARK_INFERENCE_2.5.0.md`) | NEW — `cd3943f fix(chat): refuse an existential rather than store it as a universal`. Closes 2.0.3's "distinguish ∃ from ∀" TO-BE |
| 157 | Multi-sentence teach line split into per-sentence facts | implemented | row `planning.teach.multi-sentence-line`; `test/services/sentence-path-splitting.test.mjs`; `BENCHMARK_CONVERSATION_2.5.0.md` (two-line Hanoi board now solves in 7 legal moves) | NEW — `936c7d9`. Closes 2.0.3's worst-class illegal "3 moves (shortest)" defect |
| 158 | Multi-hop subclass proof validated against stored `owl:disjointWith` | **partial / named soundness gap** | `BENCHMARK_CONVERSATION_2.5.0.md` item 1: `rex is a dog`/`every dog is a cat`/`no dog is a cat`/`is rex a cat` → "yes, with a proof". The **direct** disjointness query is correct (`inference.isa.negation`) | NEW gap. The subclass prover walks the chain and emits a proof without querying `owl:disjointWith` on the resolved chain; the negative direct-ask path already checks it. The consistency-surfacing capability exists (rows 22, 151) and is simply not wired into this path |
| 159 | Read-only impact phrasings do not mutate memory | **partial / named gap (mutates state)** | `BENCHMARK_CONVERSATION_2.5.0.md` item 2: `blast radius of src/core/store.mjs` is parsed as a teach and written to the graph, reporting success | NEW gap. A read-only question mutates memory; the teach classifier swallows `blast radius of <path>`. No corpus row pins it yet |
| 160 | First-person desire vocabulary openers route to describe, not teach | **partial / named gap (Tier-0 misroute)** | `BENCHMARK_CONVERSATION_2.5.0.md` item 8: `i wanna know about a horse` (+ family) misroutes to the teach frame with a pronoun lecture and a wrong inferred goal | NEW gap. Holds the conversation ladder at Tier 0. The pre-parse stripper does not peel the first-person desire frame before the teach detector runs |
| 161 | Multi-candidate stale-modifier residue guard | **partial / named gap** | `BENCHMARK_CONVERSATION_2.5.0.md` item 11 / Finding A: `what imports the deprecated legacy cache.mjs` enumerates ~5 real modules under an ambiguity disclosure, none named "cache" | NEW gap (soft — disclosed, not silent). The single-candidate half is fixed (row 141); the multi-candidate fuzzy tier answers all readings and never names the stale modifier |
| 162 | `test:smoke` / `test:fast` tiers + wall-clock budget guard | implemented | `package.json` scripts (`test:smoke`, `test:fast`); `scripts/check-tier-budgets.mjs`; `test/smoke/`, `test/fast/` | NEW — `ecdeb39`. One test per capability family at ~0.6s, 172 fast tests at ~1.8s, held to budget by `check:budgets` |

## What moved since 2.0.3

**Upward — nine:**

- **71 Reversible-passive: `partial` → `implemented`.** The headline fix. `7c05ffd` fixed the
  fronted-agent passive; CEFR `reversible-passive` 1.600 → 2.000, tier-1 8/10 → 10/10. Now pinned by
  4 `grammar.passive.fronted-agent` rows including a guard against the inverse.
- **126 Dynamic memory-class list/count: `partial` → `implemented`.** The 2.0.3 live wrong answer
  (restricted count returning the unrestricted total) is fixed and pinned (`template.count.restricted`).
- **110 Plan render: `partial` → `implemented`.** The board-geometry defect is pinned by a pages test
  that the render draws the puzzle only.
- **114 Fact extraction: `partial` → `implemented`.** Promoted to a first-class `tmct extract` verb.
- **36 Capability envelope: unpinned → estate-guarded.** `generated-artifacts.test.mjs` now catches
  the version-stamp staleness that slipped through three audits.
- **82 Predicate "find" queries:** the `/untested` (7) vs `show me the untested modules` (9) divergence
  is closed — both return 7.
- **67 INFBENCH:** ceiling-graded greens 50 → 30; new existential band refuses the false-premise proof;
  INF-C2 flipped from declared ceiling to live consistency detection (20/20).
- **65 CHATBENCH:** tier-1 107/109 → 108/109 (passive recovery, net of a new frozen-expectation drift).
- **22 Consistency checking:** the chat-surface half is now measured live (INF-C2), though still
  un-wired into the multi-hop proof path.

**New capabilities pinned (153-157, 162):** universal-quantifier-over-set, PROV Source split, SKOS
derived-view (partial), existential refusal, multi-sentence teach split, and the smoke/fast test tiers.

**New named gaps found this cycle (158-161):** the disjointness-ignoring subclass proof (worst,
proof-shaped), `blast radius`→teach state mutation, the `i wanna know about X` Tier-0 teach-misroute,
and the multi-candidate stale-modifier residue. All are `partial` with the honest status and the
CONVERSATION report as evidence.

**Downward — none.** No 2.0.3 `implemented` row regressed to `partial` or `absent` this cycle. The
2.0.3 downward moves (71, 94, 90) either recovered (71) or held (94 partial, 90 retired).

**Could not verify as claimed — none contradicted.** Every 2.0.3 row's status re-checks true against
its stable evidence identifier at this pin. The line-number rot 2.0.3 documented persists in that
document; this audit cites stable keys/test-names instead and did not re-pin dead line refs (out of
scope — document-only, no code owned). One 2.0.3 `claimed-only` row unchanged because still unpinned:
75 (cochange phrasing), 73/74 (named gaps). These remain `claimed-only`, not upgraded.

## 4.1 Comparative agent-capability table + term mapping

tmct is a narrow, deterministic, zero-cost system. It cannot fabricate, because it has nothing to
fabricate with: every answer traverses a stored graph, and where the graph is silent it says so. The
shape below is the point, not any single cell. Model-column verdicts are **informed estimates from
public capability tiers, not a measured cross-benchmark result** — no run in this repo scores Sonnet
or Llama. Columns are named, specific models, never an umbrella brand or a hosting surface.

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
| **tool use** | 56/56 cases, 100%/100%, 0% hallucination on every rung A0→C2 (`BENCHMARK_AGENT_2.5.0.md`, goal driver). 22 declared tools, 3 dispatched hot. | **Comparable.** Broader vocabulary; no 0%-fabrication guarantee. | **Weaker.** Malformed calls routine. |
| **planning** | Same 56/56 with a proof. Hanoi to the 2³−1 optimum, river to the classic 7. The 2.0.3 two-line-board illegal plan is **fixed** — it now solves in 7 legal moves (`BENCHMARK_CONVERSATION_2.5.0.md`). Residual: an under-specified board plans over assumed positions without a flag (soft, `BENCHMARK_CONVERSATION_2.5.0.md` item 28). | **Comparable-to-stronger.** Plans over open domains tmct cannot represent; weaker on optimality guarantees. | **Weaker.** No reliable decomposition. |
| **reasoning (formal)** | 259/259 chat, 90/90 kernel, 0% fabrication, all six bands (`BENCHMARK_INFERENCE_2.5.0.md`). The existential probe lands and is refused; INF-C2 detects inconsistency live. Read with its ceiling: 30 of 259 greens are honest declines. **One soundness gap**: a multi-hop subclass proof does not consult stored disjointness (`BENCHMARK_CONVERSATION_2.5.0.md` item 1). | **Comparable.** Handles the same syllogisms and more, without the closed vocabulary — but not soundly: no proof, will assert an unentailed conclusion. | **Weaker.** Fails multi-hop chains. |
| **reasoning (open-world)** | Absent by construction. Off-vocabulary requests land on the honest miss wall (`games.honest-miss`). | **Stronger.** The axis a language model is for. | **Stronger.** |
| **grounding** | groundedness 1.847/2 over 98 scored cases (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`, N=1). Every answer carries a source; an empty graph says it is empty (`bootstrap-empty` 2.000/2). | **Comparable.** No per-fact provenance by construction. | **Weaker.** Confabulates sources. |
| **memory** | An OWL-labelled graph on disk with per-fact provenance, trust, contradiction detection and retraction cascade (rows 22-27, 119-122, 154). PROV Source now splits three ways for correct attribution. Snapshots Backend-A only. | **Comparable-to-stronger** in practice; no durable, inspectable, retractable store. | **Weaker.** Context only. |
| **instruction-following** | Not a capability tmct has. It follows a grammar. | **Stronger.** | **Stronger.** |
| **generation** | rephrase 1.833/2 over 30 scored cases (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`). Deterministic templates, 8 phrasing variants. | **Stronger**, by a distance. | **Stronger.** |
| **coding** | Absent. tmct reads graphs; seonix indexes code and calls tmct (`README.md`). | **Stronger.** | **Stronger.** |
| **safety / honesty** | **The axis tmct wins.** honesty 1.883/2 (n=60); `conversational`, `bootstrap-empty` 2.000/2 (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`). 0% hallucination across 168 agent rows, 0% fabrication across 259 inference rows. An adversarial sceptic could not force a role or polarity inversion in **78** probes (`BENCHMARK_CONVERSATION_2.5.0.md`). The 11 new confident-wrong are misroutes, not fabrications; the one proof-shaped one (item 1) is the exception that matters most. | **Weaker** — it *can* fabricate and tmct cannot; refusal is trained, not structural. | **Weaker.** |
| **autonomy** | None, deliberately. The only LLM in this repo is the offline judge. | **Stronger.** | **Stronger.** |
| **breadth** | 664 default seeded facts, 12,001 at `human-large`; a closed relation vocabulary. | **Stronger**, by orders of magnitude. | **Stronger.** |
| **cost / determinism** | **$0 per turn, byte-identical on rerun** — verified this cycle on the AGENT goal arm, INFBENCH `--replay`, and `cases.jsonl` regeneration (`BENCHMARK_{AGENT,INFERENCE}_2.5.0.md`). | **Weaker.** Priced per token; not byte-identical across model versions. | **Weaker**, though cheap. |

**The honest summary**: tmct's cells are narrow and its numbers high inside that narrowness. The one
row where it beats both models is safety/honesty, and the 11 confident-wrong answers this cycle are
attacks on exactly that row — but ten are misroutes to capabilities it already has, and the eleventh
is the one unsound proof, which is why it ranks first for repair.

### Term mapping — the 2026-normative vocabulary, refreshed for PROV and SKOS

The fresh ontology work (`a92c180`, §7.5/§7.6) changed how two term families map onto external
standards. Both are **read-side derivations**, stored nowhere and requiring no migration.

| tmct term | 2026-normative referent | What changed at 2.5.0 |
|---|---|---|
| `tmct:Source` | not itself a single `prov:` class (its `mgx:sourceType` spans all three PROV top classes) | **split, §7.5**: three read-side subclasses now carry the PROV parent — `tmct:AgentSource ⊑ prov:Agent`, `tmct:DocumentSource ⊑ prov:Entity`, `tmct:ActivitySource ⊑ prov:Activity`. `provSourceClassFor` classifies a `sourceType`, total over the 8 `SOURCE_PRIOR` kinds |
| `mgx:statedBy` (AgentSource object) | `prov:wasAttributedTo` | now lands on `wasAttributedTo` only when the object is an AgentSource, avoiding the over-claim on document/activity sources; keeps a property-level `seeAlso` otherwise |
| `mgx:derivedFrom` | `prov:wasInfluencedBy` (umbrella over attribution + derivation) | verified 2026-07-17 against PROV-O; unchanged referent, comment corrected |
| `mgx:canonicalisedFrom` | `prov:wasDerivedFrom` (both ends `prov:Entity`) | unchanged; distinguished from `wasRevisionOf` which asserts replacement |
| `mgx:synonym` | `skos:altLabel` on one `skos:Concept` | **new projection, §7.6**: `buildSkosConceptView` folds synonyms into one concept's altLabels (SKOS models synonymy as labels, not a relation) |
| `mgx:relatedTo` / `mgx:similarTo` | `skos:related` between minted concepts | new projection; concepts minted at read time, one per normalised term |
| `mgx:antonym` | (no SKOS referent) | left unmapped — SKOS has no opposition relation; recorded as a horizon, not forced onto a wrong term |
| entailed-Source `mgx:derivedFrom` premise list | an **ATMS** justification in de Kleer's sense (antecedents + consequent + rule-id informant), **not** a JTMS justification | clarified in `tmct-core.ttl`: the property has no outlist, so every justification is a monotonic Horn deduction; what de Kleer calls a label, tmct does not compute (`c2d72ce`) |

### Speculative TO-BE

Drawn from the four fresh reports' decision lines and `NEXT.md`. **Not a roadmap commitment**;
each checked against the tree as not-yet-shipped.

- **Wire disjointness into the multi-hop subclass proof** (row 158) — `BENCHMARK_CONVERSATION_2.5.0.md`'s
  worst find and its named next step. The consistency capability exists (INF-C2, the direct-ask path);
  it is not consulted on the resolved chain.
- **Stop `blast radius of X` mutating memory** (row 159) — a read-only question that writes.
- **Peel the first-person desire frame** (row 160) — what holds the conversation ladder at Tier 0.
- **A consumer surface for the SKOS derived-view** (row 155) — the projection ships; nothing calls it.
- **Chat-layer multi-hop proof-chain materialization** (`b2ChainLenK`) — the last 30 INFBENCH ceiling
  greens flip once it exists (`BENCHMARK_INFERENCE_2.5.0.md`).
- **Reconcile `be-honest-empty`'s frozen expectation** with the reworded bootstrap message
  (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`) — the only new tier-1 pass→fail, an honest miss the judge scores 2/2.
- **Grow CHATBENCH/CEFR to the 14 untested shapes** — the instrument is blind to 61% of the construction
  space, which is where the next silent inverse lands.
- **Pin the four new routing gaps (158-161) with corpus rows** — all four are unpinned surfaces, exactly
  the condition under which the fronted-agent passive drifted silently for a whole release line.

## 4.2 Per-benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md`
- Ladder A0→C2 across three drivers, 56 cases, 0% hallucination on every rung — **complete** (`BENCHMARK_AGENT_2.5.0.md`)
- Goal driver clears C2, nothing held back; determinism byte-identical — **complete** (`BENCHMARK_AGENT_2.5.0.md`)
- The resolver floor's `ab-c2-what-to-test` at 27%, stable across two cycles; decide whether it becomes a declared refusal — **todo**
- A case set that still discriminates at C2 (all 11 green) — **todo**

### `SKILL_BENCHMARK_CEFR_ENGLISH.md`
- Judge pinned, `voidCount` 0; mean 1.817/2, tier-1 108/109 — **complete** (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`)
- The fronted-agent passive fix re-measured: `reversible-passive` 1.600 → 2.000 — **complete** (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`)
- Reconcile `be-honest-empty`'s frozen `answerMatch` with the reworded bootstrap message — **todo**
- Coverage of the 14 untested construction shapes; judge sampling at N≥2 — **todo**

### `SKILL_BENCHMARK_CONVERSATION.md`
- Persona sweep, 6 frames (incl. the new returning-user frame), ~410 probes — **complete** (`BENCHMARK_CONVERSATION_2.5.0.md`)
- Every 2.0.3 headline defect re-run and confirmed fixed — **complete** (`BENCHMARK_CONVERSATION_2.5.0.md`)
- 11 new confident-wrong routed to NEXT, worst first the disjointness-ignoring proof — **todo**
- Ratcheting the ladder past Tier 0 (blocked by the teach-misroute family) — **todo**

### `SKILL_BENCHMARK_INFERENCE.md`
- Six-band ladder, both arms, 259/259 chat and 90/90 kernel at 0% fabrication — **complete** (`BENCHMARK_INFERENCE_2.5.0.md`)
- The existential probe (`b1Existential`) lands and is refused; INF-C2 grades live consistency — **complete** (`BENCHMARK_INFERENCE_2.5.0.md`)
- `cases.jsonl` byte-identical on regen and estate-guarded — **complete** (`BENCHMARK_INFERENCE_2.5.0.md`)
- The last 30 declared-ceiling greens (`b2ChainLenK`) — chat-layer multi-hop proof materialization — **todo**
- A band deeper than INF-C2 — **todo**

## 4.3 Per-plan feature-support (Done / Doing / Todo)

Re-checked against the tree at this pin. Plans unchanged since the 2.0.3 audit keep their verdict;
the buckets below record only what moved or is new. `PLAN_PURGE.md` is executed (`e771348`).

- **`PLAN_OPEN_ITEMS.md`** (NEW since 2.0.3) — Phases 1-7 and 10 **Done** (the six dropped-input fixes,
  the §7 vocabulary/fact-id tail, PROV/SKOS). Its phase-table backlog is fully closed per `NEXT.md`.
  **Todo**: only the 2.5.0 routed backlog (rows 158-161) and the CEFR/CHATBENCH re-measurement items.
- **`PLAN_NORMATIVE.md`** (NEW, Phase 10) — **Done**: §7.5 PROV split and §7.6 SKOS view shipped
  (`a92c180`), pinned by `grammar-ontology.test.mjs`; the fact-id widened to a 64-bit SHA-256 truncation
  (`88842f3`); three SEON terms that named nothing realigned (`37a71cd`). **Todo**: a consumer surface
  for the SKOS view (row 155).
- **`PLAN_DEPS.md`** (NEW) — **Done**: batches 1-2, 4-7 landed; the maintainer dependency tier dropped
  from the ship (`f5d68ed`); dumps read with `yaml`. Internal-library consolidation. **Todo**: its own
  Q-items as recorded in the plan.
- **`PLAN_EMBEDDINGS.md`** (NEW) — **absent / design only**, its banner exactly true: "design only,
  nothing built. Not started, and not next." Every similarity mechanism in `src/` is still a closed
  table. A research horizon, named; until a tier is designed these land on the honest miss wall.
- **`PLAN_CLASS_QUERY.md`** — its Finding 2 (the restricted-count wrong answer) is **now fixed** (row
  126); the 2.0.3 "smallest diff in the audit" is closed. Remaining phases open.
- **`PLAN_CONSISTENCY_CHECK.md`** — still **Todo** as a service (`tmct check` absent), but INF-C2's 20
  cases now grade a live detection rather than a ceiling; the direct-ask and negation paths already
  surface the clash. The un-wired case is the multi-hop proof path (row 158).
- **`PLAN_SYLLOGIST.md`, `PLAN_SYLLOGIST_EL_DL.md`, `PLAN_ADVENTURE.md`, `PLAN_GUESS_NUMBER.md`,
  `PLAN_MUD.md`, `PLAN_REPO_INDEX.md`, `PLAN_CODE.md`, `PLAN_PARAPHRASE_VERIFICATION.md`,
  `PLAN_CHILD_CORPUS.md`, `PLAN_AGENTS.md`, `PLAN_NLU_BENCHMARKS.md`, `PLAN_GRAPH_SCAN.md`** — verdicts
  as `CAPABILITIES_2.0.3.md` §4.3, re-checked and unchanged at this pin. `PLAN_GRAPH_SCAN.md`'s banner
  is still false (all three phases shipped). No plan's scope contradicts the tree beyond what 2.0.3
  already recorded.
- **Archived, no open scope** — `archive/PLAN_DEFEASIBLE_NEGATION.md` (DELIVERED, unchanged).

## 4.4 Non-benchmarked capabilities

Real, shipped work no benchmark scalar reaches.

- **The PROV Source split and SKOS derived-view** (rows 154-155). No benchmark scores an ontology
  projection. Their evidence is the adapter suite: `provSourceClassFor` pinned total over the 8 source
  kinds, `buildSkosConceptView` pinned nine ways. The SKOS view ships as a projection with no caller —
  the one capability here that is real code, tested, and unreachable by any user surface.
- **The `tmct extract` verb** (row 114). A CLI verb no benchmark drives; the adapter test is its only
  pin, and there is still no real-binary e2e.
- **The smoke/fast test tiers** (row 162). A test-estate change no product benchmark can see; its
  evidence is the budget guard, and its value is the ~0.6s reflex it puts in every edit loop.
- **The fact-id widening to a 64-bit SHA-256 truncation** (`88842f3`). A storage-vocabulary change
  earning content-addressing; no benchmark scalar touches the id width.
- **Determinism and cost.** $0 per turn, byte-identical on rerun — verified three ways this cycle.
- **The `Canonical:` line** (row 129). Still the product's best self-diagnostic: reading `reverse`
  where 2.0.3 read `forward` is how CEFR confirmed the passive fix this cycle.

## 6. Summary — real counts, grepped

Counts obtained by grepping the status column of the table above.

**161 rows** (151 carried forward from `CAPABILITIES_2.0.3.md`, 10 new work / new gaps at #153-162;
the sequence has no #63 and merges 21/24, matching the historical table):

| Status | Rows |
|---|--:|
| `implemented` | **123** |
| `partial` | 15 |
| `claimed-only` | 17 |
| `absent` | 3 |
| `reverted` | 1 |
| retired / process change | 2 |

`implemented` rose 114 → **123** (+9): four status flips up (71, 110, 114, 126) plus five new
implemented rows (153, 154, 156, 157, 162). `partial` rose 14 → **15** (+1 net): the four flips out
were replaced by five new partials — the SKOS view (155, library-only) and the four named routing
gaps (158-161). `claimed-only` (17), `absent` (3), `reverted` (1) are unchanged from 2.0.3. **No row
moved downward from `implemented`.**

### What flipped since `CAPABILITIES_2.0.3.md`

**Upward — nine** (71, 82, 110, 114, 126 status flips; 36, 65, 67, 22 quality/pinning flips), listed
with evidence in *What moved since 2.0.3* above.

**Downward — none.** The honesty machinery and every `implemented` capability held.

### The three findings this audit would lead with

1. **The input pipeline is now honest end to end; the risk moved to routing and one un-wired proof
   check.** All eight 2.0.3 input-discard defects are fixed and pinned. The 11 new confident-wrong are
   misroutes to existing capabilities — except item 1, a multi-hop subclass proof that emits a proof
   without consulting the `owl:disjointWith` fact the store holds and the direct-ask path already
   checks. A proof is tmct's strongest honesty claim; this is the one gap that matters most, and the
   contradiction-surfacing capability already exists (INF-C2) and is simply not wired into this path.
2. **Everything green is still only as good as what pins it — and the four new gaps are unpinned.**
   Rows 158-161 rest on the CONVERSATION report alone; no corpus row drives any of them. That is the
   exact condition under which the fronted-agent passive drifted silently for a whole release line
   before 2.0.3 caught it. The SKOS view (155) ships tested but unreachable. `--gaps` still names
   thin keys and key groups with no negative row.
3. **The estate closed two long-standing blind spots.** `cases.jsonl` and the agentbench envelope are
   now estate-guarded (rows 36, 67), so the version-stamp staleness that persisted for three audits
   and the silent case-redraw are both caught on drift. The instrument is measurably harder to fool
   than it was — and the passive fix it caught, then confirmed fixed, is the proof.

`npm test`: the CEFR 2.5.0 run's foreground smoke gate read **2794 pass / 0 fail**
(`BENCHMARK_CEFR_ENGLISH_2.5.0.md`); docs-only commits followed. This audit is document-only and did
not re-run the suite — the coordinator should cite the live release-run count. CLI smoke:
`printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 (recorded in the same report).
