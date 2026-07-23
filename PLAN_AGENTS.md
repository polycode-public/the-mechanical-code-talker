# PLAN_AGENTS.md — the agent capability plan

*(Drafted 2026-07-10 as "tmct as the shared deterministic agent substrate"; re-baselined
2026-07-22 against v2.10.5, refreshed 2026-07-23 against `CAPABILITIES_2.11.0.md` per
`SKILL_CAPABILITIES_AUDIT.md` §5. The 2026-07-10 draft absorbed seven sibling design docs, deleted at
`8cd3b36`; `git show 8cd3b36^` has the originals, and this file's own git history holds the
absorbed narrative, the v1.4.0 build record, and the phase-by-phase status blocks this rewrite
compressed.)*

## 1. The target — what "enough" means

The operator's intent for this doc, from the 2026-07-10 draft:

> *"I want to go a little too hard on using tmct to the detriment of marginalia and seonix because
> I have no users and this will stress tmct so I can see the edges to improve."*

The draft never pinned a capability target, so this rewrite states one, derived from that intent
plus what the README now promises. **Proposed target: a complete deterministic agent loop, served
three ways, holding the abstention invariant (a refusal, never a guess) at every stage.**

The loop, five stages:

1. **perceive** — read a graph, a memory store, or a world state, including under partial
   observability (an agent reasons only over what it has seen);
2. **decide** — resolve a request, plan a call sequence, or deduce a goal, over declared operators
   (built-in capabilities or taught action rules);
3. **act** — execute tool calls or world actions, writing a per-step record;
4. **verify** — causal-link proof chains, and post-conditions confirmed by re-reading the store;
5. **learn** — explicit teaching, learning on a miss, and (offline for now) synthesizing new rules
   from labeled examples.

The three service surfaces:

- a **human** in chat or the CLI;
- a **program**, via the library export and the HTTP tool loop;
- **tmct's own autonomous agents** — the demo worlds that play themselves.

On top of the loop sit the four cross-repo mounts the draft staged: seonix's code→graph (shipped),
marginalia's mechanical-chat replacement and scrape→teach pipeline (not started), and tmct as a
pluggable $0 rung for LLM tool-routing stacks (bedrock-meter shipped; Claude Code hardening and a
Copilot shim open). §4 measures the distance to all of this.

## 2. Baseline (2026-07-22, v2.10.5) — what exists

Every path below was verified against the tree on 2026-07-22.

### 2.1 The planning primitive

`src/domain/planning.mjs` — pure, no I/O:

- `findActionPath(start, isGoal, applyActions, {maxDepth, stateKey})` — bounded, cycle-safe,
  shortest-path-first BFS with on-demand successor generation. Returns the full plan
  (`{actions, states}`) or `null` on a miss.
- `findReachableSet` — the enumerate-everything sibling.
- `bfsLevels` — per-depth-level walk for graded exploration.

Consumers: the router's taught lane, chat's plan lane, `src/services/spider-fly.mjs`
(`planSpiderPath`), and `src/services/adventure-autoplay.mjs`.

### 2.2 The capability router

`src/domain/router/` — a STRIPS/PDDL-style operator model and a four-stage drive:

- `registry.mjs` — 16 declared capabilities (`capabilities()`), each with typed parameters,
  preconditions, and add/del effects; `registerCapability` admits taught actions at runtime;
  `EXCLUDED_FROM_REGISTRY` names the three hot tools that stay outside it.
- `resolver.mjs` — NL intent frames (`FRAMES`), backward chaining over preconditions
  (`backwardChain`, `backwardChainWorld`), memory-term grounding (`resolveMemoryTerm`), and a
  refuse-and-list on genuine ties.
- `planner.mjs` — compound-request decomposition (`decompose`, `MAX_STEPS` 8), anaphor binding
  between steps, and a causal-link proof chain per plan.
- `taught.mjs` — `actionFamilies` → `capabilityFromActionRules` → `registerTaughtActions`: taught
  action rules become registry records.
