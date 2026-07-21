# CAPABILITIES_2.6.0.md — tmct capability audit (refresh 9, re-audit over `CAPABILITIES_2.5.0.md`)

Pinned at `5376248`, `package.json` 2.6.0, 2026-07-18. This is a re-audit: every `CAPABILITIES_2.5.0.md`
row carries forward with its status re-checked against the evidence order in
`SKILL_CAPABILITIES_AUDIT.md` §1, and every status that moved is called out with its evidence.

**Audit window (analysis, not a benchmark run):** 2026-07-18. No harness was re-run. This audit reads
the two fresh 2.6.0 `BENCHMARK_*.md` reports, the two 2.5.0 reports whose 2.6.0 refresh is in flight,
the corpus estate, the tool layer and the code at this pin.

**Method for carried-forward rows.** Statuses are re-checked against stable evidence identifiers (a
corpus row `key`, a test file name, a tool-layer contract test), which do not rot. Every row this
round's work is said to have moved was re-verified from the tree and its tests, with targeted runs
teed to `/tmp/b5-*.log`. Unchanged rows restate the status with the stable citation and move on,
per §8.

## Per-benchmark provenance — where every figure came from

| Benchmark | Latest report | Figure comes from |
| --- | --- | --- |
| AGENT | `BENCHMARK_AGENT_2.6.0.md` | **2.6.0, current** |
| CEFR_ENGLISH | `BENCHMARK_CEFR_ENGLISH_2.5.0.md` | 2.5.0, **carried forward** — the 2.6.0 run is in flight this round |
| CONVERSATION | `BENCHMARK_CONVERSATION_2.5.0.md` | 2.5.0, **carried forward** — the 2.6.0 sweep is in flight this round |
| INFERENCE | `BENCHMARK_INFERENCE_2.6.0.md` | **2.6.0, current** |

`max(2.6.0, 2.5.0, 2.5.0, 2.6.0)` is 2.6.0, so this audit is `CAPABILITIES_2.6.0.md`. Two axes were
re-measured at 2.6.0 before this was written. The CEFR and CONVERSATION figures below are 2.5.0
measurements of a tree that has since changed, and every such figure names its version where it
appears. When the two in-flight reports land, their findings belong to the next audit.

Caveats that travel with the two fresh figures:

- **AGENT 2.6.0 measures a reformed ladder.** The rungs are now TOOL-0…TOOL-8 (bijective alias over
  the old A0…C2 range). On the 2.5.0-comparable scope the goal driver reads 60/60 where 2.5.0 read
  56/56 and no capability moved on any arm. The two new rungs (TOOL-7 recovery, TOOL-8 composition
  under ambiguity) are measured for the first time, and the ladder gates at TOOL-7. The resolver
  floor's 27% → 36% at TOOL-6 is a `floorExpect` reclassification of one refusal, not capability.
- **INFERENCE 2.6.0 measures a reformed ladder too.** Bands are INF-1…INF-8 (bijection A1→1 … C2→6).
  379/379 chat, 100/100 kernel, 0 fabrication. 61 of the 379 greens are declared-ceiling floors
  (30 `b2ChainLenK`, 5 `grandparent` property-inheritance, 26 EL/DL horizon rows). The 8
  `dlDisjointProofSoundness` rows authored as ceilings grade **live**: the disjointness veto shipped
  before their first measurement.
- **The CEFR and CONVERSATION figures predate this round's chat-track work** (the opener families,
  the SKOS lane, learn-on-miss, guess-the-number, the dialogue-act stamp). Where a 2.5.0-reported
  defect is claimed fixed at 2.6.0, this audit cites the code-side pin (corpus key or test), never a
  re-measured benchmark number.

## What the two fresh reports change about this audit

The theme of 2.5.0 was: the input pipeline is sound end to end, and the risk sits in routing
recognition plus one un-wired proof check. The theme of 2.6.0 is: **that proof check is wired and
measured live, the routing-recognition backlog is built and corpus-pinned, and the reformed ladders
now measure two rungs of headroom above the engine instead of stopping where it stops.**

- **INFERENCE** closes the 2.5.0 cycle's worst confident-wrong. The is-a ladder computes the cax-dw
  disjointness gate ahead of the direct-fact verdict and both proof chases; `dlDisjointProofSoundness`
  grades 8/8 `inconsistent` on its first measurement, each refusal naming both stored facts. Six new
  templates pin this round's inference work (86 chat rows): the class-level disjointness veto,
  reflexive subsumption, the converse discriminator, universal conditionals, one-hop property
  inheritance, and the ATMS retraction pair (survivor re-grounding, stale-justification fall).
- **AGENT** re-measures everything 2.5.0 measured at 100% on a deeper case set (0% hallucination
  across 264 rows, byte-identical re-run) and names the two new horizons at their floors: no
  replanning branch yet (TOOL-7, 0%) and a silent tier-3 pick on a tied ambiguous entity (TOOL-8,
  the worst live behaviour on the board).
- Both reports flag the same estate item: the **committed ask bundle is behind its generator**. This
  audit re-ran the guard at its own pin and confirms it: `test/estate/generated-artifacts.test.mjs`
  reads 5 pass / 1 fail, the fail being "the committed ask bundle is what its source builds today"
  (log `/tmp/b5-rows1-66-estate.log`). The guard is doing its job; the bundle needs
  `npm run build:ask-bundle` plus a commit at integration (row 131).

## 0. Scope note

This audit covers the three sets `SKILL_CAPABILITIES_AUDIT.md` §3 names: the product capability
catalog, what `PLAN_NLU_BENCHMARKS.md` would measure, and what `PLAN_AGENTS.md` leans on. Rows 1-162
carry forward from `CAPABILITIES_2.5.0.md`; rows 163-173 are new work since its pin (`d133c6c`),
recovered from the 72 commit subjects, the corpus key-group diff (98 → 116 groups), and new
scripts/verbs/lanes/plans.

## 1. Full status table

**Status key:** `implemented` · `partial` · `claimed-only` · `absent` · plus the standing
`reverted` / process labels, unchanged since 2.0.3.

Rows whose status **moved** since 2.5.0 are marked **MOVED** in the change note. Unchanged rows cite
their stable evidence identifier and restate the status.

