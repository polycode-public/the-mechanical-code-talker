# CAPABILITIES_1.7.3.md — tmct capability audit (refresh 6, overlay over `CAPABILITIES_1.6.0.md`)

**Pinned at commit `981c9b2` ("chore: bump version to 1.7.3"), `package.json` `1.7.3`, 2026-07-11.**

**Naming note.** This audit was requested as "the 1.7.0 capabilities audit" — the four current
`BENCHMARK_*.md` reports are all named `_1.7.0` (the last version any of them was actually
re-measured at). But `package.json` has moved to `1.7.3` since then via three small fix commits
(`d955b25`, `76b0a0d`, plus the docs-only `d362a4c`), none of which re-ran a benchmark. Per
`SKILL_CAPABILITIES_AUDIT.md` §1's own convention — name after whichever `package.json` version is
current when the audit runs, not the version of the evidence it cites — this file is
`CAPABILITIES_1.7.3.md`. The evidence sources are still, correctly, the four `_1.7.0` reports: no
newer benchmark measurement exists to cite.

This is an **overlay audit** over `CAPABILITIES_1.6.0.md` (pinned `b461ecd`), not a from-scratch one.
`git diff --stat b461ecd..981c9b2 -- src/ bin/ package.json` touches exactly 9 source files plus the
version string:

```
src/domain/ask-vocab.mjs | src/domain/ask.mjs | src/services/chat.mjs | src/domain/codegraph.mjs
src/domain/interpret/strategies/{grammar,keywords,noise-strip}.mjs
src/adapters/memory/core.mjs | src/services/sessions.mjs | package.json (version only)
```

Every other file in `src/`/`bin/` is byte-identical to the `1.6.0` pin. Four background sub-agents
fanned out across the 92-row catalog (rows 1-30, 31-64, 65-92, plus a dedicated "what's new" sweep),
each re-verifying against the real code at this pin rather than trusting `CAPABILITIES_1.6.0.md`'s
word — per `SKILL_CAPABILITIES_AUDIT.md` §2's full-scope discipline. **Zero status regressions found**
across all 92 carried-forward rows. Six genuinely new capabilities shipped in this window with no
prior catalog row (93-98, §1). `npm test`: **1919/1919 green**, checked in the foreground this cycle.

This cycle also cross-checked `TOO_HARD_AUDIT.md` (added `d362a4c`, after `CAPABILITIES_1.6.0.md`'s
pin) directly against current code — two of its four action items (M1, U1) turned out to already be
resolved, one (M2) had its diagnosis sharpened, and one (B1) had its wording fix applied. Full account
in `TOO_HARD_AUDIT.md` itself; summarized in §2 below.

---

## Comparative agent-capability table: tmct vs. named models, and a speculative TO-BE

**Read this framing before the table, not after.** tmct is not a general-purpose LLM and this is not
an IQ-style "tmct is as smart as X" claim. tmct is a narrow, deterministic, zero-cost system, hand-
built grammar plus ontology plus graph reasoning over a bounded domain. It has never attempted open-
ended generation, coding, creative writing, or general reasoning. Rows are a GENERAL agent-capability
taxonomy (tool use, planning, reasoning, grounding, memory, instruction-following, generation, coding,
safety/honesty, autonomy), not tmct's own internal benchmark names. The point is to place tmct on a
scale a reader already recognizes, not to grade it against a rubric tmct itself designed. Columns are
the same five named models prior audits used, re-confirmed here as still the right set:

