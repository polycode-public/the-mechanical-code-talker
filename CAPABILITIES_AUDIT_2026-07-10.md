# CAPABILITIES_AUDIT_2026-07-10.md — tmct capability audit

**Snapshot taken at commit `0b730ad` ("feat(memory): declarative SHACL-style ingest gate for the
memory graph") on 2026-07-10, DURING an in-progress multi-track session.** Commits kept landing
while this audit was being written — by the time of writing, HEAD had already moved to `71647c2`
("feat(completions): Stage 2 — extractive sentence ranking"), and the working tree carried further
*uncommitted* in-flight changes (`src/interpret/pipeline.mjs`, a new
`src/interpret/strategies/constructions.mjs`, `data/templates/constructions/` — apparently an
advanced-grammar construction-template track being built live). **Some claims below will be stale
within hours; this doc is expected to get a refresh pass once the session's remaining tracks
(Track B stage 4/5, Track G stage 1/3, and a final docs sync) land.** Per the audit's own
instructions, the survey is pinned to `0b730ad` and was not re-run against the moving target; a
handful of post-pin commits that were incidentally observed while grepping the working tree are
called out explicitly, not silently folded in.

This audit was built by: reading every `.md` file in the repo root and `archive/`, `README.md` and
`ROADMAP.md` in full, `package.json`'s `homepage` (reachable, confirmed live) and the npm registry
page (blocked by a 403, not a real 404 — noted honestly, not guessed), then verifying every
extracted capability claim against the actual code (`src/`, `bin/`, `test/`, `corpus/`, `data/`,
`agentbench/`, `chatbench/`, `infbench/`) via direct file reads and greps, plus two research forks
that surveyed `archive/*.md` and the `*BENCH*.md`/`SKILL_AGENT_*.md`/`SECURITY.md` doc set in
parallel. `npm test` was **not** run for this audit (the working tree has several uncommitted,
in-flight edits to test files from concurrent tracks — running the suite mid-edit would not have
produced a trustworthy signal, and could have raced another track). All status calls below rest on
file:line evidence or a specific test file's existence, per the audit's own ground rules.

---

## 1. Status table

One row per distinct capability, deduped. **Status key:** `implemented` (built, wired into a
user-facing or engine-facing path, tested) · `partial` (some sub-pieces built/wired, real
documented gaps) · `undocumented` (built and working, but no doc in the Step-1 survey mentions it)
· `claimed-only` (named in a doc, not built).

| # | Capability | Status | Realizing plan doc | Evidence |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline (grammar/keyword/noise-strip/fuzzy, same-class merge, distinct-class "if you mean X" surround) | implemented | ROADMAP.md Item 8 | `src/interpret/pipeline.mjs`, `merge.mjs`, `strategies/{ace,grammar,keywords,noise-strip}.mjs`; `test/interpret.test.mjs`, `test/interpret-ace-strategy.test.mjs` |
| 2 | ACE-inspired controlled-English grammar → OWL triples (~8 patterns) | implemented | ROADMAP.md Item 2 | `src/grammar/ace.mjs`, `src/grammar/lexicon.mjs`; `test/grammar-ace.test.mjs`, `test/grammar-lexicon.test.mjs` |
| 3 | ACE-OWL parser extracted to standalone MPL-2.0 npm package | implemented (post-pin) | ROADMAP.md "Open-source the ACE-OWL parser"; `PLAN_OSS_ACE_PARSER.md` (archived) | `packages/ace-owl/{src,test,package.json}` — landed at commit `c57adbe`, **one commit after** the pinned sha; included here as an observed-drift note, not part of the pinned survey |
| 4 | OWL 2/RDF/RDFS + SEON core ontology grounding | implemented | ROADMAP.md Item 3 | `ontology/tmct-core.ttl` (335 lines) |
| 5 | Template libraries / response phrase book (data-driven, JSONL/TOML) | implemented | ROADMAP.md Items 4+7 | `src/corpus/templates.mjs`, `data/templates/` |
| 6 | Filtered ConceptNet corpus slice (CC-BY-SA 4.0) | implemented | ROADMAP.md "ConceptNet corpus slice" | `corpus/conceptnet/`, `src/corpus/conceptnet.mjs`; `test/corpus-conceptnet.test.mjs` |
| 7 | Conversational memory as its own OWL-labelled graph (Utterance/Fact/Session) | implemented | ROADMAP.md Item 9 | `src/memory/core.mjs` (1247 lines), `blocks.mjs`, `fold.mjs`; `test/memory-core.test.mjs`, `test/memory-fold.test.mjs`, `test/memory-blocks.test.mjs` |
| 8 | Input normalization pass (preamble/subordination/conditional frame stripping, contraction handling) | partial | ROADMAP.md Item 10 | `src/interpret/normalize.mjs` (subordination/conditional stripping real and tested — `test/chatflow-tier6.test.mjs`); a full grammar/spell/style-check triad per Item 10's original scope is not built — only the normalization half exists |
| 9 | Graph-provider adapter contract (Repository Interface, versioned, OWL-grounded, 15 services) | implemented | ROADMAP.md Item 14; Phase 8; `archive/PLAN_REPOSITORY_INTERFACE.md` | `src/repository-interface.mjs` (`INTERFACE_VERSION = "1.1.0"`), `src/providers/{graph-service,fixture,bootstrap}.mjs`, `docs/repository-interface.md` + `.schema.json` |
| 10 | Runnable conformance/compatibility test suite for RI providers | implemented | Phase 8 | `src/conformance.mjs` (`assertIndividual`, `assertEdge`, `assertResult`, `runConformance`); `test/repository-interface.test.mjs` |
| 11 | Library-first design — stable, documented `exports` map | implemented | ROADMAP.md Item 16 | `package.json` `exports` (13 entry points: chat, ask, relationKind, dispatchTool, fetchEntities, repository-interface, graph-service, providers/*, conformance) |
| 12 | Ink console TUI shell (full-screen, no build step) | implemented | ROADMAP.md Phase 1 "Shell work" | `src/tui/app.mjs` (252 lines), invoked from `bin/tmct.mjs:302`; `test/tui.test.mjs` (265 lines) |
| 13 | Calculation surfaced as reasoning (counts/comparisons via templates) | implemented | ROADMAP.md Item 5; Phase 6 | `src/corpus/templates.mjs`, `via:"template"` provenance throughout `src/chat.mjs` |
| 14 | Optionally running linters/tests to observe (item 6) | claimed-only | ROADMAP.md Item 6 | No `runLinter`/child-process-test-execution code found anywhere in `src/`; never mentioned again after the original ROADMAP item |
| 15 | Formal logical reasoning via Prolog/Progol (ILP, learning new inference rules) | claimed-only (deliberately) | ROADMAP.md Item 11 | `PLAN_INFERENCE_TESTING.md` and `PLAN_CODE.md` both explicitly say this door is "a separate far spike…already looked at and left shut" — a deliberate non-build, not an oversight |
| 16 | Response-finishing grammar pass over segmented (protected-span) answers | partial | ROADMAP.md Phase 7; `archive/PLAN_RESPONSE_FINISHING.md` | `src/finish.mjs`; `test/finish.test.mjs`, `test/segments.test.mjs`. The a/an article-selection rule is live; broader voice/agreement rules are implemented but parked (not measured as levers) |
| 17 | `tmct init` onboarding CLI (scaffold `.tmct/`, `tmct.toml`, tier-1 seed, provenance) | implemented | Phase 8 deliverable 5 | `bin/tmct.mjs` `init` mode; `test/init.test.mjs`, `test/init-cli.test.mjs` |
| 18 | Speculative inference batch (`tmct syllogise`, bounded `rdfs:subClassOf` forward-chain) | implemented | ROADMAP.md Phase 9; `archive/PLAN_SPECULATIVE_INFERENCE.md` | `src/syllogise.mjs` (`deriveSubClassClosure`, `deriveTypePropagation`); `test/syllogise.test.mjs`; `bin/tmct.mjs` `syllogise` mode |
| 19 | `cax-dw` disjointness entailment rule (unlocks INFBENCH INF-B1) | implemented, **not yet re-measured** | `PLAN_INFERENCE_TESTING.md` stage 3 | `src/syllogise.mjs:83-94` (`deriveDisjointViolations`, `CAX_DW_RULE`, `DISJOINT_PREDICATE`); `test/syllogise.test.mjs:130-200` (9+ cases incl. ⊑-lift, multi-hop, dedup/novelty). Landed at commit `d9a4f82`, an ancestor of the pin. **The latest `INFBENCH_1.3.1.md` predates this commit** — INF-B1's 33%-completion gate has not been re-measured against it. See §2 caveat below |
| 20 | `cax-sco` type-propagation entailment rule | implemented | `PLAN_INFERENCE_TESTING.md` stage 2 | `src/syllogise.mjs` `deriveTypePropagation`; confirmed closed in `INFBENCH_1.2.0.md` (chat/INF-A2 → 100%) |
| 21 | Bounded live proof-chain chase in chat (entailment rendered with derivation) | implemented | `PLAN_INFERENCE_TESTING.md` stage 2 half | Cited in `SKILL_BENCHMARK_INFERENCE.md` §3 as already shipped ("a bounded live proof-chain chase in `src/chat.mjs`") |
| 22 | Proof-chain materialization / cardinality entailment / consistency checking (INF stages 4-5) | claimed-only | `PLAN_INFERENCE_TESTING.md` §4 | No `consistency`/cardinality-entailment code found in `src/syllogise.mjs`; explicitly staged after stage 3 (`cax-dw`), which itself is only just implemented and unmeasured |
| 23 | Unified provenance/trust primitive (`Source` individuals, `mgx:derivedFrom`/`statedBy`/`canonicalisedFrom`, deterministic `computeTrust`) | implemented | ROADMAP.md "Provenance & trust"; `archive/PLAN_PROVENANCE_TRUST.md` | `src/memory/trust.mjs`; `test/trust.test.mjs`, `test/provenance.test.mjs` |
| 24 | Actor-level, session-scoped source trust (`mgx:sourceReliability`, Laplace/add-k confidence scaling) | implemented | `PLAN_AGENTS.md` §2.1 | `src/memory/trust.mjs:70-188` (`sourceReliabilityOf`, `SOURCE_PRIOR[t] * sourceReliabilityOf`); `test/memory-source-reliability.test.mjs` |
| 25 | Memory-tree versioning (`snapshotMemory`, `graph.v{N}.json` + manifest) | implemented, manual-trigger only | `PLAN_AGENTS.md` §2.1 | `src/memory/core.mjs:211` (`export async function snapshotMemory`); `[memory] retention_versions` in `src/toml-config.mjs:147-155`; `test/memory-versioning.test.mjs` (9 tests) |
| 26 | Automatic, deterministic contradiction detection (`findContradictions`) | implemented | ROADMAP.md provenance section | `src/memory/core.mjs:1232` (`export function findContradictions`) |
| 27 | Hub-dampened memory-fact ranking (`retrieveBlocks`, `/√(1+degree)`) | implemented, on by default | `PLAN_AGENTS.md` §2.1/§2.3 | `src/memory/blocks.mjs:124` (`degreeOf`), `:249` (`sqrt(1 + degree)` in the score formula) |
| 28 | Extension-pack / corpus-lexicon loading seam (`[extensions]`/`[bias]` in `tmct.toml`, `tmct extend --validate`) | implemented | `PLAN_AGENTS.md` §3 | `src/extensions.mjs` (358 lines, `resolveExtensions`, `seedActiveCorpusEntries`); `bin/tmct.mjs:440` (`mode === "extend"`); `test/extensions.test.mjs`, `test/extend-validate.test.mjs` |
| 29 | Bias-weighted ambiguity resolution (`tmct.toml` `[bias]`, `rankByBiasThenTrust`) | implemented | `PLAN_AGENTS.md` §4 | `src/memory/bias.mjs` (77 lines); `test/bias-weighting.test.mjs` |
| 30 | `tmct init --with-persona <name>` | implemented | `PLAN_AGENTS.md` §4 | `bin/tmct.mjs:52,356-365` (`--with-persona` flag, unknown-persona error handling) |
| 31 | Tier-2 general-knowledge corpus bundle (`tier2-general`) shipped and activatable | implemented | `PLAN_AGENTS.md` §4 | `corpus/tier2/general.jsonl` + `manifest.json`; `src/extensions.mjs:94-98` registers it as a builtin |
| 32 | A wider general-knowledge seed set actually grown beyond the tier2 bundles | claimed-only | `PLAN_AGENTS.md` §4 | The mechanism to activate wider seed sets exists (#31); nobody has grown the corpus content itself further, per `PLAN_AGENTS.md`'s own "◐ partially realized" framing — consistent with what's on disk |
| 33 | Context-preserving unknown-word ingestion (co-occurrence passages as provenance) | **implemented — contradicts `PLAN_AGENTS.md`'s own "not built" claim** | `PLAN_AGENTS.md` §4 | `src/corpus/unknown-ingest.mjs`, whose own header literally cites "PLAN_AGENTS.md §4 Phase 1, the 'still not built at all' bullet" as the gap it closes. Landed at commit `b670987`, an ancestor of the pin — **the plan doc text itself is stale as of the pinned sha**, not just "will go stale later" |
| 34 | SHACL-style declarative ingest gate for the memory graph | **implemented — contradicts `PLAN_AGENTS.md`'s "not started" claim** | `PLAN_AGENTS.md` §2.1 ("Declarative SHACL ingest gate (c)") | `ontology/memory-shapes.ttl` (documentation) + `src/memory/shacl.mjs` (hand-rolled JS validator, not `shacl-engine` — a deliberate dependency-weight decision recorded in the `.ttl` file's own header) wired into `appendFact`/`appendRule` (`src/memory/core.mjs:754,949`, `assertIndividualValid` called before every write); `test/memory-shacl.test.mjs`. **This is the pinned commit itself** (`0b730ad`) |
| 35 | Cross-repo HTTP smoke test (`tmct serve` hit over real HTTP) | **implemented — contradicts `PLAN_AGENTS.md`'s "not started" claim** | `PLAN_AGENTS.md` §3 | `test/server-http-smoke.test.mjs`. Landed at commit `c4517bf`, an ancestor of the pin |
| 36 | Machine-readable capability envelope (`agentbench/envelope.json`) | **implemented — contradicts `PLAN_AGENTS.md`'s "not started" claim** | `PLAN_AGENTS.md` §3 | `agentbench/envelope.json` (96 lines, populated: `generatedFrom.agentbenchVersion: "1.4.1"`, ladder rungs, driver list). Same commit as #35 |
| 37 | Ontology-hierarchies tracks a+b (ConceptNet `/r/Synonym`+`/r/SimilarTo` query-time expansion, phrasebook synonym wiring) | **implemented — contradicts `PLAN_AGENTS.md`'s "not started" claim** | `PLAN_AGENTS.md` §3; `archive/PLAN_ontology-hierarchies.md` | Confirmed shipped *before* `PLAN_AGENTS.md` was even drafted, per commit `7ea5a3c`'s own message: "turned out to already be shipped and tested (commit `590f92d`, predating this dispatch)". `SYNONYM_DENYLIST` precision fix at `src/chat.mjs:3379` |
| 38 | Ontology-hierarchies tracks c+d (SEON upper-ontology spine, `owl:disjointWith` growth) | **implemented — contradicts `PLAN_AGENTS.md`'s "not started" claim** | `PLAN_AGENTS.md` §3 | Commit `30aa914` ("SEON upper-ontology spine + owl:disjointWith growth"), an ancestor of the pin |
| 39 | Advanced-grammar track: subordination/conditional preamble frames | implemented, but **may predate and be distinct from** `PLAN_ADVANCED_GRAMMAR.md`'s specific track lettering | `PLAN_AGENTS.md` §3 ("advanced-grammar tracks a/d/f — not started") | `src/interpret/normalize.mjs:358-537` (closed, delimiter-anchored subordination/conditional stripping); exercised by `test/chatflow-tier6.test.mjs`. **Uncertain**: whether this satisfies archived `PLAN_ADVANCED_GRAMMAR.md`'s literal tracks (a)/(d)/(f) definitions couldn't be fully confirmed against that doc's own track table in the time available — flagged honestly rather than guessed |
| 40 | Advanced-grammar: construction-grammar template bank | **in-flight, uncommitted** at time of writing | `PLAN_AGENTS.md` §3 | `src/interpret/strategies/constructions.mjs` and `data/templates/constructions/` exist as untracked files in the working tree; `src/interpret/pipeline.mjs:37` has an uncommitted reference to it. Not part of the pinned commit — a track was visibly landing this live as the audit was written |
| 41 | Chat-taught relations & rules — all 6 items (fact teach, alias/union, `compose2`, `filter`, `recursive`, reverse-"who") | implemented, fully | `PLAN_TAUGHT_RELATIONS.md` (archived, absorbed into `PLAN_AGENTS.md` §1.2) | `src/chat.mjs:1402-3480` (`RELATION_FACT_TEACH_RE`, `COMPOSE2_RULE_TEACH_RE`, `FILTER_RULE_TEACH_RE`, `RECURSIVE_RULE_TEACH_RE`, `RELATION_FACT_YESNO_RE`, `RELATION_WHO_ASK_RE`); `src/memory/core.mjs:48,919,967` (`RULE_CLASS`, `appendRule`, `findRuleByName`); `test/chat-taught-relations.test.mjs` (26 tests) |
| 42 | `findActionPath` (bounded on-demand-successor BFS) | implemented, proven on a toy graph, **not wired to any real domain** | `PLAN_HANOI.md` Phase 2 kernel | `src/planning.mjs:94` (`export function findActionPath`); `test/planning.test.mjs` |
| 43 | `findReachableSet` (reachability-set enumeration kernel) | implemented, wired into chat (recursive-rule reachability query, item 41) | `PLAN_TAUGHT_RELATIONS.md` Phase 6 | `src/planning.mjs:199` (`export function findReachableSet`); used by `RECURSIVE_LIST_ASK_RE` in `src/chat.mjs` |
| 44 | Towers-of-Hanoi goal-directed planning loop (state-as-facts, `legalMoves`, chat-turn wiring) | claimed-only | `PLAN_HANOI.md` | Doc's own header: "Status: RESEARCH/DESIGN — not yet implemented." No `restsOn`/`legalMoves`/`boardToFacts` code found anywhere in `src/` |
| 45 | "I am thinking of a number" closed-loop game (guesser/thinker modes) | claimed-only | `PLAN_GUESS_NUMBER.md` | Doc's own header: "Status: RESEARCH/DESIGN — not yet implemented." No `game` session-state slot found in `src/chat.mjs`'s `createSession`/`runTurn` |
| 46 | Program synthesis Track 1 — `GOAL_RULE`/`PHRASING_FRAMES` synthesis (enumerative + CEGIS) | implemented, per the plan's own status banner | `PLAN_CODE.md` §1 | Doc's own status banner: "Track 1 ✅ SHIPPED — all 5 staged units (`synthbench/`)"; `synthbench/` directory exists in the repo root listing |
| 47 | Program synthesis Tracks 2-4 (bounded mutation repair, JS/HTML/CSS synthesis via Playwright sandbox) | claimed-only, explicitly sign-off-gated | `PLAN_CODE.md` §2-§8 | No `playwright` dependency in `package.json`; doc's own banner: "Tracks 2-4 remain unsigned-off and untouched" |
| 48 | Mechanical text-generation pipeline Stage 0 (broad search + connected-components grouping) | implemented, standalone harness | `PLAN_COMPLETIONS.md` | `src/completions/search.mjs`, `src/completions/group.mjs`; `test/completions-stage0.test.mjs`; landed commit `c350411` |
| 49 | Mechanical text-generation pipeline Stage 2 (extractive PageRank+IDF sentence ranking) | implemented (post-pin), standalone harness | `PLAN_COMPLETIONS.md` | `src/completions/rank.mjs` (154 lines); `test/completions-stage2.test.mjs`. Landed at `71647c2`, **after** the pinned sha |
| 50 | Mechanical text-generation pipeline — wired into chat / a user-facing answer path | claimed-only (not yet) | `PLAN_COMPLETIONS.md` | `grep -rn "completions/(search|group|rank)" src/*.mjs bin/*.mjs` returns nothing outside `src/completions/` itself and one comment in `src/prose.mjs`; no `index.mjs`/`package.json` export; the pipeline is a standalone dev harness today, not reachable from any chat turn |
| 51 | Capability router — full 6-stage stack (registry, resolver, planner, guardrail, goal-reasoner, call-validator/set-algebra) | implemented | `archive/PLAN_CAPABILITY_ROUTER.md`, absorbed into `PLAN_AGENTS.md` §1 | `src/router/{registry,resolver,planner,guardrail,goal-reasoner,call-validator,set-algebra}.mjs`; measured on AGENTBENCH (§3 below) |
| 52 | `POST /v1/messages` Anthropic-Messages-API-compatible HTTP shim | implemented, since 0.8.0 | `PLAN_AGENTS.md` §1 table | `src/server-http.mjs` (`createServer`, route dispatch); `bin/tmct.mjs` `serve` mode; `test/server-http.test.mjs` |
| 53 | bedrock-meter $0-rung routing integration | implemented **in the sibling `bedrock-meter` repo**, not this one | `PLAN_AGENTS.md` §1 table, Phase A extension | Cited as "shipped and tested" with file paths in the *other* repo (`router.mjs`/`router-ladder.mjs`); no code for this exists inside `the-mechanical-code-talker` itself — correctly scoped as an external integration, not a local capability |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md` §8 (Phase 5) | Sequencing table (§11) explicitly marks this "Not started" |
| 55 | `seon-mcp` (marginalia) provider adapter | claimed-only | `PLAN_AGENTS.md` §5 (Phase 2) | Sequencing table marks Phase 2 "Not started" |
| 56 | marginalia "mechanical chat" replacement by tmct | claimed-only | `PLAN_AGENTS.md` §5 (Phase 2) | Same — explicitly "the real open work," not started |
| 57 | tmct × seonix combined codebase index (mount seonix's multi-language graph) | claimed-only | `PLAN_AGENTS.md` §6 (Phase 3) | Sequencing table marks Phase 3 "Not started" |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md` §7 (Phase 4) | Sequencing table marks Phase 4 "Not started" |
| 59 | RI wrapper fixes (ranked `search()`, real `context()`, depth-capped `impact()`, source-backed `snippet()`, `edges()`/`search()` pagination) | implemented, v1.4.0 | `PLAN_AGENTS.md` §2.2/§3 | `src/providers/graph-service.mjs`; `INTERFACE_VERSION` bump to 1.1.0 (`src/repository-interface.mjs:21`) is the documented, deliberate contract change |
| 60 | Path-traversal guard on graph-derived file reads (`readSpanSafe`) | implemented | `PLAN_AGENTS.md` §2.2, §13 (found by the strategy-advisor during the v1.4.0 build) | `src/source-slice.mjs:1-40` (`resolve()`-based containment check before any injected `readFile` call); `test/source-slice.test.mjs` |
| 61 | Telemetry wrapper on every RI service (redacts `snippet()` bodies) | implemented, but **not exercised by the live chat dispatch path** | `PLAN_AGENTS.md` §2.2 | `src/telemetry.mjs` (93 lines); `test/telemetry.test.mjs`. `server.mjs`'s `dispatchTool` was deliberately *not* consolidated onto the wrapped `svc.*()` methods — real, tested, but currently reachable only from direct RI callers/tests |
| 62 | Chronograph-style temporal diffing (validity-interval graph model, structural diffs across commits) | claimed-only, genuinely hard | `PLAN_AGENTS.md` §2.2 | No validity-interval or diff code in `src/`; `history(id)` RI service remains a one-hop lookup, per the doc's own honest assessment |
| 63 | Multi-language AST extraction inside tmct's own `graph-build.mjs` | **explicitly out of scope, permanently** (a scope decision, not a gap) | `PLAN_AGENTS.md` §2.2, §13 | Doc's own top banner: "multi-language AST extraction…stays in seonix, permanently"; `src/graph-build.mjs` does no parsing, by design |
| 64 | Dialogue-flow playtest ladder, Tiers 0-6, frozen as regression transcripts | implemented, complete | `SKILL_BENCHMARK_PLAYTEST.md`; ROADMAP.md "Where we are now" | `test/chatflow-tier{0,1-single-touch,2,2-drilldown,4,5,6}.test.mjs`, `test/chatflow-drilldown.test.mjs`, `test/chatflow-history.test.mjs`, `test/showcase.test.mjs` |
| 65 | CHATBENCH graded-pool ladder (CEFR-banded, dual-draw, stratified sampling) | implemented | `SKILL_BENCHMARK_CHAT.md`; ROADMAP.md Phase 3 | `chatbench/`, `chatbench/graded-pool.jsonl`; `test/chatbench-graded.test.mjs`, `test/chatbench-levers.test.mjs` |
| 66 | AGENTBENCH agentic ladder (A0-C2 rungs, plan/result-completion + hallucination gate) | implemented, C2 rule-general | `SKILL_BENCHMARK_AGENT.md`; ROADMAP.md Phase 11 | `agentbench/`; `test/agentbench.test.mjs` |
| 67 | INFBENCH classical-logic ladder (INF-A1…C2, kernel + chat drive points) | implemented, currently gated at INF-B1 pending re-measure (see #19) | `SKILL_BENCHMARK_INFERENCE.md`; `PLAN_INFERENCE_TESTING.md` | `infbench/{generate-cases,run,grade}.mjs`; `npm run infbench` in `package.json:94` |
| 68 | Strategy-advisor background-agent watch process | implemented (process, not code) | `SKILL_AGENT_STRATEGY_ADVISOR.md` | `STRATEGY_ADVISOR.log` present at repo root, append-only tick log; currently itself uncommitted-modified (`M STRATEGY_ADVISOR.log`), consistent with a live in-progress tick |
| 69 | Segmentation IR + concept force (3-band vague-query answers: definition/examples/guided follow-up) | implemented | ROADMAP.md Phase 10 | `src/concept.mjs`; `src/finish.mjs`; `test/concept.test.mjs` |
| 70 | Negation as bounded set complement ("which X do not...") | implemented | ROADMAP.md Phase 5 (B1 lever 1) | `src/router/set-algebra.mjs`; `test/ask-negation-passive.test.mjs` |
| 71 | Reversible-passive traversal ("is imported by") | implemented | ROADMAP.md Phase 5 (lever 2) | `test/ask-negation-passive.test.mjs` |
| 72 | Compound-name / multi-word resolution in `resolveObject` (`src/ask.mjs`) | implemented | HANDOVER.md "Compound-name resolution" | `test/ask-compound-resolve.test.mjs` (7 cases) |
| 73 | Same compound-symbol matching extended to `/describe`'s resolver (`resolveSymbol`, `codegraph.mjs`) | claimed-only (explicit, named gap) | HANDOVER.md open follow-up #5 | `resolveSymbol` in `src/codegraph.mjs` remains the separate, stricter, pre-existing resolver — not yet sharing `resolveObject`'s tiered scoring |
| 74 | Reverse-`inherits` verb family's "the"-definite forms ("is the superclass of") | claimed-only (explicit, named gap) | HANDOVER.md open follow-up #3 | Not wired into `VERB_TO_KIND`; doc explains the blocker (a CONTENT_VOCAB fix needed first) |
| 75 | Cochange phrasing variants + the un-reverified "multi-root" substring over-match (Seonix Batch 4/5 remainder) | claimed-only (explicit, named gap) | HANDOVER.md open follow-up #4 | Named as still open in both `ROADMAP.md` and `HANDOVER.md`; no contradicting code found |
| 76 | Bounded (N+1) goal recognition (symbolic, deterministic, N declared goals + reject class) | claimed-only, research-horizon | `PLAN_AGENTS.md` §9 (R1) | Explicitly: "Not published or built anywhere this research found... the capability router's own next spike to scope" |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md` §9 (R1) | Not started, no code |
| 78 | Winograd-hard commonsense coreference resolution | claimed-only, deliberately out of reach | `PLAN_AGENTS.md` §9 (R3); `archive/PLAN_ADVANCED_GRAMMAR.md` track (g) | Explicitly framed as possibly unsolvable in the general case, not a build target |
| 79 | A shared ~2M-word cross-domain general+technical ontology | claimed-only, explicitly "record, not commit" | `PLAN_AGENTS.md` §9 (R3) | No such ontology or merge pipeline exists; doc frames this as an open question, not a plan |
| 80 | `dispatchTool` MCP-server-era tool switch (survives as plain internal dispatch, MCP SDK removed) | implemented | ROADMAP.md Phase 0 | `src/server.mjs`; `@modelcontextprotocol/sdk` absent from `package.json` dependencies |
| 81 | Supply-chain hardening: SAST + secret detection (non-blocking), nightly `npm audit`+OSV-Scanner (blocking), npm-provenance publish | implemented | `SECURITY.md`; README.md "Security and supply chain" | `.gitlab-ci.yml:16-106` — `Security/SAST.gitlab-ci.yml`/`Security/Secret-Detection.gitlab-ci.yml` templates included, `dep:audit` job runs `npm run audit` + pinned `osv-scanner v2.0.2`, `npm publish --provenance` at `:106`. `SECURITY.md`'s claims verified against the actual CI config, not just doc prose |
| 82 | Predicate "find" queries (`find [me] a/the <term> <entityType>`, type-filter ∧ fuzzy property match, narrow-then-broaden cascade) | implemented | `archive/PLAN_PREDICATE_QUERIES.md` | `src/ask.mjs:331,934` (`parseFind`); `test/ask-find.test.mjs`. Matches README.md's "Finding by description" bullet exactly |
| 83 | Dependency-audit near-term actions: single-sourced `fnv1a` hash, wink browser-loader seam (unblocks Phase 8 browser mode) | implemented | `archive/PLAN_DEPENDENCY_STRATEGY.md`; ROADMAP.md "Near-term actions" | `src/hash.mjs:19,30` (`fnv1a32`, `fnv1aHex`, single-sourced); `src/wink-model.mjs` (shared `createRequire` fallback + browser registration seam, replacing per-file duplication in `ask-nlp.mjs`/`prose-nlp.mjs`) |

**Reverse-check finding (undocumented-but-real):** `src/completions/rank.mjs`'s PageRank+IDF
sentence-ranker (#49) verbatim-reuses `memory/blocks.mjs`'s `rankBlocks`/`degreeOf` at sentence
granularity — a real, tested, deliberate code-reuse decision that no top-level doc other than
`PLAN_COMPLETIONS.md` itself mentions; ROADMAP.md's "Where we are now" narrative had not yet been
updated to reference it as of the pinned sha (it's referenced only in the commit message and the
plan doc). Everything else substantial found in `src/` during this survey traced back to a doc
already covered in §1 — no other large undocumented capability turned up.

---

## 2. A caveat on the INF-B1 gate specifically

`ROADMAP.md`'s "Where we are now" and `HANDOVER.md` both describe the classical-logic ladder as
"still gated at INF-B1 (33% completion), unchanged for a fourth consecutive measured version" as of
`INFBENCH_1.3.1.md` (dated 2026-07-09 21:33). The `cax-dw` disjointness rule that ladder section
names as the specific blocker (item #19 above) is **already implemented and tested** as of the
pinned commit — but no `INFBENCH_<version>.md` newer than `1.3.1` exists in the repo, so **the gate
has not actually been re-measured against the new rule**. Read the "still gated" language in
`ROADMAP.md`/`HANDOVER.md` as itself stale relative to the pinned sha, not just relative to "now" —
this is a genuine, checkable claim that the doc text and the code have already diverged before this
audit even started, independent of the ongoing session's later tracks.

---

## 3. Benchmark feature-support — what moves each benchmark's numbers

### `SKILL_BENCHMARK_AGENT.md` (AGENTBENCH — agentic tool-routing capability, A0-C2 rungs)

- Capability registry (STRIPS/PDDL operators as facts, `src/router/registry.mjs`) — **complete**
- Resolver (unification + backward chaining, `src/router/resolver.mjs`) — **complete**
- Planner (POP/HTN decomposition, `src/router/planner.mjs`; member-filter HTN method) — **complete**
- Guardrail (validates proposed `tool_use` against declared preconditions, `src/router/guardrail.mjs`) — **complete**, but only validated against AGENTBENCH's synthetic cases, not real Claude Code `tool_use` proposals yet (`PLAN_AGENTS.md` §8 names this as remaining hardening)
- Goal-reasoner (BDI + Goal-Driven Autonomy, `src/router/goal-reasoner.mjs`, C2 rung) — **complete**, rule-general (two declared goal-rules, pure `applicableRules` deduction)
- `call-validator.mjs`/`set-algebra.mjs` (bench-import-direction correctness, zero-hallucination gate enforcement) — **complete**
- Fixture-linted case growth (`agentbench/cases.jsonl`, 56 cases as of `envelope.json`) — **complete** for the current ladder depth; growing the case set deeper is an ongoing, not a blocking, task
- Program-synthesized `GOAL_RULE` entries feeding new AGENTBENCH cases (Track 1 of `PLAN_CODE.md`) — **partial**: the synthesis harness itself is shipped, but no synthesized rule has yet been folded into the live registry/case set as new bench coverage

### `SKILL_BENCHMARK_CHAT.md` (CHATBENCH — CEFR-graded conversational quality, LLM-judged)

- Multi-strategy interpretation pipeline + ACE grammar (what the judge is scoring the output of) — **complete**
- W1-W5 wiring wave (templates→render, memory-recall→miss-path, seedMemory→bootstrap, asserted-facts→answers, corpus-on-demand) — **complete**, all five confirmed wired with `via:` provenance tags in `src/chat.mjs`
- Dual banding (productive vs. performance band, computed from `via` provenance) — **complete**
- Formulaic-competence template acquisition (Phase 6 shopping list) — **complete** for the fixed tech-domain templates already hand-picked; generalizing to corpus-mined template acquisition is **todo**
- Negation-as-set-complement + reversible-passive (the two headline B1 levers) — **complete**
- Under-covered pool growth (B1 pronoun/temporal, C1 temporal) — **todo**, explicitly deferred post-0.8.2 per ROADMAP Track 1 status
- Response-finishing grammar pass (article selection live; broader voice/agreement parked) — **partial**
- Judged re-run against the current answer-text surface (onboarding/teach-lane/relation-phrasing changes since the last judged pass) — **todo**, explicitly flagged as HANDOVER's #2 open follow-up

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH — classical-logic inference, INF-A1-C2 bands)

- `cax-sco` type propagation (unlocks INF-A2) — **complete**, confirmed 100% in `INFBENCH_1.2.0.md`
- Bounded live proof-chain chase in chat — **complete**
- `cax-dw` disjointness rule (the named INF-B1 blocker) — **partial**: implemented and unit-tested (item #19), but **not yet re-measured** on the actual INFBENCH ladder — the honest current state is "should unlock INF-B1, unconfirmed," not "unlocked"
- Proof-chain materialization (beyond the bounded live chase) — **todo**
- Cardinality entailment — **todo**
- Consistency checking (INF-C2) — **todo**
- Tier-5 full "Syllogist" (OWL 2 RL forward-chaining as a general engine, not just the two rules above) — **partial**: the two shipped rules are literally OWL 2 RL rule instances, but the doc's own framing of a general rule-table engine (vs. two hand-written rule functions) is not built

### `SKILL_BENCHMARK_PLAYTEST.md` (dialogue-flow dead-end hunting, Tier 0-6 qualitative ladder)

- Tier 0 (bootstrap/identity) through Tier 6 (the messy real user) — **complete**, all frozen as `test/chatflow-tier*.test.mjs` regression transcripts
- Surface-variation axis (dialect/register/typo/ESL/AI-identity phrasing, §2.2) — **complete**, folded into Tier 0/6 fixes per ROADMAP's "Shipped this session" narrative
- Capped sprint mode (bounded, background-sub-agent-delegated rounds) — **complete** as a documented process; no code artifact to verify beyond the skill doc itself (this is a process skill, not a product capability)
- `PLAYTESTBENCH_<version>.md` versioned write-up convention — **partial**: the convention is defined and the skill doc references it, but no `PLAYTESTBENCH_*.md` file exists in the repo root yet (the tier ladder's results are currently narrated inside `ROADMAP.md`/`HANDOVER.md` instead, predating this convention's adoption in the 2026-07-10 doc restructuring)

---

## 4. Plan feature-support — what each plan depends on from tmct's existing capability

### `PLAN_AGENTS.md` (the governing plan for tmct's next major arc)

- Repository Interface v1.0.0+ (15 services, provider seam) — **complete**, and the v1.4.0 wrapper-fix batch (item #59) already builds on it
- Extension-pack seam (`tmct.toml` `[extensions]`) — **complete**
- Bias-weighted ranking — **complete**
- Chat-taught relations/rules (Stage 0/1 prototype precedent for the capability-router generalization, §1.2) — **complete**
- SHACL ingest gate — **complete** (contra the doc's own "not started" claim — see items #33-38)
- Cross-repo smoke test + envelope.json — **complete** (contra the doc's own claim — see items #35-36)
- Multi-language AST extraction inside tmct — **N/A**, explicitly scoped out permanently (item #63)
- `seon-mcp`/marginalia/seonix-combined-index/web-scrape-teach integration phases (§5-§7) — **todo**, all four still genuinely not started; nothing in `src/` references marginalia or a SPARQL-backed provider
- GitHub Copilot / Bedrock hardening (§8) — **todo** / **partial** (Claude Code shim done; Bedrock has the routing target in the sibling repo but no live integration test per the doc's own §8)

### `PLAN_CODE.md` (program synthesis over tmct's closed DSLs)

- The trusted, in-process `goalReason`/`applicableRules` engine Track 1 verifies candidates against — **complete** (this is exactly what makes Track 1 needing "no sandbox at all," per the doc's own §5 verdict)
- `agentbench/cases.jsonl`'s labeled-example shape, reused verbatim as Track 1's case format — **complete**
- `src/router/set-algebra.mjs`'s 3 closed compose operators (the field grammar Track 1 searches over) — **complete**
- A Playwright-sandboxed execution environment (needed for Tracks 2-4) — **todo**, zero `playwright`/`vm`/sandbox dependency anywhere in `package.json`, confirmed by direct grep
- Track 1 itself (the synthesizer, the CEGIS loop) — **complete**, per the doc's own shipped-status banner

### `PLAN_GUESS_NUMBER.md` (closed-loop planning, "I am thinking of a number")

- `createSession`/`runTurn`'s `focus`/`last` closure-variable threading pattern (the precedent the doc's `game` slot would extend) — **complete**, already proven infrastructure
- `withGoalLine`'s opaque-string goal rendering (reusable as a renderer for a live-game goal string) — **complete**
- A `game` session-state slot itself — **todo**, not found anywhere in `src/chat.mjs`'s `createSession`
- Guesser-mode belief-interval bisection / thinker-mode commitment-and-compare — **todo**, no such logic exists
- The whole document is explicitly "RESEARCH/DESIGN — not yet implemented" per its own header

### `PLAN_HANOI.md` (open-loop goal-directed planning, Towers of Hanoi)

- `findActionPath` (the generic bounded state-space search kernel the plan's Phase 2 called for) — **complete**, landed ahead of the phased plan, proven on a toy graph
- `appendFact`'s content-addressed additive write model (the substrate the doc's snapshot-per-step board representation would use) — **complete**, pre-existing
- Hanoi's own `legalMoves`/`isGoal`/`boardToFacts` domain functions (Phase 1) — **todo**, doc's own follow-up note confirms "none of that exists yet"
- Chat-turn wiring (a "plan" lane in `runAsk`'s miss-cascade, Phase 3) — **todo**
- Phase 4 generalization beyond Hanoi, converging with `PLAN_GUESS_NUMBER.md` — **todo**, not reachable until Phases 1 and 3 land

---

## 5. Summary

**83 distinct capabilities cataloged.** Exact counts by the literal `Status` column, verified by
grep against the table itself, not eyeballed:

- **implemented** (including the 5 rows that read "implemented — contradicts \[doc\]'s claim",
  which are genuinely built despite what the plan doc says): **58**. Several of these carry a real,
  named caveat in their Evidence cell that stops short of full "no gaps" (e.g. `findActionPath`
  proven only on a toy graph and wired to no real domain, item #42; telemetry wired but not
  exercised by the live chat dispatch path, item #61; `cax-dw` implemented but not yet
  re-measured, item #19) — read the Evidence column, not just the status word, for these.
- **claimed-only**: **21**
- **partial** (literal word in the Status column): **2** (items #8, #16)
- **explicit scope decision, not a gap** (multi-language AST extraction, permanently seonix's job): **1**
- **in-flight/uncommitted at time of writing** (the construction-grammar bank, item #40): **1**
- **undocumented**: 0 rows carry this literal status — the one reverse-check finding this survey
  turned up (`src/completions/rank.mjs`'s block-ranker reuse) traced back to `PLAN_COMPLETIONS.md`
  once followed, so it was folded into the completions rows rather than kept as a standalone
  "undocumented" row. No large capability with genuinely zero doc anchor anywhere turned up in the
  time available.

**The single most surprising finding**: this is a **live documentation-lag problem, not a one-off
stale claim**. `PLAN_AGENTS.md` — the repo's own *governing* plan doc, drafted 2026-07-10, the same
day as this audit — lists at least six Phase-0/Phase-1 items as "not started" (SHACL ingest gate,
cross-repo smoke test, `envelope.json`, ontology-hierarchies tracks a-d, context-preserving
unknown-word ingestion) that are **already implemented and committed as ancestors of this audit's
own pinned commit**. One of them (ontology tracks a+b) turns out to have already been shipped
*before `PLAN_AGENTS.md` was even drafted*, per that shipping commit's own message. This isn't
sloppy documentation — it's the natural consequence of a fast-moving, multi-track session outrunning
its own docs-sync step (explicitly one of the tracks still pending per this doc's own header
caveat). The practical takeaway for a reader: trust the code and the test file list over any
"Status" banner in this repo's `.md` files until the pending docs-sync track lands.

**The second-most notable finding**: `INF-B1`'s gating rule, `cax-dw`, is implemented and unit-tested
but the benchmark that would confirm it actually unlocks the gate hasn't been re-run since the rule
landed — a "should work, unconfirmed" state that's easy to misread as either "done" (it compiles and
has tests) or "not done" (the headline ladder number still says 33%) depending which doc you read
last.