### Rows 1-33

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline | implemented | rows `grammar.compositional` (51), `grammar.relaxation` (27), `grammar.normalize` (19) | unchanged |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | row `grammar.ace` (8) | unchanged |
| 3 | ACE-OWL parser as a standalone MPL-2.0 package | reverted | `packages/` absent | unchanged |
| 4 | OWL 2/RDF/RDFS + SEON ontology grounding | implemented | `test/adapters/grammar-ontology.test.mjs`; `ontology/tmct-core.ttl` | unchanged; the ttl grew the `dact:` dialogue-act block (row 139) and the `reference` source enumeration (row 163) this round |
| 5 | Template libraries / response phrase book | implemented | `template.*` key families; `test/adapters/corpus-templates.test.mjs` | unchanged |
| 6 | Filtered ConceptNet corpus slice | implemented, opt-in | `test/adapters/extensions-corpus.test.mjs` | unchanged |
| 7 | Conversational memory as an OWL-labelled graph (3 backends) | implemented | `test/adapters/memory-backend-{sqlite,memory}.test.mjs`; `src/adapters/memory/core.mjs` | unchanged |
| 8 | Input normalization pass | partial | row `grammar.normalize` (19) | unchanged |
| 9 | Repository Interface adapter contract | implemented | `test/adapters/repository-interface.test.mjs` drives `runConformance` over 3 providers, 16 services (SERVICES re-counted 16 at this pin) | unchanged |
| 10 | Runnable conformance suite for RI providers | implemented | `test/adapters/repository-interface.test.mjs` (`runConformance`) | unchanged |
| 11 | Library-first design, stable `exports` map | implemented | `test/estate/pack.test.mjs`; 6 `package.json` exports | unchanged; the root entry now also exposes the chat session (`createSession`/`runTurn`), driven by `e2e/lib-chat-sqlite.test.mjs` (row 164) |
| 12 | Ink console TUI shell | implemented | `e2e/tui.test.mjs` | unchanged; now also a surface-matrix arm (`e2e/tui-chat-file.test.mjs`, row 164) |
| 13 | Calculation surfaced as reasoning | implemented | `test/adapters/wiring-templates-via.test.mjs` | unchanged |
| 14 | Optionally running linters/tests to observe | claimed-only | nothing in the estate pins it; no such code in `src/` | unchanged |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | absent (named open spike) | `PLAN_SYLLOGIST.md` §5 | unchanged; a research horizon |
| 16 | Response-finishing grammar pass | partial | `test/adapters/finish.test.mjs` | unchanged |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `test/tools/cli-args.test.mjs`; `bin/tmct.mjs` | unchanged |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `test/adapters/syllogise.test.mjs` — **124/124 at this pin** (`/tmp/b5-rows1-66-syllogise.log`) | extended this round: bounded ATMS environments, set-membership retraction, semi-naive delta evaluation, `expandFocus` (rows 165-167) |
| 19 | `cax-dw` disjointness rule | implemented | `test/adapters/syllogise.test.mjs`; `src/domain/syllogise.mjs` | quality up: now measured at the chat layer in every is-a form — `b1DisjointVeto` 24/24, `dlDisjointProofSoundness` 8/8 live (`BENCHMARK_INFERENCE_2.6.0.md`; row 158) |
| 20 | `cax-sco` type-propagation rule | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 21/24 | Actor-level, session-scoped source trust | implemented | `test/adapters/chat-inference-trust.test.mjs`; `test/adapters/provenance.test.mjs` (c) | unchanged; `SOURCE_PRIOR` grew 8 → 9 kinds — `reference` at 0.6, below teach/provider (row 163) |
| 22 | Consistency checking / cardinality / proof-chain materialization | implemented | `test/adapters/syllogise.test.mjs` (`findConsistencyViolations`, `proveCardinalityAtLeast`); INF-6 20/20 and INF-8 soundness 8/8 live (`BENCHMARK_INFERENCE_2.6.0.md`) | **MOVED (caveat closed)**: 2.5.0's "still un-wired into the multi-hop subclass-proof path" is fixed — the cax-dw gate computes ahead of the direct-fact verdict and both proof chases (`dc360ab`; row 158) |
| 23 | Unified provenance/trust primitive | implemented | `test/adapters/chat-inference-trust.test.mjs`, `provenance.test.mjs` | unchanged |
| 25 | Memory-tree versioning (`snapshotMemory`) | implemented, Backend A only | `src/adapters/memory/core.mjs` (throws on sqlite, re-verified) | unchanged |
| 26 | Deterministic contradiction detection | implemented | `test/adapters/provenance.test.mjs` (d) | unchanged |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/adapters/memory/blocks.mjs`; `provenance.test.mjs` (d) | unchanged |
| 28 | Extension-pack / corpus-lexicon loading seam | implemented | `test/adapters/extensions-corpus.test.mjs` | unchanged |
| 29 | Bias-weighted ambiguity resolution | implemented | `test/adapters/bias-weighting.test.mjs` | unchanged |
| 30 | `tmct init --with-persona`, size-tier flag | implemented | `test/tools/cli-args.test.mjs` | unchanged |
| 31 | Tier-2 general-knowledge bundle (legacy) | implemented, legacy | `test/estate/corpus-schema.test.mjs` | unchanged |
| 32 | A wider general-knowledge seed set | implemented, default | `corpus/tier2/manifest.json` — `human` 664 default, `human-large` 12001 (re-verified) | unchanged |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `test/adapters/corpus-unknown-ingest.test.mjs` (unit ring only) | unchanged — no corpus row drives it |

### Rows 34-66 (no row 63 — the historical table skips it)

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 34 | SHACL-style declarative ingest gate | implemented | `test/adapters/memory-shacl.test.mjs` | unchanged |
| 35 | Cross-repo HTTP smoke test | implemented | `e2e/server-http-smoke.test.mjs` | unchanged |
| 36 | Machine-readable capability envelope | implemented, estate-guarded | `test/estate/generated-artifacts.test.mjs` — the envelope guard is green at this pin | regenerated for the reformed ladder: 66 cases, rungs TOOL-0…TOOL-8, `rungReached` TOOL-6, `gatedAt` TOOL-7 |
| 37 | Ontology tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, ON by default | `test/adapters/wiring-facts-memory.test.mjs` | unchanged; the test now runs hermetic from the reference pack (`a872293`) |
| 38 | Ontology tracks c+d (SEON spine) | implemented, default-off | `test/adapters/grammar-ontology.test.mjs` | unchanged |
| 39 | Subordination/conditional preamble frames | implemented | rows `grammar.normalize.subordination` (1), `.conditional` (2) | unchanged |
| 40 | Construction-grammar template bank | implemented | row `grammar.construction.agent-noun` (2) | unchanged |
| 41 | Chat-taught relations & rules | implemented | `inference.relation` (30), `inference.teach-lane` (13) | unchanged |
| 42 | `findActionPath` (bounded successor BFS), wired to a real domain | implemented | rows `planning.solve.hanoi`, `planning.execute.river` | unchanged |
| 43 | `findReachableSet` | implemented, wired into chat | `src/domain/planning.mjs`; live chat callers | unchanged |
| 44 | Towers-of-Hanoi goal-directed planning loop | implemented | row `planning.solve.hanoi` | unchanged |
| 45 | "I am thinking of a number" closed-loop game | **implemented** | lane `test/corpus/games/guess-number.test.mjs` — 12 rows, **13/13 at this pin** (`/tmp/b5-rows1-66-guessnum.log`): keys `games.guess-number.{guesser,thinker,bounds,contradiction,exclusive,aside}`; deterministic secret via the `TMCT_GAME_SECRET` seam; the browser demo drives the guesser to a win inside the 7-guess bound (`e2e/chat-browser-bundle.test.mjs`) | **MOVED**: `claimed-only` → `implemented`. Closed-loop belief narrowing over hidden state, both seats, on the plan slot (`63aa556`); a hint-offer opening hands tmct the guessing seat (`9c0fb6b`). `PLAN_GUESS_NUMBER.md` is BUILT |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `test/adapters/synth-rules.test.mjs` | unchanged |
| 47 | Program synthesis Tracks 2-4 (sandbox) | claimed-only, sign-off-gated | `PLAN_CODE.md` sign-off gate | unchanged |
| 48 | Completions Stage 0 (broad search + grouping) | implemented | `test/adapters/completions-stage0.test.mjs` | unchanged |
| 49 | Completions Stage 2 (extractive ranking) | implemented | `test/adapters/completions-stage2.test.mjs` | unchanged |
| 50 | Completions wired into a user-facing answer | implemented | `test/adapters/chat-completions-wiring.test.mjs` | unchanged |
| 51 | Capability router — registry + four stages | implemented, corpus-driven | registry `capabilities()` re-counted **15**; 11 `planning.route.*` rows; `test/adapters/router-drive.test.mjs` | unchanged. Note: `tmct_related` is dispatched but neither a registry capability nor an `EXCLUDED_FROM_REGISTRY` entry (`BENCHMARK_AGENT_2.6.0.md` backlog 5; row 155's caveat) |
| 52 | `POST /v1/messages` HTTP shim | implemented | `e2e/server-http.test.mjs` | unchanged; its `selectTool` routing is now also measured as the shim-transport bench arm — 23/66, the transport floor, first time on record (`BENCHMARK_AGENT_2.6.0.md`) |
| 53 | bedrock-meter $0-rung routing | implemented in sibling repo, not here | `PLAN_AGENTS.md`; no such code in `src/`/`bin/` | unchanged |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md` Phase 5 | unchanged |
| 55 | `seon-mcp` provider adapter | claimed-only | `PLAN_AGENTS.md` | unchanged |
| 56 | marginalia "mechanical chat" replaced by tmct | claimed-only | `PLAN_AGENTS.md` | unchanged |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md` Phase 3 | unchanged |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md` Phase 4 | unchanged |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet) | implemented | `test/adapters/repository-interface.test.mjs` | unchanged |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `test/adapters/source-slice.test.mjs` | unchanged |
| 61 | Telemetry wrapper on every RI service | implemented | `test/tools/telemetry.test.mjs` | unchanged |
| 62 | Chronograph-style temporal diffing | claimed-only, research-horizon | no `temporal.mjs` module (re-confirmed) | unchanged |
| 64 | Dialogue-flow playtest ladder | implemented | `games.*` lanes across **7 shards** | grew a shard: `games/guess-number` joined |
| 65 | CHATBENCH graded-pool ladder | implemented | `test/bench/chatbench-graded.test.mjs` | status unchanged; **figures carry forward from 2.5.0** (mean 1.817/2, tier-1 108/109, `BENCHMARK_CEFR_ENGLISH_2.5.0.md`) — the 2.6.0 run is in flight this round |
| 66 | AGENTBENCH agentic ladder | implemented | `test/bench/agentbench.test.mjs` (40/40 after the case append); `BENCHMARK_AGENT_2.6.0.md` | **re-measured on the reformed TOOL-0…TOOL-8 ladder**: goal driver 62/66, 100% through TOOL-6, gated at TOOL-7 (0%, no replanning branch — a named horizon), TOOL-8 67%; 0% hallucination across 264 rows on four arms; byte-identity clean. The resolver floor's 27% → 36% is `floorExpect` reclassification, not capability |

