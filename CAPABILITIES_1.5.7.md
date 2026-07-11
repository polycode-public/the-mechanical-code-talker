# CAPABILITIES_1.5.7.md — tmct capability audit (refresh 4, full-scope restoration)

**Pinned at commit `d170196` ("docs(conversation): persona-sweep is now the default single-run
mode"), package.json `1.5.7`, 2026-07-11.** Built by re-verifying every capability directly against
this commit's actual `src/`/`bin/`/`test/` — not by carrying forward either prior audit's verdict.
Evidence sources: direct file/line reads and greps against HEAD, `git log`/`git blame` for change
attribution, `npm test`, and the four fresh benchmark reports measured this cycle —
`BENCHMARK_AGENT_1.5.7.md`, `BENCHMARK_CEFR_ENGLISH_1.5.7.md`, `BENCHMARK_CONVERSATION_1.5.7.md`,
`BENCHMARK_INFERENCE_1.5.7.md` — cited as evidence, not re-run here.

## 0. Scope note — restoring the 83-capability catalog (read this first)

`CAPABILITIES_1.4.1.md` (refresh 2, née `CAPABILITIES_AUDIT_2026-07-10_001.md`) is **not** the
original full audit, despite reading that way at a glance. The true original — "refresh 1," pinned
at commit `0b730ad` — catalogued **83 distinct capabilities** in one status table. Refresh 2's own
commit (`165de5f3`) condensed that into a **changed/new-rows-only** table, explicitly telling readers
to "see refresh 1's git history for the full 83-row table." `CAPABILITIES_1.5.0.md` (refresh 3, née
`_002`) narrowed further still: its own §1 comparative table states "only rows that moved are
reproduced in full below," and its status-change section (§0) lists roughly a dozen items, not 83.

So the scope drop the operator flagged is real, but it happened in **two steps**, not one: refresh 1
(83 rows, full) → refresh 2/`CAPABILITIES_1.4.1.md` (16 changed/new rows shown, rest deferred to git
history) → refresh 3/`CAPABILITIES_1.5.0.md` (~13 changed rows shown, rest deferred to `_001`). Each
step was individually reasonable (a delta-only doc is honest and cheaper to write), but the *effect*
compounds: a reader of `CAPABILITIES_1.5.0.md` alone cannot reconstruct tmct's actual capability
surface without also fetching refresh 1 out of git history, which nothing in the live doc set points
at directly. This audit restores the full catalog **and does not stop at re-stating prior verdicts**:
every one of the 83 original rows below was re-checked against the real code at `d170196`, and item
numbering matches refresh 1's original scheme exactly (recovered via `git show 963f3da4:` on the
file's pre-rename path) so old and new citations stay comparable.

---

## 1. Full status table — all 83 original capabilities, re-verified against `d170196`

**Status key:** `implemented` · `partial` · `undocumented` · `claimed-only` · `explicit scope
decision` (unchanged from refresh 1's own key). Rows with no functional change since the last audit
that touched them carry a terse evidence cell and a plain "unchanged" note, per the operator's own
instruction that unchanged capabilities get brief confirmation, not re-derivation. Rows that changed
get full evidence and a named prior-audit citation.

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline (grammar/keyword/noise-strip/fuzzy) | implemented | `src/interpret/pipeline.mjs`, `merge.mjs`, `strategies/{ace,constructions,grammar,keywords,noise-strip}.mjs` all present | unchanged since 1.4.1 |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | `src/grammar/ace.mjs`, `src/grammar/lexicon.mjs` | unchanged since 1.4.1 |
| 3 | ACE-OWL parser extracted to standalone MPL-2.0 npm package | **REVERTED — was implemented in both `_001`/`_002`** | `packages/` directory no longer exists in this worktree; commit `f234f351` `revert(ace-owl): fold the ACE-OWL parser back into tmct, drop the workspace`. No re-extraction after that commit (`git log f234f351..HEAD -- packages/` empty). The underlying grammar capability (#2) is unaffected — it lives back in `src/grammar/ace.mjs` | **changed since CAPABILITIES_1.5.0.md: implemented → reverted.** A genuine status regression, not a doc-lag artifact — the workspace was deliberately dropped |
| 4 | OWL 2/RDF/RDFS + SEON core ontology grounding | implemented | `ontology/tmct-core.ttl` (335 lines) | unchanged since 1.4.1 |
| 5 | Template libraries / response phrase book | implemented | `src/corpus/templates.mjs`, `data/templates/{constructions,grammar-rules.toml,responses.jsonl}` | unchanged since 1.4.1 |
| 6 | Filtered ConceptNet corpus slice (CC-BY-SA 4.0) | implemented, **now opt-in not default** | `corpus/conceptnet/`, `src/corpus/conceptnet.mjs` | **changed since CAPABILITIES_1.5.0.md**: mechanism unchanged, but the default-persona flip (see §2 new-capability row) makes ConceptNet `active:false` out of the box — see #37/#38 |
| 7 | Conversational memory as its own OWL-labelled graph | implemented, **now with 3 storage backends** | `src/memory/core.mjs` (1684 lines): `createInMemoryStore` (Backend B), `createSqliteMemoryStore` (Backend C); Backend A (plain repo string) is the pre-existing default | **changed since CAPABILITIES_1.5.0.md**: two new pluggable backends landed (`archive/PLAN_SEED.md` §6) — see §2 |
| 8 | Input normalization pass (preamble/subordination/conditional stripping) | partial (unchanged shape) | `src/interpret/normalize.mjs` | unchanged since 1.4.1 |
| 9 | Graph-provider adapter contract (Repository Interface, 15 services) | implemented | `src/repository-interface.mjs` (`INTERFACE_VERSION = "1.1.0"`, unchanged), `src/providers/{graph-service,fixture,bootstrap}.mjs` | unchanged since 1.4.1 |
| 10 | Runnable conformance/compatibility test suite for RI providers | implemented | `src/conformance.mjs` `assertIndividual`/`runConformance` present | unchanged since 1.4.1 |
| 11 | Library-first design — stable, documented `exports` map | implemented, **grown from 13 to 18 entry points** | `package.json` `exports`: `.`, `./chat`, `./resolveObject`, `./ask`, `./relationKind`, `./impactClosure`, `./dispatchTool`, `./fetchEntities`, `./repository-interface`, `./graph-service`, `./providers/fixture`, `./providers/bootstrap`, `./conformance`, **`./init`, `./extensions`, `./toml-config`, `./generateCompletion`, `./createCompletionsGraphAdapter`** (bold = new since 1.5.0) | **changed since CAPABILITIES_1.5.0.md**: 5 new subpath exports, from the CLI/config-unification batch and the completions-pipeline public-API batch |
| 12 | Ink console TUI shell | implemented | `src/tui/app.mjs` (252 lines, unchanged) | unchanged since 1.4.1 |
| 13 | Calculation surfaced as reasoning (counts/comparisons via templates) | implemented | `via:"template"` provenance still present throughout `src/chat.mjs` | unchanged since 1.4.1 |
| 14 | Optionally running linters/tests to observe | claimed-only | no `runLinter`/child-process-test-execution code found in `src/` | unchanged since 1.4.1 |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | claimed-only (deliberate) | `PLAN_CODE.md` still frames this door as deliberately shut | unchanged since 1.4.1 |
| 16 | Response-finishing grammar pass over segmented answers | partial (unchanged shape) | `src/finish.mjs` (486 lines) | unchanged since 1.4.1 |
| 17 | `tmct init` onboarding CLI | implemented, **extended with `--persona-size`** | `bin/tmct.mjs:518` `mode === "init"`; new `--persona-size <small|medium|large>` flag | **changed since CAPABILITIES_1.5.0.md**: new flag for the persona content-tier system (§2) |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `src/syllogise.mjs` `deriveSubClassClosure`/`deriveTypePropagation` | unchanged since 1.4.1 |
| 19 | `cax-dw` disjointness entailment rule (INF-B1) | implemented, live-wired | `src/syllogise.mjs:127` `CAX_DW_RULE`, `:380` `deriveDisjointViolations`; live in `chat.mjs`'s `isaAsk` block per `CAPABILITIES_1.4.1.md` item 19 | unchanged since 1.4.1 (that audit's own fix). **Not independently re-measurable this cycle** — see §3 INFBENCH caveat |
| 20 | `cax-sco` type-propagation entailment rule | implemented | `src/syllogise.mjs:115` `CAX_SCO_RULE`, `:318` `deriveTypePropagation` | unchanged since 1.4.1 |
| 21/24 | Actor-level, session-scoped source trust (Laplace/add-k) | implemented | `src/memory/trust.mjs:74` `sourceReliabilityOf`, `:112` `computeTrust` | unchanged since 1.4.1 |
| 22 | Consistency checking / cardinality entailment / proof-chain materialization (INF stages 4-5) | **implemented — all three sub-parts now real, was partial/claimed-only in `_001`, consistency-only in `_002`** | `src/syllogise.mjs`: `findConsistencyViolations:833` (INF-C2, closed in `_001`), **`buildCardinalityRestrictions:574`, `proveCardinalityAtLeast:759`, `proveMaxCardinalityZeroDenial:801`** (cardinality entailment / `cax-maxc0` — new); live-wired into `chat.mjs`'s proof-chase blocks (`scm-svf1`/cardinality-monotonicity/`cax-maxc0`, `chat.mjs:4227,4968-5101,6504`) | **changed since CAPABILITIES_1.5.0.md**: cardinality entailment and `cax-maxc0` are genuinely new. This directly closes the gap **both** `_001` and `_002` carried forward verbatim as "`scm-svf`/cardinality monotonicity — confirmed unmeasurable against the current fixture, no action needed" — that framing is now stale; the rule exists and is wired |
| 23 | Unified provenance/trust primitive (Source individuals) | implemented | `src/memory/trust.mjs` | unchanged since 1.4.1 |
| 25 | Memory-tree versioning (`snapshotMemory`, manual-trigger) | implemented | `src/memory/core.mjs:629` `snapshotMemory`; `toml-config.mjs:156` `retention_versions` | unchanged since 1.4.1 |
| 26 | Automatic, deterministic contradiction detection | implemented | `src/memory/core.mjs:1669` `findContradictions` | unchanged since 1.4.1 |
| 27 | Hub-dampened memory-fact ranking (`/√(1+degree)`) | implemented, on by default | `src/memory/blocks.mjs:249` | unchanged since 1.4.1 |
| 28 | Extension-pack / corpus-lexicon loading seam | implemented, **default bundle flipped** | `src/extensions.mjs:303` `seedActiveCorpusEntries`, `BUILTIN_EXTENSIONS` | **changed since CAPABILITIES_1.5.0.md**: `seon`/`conceptnet` flipped from `active:true` to `active:false`; `human` flipped to `active:true` — commit `c58daf4a` "flip the default persona — human active, seon/conceptnet opt-in" (`PLAN_SEED.md` §2) |
| 29 | Bias-weighted ambiguity resolution | implemented | `src/memory/bias.mjs:71` `rankByBiasThenTrust` | unchanged since 1.4.1 |
| 30 | `tmct init --with-persona <name>` | implemented, **extended** | `bin/tmct.mjs:562` `--with-persona`; new `--persona-size <medium|large>` (see #17) | **changed since CAPABILITIES_1.5.0.md**: new size-tier flag |
| 31 | Tier-2 general-knowledge corpus bundle (`tier2-general`) | implemented, **now legacy, superseded as the active default** | `corpus/tier2/general.jsonl` (49 facts, animal/weather) still present but inactive by default | **changed since CAPABILITIES_1.5.0.md**: `corpus/tier2/human.jsonl` is now the active default bundle (~664 facts, see #32) |
| 32 | A wider general-knowledge seed set grown beyond tier2 | **implemented — was claimed-only in every prior audit including `_001` and `_002`** | `corpus/tier2/human.jsonl` (Small, 664 facts), `human-medium.jsonl` (+944 → 1,608), `human-large.jsonl` (+12,001 → 13,609); lexicon grew 180→478 nouns, 63→92 verbs, 33→58 adjectives, 15→22 proper names; `archive/PLAN_SEED.md`'s own STATUS block confirms Small tier "SHIPPED and merged to main," verified end to end (real fact/example counts spot-checked against the plan's own targets) | **changed since CAPABILITIES_1.4.1.md item 32 (`claimed-only`) and CAPABILITIES_1.5.0.md (unmentioned, so implicitly still claimed-only)**: this is one of this audit's biggest single status flips |
| 33 | Context-preserving unknown-word ingestion | partial, **still dormant** | `src/corpus/conceptnet.mjs:152-210` `captureUnknownContext`, default `false`; `seedActiveCorpusEntries` (the one production call site) still never passes `true` | unchanged since `CAPABILITIES_1.4.1.md` item #33 (which itself corrected `PLAN_AGENTS.md`'s stale "not built" claim) |
| 34 | SHACL-style declarative ingest gate | implemented | `src/memory/shacl.mjs` `assertIndividualValid`, wired into `appendFact`/`appendRule` at `memory/core.mjs:1191,1386` | unchanged since 1.4.1 |
| 35 | Cross-repo HTTP smoke test | implemented | `test/server-http-smoke.test.mjs` | unchanged since 1.4.1 |
| 36 | Machine-readable capability envelope | implemented, **version field stale** | `agentbench/envelope.json`; `"agentbenchVersion": "1.4.1"` — not bumped for 1.5.7 despite the file being regenerated each AGENTBENCH cycle | **doc-lag finding, unchanged mechanism** since 1.4.1 — flagged as a small but real docs-sync gap, the same class `_001`'s own §6 named as tmct's recurring failure mode |
| 37 | Ontology-hierarchies tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, **reachability changed** | `src/chat.mjs:3739` `SYNONYM_DENYLIST` | **changed since CAPABILITIES_1.5.0.md**: mechanism intact, but ConceptNet is now `active:false` by default (see #28) — off for a fresh `tmct init` unless explicitly activated |
| 38 | Ontology-hierarchies tracks c+d (SEON spine, `disjointWith` growth) | implemented, same reachability caveat | `ontology/tmct-core.ttl` | **changed since CAPABILITIES_1.5.0.md**: same default-off caveat as #37 (SEON now opt-in) |
| 39 | Advanced-grammar: subordination/conditional preamble frames | implemented | `src/interpret/normalize.mjs:358-537` | unchanged since 1.4.1 |
| 40 | Advanced-grammar: construction-grammar template bank | implemented (fully committed) | `src/interpret/strategies/constructions.mjs` | unchanged since `CAPABILITIES_1.4.1.md` item 40 (which itself closed refresh 1's "in-flight, uncommitted" status) |
| 41 | Chat-taught relations & rules (6 items) | implemented, fully | `src/chat.mjs`: 19 hits for `RELATION_FACT_TEACH_RE`/`COMPOSE2_RULE_TEACH_RE`/`FILTER_RULE_TEACH_RE`/`RECURSIVE_RULE_TEACH_RE` | unchanged since 1.4.1 |
| 42 | `findActionPath` (bounded successor BFS) | implemented, still not wired to a real domain | `src/planning.mjs:94` | unchanged since 1.4.1 |
| 43 | `findReachableSet` (reachability enumeration) | implemented, wired into chat (recursive-rule reachability) | `src/planning.mjs:199` | unchanged since 1.4.1 |
| 44 | Towers-of-Hanoi goal-directed planning loop | claimed-only | `PLAN_HANOI.md` still headed "RESEARCH/DESIGN — not yet implemented"; no `legalMoves`/`boardToFacts` anywhere in `src/` | unchanged since 1.4.1 |
| 45 | "I am thinking of a number" closed-loop game | claimed-only | `PLAN_GUESS_NUMBER.md` still headed "RESEARCH/DESIGN — not yet implemented"; no `game` session slot in `chat.mjs` | unchanged since 1.4.1 |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented, per the plan's own banner | `synthbench/{phrasing,rules}/` present | unchanged since 1.4.1 |
| 47 | Program synthesis Tracks 2-4 (Playwright sandbox) | claimed-only, sign-off-gated | no `playwright` in `package.json` | unchanged since 1.4.1 |
| 48 | Completions pipeline Stage 0 (broad search + grouping) | implemented | `src/completions/search.mjs`, `group.mjs` | unchanged since 1.4.1 |
| 49 | Completions pipeline Stage 2 (extractive ranking) | implemented | `src/completions/rank.mjs` | unchanged since 1.4.1 |
| 50 | Completions pipeline wired into a user-facing chat answer path | **implemented, and the architectural gap `_001`/`_002` both flagged is now CLOSED** | `chat.mjs:6177` `completionsRescueAnswer` calls `generateCompletion` with a real `graphService` built by **`createCompletionsGraphAdapter(graph, memory)`** (`src/completions/graph-adapter.mjs`, commit `798a77f` "wire a real graphService into the COMPLETIONS RESCUE lane," landed after `_002`). The adapter's own docblock names this explicitly as closing `_002`'s (`CAPABILITIES_1.5.0.md`'s) speculative next step: `.search()` delegates to the same ranked lexical search every RI consumer uses; `.ask()` builds real sentences from `resolveSymbol`+`renderDescribe` (graph facts) AND `readFactRows` (taught Facts) — the two sources `broadSearch` previously had zero path to when a subject had no pre-seeded memory block | **changed since CAPABILITIES_1.5.0.md item 50b**: `_002`'s own "New speculative next step" (a `graphService`-shaped adapter wrapping the loaded graph/`ask()`) has now shipped for real. The first-mention/no-prior-block case this row's whole caveat was about should now work — not independently re-measured against a live playtest this cycle, but the code path is real and directly traced, not inferred |
| 51 | Capability router — full 6-stage stack | implemented | `src/router/{registry,resolver,planner,guardrail,goal-reasoner,call-validator,set-algebra}.mjs` | unchanged since 1.4.1, confirmed byte-identical per `BENCHMARK_AGENT_1.5.7.md` |
| 52 | `POST /v1/messages` HTTP shim | implemented | `src/server-http.mjs` `createServer` | unchanged since 1.4.1 |
| 53 | bedrock-meter $0-rung routing integration | implemented in the sibling repo, not this one | `PLAN_AGENTS.md:642` still lists the Bedrock integration test/assessor as "Not started" on tmct's own side | unchanged since 1.4.1 |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md:642` "Not started" | unchanged since 1.4.1 |
| 55 | `seon-mcp` (marginalia) provider adapter | claimed-only | `PLAN_AGENTS.md:639` "Not started" | unchanged since 1.4.1 |
| 56 | marginalia "mechanical chat" replacement by tmct | claimed-only | `PLAN_AGENTS.md:86` "Not started — the real open work" | unchanged since 1.4.1 |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md:640` "Not started" | unchanged since 1.4.1 |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md:641` "Not started" | unchanged since 1.4.1 |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet/pagination) | implemented, v1.4.0 | `src/providers/graph-service.mjs`; `INTERFACE_VERSION = "1.1.0"` unchanged | unchanged since 1.4.1 |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `src/source-slice.mjs` `resolve()`-based containment check | unchanged since 1.4.1 |
| 61 | Telemetry wrapper on every RI service | implemented, still not exercised by the live chat dispatch path | `src/telemetry.mjs` (93 lines) | unchanged since 1.4.1 |
| 62 | Chronograph-style temporal diffing | claimed-only, genuinely hard | no validity-interval/diff code found in `src/` | unchanged since 1.4.1 |
| 63 | Multi-language AST extraction inside tmct | explicit scope decision, permanently out | `src/graph-build.mjs` still does no parsing, by design | unchanged since 1.4.1 |
| 64 | Dialogue-flow playtest ladder, Tiers 0-6 | implemented | `test/chatflow-tier{0,1-single-touch,2,2-drilldown,4,5,6}.test.mjs` + `chatflow-drilldown/history.test.mjs`, `showcase.test.mjs` all present | unchanged since 1.4.1 |
| 65 | CHATBENCH graded-pool ladder | implemented | `chatbench/graded-pool.jsonl` (109-case default) + `graded-pool-max.jsonl` (1,075-case full pool) | unchanged since 1.4.1; freshly exercised — `BENCHMARK_CEFR_ENGLISH_1.5.7.md`: mean 1.724/2, 1 hard fail (down from 6) |
| 66 | AGENTBENCH agentic ladder (A0-C2) | implemented | `agentbench/cases.jsonl` (56 cases), `envelope.json` | unchanged since 1.4.1; byte-identical across three consecutive measured versions (`0.8.2`, `1.4.1`, `1.5.7`) per `BENCHMARK_AGENT_1.5.7.md` |
| 67 | INFBENCH classical-logic ladder | **partial → the HARNESS is currently broken, not the engine** | independently reproduced: `node infbench/generate-cases.mjs` exits 1, `FIXTURE LINT FAILED (b2-svf1apply-4)` — "dice" folds to lemma `die` via `parseAce`, no fresh `cases.jsonl` written. `git log f89aaab..HEAD -- src/syllogise.mjs` is empty (zero commits since the 1.5.7 version bump) and `test/syllogise.test.mjs` still passes clean | **changed since CAPABILITIES_1.5.0.md**: was a clean-passing ladder (206/209, 99%) there. Now the harness itself cannot produce a rung table — a fixture-lexicon bug (commit `89e071f`, the persona Medium/Large tier build, registered `"dice"` as both `"die"`'s irregular plural AND a standalone noun) blocks measurement, per `BENCHMARK_INFERENCE_1.5.7.md`'s full root-cause. The engine is not shown to be regressed; it is unmeasured this cycle |
| 68 | Strategy-advisor background-agent watch process | implemented (process), **currently dormant** | `STRATEGY_ADVISOR.log`'s own last entry states no live strategy-advisor process watched the 2026-07-10 later session or the 2026-07-11 batch that followed — a single coordinator ran those directly | **changed since 1.4.1**: mechanism unchanged, but self-reports as inactive across the most recent work — a process gap, not a code regression |
| 69 | Segmentation IR + concept force | implemented | `src/concept.mjs`, `src/finish.mjs` | unchanged since 1.4.1 |
| 70 | Negation as bounded set complement | implemented | `src/router/set-algebra.mjs` | unchanged since 1.4.1 |
| 71 | Reversible-passive traversal | implemented | `test/ask-negation-passive.test.mjs` | unchanged since 1.4.1 |
| 72 | Compound-name resolution in `resolveObject` | implemented | `src/ask.mjs:2810` `resolveObject` (built on `resolveObjectCore` at `:2430`) | unchanged since 1.4.1 |
| 73 | Same compound-symbol matching extended to `/describe`'s resolver | **still claimed-only / named gap** | `src/codegraph.mjs:153` `resolveSymbol` remains its own separate, stricter resolver | unchanged since 1.4.1 |
| 74 | Reverse-`inherits` "the"-definite forms | **still claimed-only / named gap, now better documented** | `src/ask-vocab.mjs:58-72,255-266`: the forms are named for completeness but deliberately excluded — a fix was tried and reverted because it broke `test/ask-cascade.test.mjs`/`chatflow-tier2.test.mjs`'s pinned invariant | unchanged in outcome since 1.4.1, but the code now documents the attempted-and-reverted fix in detail — evidence the gap was actively investigated, not neglected |
| 75 | Cochange phrasing variants + "multi-root" over-match | **still open, sharper evidence found this cycle** | `ROADMAP.md:326-327,351-352` still lists both open. `BENCHMARK_CONVERSATION_1.5.7.md` round 1 found and documented (not fixed) that bare "X and Y `<symmetric-verb>`" conjunction subjects — e.g. "did TaskController and UserController ever cochange" — mis-parse as one entity name; no grammar rule in `src/interpret/` handles bare-conjunction symmetric-relation subjects | **changed since CAPABILITIES_1.5.0.md**: a newly-precise, freshly-confirmed sub-instance of the same general gap — same row, sharper evidence, still not fixed |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md:644` "Not started" | unchanged since 1.4.1 |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md:644` "Not started" | unchanged since 1.4.1 |
| 78 | Winograd-hard commonsense coreference | claimed-only, deliberately out of reach | `PLAN_AGENTS.md:646` "Not started, not scheduled" | unchanged since 1.4.1 |
| 79 | A shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md:646` | unchanged since 1.4.1 |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `src/server.mjs`; `@modelcontextprotocol/sdk` absent from `package.json` | unchanged since 1.4.1 |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV-Scanner, provenance) | implemented | `.gitlab-ci.yml`: SAST+Secret-Detection templates, `osv-scanner v2.0.2` pinned, `npm publish --provenance` | unchanged since 1.4.1 |
| 82 | Predicate "find" queries | implemented | `src/ask.mjs:978` `parseFind`, `:1028` `parseFindPredicateHead` | unchanged since 1.4.1 |
| 83 | Single-sourced `fnv1a` hash + wink browser-loader seam | implemented | `src/hash.mjs:19,30`; `src/wink-model.mjs` | unchanged since 1.4.1 |

---

## 2. New capabilities since `CAPABILITIES_1.5.0.md` — not on the original 83-row list at all

A large amount of the intervening work (131 commits between `1.4.1`'s measured commit and this run,
per `BENCHMARK_CEFR_ENGLISH_1.5.7.md`; 19 more between `_002`'s pin and here) doesn't fit into any
existing row above — genuinely new capability areas, not status changes to old ones.

| # | Capability | Status | Evidence | Significance |
|---|---|---|---|---|
| 84 | SQLite memory Backend C (cached, incrementally patched reads) | implemented | `src/memory/core.mjs`: `createSqliteMemoryStore`, `closeSqliteMemoryStore`, `readSqlitePayload` (caches payload after first `SELECT`), `persistSqlitePayload` (patches cache in lockstep with per-row writes); wired via `chat.mjs:7927-7938`, `backendChoice === "sqlite"`, `.tmct/memory/graph.sqlite`. Schema adapted from sibling repo seonix's `store.mjs` | A real third storage backend for the memory graph — read caching was the last open item on `archive/PLAN_SEED.md`'s own plan, now confirmed closed by that doc's final STATUS entry |
| 85 | In-memory Backend B (pure in-memory, zero disk I/O) | implemented | `src/memory/core.mjs:210` `export function createInMemoryStore()`; wired via `chat.mjs:7930-7932`, `backendChoice === "memory"` | Session-scoped, no disk writes at all — useful for ephemeral/test sessions; confirmed by direct import + call, not just doc narrative |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `bin/tmct.mjs`: `--graph <path>` is now repeatable ("multiple graphs merge"); new `tmct import` verb activates/seeds an already-initialized repo without touching extension-bundle activation; `src/cli-args.mjs` (164 lines) is the new single shared argv/config resolver for both `chat`/`serve`/`import` | A structural CLI/config unification, not a chat-surface fix — lets one session reason over more than one graph file at once |
| 87 | Default human-world persona + Small/Medium/Large content tiers | implemented | Commit `c58daf4a` flips the out-of-box default bundle (see #28/#37/#38); `corpus/tier2/human*.jsonl` are the three real size tiers (see #32); `archive/PLAN_SEED.md` is the authoritative, now-archived plan, its own STATUS block confirming Small shipped end to end with real fact/example counts matching its targets | The single biggest behavioral change to what a fresh `tmct init` gives you — a fundamentally different default corpus/persona than any version audited before |
| 88 | `graphService` adapter wired into the completions pipeline | implemented | `src/completions/graph-adapter.mjs`, `createCompletionsGraphAdapter(graph, memory)`, commit `798a77f` | This is the fix for #50's remaining architectural gap — see #50's row above for detail |
| 89 | Public package exports for `generateCompletion`/`createCompletionsGraphAdapter` | implemented | `package.json` `exports`: `./generateCompletion`, `./createCompletionsGraphAdapter` (the final merge on `HEAD` before this pin) | Lets an external caller (e.g. a sibling repo) drive the completions pipeline directly, not just through tmct's own chat surface |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | implemented | New skill doc; commits `21eb6a2` (author-identity lane accepts past-tense "who was `<name>`") and `d04a926` ("is X a Y" answers directly from the code graph's own `inherits` edge) both confirmed present in `src/chat.mjs`/`src/ask.mjs` | A new delegated chat-explore-fix loop pattern, distinct from the existing capped-sprint/persona-sweep conversation-benchmark modes |
| 91 | Persona-sweep as the conversation benchmark's default single-run mode | process change | `SKILL_BENCHMARK_CONVERSATION.md` §3.4, commit on `HEAD` itself ("persona-sweep is now the default single-run mode") | Methodology change, not product code — worth naming since it changes how future `BENCHMARK_CONVERSATION_*.md` reports will default to running |
| — | `PLAN_ADVENTURE.md` / `PLAN_CONVERSATION.md` | both explicitly "RESEARCH/DESIGN — not yet implemented" / "research/design notes, nothing implemented" | new plan docs exist, headers checked directly | Named for completeness, not counted as capabilities — nothing in either is live code |

---

## 3. Caveats (mirrors `_001`/`_002`'s own §2 discipline — a caveat gets its own callout, not a buried table cell)

### 3.1 INFBENCH's harness is broken, the engine is not (confirmed independently)

`BENCHMARK_INFERENCE_1.5.7.md` reports `infbench/generate-cases.mjs` crashing on a lexicon collision
(`"dice"` registered as both `"die"`'s irregular plural and its own standalone noun, from commit
`89e071f`). This audit reproduced the crash directly (`node infbench/generate-cases.mjs` → exit 1,
`FIXTURE LINT FAILED (b2-svf1apply-4)`) and separately confirmed `src/syllogise.mjs` itself carries
zero commits since the `1.5.7` version bump and `test/syllogise.test.mjs` still passes clean. **Read
this as "measurement blocked," not "regressed"** — items #19, #20, #22's cardinality/consistency
rules, and the full classical-logic ladder (#67) cannot be freshly scored this cycle, but nothing
found here suggests the underlying rules broke. The last real ladder measurement on record remains
`BENCHMARK_INFERENCE_1.4.1.md`'s full-gate PASS (`_002`'s own 206/209 re-run isn't independently
re-confirmable against `1.5.7`'s HEAD without fixing the generator first).

### 3.2 ACE-OWL: implemented → reverted (item #3)

Both `CAPABILITIES_1.4.1.md` and `CAPABILITIES_1.5.0.md` carried "ACE-OWL parser extracted to a
standalone MPL-2.0 npm package" as `implemented`, unchanged, across two refreshes. Commit `f234f351`
("revert(ace-owl): fold the ACE-OWL parser back into tmct, drop the workspace") reverses that — the
`packages/` workspace no longer exists in this worktree, and the grammar logic lives back in
`src/grammar/ace.mjs`. This is a genuine capability-surface regression (an external consumer wanting
just the ACE-OWL parser can no longer `npm install` it standalone), not a docs-lag artifact — flagged
explicitly per this project's own recurring "live wiring gap"/documentation-lag pattern that `_001`'s
§6 first named, this time running in the opposite direction (a real removal, not a stale claim).

---

## 4. Benchmark feature-support — updated with the fresh 1.5.7 measurements

### `SKILL_BENCHMARK_AGENT.md` (AGENTBENCH)

Unchanged surface, confirmed byte-identical across three consecutive measured versions (`0.8.2`,
`1.4.1`, `1.5.7`) — `BENCHMARK_AGENT_1.5.7.md`'s own "what moved" section: nothing, verified via
`git log` over the router/`agentbench/` path returning a single docs-only commit.

### `SKILL_BENCHMARK_CEFR_ENGLISH.md` (CHATBENCH)

- Both of `1.4.1`'s named hard-fail clusters (C2 `pronoun-binding`, 4 cases; A2 `naming-vocabulary`,
  2 cases) are gone, each traced to a named commit (`a24e628`, `07f4805`) in
  `BENCHMARK_CEFR_ENGLISH_1.5.7.md`. Mean 1.624 → 1.724, hard fails 6 → 1.
- New target for next cycle: A1 `naming-vocabulary`'s schema-term/common-word collision
  (`g-a1-naming-8/9`, "what does tests/imports mean") — the same bug *class* as the now-fixed A2
  cell, one tier down, per that report's own decision log.

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH)

Blocked this cycle — see §3.1 above. `SKILL_BENCHMARK_INFERENCE.md`'s own discipline explicitly
allows "the harness itself is broken" as a legitimate reportable outcome, and that's what happened.
Immediate unblock (per `BENCHMARK_INFERENCE_1.5.7.md`'s own recommendation): drop the redundant
standalone `"dice"`/`"people"`/`"teeth"` lexicon entries, or exclude irregular-plural targets from
`CLASS_NOUNS`.

### `SKILL_BENCHMARK_CONVERSATION.md` (capped sprint / persona-sweep)

Capped sprint mode run for real this cycle — 2 of 3 rounds (capped early by explicit operator
instruction, not because the well ran dry: round 1 shipped 3 fixes, round 2 shipped 1). Highest-value
fix: `describeWrapperAnswer`'s focus-carry repair, which fixes the core "describe X → it/that
follow-ups" drill-down pattern the product's own README leads with. Two real gaps need an operator
scope decision (bare "what's ProperNoun", "X and Y `<verb>`" conjunction parsing — see #75); one gap
(completions garbled-output under specific session histories) needs a cleaner repro before it can be
fixed. Regression suite grew by 6 tests. Persona-sweep is now this benchmark's own default single-run
mode going forward (§2, item 91).

---

## 5. Plan feature-support

### `PLAN_AGENTS.md`

§3's "chat-surface debt re-measure" (closed in `_002`) stays closed. The persona/CLI-unification
batch (§2.1/§4's dependencies) is now substantially shipped — see `archive/PLAN_SEED.md`. Phases 2-5
(marginalia/seonix/Bedrock/Copilot integration) remain untouched, "Not started," unchanged since
`_001`.

### `PLAN_SEED.md` — now archived

Every item this plan ever scoped is done, per its own final STATUS entry (`archive/PLAN_SEED.md`):
persistence backends (§6, Backend B+C), CLI/config unification, and the Small-tier persona content
(§3/§4/§8) all merged and verified. `npm test` at archival time: 1866/1866. This is the single largest
completed body of work since `CAPABILITIES_1.5.0.md`.

### `PLAN_CODE.md` / `PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`

Unchanged from `_001`/`_002` — nothing touched these plans' surfaces this cycle.

### `PLAN_ADVENTURE.md` / `PLAN_CONVERSATION.md`

New research/design docs, both explicitly "nothing implemented" per their own headers. Named for
completeness; no capability-table impact.

---

## 6. Non-benchmarked capabilities — updated

`_001` named three areas real benchmarks structurally can't measure (the completions pipeline,
taught-relation inference, fluid conversational flow). This cycle's biggest non-benchmarked news is
that **the completions pipeline's remaining architectural gap is now closed in code** (item #50/#88)
— a capability that moved from "real but limited" to "real, and the limitation `_002` diagnosed is
directly addressed," without a fresh playtest to confirm the practical effect. The persona/corpus
default flip (#87) is similarly invisible to CHATBENCH/AGENTBENCH/INFBENCH's existing case sets (none
of them probe "what does a bare, un-extended `tmct init` know out of the box"), but is arguably the
single most consequential behavioral change to a first-time user's experience since either prior
audit — worth stating plainly, the same discipline `_001`'s own §5 established.

---

## 7. Summary

**Re-verified against real code:** all 83 of the original catalog's rows, plus 8 new rows (84-91) for
capabilities that shipped since `_002` and don't fit any existing row. That is **91 total rows**,
restoring and extending refresh 1's original 83-capability scope rather than continuing either prior
refresh's delta-only narrowing.

- **Status flips since `CAPABILITIES_1.5.0.md`** (the audit most rows should be compared against,
  since it's the more recent of the two prior audits): item #3 (ACE-OWL, implemented → reverted),
  item #22 (cardinality entailment/`cax-maxc0`, partial → implemented), item #32 (wider seed set,
  claimed-only → implemented, the single biggest flip), item #50 (completions-in-chat's architectural
  gap, partial → closed in code), item #67 (INFBENCH, clean-passing → harness-broken-not-engine).
- **New capability surface**: 3 memory backends where there was 1 (#7/#84/#85), multi-graph loading
  (#86), a fundamentally different default persona/corpus (#87), a public completions API (#89).
- **Real, unresolved gaps carried forward unchanged**: #44/#45 (Hanoi/guess-number, still
  research-only), #53-58 (marginalia/seonix/Bedrock/Copilot integration, still not started), #73/#74
  (named grammar gaps), #75 (cochange conjunction parsing, now with sharper evidence), #76-79
  (research-horizon items).
- **The single most consequential finding of this refresh**: two of `_001`'s own named "live wiring
  gap" instances (`cax-dw`'s chat-wiring, fixed in `_001` itself; the completions pipeline's
  `broadSearch` scope limit, diagnosed in `_002`) are now BOTH closed — but a *third* instance of the
  same failure class appeared in the opposite direction this cycle: INFBENCH's own harness, previously
  the thing that caught `cax-dw`'s wiring gap in the first place, is now itself the broken link,
  blocking measurement of the very ladder it exists to score. The lesson generalizes further than
  `_001`'s original framing: "live wiring gaps" aren't confined to product code — the measurement
  harness itself is exactly as capable of silently drifting out of sync with a fast-moving lexicon as
  any other unit-tested-but-unreachable code path was.