- `goal-reasoner.mjs` — `GOAL_RULES` maintenance-goal deduction (coverage gaps, change-coupling
  risk), `MAX_TICKS` 16, with `hallucinationsIn` gating every emitted call.
- `call-validator.mjs` — the hallucination taxonomy (undeclared tool, unknown argument); consumed
  by the resolver, the goal-reasoner, and agentbench's grading.
- `drive.mjs` — `runCapabilityPlan` runs the cascade: resolver/planner → taught world-goal lane
  (`runTaughtPlan`, which simulates over the taught store via `findActionPath`, `maxDepth` 300) →
  goal-reasoner. A double refusal carries both stages' reasons.

Three invocation surfaces, all wrapping `drive.mjs`:

- **CLI**: `tmct plan "<request>"` (`--tools` restricts the set, `--json` emits the machine loop
  result, `--prompt --render blocks` writes a plan page via `src/services/plan-viz.mjs`).
- **Chat**: `/plan <request>` and `/capabilities` (what the router can plan over: built-in tools
  plus taught actions).
- **Library**: the package export `"./plan"` maps to `src/domain/router/drive.mjs` —
  `buildCapabilityPlanCtx({config, dispatchTool, memoryDir, …})` builds the
  `{dispatch, resolve, graph}` context (pass `memoryDir` to open the taught lane and
  `resolveMemoryTerm`); `runCapabilityPlan(request, tools, ctx)` returns
  `{calls, refused, composed, proof, why}`.

`tmct serve`'s `/v1/messages` endpoint dispatches individual capabilities as `tool_use` calls; it
does not yet expose a "plan this whole request" verb (§4, gap H).

### 2.3 Taught-rule planning in chat (the plan lane)

`src/services/chat.mjs` (`planLaneAnswer`, `executePlanStep`, `planFollowUpAnswer`):

- A game definition is controlled English (`tmct import --file .tmct/imports/games/hanoi-3.txt`);
  classes, ordering facts, and legal moves arrive as taught action rules.
- One message states the board and the goal; "solve it" (`PLAN_SOLVE_RE` — hanoi, river crossing,
  any taught-rule domain) searches the taught rules for the shortest sequence, capped by
  `tmct.toml`'s `[plan] max_depth` (default 300).
- "next" executes one move, writing `@stepN` board-snapshot facts sourced to the plan; the final
  step re-reads the store and confirms the goal from the written facts, never assuming success.
- There is no undo; "solve it" replans from the current board. Re-teaching a live plan's own piece
  mid-plan writes the change as a new whole-board `@step` snapshot layer (never a base fact, which
  the snapshots would silently contradict) and re-searches from it: a found plan is disclosed and
  held, a miss keeps the write, drops the old plan, and names the failed replan. The end-of-plan
  goal check re-searches the same way when the final board has drifted.
- The search is domain-general: the suite teaches hanoi as sentences for 1–8 disks and asserts
  2^n − 1 moves every time; `crates.txt` (different rules, a two-goal conjunction) and the river
  crossing solve with zero interpreter changes.
- `public/plan.html` (built by `scripts/build-demo-site.mjs` from `src/services/plan-viz.mjs`)
  replays the solved plan as a board@step projection and runs a live re-solve session.

### 2.4 Embodied agents — adventure, autoplay, spider-and-fly

**The adventure** (`src/services/adventure.mjs`): rooms, objects, and people are graph facts; the
verbs (`go`, `take`, `open`, `unlock`, …) are taught action rules, not hard-wired code. Every move
writes `@turnN` snapshot facts; `foldWorldState` derives the current state; `worldActionRows`
keeps the playable state to `world:`-provenance rows, so a fact the player teaches mid-game reads
back as prose but never moves a prop. Two agent-relevant mechanisms:

- **The NPC scheduler** (`runNpcPass`): an NPC with `mgx:acts-on-turn`/`mgx:acts-toward` facts
  moves on its own schedule, only through a taught `go` signature and a real exit, writing the
  same `@turnN` facts a player move writes, and narrating only what the player's room can see.
