# CAPABILITIES_2.11.0.md — tmct capability audit (refresh 11, re-audit over `CAPABILITIES_2.7.12.md`)

Pinned at `5a5ef51`, `package.json` 2.11.0, 2026-07-23. This is a re-audit: every
`CAPABILITIES_2.7.12.md` row carries forward with its status re-checked against the evidence order
in `SKILL_CAPABILITIES_AUDIT.md` §1, and every status that moved is called out with its evidence.

**Audit window (analysis, not a benchmark run):** 2026-07-23. No harness was re-run. This audit reads
the four current `BENCHMARK_*_2.11.0.md` reports, the corpus estate, the tool layer, and the code at
this pin, plus 370 commits (`f659e4a..HEAD`) since the last audit landed.

**A methodology note on the fan-out.** `SKILL_CAPABILITIES_AUDIT.md` §6 Step 5 calls for fanning
re-verification out to background sub-agents by capability range. No `Agent`/`Task` tool for
spawning background sub-agents was available in this session's toolset (checked via `ToolSearch`,
the same absence `BENCHMARK_CONVERSATION_2.11.0.md` reports hitting this same day) — this audit was
produced by the coordinator directly, single-threaded, following the same evidence order §1
prescribes: tool-layer contract tests and keyed corpus rows first, then the supporting estate, then
the four benchmark reports for quality, source reading last and only to locate. Every row below cites
what was actually run or read, not what a sub-agent would have found.

## Per-benchmark provenance — where every figure came from

| Benchmark | Latest report | Figure comes from |
| --- | --- | --- |
| AGENT | `BENCHMARK_AGENT_2.11.0.md` | **2.11.0, current** |
| CEFR_ENGLISH | `BENCHMARK_CEFR_ENGLISH_2.11.0.md` | **2.11.0, current** |
| CONVERSATION | `BENCHMARK_CONVERSATION_2.11.0.md` | **2.11.0, current** |
| INFERENCE | `BENCHMARK_INFERENCE_2.11.0.md` | **2.11.0, current** |

`max(2.11.0, 2.11.0, 2.11.0, 2.11.0)` is 2.11.0, so this audit is `CAPABILITIES_2.11.0.md`. All four
axes were freshly measured today — no carrying-forward needed this cycle, the first time all four
line up since this skill started tracking provenance.

Caveats that travel with the four figures:

- **AGENT 2.11.0 is byte-identical to 2.7.12 on every rung, every driver, to the percentage point.**
  No commit touched `src/domain/router/` between the two reports; the one `agentbench/` commit
  (`9cdec16`) is harness plumbing (memory-fixture seeding), not a graded-behavior change. Goal
  driver 68/68 (100%), resolver floor gated at TOOL-6 (36%, unchanged and correct-by-design), stub
  and shim floors gated at TOOL-3. 0% hallucination held across 272 rows on all four arms.
- **INFERENCE 2.11.0 is byte-identical to 2.7.12 on every band, every template, both arms.** 379/379
  chat, 100/100 kernel, 0% fabrication, `--replay` byte-identical across 2 runs. 374 commits landed
  in the window and several touch the disjointness/proof-chain path directly, but none happens to
  exercise a case shape this generator produces — the report's own account, re-confirmed here.
- **CEFR_ENGLISH 2.11.0 changed its sample, not its instrument.** Judge model and prompt
  (`claude-haiku-4-5-20251001`, `judge-prompt-v2`) are unchanged since 2.7.12, so this is a
  same-instrument comparison — but `chatbench/run.mjs`'s CLI defaults drifted (dual-draw became the
  bare-invocation default, the pool grew to 138), so this cycle ran `--single` explicitly and drew
  the **92-case stratified sample**, not 2.7.12's 138-case full-pool take. Mean 1.787/2 (down 0.022
  from 1.809/2, but the case counts differ, so the raw delta is not clean). The sharper signal is
  the six cases both reports name by id: four improved, one is flat-on-a-harder-rubric, one is
  unchanged — see row 65 below.
- **CONVERSATION 2.11.0 is a fresh persona sweep, the first CONVERSATION figure to land at the same
  version as the other three benchmarks since this skill began tracking provenance.** Six personas,
  68 turns, no `Agent`/`Task` tool available so the coordinator drove each persona's turns directly.
  The mandatory canonical example (teach-then-infer, §0.1) passed clean. Free exploration surfaced 18
  routed findings (down from 2.7.11's 29-item backlog in raw count, but a different backlog — five
  are cross-persona-confirmed fresh phrasings of previously-"fixed" issue classes, thirteen are
  single-persona). One severe write-boundary bug recurred under a new trigger phrase, the same class
  2.7.11 named its worst finding.

## What the four fresh reports change about this audit

The theme of 2.7.12 was: both named router horizons closed, one inference ceiling moved, two full
games shipped from a standing start. **The theme of 2.11.0 is different in kind: three of the four
benchmarks report zero engine movement (AGENT and INFERENCE byte-identical, CEFR's judge instrument
unchanged), while 370 commits landed — because almost all of that work went into product surfaces
the four benchmarks don't score: the demo site, the two games' depth and graphics, a desktop
Electron shell, a browser IDE code explorer, a consent-gated live-research lane, and the memory
backend's own default.** This is exactly the shape `SKILL_CAPABILITIES_AUDIT.md` §4.4 exists for —
"no benchmark moved" reading as "nothing happened" would be the wrong read of this cycle.

- **AGENT and INFERENCE hold their ladders exactly**, confirming the 370-commit window did not
  regress routing or inference even though neither was the target of the work.
- **CEFR's six-case matched comparison shows real, if uneven, movement**: `g-b2-rel-1` and
  `g-b2-passive-9` both flipped from a 2.7.12 hard fail to a partial-or-better pass; `g-c2-garden-1`
  remains the sole hard fail (`NEXT.md`); `g-b2-count-temp-1`'s undercounting bug is byte-identical
  across both cycles (`NEXT.md`).
- **CONVERSATION's write-boundary bug class recurred a second time under a third trigger phrase**
  (2.7.11's original triggers, then 2.7.12's audit named the pattern as the top risk, now a fresh
  casual-fragment trigger in 2.11.0) — the report's own "Next" section and this audit agree: the
  lane's admission criteria are the real target, not another phrase patch (`NEXT.md`).
- **The memory backend's default flipped** (`14723db`): sqlite (Backend C) is now what
  `createSession()` opens with no option set; the flat-file Backend A is retired from routing
  (still explicitly selectable, still what `snapshotMemory` requires).
- **Two new declared tools shipped outside the capability registry**, the same shape the
  `tmct_related` gap had at 2.6.0 before its 2.7.12 fix: `tmct_ingest` and `tmct_export` are
  dispatchable and tested, but neither registered nor excluded (row 210).
- **A large site/games/desktop wave shipped**: the Electron desktop app, the browser IDE code
  explorer, the consent-explicit Wikipedia research lane, IndexedDB session persistence, transcript
  export, deep spider-fly and adventure mechanics (carrying, deception, a live world editor), and a
  large sprite-library expansion. None of these move a benchmark scalar; §4.4 names them.

## 0. Scope note