- **Llama 3.1 8B Instruct** (Meta, open-weight, laptop/single-GPU class, the small/local tier)
- **Amazon Nova Pro** (AWS's own strongest general-purpose model, served on Bedrock)
- **Claude Haiku 4.5**, **Claude Sonnet 5**, **Claude Opus 4.8** (Anthropic's small to mid to large tier)

Every tmct cell is backed by a real number from the four CURRENT reports: `BENCHMARK_AGENT_1.7.0.md`,
`BENCHMARK_CEFR_ENGLISH_1.7.0.md`, `BENCHMARK_CONVERSATION_1.7.0.md`, `BENCHMARK_INFERENCE_1.7.0.md`.
Model-column verdicts are informed estimates from general knowledge of those models' public capability
tiers, not a measured cross-benchmark result — re-confirmed against current capability, none moved
since `CAPABILITIES_1.6.0.md`.

**Quick-reference (verdict only, see the full table below for the "why" per cell):**

```
┌─────────────────────────────┬────────────────────────┬──────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
│         Capability          │          tmct          │ Llama 3.1 8B │   Nova Pro    │   Haiku 4.5   │   Sonnet 5    │   Opus 4.8    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Tool use / function calling │ closed router          │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Planning & decomposition    │ bounded ladder         │ Comparable   │ Comp-Stronger │ Comp-Stronger │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Reasoning (multi-hop)       │ 219/219 + 80/80, 100%  │ Comparable   │ Comparable    │ Comparable    │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Knowledge grounding         │ 0% fabrication         │ Weaker       │ Weaker        │ Comparable    │ Comparable    │ Comparable    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Memory & context            │ session, 3 backends    │ Weaker       │ Comparable    │ Comparable    │ Comp-Stronger │ Comp-Stronger │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Instruction following       │ 109/109 tier-1, 0 fail │ Weaker       │ Comparable    │ Comparable    │ Comp-Stronger │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ NL generation & fluency     │ extractive (growth tgt)│ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Code generation             │ none                   │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Safety/honesty calibration  │ refusal + real answers │ Weaker       │ Weak-Comp     │ Comparable    │ Comparable    │ Comparable    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Autonomy / external action  │ none                   │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
└─────────────────────────────┴────────────────────────┴──────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
```

| General agent capability | tmct — measured evidence | Llama 3.1 8B | Amazon Nova Pro | Claude Haiku 4.5 | Claude Sonnet 5 | Claude Opus 4.8 |
| --- | --- | --- | --- | --- | --- | --- |
| **Tool use / function calling** | Unchanged since `CAPABILITIES_1.6.0.md`: closed, rule-based router over a FIXED toolset. `BENCHMARK_AGENT_1.7.0.md` — 100% plan-completion, 98% result-completion, 0% hallucination, byte-identical to `1.5.7`'s table (router/planner untouched this window; `git log` confirms newest touch to `src/domain/router/`/`agentbench/` is still the same pre-`1.5.7` commit) | **Stronger** — genuine open-ended function-calling over arbitrary declared tools | **Stronger**, plus reliable multi-tool composition | **Stronger** | **Stronger** | **Stronger** |
| **Planning & multi-step task decomposition** | Unchanged: same AGENTBENCH A0–C2 ladder, every gate PASS, bounded to pre-defined rungs. One honest gap unchanged (`ab-c2-what-to-test`) — see §2 for its sharpened diagnosis this cycle | **Comparable** — general planning exists but noisier than tmct's deterministic bounded ladder | **Comparable-to-stronger** | **Comparable-to-stronger** | **Stronger** | **Stronger** — handles open-ended plans tmct's fixed rungs can't represent |
| **Reasoning (logical / multi-hop inference)** | Unchanged: `BENCHMARK_INFERENCE_1.7.0.md` — the first re-confirmation cycle since `1.6.0`, same numbers (kernel 80/80, chat 219/219, both 100% completion / 0% fabrication) — this session's own diff (`src/domain/ask.mjs`/`chat.mjs`/`codegraph.mjs`/`memory/core.mjs`/`sessions.mjs`) never touches `src/domain/syllogise.mjs` or `infbench/`, so this is a clean re-confirmation of unchanged reasoning-engine code, not new measurement | **Comparable** on short chains, **Weaker** as chain depth/ambiguity grows | **Comparable** | **Comparable** | **Stronger** | **Stronger** — arbitrary-depth reasoning, not capped at a fixed ladder depth |
| **Knowledge grounding / retrieval (avoiding fabrication)** | **Improved this cycle.** 0% fabrication remains structural. `BENCHMARK_CEFR_ENGLISH_1.7.0.md`: mean up to 1.750/2 (from 1.710), **0 hard fails** (from 1), tier-1 **109/109** (from 108/109) — traced to `1.6.1`'s already-shipped fixes carrying forward, not new lever work this cycle, but the number is real and current | **Weaker** — no RAG discipline out of the box | **Weaker** bare call / **Comparable** with a real grounding harness | **Comparable** under strict grounding+citation prompting | **Comparable** | **Comparable** — best self-calibrated uncertainty of the five, but still probabilistic |
| **Memory & multi-turn context retention** | **Extended this cycle.** Session-scoped persistent graph, 3 pluggable storage backends, anaphora/focus carried within a session — unchanged. New: edges now carry a `createdAt` stamp and nodes get a derived `updatedAt` (`src/adapters/memory/core.mjs`, `src/domain/codegraph.mjs`'s `derivedUpdatedAt`), and the hub-avoiding `spiralExpand` traversal generalizes past the code graph to walk the memory graph itself (row 93) — groundwork for `PLAN_VIZ.md`, not yet exposed on any user-facing surface | **Weaker** — context-window/attention degradation over long sessions | **Comparable** | **Comparable** | **Comparable-to-stronger** | **Comparable-to-stronger** |
`ROADMAP.md` explicitly commits to closing, via richer template/surface-realization variety and verified paraphrase-alongside-original, not an 
| **Autonomy / external action (browsing, files, computer use)** | Unchanged: none, read-only chat against a local graph | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented |

**The pattern, re-confirmed this cycle**: tmct still beats or matches every model here on zero-
fabrication grounding and deterministic instruction adherence, and this cycle's real move is
qualitative, not just numeric — the safety/honesty row's refusal discipline went from "honest but a
dead end" to "honest and genuinely useful," the exact upgrade `TOO_HARD_AUDIT.md`'s M1 finding called
for, delivered the same day the finding was written.

### Speculative TO-BE — where the table could move, if the backlog lands

Purely speculative, not a roadmap commitment. Drawn fresh from the four current reports' own "Next"/
decision-log sections and the current `NEXT.md`, checked directly against code. Two items from
`CAPABILITIES_1.6.0.md`'s own TO-BE list have shipped and are removed; two are unchanged:

- ~~"`am-tests-cover` and `g-a1-naming-9` should not be expected to move"~~ — **half-resolved,
  already tracked as such in `CAPABILITIES_1.6.0.md` §2 itself**; `g-a1-naming-9` has now ALSO moved
  this cycle (M1, §2 below) — both CEFR weak spots this audit lineage has tracked since `1.5.7` are
  now closed.
- ~~"A future cycle wanting the CEFR number to move on this still needs to run one"~~ — **done**,
  `BENCHMARK_CEFR_ENGLISH_1.7.0.md` (though the actual +0.040 mean gain traces to already-shipped
  `1.6.1` fixes carrying forward, not new lever work this cycle — see that report's own "What moved"
  section).

What's left, still open, checked directly against current code:

- **`ROADMAP.md`'s new "Ambition" section** (added this cycle, operator directive) — Llama-3-level NL
  fluency via template/surface-realization variety, breadth-first ambiguity resolution generalized
  everywhere, and verified paraphrase-alongside-original via `syllogise.mjs`. Nothing built yet; this
  is the single biggest lever on the NL-generation-and-fluency row above if it lands.
- **`ab-c2-what-to-test`'s composing gap** (row 51, `TOO_HARD_AUDIT.md` M2) — diagnosis sharpened
  this cycle: the ranking mechanism it needs already exists and works
  (`src/domain/router/goal-reasoner.mjs:421-431`); the real gap is the request never dispatches into the
  rule that owns that composition step. Next pickup: trace the goal-classification step for this
  exact request shape.
- **`PLAN_CONVERSATION.md` Finding 4** — anaphoric "SUBJECT verb which N" misroutes into
  teach-a-fact. Bounded, three sub-problems, a concrete first-increment sketch exists (`NEXT.md`).
- **A rephrase-hint pass on honest "nothing matches" misses** (`BENCHMARK_CEFR_ENGLISH_1.7.0.md`'s
  top decision-log pick) — 7+ cases across B1/C1 score zero on the judge's rephrase dimension despite
  being correct, honest misses that offer no nudge toward a working question.
- **Persona-sweep routed backlog** (`BENCHMARK_CONVERSATION_1.7.0.md`) — ESL phrasing gaps, a
  file-vs-symbol anaphora scoping miss, fragment-typer typo-tolerance misses, identity-question
  phrasing fragility. All scoped for `SKILL_AGENT_FAST_LOOP.md`, none picked up yet.
- **A dual-draw or full-pool CEFR run** before the next release — carried over from `1.6.0`'s and
  `1.7.0`'s own decision logs, still not done.
- **New CEFR case(s) modeled on the reverse CapableOf/HasA/inherits frames** (row 95) — the current
  109-case pool structurally cannot score this capability at all (no default-persona/no-`--repo`
  case exists) — a scope decision for a future cycle.
- **`PLAN_SYLLOGIST.md`'s retraction-aware, incremental reasoning research** — unchanged, "not a
  near-term default" per `NEXT.md`.

---

## 0. Scope note (carried forward)

`CAPABILITIES_1.5.7.md` restored the full 83-row original catalog plus 9 new rows (84-92), correcting
a scope narrowing across two prior refreshes. `CAPABILITIES_1.6.0.md` carried the full 92 forward
with no narrowing. This audit adds 6 genuinely new rows (93-98, §1) — the first growth since 92 — and
narrows nothing. No row is dropped, and no row's evidence is assumed without direct re-verification
against the code at this pin.

---

## 1. Full status table — 98 rows, re-verified against `981c9b2`

**Status key:** `implemented` · `partial` · `undocumented` · `claimed-only` · `explicit scope
decision` (unchanged since refresh 1). Rows 1-92 were fanned out across three background sub-agents,
each re-checking cited evidence directly against the real code at this pin — not trusting
`CAPABILITIES_1.6.0.md`'s word. **Zero status regressions found.** Rows 93-98 are new.

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline (grammar/keyword/noise-strip/fuzzy) | implemented | `src/domain/interpret/pipeline.mjs`, `merge.mjs`, `strategies/{ace,constructions,grammar,keywords,noise-strip}.mjs` all present | evidence detail changed: `grammar.mjs` (`ARTICLE_RELATION_CONTINUATIONS` guard), `keywords.mjs` (inherits-object fix), `noise-strip.mjs` (new `maybeVerbNoiseWords` POS gate) each got additive disambiguation fixes this window; pipeline shape/status unaffected |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | `src/domain/grammar/ace.mjs`, `src/domain/grammar/lexicon.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 3 | ACE-OWL parser extracted to standalone MPL-2.0 npm package | reverted (unchanged) | `packages/` still absent from this worktree | unchanged since `CAPABILITIES_1.6.0.md` |
| 4 | OWL 2/RDF/RDFS + SEON core ontology grounding | implemented | `ontology/tmct-core.ttl` | unchanged since `CAPABILITIES_1.6.0.md` |
| 5 | Template libraries / response phrase book | implemented | `src/adapters/corpus/templates.mjs`, `data/templates/` | unchanged since `CAPABILITIES_1.6.0.md` |
| 6 | Filtered ConceptNet corpus slice (opt-in) | implemented | `corpus/conceptnet/`, `src/adapters/corpus/conceptnet.mjs:32-41` | unchanged since `CAPABILITIES_1.6.0.md` |
| 7 | Conversational memory as its own OWL-labelled graph (3 backends) | implemented | `src/adapters/memory/core.mjs:185-233` (Backend A flat-json / B in-memory / C sqlite) | evidence detail changed: added `mgx:updatedAt` own-attribute-mutation stamping and edge-level `createdAt` in `upsertEdge`; 3-backend split unaffected |
| 8 | Input normalization pass | partial (unchanged shape) | `src/domain/interpret/normalize.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 9 | Graph-provider adapter contract (Repository Interface, 15 services) | implemented | `src/adapters/repository-interface.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 10 | Runnable conformance/compatibility test suite for RI providers | implemented | `src/tools/conformance.mjs:60` `runConformance` | unchanged since `CAPABILITIES_1.6.0.md` |
| 11 | Library-first design, stable `exports` map (18 entry points) | implemented | `package.json`, re-verified, still 18 subpaths | unchanged since `CAPABILITIES_1.6.0.md` |
| 12 | Ink console TUI shell | implemented | `src/surfaces/tui/app.mjs:33` | unchanged since `CAPABILITIES_1.6.0.md` |
| 13 | Calculation surfaced as reasoning (counts/comparisons via templates) | implemented | `via:"template"` provenance, `src/services/chat.mjs:1230,3031,3374,6798,7068,7152` | unchanged since `CAPABILITIES_1.6.0.md`; all cited sites re-confirmed live despite `chat.mjs` growing +324/-8 lines this window |
| 14 | Optionally running linters/tests to observe | claimed-only | no such code found | unchanged since `CAPABILITIES_1.6.0.md` |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | claimed-only (deliberate) | `PLAN_CODE.md` still frames this door as deliberately shut | unchanged since `CAPABILITIES_1.6.0.md` |
| 16 | Response-finishing grammar pass over segmented answers | partial (unchanged shape) | `src/services/finish.mjs:31,35,38` | unchanged since `CAPABILITIES_1.6.0.md` |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `bin/tmct.mjs:63,573,589,594` | unchanged since `CAPABILITIES_1.6.0.md` |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `src/domain/syllogise.mjs`; wired at `bin/tmct.mjs:795-808` | unchanged since `CAPABILITIES_1.6.0.md` |
| 19 | `cax-dw` disjointness entailment rule (INF-B1) | implemented | `src/domain/syllogise.mjs:127` `CAX_DW_RULE` | unchanged since `CAPABILITIES_1.6.0.md` — `syllogise.mjs` byte-identical (not a changed file this window) |
| 20 | `cax-sco` type-propagation entailment rule | implemented | `src/domain/syllogise.mjs:115` `CAX_SCO_RULE` | unchanged since `CAPABILITIES_1.6.0.md` |
| 21/24 | Actor-level, session-scoped source trust (Laplace/add-k) | implemented | `src/domain/memory/trust.mjs:112` `computeTrust` | unchanged since `CAPABILITIES_1.6.0.md` |
| 22 | Consistency checking / cardinality entailment / proof-chain materialization (INF stages 4-5) | implemented | `src/domain/syllogise.mjs`: `findConsistencyViolations`, `buildCardinalityRestrictions`, `proveCardinalityAtLeast`, `proveMaxCardinalityZeroDenial` | unchanged since `CAPABILITIES_1.6.0.md` |
| 23 | Unified provenance/trust primitive (Source individuals) | implemented | `src/domain/memory/trust.mjs:88,198` | unchanged since `CAPABILITIES_1.6.0.md` |
| 25 | Memory-tree versioning (`snapshotMemory`, manual-trigger) | implemented | `src/adapters/memory/core.mjs:636` (was `:629`) | evidence line shifted (earlier-in-file additions: `UPDATED_AT_PROP` const); behavior unchanged |
| 26 | Automatic, deterministic contradiction detection | implemented | `src/adapters/memory/core.mjs:1690` `findContradictions` (was `:1669`) | evidence line shifted; behavior unchanged |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/adapters/memory/blocks.mjs:249` | unchanged since `CAPABILITIES_1.6.0.md` |
| 28 | Extension-pack / corpus-lexicon loading seam (default bundle flipped) | implemented | `src/services/extensions.mjs:303` `seedActiveCorpusEntries` | unchanged since `CAPABILITIES_1.6.0.md` |
| 29 | Bias-weighted ambiguity resolution | implemented | `src/domain/memory/bias.mjs:71` `rankByBiasThenTrust` | unchanged since `CAPABILITIES_1.6.0.md` |
| 30 | `tmct init --with-persona <name>`, size-tier flag | implemented | `bin/tmct.mjs:562` | unchanged since `CAPABILITIES_1.6.0.md` |
| 31 | Tier-2 general-knowledge corpus bundle (legacy, inactive by default) | implemented, legacy | `corpus/tier2/general.jsonl` | unchanged since `CAPABILITIES_1.6.0.md` |
| 32 | A wider general-knowledge seed set grown beyond tier2 | implemented | `corpus/tier2/human*.jsonl` | unchanged since `CAPABILITIES_1.6.0.md` |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `src/adapters/corpus/conceptnet.mjs:167-210` (`captureUnknownContext`, default `false`, no production caller sets it true) | unchanged since `CAPABILITIES_1.6.0.md` |
| 34 | SHACL-style declarative ingest gate | implemented | `src/domain/memory/shacl.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 35 | Cross-repo HTTP smoke test | implemented | `test/server-http-smoke.test.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 36 | Machine-readable capability envelope | implemented, version field stale | `agentbench/envelope.json:4` `"agentbenchVersion": "1.4.1"` | doc-lag persists another cycle — still 1.4.1 through 1.6.0 and now 1.7.3 |
| 37 | Ontology-hierarchies tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, default-off | `src/services/chat.mjs:3879` (was `:3739`) | evidence line shifted (`chat.mjs` grew ~316 net lines this window); status unchanged |
| 38 | Ontology-hierarchies tracks c+d (SEON spine) | implemented, default-off | `ontology/tmct-core.ttl` | unchanged since `CAPABILITIES_1.6.0.md` |
| 39 | Advanced-grammar: subordination/conditional preamble frames | implemented | `src/domain/interpret/normalize.mjs:358-537` | unchanged since `CAPABILITIES_1.6.0.md` |
| 40 | Advanced-grammar: construction-grammar template bank | implemented | `src/domain/interpret/strategies/constructions.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 41 | Chat-taught relations & rules (6 items) | implemented, **surface grew** | `src/services/chat.mjs` — `PLAN_TAUGHT_RELATIONS.md` Items 1-6 markers all present; **new**: 4 reverse-query readers in `factAnswer` (`CAN_ASK_RE`/`WHAT_CAN_DO_RE`/`WHAT_HAS_RE`/`WHAT_INHERITS_RE`, ~`chat.mjs:4093-4162`) plus an `ISA_IDIOM_ROLE_WORDS` guard fixing a false "unknown relation" answer | **strengthened since `CAPABILITIES_1.6.0.md`**: still `implemented`, query-side surface for chat-taught relations grew 4 new lanes (also see row 95, the user-facing capability this enables) |
| 42 | `findActionPath` (bounded successor BFS) | implemented, not wired to a real domain | `src/domain/planning.mjs:94` | unchanged since `CAPABILITIES_1.6.0.md` — `planning.mjs` byte-identical |
| 43 | `findReachableSet` (reachability enumeration) | implemented, wired into chat | `src/domain/planning.mjs:199`; call site `src/services/chat.mjs:5068,5076` | unchanged since `CAPABILITIES_1.6.0.md` |
| 44 | Towers-of-Hanoi goal-directed planning loop | claimed-only | `PLAN_HANOI.md:3` "Status: RESEARCH / DESIGN — not yet implemented" | unchanged since `CAPABILITIES_1.6.0.md` |
| 45 | "I am thinking of a number" closed-loop game | claimed-only | `PLAN_GUESS_NUMBER.md:3` "Status: RESEARCH / DESIGN — not yet implemented" | unchanged since `CAPABILITIES_1.6.0.md` |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `synthbench/{phrasing,rules}/` | unchanged since `CAPABILITIES_1.6.0.md` |
| 47 | Program synthesis Tracks 2-4 (Playwright sandbox) | claimed-only, sign-off-gated | no `playwright` in `package.json` | unchanged since `CAPABILITIES_1.6.0.md` |
| 48 | Completions pipeline Stage 0 (broad search + grouping) | implemented | `src/domain/completions/search.mjs`, `group.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 49 | Completions pipeline Stage 2 (extractive ranking) | implemented | `src/domain/completions/rank.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 50 | Completions pipeline wired into a user-facing chat answer path | implemented, gap closed | `src/services/chat.mjs:6475` `completionsRescueAnswer` (was `:6177`) | evidence line shifted; wiring unchanged |
| 51 | Capability router, full 6-stage stack | implemented, **now invokable by a real user** | `src/domain/router/{registry,resolver,planner,guardrail,goal-reasoner,call-validator,set-algebra,drive,results}.mjs` | **changed**: the 6-stage stack itself is unchanged (byte-identical, `BENCHMARK_AGENT_1.7.0.md`), but a real audit finding this cycle was that nothing outside `agentbench/`/tests could ever reach it — no CLI subcommand, no chat command, no library export. Closed via row 99: `tmct plan`/chat's `/plan`/`@polycode-projects/the-mechanical-code-talker/plan`. |
| 52 | `POST /v1/messages` HTTP shim | implemented | `src/surfaces/http/server-http.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 53 | bedrock-meter $0-rung routing integration | implemented in the sibling repo, not here | `PLAN_AGENTS.md:642` "Not started" (tmct's side) | unchanged since `CAPABILITIES_1.6.0.md` — `PLAN_AGENTS.md` byte-identical since its pin |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md:642` "Not started" | unchanged since `CAPABILITIES_1.6.0.md` |
| 55 | `seon-mcp` (marginalia) provider adapter | claimed-only | `PLAN_AGENTS.md:639,85` "Not started" | unchanged since `CAPABILITIES_1.6.0.md` |
| 56 | marginalia "mechanical chat" replacement by tmct | claimed-only | `PLAN_AGENTS.md:86` "Not started — the real open work" | unchanged since `CAPABILITIES_1.6.0.md` |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md:640` "Not started" | unchanged since `CAPABILITIES_1.6.0.md` |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md:641` "Not started" | unchanged since `CAPABILITIES_1.6.0.md` |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet/pagination) | implemented | `src/adapters/providers/graph-service.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `src/adapters/source-slice.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 61 | Telemetry wrapper on every RI service | implemented, not exercised live | `src/services/telemetry.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 62 | Chronograph-style temporal diffing | claimed-only, genuinely hard | no such code found | unchanged since `CAPABILITIES_1.6.0.md` |
| 64 | Dialogue-flow playtest ladder, Tiers 0-6 | implemented | `test/chatflow-tier{0,1-single-touch,2,2-drilldown,4,5,6}.test.mjs`; tier0+tier1 re-run directly, 17/17 pass | unchanged since `CAPABILITIES_1.6.0.md` |
| 65 | CHATBENCH graded-pool ladder | implemented | `chatbench/graded-pool.jsonl` (109), `graded-pool-max.jsonl` (1,075); `BENCHMARK_CEFR_ENGLISH_1.7.0.md`: mean 1.750/2, 0 hard fails, tier-1 109/109 | **changed**: now measured by `_1.7.0.md` instead of `_1.5.7.md`; mean and hard-fail count both improved (see §2) |
| 66 | AGENTBENCH agentic ladder (A0-C2) | implemented | `agentbench/cases.jsonl` (56); `BENCHMARK_AGENT_1.7.0.md`: rung-for-rung identical to `_1.5.7.md` | **changed**: now re-confirmed and cited via `_1.7.0.md`, numbers unchanged |
| 67 | INFBENCH classical-logic ladder | implemented | `infbench/results/raw/run-1.7.0/`; `BENCHMARK_INFERENCE_1.7.0.md`: both arms 100%/0% through INF-C2, kernel 80/80, chat 219/219 | **changed**: now measured by `_1.7.0.md`, first re-confirmation cycle since `1.6.0`, numbers unchanged |
| 68 | Strategy-advisor background-agent watch process | implemented (process), dormant | `STRATEGY_ADVISOR.log` (8 entries, last 2026-07-11 16:55Z); no live process | unchanged since `CAPABILITIES_1.6.0.md` |
| 69 | Segmentation IR + concept force | implemented | `src/domain/concept.mjs`, `src/services/finish.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 70 | Negation as bounded set complement | implemented | `src/domain/router/set-algebra.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 71 | Reversible-passive traversal | implemented | `test/ask-negation-passive.test.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 72 | Compound-name resolution in `resolveObject` | implemented | `src/domain/ask.mjs:2860` (was `:2810`) | evidence line shifted; logic identical |
| 73 | Same compound-symbol matching extended to `/describe`'s resolver | still claimed-only / named gap | `src/domain/codegraph.mjs:164` `resolveSymbol` — still exact/path-suffix/substring tiers only, no compound matching | unchanged since `CAPABILITIES_1.6.0.md` |
| 74 | Reverse-`inherits` "the"-definite forms | still claimed-only / named gap | `src/domain/ask-vocab.mjs:58-72,255-266` | unchanged since `CAPABILITIES_1.6.0.md` |
| 75 | Cochange phrasing variants + "multi-root" over-match | still open | `BENCHMARK_CONVERSATION_1.5.7.md`'s original "X and Y `<verb>`" finding — standing evidence, gap unfixed | citation refreshed: old `ROADMAP.md:326-327,351-352` pointer is dead — `ROADMAP.md` was rewritten forward-looking-only and no longer names this gap anywhere; tracked here instead |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md:644` "Not started" | unchanged since `CAPABILITIES_1.6.0.md` |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md:644` "Not started" | unchanged since `CAPABILITIES_1.6.0.md` |
| 78 | Winograd-hard commonsense coreference | claimed-only, deliberately out of reach | `PLAN_AGENTS.md:646` | unchanged since `CAPABILITIES_1.6.0.md` |
| 79 | A shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md:646` | unchanged since `CAPABILITIES_1.6.0.md` |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `src/tools/server.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV-Scanner, provenance) | implemented | `.gitlab-ci.yml` | unchanged since `CAPABILITIES_1.6.0.md` |
| 82 | Predicate "find" queries | implemented | `src/domain/ask.mjs:966,1028` (`parseSuperlative`, `parseFind`) | unchanged since `CAPABILITIES_1.6.0.md` |
| 83 | Single-sourced `fnv1a` hash + wink browser-loader seam | implemented | `src/domain/hash.mjs:19,30`; `src/adapters/wink-model.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 84 | SQLite memory Backend C | implemented | `src/adapters/memory/core.mjs:299` `createSqliteMemoryStore` | unchanged since `CAPABILITIES_1.6.0.md` |
| 85 | In-memory Backend B | implemented | `src/adapters/memory/core.mjs:217` `createInMemoryStore` | unchanged since `CAPABILITIES_1.6.0.md` |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `bin/tmct.mjs:675`; `src/services/cli-args.mjs` | unchanged since `CAPABILITIES_1.6.0.md` |
| 87 | Default human-world persona + Small/Medium/Large content tiers | implemented | `corpus/tier2/human*.jsonl`, `PLAN_SEED.md` | unchanged since `CAPABILITIES_1.6.0.md` |
| 88 | `graphService` adapter wired into the completions pipeline | implemented | `src/domain/completions/graph-adapter.mjs` | unchanged since `CAPABILITIES_1.6.0.md`; **this is the fix `TOO_HARD_AUDIT.md`'s U1 finding didn't know had already shipped — see §2** |
| 89 | Public package exports for `generateCompletion`/`createCompletionsGraphAdapter` | implemented | `package.json` `exports`, lines 60-61 | unchanged since `CAPABILITIES_1.6.0.md` |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | implemented | commits `21eb6a2`, `d04a926` | unchanged since `CAPABILITIES_1.6.0.md` |
| 91 | Persona-sweep as the conversation benchmark's default single-run mode | process change | `SKILL_BENCHMARK_CONVERSATION.md:50,407` §3.4 | unchanged since `CAPABILITIES_1.6.0.md` |
| 92 | Multi-candidate lexicon/parse ambiguity resolution | implemented, **materially strengthened** | `src/domain/grammar/lexicon.mjs:177,218`, `src/domain/grammar/ace.mjs:244`, `src/services/chat.mjs:2778`, `src/domain/ask.mjs:3518-3544` (`renderCore`) | **changed since `CAPABILITIES_1.6.0.md`**: commit `d955b25` makes the ambiguity-surfacing branch RESOLVE and render every candidate's real answer, not just describe it — see §2 |
| — | `PLAN_ADVENTURE.md` | claimed-only, RESEARCH/DESIGN | `PLAN_ADVENTURE.md:1` header, unchanged | unchanged since `CAPABILITIES_1.6.0.md` |
| 93 | Memory-graph-aware `spiralExpand` traversal | implemented (library-level, not CLI-wired) | `src/domain/codegraph.mjs:762` `spiralExpand(graph, scored, {kinds, classPredicate, idNormalizer, seeds})`, `:598` `MEMORY_SPIRAL_EXPAND_KINDS`, `:869` `mostRecentIndividual()` | **new** — `spiralExpand` previously only walked code-graph Modules via one hardcoded call site; now generalizes to walk the memory graph (Session/Fact/Source) with a caller-supplied class predicate and id-normalizer. `PLAN_VIZ.md` groundwork; no CLI/`--focus` wiring yet |
| 94 | Edge/node provenance timestamps (`createdAt`/derived `updatedAt`) | implemented | `src/adapters/memory/core.mjs` `UPDATED_AT_PROP = "mgx:updatedAt"`; `upsertEdge()` stamps `createdAt` first-write-wins; `src/domain/codegraph.mjs:1292` `derivedUpdatedAt(graph, ind, {...})`; explicit stamps at `upsertSession`, `recomputeFactTrust`, `recomputeSourceReliability` | **new** — no prior row covered temporal/provenance metadata on memory-graph edges or nodes. `PLAN_VIZ.md` groundwork |
| 95 | Reverse fact-cascade query shapes (CapableOf/HasA/inherits) against the general-knowledge persona | implemented | `src/services/chat.mjs:4032-4048` `CAN_ASK_RE`/`WHAT_CAN_DO_RE`/`WHAT_HAS_RE`/`WHAT_INHERITS_RE`, wired into `factAnswer` (`chat.mjs:4164-4239`) | **new** — "can a dog bark", "what has a tail", "what inherits from horse" now resolve against corpus/taught facts instead of a code-graph-flavored miss. Row 82 ("find" queries) is a different, code-graph mechanism; no prior row covered reverse-by-object querying of these predicates. `PLAN_CONVERSATION.md` Finding 5 |
| 96 | Forward-shape query entityType grain-checking (`forwardGrainMiss`) | implemented | `src/domain/ask.mjs:480` `classesForKinds(graph, kinds)`; forward branch `src/domain/ask.mjs:3198-3215` declines honestly when the asked `entityType` can never appear among a kind's real target classes | **new** — extends the reverse-shape branch's pre-existing filter/decline discipline to the forward branch, which previously had none ("what modules does X have" silently answering with function names). `PLAN_CONVERSATION.md` Finding 3 |
| 97 | Possessive-named-instance teach shape ("my `<class>` `<name>` is a `<class>`") | implemented | `src/services/chat.mjs`, `teachLane`'s `stripPossessiveNamedInstance` (commit `1ccd298`) | **new** — "my cat whiskers is a cat" now teaches; previously a hard grammar wall (3-token subject, no existing frame matched). Found via `BENCHMARK_CONVERSATION_1.7.0.md`'s persona sweep |
| 98 | Bare known class/entity name → describe/focus, zero-verb | implemented | `src/services/chat.mjs:7041-7059`, `runAsk` block `(2c)` | **new** — "task", "usercontroller" (real class names, no verb at all) now get a real describe-style answer via `metaFallbackEntityAnswer`, closing the last layer of a gap `BENCHMARK_CONVERSATION_1.7.0.md` found (a prior fix already covered the "what is X" wrapper). Commit `76b0a0d` — confirm this before trusting that report's own "not committed" text, which is stale at authoring time (see that file's correction note) |
| 99 | Capability router invocation surface — `tmct plan`, chat `/plan`, library export | implemented | `bin/tmct.mjs` (`plan` subcommand), `src/services/chat.mjs` (`/plan` command), `src/domain/router/drive.mjs` (`buildCapabilityPlanCtx`/`runCapabilityPlan`, exported as `./plan`), `test/router-drive.test.mjs` | **new** — closes row 51's reachability gap. `tmct plan "of the modules impacted by X, which are untested"` composes and executes a real multi-step plan; a request neither the resolver nor the planner grounds escalates to the goal-reasoner (`tmct plan "what most needs a test in this codebase"`); an unresolvable request is an honest "no plan found", never a crash. Does NOT change chat's own default `<question>` dispatch — asking the SAME questions without `/plan` still goes through `runAsk`'s existing miss-cascade, untouched; row 51's separate `ab-c2-what-to-test` composing note (§2) is about that default path, not this new explicit command |

**Stale evidence-citation sweep, not a status change**: rows 37, 50, 25, 26, 72 have shifted line
numbers only (`chat.mjs`/`ask.mjs`/`memory/core.mjs` grew net lines this window from unrelated
additions earlier in the file) — content and behavior at the new lines re-confirmed identical.

---

## 2. Ambiguity-resolution & `TOO_HARD_AUDIT.md` synthesis

### Item 92's fix, and what it retires

`CAPABILITIES_1.6.0.md` §2 already established that item 92's `assertTurn`/lexicon-candidate
machinery is structurally unreachable by any of the four benchmarks' case pools (no Pattern-3
declarative teach statement with 2+ readings exists in any of them). That finding still holds — this
cycle adds nothing to it directly. What changed is the OTHER ambiguity-surfacing path: `ask.mjs`'s
`renderCore()`, reached via `traverse()`'s `ambiguousParse` result (a different, older mechanism than
item 92's `assertTurn` branch, but the same general "honest ambiguity, not a guess" discipline).

Before commit `d955b25`: an ambiguous parse rendered as "this could mean more than one thing: 1) X or
2) Y — try rephrasing more specifically" — each candidate only DESCRIBED, never actually answered.
After: `renderCore()` (`src/domain/ask.mjs:3518-3544`) traverses and renders every branch for real, so the
combined answer carries both readings' genuine content and reproduces identically on the same input.

(`"could mean more than one thing"` + `meta "imports"` for `am-meta-imports`; `"imports is a
predicate…"` for `g-a1-naming-9`) — no compromise, no test weakened. `TOO_HARD_AUDIT.md`'s "researched
unstuck angle" for M1 named this exact fix; it shipped the same day the finding was written. See
`TOO_HARD_AUDIT.md`'s own RESOLVED section for the full account, including the two harmless stale
citations left in `BENCHMARK_CEFR_ENGLISH_1.7.0.md`'s per-case transcript prose (below its own
correction note, not misleading, just not yet swept).

### `TOO_HARD_AUDIT.md` cross-check — full account

This audit re-verified all four of `TOO_HARD_AUDIT.md`'s action items directly against code, not just
its own prose (that doc was added at `d362a4c`, after `CAPABILITIES_1.6.0.md`'s pin, so it's new
territory for this catalog):

- **M1 (imports/mean) — RESOLVED**, commit `d955b25`. See above.
- **U1 (`broadSearch` "deeper architectural limit") — RESOLVED**, and it turns out it was already
  resolved a full day *before* `TOO_HARD_AUDIT.md` was even written: `src/domain/completions/graph-adapter.mjs`
  (commit `798a77f`, 2026-07-10) already wires `broadSearch()` to the live graph and the Fact store via
  `createCompletionsGraphAdapter(graph, memory)` — this catalog's own row 88 already tracked it as
  `implemented` since `CAPABILITIES_1.5.7.md`. `TOO_HARD_AUDIT.md`'s own finding cited a stale,
  superseded doc (`CAPABILITIES_1.5.0.md`) without cross-checking the current catalog first — the
  sharpest evidence in this whole cycle that "re-derive against current code, never assume" is a real
  discipline, not a formality: even a doc built specifically to hunt stale claims produced one of its
  own by not checking the live catalog it was sitting next to.
- **M2 (AGENTBENCH `ab-c2-what-to-test`) — still open, diagnosis sharpened.** Live-verified (re-ran
  the exact case via `node agentbench/run.mjs --driver goal --ladder`): the keystone-ranking mechanism
  M2 asked for already exists and works (`src/domain/router/goal-reasoner.mjs:421-431`, a declared-priority
  argmax over `|impact(m)|`). The real gap is narrower than M2's original text — the request never
  dispatches into the rule that owns that composition step at all (only `tmct_untested` gets called,
  never `tmct_impact`; the GDA expansion at `goal-reasoner.mjs:388-393` never fires for this request
  shape). `BENCHMARK_AGENT_1.7.0.md` confirms the case still plan-correct/result-incomplete, consistent
  with this trace. Still the top open item — see the TO-BE list above.
- **B1 (ROADMAP/NEXT "out of design-ability horizon" wording) — applied.** Both docs reworded in
  this same pass to match `PLAN_CONVERSATION.md`'s own milder, accurate framing ("large, three
  sub-problems, not attempted in a single pass").

Net effect: of `TOO_HARD_AUDIT.md`'s 4 action items, 2 are now resolved (both were already fixed
before or the same day the finding was written — this doc's hunt works), 1 has a sharper diagnosis,
1 had a pure wording fix applied.

---

## 3. Benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md` (AGENTBENCH)

- Router/goal-reasoner surface, all 56 cases, A0-C2 ladder — **complete**, unchanged across five
  consecutive measured versions now (`0.8.2`, `1.4.1`, `1.5.7`, `1.6.0`-equivalent, `1.7.0`).
- `ab-c2-what-to-test`'s plan-correct/result-incomplete composing gap — **todo**, diagnosis sharpened
  this cycle (§2) — a request-dispatch gap, not a missing ranking mechanism.
- Growing the ladder itself, or feeding `PLAN_CODE.md`'s Track 1 output into new case coverage —
  **todo**, unchanged.
- `agentbench/envelope.json`'s `agentbenchVersion` field — **todo**, still stale at `1.4.1` (row 36).

### `SKILL_BENCHMARK_CEFR_ENGLISH.md` (CHATBENCH)

- C2 `pronoun-binding`'s hard fails and A2 `naming-vocabulary` — **complete**, unchanged.
- A1 `naming-vocabulary`'s schema-term/common-word collision (`g-a1-naming-8/9`) — **complete**,
  fully closed this cycle. `g-a1-naming-8` fixed in `1.6.1`; `g-a1-naming-9`, previously framed
  "permanent," is now also resolved (M1, §2) — both halves of this item are done.
- `am-tests-cover`'s un-flagged ambiguity — **complete**, unchanged since `1.6.1`, confirmed still
  holding a full cycle later.
- A rephrase-hint pass on honest misses — **todo**, new top decision-log pick this cycle.
- A dual-draw or full-pool run against `graded-pool-max.jsonl` before the next release — **todo**,
  unchanged, still not done.
- New case(s) for the reverse CapableOf/HasA/inherits capability (row 95) — **todo**, new this cycle,
  a scope decision (current pool structurally can't reach it).

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH)

- A full rung table for the current version — **complete**, unchanged since `1.6.0`; `1.7.0` is a
  clean re-confirmation, same numbers, first re-confirmation cycle since the ladder closed.
- The blocking lexicon collision (`dice`/`die`, `person`/`people`, `tooth`/`teeth`) — **complete**,
  unchanged.
- A build-time lexicon-invariant check — **todo**, unchanged.

### `SKILL_BENCHMARK_CONVERSATION.md` (persona-sweep)

- 4-persona sweep, 23 dead-ends found, 2 fixed and shipped inline (garbled-teach-absorb bug,
  "good day to you" farewell misfire + possessive-instance teach wall) — **complete**, this cycle.
- Bare known-entity-name → describe/focus (item 3) — **complete**, commit `76b0a0d`, though the
  report's own text still says "not committed" (stale at authoring time — see that file's correction
  note, row 98).