- **The staff-knowledge model**: `mgx:knows-where`, `mgx:knows-objective`, `mgx:knows-about`
  facts give household members live pointers into the current fold. They reach the player only
  through the talk lane, which resolves each pointer at ask time; the look digest excludes them
  so a room description cannot spoil the puzzle.

**Goal-directed autoplay** (`src/services/adventure-autoplay.mjs`): plays a loaded world by
itself. It infers the goal from one generic marker fact (`mgx:is-objective`), reasons only over
`exposedFacts` — the rooms this run has actually moved into — and makes every move as the same
plain command string a human types, through the identical `adventureTurn`. It reports a stall the
moment no further move is justified.

**Spider and fly** (`src/services/spider-fly.mjs`, world in `src/domain/spider-fly-world.mjs`,
page in `src/services/spider-fly-viz.mjs`): two sides play themselves over one graph, neither
player-controlled. Each agent holds a belief state under partial observability
(`believedCellOf`/`nearestBelievedTarget`, `vision_radius` Chebyshev sight): a spider chases what
it believes it sees, plans web-laying paths with `planSpiderPath` over `findActionPath`, and
avoids other spiders; a fly wanders or evades. Mass, starvation, eggs, and hatching run through
`runEcologyPass`. Addressing a side directly (`@spider the fly is east`) teaches it a belief,
true or false, and a wrong one misleads it while the real target stays out of sight. Every rate
is a `tmct.toml` `[games.spider-fly]` knob; the mechanic is pinned in
`test/corpus/games/spider-fly.jsonl`.

### 2.5 The tool loop for external agents

- `src/tools/definitions.mjs` — 25 declared tools (`TOOL_DEFINITIONS`): 3 hot (`tmct_context`,
  `tmct_snippet`, `tmct_ask` — schemas resident every turn) and 22 cold (served via
  `tmct cli <tool>`); dispatch in `src/tools/server.mjs`, catalog in `src/tools/catalog.mjs`. Two
  of the 22 cold tools, `tmct_ingest` and `tmct_export` (shipped 2026-07-21/22), are declared and
  dispatched but sit outside both the capability registry and `EXCLUDED_FROM_REGISTRY` — the same
  shape `tmct_related` had before its 2.7.12 fix (`CAPABILITIES_2.11.0.md` row 210). Reachable today
  via `/ingest`/`/export` in chat and `tmct cli`, not via the router's NL resolution.
- `src/surfaces/http/server-http.mjs` — the Anthropic-Messages-API-compatible `POST /v1/messages`
  shim behind `tmct serve`; `e2e/server-http.test.mjs` drives a real
  request → `tool_use` → `tool_result` → `end_turn` loop against a live process.
- `src/adapters/repository-interface.mjs` — `INTERFACE_VERSION` 1.1.0, 16 services, closed
  `EDGE_KINDS`/`MISS_REASONS`; provider in `src/adapters/providers/graph-service.mjs`;
  `runConformance` in `src/tools/conformance.mjs`.
- In production outside this repo: seonix's `tmct-provider.mjs` reuses `createGraphService`
  directly (since seonix 0.8.0), and bedrock-meter's router carries a tested rank-0 ($0) tmct
  rung gated on `agentbench/envelope.json`.

### 2.6 Learning on a miss

The cleanest kind of miss (recognised word, clean parse, no facts) consults shipped packs before
giving up, and what it learns lands in the ordinary provenance-tagged memory graph:

- `corpus/child/` (93k everyday triples) and the reference pack answer cold asks; live Wikipedia
  is a per-session opt-in with four modes (`/wiki on|off|supplement|always` — `supplement` adds
  live citations to grounded answers, `always` widens the term fallback to an ordinary ask's
  object).
- Every ingest runs a bounded auto-synthesis pass around the new term
  (`synthesiseAroundTerm`, budget `AUTO_SYNTHESIS_BUDGET` 12, threaded as `synthesisBudget`
  through `runTurn` and settable per browser session).
- Miss routing is surface-aware (2026-07-22): `runTurn`'s `uiContext` ("cli" default, "browser"
  from a web entry) points a browser miss at the teach lane instead of the CLI-only
  `--repo`/`tmct init` remedy.