### Rows 67-99

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 67 | INFBENCH classical-logic ladder | implemented | row `bench.infbench`; `test/bench/infbench.test.mjs`; `BENCHMARK_INFERENCE_2.6.0.md` | **MOVED (quality up)**: the reformed INF-1…INF-8 ladder measures — chat 259 → **379/379**, kernel 90 → **100/100**, 0 fabrication; ceiling-graded greens 30 → **61** (30 `b2ChainLenK`, 5 `grandparent`, 26 EL/DL); the `dlDisjointProofSoundness` rung born a ceiling grades live 8/8; `cases.jsonl` estate-guarded and byte-stable on regeneration |
| 68 | Strategy-advisor watch process | implemented (process), dormant | `SKILL_AGENT_STRATEGY_ADVISOR.md` | evidence identifier changed: `STRATEGY_ADVISOR.log` is now gitignored and pruned, so the skill doc is the stable citation |
| 69 | Segmentation IR + concept force | implemented | `test/adapters/concept.test.mjs` (unit ring) | unchanged |
| 70 | Negation as bounded set complement | implemented | row `grammar.negation.set-complement` | unchanged |
| 71 | Reversible-passive traversal | implemented | 4 rows `grammar.passive.fronted-agent`; `BENCHMARK_CEFR_ENGLISH_2.5.0.md` reversible-passive 2.000 | unchanged |
| 72 | Compound-name resolution in `resolveObject` | implemented | row `grammar.compositional.find` | unchanged |
| 73 | Compound matching in `/describe`'s resolver | claimed-only / named gap | `src/domain/codegraph.mjs` `resolveSymbol` — exact/basename/substring tiers only | unchanged; this round's ask/chat fixes did not touch this resolver |
| 74 | Reverse-`inherits` "the"-definite forms | claimed-only / documented decline | `src/domain/ask-vocab.mjs` | unchanged; the comment now names the reason (bare "the" would break the relaxation cascade's noise-strip) |
| 75 | Cochange phrasing variants + "multi-root" over-match | **partial** | phrasings pinned: rows `games.drilldown.history` (cochange phrasings agree with canonical), `games.relation-touch.cochange` (3); the coordination-refusal half in `src/domain/ask.mjs` still has no named test | **MOVED** `claimed-only` → `partial`, with a correction: the phrasing rows predate the 2.5.0 pin — `CAPABILITIES_2.5.0.md`'s "cochange phrasing still unpinned" was stale when written. The multi-root refusal half remains unpinned |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 | unchanged |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md` R1 | unchanged |
| 78 | Winograd-hard commonsense coreference | claimed-only, research-horizon | `PLAN_AGENTS.md` R3 | unchanged |
| 79 | Shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md` R3 | unchanged |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `test/tools/server.test.mjs` | unchanged |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV, provenance) | implemented, no test | `.gitlab-ci.yml`; renovate digest/node pins landed this round (`672d7d4`, `7ecbb3b`) | unchanged — nothing in the estate drives CI config |
| 82 | Predicate "find" queries | implemented | rows `grammar.compositional.find`, `.superlative`; new `grammar.superlative.need-verb-inverts` (2) | strengthened: the superlative need-verb inversion is corpus-pinned (`70bb752`) |
| 83 | Single-sourced `fnv1a` + wink browser-loader seam | implemented | `src/domain/hash.mjs` | unchanged |
| 84 | SQLite memory Backend C | implemented | `test/adapters/memory-backend-sqlite.test.mjs` | unchanged |
| 85 | In-memory Backend B | implemented | `test/adapters/memory-backend-memory.test.mjs` | unchanged |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `e2e/import-file.test.mjs` | unchanged |
| 87 | Default human-world persona + size tiers | implemented | `corpus/tier2/human*.jsonl`, `manifest.json` | unchanged |
| 88 | `graphService` wired into completions | implemented | `test/adapters/chat-completions-graphservice.test.mjs` | unchanged |
| 89 | Public completions exports | implemented | `package.json` exports → `src/services/completions.mjs` | unchanged |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | retired (fixes stand) | skill file still absent | unchanged |
| 91 | Persona-sweep as the conversation bench's default | process change | `SKILL_BENCHMARK_CONVERSATION.md` | unchanged; the 2.6.0 sweep is in flight |
| 92 | Multi-candidate ambiguity resolution | implemented | row `template.ambiguity.multi-reading` | unchanged; `--gaps`: `template.ambiguity` still has no negative row |
| 93 | Memory-graph-aware `spiralExpand` | implemented (library-level, not CLI-wired) | `test/adapters/codegraph.test.mjs` | unchanged |
| 94 | Edge/node provenance timestamps | partial (derived half removed) | `test/adapters/provenance.test.mjs` (a) | unchanged |
| 95 | Reverse fact-cascade query shapes | implemented | rows `inference.reverse-predicate.by-object` + negative guard | unchanged |
| 96 | Forward-shape `entityType` grain-checking | implemented | `test/tools/ask.test.mjs` | unchanged |
| 97 | Possessive-named-instance teach shape | implemented | rows `games.teach-then-infer.possessive` + guard | unchanged |
| 98 | Bare known class/entity name → describe/focus | implemented | key `grammar.bare-entity.camelcase`; lane grew 1 → 3 rows | off the thin-key list; `--gaps` still names no negative key |
| 99 | Capability router invocation surface (`tmct plan`, `/plan`, `./plan`) | implemented | `e2e/plan-cli.test.mjs`; 11 `planning.route.*` rows | unchanged |
| — | `PLAN_ADVENTURE.md` | claimed-only, RESEARCH/DESIGN | plan header | unchanged as a capability; the plan itself is rescoped — two of its four gaps have since shipped generically |

### Rows 100-138

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 100 | Five-layer `src/` architecture, downward-only imports | implemented | `test/estate/import-layers.test.mjs`; allowlist still exactly 1 entry | unchanged |
| 101 | Keyed corpus-lane test estate | implemented | `scripts/corpus-matrix.mjs`; **13 lanes / 897 rows / 428 keys** | grew: 11/837/391 → 13/897/428; new lanes `games/guess-number` and `reference`; key groups 98 → 116 |
| 102 | e2e tier: real binary + real browser | implemented | `e2e/cli-smoke.test.mjs`, `e2e/browser-chat.test.mjs` | grew the 3×3 surface matrix (row 164) |
| 103 | README examples run against the live product | implemented | `test/readme/readme.test.mjs`, `e2e/readme-examples.test.mjs` | unchanged |
| 104 | Plan lane — teach, state a goal, solve, step | implemented | rows `planning.solve.hanoi`, `planning.execute.next`, `planning.goal.verbless` | unchanged; the goal lane grew natural frames (row 170) |
| 105 | Generic action interpreter + action `Rule` family | implemented | rows `planning.legal.one-ply`, `.river-constraints` | unchanged |
| 106 | Taught-action registry seam (`registerCapability`) | partial | row `planning.route.taught-action`; mechanism unit-ring only | unchanged |
| 107 | River-crossing domain | implemented | rows `planning.execute.river`, `.legal.river-constraints` | unchanged |
| 108 | `/capabilities` listing + `tmct plan --tools` | implemented | rows `planning.capabilities.listing` (2), `.readback` (4) | unchanged |
| 109 | `tmct viz` ledger memory explorer + chat dock | implemented | `e2e/ledger-viz-cli.test.mjs`, `e2e/ledger-viz.test.mjs` | unchanged |
| 110 | Animated self-contained plan render + `chat --render/--output` | implemented | `e2e/chat-prompt.test.mjs`; `test/adapters/plan-viz.test.mjs`; `e2e/pages-*.test.mjs` | unchanged; correction — 2.5.0 cited "test/pages", the real files are the `e2e/pages-*.test.mjs` set |
| 111 | `chat --prompt` one-shot turn runner | implemented | `e2e/chat-prompt.test.mjs` | unchanged |
| 112 | `tmct import --file` | implemented | `e2e/import-file.test.mjs` | unchanged |
| 113 | `--memory-backend` + `tmct.toml [memory]` | implemented | `test/tools/cli-args.test.mjs`, `test/adapters/chat-memory-backend.test.mjs` | unchanged |
| 114 | `extract:facts` / `tmct extract` over a document | implemented | `test/adapters/extract-facts-from-text.test.mjs`; verb asserted in the usage banner (`e2e/cli-smoke.test.mjs`) | unchanged; caveat stands — no real-binary e2e drives the verb itself |
| 115 | WordNet → ConceptNet-shape conversion | implemented | `test/adapters/corpus-wordnet.test.mjs` | unchanged |
| 116 | Open English Namenet top-up bundle | implemented | `test/adapters/corpus-namenet.test.mjs` | unchanged |
| 117 | `init:xl` / `init:xxl` scale presets | implemented | `e2e/init.test.mjs` | unchanged |
| 118 | Seed-side O(n) index + per-turn `factRows` memoisation | implemented | `test/adapters/memory-seed-perf.test.mjs`, `chat-factrows-cache.test.mjs` | unchanged |
| 119 | Defeasible negation | implemented | rows `inference.capability.base-rate`, `.negative-teach` | unchanged |
| 120 | Persisted justification + retraction cascade, 5 rule families | implemented | `test/adapters/syllogise.test.mjs`; rows `inference.retraction.subclass`, `.svf1.*` | unchanged; extended by the ATMS environment work (row 165) |
| 121 | Taught-fact retraction wired to chat | implemented | rows `inference.retraction.subclass`, `.honest-miss` | unchanged |
| 122 | Multi-valued has/can facts not read as contradictions | implemented | `test/adapters/memory-contradictions-cardinality.test.mjs`; `inference.hasa.*` | unchanged |
| 123 | Verified paraphrase (closure-backed) | partial | unit ring only; no corpus row on the user surface | unchanged |
| 124 | Entity comparison ("how is X different from Y") | partial | unit ring only: `test/adapters/compare.test.mjs` | unchanged |
| 125 | Comparative frame | implemented | rows `grammar.teach.comparative-contraction`, `inference.comparative.yesno` | unchanged |
| 126 | Dynamic memory-class list/count | implemented | rows `template.count.restricted`, `template.recall.count` | unchanged |
| 127 | Plural anaphora | implemented | `grammar.anaphora.*` (16) | unchanged |
| 128 | Deterministic answer-phrasing variety | implemented | `template.conversational` (18) | unchanged |
| 129 | Canonical query/fact representation echoed on ask and teach | implemented | canonical assertions across lanes | unchanged; still the product's best self-diagnostic |
| 130 | Tool catalog + README tool section generated from `TOOL_DEFINITIONS` | implemented | `test/estate/tool-docs.test.mjs` | `TOOL_DEFINITIONS` grew 22 → **23** (`tmct_related`, cold tier); hot tier still 3 |
| 131 | Browser ask bundle + committed-artifact drift guard | implemented; **guard red at this pin** | `test/estate/generated-artifacts.test.mjs` — 5 pass / 1 fail: "the committed ask bundle is what its source builds today" | the committed `memory-ask-browser.bundle.js` is behind its generator, flagged by both 2.6.0 reports and confirmed by this audit's own run. Drift caught, which is the guard's job; needs `npm run build:ask-bundle` + commit at integration |
| 132 | Pages home: chat-led hero, real transcript, plan render, derived version stamp | implemented | `e2e/pages-home.test.mjs`, `test/estate/page-version-stamp.test.mjs` — 2/2 green after the embedded-chat rewrite | the page now carries the live embedded chat and demo rail (`4b3cd7e`; row 164) |
| 133 | Licence & PII quality gates | implemented | `test/estate/pii.test.mjs`, `corpus-licences.test.mjs`, `links.test.mjs`, `pack.test.mjs` | unchanged |
| 134 | Set-complement / modal-negation restated in tmct's own grammar | implemented | rows `grammar.negation.set-complement`, `.guard`, `.frame` | unchanged |
| 135 | Seven chat lanes for questions that previously had none | implemented | rows across `grammar`/`inference`/`planning`/`templates` | unchanged |
| 136 | `/narrate` developer trace mode | implemented | rows `template.narrate.toggle`, `.annotated-shapes`, `.unknown-arg` | unchanged; now also carries the dialogue-act line (row 139) |
| 137 | `/why` proof rendering | implemented | row `template.proof.why-isa` | unchanged |
| 138 | `tmct viz --depth/--limit/--focus/--term` | implemented | `e2e/ledger-viz-cli.test.mjs` | unchanged |

### Rows 139-152 — the §3 superset: what the two plans lean on

| # | Capability | Status | Evidence | Wanted by |
|---|---|---|---|---|
| 139 | Utterance → intent label from a fixed vocabulary | **implemented** | `test/adapters/chat-dialogue-act-labels.test.mjs` (7 cases through live `runTurn`: `record.dialogueAct` envelope field; the `/narrate` trace line; a miss labels `autoNegative`, never a task act); `test/adapters/dialogue-acts.test.mjs` (closed, frozen vocabulary); `grammar-ontology.test.mjs` pins the vocabulary and the `dact:` ontology block as one closed set, two ways | **MOVED** `absent` → `implemented`. ISO 24617-2 communicative-function labels stamp every routed turn (`src/domain/dialogue-acts.mjs`; `5b5e710`, `eb21026`). `PLAN_NLU_BENCHMARKS.md` gets the intent vocabulary it assumed absent |
| 140 | Out-of-scope refusal + the miss wall | implemented | rows `games.honest-miss` (6); CEFR tag `honesty-miss` 1.733/2 (2.5.0, carried) | `PLAN_NLU_BENCHMARKS.md` |
| 141 | Entity and slot extraction | **implemented** | rows `grammar.resolve.unknown-residue` (3), `.unknown-residue-module-orient` (2), and the multi-candidate half now pinned: `grammar.resolve.unknown-residue-ambiguous` (2 — declines naming the unknown words; a guard that genuine ambiguity still enumerates) | **MOVED** `partial` → `implemented` (`70bb752`; closes row 161) — `PLAN_NLU_BENCHMARKS.md` |
| 142 | Token/lemma normalisation through wink-nlp | implemented | row `grammar.normalize` (19); `src/adapters/wink-model.mjs` | `PLAN_NLU_BENCHMARKS.md` |
| 143 | Synonym / hypernym expansion from corpus rows | implemented, on by default | `test/adapters/wiring-facts-memory.test.mjs` | `PLAN_NLU_BENCHMARKS.md` |
| 144 | IDF-weighted ranking (`retrieveBlocks`) | implemented, on by default | `src/adapters/memory/blocks.mjs` | `PLAN_NLU_BENCHMARKS.md` |
| 145 | Cross-domain false accept — the lane that fires when it should not | **implemented** | every misroute the 2.5.0 sweep named is pinned fixed: `grammar.routing.impact-intent` (3), `.impact-paraphrase` guard (3 — never git-blame), `grammar.fuzzy.no-impact-import-collapse`, `games.opener.{teach-guard (4), farewell-guard (2), focus-guard}` | **MOVED** `partial` → `implemented`. Caveat: the CONVERSATION 2.6.0 sweep is in flight and is the instrument that finds the next family — `PLAN_NLU_BENCHMARKS.md` |
| 146 | Short-utterance handling + the conversational catch-all | implemented | `template.conversational` (18); CEFR tag 2.000/2 (2.5.0, carried) | `PLAN_NLU_BENCHMARKS.md` |
| 147 | Read-only session guarantee during a scored run | implemented | `chatbench/run.mjs` pure `runTurn()`; the 2.5.0 product-side caveat is closed — `grammar.routing.impact-intent` asserts memory stays empty after `blast radius of src/core/store.mjs` | caveat closed (row 159) — `PLAN_NLU_BENCHMARKS.md` |
| 148 | Determinism / byte-identical reruns | implemented | AGENT goal arm `cmp` clean; INFBENCH `--replay` byte-identical (`BENCHMARK_{AGENT,INFERENCE}_2.6.0.md`) | both plans |
| 149 | OWL property reasoning + Horn-rule teaching | implemented | rows `inference.relation` (30), `inference.teach-lane` (13) | `PLAN_NLU_BENCHMARKS.md` |
| 150 | Proof rendering + planner consumption of taught records | implemented | row `template.proof.why-isa`; `planning.route.taught-action` | both plans; the 2.5.0 disjointness caveat is closed (row 158) |
| 151 | Consistency checking as a service (`tmct check` / an MCP tool) | absent (as a service) | no `check` verb in `bin/tmct.mjs`; none of the 23 `TOOL_DEFINITIONS` is a consistency tool | `PLAN_CONSISTENCY_CHECK.md`. Detection is live and measured at the chat layer: INF-6 20/20, INF-8 soundness 8/8 (`BENCHMARK_INFERENCE_2.6.0.md`) |
| 152 | Explicit-teaching surface a scrape pipeline would feed | partial | `tmct import --file` (row 112), `tmct extract` (row 114); learn-on-miss adds shipped-pack acquisition (row 163); still no scrape pipeline calls any of them | `PLAN_AGENTS.md` Phase 4 |

### Rows 153-162 — the 2.5.0 "new work" block, re-verified

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 153 | Universal quantifier over a module set | implemented | 3 rows `grammar.quantifier.universal-over-set` | unchanged |
| 154 | PROV Source three-way split + `provSourceClassFor` | implemented | `test/adapters/grammar-ontology.test.mjs` | the classifier is now total over **9** `SOURCE_PRIOR` kinds (was 8): `reference` enumerates under `tmct:DocumentSource` (`57866eb`, `ontology/tmct-core.ttl`) |
| 155 | SKOS concept view | **implemented** | promoted to `src/domain/skos-view.mjs`; **tool**: `test/tools/tmct-related.test.mjs` drives `dispatchTool("tmct_related", …)` — 5 cases including misses (handler `src/tools/handlers/tmct-related.mjs`, cold tier); **chat lane**: `skosRelatedAnswer` in `src/services/chat.mjs`, pinned by `template.skos.phrasings` (2), `grammar.skos.related`, `grammar.skos.honest-miss` (2); `test/adapters/skos-concept-identity.test.mjs` | **MOVED** `partial` → `implemented`. 2.5.0's "a consumer surface is the remaining step" is done twice over (`9a29312`, `60bbabe`). Caveat: `tmct_related` sits in neither the router registry nor `EXCLUDED_FROM_REGISTRY`, so the closed-world story for it lives nowhere yet (`BENCHMARK_AGENT_2.6.0.md` backlog 5) |
| 156 | Existential-premise refusal (∃ not stored as ∀) | implemented | row `inference.teach-guard.existential`; INFBENCH `b1Existential` 40+10 carried green (`BENCHMARK_INFERENCE_2.6.0.md`) | unchanged |
| 157 | Multi-sentence teach line split | implemented | row `planning.teach.multi-sentence-line`; `test/services/sentence-path-splitting.test.mjs` | unchanged |
| 158 | Multi-hop subclass proof validated against stored `owl:disjointWith` | **implemented** | rows `inference.disjoint.subclass-chain` (4), `.instance-form`, `grammar.ace.disjoint`; INFBENCH `b1DisjointVeto` 24/24 at INF-3 and `dlDisjointProofSoundness` **8/8 live** at INF-8, each refusal naming both stored facts (`BENCHMARK_INFERENCE_2.6.0.md`) | **MOVED** `partial` → `implemented`. The 2.5.0 audit's worst find. `dc360ab` computes the cax-dw gate ahead of the direct-fact verdict and both proof chases; the rung the reform authored as a ceiling grades live on first measurement |
| 159 | Read-only impact phrasings do not mutate memory | **implemented** | rows `grammar.routing.impact-intent` (3 — including the literal `blast radius of src/core/store.mjs`, asserting `/memory` reads empty after the turn), `grammar.routing.impact-paraphrase` (3), `template.command.impact` | **MOVED** `partial` → `implemented`. The impact surface also grew: symbol-grain closure with the transitive-dependent label fix, the depth-2 "reaches it through an intermediary" label, and a same-module self-reference guard (`test/adapters/codegraph.test.mjs`; `c7e5fbb`; measured by the two new TOOL-1 agentbench cases, `BENCHMARK_AGENT_2.6.0.md`) |
| 160 | First-person desire vocabulary openers route to describe, not teach | **implemented** | rows `template.vocab.{desire-opener, enumerate-known, expansion (3), filler-tolerance, overview-openers}`; the openers lane is 39 rows including `games.opener.teach-guard` (4) | **MOVED** `partial` → `implemented` (`77fc2a2`). What held the conversation ladder at Tier 0 is built and pinned; the in-flight CONVERSATION 2.6.0 sweep re-measures the ladder |
| 161 | Multi-candidate stale-modifier residue guard | **implemented** | rows `grammar.resolve.unknown-residue-ambiguous` (2: decline-by-name plus a genuine-ambiguity guard) | **MOVED** `partial` → `implemented` (`70bb752`; folds into row 141) |
| 162 | `test:smoke` / `test:fast` tiers + wall-clock budget guard | implemented | `package.json` scripts; `scripts/check-tier-budgets.mjs` | unchanged; `test:fast` now carries 181 tests |

### Rows 163-173 — new work since `d133c6c`

Recovered from the 72 commit subjects, the corpus key-group diff (98 → 116), and new
scripts/verbs/lanes/plans. Every row is new work at 2.6.0, not a prior miss.

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 163 | Learn-on-miss from the shipped reference pack | implemented | lane `test/corpus/reference.test.mjs`: keys `reference.positive.cited-answer`, `reference.negative.unknown-word`, `reference.trust.teach-wins`, `reference.backend.{memory,sqlite}`; the pack is real — `corpus/reference/manifest.json`: **3,887 simplewiki articles**, 337 aliases, 64 shards, pinned dump 20260701 + sha256; provenance kind `reference` at 0.6, below teach 0.95 and provider 0.9 (`src/domain/memory/trust.mjs`); source ids minted `src:reference:<pack>:<article>`; the ontology enumerates the kind under `tmct:DocumentSource`; the synonym-denylist guard runs hermetic from the pack (`a872293`) | NEW — `8ea8a08`, `974f3c6`, `2ba7500`, `57866eb`. A clean miss consults the pack, answers cited, and stores the article's isa with `reference` provenance ranked below teach/operator. `PLAN_LEARN_ON_MISS.md` is BUILT (shipped-pack tier only; the plan dropped its web tier before build) |
| 164 | Browser chat surface + the 3×3 behaviour matrix | implemented | the full `runTurn` engine as a browser bundle (`57132ba`); the Pages home embeds it with a scripted demo rail (`4b3cd7e`); surface matrix {browser bundle, spawned CLI shell/file backend, library entry/sqlite} × {seeded-taught answer, scripted game, pack acquisition}: `e2e/chat-browser-bundle.test.mjs`, `e2e/tui-chat-file.test.mjs`, `e2e/lib-chat-sqlite.test.mjs`, `e2e/web-chat-memory.test.mjs` — 16/16, 0 skipped; engine-level memory contract (`47b7449`); build seam `scripts/lib/browser-bundle.mjs` (`242a8c2`) with the shared zlib thrower stub (`5061829`); browser-fetchable demo pack (`131309d`) | NEW — the chat engine runs in-browser over the real corpus seed path with zero I/O, and the matrix pins that all three surfaces show the same memory behaviour |
| 165 | Bounded ATMS environment sets in syllogise | implemented | `test/adapters/syllogise.test.mjs`: multi-environment justification persistence, the `maxEnvironments` cap (`--max-environments`), set-membership retraction with survivor re-grounding; benchmark twin `a2EntailedRetraction` 12/12 — `survivor-regrounds` 6/6 yes, `stale-justification-falls` 6/6 unproven (`BENCHMARK_INFERENCE_2.6.0.md`) | NEW — `2ed00e1`. Multi-derivation justifications survive a retraction on the survivor's re-grounded environment; the entailed fact falls with its last justification |
| 166 | Semi-naive delta evaluation with watermark state | implemented | `test/adapters/syllogise.test.mjs`: delta ≡ full pinned per rule family (facts, provenance, environments); watermark sidecar; retraction invalidates the watermark; `--full` escape hatch | NEW — `1f37f0b`. The CLI verb's default path; chat's `/syllogise` keeps its explicit-focus full path, so the differential tests carry the delta-mode evidence (`BENCHMARK_INFERENCE_2.6.0.md` coverage note) |
| 167 | `expandFocus` — a caller focus run through the relevance frontier | implemented | `test/adapters/syllogise.test.mjs` (`expandFocus` cases) | NEW — `6b1f57e` |
| 168 | The is-a ladder extensions: reflexive subsumption, universal conditionals, one-hop property inheritance, converse nudges | implemented | chat keys `inference.reflexive.self-subsumption`, `inference.conditional.universal-subclass`, `inference.converse.nudge`, `inference.property.inheritance` (one row each — thin, named by `--gaps`); depth from INFBENCH: `a2Reflexive` 10, `a1UniversalConditional` 10, `a2Converse` 10, `b2PropertyInheritance` 20 with both premises cited (`BENCHMARK_INFERENCE_2.6.0.md`) | NEW — `dc360ab`, `6fe1bc5`. The property lift is one taught ⊑ hop; the 2-hop `grandparent` cell is a declared ceiling with the lift named |
| 169 | The two parser tails land cleanly | implemented | rows `grammar.quantifier.plural-agreement` (a quantified-plural miss suggests the grammatical teach), `inference.negative.unknown-subject` (a bare negative on an unknown subject declines by name and stores nothing) | NEW — `b75d516` |
| 170 | Board reads + goal frames | implemented | rows `planning.board.{readback, where-rest, clear}`, `planning.goal.{natural-frames, assumed-position-flagged, unknown-token-declines}` | NEW — `3113ca5`. `assumed-position-flagged` closes the 2.5.0 sweep's item-28 soft residual: a plan over assumed positions now says so |
| 171 | The logician and casual miss clusters answer or decline by name | implemented | rows `template.capability.ungrounded-decline`, `template.definition.vocab-miss`, `template.orientation.vocab-not-graph` | NEW — `6fe1bc5` |
| 172 | The reformed benchmark ladders + per-arm `floorExpect` grading | implemented | `RUNGS` TOOL-0…TOOL-8 and bands INF-1…INF-8 with alias bijections to the old ranges; six TOOL-7/8 cases, five EL/DL templates; the `floorExpect` seam grades a declared refusal per arm (`8c171ec`, `ab-c2-what-to-test`); `test/bench/agentbench.test.mjs` 40/40; the envelope and `cases.jsonl` estate guards green | NEW — `38c2d4d` (the reform), measured by both 2.6.0 reports. The instrument now measures headroom above the engine instead of stopping where the engine stops |
| 173 | `npm run roll` release machinery | implemented | `package.json` `roll` script (`c75933f`); the roll force-rebuilds the ask bundle (`ee55f12`) | NEW — build tooling, no product surface. This cycle also showed its limit: the bundle drifted again behind post-roll commits (row 131), so the roll-time rebuild is necessary and the estate guard remains the backstop |

## What moved since 2.5.0

**Status flips — ten, all upward:**

- **45 Guess-the-number: `claimed-only` → `implemented`.** Closed-loop belief narrowing over hidden
  state, both seats, 12 keyed rows plus the browser demo driving a win in ≤7 guesses.
- **139 Intent labels: `absent` → `implemented`.** ISO 24617-2 dialogue acts stamp every routed
  turn, envelope + `/narrate`, vocabulary and ontology pinned as one closed set.
- **155 SKOS view: `partial` → `implemented`.** The projection gained both consumer surfaces: the
  `tmct_related` tool and the synonym/related chat lane.
- **158 Disjointness-checked proofs: `partial` → `implemented`.** The 2.5.0 audit's worst find,
  fixed at the is-a ladder and measured live 8/8 on the rung authored to catch it.
- **159 Read-only impact: `partial` → `implemented`.** `blast radius of X` no longer writes; the
  corpus row asserts memory stays empty.
- **160 Desire openers: `partial` → `implemented`.** The Tier-0 teach-misroute family is built out
  with its guards.
- **141/161 Slot extraction and the residue guard: `partial` → `implemented`.** The multi-candidate
  half now declines naming the unknown words, with a guard that genuine ambiguity still enumerates.
- **145 Cross-domain false accept: `partial` → `implemented`.** Every 2.5.0-named misroute is
  pinned fixed; the in-flight CONVERSATION sweep is the instrument that finds the next family.
- **75 Cochange phrasings: `claimed-only` → `partial`**, with a correction — the phrasing rows
  predate the 2.5.0 pin, so that audit's "still unpinned" was stale when written. The multi-root
  coordination refusal remains unpinned.

**Caveats closed on rows that kept their status:** 22 and 150 (the un-wired proof path), 147 (the
blast-radius write). Quality/instrument moves: 19 and 67 (the veto and the reformed INFBENCH), 66
(the reformed AGENTBENCH), 36 (envelope regenerated for the new ladder), 82/98/101 (pins grew).

**New rows 163-173** — eleven: learn-on-miss + the reference pack, the browser chat surface and its
3×3 matrix, the three syllogise capabilities (ATMS environments, delta evaluation, expandFocus),
the is-a ladder extensions, the parser tails, board reads + goal frames, the miss clusters, the
reformed ladders + `floorExpect`, and the roll machinery.

**Downward — none.** No 2.5.0 `implemented` row regressed. One operational red at this pin, not a
capability regression: the committed ask bundle is behind its generator (row 131), caught by the
guard built for exactly that, and flagged by both 2.6.0 reports for rebuild at integration.

**Corrections to `CAPABILITIES_2.5.0.md`:** row 75's evidence note (above); row 110's "test/pages"
citation (the files are `e2e/pages-*.test.mjs`); row 68's log identifier (now gitignored — cite the
skill doc).

## 4.1 Comparative agent-capability table + term mapping

tmct is a narrow, deterministic, zero-cost system. It cannot fabricate, because it has nothing to
fabricate with: every answer traverses a stored graph, and where the graph is silent it says so.
Since this round, the cleanest miss first consults a shipped, cited reference pack before the wall.
Model-column verdicts are **informed estimates from public capability tiers, not a measured
cross-benchmark result** — no run in this repo scores Sonnet or Llama. Columns are named, specific
models, never an umbrella brand or a hosting surface.

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
| **tool use** | 100% plan/result completion, 0% hallucination on every rung through TOOL-6; 62/66 overall, gated at TOOL-7 (`BENCHMARK_AGENT_2.6.0.md`, goal driver). 23 declared tools, 3 dispatched hot. | **Comparable.** Broader vocabulary; no 0%-fabrication guarantee. | **Weaker.** Malformed calls routine. |
| **planning** | The same 62/66 with a proof; Hanoi to the 2³−1 optimum, river to the classic 7. The two new rungs name the headroom: no replanning branch yet (TOOL-7, 0%) and one silent pick on a tied ambiguous entity (TOOL-8) — the worst live behaviour on the board (`BENCHMARK_AGENT_2.6.0.md`). An under-specified board now plans with a flag (`planning.goal.assumed-position-flagged`, row 170). | **Comparable-to-stronger.** Plans over open domains tmct cannot represent; weaker on optimality guarantees. | **Weaker.** No reliable decomposition. |
| **reasoning (formal)** | 379/379 chat, 100/100 kernel, 0% fabrication across eight bands (`BENCHMARK_INFERENCE_2.6.0.md`). Read with its ceilings: 61 greens are declared floors (multi-hop chat materialization, the 2-hop property lift, EL/DL). The 2.5.0 soundness gap is closed and measured live — a proof crossing a stored contradiction refuses, naming both facts, 8/8. | **Comparable.** Handles the same syllogisms and more, without the closed vocabulary — but without a proof, and will assert an unentailed conclusion. | **Weaker.** Fails multi-hop chains. |
| **reasoning (open-world)** | Absent by construction. Off-vocabulary requests land on the miss wall (`games.honest-miss`); since 2.6.0 the cleanest miss first consults the 3,887-article shipped pack and answers cited (row 163). | **Stronger.** The axis a language model is for. | **Stronger.** |
| **grounding** | groundedness 1.847/2 over 98 scored cases (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`, carried — the 2.6.0 run is in flight). Every answer carries a source; pack answers cite the article; `reference` provenance ranks below teach/operator by design. | **Comparable.** No per-fact provenance by construction. | **Weaker.** Confabulates sources. |
| **memory** | An OWL-labelled graph on disk with per-fact provenance over 9 source kinds, trust, contradiction detection, and an ATMS-grade retraction story: multi-derivation justifications survive on re-grounded environments and fall with their last justification, measured 12/12 (`BENCHMARK_INFERENCE_2.6.0.md`; row 165). Snapshots Backend-A only. | **Comparable-to-stronger** in practice; no durable, inspectable, retractable store. | **Weaker.** Context only. |
| **instruction-following** | Not a capability tmct has. It follows a grammar. | **Stronger.** | **Stronger.** |
| **generation** | rephrase 1.833/2 over 30 scored cases (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`, carried). Deterministic templates. | **Stronger**, by a distance. | **Stronger.** |
| **coding** | Absent. tmct reads graphs; seonix indexes code and calls tmct (`README.md`). | **Stronger.** | **Stronger.** |
| **safety / honesty** | **The axis tmct wins.** 0% hallucination across 264 agent rows and 0% fabrication across 379 inference rows, both re-verified at 2.6.0 (`BENCHMARK_{AGENT,INFERENCE}_2.6.0.md`); honesty 1.883/2 (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`, carried). The 2.5.0 proof-shaped gap — the one confident-wrong that was not a misroute — is closed and pinned live. The worst remaining live behaviour is the TOOL-8 silent pick, a declared and grounded call on an arbitrary tied reading. | **Weaker** — it *can* fabricate and tmct cannot; refusal is trained, not structural. | **Weaker.** |
| **autonomy** | None, deliberately. The only LLM in this repo is the offline judge. | **Stronger.** | **Stronger.** |
| **breadth** | 664 default seeded facts, 12,001 at `human-large`, plus the 3,887-article reference pack at the miss tier; a closed relation vocabulary. | **Stronger**, by orders of magnitude. | **Stronger.** |
| **cost / determinism** | **$0 per turn, byte-identical on rerun** — re-verified this cycle on the AGENT goal arm (`cmp` clean) and INFBENCH `--replay` (`BENCHMARK_{AGENT,INFERENCE}_2.6.0.md`). | **Weaker.** Priced per token; not byte-identical across model versions. | **Weaker**, though cheap. |