This audit covers the three sets `SKILL_CAPABILITIES_AUDIT.md` §3 names: the product capability
catalog, what `PLAN_NLU_BENCHMARKS.md` would measure, and what `PLAN_AGENTS.md` leans on. Rows 1-206
carry forward from `CAPABILITIES_2.7.12.md` (which itself has no #63 and merges 21/24) with every
status re-checked; rows 207-230 are new work since its pin (`f659e4a`), recovered from 370 commit
subjects, the corpus key-group delta (144 → 152 groups, 495 → 531 leaf keys, 1017 → 1101 rows), the
`package.json` exports/scripts/tool-count deltas, and one dedicated "what shipped with no row" pass
over the git log.

**Existence check before status re-verification.** Every `file:line`/test-path citation in
`CAPABILITIES_2.7.12.md` (124 distinct paths) was checked for existence at this pin before trusting
any carried-forward row: all 124 resolve. No row in this audit was invalidated by a rename the
five-layer move or later refactors might have caused — a real, checked finding, not an assumption.

## 1. Full status table

**Status key:** `implemented` · `partial` · `claimed-only` · `absent` · plus the standing
`reverted` / process labels, unchanged since 2.0.3.

Rows whose status **moved** since 2.7.12 are marked **MOVED** in the change note. Unchanged rows cite
their stable evidence identifier and restate the status — per `SKILL_CAPABILITIES_AUDIT.md` §8, the
deep prose sits on what moved, not on what didn't.

### Rows 1-33

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline | implemented | `grammar.compositional`, `.relaxation`, `.normalize` | unchanged in kind; several new frame-level fixes this cycle (row 227) sit inside this same pipeline |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | row `grammar.ace` (8) | unchanged |
| 3 | ACE-OWL parser as a standalone MPL-2.0 package | reverted | `packages/` absent (confirmed) | unchanged |
| 4 | OWL 2/RDF/RDFS + SEON ontology grounding | implemented | `test/adapters/grammar-ontology.test.mjs`; `ontology/tmct-core.ttl` | unchanged |
| 5 | Template libraries / response phrase book | implemented | `template.*` key families; `test/adapters/corpus-templates.test.mjs` | unchanged |
| 6 | Filtered ConceptNet corpus slice | implemented, opt-in | `test/adapters/extensions-corpus.test.mjs` | unchanged |
| 7 | Conversational memory as an OWL-labelled graph (3 backends) | implemented | `test/adapters/memory-backend-{sqlite,memory,default}.test.mjs` | **MOVED (default flip)**: `14723db` makes sqlite (Backend C) the default; the flat-file Backend A is retired from automatic routing (still explicit via `--memory-backend memory` in the old sense, or `memory` in-process). All 3 backends still exist and pass their own contract tests |
| 8 | Input normalization pass | partial | row `grammar.normalize` (19+) | unchanged status; no fresh CONVERSATION-2.11.0 finding names this specific lane |
| 9 | Repository Interface adapter contract | implemented | `test/adapters/repository-interface.test.mjs` — 16 services, `INTERFACE_VERSION` 1.1.0 | unchanged |
| 10 | Runnable conformance suite for RI providers | implemented | `test/adapters/repository-interface.test.mjs` (`runConformance`) | unchanged |
| 11 | Library-first design, stable `exports` map | implemented | `test/estate/pack.test.mjs`; `e2e/lib-chat-sqlite.test.mjs` | **MOVED (grew)**: `package.json` exports grew 6 → **7** — new `./ingest` → `src/services/extract-facts.mjs` (`bfd6608`) |
| 12 | Ink console TUI shell | implemented | `e2e/tui.test.mjs`, `e2e/tui-chat-file.test.mjs` | unchanged |
| 13 | Calculation surfaced as reasoning | implemented | `test/adapters/wiring-templates-via.test.mjs` | unchanged |
| 14 | Optionally running linters/tests to observe | claimed-only | nothing in the estate pins it | unchanged |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | absent (research horizon) | `PLAN_SYLLOGIST.md` §5 (archived, DELIVERED with §5 open) | unchanged |
| 16 | Response-finishing grammar pass | partial | `test/adapters/finish.test.mjs` | unchanged |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `test/tools/cli-args.test.mjs`; `bin/tmct.mjs --help` | unchanged |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 19 | `cax-dw` disjointness rule | implemented | `test/adapters/syllogise.test.mjs`; `BENCHMARK_INFERENCE_2.11.0.md` `b1DisjointVeto` 24/24, byte-identical | unchanged; the query-object-side chain-lifting extension (`dbd0bd4`) doesn't touch this generator's case shapes |
| 20 | `cax-sco` type-propagation rule | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 21/24 | Actor-level, session-scoped source trust | implemented | `test/adapters/chat-inference-trust.test.mjs`; `test/adapters/provenance.test.mjs` | unchanged; live-Wikipedia sources now rank below the curated pack in the same trust ladder (`03de6b2`, row 211) |
| 22 | Consistency checking / cardinality / proof-chain materialization | implemented | `test/adapters/syllogise.test.mjs`; INF-6/INF-8 byte-identical (`BENCHMARK_INFERENCE_2.11.0.md`) | unchanged |
| 23 | Unified provenance/trust primitive | implemented | `test/adapters/chat-inference-trust.test.mjs`, `provenance.test.mjs` | unchanged |
| 25 | Memory-tree versioning (`snapshotMemory`) | implemented, Backend A only | `src/adapters/memory/core.mjs` | **MOVED (context, not mechanism)**: `snapshotMemory` still only supports Backend A's flat JSON (`core.mjs:536`), and Backend A is no longer the default a fresh session opens (row 7) — this mechanism now covers a non-default backend |
| 26 | Deterministic contradiction detection | implemented | `test/adapters/provenance.test.mjs` (d) | unchanged |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/adapters/memory/blocks.mjs`; `provenance.test.mjs` (d) | unchanged |
| 28 | Extension-pack / corpus-lexicon loading seam | implemented | `test/adapters/extensions-corpus.test.mjs` | unchanged |
| 29 | Bias-weighted ambiguity resolution | implemented | `test/adapters/bias-weighting.test.mjs` | unchanged |
| 30 | `tmct init --with-persona`, size-tier flag | implemented | `test/tools/cli-args.test.mjs` | unchanged |
| 31 | Tier-2 general-knowledge bundle (legacy) | implemented, legacy | `test/estate/corpus-schema.test.mjs` | unchanged |
| 32 | A wider general-knowledge seed set | implemented, default | `corpus/tier2/manifest.json` | **MOVED (grew)**: `161ca97` raises the chat-seed boot ceiling to ~40 MB (ConceptNet/WordNet-xl caps 7000/14000), then `ac71e90` mirrors the `init:xl` band set at a 24 MB boot-budgeted seed for the browser — the seed a fresh browser session boots with is materially larger than at 2.7.12 |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `test/adapters/corpus-unknown-ingest.test.mjs` (unit ring only) | unchanged |

### Rows 34-66 (no row 63 — the historical table skips it)

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 34 | SHACL-style declarative ingest gate | implemented | `test/adapters/memory-shacl.test.mjs` | unchanged |
| 35 | Cross-repo HTTP smoke test | implemented | `e2e/server-http-smoke.test.mjs` | unchanged |
| 36 | Machine-readable capability envelope | implemented, estate-guarded | `agentbench/envelope.json` — `agentbenchVersion: "2.11.0"`, `caseCount: 68`, `rungReached: TOOL-8`, `gatedAt: null` | unchanged; regenerated at 2.11.0, byte-identical rungs to 2.7.12 (`BENCHMARK_AGENT_2.11.0.md`) |
| 37 | Ontology tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, ON by default | `test/adapters/wiring-facts-memory.test.mjs` | unchanged |
| 38 | Ontology tracks c+d (SEON spine) | implemented, default-off | `test/adapters/grammar-ontology.test.mjs` | unchanged |
| 39 | Subordination/conditional preamble frames | implemented | `grammar.normalize.subordination`, `.conditional`; `grammar.noise.subordination` | unchanged; `PLAN_FILLER_AND_COUNTERFACTUALS.md` (new root doc, row below) now carries the next widening as a scoped design, not yet built |
| 40 | Construction-grammar template bank | implemented | row `grammar.construction.agent-noun` (2) | unchanged |
| 41 | Chat-taught relations & rules | implemented | `inference.relation` (30), `.teach-lane` (13) | unchanged mechanism; several new teach-frame corpus rows this cycle (row 227) |
| 42 | `findActionPath` (bounded successor BFS), wired to a real domain | implemented | `planning.solve.hanoi`, `.execute.river` | unchanged; adventure autoplay and spider-fly continue to be the newest consumers, no kernel edit |
| 43 | `findReachableSet` | implemented, wired into chat | `src/domain/planning.mjs` | unchanged |
| 44 | Towers-of-Hanoi goal-directed planning loop | implemented | row `planning.solve.hanoi` | unchanged |
| 45 | "I am thinking of a number" closed-loop game | implemented | `test/corpus/games/guess-number.test.mjs` | unchanged status; `70d7000` routes dismissals to a warm template and coaches non-numeric guesses |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `test/adapters/synth-rules.test.mjs` | unchanged; `PLAN_CODE.md` re-baselined 2026-07-22, Track 1 still SHIPPED |
| 47 | Program synthesis Tracks 2-4 (sandbox) | claimed-only | `PLAN_CODE.md` §8 | unchanged status; `PLAN_CODE.md`'s re-baseline adds a Track 5 headline proposal (planning over code states) — nothing built (see §4.3) |
| 48 | Completions Stage 0 (broad search + grouping) | implemented | `test/adapters/completions-stage0.test.mjs` | unchanged |
| 49 | Completions Stage 2 (extractive ranking) | implemented | `test/adapters/completions-stage2.test.mjs` | unchanged |
| 50 | Completions wired into a user-facing answer | implemented | `test/adapters/chat-completions-wiring.test.mjs` | unchanged |
| 51 | Capability router — registry + four stages | implemented, corpus-driven | `registry.capabilities()` re-counted **16** (unchanged); `test/adapters/router-drive.test.mjs` | unchanged status; new caveat — the two tools shipped this cycle (`tmct_ingest`, `tmct_export`) sit outside both the registry and `EXCLUDED_FROM_REGISTRY`, the same shape `tmct_related` had before its 2.7.12 fix (row 210) |
| 52 | `POST /v1/messages` HTTP shim | implemented | `e2e/server-http.test.mjs` | unchanged status; shim-transport arm still 24/68 (35%), same TOOL-3 gate, byte-identical (`BENCHMARK_AGENT_2.11.0.md`) |
| 53 | bedrock-meter $0-rung routing | implemented in sibling repo, not here | `PLAN_AGENTS.md` | unchanged |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md` §3 Proposed | unchanged |
| 55 | `seon-mcp` provider adapter | claimed-only | `PLAN_AGENTS.md` §3 Proposed | unchanged |
| 56 | marginalia "mechanical chat" replaced by tmct | claimed-only | `PLAN_AGENTS.md` §3 Proposed | unchanged |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md` §3 Proposed | unchanged |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md` §3 Proposed | unchanged |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet) | implemented | `test/adapters/repository-interface.test.mjs` | unchanged |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `test/adapters/source-slice.test.mjs` | unchanged |
| 61 | Telemetry wrapper on every RI service | implemented | `test/tools/telemetry.test.mjs` | unchanged |
| 62 | Chronograph-style temporal diffing | claimed-only, research-horizon | no `temporal.mjs` module | unchanged; `PLAN_AGENTS.md` §6 keeps it as a non-goal for this pass, not a wall |
| 64 | Dialogue-flow playtest ladder | implemented | `games.*` lanes across 9 shards | unchanged mechanism; the two named-and-frozen new-work rounds (adventure and spider-fly, five rounds each, second edge-hunt) are process evidence, folded into rows 220/222 |
| 65 | CHATBENCH graded-pool ladder | implemented | `test/bench/chatbench-graded.test.mjs`; **mean 1.787/2, 92 cases, 1 hard fail, 90/92 tier-1 pass** (`BENCHMARK_CEFR_ENGLISH_2.11.0.md`) | figure moved to current; case count differs from 2.7.12's 138 (this cycle drew the 92-case stratified default, not the full pool), so the raw mean delta (−0.022) is not clean. The matched six-case comparison is real signal: `g-b2-rel-1` and `g-b2-passive-9` both moved from a 2.7.12 hard fail to a partial-or-better pass; `g-c2-xturn-2` improved slightly; `g-c2-xturn-1` is flat-to-down on a case now scored across a 4th rubric dimension; `g-c2-garden-1` remains the sole hard fail (`NEXT.md`); `g-b2-count-temp-1`'s undercounting is byte-identical (`NEXT.md`) |
| 66 | AGENTBENCH agentic ladder | implemented | `test/bench/agentbench.test.mjs`; `BENCHMARK_AGENT_2.11.0.md` | unchanged status; **byte-identical to 2.7.12 on every rung, every driver** — goal driver 68/68 (100%), 0% hallucination across 272 rows |