Two Phase-1 pieces stay built but inactive: the wider general-knowledge seed set
(`corpus/tier2/general.jsonl`, 49 rows, config-gated off alongside the aws/python/java bundles)
and context-preserving unknown-word ingestion (`src/adapters/corpus/unknown-ingest.mjs` behind
`captureUnknownContext`, default false, set only by its own test).

### 2.7 Rule synthesis (offline harness)

`synthbench/rules/` is a working CEGIS loop over the goal-reasoner's own rule language: labeled
examples round-trip through agentbench's `parseCases`; `enumerate.mjs` bounds the candidate
grammar; `oracle.mjs` verifies a candidate by running it through the real `goalReason`;
`synthesize.mjs` synthesizes a novel rule (not hand-written anywhere in `goal-reasoner.mjs`)
against held-out examples at 0% fabrication, deterministically. `synthbench/phrasing/` is the
phrasing sibling. Tests: `test/adapters/synth-rules.test.mjs`, `synth-phrasing.test.mjs`. This is
harness-side machinery; nothing in the product path loads a synthesized rule yet.

### 2.8 The offline agentic loops

Both keep LLMs on the eval side, per the constitution:

- `SKILL_BENCHMARK_CEFR_ENGLISH.md` — the autonomous chat tuning cycle (LLM-as-judge).
- `SKILL_AGENT_STRATEGY_ADVISOR.md` — the background strategy-advisor recipe that rides it.

### 2.9 Measurement

- `agentbench/` — 68 cases over the TOOL-0…TOOL-8 ladder, four deterministic driver arms
  (stub/shim/resolver/goal). The goal arm clears every rung: 68/68, `rungReached: TOOL-8`,
  `gatedAt: null`, 0% hallucination. Write-up: `BENCHMARK_AGENT_2.11.0.md` (2026-07-23, byte-identical
  to `BENCHMARK_AGENT_2.7.12.md` on every rung — no router commit landed in the window);
  method: `SKILL_BENCHMARK_AGENT.md`.
- `agentbench/envelope.json` — the machine-readable capability envelope, regenerated
  deterministically (`node agentbench/generate-envelope.mjs`), stamped 2.11.0;
  `maxContextTokens` stays `null` because agentbench measures no token accounting.
- Abstention is structural: 0% fabrication across 479 inference rows and 0% hallucination across
  272 agent rows (`BENCHMARK_INFERENCE_2.11.0.md`, `BENCHMARK_AGENT_2.11.0.md`, both byte-identical
  to their 2.7.12 predecessors).
- `CAPABILITIES_2.11.0.md` is the newest capabilities audit; per `SKILL_CAPABILITIES_AUDIT.md`
  §5, it is the ground truth this doc's baseline follows.

## 3. The arc — shipped, in flight, proposed