The shape is unchanged from 2.5.0: tmct's cells are narrow and its numbers high inside that
narrowness. What changed is that the one row it wins — safety/honesty — lost its known exception.

### Term mapping — what changed at 2.6.0

The 2.5.0 term-mapping table (`CAPABILITIES_2.5.0.md` §4.1) carries forward unchanged for the PROV
split, `derivedFrom`/`canonicalisedFrom`, and the ATMS-justification reading. Three rows change or
join:

| tmct term | 2026-normative referent | What changed at 2.6.0 |
|---|---|---|
| `record.dialogueAct` | ISO 24617-2 communicative functions (`dact:` block, `ontology/tmct-core.ttl`) | **new**: a closed dialogue-act vocabulary, declared in the ontology and stamped on every routed turn; the vocabulary and the ttl block are pinned as one closed set, two ways (`test/adapters/grammar-ontology.test.mjs`) |
| `mgx:synonym` / `mgx:relatedTo` / `mgx:similarTo` → `buildSkosConceptView` | `skos:altLabel` / `skos:related` | the read-time projection now has consumers: the `tmct_related` tool and the chat lane (row 155). `mgx:antonym` stays unmapped — SKOS has no opposition relation |
| `reference` (`sourceType`) | `tmct:DocumentSource ⊑ prov:Entity` | **new**: the ninth `SOURCE_PRIOR` kind, enumerated under DocumentSource (`57866eb`); `provSourceClassFor` re-verified total over all 9 |