- 2 stale test assertions from the ambiguity-render change — **complete**, already fixed by
  `d955b25` before the report was even committed (see correction note).
- 4-item routed backlog (ESL phrasing, file-vs-symbol anaphora, typo-tolerance, identity-question
  fragility) — **todo**, unchanged, scoped for `SKILL_AGENT_FAST_LOOP.md`, not picked up yet.
- `SKILL_BENCHMARK_CONVERSATION.md`'s own re-scope to measure-and-document-only (no more inline
  fixing) — **complete**, this cycle (`d362a4c`) — every future run routes findings out instead.

---

## 4. Plan feature-support — Done / Doing / Todo per plan

### `PLAN_AGENTS.md`

**Pinned at `3769e0f`** (byte-identical since, re-confirmed this cycle).

- **Done**: RI wrapper fixes, hub-dampened memory ranking, memory-tree versioning, actor-level trust,
  extension-pack seam, bias-weighted ranking, `tmct init --with-persona`, chat-taught relations.
- **Doing**: none currently in flight.
- **Todo**: Phases 2-5 — `seon-mcp` provider wiring (#55), marginalia's "mechanical chat" replacement
  (#56), tmct×seonix combined index (#57), marginalia web-scrape→teach pipeline (#58), bedrock-
  meter/Copilot integration on tmct's own side (#53/#54) — all still "Not started," unchanged.

### `PLAN_CODE.md`

**Pinned at `7680aa6`.**

- **Done**: Track 1, `GOAL_RULE`/`PHRASING_FRAMES` synthesis, `synthbench/{phrasing,rules}/`.
- **Doing**: none.
- **Todo**: Tracks 2-4 (bounded-mutation JS repair, HTML/CSS-fragment synthesis via a Playwright
  sandbox), each gated on its own separate operator sign-off.

### `PLAN_DID_YOU_SEE_HER_DUCK.md`

**Fully shipped and archived** — one-line note: the breadth-first dead-end-pruning technique it built
(`lookupNounCandidates`/`lookupVerbCandidates`/`parseAceAmbiguous`) is item 92, now further extended
by `renderCore`'s real-answer resolution (§2). Its named "next extension" (`noise-strip.mjs`) shipped
in `PLAN_CONVERSATION.md` Finding 2; nothing left open in this plan's own scope.

### `PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`

**Pinned at `779918d`/`be9b377`.**

- **Done**: shared reusable infrastructure — `findActionPath` (#42), `findReachableSet` (#43),
  `createSession`'s closure-threading pattern.
- **Doing**: none.
- **Todo**: both games' own domain-specific code, unchanged, "RESEARCH/DESIGN — not yet implemented."

### `PLAN_ADVENTURE.md`

**Pinned at `9328360`.**

- **Done**: none, research/design only.
- **Doing**: none.
- **Todo**: the entire scope — imperative command grammar, mutable turn-by-turn world/player state,
  an NPC turn scheduler. Unchanged.

### `PLAN_VIZ.md` — still a live root plan, not archived

**Pinned at `9510a43`** (the commit that shipped items 1-3).

- **Done**: the three scoped traversal/timestamp items — `adjacencyForKinds`'s id-normalizer +
  `relationKind`/`PROP_KIND` fix, `upsertEdge()` `createdAt` + derived `updatedAt`, `spiralExpand`'s
  generalization (rows 93-94 of this catalog).
- **Doing**: none currently in flight.
- **Todo**: the code-graph timestamp-provider architectural decision (provider-populated vs. a new
  tmct-owned local-git mode), the git-log-corpus/README-ingestion situational-fact seeding, the eager
  session/sessionless anchor individual, a rendering prototype spike (Cytoscape.js pseudo-3D depth
  layer). **Not archived this cycle**: this remaining scope is real, unbuilt feature work (a spike, a
  new corpus-generation step, an architectural call), not a minor bug fittable in `NEXT.md` or a
  too-hard research question fittable in `TOO_HARD_AUDIT.md` — it stays a live plan.

### `PLAN_CONVERSATION.md` — archived this cycle

**Pinned at `9510a43`** (Findings 1/2/3/5); Finding 4 traced live in this same window.

- **Done**: Findings 1 (adjective/noun teach-routing mint order), 2 (`noise-strip.mjs`'s stopword
  arbitrariness), 3 (forward-shape entityType grain-check, row 96), 5 (reverse CapableOf/HasA/inherits
  frames, row 95) — all RESOLVED, commit `9510a43`.
- **Doing**: none.
- **Todo**: Finding 4 only (anaphoric "SUBJECT verb which N" misroute) — real, bounded, three named
  sub-problems, a concrete first-increment sketch. **Archived this cycle** (`git mv` to `archive/`,
  status banner updated) since this is the only open item and it's small enough to track as a
  `NEXT.md` open item rather than warrant its own live root plan — matching this project's own
  convention for `PLAN_DID_YOU_SEE_HER_DUCK.md` and others above.

### `PLAN_SYLLOGIST.md`

**Pinned at `efe7cee`.**

- **Done**: none, pulled out of `PLAN_INFERENCE_TESTING.md` on that plan's retirement.
- **Doing**: none.
- **Todo**: reusing match-state across passes in `src/domain/syllogise.mjs`, plus retraction-aware,
  incremental consistency checking. "Not a near-term default" per `NEXT.md`, unchanged.

### Fully shipped and archived, one-line notes

- **`PLAN_SEED.md`** (pinned `08d0d03`) — every item done: persistence backends, CLI/config
  unification, persona content tiers, `createSession`→`initRepo` convergence.
- **`PLAN_INFERENCE_TESTING.md`** (pinned `1d31477`) — all 6 stages shipped and chat-wired,
  confirmed again this cycle by a clean `BENCHMARK_INFERENCE_1.7.0.md` re-confirmation.
- **`PLAN_COMPLETIONS.md`** (pinned `59f7466`) — all 4 staging rows shipped.

### Archived, still carrying real open scope

- **`PLAN_ADVANCED_GRAMMAR.md`** (pinned `8cd3b36`) — **Done**: tracks (a) and (d). **Todo**:
  tracks (b) DRT-lite discourse record, (e) ellipsis, (f) presupposition nudges.
- **`PLAN_ontology-hierarchies.md`** (pinned `8cd3b36`) — **Done**: stages 1-3. **Todo**:
  stage 3+ growth.

---

## 5. Non-benchmarked capabilities

Carried forward from `CAPABILITIES_1.6.0.md` §5, re-confirmed unchanged, plus new items this cycle.

- **The completions pipeline's architectural gap is closed in code** (#50/#88) — unchanged, still not
  independently re-confirmed by a fresh playtest since `1.5.7`.
- **The persona/corpus default flip** (#87) — unchanged, still invisible to CHATBENCH/AGENTBENCH/
  INFBENCH's case sets.
- **Item #92's ambiguity-refusal discipline, now materially better** — the `assertTurn` branch itself
  stays invisible to all four benchmark pools (unchanged finding, re-confirmed). But the SIBLING
  ambiguity mechanism (`renderCore`'s `ambiguousParse` branch) IS exercised by CEFR's own
  `g-a1-naming-9`/`am-meta-imports` pair, and its real-answer-resolution upgrade (§2) is the direct
  cause of that cell's improvement this cycle — a case where a non-benchmarked mechanism's sibling
  DID move a real number, worth naming explicitly rather than filing purely under "invisible."
- **Rows 93-94 (memory-graph traversal + provenance timestamps) are entirely non-benchmarked** — no
  current benchmark exercises graph visualisation or traversal metadata at all; this is `PLAN_VIZ.md`
  groundwork with no user-facing surface yet (no CLI verb calls `spiralExpand` over the memory graph).
- **Rows 97-98 (possessive-teach shape, bare-entity routing) were found by the persona-sweep
  benchmark but aren't scored by any of the three scalar benchmarks** (CEFR/AGENTBENCH/INFBENCH) —
  the conversation benchmark's own case set is qualitative transcripts, not a graded pool, so these
  fixes have no scalar number to move.
- **`NEXT.md` is no longer stale relative to this pin** — `CAPABILITIES_1.6.0.md` flagged this as
  a recurring doc-lag pattern; this audit's own pass refreshes `NEXT.md` in the same cycle, closing
  that specific instance. `agentbench/envelope.json`'s stale version field (row 36) remains the one
  standing doc-lag item.

---

## 6. Summary

**Re-verified against real code:** all 92 rows from `CAPABILITIES_1.6.0.md`, fanned out across three
background sub-agents (rows 1-30, 31-64, 65-92) plus a dedicated new-capability sweep, each
re-deriving evidence directly rather than trusting the prior doc's word. **Zero status regressions.**
**98 total rows** — up from 92, the first catalog growth since `CAPABILITIES_1.5.7.md`'s restoration.

- **Status flips since `CAPABILITIES_1.6.0.md`**: item #92 keeps `implemented` but is materially
  strengthened (§2) — the ambiguity-surfacing render now resolves real answers, not just labels.
  Items #65-67 (the three ladder benchmarks) keep their status, now cited via fresh `_1.7.0.md`
  reports. Item #41 grew 4 new query lanes without changing status.
- **New this cycle**: 6 new rows (93-98) — memory-graph `spiralExpand` traversal, edge/node
  provenance timestamps, reverse CapableOf/HasA/inherits fact-cascade queries, forward-shape grain
  safety, possessive-named-instance teach, bare-entity-name zero-verb routing.
- **`TOO_HARD_AUDIT.md` cross-check** (§2): 2 of 4 action items resolved (M1, U1 — both already fixed
  before or the same day the finding was written), 1 diagnosis sharpened (M2), 1 wording fix applied
  (B1).
- **Doc archival this cycle**: `PLAN_CONVERSATION.md` archived (only Finding 4
  remains open, tracked in `NEXT.md`). `PLAN_VIZ.md` and `PLAN_AGENTS.md` stay live — both carry
  real, substantial unbuilt scope that doesn't fit "minor bug" or "too hard."
- **Real, unresolved gaps carried forward unchanged**: #44/#45 (Hanoi/guess-number), #53-58
  (marginalia/seonix/Bedrock/Copilot integration), #73/#74 (named grammar gaps), #75 (cochange
  conjunction parsing, citation refreshed), #76-79 (research-horizon items), `TOO_HARD_AUDIT.md` M2
  (sharpened, still open), `PLAN_CONVERSATION.md` Finding 4.
- **The single most consequential finding of this refresh**: two of `TOO_HARD_AUDIT.md`'s four
  "worth acting on" findings were already resolved by the time this audit ran — one (M1) the same day
  it was written, one (U1) a full day *before* it was written, because that finding cited a stale,
  superseded prior audit instead of checking the current catalog sitting next to it. This is the
  sharpest live confirmation of `SKILL_CAPABILITIES_AUDIT.md`'s own central discipline: never assume a
  prior claim still holds, re-derive against the real code, every cycle, even inside the doc built to
  catch exactly this failure mode.
- **`npm test`**: 1919/1919 green, checked in the foreground this cycle.