**Shipped** (details in §2; earlier build narrative in this file's git history):

- Phase 0 foundations in full: the cross-repo HTTP smoke test, the capability envelope, the
  extension-pack seam (`src/services/extensions.mjs`, `tmct extend --validate`), ontology and
  grammar tracks, the RI wrapper uplift (`INTERFACE_VERSION` 1.1.0), hub-dampened memory ranking
  (`src/adapters/memory/blocks.mjs`), memory versioning (`snapshotMemory`), session-scoped actor
  trust, and the SHACL ingest gate (`src/adapters/memory/shacl.mjs`). The one reversal: the
  `ace-owl` package extraction shipped and was reverted the same day (2026-07-10);
  `src/domain/grammar/ace.mjs` is the real implementation.
- Phase 1's mechanism: the `[bias]` table (`src/domain/memory/bias.mjs`), bias-weighted ranking,
  `tmct init --with-persona`. Bias reorders, never drops; a genuine tie still refuses and lists.
- Everything §2.3–§2.7 describes: the plan lane and its worlds, the adventure with NPCs and staff
  knowledge, goal-directed autoplay, the spider-fly two-agent ecology, learn-on-miss with the
  synthesis budget, and the synthbench CEGIS harness. The memory store gained a sqlite backend
  (default; `src/adapters/memory/core.mjs`).

**In flight / built-but-dormant:**

- The wider general-knowledge seed set and unknown-word ingestion (§2.6) — activation is a
  decision plus a measurement pass, and nothing more to build.
- Four corpus rows freeze known-wrong chat answers at the discourse/temporal edge, each named for
  the behavior a fix must flip (`test/corpus/games/compositional.jsonl`):
  `games/bare-type-discourse-filter-unbuilt`, `games/cross-turn-temporal-composition-unbuilt`,
  `games/honest-empty-echoes-raw-pronoun`, `games/temporal-adverb-read-as-object-term`.
- RI telemetry (`src/services/telemetry.mjs`) wraps every graph service but is exercised only by
  direct RI callers and tests, not the live `dispatchTool` path.

**Proposed** (the old Phases 2–5, none started; all cross-repo work is gated on the operator):

| Track | What ships | Depends on |
|---|---|---|
| marginalia interpreter | `seon-mcp` provider adapter; NL→SPARQL "Formulate" as the real validation target; the mechanical-chat replacement (SPARQL-backed RI adapter + a vocab compiler from `vocab.mjs`) | extension-pack seam (shipped) |
| seonix combined index | mount seonix's graph beside tmct's own ontology/lexicon; one chat surface over "this repo" and "software engineering" at once | extension-pack seam (shipped) |
| scrape→teach pipeline | an HTML-extraction tool feeding scraped prose into the shipped teaching surface | chat-taught relations (shipped) |
| pluggable LLM rung | Claude Code hardening (an external-proposal validation seam over `call-validator.mjs`), a Bedrock live wire test + upstream assessor, an OpenAI-Chat-Completions shim for Copilot BYOK | envelope.json (shipped) |

## 4. Gap assessment — how far from "enough"

Against §1's target, stage by stage. The one-line answer: **the loop itself is complete and
measured at demo scale; what remains is mostly serving seams and cross-repo integration, not core
capability.**

| # | Capability the target needs | Status | Evidence / gap |
|---|---|---|---|
| A | Multi-step tool planning over declared capabilities | **Present** | 68/68, TOOL-8, 0% hallucination (§2.9) |
| B | Goal deduction (maintenance goals from the graph) | **Present** | goal-reasoner (§2.2) |
| C | Planning over taught rules | **Present** | plan lane + router taught lane (§2.2, §2.3) |
| D | Act-verify loop with per-step records | **Present** | `@stepN`/`@turnN` snapshots; goal confirmed by re-reading the store |
| E | Autonomy under partial observability, with belief state | **Present at demo scale** | autoplay's exposure filter; spider-fly beliefs (§2.4) |
| F | Multi-agent worlds | **Present at demo scale** | spiders/flies, NPCs (§2.4) |
| G | Learning on a miss | **Present** | child/reference/wiki + synthesis budget (§2.6) |
| H | Programmatic plan surface | **Present** | the library export and `POST /v1/plan` on `tmct serve` both run the whole loop; a refusal is an in-band 200, never a protocol error |
| I | Validating externally proposed calls | **Present** | a transcript ending on an assistant `tool_use` is a caller proposal: `hallucinationsIn` checks it, then execute or refuse with the taxonomy reason (`stop_reason: "refusal"` + `tmct_checked_call`) |
| J | Replanning on world change | **Present** | a mid-plan board teach writes a new whole-board snapshot layer and re-searches from it (disclosed), and the end-of-plan goal check re-searches on drift; the router's RECOVER branch replans one step |
| K | Cross-turn discourse record | **Partial** | prev-set anaphora lanes work; three of the four frozen rows are flipped (pronoun-naming honest-empty, temporal-adverb strip, bare-type filter); row 19 (cross-turn temporal composition) waits on the typed record (DRT-lite, R1) |
| L | Goal recognition (inferring a goal from behavior) | **Absent, one scoped instance** | autoplay's marker-based inference is world-scoped; the bounded (N+1) scheme is an R1 spike |
| M | The four cross-repo mounts | **Partial** | seonix and the bedrock rung ship; marginalia (both tracks) and the Copilot shim do not |
| N | Synthesized rules in the product path | **Offline prototype** | synthbench CEGIS works; product wiring unscoped |
| O | Wider seeds + unknown-word ingestion | **Present** | `tier2-general` activates per repo via `tmct.toml` like its siblings; `capture_unknown_context` is a `[seed]` knob, on in the shipped config (measured: a no-op for the curated bundles, bounded capture for raw conceptnet) |

**Ranked closure list** (nearest first; day-scale estimates, single agent). H, I, J, O and the
near half of K closed 2026-07-23/24 (see the gap table's evidence column); what remains:

1. **M — Bedrock live wire test + assessor** (~2–3 days, cross-repo). The two named gaps: the
   wire format has never been proven end-to-end between the released packages, and nothing
   produces the `{score, confidence, needs}` classification `route()` consumes.
2. **M — the Copilot/OpenAI-Chat-Completions shim** (~2–3 days). A second protocol adapter over
   the same `runTurn`/`dispatchTool` engine the Messages shim wraps.
3. **M — the seonix combined index** (several days, cross-repo). Mount the graph through the
   extension seam; re-verify RI depth at the combined scale.
4. **M — the marginalia interpreter** (a week-plus, cross-repo; the largest single chunk). The
   SPARQL-backed RI adapter and the `vocab.mjs`→corpus compiler; most bridging is mechanical,
   the `Capability` entries per relation need real authoring.
5. **N — product-side rule synthesis** (spike first). The oracle and enumerator exist; what a
   taught-in-chat synthesis surface should look like is unscoped.
6. **K (far half) and L — DRT-lite and bounded goal recognition** (research spikes, R1 below).
   Row 19 of the compositional lane is DRT-lite's standing acceptance test.

Sequencing: 1–4 need the sibling repos and operator coordination; 5–6 start as spikes, not
builds.

## 5. Research horizon

Tiered by hardness. Planning literature summaries live in `docs/references/planning/`
(STRIPS/PDDL, partial-order planning, NONLIN, BDI goal-driven autonomy, Steel & Ho); paper notes
in `docs/references/papers/`.

**R1 — nearest, worth a scoping spike:**

- **Bounded (N+1) goal recognition** — a symbolic scheme bounded to N declared goals plus an
  explicit reject class. Autoplay's `mgx:is-objective` inference is a first, world-scoped
  instance of the shape; the general scheme is unbuilt.
- **DRT-lite typed discourse record** — a bounded structure tracking entities and relations
  across turns, feeding slot-filling. The four frozen rows in §3 are its acceptance tests.

**R2 — real but distant:** a hand-built closed-domain dependency/categorial grammar (recorded so
it isn't rediscovered from scratch); a cross-repo shared trust vocabulary (needs marginalia to
keep its LLM-decision confidence at persistence time first — an integration spec between two
existing systems, not research).

**R3 — frontier-open, record-not-commit:** open-world relevance bounding (the frame problem —
closed-world planning is shipped here; no settled deterministic engineering exists yet for the
open-world side, so those requests land on the miss wall); Winograd-class coreference (same
status); a merged cross-domain ontology at the ~2M-word scale (unattempted in the literature this
research found; §3's bias mechanism changes what a future assessment should weigh, since
disambiguation no longer relies on narrowness alone).

## 6. Non-goals

A pruning record, so these aren't re-asked:

- Bias weighting overriding refusal — rejected; bias only breaks ranking ties.
- marginalia's full actor-lifecycle trust machinery — tmct adopts only per-source reliability.
- Sibling publish candidates from the ACE work (fuzzy matcher, block ranker) — permissive JS
  alternatives exist.
- Chronograph-style temporal diffing — a validity-interval graph model plus a browser front end;
  multi-day, and seonix itself hasn't wired it as a tool. Stays on the quality backlog, not in a
  phase.