### Speculative TO-BE

Drawn from the two fresh reports' backlogs and `NEXT.md`'s open items. Not a roadmap
commitment; each checked against the tree as not-yet-shipped.

- **The tied-candidate composer** (TOOL-8's silent pick, `BENCHMARK_AGENT_2.6.0.md` backlog 1) —
  an ambiguity check at the resolveObject seam returning `candidateResults` instead of the tier-3
  pick. The worst live behaviour on the board.
- **The planner's replanning branch** (TOOL-7, backlog 2-3) — the conditional-fallback phrasing
  currently plans both branches unconditionally with a duplicated primary.
- **Chat-layer multi-hop proof materialization** — flips the 30 `b2ChainLenK` ceiling greens
  (`BENCHMARK_INFERENCE_2.6.0.md`).
- **A deeper property-inheritance lift** — flips the 5 `grandparent` ceiling rows.
- **The EL and DL stages** (`PLAN_SYLLOGIST_EL_DL.md`) — flip the 26 INF-7/INF-8 horizon rows.
- **The quantified-has teach's two edges** — a verb-tagged subject declines silently; an s-final
  subject clips to "len" in citations (`BENCHMARK_INFERENCE_2.6.0.md` backlog 1-2).
- **Teach-path predicate minting for prepositional verbs** ("cat relates to milk" stores
  `mgx:relate "to milk"`; `NEXT.md`) — would give the SKOS lane a teach phrasing.
- **Agentbench fixture module-ids aligned to `mod:<path>`** so symbol-seeded impact results can be
  pinned referentially, and the `tmct_impact` declared param kind widened to match the Function
  seeds it now accepts (backlog 4, 6).
- **Reconcile `be-honest-empty`'s frozen expectation** (`BENCHMARK_CEFR_ENGLISH_2.5.0.md`; in the
  in-flight CEFR round's scope).
- **The CEFR and CONVERSATION 2.6.0 reports land** — the first measurement of this round's
  chat-track work under both instruments; their findings seed the next audit.

## 4.2 Per-benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md`
- Reformed nine-rung ladder measured on all four arms, 66 cases, 0% hallucination across 264 rows — **complete** (`BENCHMARK_AGENT_2.6.0.md`)
- Goal driver 100% through TOOL-6; gated at TOOL-7 exactly where the reform predicted; byte-identity clean — **complete** (`BENCHMARK_AGENT_2.6.0.md`)
- `floorExpect` per-arm grading live; `ab-c2-what-to-test` graded as a declared refusal — **complete** (`BENCHMARK_AGENT_2.6.0.md`)
- The tied-candidate composer (TOOL-8), then the replanning branch (TOOL-7) — **todo**
- Fixture module-id alignment; the SKOS positive case — **todo**

### `SKILL_BENCHMARK_CEFR_ENGLISH.md`
- The 2.6.0 run is **in flight this round**; figures carry from 2.5.0 (mean 1.817/2, tier-1 108/109, `BENCHMARK_CEFR_ENGLISH_2.5.0.md`)
- Reconcile `be-honest-empty`'s frozen `answerMatch` with the reworded bootstrap message — **todo**
- Coverage of the 14 untested construction shapes; judge sampling at N≥2 — **todo**

### `SKILL_BENCHMARK_CONVERSATION.md`
- The 2.6.0 persona sweep is **in flight this round**; figures carry from 2.5.0 (`BENCHMARK_CONVERSATION_2.5.0.md`)
- Code-side, the 2.5.0 sweep's headline backlog is closed and corpus-pinned ahead of its re-measurement: items 1, 2, 8, 11 → rows 158, 159, 160, 161 — **complete** (this audit; the in-flight sweep re-measures)
- Ratcheting the ladder past Tier 0 now that the teach-misroute family is built — **todo** (the in-flight sweep decides)

### `SKILL_BENCHMARK_INFERENCE.md`
- Reformed eight-band ladder, both arms: 379/379 chat, 100/100 kernel, 0% fabrication, 100/100 kernel-chat agreement — **complete** (`BENCHMARK_INFERENCE_2.6.0.md`)
- The soundness pin (`dlDisjointProofSoundness`) grades live 8/8 on first measurement — **complete** (`BENCHMARK_INFERENCE_2.6.0.md`)
- Six new templates pin this round's inference work, 86 rows, all green at pinned literals — **complete** (`BENCHMARK_INFERENCE_2.6.0.md`)
- `--replay` byte-identical; `cases.jsonl` estate-guarded — **complete** (`BENCHMARK_INFERENCE_2.6.0.md`)
- The named lifts: multi-hop materialization (30 rows), deeper property lift (5), EL/DL stages (26) — **todo**
- The quantified-has teach's verb-subject and s-final edges — **todo**

## 4.3 Per-plan feature-support (Done / Doing / Todo)

Re-checked against the tree at this pin. `NEXT.md`'s endgame sequences plan archiving after
this audit, so the three BUILT plans below are archive candidates once the in-flight reports land.

- **`PLAN_LEARN_ON_MISS.md`** — pinned at 2.6.0, banner **BUILT** and true. **Done**: the shipped
  reference pack, the cited-answer frame, `reference` provenance, the hermetic guard (row 163). The
  plan dropped its web tier before build (shipped pack only). **Todo**: nothing in-plan.
- **`PLAN_GUESS_NUMBER.md`** — pinned at 2.6.0, banner **BUILT** and true. **Done**: all three
  phases, both seats, the shared session slot (row 45). **Todo**: nothing in-plan.
- **`PLAN_DIALOGUE_ACTS.md`** — pinned at 2.6.0, banner **BUILT** and true. **Done**: vocabulary +
  lane lookup + per-turn stamp + `/narrate` line (row 139). **Todo**: nothing in-plan.
- **`PLAN_25_BACKLOG.md`** — in delivery, this round's build order. **Done**: item 1 (disjointness,
  row 158) marked DELIVERED in-body; the chat-track items rows 159-161 and 168-171 pin. **Doing**:
  the benchmark re-measurements (two landed, two in flight). **Todo**: whatever its list still
  carries after the in-flight reports land.
