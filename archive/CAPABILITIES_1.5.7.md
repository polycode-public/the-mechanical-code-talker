# CAPABILITIES_1.5.7.md — tmct capability audit (refresh 4, full-scope restoration)

**Pinned at commit `d170196` ("docs(conversation): persona-sweep is now the default single-run
mode"), package.json `1.5.7`, 2026-07-11.** Built by re-verifying every capability directly against
this commit's actual `src/`/`bin/`/`test/` — not by carrying forward either prior audit's verdict.
Evidence sources: direct file/line reads and greps against HEAD, `git log`/`git blame` for change
attribution, `npm test`, and the four fresh benchmark reports measured this cycle —
`BENCHMARK_AGENT_1.5.7.md`, `BENCHMARK_CEFR_ENGLISH_1.5.7.md`, `BENCHMARK_CONVERSATION_1.5.7.md`,
`BENCHMARK_INFERENCE_1.5.7.md` — cited as evidence, not re-run here.

**A note on the four sections added below** (comparative table, per-benchmark and per-plan
feature-support, non-benchmarked capabilities — `SKILL_CAPABILITIES_AUDIT.md` §3, added to that skill
doc after this audit's own `d170196` pin): these were written and re-verified against a slightly later
HEAD than the rest of this audit, commit `96bfe4f` ("merge: multi-candidate ambiguity resolution +
PLAN_DID_YOU_SEE_HER_DUCK.md"), `package.json` `1.6.0` at time of writing. That range (`d170196..96bfe4f`)
contains one substantive workstream — `PLAN_DID_YOU_SEE_HER_DUCK.md`'s lexicon/parse-level ambiguity
resolution (commits `d5e962d`, `65a7752`, `c254871`, `842ffa1`) — captured as new item #92 below and
folded into the sections that follow. Nothing in the §1 status table above was re-opened or re-numbered
for this; it stays pinned at `d170196` as written.

## Comparative agent-capability table: tmct vs. named models, and a speculative TO-BE

**Read this framing before the table, not after.** tmct is not a general-purpose LLM and this is not
an IQ-style "tmct is as smart as X" claim. tmct is a narrow, deterministic, zero-cost system — hand-built
grammar + ontology + graph reasoning over a bounded domain — and it has never attempted open-ended
generation, coding, creative writing, or general reasoning. Rows are a GENERAL agent-capability
taxonomy (tool use, planning, reasoning, grounding, memory, instruction-following, generation, coding,
safety/honesty, autonomy), not tmct's own internal benchmark names — the point is to place tmct on a
scale someone would already recognize, not grade it against a rubric tmct itself designed. Columns are
specific named MODELS, not umbrella brands or hosting surfaces, the same five `CAPABILITIES_1.4.1.md`
used — re-confirmed here as still the right column set, not blindly copied forward:

- **Llama 3.1 8B Instruct** (Meta, open-weight, laptop/single-GPU class — the small/local tier)
- **Amazon Nova Pro** (AWS's own strongest general-purpose model, served on Bedrock)
- **Claude Haiku 4.5**, **Claude Sonnet 5**, **Claude Opus 4.8** (Anthropic's small → mid → large tier)

Each tmct cell is backed by a real number from this cycle's own reports — `BENCHMARK_AGENT_1.5.7.md`,
`BENCHMARK_CEFR_ENGLISH_1.5.7.md`, `BENCHMARK_CONVERSATION_1.5.7.md` — translated into the general
capability it evidences. `BENCHMARK_INFERENCE_1.5.7.md` was measurement-BLOCKED this cycle (a lexicon
fixture crash, `infbench/generate-cases.mjs` exiting 1 on the `dice`/`die` collision) — its row below
says so honestly instead of reusing `BENCHMARK_INFERENCE_1.4.1.md`'s older number. That crash is fixed
as of commit `d5e962d` (confirmed directly in this worktree: `node infbench/generate-cases.mjs` now
exits 0, 219 cases written) — a fresh full-ladder INFBENCH measurement is expected imminently/
separately, not invented here. **Every model column is an informed estimate from general knowledge of
these models' well-known public capability tiers, not a measured cross-benchmark result** — nobody has
run any of these five models against tmct's exact task shapes; each was re-confirmed against current
capability rather than blind-copied from `CAPABILITIES_1.4.1.md`, and none moved. Every model cell
below opens with a plain verdict word (Weaker / Comparable / Comparable-to-stronger / Stronger,
relative to tmct on that specific capability) followed by why.

**Quick-reference (verdict only — see the full table below for the "why" per cell):**

```
┌─────────────────────────────┬────────────────────────┬──────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
│         Capability          │          tmct          │ Llama 3.1 8B │   Nova Pro    │   Haiku 4.5   │   Sonnet 5    │   Opus 4.8    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Tool use / function calling │ closed router          │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Planning & decomposition    │ bounded ladder         │ Comparable   │ Comp-Stronger │ Comp-Stronger │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Reasoning (multi-hop)       │ ladder unmeasured      │ Comparable   │ Comparable    │ Comparable    │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Knowledge grounding         │ 0% fabrication         │ Weaker       │ Weaker        │ Comparable    │ Comparable    │ Comparable    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Memory & context            │ session, 3 backends    │ Weaker       │ Comparable    │ Comparable    │ Comp-Stronger │ Comp-Stronger │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Instruction following       │ 108/109 CEFR tier-1    │ Weaker       │ Comparable    │ Comparable    │ Comp-Stronger │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ NL generation & fluency     │ extractive only        │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Code generation             │ none                   │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Safety/honesty calibration  │ refusal + ambiguity    │ Weaker       │ Weak-Comp     │ Comparable    │ Comparable    │ Comparable    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Autonomy / external action  │ none                   │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
└─────────────────────────────┴────────────────────────┴──────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
```

| General agent capability | tmct — measured evidence | Llama 3.1 8B | Amazon Nova Pro | Claude Haiku 4.5 | Claude Sonnet 5 | Claude Opus 4.8 |
| --- | --- | --- | --- | --- | --- | --- |
| **Tool use / function calling** | Closed, rule-based router over a FIXED toolset — `BENCHMARK_AGENT_1.5.7.md`: 100% plan-completion, 98% result-completion, 0% hallucination, every rung A0–C2 gate PASS, byte-identical across three consecutive measured versions (`0.8.2`, `1.4.1`, `1.5.7`) — not general function-calling, a bounded dispatch table | **Stronger** — genuine open-ended function-calling over arbitrary declared tools | **Stronger**, plus reliable multi-tool composition | **Stronger** | **Stronger** | **Stronger** — real function-calling generalizes past any fixed router  |
| **Planning & multi-step task decomposition** | Same AGENTBENCH A0–C2 rung ladder, every gate PASS, bounded to pre-defined rungs; unchanged this cycle | **Comparable** — general planning ability exists but noisier composing steps than tmct's deterministic bounded ladder | **Comparable-to-stronger** | **Comparable-to-stronger** | **Stronger** | **Stronger** — handles open-ended plans tmct's fixed rungs structurally can't represent |
| **Reasoning (logical / multi-hop inference)** | **Unmeasured this cycle** — `BENCHMARK_INFERENCE_1.5.7.md`'s harness crashed on a `dice`/`die` lexicon fixture-lint collision before producing a rung table; the last real full-ladder result on record is `BENCHMARK_INFERENCE_1.4.1.md`'s full-gate PASS. The crash is fixed post-pin (`d5e962d`), confirmed directly: `generate-cases.mjs` now exits 0. A fresh measurement hasn't run yet — this row is honestly "blocked, not regressed," not a number | **Comparable** on short chains, **Weaker** as chain depth/ambiguity grows | **Comparable** | **Comparable** | **Stronger** | **Stronger** — arbitrary-depth reasoning, not capped at a fixed ladder depth |
| **Knowledge grounding / retrieval (avoiding fabrication)** | 0% fabrication is a structural property (INFBENCH/AGENTBENCH rows can't assert past taught/seeded facts) unaffected by this cycle's harness block; CEFR tier-1 108/109 green (`BENCHMARK_CEFR_ENGLISH_1.5.7.md`) — a STRUCTURAL guarantee, not a tuned behavior | **Weaker** — no RAG discipline out of the box | **Weaker** bare call / **Comparable** with a real grounding harness (unmeasured here) | **Comparable** under strict grounding+citation prompting | **Comparable** | **Comparable** — best self-calibrated uncertainty of the five, but still probabilistic, not a structural floor |
| **Memory & multi-turn context retention** | Session-scoped persistent graph, now with **3 pluggable storage backends** (plain repo string, in-memory, SQLite — item #7/#84/#85); anaphora/focus carried within a session; no cross-session memory beyond what's explicitly written to the graph | **Weaker** — context-window/attention degradation over long sessions, no persistent store | **Comparable** | **Comparable** | **Comparable-to-stronger** — long context window, but still no persistent cross-session memory without external tooling | **Comparable-to-stronger** |
| **Instruction following / constraint adherence** | A recognized phrasing is followed 100% of the time (rule match, not a probabilistic score); `BENCHMARK_CEFR_ENGLISH_1.5.7.md`: mean 1.724/2 (up from 1.624), tier-1 108/109, 1 judged hard fail (down from 6); unrecognized phrasing = decline or, as of this cycle, an honest "this could mean more than one thing" disambiguation prompt (item #92), never a best-effort guess | **Weaker** — occasional drift off format/constraint instructions | **Comparable** | **Comparable** | **Comparable-to-stronger** | **Stronger** — best-in-class adherence among the five, though still probabilistic |
| **Natural language generation & fluency** | **Structurally near-zero** — every reply is a template/grammar slot fill or, since the completions pipeline's chat-wiring closed (item #50/#88), extractive multi-sentence synthesis from retrieved graph/Fact content — never invented text. `BENCHMARK_CONVERSATION_1.5.7.md` confirms the pipeline is reachable live but doesn't score fluency as a scalar | **Stronger** | **Stronger** | **Stronger** | **Stronger** | **Stronger** — tmct's weakest row by construction; every model here beats it, though the gap narrowed since 1.4.1's flat "none" |
| **Safety, honesty & refusal calibration** | Structural zero-fabrication, refuses BY CONSTRUCTION when it can't ground an answer. **New this cycle**: `assertTurn` now also refuses to silently commit to one reading when a sentence has 2+ complete, independently valid parses — it renders every surviving reading and asserts nothing, rather than guessing (item #92, `PLAN_DID_YOU_SEE_HER_DUCK.md`) | **Weaker** — answers confidently from contradictory or ambiguous premises more often than it refuses | **Weaker-to-comparable** | **Comparable** | **Comparable** | **Comparable** — good calibration, but still a tuned behavior, not tmct's structural guarantee |
| **Autonomy / external action (browsing, files, computer use)** | **None** — read-only chat against a local graph; no external actions of any kind | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented (Claude's own computer-use capability) |

**The pattern, re-confirmed this cycle**: tmct still beats or matches every model here on the same two
structural axes — zero-fabrication grounding and deterministic instruction adherence — and this cycle
sharpened both further (CEFR mean up, hard fails down, plus a genuinely new refusal discipline for
parse-level ambiguity). The generation/fluency gap narrowed slightly now that completions-in-chat is
real and reachable, though it remains tmct's weakest row by construction. Reasoning is the one row that
regressed in measurability, not in substance — the engine itself carries zero commits since the version
bump and its own unit tests stay green; only the benchmark harness went dark, and only briefly.

### Speculative TO-BE — where the table could move, if the backlog lands

Purely speculative, not a roadmap commitment. Every item `CAPABILITIES_1.4.1.md` listed here has
already shipped this session — `cls-svf1`'s live wiring (superseded by the broader `scm-svf1`/
cardinality/`cax-maxc0` batch, `HANDOVER.md` "Where we are"), `src/completions/` wired into chat
(item #50/#88), and C2 `pronoun-binding` (closed, `BENCHMARK_CEFR_ENGLISH_1.5.7.md`) — so this list is
drawn fresh from the four current reports' own "Next" sections and the current `HANDOVER.md`, not
carried forward:

- **Re-run INFBENCH's full cycle now that the harness is unblocked** (`d5e962d` fixed the crash
  `BENCHMARK_INFERENCE_1.5.7.md` hit; no fresh ladder measurement has run since). This is the single
  most direct lever on the table: it would replace the **reasoning** row's "unmeasured this cycle" with
  a real number, most likely re-confirming `BENCHMARK_INFERENCE_1.4.1.md`'s full-gate PASS given
  `src/syllogise.mjs` carries zero commits since the version bump, but that is a prediction, not a
  result.
- **`BENCHMARK_CEFR_ENGLISH_1.5.7.md`'s own decision log, item 1**: the A1 `naming-vocabulary`
  schema-term/common-word collision ("what does tests/imports mean") — same bug class as the now-fixed
  A2 cell, one tier down. Landing it would trim the **instruction following** row's single remaining
  hard fail further, a small, incremental move, not a step change.
- **`BENCHMARK_CONVERSATION_1.5.7.md`'s round 3** (capped early by explicit operator instruction, not a
  dead well) — the completions-rescue lane's garbled `Q:`/`A:` output needs a cleaner repro; two other
  gaps (bare "what's ProperNoun", "X and Y `<verb>`" conjunction parsing) need an operator scope
  decision before they're fixable at all. None of these move a table row on their own, but the
  conjunction-parsing gap is the kind of grammar hole that could eventually feed the **reasoning** or
  **instruction following** rows if it's picked up.
- **`PLAN_DID_YOU_SEE_HER_DUCK.md`'s own named extension**: the same breadth-first,
  generate-candidates-then-prune-dead-ends technique it just landed for the lexicon and pattern-3 parse
  layer is explicitly NOT yet applied to `noise-strip.mjs`'s single-criterion stopword stripping (real,
  separate design work per that doc's own "What this doc is not" section). Landing it would extend the
  **safety/honesty calibration** row's new ambiguity-refusal discipline to a second pipeline stage.
- **`PLAN_SYLLOGIST_HORIZON.md`'s retraction-aware, incremental reasoning research** — explicitly
  "not a near-term default" per `HANDOVER.md`, but the one open research question on the reasoning
  engine's own horizon if the operator wants to push it further.

None of these change tmct's fundamental shape — a fixed grammar/ontology system, not a generalist —
they sharpen tmct's position on the two rows where it already competes structurally, and continue
narrowing (not closing) the generation gap via the completions pipeline. The structural-absence pattern
on the remaining rows holds regardless: tmct was never designed to plan, act autonomously, or generate
freely, and no backlog item on this list changes that scope.

---

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
| 92 | Multi-candidate lexicon/parse ambiguity resolution (`lookupNounCandidates`/`lookupVerbCandidates`, `parseAceAmbiguous`, `assertTurn` ambiguity surfacing) | implemented, new row — **post-`d170196` pin, confirmed against commit `96bfe4f`** | `src/grammar/lexicon.mjs` (`lookupNounCandidates`, commit `d5e962d`; `lookupVerbCandidates`, `65a7752`), `src/grammar/ace.mjs` (`parseAceAmbiguous`, `c254871`), `src/chat.mjs` (`assertTurn`'s ambiguity branch, `842ffa1`); live-verified: `printf 'senior duck mock module.\n/exit\n' \| node bin/tmct.mjs` returns both surviving readings and asserts neither, per `PLAN_DID_YOU_SEE_HER_DUCK.md`'s own transcript | Fixes the `dice`/`die` lexicon collision that crashed `infbench/generate-cases.mjs` (`BENCHMARK_INFERENCE_1.5.7.md`) by generalizing to a breadth-first, generate-then-prune-dead-ends resolution strategy at both the lexicon and pattern-3 parse layer, instead of a word-specific carve-out. `npm test`: 1866/1866 throughout. Not on the prior 91-row catalog at all — genuinely new since this audit's own `c958e95` pin |
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

**Post-pin update**: "fixing the generator first" has since happened — `d5e962d` (item #92) lands the
structural fix this section's own evidence pointed at, confirmed directly in this worktree
(`node infbench/generate-cases.mjs` now exits 0, 219 cases). No fresh ladder measurement has been run
against the unblocked harness yet, so the "last real ladder measurement on record" sentence above still
holds — this update closes the *blocker*, not the *measurement gap*.

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

- Router/goal-reasoner surface, all 56 cases, A0–C2 ladder — **complete**, unchanged across three
  consecutive measured versions (`0.8.2`, `1.4.1`, `1.5.7`); `BENCHMARK_AGENT_1.5.7.md`'s own "what
  moved" section confirms nothing, via `git log` over the router/`agentbench/` path returning a
  single docs-only commit.
- `ab-c2-what-to-test`'s plan-correct/result-incomplete composing gap — **todo**, unchanged since
  `0.8.2`, a deliberately-honest limit rather than a bug.
- Growing the ladder itself (new C2+ cases) or feeding `PLAN_CODE.md`'s program-synthesis Track 1
  output into new case coverage — **todo**, `BENCHMARK_AGENT_1.5.7.md`'s own "Next" section names
  both as the only remaining leverage on a fully gate-passing surface.

### `SKILL_BENCHMARK_CEFR_ENGLISH.md` (CHATBENCH)

- C2 `pronoun-binding`'s 4 hard fails (`g-c2-pron-3/7/8/10`) — **complete**, traced to `a24e628`; all
  four now score `groundedness:2, correctness:2, honesty:2`.
- A2 `naming-vocabulary`'s 2 hard fails (`g-a2-naming-2/6`) — **complete**, traced to `07f4805`; both
  now 2.0/2.0. Mean 1.624 → 1.724, hard fails 6 → 1 (0.9%) across both fixes combined.
- A1 `naming-vocabulary`'s schema-term/common-word collision (`g-a1-naming-8/9`, "what does
  tests/imports mean") — **todo**, the same bug *class* as the now-fixed A2 cell, one tier down;
  `BENCHMARK_CEFR_ENGLISH_1.5.7.md`'s decision-log pick for next cycle.
- `am-tests-cover`'s un-flagged ambiguity ("which tests cover b.mjs" resolves confidently instead of
  asking the user to narrow) — **todo**, unchanged for two straight cycles now (`1.4.1`, `1.5.7`).
- A full-pool run against `graded-pool-max.jsonl` (1,075 cases) before the next release — **todo**,
  the right exception-case trigger per `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1's own footnote, not a
  routine-cycle default.

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH)

- A full rung table for `1.5.7` — **todo**, blocked this cycle: `infbench/generate-cases.mjs` crashed
  on a lexicon fixture bug before writing a cases file (§3.1 above); `SKILL_BENCHMARK_INFERENCE.md`'s
  own discipline explicitly allows "the harness itself is broken" as a legitimate reportable outcome.
- The blocking lexicon collision (`dice`/`die`, `person`/`people`, `tooth`/`teeth`) — **complete**,
  fixed post-pin by `d5e962d`'s determiner-agreement generalization (`PLAN_DID_YOU_SEE_HER_DUCK.md`,
  item #92) rather than either of `BENCHMARK_INFERENCE_1.5.7.md`'s own two proposed minimal fixes;
  confirmed directly in this worktree, `node infbench/generate-cases.mjs` now exits 0 (219 cases).
- A fresh full-ladder measurement against the now-unblocked harness — **todo**, not yet run; expected
  as an imminent, separate cycle per the comparative table's own reasoning row above.
- A build-time lexicon-invariant check (rejecting a new noun headword that collides with an existing
  noun's `plural` field before it lands in `lexicon-core.json`) — **todo**,
  `BENCHMARK_INFERENCE_1.5.7.md`'s own "structural fix" recommendation, not built this cycle (the
  `d5e962d` fix above closes the immediate crash a different way, at the parse layer, not by adding
  this build-time guard).

### `SKILL_BENCHMARK_CONVERSATION.md` (capped sprint / persona-sweep)

- Round 1 — 3 dead-ends found and fixed (`e74a335`): the closing-filler exemption, `describeWrapperAnswer`'s
  focus-carry repair, and its trailing-discourse-tag stripping — **complete**. The focus-carry fix is
  this cycle's highest-value shipped fix: it repairs the core "describe X → it/that follow-ups"
  drill-down pattern the product's own README leads with.
- Round 2 — 1 dead-end found and fixed (`60505e6`): `existentialAnythingRewrite` for "is there anything
  that `<verb-phrase>`" — **complete**.
- Round 3 — **todo**, capped early by explicit operator instruction, not because the well ran dry
  (both rounds that ran shipped a real fix). The completions-rescue lane's garbled-output repro is the
  natural round-3 opener.
- Bare "what's ProperNoun" grammar shape (no wrapper verb) — **todo**, needs an operator scope
  decision, not a quick routing fix.
- "X and Y `<symmetric-verb>`" bare-conjunction subject parsing for cochange (item #75) — **todo**,
  needs an operator scope decision; the sibling "does X cochange with Y" form already works.
- Completions-rescue lane's garbled `Q:`/`A:` output under specific session histories — **todo**, real
  (seen once in round 1's own transcript) but didn't reproduce cleanly on a second attempt.
- Regression suite growth (6 new tests, `test/chatflow-conversation-1.5.7-round{1,2}.test.mjs`) —
  **complete**. Persona-sweep as this benchmark's default single-run mode (item #91) — **complete**.

---

## 5. Plan feature-support — Done / Doing / Todo per plan (restructured this cycle)

`CAPABILITIES_1.4.1.md` §4 used prose paragraphs ending in a "which benchmark uplift helps most"
note. This cycle restructures that into three clean bulleted buckets per plan, per
`SKILL_CAPABILITIES_AUDIT.md` §3.3 — a fully archived plan with nothing left open gets a one-line
note instead of three near-empty lists. Covers every currently-live root-level `PLAN_*.md` doc,

### `PLAN_AGENTS.md`

**Pinned at `3769e0f`.**

- **Done**: RI wrapper fixes, hub-dampened memory ranking, memory-tree versioning, actor-level trust,
  extension-pack seam, bias-weighted ranking, `tmct init --with-persona`, chat-taught relations
  (own §1 "Ground truth" table); the persona/CLI-unification batch this doc's §3 flagged open is now
  shipped — see `archive/PLAN_SEED.md` below.
- **Doing**: none currently in flight.
- **Todo**: Phases 2-5 — `seon-mcp` provider wiring (item #55), marginalia's "mechanical chat"
  replacement (#56), tmct×seonix combined index (#57), marginalia web-scrape→teach pipeline (#58),
  bedrock-meter/Copilot integration on tmct's own side (#53/#54) — all still "Not started" per the
  plan's own §1 table, unchanged since `CAPABILITIES_1.5.0.md`.

### `PLAN_CODE.md`

**Pinned at `7680aa6`.**

- **Done**: Track 1 — `GOAL_RULE`/`PHRASING_FRAMES` synthesis, `synthbench/{phrasing,rules}/`,
  0% call fabrication, held-out-checked (item #46).
- **Doing**: none.
- **Todo**: Tracks 2-4 (bounded-mutation JS repair, HTML/CSS-fragment synthesis via a Playwright
  sandbox) — "unsigned-off and untouched," each gated on its own separate operator sign-off per the
  plan's own §8 (item #47).

### `PLAN_DID_YOU_SEE_HER_DUCK.md`

**Pinned at `8fc285e`.**

- **Done**: `lookupNoun`→`lookupNounCandidates` grammatical-agreement pruning (`d5e962d`);
  `lookupVerb`→`lookupVerbCandidates` (`65a7752`); `parseAceAmbiguous`, the breadth-first
  dead-end-pruning scan over pattern-3 verb-position splits (`c254871`); `assertTurn` wired to check
  it first and render a "this could mean more than one thing" reply, committing nothing on genuine
  ambiguity (`842ffa1`). Live-proven with a real CLI transcript in the plan doc itself. `npm test`:
  1866/1866 throughout (item #92).
- **Doing**: none — the plan's own header states "Status: IMPLEMENTED," all four staged steps done.
- **Todo**: the same breadth-first technique is explicitly NOT yet applied to `noise-strip.mjs`'s
  single-criterion stopword stripping (real, separate design work, its own wide regression surface);
  not generalized to the other 7 ACE patterns beyond pattern 3, out of this doc's concrete scope by
  its own "What this doc is not" section.

### `PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`

**Pinned at `779918d`/`be9b377`.**

- **Done**: shared reusable infrastructure — `findActionPath` (bounded successor BFS, item #42),
  `findReachableSet` (item #43), `createSession`'s closure-threading pattern.
- **Doing**: none.
- **Todo**: both games' own domain-specific code (`legalMoves`/`boardToFacts` for Hanoi, a `game`
  session slot for guess-the-number) — both plans still headed "RESEARCH/DESIGN — not yet
  implemented" per their own status lines (items #44/#45), unchanged since `CAPABILITIES_1.4.1.md`.

### `PLAN_ADVENTURE.md`

**Pinned at `9328360`.**

- **Done**: none — research/design only.
- **Doing**: none.
- **Todo**: the entire scope — an imperative command grammar, mutable turn-by-turn world/player
  state, and an NPC turn scheduler, validated against a country-house-mystery text adventure. Nothing
  in the document is live code, per its own header.

### `PLAN_CONVERSATION.md`

**Pinned at `61cb7e6`.**

- **Done**: none — explicitly "research/design notes, nothing implemented," a holding doc for two
  findings graduated out of the fast loop's safe-fix scope, the same role `PLAN_SYLLOGIST.md` plays
  for reasoning-engine research.
- **Doing**: none.
- **Todo**: Finding 1 (an unknown "every X is Y" always mints Y as a class, never a property — the
  mint fallback has no POS check); Finding 2 (`noise-strip.mjs`'s dependence on wink's generic
  stopword list is arbitrary and can corrupt resolution, not just fail to help — the same root shape
  `PLAN_DID_YOU_SEE_HER_DUCK.md` names as its own natural next extension, see that plan's Todo above).

### `PLAN_SYLLOGIST.md` (title: `PLAN_SYLLOGIST_HORIZON.md`)

**Pinned at `efe7cee`.**

- **Done**: none — pulled out of `archive/PLAN_INFERENCE_TESTING.md` on that plan's own retirement as
  a place to point a future session, not a to-do list.
- **Doing**: none.
- **Todo**: making `src/syllogise.mjs` reuse match-state across passes instead of re-scanning from a
  fresh snapshot every call, plus retraction-aware, incremental consistency checking under a hard
  budget and trust tiers. Per `HANDOVER.md`: "not a near-term default," the one open research question
  on the reasoning engine's own horizon.

### Fully shipped and archived — one-line notes, not bucketed (nothing left open)

- **`archive/PLAN_SEED.md`** (pinned at `08d0d03`) — every item ever scoped is done: persistence
  backends (Backend B+C), CLI/config unification, Small/Medium/Large persona content tiers, the
  `createSession`→`initRepo` auto-init convergence. `npm test` at archival time: 1866/1866. The single
  largest completed body of work since `CAPABILITIES_1.5.0.md`.
- **`archive/PLAN_INFERENCE_TESTING.md`** (pinned at `1d31477`) — all 6 stages shipped and chat-wired;
  its one open research question (retraction-aware incremental reasoning) was extracted into
  `PLAN_SYLLOGIST.md` rather than lost on archival.
- **`archive/PLAN_COMPLETIONS.md`** (pinned at `59f7466`) — all 4 staging rows shipped, including the
  `graphService` adapter that closed item #50's remaining architectural gap.

### Archived, but still carrying real open scope per `ROADMAP.md`'s "Later: deferred "

- **`archive/PLAN_ADVANCED_GRAMMAR.md`** (pinned at `8cd3b36`) — **Done**: track (a) closed-frame
  subordination/conditionals (item #39), track (d) construction-grammar template bank (item #40).
  **Todo**: track (b) DRT-lite typed discourse record (item #77), track (e) ellipsis (depends on (b)),
  track (f) presupposition nudges — `ROADMAP.md`'s own "Later" note lists tracks b/d/e as "not
  landed," which conflicts with (d) being independently confirmed implemented per item #40; flagged
  as a minor doc-lag in `ROADMAP.md`, not re-litigated here. Track (c) beyond a narrow clause-splitter
  stays a recorded negative finding, not scheduled.
- **`archive/PLAN_ontology-hierarchies.md`** (pinned at `8cd3b36`) — **Done**: stages 1-3, ConceptNet
  Synonym/SimilarTo wiring and SEON `disjointWith` growth (items #37/#38, both now default-off per
  the persona flip, see #28). **Todo**: stage 3+ growth beyond what shipped this wave, per
  `ROADMAP.md`'s "Later" note — cardinality/arithmetic threads this plan flagged as a shared premise
  layer for `archive/PLAN_INFERENCE_TESTING.md`, not yet extended further.

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

**New this cycle**: the multi-candidate ambiguity resolution work (item #92) is structurally invisible
to all four scalar benchmarks in a specific way — it doesn't move a score, it changes what tmct
REFUSES to score. None of AGENTBENCH/CHATBENCH/CONVERSATIONBENCH/INFBENCH's case sets contain a
sentence engineered to have 2+ complete, independently valid parses, so none of them can exercise the
new `assertTurn` disambiguation branch at all — the only evidence for it is the live CLI transcript in
`PLAN_DID_YOU_SEE_HER_DUCK.md` itself. It did, incidentally, fix a real measurement blocker (INFBENCH's
own harness crash), which is a second, distinct way this kind of gap surfaces: not just "shipped but
unmeasured" but "shipped, and the fix for a completely different bug turned out to route through it."

---

## 7. Summary

**Re-verified against real code:** all 83 of the original catalog's rows, plus 9 new rows (84-92) for
capabilities that shipped since `_002` and don't fit any existing row (91 of those pinned at
`d170196`; item #92 confirmed against the later `96bfe4f`, see the note after the header). That is
**92 total rows**, restoring and extending refresh 1's original 83-capability scope rather than
continuing either prior refresh's delta-only narrowing. This cycle also restores the four sections
`SKILL_CAPABILITIES_AUDIT.md` §3 now makes mandatory — the comparative model-tier table + speculative
TO-BE, per-benchmark feature-support, per-plan Done/Doing/Todo feature-support, and non-benchmarked
capabilities — all four re-derived against current code and reports, none copied forward from
`CAPABILITIES_1.4.1.md`.

- **Status flips since `CAPABILITIES_1.5.0.md`** (the audit most rows should be compared against,
  since it's the more recent of the two prior audits): item #3 (ACE-OWL, implemented → reverted),
  item #22 (cardinality entailment/`cax-maxc0`, partial → implemented), item #32 (wider seed set,
  claimed-only → implemented, the single biggest flip), item #50 (completions-in-chat's architectural
  gap, partial → closed in code), item #67 (INFBENCH, clean-passing → harness-broken-not-engine, and
  post-pin, unblocked-but-not-yet-remeasured — see item #92 and §4's INFBENCH subsection).
- **New capability surface**: 3 memory backends where there was 1 (#7/#84/#85), multi-graph loading
  (#86), a fundamentally different default persona/corpus (#87), a public completions API (#89),
  multi-candidate lexicon/parse ambiguity resolution (#92, post-pin).
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
  any other unit-tested-but-unreachable code path was. **Post-pin update**: this third instance is now
  closed too (`d5e962d`, item #92) — all three of this audit's own named wiring gaps are fixed, though
  the harness fix hasn't yet produced a fresh ladder measurement to confirm the engine underneath is
  still exactly what it was.