### Rows 67-99

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 67 | INFBENCH classical-logic ladder | implemented | row `bench.infbench`; `test/bench/infbench.test.mjs`; `BENCHMARK_INFERENCE_2.11.0.md` | unchanged status; **byte-identical case counts and ceiling/pass splits to 2.7.12 on every template/band**; `--replay` re-confirmed byte-identical |
| 68 | Strategy-advisor watch process | implemented (process), dormant | `SKILL_AGENT_STRATEGY_ADVISOR.md` | unchanged |
| 69 | Segmentation IR + concept force | implemented | `test/adapters/concept.test.mjs` | unchanged |
| 70 | Negation as bounded set complement | implemented | `grammar.negation.set-complement` (5) | unchanged |
| 71 | Reversible-passive traversal | implemented | 4 rows `grammar.passive.fronted-agent` | unchanged status; **quality-up**: `BENCHMARK_CEFR_ENGLISH_2.11.0.md`'s `g-b2-passive-9` (a passive+relative-clause compound, 2.7.12's named recurring capability ceiling) moved from hard fail (0/0/0) to 0.667 — no longer a hard fail, still short of a full pass |
| 72 | Compound-name resolution in `resolveObject` | implemented | row `grammar.compositional.find` | unchanged |
| 73 | Compound matching in `/describe`'s resolver | claimed-only / named gap | `src/domain/codegraph.mjs` `resolveSymbol` | unchanged |
| 74 | Reverse-`inherits` "the"-definite forms | claimed-only / documented decline | `src/domain/ask-vocab.mjs` | unchanged |
| 75 | Cochange phrasing variants + "multi-root" over-match | partial | rows `games.drilldown.history`, `games.relation-touch.cochange` (3) | unchanged |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md` §5 R1 | unchanged; still named as a scoping-spike candidate, not built |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md` §5 R1 | unchanged |
| 78 | Winograd-hard commonsense coreference | claimed-only, research-horizon | `PLAN_AGENTS.md` §5 R3 | unchanged |
| 79 | Shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md` §5 R3 | unchanged |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `test/tools/server.test.mjs` | unchanged mechanism; now dispatches 25 tools (row 130), same switch |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV, provenance) | implemented, no test | `.gitlab-ci.yml` | unchanged |
| 82 | Predicate "find" queries | implemented | `grammar.compositional.find`, `.superlative` | unchanged |
| 83 | Single-sourced `fnv1a` + wink browser-loader seam | implemented | `src/domain/hash.mjs` | unchanged; self-hosted wink vendor + precompression + service worker shipped this cycle (`ae3a357`), same hash seam |
| 84 | SQLite memory Backend C | implemented | `test/adapters/memory-backend-sqlite.test.mjs` | **MOVED (quality up)**: now the routing default (row 7); `14723db` |
| 85 | In-memory Backend B | implemented | `test/adapters/memory-backend-memory.test.mjs` | unchanged |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `e2e/import-file.test.mjs` | unchanged |
| 87 | Default human-world persona + size tiers | implemented | `corpus/tier2/human*.jsonl` | unchanged |
| 88 | `graphService` wired into completions | implemented | `test/adapters/chat-completions-graphservice.test.mjs` | unchanged |
| 89 | Public completions exports | implemented | `package.json` exports | unchanged |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | retired (fixes stand) | skill file still absent | unchanged |
| 91 | Persona-sweep as the conversation bench's default | process change | `SKILL_BENCHMARK_CONVERSATION.md`; `BENCHMARK_CONVERSATION_2.11.0.md` | unchanged process; **evidence refreshed** — six frames, 68 turns, 18 routed findings this cycle (5 cross-persona-confirmed, 13 single-persona), the mandatory canonical example passed clean, first CONVERSATION report to land at the SAME version as the other three benchmarks |
| 92 | Multi-candidate ambiguity resolution | implemented | `template.ambiguity.multi-reading` (1) | **MOVED (caveat closed)**: 2.7.12's caveat named a branch-preview auto-expansion mislabeling a candidate; `06865ec` ("a did-you-mean branch preview covers every candidate with its own label") fixes it and `BENCHMARK_CONVERSATION_2.11.0.md`'s 18-item list does not name this class again |
| 93 | Memory-graph-aware `spiralExpand` | implemented (library-level) | `test/adapters/codegraph.test.mjs` | unchanged |
| 94 | Edge/node provenance timestamps | partial (derived half removed) | `test/adapters/provenance.test.mjs` (a) | unchanged |
| 95 | Reverse fact-cascade query shapes | implemented | `inference.reverse-predicate.by-object` | unchanged |
| 96 | Forward-shape `entityType` grain-checking | implemented | `test/tools/ask.test.mjs` | unchanged |
| 97 | Possessive-named-instance teach shape | implemented | `games.teach-then-infer.possessive` | unchanged; determiner-led possession teach is a sibling addition (row 228) |
| 98 | Bare known class/entity name → describe/focus | implemented | `grammar.bare-entity.camelcase` (3), `.module-path` (2) | unchanged |
| 99 | Capability router invocation surface (`tmct plan`, `/plan`, `./plan`) | implemented | `e2e/plan-cli.test.mjs`; 11 `planning.route.*` rows | unchanged |

### Rows 100-138

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 100 | Five-layer `src/` architecture, downward-only imports | implemented | `test/estate/import-layers.test.mjs` | unchanged; allowlist still a ratchet |
| 101 | Keyed corpus-lane test estate | implemented | `node scripts/corpus-matrix.mjs` — **15 lanes / 1101 rows / 531 keys / 152 groups** | grew: 15/1017/495/144 → 15/1101/531/152; every CONVERSATION-backlog fix this cycle landed with its own corpus row (spot-checked: `1634254`, `485d605`, `a637fdb`, `cf56bea`, `d737cb0`, `2038dfb`, `dbd0bd4` each touch `test/corpus/{grammar,inference}.jsonl`) |
| 102 | e2e tier: real binary + real browser | implemented | `e2e/cli-smoke.test.mjs`, `e2e/browser-chat.test.mjs` | unchanged mechanism; the per-push CI pipeline now drops to the browser tier only, heavy e2e split out (row 219) |
| 103 | README examples run against the live product | implemented | `test/readme/readme.test.mjs`, `e2e/readme-examples.test.mjs` | unchanged status; heavy examples moved to a local `check:readme` check this cycle, not per-push (row 219) |
| 104 | Plan lane — teach, state a goal, solve, step | implemented | `planning.solve.hanoi`, `.execute.next`, `.goal.verbless` | unchanged |
| 105 | Generic action interpreter + action `Rule` family | implemented, extended | `92e8415` (2.7.12) | unchanged since 2.7.12; adventure's world editor and RPG redesign (row 220) build on this substrate without further kernel change |
| 106 | Taught-action registry seam (`registerCapability`) | partial | `planning.route.taught-action` | unchanged |
| 107 | River-crossing domain | implemented | `planning.execute.river`, `.legal.river-constraints` | unchanged |
| 108 | `/capabilities` listing + `tmct plan --tools` | implemented | `planning.capabilities.listing` (2), `.readback` (4) | unchanged |
| 109 | `tmct viz` ledger memory explorer + chat dock | implemented | `e2e/ledger-viz-cli.test.mjs`, `e2e/ledger-viz.test.mjs` | unchanged status; the ledger page also gained a telemetry dashboard strip and a live teach-and-ask chat dock this cycle (row 226) — a distinct feature on the same page |
| 110 | Animated self-contained plan render + `chat --render/--output` | implemented | `e2e/chat-prompt.test.mjs`; `test/adapters/plan-viz.test.mjs` | unchanged status; `plan.html` gained a live re-solve session, a chat-assert dock and a PDDL+OWL/RDF panel this cycle (row 225) |
| 111 | `chat --prompt` one-shot turn runner | implemented | `e2e/chat-prompt.test.mjs` | unchanged |
| 112 | `tmct import --file` | implemented | `e2e/import-file.test.mjs` | unchanged |
| 113 | `--memory-backend` + `tmct.toml [memory]` | implemented | `test/tools/cli-args.test.mjs`, `test/adapters/chat-memory-backend.test.mjs` | **MOVED**: default value flipped to `sqlite` (row 7); the flag and the toml key both still accept `default`/`memory`/`sqlite` explicitly |
| 114 | `extract:facts` / `tmct extract` over a document | implemented | `test/adapters/extract-facts-from-text.test.mjs` | unchanged status; `--optimistic`/`--canonical` modes and the `./ingest` library export are new siblings (row 209), not a change to this row's own mechanism |
| 115 | WordNet → ConceptNet-shape conversion | implemented | `test/adapters/corpus-wordnet.test.mjs` | unchanged |
| 116 | Open English Namenet top-up bundle | implemented | `test/adapters/corpus-namenet.test.mjs` | unchanged |
| 117 | `init:xl` / `init:xxl` scale presets | implemented | `e2e/init.test.mjs` | unchanged |
| 118 | Seed-side O(n) index + per-turn `factRows` memoisation | implemented | `test/adapters/memory-seed-perf.test.mjs` | unchanged mechanism; now indexing a larger default seed (row 32) |
| 119 | Defeasible negation | implemented | `inference.capability.base-rate`, `.negative-teach` | unchanged |
| 120 | Persisted justification + retraction cascade, 5 rule families | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 121 | Taught-fact retraction wired to chat | implemented | `inference.retraction.subclass`, `.honest-miss` | unchanged |
| 122 | Multi-valued has/can facts not read as contradictions | implemented | `test/adapters/memory-contradictions-cardinality.test.mjs` | unchanged |
| 123 | Verified paraphrase (closure-backed) | partial | unit ring only | unchanged |
| 124 | Entity comparison ("how is X different from Y") | partial | `test/adapters/compare.test.mjs` | unchanged |
| 125 | Comparative frame | implemented | `grammar.teach.comparative-contraction`, `inference.comparative.yesno` | unchanged status; a directly-taught comparative contradiction is now disclosed at ask-time (`6be8ff1`) |
| 126 | Dynamic memory-class list/count | implemented | `template.count.restricted`, `.recall.count` | unchanged mechanism; taught-class member count/list joins it (row 228) |
| 127 | Plural anaphora | implemented | `grammar.anaphora.*` (16) | unchanged |
| 128 | Deterministic answer-phrasing variety | implemented | `template.conversational` | unchanged |
| 129 | Canonical query/fact representation echoed on ask and teach | implemented | canonical assertions across lanes | unchanged; still the product's best self-diagnostic |
| 130 | Tool catalog + README tool section generated from `TOOL_DEFINITIONS` | implemented | `test/estate/tool-docs.test.mjs`; `TOOL_DEFINITIONS` **25** (was 23): **3 hot, 22 cold** (was 20 cold) | **MOVED (grew)**: two new cold tools since 2.7.12 — `tmct_export` (`a1faf9c`) and `tmct_ingest` (`bfd6608`), both real: dispatchable, tested (`test/tools/server.test.mjs`, `chat.test.mjs`), reachable via `/export`/`/ingest` in chat; see row 210 for the registry-gap caveat |
| 131 | Browser ask bundle + committed-artifact drift guard | implemented; **guard confirmed green at this pin** | `test/estate/generated-artifacts.test.mjs` — re-run live inside `npm test`, pass | **MOVED (fixed)**: 2.7.12 left this red, needing one more rebuild; the version-roll commits since (`623fb82` and predecessors) each regenerate the ask bundle, and `npm test`'s full run confirms it holds green at this pin — no drift this time |
| 132 | Pages home: chat-led hero, real transcript, plan render, derived version stamp | implemented | `test/estate/page-version-stamp.test.mjs` | **MOVED**: the home page itself was rebuilt this cycle into a "claims-and-features" page in an Electron-structure layout (`97b90f5`, row 218), a redesign rather than the 2.7.12 three-hero layout; `e2e/pages-index.test.mjs` re-asserts the new structure |
| 133 | Licence & PII quality gates | implemented | `test/estate/pii.test.mjs`, `corpus-licences.test.mjs`, `links.test.mjs`, `pack.test.mjs` | unchanged |
| 134 | Set-complement / modal-negation restated in tmct's own grammar | implemented | `grammar.negation.set-complement`, `.guard`, `.frame` | unchanged |
| 135 | Seven chat lanes for questions that previously had none | implemented | rows across `grammar`/`inference`/`planning`/`templates` | unchanged |
| 136 | `/narrate` developer trace mode | implemented | `template.narrate.toggle`, `.annotated-shapes`, `.unknown-arg` | unchanged |
| 137 | `/why` proof rendering | implemented | `template.proof.why-isa` | unchanged status; `PLAN_NLU_BENCHMARKS.md`'s W1 (a real multi-premise `/why` rendering lane) is still unbuilt — see §4.3 |
| 138 | `tmct viz --depth/--limit/--focus/--term` | implemented | `e2e/ledger-viz-cli.test.mjs` | unchanged |

### Rows 139-152 — the §3 superset: what the two plans lean on

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 139 | Utterance → intent label from a fixed vocabulary | implemented | `test/adapters/chat-dialogue-act-labels.test.mjs` | unchanged |
| 140 | Out-of-scope refusal + the miss wall | implemented | `games.honest-miss` (6); CEFR tag **honesty-miss 1.867/2**, 5 cases, 0 hard fails (`BENCHMARK_CEFR_ENGLISH_2.11.0.md`, current, different sample from 2.7.12's 8-case 1.958/2, not a clean delta) | unchanged status; the write-boundary bug class recurred a THIRD time this cycle under a fresh casual-fragment trigger ("k what abt users.mjs" — `BENCHMARK_CONVERSATION_2.11.0.md` #3, `NEXT.md`) |
| 141 | Entity and slot extraction | implemented | `grammar.resolve.unknown-residue` (3) | unchanged |
| 142 | Token/lemma normalisation through wink-nlp | implemented | `grammar.normalize` (19); `src/adapters/wink-model.mjs` | unchanged mechanism; wink is now self-hosted/vendored with precompression for the browser (`ae3a357`) |
| 143 | Synonym / hypernym expansion from corpus rows | implemented, on by default | `test/adapters/wiring-facts-memory.test.mjs` | unchanged |
| 144 | IDF-weighted ranking (`retrieveBlocks`) | implemented, on by default | `src/adapters/memory/blocks.mjs` | unchanged |
| 145 | Cross-domain false accept — the lane that fires when it should not | implemented | every 2.7.12-named fix stays pinned | unchanged status, real new caveats — `BENCHMARK_CONVERSATION_2.11.0.md` names three fresh instances in the same family: a sentence opening with "I" misparses as teach-about-the-pronoun (#1, `NEXT.md`), naming an individual ("my cat is called whiskers") misroutes to a code `calls` query (#10, `NEXT.md`), a has-property question routes into the code `defines` relation (#12, `NEXT.md`) |
| 146 | Short-utterance handling + the conversational catch-all | implemented | `template.conversational`; CEFR tag **conversational 1.977/2**, 11 cases, 0 hard fails (current, 2.7.12 carried 2.000/2 on a different 12-case draw) | figure moved to current; `BENCHMARK_CONVERSATION_2.11.0.md`'s small-talk persona finds 7 of 10 turns wall on sibling phrasings of an intent that DOES get a good decline on its one exact wording (#7, `NEXT.md`) |
| 147 | Read-only session guarantee during a scored run | implemented | `chatbench/run.mjs` pure `runTurn()` | unchanged |
| 148 | Determinism / byte-identical reruns | implemented | INFERENCE `--replay` byte-identical across 2 runs (`BENCHMARK_INFERENCE_2.11.0.md`, fresh) | unchanged; spider-fly's deeper mechanics (carrying, deception, eggs) remain seeded rather than wall-clock-random (row 222), same discipline as 2.7.12's ecology v2 |
| 149 | OWL property reasoning + Horn-rule teaching | implemented | `inference.relation` (30), `.teach-lane` (13) | unchanged |
| 150 | Proof rendering + planner consumption of taught records | implemented | `template.proof.why-isa`; `planning.route.taught-action` | unchanged |
| 151 | Consistency checking as a service (`tmct check` / an MCP tool) | absent (as a service) | no `check` verb; none of 25 `TOOL_DEFINITIONS` is a consistency tool | unchanged; `PLAN_CONSISTENCY_CHECK.md` still DESIGN, approved in outline, not built |
| 152 | Explicit-teaching surface a scrape pipeline would feed | partial | `tmct import --file`, `tmct extract`, learn-on-miss, the child pack | unchanged status; live-Wikipedia learn-on-miss (row 211) and the consent-explicit research lane (row 213) both widen the acquisition surface further, still no scrape pipeline calls any of them |

### Rows 153-162

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 153 | Universal quantifier over a module set | implemented | `grammar.quantifier.universal-over-set` (3) | unchanged mechanism; "any" now recognized as a universal-quantifier synonym alongside every/each/all (`a637fdb`) |
| 154 | PROV Source three-way split + `provSourceClassFor` | implemented | `test/adapters/grammar-ontology.test.mjs`; `SOURCE_PRIOR` still 9 kinds | unchanged; live-Wikipedia sources now rank below the curated pack in this same ladder (`03de6b2`) |
| 155 | SKOS concept view | implemented | `test/tools/tmct-related.test.mjs` | unchanged |
| 156 | Existential-premise refusal (∃ not stored as ∀) | implemented | `inference.teach-guard.existential`; INFBENCH `b1Existential` byte-identical | unchanged |
| 157 | Multi-sentence teach line split | implemented | `planning.teach.multi-sentence-line` | unchanged |
| 158 | Multi-hop subclass proof validated against stored `owl:disjointWith` | implemented | `inference.disjoint.subclass-chain` (4); INFBENCH byte-identical | unchanged status; the disjointness veto now also walks the query object's own ⊑-ancestor chain (`dbd0bd4`), a real extension this generator's case shapes don't currently exercise |
| 159 | Read-only impact phrasings do not mutate memory | implemented | `grammar.routing.impact-intent` (3) | unchanged |
| 160 | First-person desire vocabulary openers route to describe, not teach | implemented | `template.vocab.{desire-opener, enumerate-known, expansion, filler-tolerance, overview-openers}` | unchanged status, adjacent new finding — `BENCHMARK_CONVERSATION_2.11.0.md` #1 shows a plain sentence OPENING with "I" ("I am new here", "I want to know all functions in tasks.mjs") misparsing as a teach attempt about the pronoun itself, distinct from this row's own desire-verb vocabulary and worse (an active, confusing decline, not a plain wall) — `NEXT.md` |
| 161 | Multi-candidate stale-modifier residue guard | implemented | `grammar.resolve.unknown-residue-ambiguous` (2) | unchanged |
| 162 | `test:smoke` / `test:fast` tiers + wall-clock budget guard | implemented | `package.json` scripts; `scripts/check-tier-budgets.mjs`; `test:fast` re-run live this audit — **188/188 pass** | **MOVED (grew)**: 183 → 188 tests since 2.7.12 (five new tool-layer tests for `tmct_ingest`/`tmct_export`). Re-run under a concurrent full `npm test` this session, so its wall-clock is not a clean budget reading this time — see §9 |

### Rows 163-173 — the 2.6.0 "new work" block, re-verified

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 163 | Learn-on-miss from the shipped reference pack | implemented | `test/corpus/reference.test.mjs`; `corpus/reference/manifest.json` | unchanged; now the third tier in a longer cascade (child pack → reference pack → live Wikipedia, row 211) |
| 164 | Browser chat surface + the 3×3 behaviour matrix | implemented | `e2e/chat-browser-bundle.test.mjs`, `e2e/lib-chat-sqlite.test.mjs`, `e2e/web-chat-memory.test.mjs` | unchanged; the ingest and research surfaces (rows 213, 215) build on the same `scripts/lib/browser-bundle.mjs` seam |
| 165 | Bounded ATMS environment sets in syllogise | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 166 | Semi-naive delta evaluation with watermark state | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 167 | `expandFocus` — a caller focus run through the relevance frontier | implemented | `test/adapters/syllogise.test.mjs` | unchanged |
| 168 | The is-a ladder extensions: reflexive subsumption, universal conditionals, one/two-hop property inheritance, converse nudges | implemented | INFBENCH byte-identical to 2.7.12 | unchanged status; 2-hop property inheritance now walks EVERY parent, not just the first found (`2038dfb`) — a real extension this generator's fixed case set doesn't currently exercise, so INF-4's ceiling count stays 30 |
| 169 | The two parser tails land cleanly | implemented | `grammar.quantifier.plural-agreement`, `inference.negative.unknown-subject` | unchanged |
| 170 | Board reads + goal frames | implemented | `planning.board.{readback, where-rest, clear}` | unchanged |
| 171 | The logician and casual miss clusters answer or decline by name | implemented | `template.capability.ungrounded-decline` | unchanged status; a direct probe of the honest-miss promise itself ("can you make up an answer if you don't know") gets the plain grammar wall rather than an on-brand confirmation this cycle (`BENCHMARK_CONVERSATION_2.11.0.md` #8, `NEXT.md`) — the one 2.11.0 finding that touches the product's own headline claim |
| 172 | The reformed benchmark ladders + per-arm `floorExpect` grading | implemented | `RUNGS` TOOL-0…TOOL-8, bands INF-1…INF-8 | unchanged |
| 173 | `npm run roll` release machinery | implemented | `package.json` `roll` script | unchanged status; the ask-bundle drift the 2.7.12 audit left red is confirmed rebuilt and holding green this cycle (row 131) |

### Rows 174-206 — the 2.7.12 "new work" block, re-verified

All 33 rows re-checked for continued existence at this pin; no status regressed. Full detail sits in
`CAPABILITIES_2.7.12.md` (rows 174-206); the summary that matters for this cycle:

| # range | Capability cluster | Status | Change note |
|---|---|---|---|
| 174 | Child triples pack (learn-on-miss tier) | implemented | unchanged; now the first tier consulted, still ahead of the reference pack (row 163) |
| 175-181 | The adventure game (world-loading, imperative grammar, world interpreter, NPC scheduler, dead-end routing, examine/talk framing, verb-synonym/typo tolerance) | implemented | unchanged mechanism; this cycle's adventure work (row 220) is additive on top — RPG chrome, a world editor, carrying/map/goal panels — none of it altered these seven foundational rows |
| 182 | Taught fact-value rule shape (`domain.mjs`) | implemented | unchanged; the substrate the world editor's `applyEdit` (row 220) writes through |
| 183-187 | Spider-fly (grid world, turn engine, chat integration, rendering/pages, ecology v2) | implemented | unchanged mechanism; this cycle's spider-fly work (row 222) is a further additive mechanics layer on the same engine |
| 188 | Shared play/pause/step/reset ticker primitive | implemented | unchanged; still reused, not re-invented, by every new tickable surface this cycle (the code explorer's IDE shell does not tick, so it is not a fifth consumer) |
| 189 | Adventure graphics renderer | implemented | unchanged mechanism; superseded visually by this cycle's RPG chrome redesign (row 220), same "draw exactly what the digest says" discipline |
| 190 | Adventure sprite-map registry + objective marker fact | implemented | unchanged; the registry grew substantially this cycle (row 224) on the same resolver, no code change to the resolver itself |
| 191 | Goal-inferring adventure auto-play | implemented | unchanged mechanism; auto-play still executes through `runWorldCommand`, no second interpreter, even after the world-editor and RPG-chrome additions |
| 192 | Adventure browser bundle + full-screen page + home-page embed | implemented | **MOVED (context)**: the home-page embed itself was redesigned this cycle (row 218); the adventure full-screen page persists via IndexedDB now (row 214) |
| 193 | Playtest edge-hunt as a named, repeatable process | implemented (process) | unchanged process; ten further rounds ran this cycle (5 adventure + 5 spider-fly, "the second edge-hunt"), each tied to a real shipped fix — see rows 220/222 |
| 194 | TOOL-7/TOOL-8 router mechanism | implemented | unchanged; byte-identical measurement this cycle (`BENCHMARK_AGENT_2.11.0.md`) |
| 195 | `resolveMemoryTerm` | implemented | unchanged |
| 196-206 | The eleven CONVERSATION/CEFR-backlog chat-lane fixes from the 2.7.12 session | implemented | unchanged; each row's own corpus key still pins green |

## Rows 207-230 — new work since `f659e4a`

Recovered from 370 commit subjects (`git log f659e4a..HEAD --oneline`), grouped into workstreams; the
corpus key-group diff (144 → 152 groups); `package.json`'s exports/scripts/tool-count deltas; and one
dedicated sweep for root `PLAN_*.md`/`SKILL_*.md` churn. Every row is new work at 2.11.0, not a prior
miss.

| # | Capability | Status | Evidence | Note |
|---|---|---|---|---|
| 207 | SQLite becomes the routing default; the flat-file backend retires from routing | implemented | `14723db`; `test/adapters/memory-backend-default.test.mjs`; row 7's own update | Backend A stays selectable and is what `snapshotMemory` still requires (row 25) — a default flip, not a removal |
| 208 | Triple-store export + full re-init store controls (CLI, tool layer, library, chat page) | implemented | `a1faf9c`; `/export <path>` chat command; `tmct_export` tool; `src/adapters/memory/export-jsonl.mjs` | serializes the whole memory store as JSONL, the same shape `tmct memory --export` writes |
| 209 | `ingestText` seam, `extract --optimistic/--canonical`, `tmct_ingest` tool, `./ingest` library export | implemented | `bfd6608`; `test/tools/chat.test.mjs`; `package.json` exports (row 11) | the ingest lane that `ingest.html` (row 215) and the `tmct_ingest` tool both call |
| 210 | `tmct_ingest`/`tmct_export`: declared, dispatched tools outside both the capability registry and the exclusion list | partial (caveat) | `EXCLUDED_FROM_REGISTRY` still exactly 3 entries (`tmct_context`, `tmct_context_more`, `tmct_snippet`); `capabilities()` still 16; `test/adapters/router-resolver.test.mjs` names no NL frame for either tool | the same shape the `tmct_related` gap had at 2.6.0 before its 2.7.12 fix (row 51/155) — both tools are reachable via `/export`/`/ingest` in chat and via `tmct cli`, just not through the capability router's NL resolution |
| 211 | Live Wikipedia learn-on-miss, four opt-in modes, CLI/browser parity | implemented | `9cdec16`; `d737e8d`; `/wiki on\|off\|supplement\|always`; `03de6b2` (live sources rank below the curated pack) | `supplement` adds live citations to grounded answers; `always` widens the term fallback to an ordinary ask's object |
| 212 | Bounded auto-synthesis pass after every learn-on-miss load | implemented | `e670dff`; `synthesiseAroundTerm`, budget `AUTO_SYNTHESIS_BUDGET` 12, threaded as `synthesisBudget` through `runTurn`, settable per browser session | runs automatically around a freshly-ingested term, not on every turn |
| 213 | Consent-explicit research lane over Simple English Wikipedia (queue engine, ticking chat/ledger controls) | implemented, no corpus-lane row yet | `f4d6f12`, `09c6e57`, `25b8cfb`, `dfac829`; `src/services/research.mjs`; `test/services/research.test.mjs`, `test/adapters/chat-research-lane.test.mjs`, `e2e/pages-chat-research.test.mjs`, `e2e/pages-ledger-research.test.mjs` | per-turn queue steps, state threaded like `planState`; explicit consent gate before any fetch; same engine seam drives both the chat and ledger docks. Adapter/service/e2e tested, no `test/corpus/` key yet — a §4.4 non-benchmarked capability |
| 214 | Browser session persistence via IndexedDB (chat + adventure) | implemented | `a3ebabc`; `test/adapters/idb-persist.test.mjs` | a session survives a page reload without a server round-trip |
| 215 | Transcript export (`.md`) + whole-conversation print on chat.html | implemented | `3089172` | |
| 216 | `ingest.html` — a seeded, stateful ingest surface at parity with chat.html | implemented | `bc924b5`, `f5d95ab`, `1ed8991`, `2d34d5b`; `src/services/ingest-viz.mjs`; `e2e/pages-ingest.test.mjs` | paste/drop/file ingest, JSONL export on the ledger and chat pages too; a shared memory-panel module with chat.html; the wiki off/miss/supplement/always radio group and a synthesis slider (superseding a plain checkbox) |
| 217 | Electron desktop shell packaging the general-knowledge seed | implemented, gated out of `npm test` | `0718129`; `aab1269`; `electron/main.mjs`, `electron/preload.cjs`; `electron/smoke.test.mjs` run via `npm run test:electron` only (needs the real binary, kept out of the hermetic suite by design) | serves the code explorer as a desktop channel over a preload bridge |
| 218 | Home page redesign — an "electron-structure" claims-and-features page | implemented | `97b90f5`, `35892a9`; `e2e/pages-index.test.mjs` re-asserts the new structure | supersedes 2.7.12's three-hero layout (row 132) |
| 219 | Uniform marketing-screenshot generation + committed drift guard; per-push CI drops to the browser tier | implemented (process/estate) | `59be825`; `test/estate/screenshots.test.mjs`; `acca619` (heavy e2e split out, README examples moved to a local `check:readme`) | the eight marketing plates are generated (`scripts/gen-screenshots.mjs`), not hand-made, and drift-guarded the same way the ask bundle is (row 131) |
| 220 | Adventure: RPG chrome redesign, live world editor, carrying/visited-map/goal-status panels, murder-mystery room-view redesign | implemented | `41e7239` (world editor UI + RPG chrome), `2666f4e` (`session.applyEdit`), `4be51a5` (carrying/map/goal panels), `67a6384` (murder-mystery board-game redesign), `3d2589d`/`d8a1380` (positional stacking, room-kind borders); `e2e/adventure-*` and `1511a08` (world editor driven live in a real browser) | five playtest edge-hunt rounds this cycle each shipped a real fix (examine-current-room digest, is-objective marker leak, auto-play win completeness — the second edge-hunt, process row 193) |
| 221 | Adventure: space taxonomy, positions, staff-knowledge/talk reveal, class-default contents, taught-fact isolation | implemented | `02f466c`, `4d17632`, `b09856f`, `f0516ef`; `adventure-position` (2), `-defaults` (2), `-knowledge` (2), `-teach-isolation` (1) corpus keys | a taught fact mid-game reads back as prose but never moves a prop (isolation), extending row 175-181's foundational world model |
| 222 | Spider-fly deep mechanics: carrying, mass-gated egg lay, multi-spider hatch, deception pills, plan/belief HUD | implemented | `a44272c` (carrying, mass-gated eggs, multi-spider hatch), `3842c70` (deception pills — true and canonical false position claims), `5105f24` (plan/belief HUD, plan-driven facing, corpses, live tuning) | five further playtest edge-hunt rounds this cycle (starvation goal-line consistency, eaten-mass timing, double-eat crediting, birth-tick visibility — process row 193), each a real fix, same engine as row 183-187 |
| 223 | Spider-fly and adventure chat docks: click-to-fill and contextual pills | implemented | `9f9b41b` (spider-fly click-to-fill pills for the addressed teach-frame), `3fa4394` (adventure chat dock with contextual pills) | |
| 224 | Sprite-emotion parameterization + expanded sprite tiers; `sprites.html` catalog and scene composer | implemented | `fe4496f` (shared infra), `593db84`/`b56d54d` (56 person-role + 17 animal emotion classes), `dfd8e9a` (400px gradient-shaded tier), `8c4e8aa` (16 emoji-glyph fallback sprites), `91b08ac` (property-aware sprite template library), `a231d9e`/`e345d7f` (`sprites.html` catalog + free-text scene composer); `test/adapters/sprite-templates.test.mjs`, `test/adapters/sprite-emotion*.test.mjs` | a large graphics-asset expansion across the adventure and spider-fly pages; every emitted fact traces to a real template entry, no minted terms (re-confirmed live in `npm test` this audit) |
| 225 | `plan.html` — live re-solve session, chat-assert dock, PDDL+OWL/RDF panel | implemented | `243ef78`; `src/services/plan-pddl.mjs`; `test/adapters/plan-pddl.test.mjs` | |
| 226 | Ledger telemetry dashboard + live teach-and-ask chat dock on `ledger.html` | implemented | `27354e9` (telemetry dashboard strip), `7b46994` (live teach-and-ask chat dock) | a distinct feature from row 109's existing `tmct viz` ledger explorer, same page |
| 227 | CONVERSATION-2.7.11-backlog chat-lane fix wave (15 of 29 items closed) | implemented | `461f40e` merges the wave; individually: `1634254` (teach lane closed to fillers/imperatives/infinitive subjects), `485d605` (bare passive with no "by" agent resolves), `a637fdb` ("any" as a universal-quantifier synonym), `cf56bea` (an adjective object never singularizes), `af74c7e` (trailing period no longer breaks bare teach), `d737cb0` (negative-universal teach generalizes is-a→can), `6be8ff1` (taught comparative contradiction disclosed at ask-time), `dbd0bd4` (disjointness veto walks the query object's own chain), `2038dfb` (2-hop property inheritance walks every parent), `4eb57d4` (meta-questions about tmct's own commands no longer misroute), `06865ec` (did-you-mean covers every candidate, row 92), `733c120` ("whats 2+2" gets an honest arithmetic decline), `4da9d5a`/`0cf1620` (why/optimality re-display fixes), `d63fab1`/`0464a8e` (eight walled/misrouted asks routed) | this is the 15-of-29 wave `BENCHMARK_CONVERSATION_2.11.0.md` measures against — the remaining 14 items and the fresh findings this cycle's own sweep surfaced are `NEXT.md`'s open items, not duplicated here |
| 228 | Class-level/quantified adjective predication teach + determiner-led possession teach + taught-class member count/list | implemented | `0855bd2` ("every snake is venomous"), `15cd336` ("all spiders are venomous" now stores), `c0cb9ac` (determiner-led possession teach, memory-class list/count lanes) | extends row 126's dynamic memory-class list/count mechanism |
| 229 | Sense-split fact read-back (superclass chains, grouped concepts under one label) | implemented | `0f4483e`; `template.vocab.sense-split.*` corpus keys | shows is-a superclass chains and groups two concepts under one label on a fact read-back, not a new proof path |
| 230 | Session-log formatting: glow-friendly Markdown + verbatim user-line echo | implemented | `92ace9e` (glow-friendly Markdown), `6abe324` (echo the user's line verbatim in the `.log`) | improves the human-readable session transcript, no change to the underlying store |

## What moved since 2.7.12

**Status flips — three, all upward, none downward:**

- **131 The browser ask bundle's drift guard: red at 2.7.12's own pin → confirmed green at 2.11.0.**
  The version-roll discipline (regenerating the bundle at every `npm run roll`) held across this
  370-commit window; `test/estate/generated-artifacts.test.mjs` passed live inside this audit's
  `npm test` run.
- **92 The multi-candidate ambiguity branch-preview mislabeling: caveat → closed.** `06865ec` fixes
  it and `BENCHMARK_CONVERSATION_2.11.0.md`'s fresh 18-item sweep does not name this class again.
- **210 (new) The `tmct_related` registry-gap shape recurred on two new tools.** Not a regression of
  a fixed row — `tmct_ingest`/`tmct_export` are new capability, shipped with the same registry gap
  their predecessor once had.

**Quality-up moves (status held, the number or the underlying mechanism moved):**

- **7/84/113 The memory backend's routing default flipped to sqlite; the flat-file backend retired
  from routing** (`14723db`), leaving Backend A live but non-default.
- **11 Package exports grew 6 → 7** (`./ingest`).
- **32 The default seed ceiling roughly doubled** (24-40 MB boot budget, up from the 2.7.12 figure).
- **71 A named 2.7.12 recurring capability ceiling (`g-b2-passive-9`) moved from hard fail to a
  partial pass.**
- **130 `TOOL_DEFINITIONS` grew 23 → 25** (2 new cold tools).
- **162 `test:fast` grew 183 → 188 tests.**
- **101 The corpus estate grew one row family across every touched lane**: 15/1017/495/144 →
  15/1101/531/152.

**No downward moves this cycle** — a genuine difference from 2.7.12, which had one operational
regression (the ask-bundle drift, now fixed, see above). The real caveats this cycle are recurrences
under fresh phrasing, not row regressions: rows 140, 145, 160, 171 each carry a fresh
CONVERSATION-2.11.0 finding in the same family a prior row already pins fixed, and rows 65/140 carry
the CEFR-2.11.0 undercounting/garden-path findings — all cross-referenced to `NEXT.md`, none
duplicated as new items per this cycle's constraint.

**New rows 207-230** — 24: the memory-backend default flip, the triple-store export/re-init controls,
the ingest tool/seam/registry-gap trio, live Wikipedia learn-on-miss with auto-synthesis, the
consent-explicit research lane, browser session persistence and transcript export, the ingest and
Electron-desktop and browser-IDE-code-explorer surfaces, the home-page redesign, the screenshot
drift guard and CI-tier split, the adventure and spider-fly deep-mechanics waves (each with its own
five-round playtest edge-hunt), the sprite-library expansion, the plan.html and ledger.html
dashboard/dock features, the CONVERSATION-2.7.11-backlog fix wave, and three chat-lane teach/read-back
fixes.

## 4.1 Comparative agent-capability table + speculative TO-BE

tmct is a narrow, deterministic, zero-cost system. It cannot fabricate, because it has nothing to
fabricate with: every answer traverses a stored graph, and where the graph is silent it says so.
Since 2.7.12, the engine itself held exactly still (AGENT and INFERENCE byte-identical) while a large
wave of product surface shipped around it — a desktop app, a browser IDE, a consent-gated research
lane, and materially deeper game mechanics. Model-column verdicts are **informed estimates from
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
| **tool use** | 100% plan/result completion, 0% hallucination on every rung, **68/68 (100%), no gate** (`BENCHMARK_AGENT_2.11.0.md`, goal driver — byte-identical to 2.7.12). 25 declared tools, 3 dispatched hot, 16 registry capabilities (2 new tools, `tmct_ingest`/`tmct_export`, sit outside the registry — row 210). | **Comparable.** Broader vocabulary; no 0%-fabrication guarantee. | **Weaker.** Malformed calls routine. |
| **planning** | The same 68/68 with a proof; Hanoi to the 2³−1 optimum, river to the classic 7 (`BENCHMARK_AGENT_2.11.0.md`, byte-identical to 2.7.12). Adventure's world editor and RPG-chrome additions built on the planning substrate with zero kernel change this cycle. | **Comparable-to-stronger.** Plans over open domains tmct cannot represent; weaker on optimality guarantees. | **Weaker.** No reliable decomposition. |
| **reasoning (formal)** | 379/379 chat, 100/100 kernel, 0% fabrication across eight bands, byte-identical to 2.7.12 despite 374 commits landing in the window, several touching the disjointness/proof-chain path directly (`BENCHMARK_INFERENCE_2.11.0.md`). Read with its ceilings: 56 greens are declared floors, unchanged. A proof crossing a stored contradiction still refuses, naming both facts, 8/8. | **Comparable.** Handles the same syllogisms and more, without the closed vocabulary — but without a proof, and will assert an unentailed conclusion. | **Weaker.** Fails multi-hop chains. |
| **reasoning (open-world)** | Absent by construction. Off-vocabulary requests land on the miss wall (`games.honest-miss`); the cleanest miss now consults THREE shipped, cited sources in sequence before the wall — a 93,161-fact child triples tier, the 3,887-article reference pack, then an opt-in live Wikipedia fetch (rows 174, 163, 211). | **Stronger.** The axis a language model is for. | **Stronger.** |
| **grounding** | groundedness contributes to a **1.787/2 overall mean** over 92 cases (`BENCHMARK_CEFR_ENGLISH_2.11.0.md`; different sample from 2.7.12's 138, not a clean delta — the matched six-case comparison shows real improvement on two named recurring ceilings). Every answer carries a source; live-Wikipedia citations now rank explicitly below the curated pack (`03de6b2`). | **Comparable.** No per-fact provenance by construction. | **Weaker.** Confabulates sources. |
| **memory** | An OWL-labelled graph on disk with per-fact provenance over 9 source kinds, trust, contradiction detection, and an ATMS-grade retraction story, unchanged and re-confirmed this cycle. The routing default flipped to the SQLite backend this cycle (`14723db`) — the flat-file backend stays live but non-default. Session persistence now also survives a browser reload via IndexedDB (row 214). | **Comparable-to-stronger** in practice; no durable, inspectable, retractable store. | **Weaker.** Context only. |
| **instruction-following** | Not a capability tmct has. It follows a grammar. The two embodied games (adventure, spider-fly) gained materially deeper mechanics this cycle — a live world editor, carrying, deception, mass-gated reproduction — still composing the same taught-action grammar, not a new interpreter. | **Stronger.** | **Stronger.** |
| **generation** | Deterministic templates; conversational tag scores **1.977/2**, 11 cases, 0 hard fails (`BENCHMARK_CEFR_ENGLISH_2.11.0.md`, current, different sample from 2.7.12's 12-case 2.000/2). Session logs now render as glow-friendly Markdown (row 230). | **Stronger**, by a distance. | **Stronger.** |
| **coding** | Absent as an authoring capability; tmct reads graphs. A new browser IDE code-explorer shell and an Electron desktop channel (rows 216-217) now surface that reading capability at IDE scale, seed-aware, without adding any code-generation behaviour. | **Stronger.** | **Stronger.** |
| **safety / honesty** | **The axis tmct wins.** 0% hallucination across 272 agent rows and 0% fabrication across 479 inference rows, both re-verified at 2.11.0 and byte-identical to 2.7.12. The worst remaining live behaviour is unchanged in kind from 2.7.12's own finding — the write-boundary bug class recurred a THIRD time this cycle under a fresh casual-fragment trigger (`BENCHMARK_CONVERSATION_2.11.0.md` #3, `NEXT.md`), still named, ranked, and routed, not silent. | **Weaker** — it *can* fabricate and tmct cannot; refusal is trained, not structural. | **Weaker.** |
| **autonomy** | None, deliberately. The only LLM in this repo is the offline judge. The consent-explicit Wikipedia research lane (row 213) is a bounded, explicitly-gated autonomy surface — every fetch step requires the consent already granted, ticks through a queue like `planState`, never fetches silently. | **Stronger.** | **Stronger.** |
| **breadth** | A default seed roughly doubled this cycle (24-40 MB boot budget, up from 2.7.12), a 93,161-fact child pack, a 3,887-article reference pack, and now an opt-in live-Wikipedia tier past all three; a closed relation vocabulary. | **Stronger**, by orders of magnitude. | **Stronger.** |
| **cost / determinism** | **$0 per turn.** INFBENCH `--replay` re-confirmed byte-identical across 2 runs this cycle. The deeper spider-fly mechanics (carrying, deception pills, mass-gated eggs) stay seeded rather than wall-clock-random, same discipline as 2.7.12's ecology v2. | **Weaker.** Priced per token; not byte-identical across model versions. | **Weaker**, though cheap. |

The shape moved differently from 2.7.12: last cycle the router and inference ladders both climbed;
this cycle they held exactly still while breadth, memory durability, and the product's surface area
(desktop, browser IDE, research, deeper games) all grew. tmct's narrow cells stayed exactly as
narrow and exactly as high; what's new is how much more of the product now sits around them.

### Speculative TO-BE

Drawn from the four fresh reports' own backlogs and `NEXT.md`'s open items. Not a roadmap commitment;
each checked against the tree as not-yet-shipped.

- **Tighten the bare-declarative teach lane's admission criteria generally**, rather than patching
  each new write-boundary trigger — the same lever `BENCHMARK_CONVERSATION_2.11.0.md`'s own "Next"
  section names, and the same one 2.7.12's audit named for this exact class (`NEXT.md`).
- **A recognizer for a plain sentence opening with "I"** — the newest fresh finding in the
  cross-domain-false-accept family, actively confusing rather than merely walling
  (`BENCHMARK_CONVERSATION_2.11.0.md` #1, `NEXT.md`).
- **Root-cause `g-c2-garden-1`'s garden-path parse** — the sole CEFR hard fail this cycle, unchanged
  since 2.7.12 (`NEXT.md`).
- **Investigate `g-b2-count-temp-1`'s undercounting** — a regex-shaped pass hiding a wrong count,
  byte-identical across both cycles (`NEXT.md`).
- **`PLAN_FILLER_AND_COUNTERFACTUALS.md`'s filler-clause-prefix widening** — a new root design doc
  this cycle (moved out of `NEXT.md` at operator instruction), not yet built.
- **Give the consent-explicit research lane and the two ingest surfaces a keyed corpus-lane row** —
  currently adapter/service/e2e tested only, the same gap 2.7.12 named for the adventure
  graphics/auto-play pair (since closed at the adapter tier, still no corpus row).
- **The EL and DL stages** (`PLAN_SYLLOGIST_EL_DL.md`) — flip the 26 INF-7/INF-8 horizon rows,
  unchanged this cycle (14/14, 12/20).
- **PLAN_AGENTS.md's own ranked closure list items 1-5** (a plan verb on `tmct serve`, the
  external-proposal validation seam, the frozen discourse rows, replan-on-drift, activating the
  wider seed/unknown-word ingestion) — tmct-only and independent, per that plan's own sequencing.
- **`PLAN_CODE.md`'s Track 5** (planning over code states as classical plans over graph states) — a
  headline proposal this cycle's re-baseline states, nothing built yet.

## 4.2 Per-benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md`
- Reformed nine-rung ladder measured on all four arms, 68 cases, 0% hallucination across 272 rows,
  byte-identical to 2.7.12 — **complete** (`BENCHMARK_AGENT_2.11.0.md`)