- **`PLAN_SYLLOGIST.md`** — §2/§3 IMPLEMENTED, §4 delivered with a named remainder; §1/§5 open
  (the §5 Progol/ILP spike is row 15's horizon).
- **`PLAN_SYLLOGIST_EL_DL.md`** — RESEARCH/DESIGN; INF-7/INF-8 now measure its absence as declared
  floors (26 rows), so the plan has a benchmark seat waiting for it.
- **`PLAN_CONSISTENCY_CHECK.md`** — DESIGN, approved in outline, not built as a service (row 151);
  detection is live at the chat layer (INF-6, INF-8).
- **`PLAN_EMBEDDINGS.md`** — design only, banner exactly true; every similarity mechanism in `src/`
  is still a closed table. A research horizon.
- **`PLAN_GRAPH_SCAN.md`** — SHIPPED, all three phases; the banner is now true (2.5.0 flagged it
  false; fixed since).
- **`PLAN_CLASS_QUERY.md`** / **`PLAN_ADVENTURE.md`** — RESEARCH/DESIGN, both reconciled in-body
  against what shipped generically since; remaining scope open.
- **`PLAN_CODE.md`** — Track 1 SHIPPED (row 46); Tracks 2-4 sign-off-gated (row 47).
- **`PLAN_MUD.md`, `PLAN_NLU_BENCHMARKS.md`, `PLAN_REPO_INDEX.md`, `PLAN_CHILD_CORPUS.md`,
  `PLAN_PARAPHRASE_VERIFICATION.md`** — RESEARCH/DESIGN, nothing live, unchanged. Note for
  `PLAN_NLU_BENCHMARKS.md`: row 139's flip gives it the intent-label vocabulary it assumed absent.
- **`PLAN_AGENTS.md`** — refreshed by this audit (skill §5): the declared-tool count and the
  agentbench line were stale; corrected this commit. Its phases are otherwise as 2.5.0 recorded.
- **Archived since `d133c6c`** — `PLAN_PURGE.md` (EXECUTED), `PLAN_OPEN_ITEMS.md` (delivered),
  `PLAN_DEPS.md` (delivered, Q-items resolved), `PLAN_NORMATIVE.md` (delivered, residuals split
  out), `PLAN_BENCHMARK_LADDERS.md` (implemented and measured; its archived banner still reads
  "DESIGN — not yet implemented", which is stale — flagged to the coordinator). `ROADMAP.md`
  deleted (`8e6550d`). `archive/PLAN_DEFEASIBLE_NEGATION.md` unchanged.

## 4.4 Non-benchmarked capabilities

Real, shipped work no benchmark scalar reaches.

- **The reference-pack build pipeline** (row 163's supply side): `gen:reference-pack` builds
  `corpus/reference/` from a pinned simplewiki dump with a recorded sha256; `build:demo-pack` cuts
  the browser-fetchable subset. The pack's integrity is an estate property, not a benchmark score.
- **The browser-bundle build seam** (row 164): `scripts/lib/browser-bundle.mjs` factors the esbuild
  machinery both bundles share, with the zlib thrower stub linking the pack loader. Its evidence is
  the 16/16 surface-matrix e2e, not a scalar.
- **The dialogue-act ontology co-declaration** (row 139): the closed vocabulary is pinned equal to
  its `dact:` ttl block, two ways. No benchmark scores an ontology block.
- **The roll machinery** (row 173): `npm run roll` bumps the version and force-rebuilds the ask
  bundle. This cycle also showed its limit — the bundle drifted behind post-roll commits, and the
  estate guard, not the roll, caught it (row 131).
- **Determinism and cost.** $0 per turn, byte-identical on rerun, re-verified in both fresh reports.
- **The `Canonical:` line** (row 129). Still the product's best self-diagnostic.

## 6. Summary — real counts, grepped

Counts obtained by grepping the status column of the table above.

**172 rows** (161 carried forward from `CAPABILITIES_2.5.0.md`, 11 new at #163-173; the sequence
has no #63 and merges 21/24, matching the historical table):

| Status | Rows |
|---|--:|
| `implemented` | **143** |
| `partial` | 9 |
| `claimed-only` | 15 |
| `absent` | 2 |
| `reverted` | 1 |
| retired / process change | 2 |

`implemented` rose 123 → **143** (+20): nine status flips up (45, 139, 141, 145, 155, 158, 159,
160, 161) plus eleven new implemented rows (163-173). `partial` fell 15 → **9**: seven flips out,
one flip in (75). `claimed-only` fell 17 → **15** (45 and 75 left). `absent` fell 3 → **2** (139
left). **No row moved downward.**

### What flipped since `CAPABILITIES_2.5.0.md`

**Upward — ten status flips** (45, 75, 139, 141, 145, 155, 158, 159, 160, 161), plus the caveat
closures (22, 147, 150) and instrument/quality moves (19, 36, 66, 67), listed with evidence in
*What moved since 2.5.0* above.

**Downward — none.**

### The three findings this audit would lead with

1. **The 2.5.0 risk register is closed at the code level, ahead of its re-measurement.** The one
   proof-shaped confident-wrong (the disjointness-ignoring subclass proof) is fixed at the is-a
   ladder and graded live 8/8 by the rung authored to catch it. All four routing gaps (158-161) are
   built and corpus-pinned — which answers 2.5.0's second finding directly: those rows were the
   unpinned condition under which the passive once drifted, and they are unpinned no longer. The
   in-flight CONVERSATION/CEFR runs are the instruments that check the fixes under load and find
   the next family.
2. **The reformed ladders measure headroom instead of stopping at the engine's edge.** TOOL-7/8 and
   INF-7/8 hold 87 declared-floor or horizon rows above today's reach, each with its build path
   named (replanning branch, tied-candidate composer, multi-hop materialization, property lift,
   EL/DL). The worst live behaviour anywhere on the board is now the TOOL-8 silent pick — an
   arbitrary choice between tied readings, still declared, grounded, and hallucination-free.
3. **The estate grew two lanes and 37 keys, and the one red at this pin is the guard working.** 13
   lanes / 897 rows / 428 keys; the new `reference` and `games/guess-number` lanes pin whole
   capabilities end to end. The committed ask bundle is behind its generator — caught by the drift
   guard row 131 describes, flagged by both fresh reports, and needing one rebuild at integration.
   Thin spots remain where `--gaps` names them: the four is-a-ladder chat keys are one row each,
   with INFBENCH carrying their depth.

`npm test`: this audit is document-only and did not run the full suite; the coordinator should cite
the live release-run count. `npm run test:fast` at this pin: **181 pass / 0 fail** (~1.3s, run
before this commit). CLI smoke (`printf 'hi\n/exit\n' | node bin/tmct.mjs`) greets and exits 0 per
the standing e2e (`e2e/cli-smoke.test.mjs`).