- Attribute the one `agentbench/` commit in the window and confirm it changed no graded behavior —
  **complete** (this report's own account; `9cdec16` is harness plumbing)
- The resolver floor's TOOL-6 gate (36%) closing via the goal-reasoner's own composition step, ported
  to the resolver-only arm — **todo**, explicitly deferred this cycle (measurement-only scope)

### `SKILL_BENCHMARK_CEFR_ENGLISH.md`
- Product replay + judge fan-out, 92-case stratified sample, mean 1.787/2, 1 hard fail, 0 voided —
  **complete** (`BENCHMARK_CEFR_ENGLISH_2.11.0.md`)
- Root-cause `g-c2-garden-1`'s garden-path parse — **todo**, sole hard fail, unchanged since 2.7.12
- Investigate `g-b2-count-temp-1`'s undercounting — **todo**, unchanged since 2.7.12
- Refresh the two drifted tier-1 `answerMatch` patterns (`be-honest-empty`, `conv-hello-there`) —
  **todo**, case-hygiene not a regression, flagged not fixed this cycle
- Fix `chatbench/run.mjs`'s CLI-default drift from the skill's own §1 prose (dual-draw default,
  92-case default sample vs the documented "109") — **todo** (`NEXT.md`)

### `SKILL_BENCHMARK_CONVERSATION.md`
- Persona sweep, 6 frames, 68 turns, the mandatory canonical example passed clean — **complete**
  (`BENCHMARK_CONVERSATION_2.11.0.md`)
- 18 routed findings this cycle (5 cross-persona-confirmed, 13 single-persona) — **complete**
  (measured, routed to `NEXT.md`)
- Close the write-boundary bug class generally, not per-trigger — **todo**, recurred a third time
  this cycle under a fresh trigger
- Ratcheting FLOW-0 clean (three fresh conversations, zero dead-ends) — **todo**, unchanged from
  2.7.11/2.7.12; fresh FLOW-0 edges keep surfacing under new phrasing each cycle
- Probing the two games' deeper mechanics shipped this cycle (world editor, carrying, deception) —
  **todo**, explicitly out of scope for this sweep (built after it would need to be re-dispatched)

### `SKILL_BENCHMARK_INFERENCE.md`
- Reformed eight-band ladder, both arms: 379/379 chat, 100/100 kernel, 0% fabrication, byte-identical
  replay, byte-identical to 2.7.12 — **complete** (`BENCHMARK_INFERENCE_2.11.0.md`)
- Case set held byte-identical, no lever applied to the generator — **complete**
- Attribute why 374 commits, several touching the disjointness/proof-chain path, moved zero rows —
  **complete** (this report's own account: the fixes are real but the generator's case shapes don't
  exercise the paths they touch)
- The EL and DL stages (`PLAN_SYLLOGIST_EL_DL.md`) — **todo**, unchanged (14/14, 12/20)

## 4.3 Per-plan feature-support (Done / Doing / Todo)

Re-checked against the tree at this pin.

- **`PLAN_AGENTS.md`** — pinned at 2026-07-22, v2.10.5 (its own re-baseline, one day before this
  audit). **Done**: the five-stage agent loop in full at demo scale (§2.1-2.4), the tool loop for
  external agents (§2.5, now 25 declared tools), learning on a miss with the child/reference/
  live-Wikipedia cascade (§2.6), the offline synthbench CEGIS harness (§2.7). **Doing**: nothing
  currently in flight by the plan's own account. **Todo**: its own ranked closure list, items 1-11
  (§4) — nearest: a plan verb on `tmct serve` (H), the external-proposal validation seam (I), the
  four frozen discourse rows (K, near half), replan-on-drift (J), activating the wider seed/
  unknown-word ingestion (O). This audit's refresh (§5 below) updates its tool count and figure
  citations; its gap table and sequencing needed no correction.
- **`PLAN_CODE.md`** — pinned at 2026-07-22 (re-baseline). **Done**: Track 1 (rule/frame synthesis)
  SHIPPED 2026-07-08 (row 46). **Doing**: nothing. **Todo**: Tracks 2-4 (JS repair/synthesis, HTML/
  CSS synthesis) remain designs, no implementation (row 47); Track 5 (planning over
  code states, this re-baseline's headline proposal) is designed but not built.
- **`PLAN_FILLER_AND_COUNTERFACTUALS.md`** — new root doc this cycle, pinned 2026-07-22. **Done**:
  nothing — it is a design pass, not yet a diff. **Doing**: nothing. **Todo**: both items it names
  (filler-clause-prefix widening, planner counterfactuals) are open by its own account; live evidence
  cited comes from a 2026-07-21 xl-graph probe session, not from any shipped fix.
- **`PLAN_SYLLOGIST_EL_DL.md`** — banner RESEARCH/DESIGN, unchanged since 2.7.12. **Done**: nothing
  new this cycle. **Doing**: nothing. **Todo**: INF-7/INF-8 measure its absence as 26 declared-floor
  rows, byte-identical to 2.7.12 (14/14, 12/20).
- **`PLAN_CONSISTENCY_CHECK.md`** — DESIGN, approved in outline, not built as a service (row 151) —
  unchanged. Detection stays live at the chat layer.
- **`PLAN_EMBEDDINGS.md`** — design only, banner exactly true, unchanged — every similarity mechanism
  in `src/` is still a closed table. A research horizon.
- **`PLAN_REPO_INDEX.md`** — RESEARCH/DESIGN, not implemented, unchanged. No parser dependency, no
  `extract_ast*` file, no `tmct index` verb — matches its own stated baseline exactly.
- **`PLAN_MUD.md`** — RESEARCH/DESIGN, not implemented, unchanged. No `server:` memory-backend branch.
- **`PLAN_PARAPHRASE_VERIFICATION.md`** — RESEARCH/DESIGN, general verifier not built, unchanged. The
  one narrow slice already shipped (`verifySubClassParaphrase`) is confirmed still present.
- **`PLAN_NLU_BENCHMARKS.md`** — RESEARCH/DESIGN, nothing live, unchanged. Its own "as-is estimate"
  section cited stale counts (15 registry capabilities, a "22-tool declared surface", "~790 rows
  across 11 JSONL lanes") — corrected this commit (§5 below) to 16 capabilities, 25 declared tools,
  15 lanes / 1101 rows / 531 keys.
- **Newly archived since `f659e4a`** — `PLAN_CLASS_QUERY.md` (archived with a fresh code trace,
  `373c850`), `PLAN_SIX_EASY_PIECES.md` (ARCHIVED 2026-07-21, delivered in full across 2.9.1-2.9.5:
  the header fix, teach-lane narrowing, the capped `init:xl` seed, live-Wikipedia learn-on-miss, the
  sqlite-default backend switch, IndexedDB persistence, the download-progress statusline, the shared
  wink vendor/precompression/service worker, the sprites generator, the spider-fly layout rework and
  adventure visual redesign, the standalone `--render` exports), `PLAN_GAMES_UPLIFT_V3.md` (Parts
  A-C shipped, Part D — Playwright coverage — landed as the 35-state screenshot sweep this window),
  `PLAN_GAMES_UPLIFT_V2.md` (moved from a stale root banner at 2.7.12 to a properly archived SHIPPED
  banner this cycle — its own §13 "still open" items were not independently re-verified this audit;
  flagged for a future cycle rather than asserted closed).

## 4.4 Non-benchmarked capabilities

Real, shipped work no benchmark scalar reaches — the section that matters most this cycle, since
three of the four benchmarks report zero movement while 370 commits landed.

- **The consent-explicit Wikipedia research lane** (row 213): a bounded autonomy surface with no
  keyed corpus row and no benchmark seat. Adapter/service/e2e tested only.
- **The Electron desktop shell and the browser IDE code explorer** (rows 216-217): a materially new
  way to reach tmct's existing code-graph reading capability, seed-aware, at IDE scale. `test:electron`
  is deliberately kept out of the hermetic `npm test` run (needs a real binary launch).
- **The memory backend's default flip to sqlite** (row 207): a durability and default-behaviour
  change no single-turn grade captures — every fresh session now opens a real SQLite store instead
  of a flat JSON file, with no product-facing signal that anything changed.
- **Browser session persistence via IndexedDB, and transcript export/print** (rows 214-215): session
  quality across a page reload, not something any single-turn benchmark scores.
- **The adventure and spider-fly deep-mechanics waves** (rows 220, 222), each anchored by five
  playtest edge-hunt rounds (process row 193, "the second edge-hunt") that found and fixed real bugs
  no scripted benchmark case would have hit (a stale goal line after a same-tick death, mass
  transferred a tick late, a double-eat crediting only the last fly, an is-objective marker leaking
  into player-visible text).
- **The sprite-library expansion** (row 224): a large graphics-asset investment across both games'
  pages, with its own template-integrity tests but no chat-behavior scalar.
- **The screenshot drift guard and the per-push CI tier split** (row 219): estate/process properties,
  the same category as the ask-bundle drift guard (row 131) — real, checked, not benchmark-visible.
- **The reference-pack and browser-bundle build pipelines** (rows 163-164, carried) — unchanged.
- **The dialogue-act ontology co-declaration** (row 139, carried) — unchanged.
- **The roll machinery** (row 173, carried) — held clean this cycle; the ask-bundle drift 2.7.12 left
  red is confirmed rebuilt and green at this pin.
- **Determinism and cost.** $0 per turn, byte-identical on rerun, re-verified in the INFERENCE report
  this cycle; the new spider-fly mechanics (carrying, deception, eggs) stay seeded for the same
  reason the ecology-v2 work did at 2.7.12.
- **The `Canonical:` line** (row 129, carried). Still the product's best self-diagnostic.

## 5. `PLAN_AGENTS.md` — refreshed

Walked against this audit's status table, per `SKILL_CAPABILITIES_AUDIT.md` §5. `PLAN_AGENTS.md` was
already re-baselined one day before this audit (2026-07-22, against v2.10.5), so most of its ground
truth was already current; corrections applied in this commit:

- **§2.5's tool count** — was already accurate at "25 declared tools... 3 hot... 22 cold"; no change
  needed, confirmed live (`TOOL_DEFINITIONS.length === 25`).
- **§2.2/§2.9's benchmark citations** — `BENCHMARK_AGENT_2.7.12.md`/`BENCHMARK_INFERENCE_2.7.12.md`
  references updated to `BENCHMARK_AGENT_2.11.0.md`/`BENCHMARK_INFERENCE_2.11.0.md`; the cited
  figures (68/68, 0% hallucination/fabrication) are unchanged, since both reports are byte-identical
  to their 2.7.12 predecessors — only the version string needed correction.
- **§2.9's `CAPABILITIES_2.7.12.md` pointer** — updated to this document, per
  `SKILL_CAPABILITIES_AUDIT.md` §5's own instruction that the newest audit is the ground truth this
  plan's baseline follows.
- **A new registry-gap note added to §2.5** — the two tools shipped since the last baseline
  (`tmct_ingest`, `tmct_export`) are declared and dispatched but sit outside the capability registry,
  the same shape `tmct_related` had before its 2.7.12 fix; not itself a gap this plan's target names,
  but worth a one-line pointer since §2.2 already documents the registry/exclusion-list contract.
- **Every cited `src/` path re-checked and resolves** — no renames since the 2026-07-22 re-baseline.
- **Status block vs. body** — no contradiction found.

`PLAN_NLU_BENCHMARKS.md` corrected in the same commit, per §3(b): its "as-is estimate" section cited
15 registry capabilities and "a 22-tool declared surface" — both stale; corrected to 16 and 25. Its
test-estate section cited "~790 rows across 11 JSONL lanes (793 measured 2026-07-17)" — corrected to
the current 15 lanes / 1101 rows / 531 keys, with the same "treat any row count here as a snapshot"
framing preserved.

## 6. Summary — real counts, grepped

Counts obtained by `awk -F'|'` over the Status column of every status table above, not eyeballed.
Two different numbers matter here and this audit reports both rather than picking one:

- **The numbered range is 1-230** (206 carried from `CAPABILITIES_2.7.12.md` — its own sequence has
  no #63 and merges 21/24 — plus 24 new at #207-230).
- **The physical row count in this document's tables is 208.** The gap is deliberate: rows 174-206
  (33 numbered capabilities, all `implemented`, all unchanged this cycle and already fully detailed
  in `CAPABILITIES_2.7.12.md`) are presented as 13 compacted summary lines rather than re-transcribed
  individually, per `SKILL_CAPABILITIES_AUDIT.md` §8's "restate the status with one citation and move
  on" guidance for unchanged rows. Every one of those 33 numbers was still individually re-checked
  for continued existence (§0's 124-path existence sweep covers this range) — the compaction is
  presentational, not a skipped verification.

**208 physical table rows**, `awk -F'|' '{print $4}'` over every data row, categorized:

| Status | Rows |
|---|--:|
| `implemented` (incl. sub-variants: opt-in, on-by-default, extended, deepened, estate-guarded, gated-out-of-`npm test`, in a sibling repo, library-level) | **179** |
| `partial` (incl. the new registry-gap caveat, row 210) | 10 |
| `claimed-only` (incl. research-horizon and documented-decline sub-variants) | 14 |
| `absent` | 2 |
| `reverted` | 1 |
| retired / process change | 2 |
| **total** | **208** |

179 + 10 + 14 + 2 + 1 + 2 = 208, matching the physical row count exactly.

Mapped back to the 1-230 numbered range: 172 carried rows 1-173 (171 physical lines, #63 skipped,
21/24 merged as one line — same convention 2.7.12 used), 33 carried rows 174-206 (13 compacted
lines, all `implemented`, unchanged), 24 new rows 207-230 (24 physical lines: **23 `implemented`, 1
`partial`** — row 210's registry-gap caveat is the only new row that isn't a clean `implemented`). No
carried-forward row moved OUT of `implemented` this cycle; the one genuine bucket question (row 131's
ask-bundle guard) was already `implemented` at 2.7.12, with an operational caveat now resolved rather
than a status that needed to move.

### What flipped since `CAPABILITIES_2.7.12.md`

**Upward** — the ask-bundle drift guard confirmed green (row 131, an operational fix, not a bucket
move), the multi-candidate ambiguity caveat closed (row 92), and `g-b2-passive-9`'s CEFR ceiling
moving from hard fail to a partial pass (row 71) — listed with evidence in *What moved since 2.7.12*
above.

**Downward** — none this cycle. A genuine difference from 2.7.12, whose one operational regression
(the ask-bundle drift) is exactly what closed this time.

**New — 24 rows (207-230).**

### The three findings this audit would lead with

1. **The engine held exactly still while the product grew around it.** AGENT and INFERENCE are
   byte-identical to 2.7.12 on every rung, band, and template; CEFR's judge instrument is unchanged.
   370 commits landed in the window and almost none of them touched `src/domain/router/` or
   `src/domain/syllogise.mjs`. This is the sharpest possible confirmation that the site/games/desktop
   wave (rows 207-230) really is additive product surface, not engine churn wearing a different name.
2. **The write-boundary bug class is now a three-cycle pattern, not a two-cycle one.** 2.7.11 named
   it, 2.7.12's audit flagged the recurrence and named the real lever (tighten admission criteria
   generally, not per-trigger), and 2.11.0's own sweep found a THIRD fresh trigger under exactly the
   prediction 2.7.12 made. The evidence for the general-fix lever is now stronger than it was a
   cycle ago, not weaker.
3. **A large amount of real, shipped capability sits entirely outside every benchmark's reach.** The
   research lane, the desktop app, the browser IDE, the memory-backend default flip, and both games'
   deep-mechanics waves are all real, tested, and invisible to AGENT/INFERENCE/CEFR/CONVERSATION as
   currently scoped. §4.4 exists precisely so "no benchmark moved" does not read as "nothing
   happened" — this cycle is the clearest case for that section this audit has produced.

`npm test`: run in the foreground for this audit, by the coordinator, before finishing —
**3992 pass / 0 fail**, exit 0. `npm run test:fast` at this pin: **188 pass / 0 fail** (re-run live
during this audit; its wall-clock ran concurrently with the full `npm test` this session, so the
number is a pass count, not a clean budget reading — re-run alone if the budget itself needs
re-checking). CLI smoke (`printf 'hi\n/exit\n' | node bin/tmct.mjs`) greets and exits 0, re-run live.
