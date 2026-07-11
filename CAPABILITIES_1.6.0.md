# CAPABILITIES_1.6.0.md — tmct capability audit (refresh 5, overlay over `CAPABILITIES_1.5.7.md`)

**Pinned at commit `b461ecd` ("merge: restore the four mandatory capability-audit sections"),
`package.json` `1.6.0`, 2026-07-11.** This is an **overlay audit**, not a from-scratch one, per the
operator's own framing for this cycle. `CAPABILITIES_1.5.7.md` is the starting point: read in full,
and re-verified below only where evidence actually changed. Verified directly: `git diff --stat
96bfe4f..HEAD -- src/ bin/ test/ package.json` returns exactly one line, `package.json | 2 +-` (the
version-string bump alone). `96bfe4f` is the exact commit `CAPABILITIES_1.5.7.md`'s own four
mandatory sections (including item #92) were pinned at. **Zero product code changed between that pin
and this one** — everything in this cycle is either a fresh measurement of already-shipped code
(`BENCHMARK_INFERENCE_1.6.0.md`) or a docs-only change (this file, `SKILL_CAPABILITIES_AUDIT.md`'s
own uplift, `CAPABILITIES_1.5.7.md`'s mandatory-section restoration). That is why this audit does not
re-run `CAPABILITIES_1.5.7.md`'s full sub-agent-fanned-out re-verification cycle (`SKILL_CAPABILITIES_
AUDIT.md` §5 Step 4): with confirmed zero code drift, re-deriving all 92 rows from scratch would
reproduce `CAPABILITIES_1.5.7.md`'s own findings verbatim. Full 92-row scope is carried forward with
a brief confirmation per row (§7 of the skill doc's own discipline — unchanged rows get terse
confirmation, not full re-derivation); every row this cycle's real evidence actually touches gets full
treatment, cited by name.

This cycle has one real news item and one synthesis. The news: `BENCHMARK_INFERENCE_1.6.0.md` is the
first INFBENCH measurement since `1.4.1` — `1.5.7`'s own attempt was blocked by a lexicon crash, fixed
this session. The synthesis: the same fix that unblocked INFBENCH shipped a genuinely new capability
(multi-candidate ambiguity resolution, `PLAN_DID_YOU_SEE_HER_DUCK.md`), and this audit checks that
capability directly against `BENCHMARK_CEFR_ENGLISH_1.5.7.md`'s existing findings rather than assuming
a connection.

---

## Comparative agent-capability table: tmct vs. named models, and a speculative TO-BE

**Read this framing before the table, not after.** tmct is not a general-purpose LLM and this is not
an IQ-style "tmct is as smart as X" claim. tmct is a narrow, deterministic, zero-cost system, hand-
built grammar plus ontology plus graph reasoning over a bounded domain. It has never attempted open-
ended generation, coding, creative writing, or general reasoning. Rows are a GENERAL agent-capability
taxonomy (tool use, planning, reasoning, grounding, memory, instruction-following, generation, coding,
safety/honesty, autonomy), not tmct's own internal benchmark names. The point is to place tmct on a
scale a reader already recognizes, not to grade it against a rubric tmct itself designed. Columns are
the same five named models `CAPABILITIES_1.5.7.md` used, re-confirmed here as still the right set:

- **Llama 3.1 8B Instruct** (Meta, open-weight, laptop/single-GPU class, the small/local tier)
- **Amazon Nova Pro** (AWS's own strongest general-purpose model, served on Bedrock)
- **Claude Haiku 4.5**, **Claude Sonnet 5**, **Claude Opus 4.8** (Anthropic's small to mid to large tier)

Every tmct cell is backed by a real number from the four CURRENT reports: `BENCHMARK_AGENT_1.5.7.md`,
`BENCHMARK_CEFR_ENGLISH_1.5.7.md`, `BENCHMARK_CONVERSATION_1.5.7.md` (all three unchanged since
`CAPABILITIES_1.5.7.md`, confirmed by the zero-drift check above), and, new this cycle,
`BENCHMARK_INFERENCE_1.6.0.md` — the reasoning row below is the one cell that actually moves. Model-
column verdicts are informed estimates from general knowledge of those models' public capability
tiers, not a measured cross-benchmark result. Re-confirmed against current capability; none moved
since `CAPABILITIES_1.5.7.md`.

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
| **Tool use / function calling** | Unchanged since `CAPABILITIES_1.5.7.md`: closed, rule-based router over a FIXED toolset, `BENCHMARK_AGENT_1.5.7.md` — 100% plan-completion, 98% result-completion, 0% hallucination, byte-identical across three consecutive measured versions | **Stronger** — genuine open-ended function-calling over arbitrary declared tools | **Stronger**, plus reliable multi-tool composition | **Stronger** | **Stronger** | **Stronger** |
| **Planning & multi-step task decomposition** | Unchanged since `CAPABILITIES_1.5.7.md`: same AGENTBENCH A0–C2 ladder, every gate PASS, bounded to pre-defined rungs | **Comparable** — general planning exists but noisier than tmct's deterministic bounded ladder | **Comparable-to-stronger** | **Comparable-to-stronger** | **Stronger** | **Stronger** — handles open-ended plans tmct's fixed rungs can't represent |
| **Reasoning (logical / multi-hop inference)** | **Changed this cycle — measured for the first time since `1.4.1`.** `BENCHMARK_INFERENCE_1.6.0.md`: full ladder clean, **both arms 100% completion, 0% fabrication** — kernel arm 80/80 (INF-A1 through INF-C1, up from `1.4.1`'s 40 cases now that `scm-svf1`/cardinality/`cax-maxc0` are directly kernel-gradeable), chat arm 219/219 (INF-A1 through INF-C2, up from `1.4.1`'s 196/209). `CAPABILITIES_1.5.7.md`'s row read "unmeasured this cycle, harness crashed" — that gap is now closed with a real number, not a prediction | **Comparable** on short chains, **Weaker** as chain depth/ambiguity grows | **Comparable** | **Comparable** | **Stronger** | **Stronger** — arbitrary-depth reasoning, not capped at a fixed ladder depth |
| **Knowledge grounding / retrieval (avoiding fabrication)** | Unchanged since `CAPABILITIES_1.5.7.md`: 0% fabrication is a structural property, unaffected by any benchmark cycle; CEFR tier-1 108/109 green; now also directly confirmed on the reasoning ladder — 0% fabrication on 299/299 INFBENCH rows | **Weaker** — no RAG discipline out of the box | **Weaker** bare call / **Comparable** with a real grounding harness | **Comparable** under strict grounding+citation prompting | **Comparable** | **Comparable** — best self-calibrated uncertainty of the five, but still probabilistic |
| **Memory & multi-turn context retention** | Unchanged since `CAPABILITIES_1.5.7.md`: session-scoped persistent graph, 3 pluggable storage backends, anaphora/focus carried within a session, no cross-session memory beyond what's explicitly written | **Weaker** — context-window/attention degradation over long sessions | **Comparable** | **Comparable** | **Comparable-to-stronger** | **Comparable-to-stronger** |
| **Instruction following / constraint adherence** | Unchanged since `CAPABILITIES_1.5.7.md`: recognized phrasing followed 100% of the time; `BENCHMARK_CEFR_ENGLISH_1.5.7.md` mean 1.724/2, tier-1 108/109, 1 hard fail; unrecognized phrasing declines or, since last cycle, surfaces an honest disambiguation prompt (item #92) | **Weaker** — occasional drift off format/constraint instructions | **Comparable** | **Comparable** | **Comparable-to-stronger** | **Stronger** — best-in-class adherence among the five, though still probabilistic |
| **Natural language generation & fluency** | Unchanged since `CAPABILITIES_1.5.7.md`: structurally near-zero, every reply is a template/grammar slot fill or extractive multi-sentence synthesis, never invented text | **Stronger** | **Stronger** | **Stronger** | **Stronger** | **Stronger** — tmct's weakest row by construction |
| **Code generation & execution** | Unchanged: none, explicitly out of scope | **Stronger** | **Stronger** | **Stronger** | **Stronger** | **Stronger** |
| **Safety, honesty & refusal calibration** | Unchanged since `CAPABILITIES_1.5.7.md`: structural zero-fabrication, refuses by construction when it can't ground an answer; `assertTurn` also refuses to guess on genuine parse ambiguity (item #92). **New evidence this cycle**: the fix that made this refusal discipline possible also unblocked a full 299-row inference measurement with zero fabricated rows, direct confirmation the refusal-by-construction property holds at ladder scale, not just on the one hand-built transcript in `PLAN_DID_YOU_SEE_HER_DUCK.md` | **Weaker** — answers confidently from contradictory or ambiguous premises more often than it refuses | **Weaker-to-comparable** | **Comparable** | **Comparable** | **Comparable** — good calibration, but still tuned, not tmct's structural guarantee |
| **Autonomy / external action (browsing, files, computer use)** | Unchanged: none, read-only chat against a local graph | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented | **Stronger** if tool-augmented |

**The pattern, re-confirmed this cycle**: tmct still beats or matches every model here on zero-
fabrication grounding and deterministic instruction adherence. This cycle's real move is the reasoning
row: `1.5.7`'s "unmeasured, harness broken" gap is now a clean, real, full-ladder number, and it
confirms the engine's own claim from last cycle — the reasoning capability was never actually
regressed, only unmeasured, and now that prediction is checked rather than assumed.

### Speculative TO-BE — where the table could move, if the backlog lands

Purely speculative, not a roadmap commitment. Drawn fresh from the four current reports' own "Next"
sections and the current `HANDOVER.md`, checked directly against code rather than carried forward.
Two items on `CAPABILITIES_1.5.7.md`'s own TO-BE list have already shipped and are removed here:

- ~~"Re-run INFBENCH's full cycle now that the harness is unblocked"~~ — **done this cycle**,
  `BENCHMARK_INFERENCE_1.6.0.md`. `CAPABILITIES_1.5.7.md` predicted this would "most likely
  re-confirm `1.4.1`'s full-gate PASS" — the actual result is stronger than that prediction: not just
  a re-confirmed PASS but a materially bigger, cleaner ladder (80 kernel cases vs. 40, 219 chat cases
  vs. 209, both arms 100% vs. `1.4.1`'s 196/209 chat).

What's left, still open, checked directly against current code (nothing below has quietly shipped):

- **`BENCHMARK_CEFR_ENGLISH_1.5.7.md`'s own decision log, item 1**: the A1 `naming-vocabulary`
  schema-term/common-word collision (`g-a1-naming-8/9`, "what does tests/imports mean"). Confirmed
  still open — `src/ask.mjs`'s `metaFallbackEntityAnswer` and the `ambiguousParse` path it feeds carry
  no commits since `1.5.7`'s pin. Landing it would trim the **instruction following** row's single
  remaining hard fail.
- **`am-tests-cover`'s un-flagged entity-name ambiguity** ("which tests cover b.mjs" resolves
  confidently instead of asking the user to narrow) — confirmed still open, same code path
  (`resolveObject`'s tie-breaking), unchanged for three straight cycles now (`1.4.1`, `1.5.7`, and
  this cycle, since no code touched it). See "Ambiguity-resolution synthesis" below for why this is
  a DIFFERENT bug class from item #92's fix, not the same one waiting to be re-measured.
- **`BENCHMARK_CONVERSATION_1.5.7.md`'s round 3** — capped early by explicit operator instruction,
  still not dispatched. The completions-rescue lane's garbled `Q:`/`A:` output needs a cleaner repro;
  the bare "what's ProperNoun" and "X and Y `<verb>`" conjunction-parsing gaps both need an operator
  scope decision first.
- **`PLAN_DID_YOU_SEE_HER_DUCK.md`'s own named extension**: the same breadth-first, generate-
  candidates-then-prune technique is explicitly NOT yet applied to `noise-strip.mjs`'s single-
  criterion stopword stripping — confirmed still true, `git log 96bfe4f..HEAD -- src/interpret/
  strategies/noise-strip.mjs` is empty. Landing it would extend the **safety/honesty calibration**
  row's ambiguity-refusal discipline to a second pipeline stage.
- **`PLAN_SYLLOGIST.md`'s retraction-aware, incremental reasoning research** — explicitly "not a
  near-term default" per `HANDOVER.md`, unchanged, the one open research question on the reasoning
  engine's own horizon.
- **A full-pool CEFR run** (`graded-pool-max.jsonl`, 1,075 cases) before the next release — still the
  right exception-case trigger per `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1's own footnote, not a
  routine-cycle default.

None of these change tmct's fundamental shape. A fixed grammar/ontology system was never designed to
plan, act autonomously, or generate freely, and no backlog item on this list changes that scope.

---

## 0. Scope note (carried forward from `CAPABILITIES_1.5.7.md` §0)

`CAPABILITIES_1.5.7.md` restored the full 83-row original catalog plus 9 new rows (84–92), correcting
a scope narrowing that happened across two prior refreshes (`CAPABILITIES_1.4.1.md`,
`CAPABILITIES_1.5.0.md`). This audit does not narrow again: the full 92-row catalog is reproduced
below in full, unchanged rows carrying a terse confirmation rather than a full re-derivation, per
`SKILL_CAPABILITIES_AUDIT.md` §2/§7. No row is dropped, and no row's real evidence is assumed without
the zero-drift check stated in this file's own header.

---

## 1. Full status table — all 92 rows, overlay-checked against `b461ecd`

**Status key:** `implemented` · `partial` · `undocumented` · `claimed-only` · `explicit scope
decision` (unchanged from refresh 1's own key). Rows with no functional change carry a terse
"unchanged since `CAPABILITIES_1.5.7.md`" note backed by the zero-drift check in this file's header.
Rows this cycle's real evidence (`BENCHMARK_INFERENCE_1.6.0.md`) directly touches get full treatment.

| # | Capability | Status | Evidence | Change note |
|---|---|---|---|---|
| 1 | Multi-strategy interpretation pipeline (grammar/keyword/noise-strip/fuzzy) | implemented | `src/interpret/pipeline.mjs`, `merge.mjs`, `strategies/{ace,constructions,grammar,keywords,noise-strip}.mjs` all present | unchanged since `CAPABILITIES_1.5.7.md` |
| 2 | ACE-inspired controlled-English grammar → OWL triples | implemented | `src/grammar/ace.mjs`, `src/grammar/lexicon.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 3 | ACE-OWL parser extracted to standalone MPL-2.0 npm package | reverted (unchanged) | `packages/` still absent from this worktree | unchanged since `CAPABILITIES_1.5.7.md` §3.2 |
| 4 | OWL 2/RDF/RDFS + SEON core ontology grounding | implemented | `ontology/tmct-core.ttl` | unchanged since `CAPABILITIES_1.5.7.md` |
| 5 | Template libraries / response phrase book | implemented | `src/corpus/templates.mjs`, `data/templates/` | unchanged since `CAPABILITIES_1.5.7.md` |
| 6 | Filtered ConceptNet corpus slice (opt-in) | implemented | `corpus/conceptnet/`, `src/corpus/conceptnet.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 7 | Conversational memory as its own OWL-labelled graph (3 backends) | implemented | `src/memory/core.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 8 | Input normalization pass | partial (unchanged shape) | `src/interpret/normalize.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 9 | Graph-provider adapter contract (Repository Interface, 15 services) | implemented | `src/repository-interface.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 10 | Runnable conformance/compatibility test suite for RI providers | implemented | `src/conformance.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 11 | Library-first design, stable `exports` map (18 entry points) | implemented | `package.json` `exports`; re-verified directly this cycle, still 18 subpaths | unchanged since `CAPABILITIES_1.5.7.md` |
| 12 | Ink console TUI shell | implemented | `src/tui/app.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 13 | Calculation surfaced as reasoning (counts/comparisons via templates) | implemented | `via:"template"` provenance in `src/chat.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 14 | Optionally running linters/tests to observe | claimed-only | no such code found | unchanged since `CAPABILITIES_1.5.7.md` |
| 15 | Formal logical reasoning via Prolog/Progol (ILP) | claimed-only (deliberate) | `PLAN_CODE.md` still frames this door as deliberately shut | unchanged since `CAPABILITIES_1.5.7.md` |
| 16 | Response-finishing grammar pass over segmented answers | partial (unchanged shape) | `src/finish.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 17 | `tmct init` onboarding CLI, `--persona-size` | implemented | `bin/tmct.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 18 | Speculative inference batch (`tmct syllogise`) | implemented | `src/syllogise.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 19 | `cax-dw` disjointness entailment rule (INF-B1) | implemented, **now independently re-measured** | `src/syllogise.mjs:127` `CAX_DW_RULE`; `BENCHMARK_INFERENCE_1.6.0.md`'s INF-B1 chat-arm band, 39/39, **100% completion, 0% fabrication, PASS** | **changed since `CAPABILITIES_1.5.7.md`**: that audit's own evidence cell explicitly flagged this rule "not independently re-measurable this cycle — see §3 INFBENCH caveat." That caveat is now closed by a real ladder run, not just a code-unchanged inference |
| 20 | `cax-sco` type-propagation entailment rule | implemented, **now independently re-measured** | `src/syllogise.mjs:115` `CAX_SCO_RULE`; confirmed live via `BENCHMARK_INFERENCE_1.6.0.md`'s INF-A2 chat-arm band, 40/40, 100% | **changed since `CAPABILITIES_1.5.7.md`**: same class of confirmation as item #19 — the rule was always `implemented`, but this cycle is the first real ladder run to check it since `1.4.1` |
| 21/24 | Actor-level, session-scoped source trust (Laplace/add-k) | implemented | `src/memory/trust.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 22 | Consistency checking / cardinality entailment / proof-chain materialization (INF stages 4-5) | implemented, **now independently re-measured** | `src/syllogise.mjs`: `findConsistencyViolations`, `buildCardinalityRestrictions`, `proveCardinalityAtLeast`, `proveMaxCardinalityZeroDenial`; `BENCHMARK_INFERENCE_1.6.0.md`'s INF-C1 band, kernel 40/40 and chat 40/40, both **100%** — including the new `c1ScmSvfApply` template built specifically to grade `scm-svf1`, and the kernel arm's doubling from 40 to 80 cases (all three rules now directly kernel-gradeable) | **changed since `CAPABILITIES_1.5.7.md`**: that audit recorded these rules as live-wired but did not have a working harness to confirm them against a fresh run. This cycle is that confirmation — INF-C1 clears the gate on both arms |
| 23 | Unified provenance/trust primitive (Source individuals) | implemented | `src/memory/trust.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 25 | Memory-tree versioning (`snapshotMemory`, manual-trigger) | implemented | `src/memory/core.mjs:629` | unchanged since `CAPABILITIES_1.5.7.md` |
| 26 | Automatic, deterministic contradiction detection | implemented | `src/memory/core.mjs:1669` | unchanged since `CAPABILITIES_1.5.7.md` |
| 27 | Hub-dampened memory-fact ranking | implemented, on by default | `src/memory/blocks.mjs:249` | unchanged since `CAPABILITIES_1.5.7.md` |
| 28 | Extension-pack / corpus-lexicon loading seam (default bundle flipped) | implemented | `src/extensions.mjs:303` | unchanged since `CAPABILITIES_1.5.7.md` |
| 29 | Bias-weighted ambiguity resolution | implemented | `src/memory/bias.mjs:71` | unchanged since `CAPABILITIES_1.5.7.md` |
| 30 | `tmct init --with-persona <name>`, size-tier flag | implemented | `bin/tmct.mjs:562` | unchanged since `CAPABILITIES_1.5.7.md` |
| 31 | Tier-2 general-knowledge corpus bundle (legacy, inactive by default) | implemented, legacy | `corpus/tier2/general.jsonl` | unchanged since `CAPABILITIES_1.5.7.md` |
| 32 | A wider general-knowledge seed set grown beyond tier2 | implemented | `corpus/tier2/human*.jsonl` | unchanged since `CAPABILITIES_1.5.7.md` |
| 33 | Context-preserving unknown-word ingestion | partial, still dormant | `src/corpus/conceptnet.mjs:152-210` | unchanged since `CAPABILITIES_1.5.7.md` |
| 34 | SHACL-style declarative ingest gate | implemented | `src/memory/shacl.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 35 | Cross-repo HTTP smoke test | implemented | `test/server-http-smoke.test.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 36 | Machine-readable capability envelope | implemented, version field stale | `agentbench/envelope.json`; re-checked directly this cycle, `"agentbenchVersion": "1.4.1"` still not bumped for `1.5.7` or `1.6.0` | **doc-lag confirmed to persist another cycle** — same finding as `CAPABILITIES_1.5.7.md`, now two versions stale instead of one |
| 37 | Ontology-hierarchies tracks a+b (ConceptNet Synonym/SimilarTo) | implemented, default-off | `src/chat.mjs:3739` | unchanged since `CAPABILITIES_1.5.7.md` |
| 38 | Ontology-hierarchies tracks c+d (SEON spine) | implemented, default-off | `ontology/tmct-core.ttl` | unchanged since `CAPABILITIES_1.5.7.md` |
| 39 | Advanced-grammar: subordination/conditional preamble frames | implemented | `src/interpret/normalize.mjs:358-537` | unchanged since `CAPABILITIES_1.5.7.md` |
| 40 | Advanced-grammar: construction-grammar template bank | implemented | `src/interpret/strategies/constructions.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 41 | Chat-taught relations & rules (6 items) | implemented | `src/chat.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 42 | `findActionPath` (bounded successor BFS) | implemented, not wired to a real domain | `src/planning.mjs:94` | unchanged since `CAPABILITIES_1.5.7.md` |
| 43 | `findReachableSet` (reachability enumeration) | implemented, wired into chat | `src/planning.mjs:199` | unchanged since `CAPABILITIES_1.5.7.md` |
| 44 | Towers-of-Hanoi goal-directed planning loop | claimed-only | `PLAN_HANOI.md` still headed "RESEARCH/DESIGN" | unchanged since `CAPABILITIES_1.5.7.md` |
| 45 | "I am thinking of a number" closed-loop game | claimed-only | `PLAN_GUESS_NUMBER.md` still headed "RESEARCH/DESIGN" | unchanged since `CAPABILITIES_1.5.7.md` |
| 46 | Program synthesis Track 1 (`GOAL_RULE` synthesis) | implemented | `synthbench/{phrasing,rules}/` | unchanged since `CAPABILITIES_1.5.7.md` |
| 47 | Program synthesis Tracks 2-4 (Playwright sandbox) | claimed-only, sign-off-gated | no `playwright` in `package.json` | unchanged since `CAPABILITIES_1.5.7.md` |
| 48 | Completions pipeline Stage 0 (broad search + grouping) | implemented | `src/completions/search.mjs`, `group.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 49 | Completions pipeline Stage 2 (extractive ranking) | implemented | `src/completions/rank.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 50 | Completions pipeline wired into a user-facing chat answer path | implemented, gap closed | `chat.mjs:6177` `completionsRescueAnswer` | unchanged since `CAPABILITIES_1.5.7.md` |
| 51 | Capability router, full 6-stage stack | implemented | `src/router/{registry,resolver,planner,guardrail,goal-reasoner,call-validator,set-algebra}.mjs` | unchanged since `CAPABILITIES_1.5.7.md`, confirmed byte-identical per `BENCHMARK_AGENT_1.5.7.md` |
| 52 | `POST /v1/messages` HTTP shim | implemented | `src/server-http.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 53 | bedrock-meter $0-rung routing integration | implemented in the sibling repo, not here | `PLAN_AGENTS.md:642` "Not started" on tmct's side | unchanged since `CAPABILITIES_1.5.7.md` |
| 54 | GitHub Copilot BYOK protocol shim | claimed-only | `PLAN_AGENTS.md:642` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 55 | `seon-mcp` (marginalia) provider adapter | claimed-only | `PLAN_AGENTS.md:639` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 56 | marginalia "mechanical chat" replacement by tmct | claimed-only | `PLAN_AGENTS.md:86` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 57 | tmct × seonix combined codebase index | claimed-only | `PLAN_AGENTS.md:640` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 58 | marginalia web-scrape → tmct teach pipeline | claimed-only | `PLAN_AGENTS.md:641` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 59 | RI wrapper fixes (ranked search/context/impact/snippet/pagination) | implemented | `src/providers/graph-service.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 60 | Path-traversal guard on graph-derived file reads | implemented | `src/source-slice.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 61 | Telemetry wrapper on every RI service | implemented, not exercised live | `src/telemetry.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 62 | Chronograph-style temporal diffing | claimed-only, genuinely hard | no such code found | unchanged since `CAPABILITIES_1.5.7.md` |
| 63 | Multi-language AST extraction inside tmct | explicit scope decision | `src/graph-build.mjs` still does no parsing, by design | unchanged since `CAPABILITIES_1.5.7.md` |
| 64 | Dialogue-flow playtest ladder, Tiers 0-6 | implemented | `test/chatflow-tier{0,1-single-touch,2,2-drilldown,4,5,6}.test.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 65 | CHATBENCH graded-pool ladder | implemented | `chatbench/graded-pool.jsonl` (109), `graded-pool-max.jsonl` (1,075) | unchanged since `CAPABILITIES_1.5.7.md`; still last exercised at `BENCHMARK_CEFR_ENGLISH_1.5.7.md` |
| 66 | AGENTBENCH agentic ladder (A0-C2) | implemented | `agentbench/cases.jsonl` (56 cases) | unchanged since `CAPABILITIES_1.5.7.md` |
| 67 | INFBENCH classical-logic ladder | **implemented — harness fixed, full ladder clean this cycle** | `node infbench/generate-cases.mjs` exits 0, 219 cases; `node infbench/run.mjs` completes both arms; `infbench/results/raw/run-1.6.0/product.jsonl` holds 299 rows, zero `pass: false` | **changed since `CAPABILITIES_1.5.7.md`**: `partial → harness broken, engine not` becomes `implemented → harness fixed, engine confirmed clean`. `BENCHMARK_INFERENCE_1.6.0.md`: kernel 80/80, chat 219/219, both 100% completion / 0% fabrication. This is the first clean full-ladder measurement since `BENCHMARK_INFERENCE_1.4.1.md`'s 206/209 (and materially bigger and cleaner: more cases, more bands, no non-passing rows) |
| 68 | Strategy-advisor background-agent watch process | implemented (process), dormant | `STRATEGY_ADVISOR.log`'s own last entry | unchanged since `CAPABILITIES_1.5.7.md` |
| 69 | Segmentation IR + concept force | implemented | `src/concept.mjs`, `src/finish.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 70 | Negation as bounded set complement | implemented | `src/router/set-algebra.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 71 | Reversible-passive traversal | implemented | `test/ask-negation-passive.test.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 72 | Compound-name resolution in `resolveObject` | implemented | `src/ask.mjs:2810` | unchanged since `CAPABILITIES_1.5.7.md` |
| 73 | Same compound-symbol matching extended to `/describe`'s resolver | still claimed-only / named gap | `src/codegraph.mjs:153` `resolveSymbol` remains a separate, stricter resolver | unchanged since `CAPABILITIES_1.5.7.md` |
| 74 | Reverse-`inherits` "the"-definite forms | still claimed-only / named gap | `src/ask-vocab.mjs:58-72,255-266` | unchanged since `CAPABILITIES_1.5.7.md` |
| 75 | Cochange phrasing variants + "multi-root" over-match | still open | `ROADMAP.md:326-327,351-352`; `BENCHMARK_CONVERSATION_1.5.7.md` round 1's "X and Y `<verb>`" finding | unchanged since `CAPABILITIES_1.5.7.md` |
| 76 | Bounded (N+1) goal recognition | claimed-only, research-horizon | `PLAN_AGENTS.md:644` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 77 | DRT-lite typed discourse record | claimed-only, research-horizon | `PLAN_AGENTS.md:644` "Not started" | unchanged since `CAPABILITIES_1.5.7.md` |
| 78 | Winograd-hard commonsense coreference | claimed-only, deliberately out of reach | `PLAN_AGENTS.md:646` | unchanged since `CAPABILITIES_1.5.7.md` |
| 79 | A shared ~2M-word cross-domain ontology | claimed-only, "record, not commit" | `PLAN_AGENTS.md:646` | unchanged since `CAPABILITIES_1.5.7.md` |
| 80 | `dispatchTool` MCP-era tool switch | implemented | `src/server.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 81 | Supply-chain hardening (SAST, secrets, audit, OSV-Scanner, provenance) | implemented | `.gitlab-ci.yml` | unchanged since `CAPABILITIES_1.5.7.md` |
| 82 | Predicate "find" queries | implemented | `src/ask.mjs:978,1028` | unchanged since `CAPABILITIES_1.5.7.md` |
| 83 | Single-sourced `fnv1a` hash + wink browser-loader seam | implemented | `src/hash.mjs:19,30`; `src/wink-model.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 84 | SQLite memory Backend C | implemented | `src/memory/core.mjs` `createSqliteMemoryStore` | unchanged since `CAPABILITIES_1.5.7.md` |
| 85 | In-memory Backend B | implemented | `src/memory/core.mjs:210` `createInMemoryStore` | unchanged since `CAPABILITIES_1.5.7.md` |
| 86 | Multi-graph loading + `tmct import` verb | implemented | `bin/tmct.mjs`, `src/cli-args.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 87 | Default human-world persona + Small/Medium/Large content tiers | implemented | `corpus/tier2/human*.jsonl`, `archive/PLAN_SEED.md` | unchanged since `CAPABILITIES_1.5.7.md` |
| 88 | `graphService` adapter wired into the completions pipeline | implemented | `src/completions/graph-adapter.mjs` | unchanged since `CAPABILITIES_1.5.7.md` |
| 89 | Public package exports for `generateCompletion`/`createCompletionsGraphAdapter` | implemented | `package.json` `exports` | unchanged since `CAPABILITIES_1.5.7.md` |
| 90 | `SKILL_AGENT_FAST_LOOP.md` process + 2 shipped fixes | implemented | new skill doc; `21eb6a2`, `d04a926` | unchanged since `CAPABILITIES_1.5.7.md` |
| 91 | Persona-sweep as the conversation benchmark's default single-run mode | process change | `SKILL_BENCHMARK_CONVERSATION.md` §3.4 | unchanged since `CAPABILITIES_1.5.7.md` |
| 92 | Multi-candidate lexicon/parse ambiguity resolution (`lookupNounCandidates`/`lookupVerbCandidates`, `parseAceAmbiguous`, `assertTurn` ambiguity surfacing) | implemented, **now with a real ladder-scale side effect confirmed** | `src/grammar/lexicon.mjs`, `src/grammar/ace.mjs`, `src/chat.mjs`; `d5e962d`/`65a7752`/`c254871`/`842ffa1` | **changed since `CAPABILITIES_1.5.7.md`**: that audit recorded this item's fix to `infbench/generate-cases.mjs`'s crash as confirmed only by a direct `exit 0` check. This cycle confirms the SAME fix at full ladder scale: `BENCHMARK_INFERENCE_1.6.0.md`'s 299/299 clean run is the first time the die/dice determiner-agreement fix has been exercised across every INFBENCH template, not just the one that used to crash. See "Ambiguity-resolution synthesis" below for the CEFR cross-reference this cycle adds |
| — | `PLAN_ADVENTURE.md` / `PLAN_CONVERSATION.md` | both "RESEARCH/DESIGN — not yet implemented" | headers checked directly | unchanged since `CAPABILITIES_1.5.7.md` |

---

## 2. Ambiguity-resolution synthesis — item #92 cross-referenced against `BENCHMARK_CEFR_ENGLISH_1.5.7.md`

**This section is forward-looking synthesis, not a retroactive score claim.** `CEFR_ENGLISH` has not
been re-measured since the ambiguity fix landed (`d5e962d`/`65a7752`/`c254871`/`842ffa1`, all
pre-dating `BENCHMARK_CEFR_ENGLISH_1.5.7.md`'s own measurement run at `08d0d034` — the ambiguity work
merged at `96bfe4f`, after that pin). Nothing below claims the CEFR mean moved or will move. It checks,
directly against code and the case pool, whether the new capability touches anything the existing
CEFR report already found weak.

### What CEFR_ENGLISH's own weak spots actually are

`BENCHMARK_CEFR_ENGLISH_1.5.7.md` names two open weak spots that sound, at a glance, like they could
be the same "ambiguity" as item #92:

- **`am-tests-cover`** (the sole tier-1 fail, and the `ambiguity` tag's weakest cell at 1.188 mean):
  "which tests cover b.mjs" resolves confidently to one of two matching files instead of flagging the
  collision and asking the user to narrow.
- **`g-a1-naming-9`** (the sole judged hard fail): "what does imports mean" gets an unhelpful two-way
  "could mean either" answer because `imports` is both a graph predicate name and an ordinary word.

Checked directly against the real code, both are a DIFFERENT bug class from item #92's fix, not an
unmeasured instance of the same one:

- `am-tests-cover` is an **entity/symbol-resolution** ambiguity — `b.mjs` genuinely names two graph
  individuals. This runs through `resolveObject`'s tiered scoring in `src/ask.mjs`, never through
  `lookupNounCandidates`/`parseAceAmbiguous` in `src/grammar/`. Grepped directly: no call from
  `resolveObject`'s matching path into either new function.
- `g-a1-naming-9` is a **query-side lexical collision**, handled by a pre-existing mechanism —
  `ask.mjs`'s `ambiguousParse`/`metaFallbackEntityAnswer` path, which predates this session entirely.
  `src/chat.mjs:5950-5962` names this explicitly in its own comment: "the frozen am-meta-imports
  ambiguity case ... is a DIFFERENT shape (`ambiguousParse` → `envelope.parsed` is null)" from the
  ordinary meta path. Item #92's `assertTurn` branch only fires on DECLARATIVE (TEACH-shaped) Pattern-3
  sentences ("N1 VERB N2."); "what does imports mean" is a question, never routed through
  `assertTurn` at all.

So neither of CEFR's two documented weak points is fixable, or was ever touched, by item #92's work.
They are real, separate, still-open gaps in different subsystems (entity resolution and query-side
meta-vocabulary lookup, respectively) — not evidence the new capability's reach is incomplete.

### Whether the CEFR pool can even exercise the new capability

Checked directly: item #92's `assertTurn` branch requires a DECLARATIVE sentence matching ACE's
pattern 3 (a relation-shaped "N1 VERB N2." teach statement) with two or more distinct, independently
valid verb-position readings. A scan of all 109 cases in `chatbench/graded-pool.jsonl` finds every
non-question turn is one of: a `/describe`, `/focus`, `/members`, `/subclasses`, or `/impact` command;
a passive-voice or "which of them" query; or a bare greeting/conversational opener. **None is a
Pattern-3 declarative teach statement of the shape item #92 operates on.** The pool structurally
cannot reach the new `assertTurn` branch at all, the same finding `CAPABILITIES_1.5.7.md` §6 already
made about all four benchmarks' case sets in general, now confirmed specifically for the CEFR pool by
direct inspection rather than assumed by extension.

A second direct check: the fix's own affected lexicon entries (`die`/`dice`, `person`/`people`,
`tooth`/`teeth`, plus the three new senses added to demonstrate it — `duck`/`mock`/`senior`) do not
appear in any of the 109 cases' turn text. **No regression risk to CEFR's existing 108/109 tier-1 pass
rate or 1.724 judged mean from this change** — confirmed by word-overlap check, not assumed from "the
diff looked safe."

### What a future CEFR re-measurement should watch for

1. **No regression is expected, and this is checkable in advance of a re-run**: the word-overlap check
   above already rules out the most direct risk (an existing case tripping the new lexicon logic
   differently). A fresh run should still confirm this empirically, not rely on the static check alone.
2. **The pool cannot currently score the new capability at all.** If the operator wants CHATBENCH to
   ever cover multi-candidate ambiguity resolution, it needs new case(s) modeled on
   `PLAN_DID_YOU_SEE_HER_DUCK.md`'s own worked example ("senior duck mock module") added to the pool —
   a scope decision for a future cycle, not a gap in this audit.
3. **`am-tests-cover` and `g-a1-naming-9` should not be expected to move** from any future work in
   this same area, since they live in different code (`resolveObject` entity-tie-breaking and
   `ask.mjs`'s meta-fallback, respectively) — a future session picking up `BENCHMARK_CEFR_ENGLISH_
   1.5.7.md`'s own decision-log item 1 (the A1 naming-vocabulary collision) is the right lever for
   `g-a1-naming-9`, not any extension of item #92's work.
4. **The `noise-strip.mjs` extension named in `PLAN_DID_YOU_SEE_HER_DUCK.md`'s own "What this doc is
   not" section**, if it ever lands, is a more plausible future lever on the `ambiguity`-tagged CEFR
   cell than anything already shipped — `PLAN_CONVERSATION.md`'s own Finding 2 (the "where would I
   store a router" 4/5-way resolution tie) is closer in shape to `am-tests-cover` than item #92's
   lexicon/parse-layer fix is.

---

## 3. Benchmark feature-support

### `SKILL_BENCHMARK_AGENT.md` (AGENTBENCH)

- Router/goal-reasoner surface, all 56 cases, A0–C2 ladder — **complete**, unchanged across four
  consecutive measured versions now (`0.8.2`, `1.4.1`, `1.5.7`, and confirmed still untouched into
  `1.6.0` by the zero-drift check in this file's header); `BENCHMARK_AGENT_1.5.7.md` remains the
  current report, still accurate.
- `ab-c2-what-to-test`'s plan-correct/result-incomplete composing gap — **todo**, unchanged.
- Growing the ladder itself, or feeding `PLAN_CODE.md`'s Track 1 output into new case coverage —
  **todo**, unchanged.

### `SKILL_BENCHMARK_CEFR_ENGLISH.md` (CHATBENCH)

- C2 `pronoun-binding`'s 4 hard fails and A2 `naming-vocabulary`'s 2 — **complete**, unchanged since
  `1.5.7`, confirmed no code touched `src/ask.mjs`/`src/chat.mjs`'s relevant paths since that
  measurement.
- A1 `naming-vocabulary`'s schema-term/common-word collision (`g-a1-naming-8/9`) — **todo**,
  confirmed still open (see §2 above — this is `g-a1-naming-9`, the same case checked directly against
  item #92 and found unrelated).
- `am-tests-cover`'s un-flagged ambiguity — **todo**, unchanged for three straight cycles, confirmed
  unrelated to item #92's fix (§2 above).
- A full-pool run against `graded-pool-max.jsonl` before the next release — **todo**, unchanged.

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH)

- **A full rung table for the current version** — **complete**. `BENCHMARK_INFERENCE_1.6.0.md`: kernel
  arm 80/80 (100%), chat arm 219/219 (100%), 0% fabrication both arms. `CAPABILITIES_1.5.7.md`'s
  equivalent bullet read "todo, blocked this cycle" — that is now closed with a real number.
- The blocking lexicon collision (`dice`/`die`, `person`/`people`, `tooth`/`teeth`) — **complete**,
  unchanged since `1.5.7`'s report of the fix; this cycle is the first ladder-scale confirmation it
  holds across all 9 templates, not just the one that used to crash.
- A fresh full-ladder measurement against the unblocked harness — **complete**, this cycle. Was the
  single item `CAPABILITIES_1.5.7.md`'s own speculative TO-BE list named as "the single most direct
  lever on the table" — now done, and the actual result (80/219, both 100%) beats that entry's own
  cautious prediction of "most likely re-confirming `1.4.1`'s full-gate PASS."
- A build-time lexicon-invariant check (rejecting a new noun headword that collides with an existing
  noun's `plural` field before it lands in `lexicon-core.json`) — **todo**, unchanged.
  `BENCHMARK_INFERENCE_1.6.0.md` doesn't revisit this recommendation; the parse-layer fix
  (`d5e962d`) closed the immediate crash a different way, without adding this build-time guard.

### `SKILL_BENCHMARK_CONVERSATION.md` (capped sprint / persona-sweep)

- Round 1 (3 dead-ends) and round 2 (1 dead-end) — **complete**, unchanged since `1.5.7`.
- Round 3 — **todo**, unchanged, still capped by explicit operator instruction, not dispatched.
- Bare "what's ProperNoun" grammar shape — **todo**, unchanged, needs an operator scope decision.
- "X and Y `<symmetric-verb>`" bare-conjunction subject parsing (item #75) — **todo**, unchanged.
- Completions-rescue lane's garbled `Q:`/`A:` output — **todo**, unchanged, still didn't reproduce
  cleanly on a second attempt.
- Regression suite growth, persona-sweep as default mode — **complete**, unchanged.

---

## 4. Plan feature-support — Done / Doing / Todo per plan

Every plan section below is unchanged from `CAPABILITIES_1.5.7.md` §5, confirmed by the zero-drift
check in this file's header (`git diff --stat 96bfe4f..HEAD -- src/ bin/ test/ package.json` touches
only `package.json`'s version string, no plan-scoped source file). Reproduced in full per the skill
doc's full-scope discipline, not abbreviated to a "see prior audit" pointer.

### `PLAN_AGENTS.md`

**Pinned at `3769e0f`.**

- **Done**: RI wrapper fixes, hub-dampened memory ranking, memory-tree versioning, actor-level trust,
  extension-pack seam, bias-weighted ranking, `tmct init --with-persona`, chat-taught relations; the
  persona/CLI-unification batch this doc's §3 flagged open is shipped, see `archive/PLAN_SEED.md`.
- **Doing**: none currently in flight.
- **Todo**: Phases 2-5, `seon-mcp` provider wiring (#55), marginalia's "mechanical chat" replacement
  (#56), tmct×seonix combined index (#57), marginalia web-scrape→teach pipeline (#58), bedrock-
  meter/Copilot integration on tmct's own side (#53/#54) — all still "Not started."

### `PLAN_CODE.md`

**Pinned at `7680aa6`.**

- **Done**: Track 1, `GOAL_RULE`/`PHRASING_FRAMES` synthesis, `synthbench/{phrasing,rules}/`, 0% call
  fabrication, held-out-checked.
- **Doing**: none.
- **Todo**: Tracks 2-4 (bounded-mutation JS repair, HTML/CSS-fragment synthesis via a Playwright
  sandbox), each gated on its own separate operator sign-off.

### `PLAN_DID_YOU_SEE_HER_DUCK.md`

**Pinned at `8fc285e`.**

- **Done**: `lookupNoun` → `lookupNounCandidates` grammatical-agreement pruning (`d5e962d`);
  `lookupVerb` → `lookupVerbCandidates` (`65a7752`); `parseAceAmbiguous`, the breadth-first dead-end-
  pruning scan over pattern-3 verb-position splits (`c254871`); `assertTurn` wired to check it first
  (`842ffa1`). **New evidence this cycle**: `BENCHMARK_INFERENCE_1.6.0.md`'s clean 299/299 run is the
  first ladder-scale confirmation the fix holds beyond the one hand-built demonstration sentence.
- **Doing**: none, the plan's own header states "Status: IMPLEMENTED."
- **Todo**: unchanged — the same breadth-first technique not yet applied to `noise-strip.mjs`'s
  stopword stripping; not generalized to the other 7 ACE patterns beyond pattern 3.

### `PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`

**Pinned at `779918d`/`be9b377`.**

- **Done**: shared reusable infrastructure, `findActionPath` (#42), `findReachableSet` (#43),
  `createSession`'s closure-threading pattern.
- **Doing**: none.
- **Todo**: both games' own domain-specific code, unchanged, "RESEARCH/DESIGN — not yet implemented."

### `PLAN_ADVENTURE.md`

**Pinned at `9328360`.**

- **Done**: none, research/design only.
- **Doing**: none.
- **Todo**: the entire scope — imperative command grammar, mutable turn-by-turn world/player state,
  an NPC turn scheduler.

### `PLAN_CONVERSATION.md`

**Pinned at `61cb7e6`.**

- **Done**: none, explicitly "research/design notes, nothing implemented."
- **Doing**: none.
- **Todo**: Finding 1 (unknown "every X is Y" mints Y as a class, never a property); Finding 2
  (`noise-strip.mjs`'s dependence on wink's generic stopword list), the same root shape
  `PLAN_DID_YOU_SEE_HER_DUCK.md` names as its own natural next extension.

### `PLAN_SYLLOGIST.md`

**Pinned at `efe7cee`.**

- **Done**: none, pulled out of `archive/PLAN_INFERENCE_TESTING.md` on that plan's retirement.
- **Doing**: none.
- **Todo**: reusing match-state across passes in `src/syllogise.mjs`, plus retraction-aware,
  incremental consistency checking. "Not a near-term default" per `HANDOVER.md`.

### Fully shipped and archived, one-line notes

- **`archive/PLAN_SEED.md`** (pinned at `08d0d03`) — every item done: persistence backends, CLI/config
  unification, persona content tiers, `createSession`→`initRepo` convergence.
- **`archive/PLAN_INFERENCE_TESTING.md`** (pinned at `1d31477`) — all 6 stages shipped and chat-wired,
  now with a real full-ladder measurement (`BENCHMARK_INFERENCE_1.6.0.md`) confirming the plan's own
  final STATUS-banner prediction. Its one open research question moved to `PLAN_SYLLOGIST.md`.
- **`archive/PLAN_COMPLETIONS.md`** (pinned at `59f7466`) — all 4 staging rows shipped.

### Archived, still carrying real open scope

- **`archive/PLAN_ADVANCED_GRAMMAR.md`** (pinned at `8cd3b36`) — **Done**: tracks (a) and (d). **Todo**:
  tracks (b) DRT-lite discourse record, (e) ellipsis, (f) presupposition nudges.
- **`archive/PLAN_ontology-hierarchies.md`** (pinned at `8cd3b36`) — **Done**: stages 1-3. **Todo**:
  stage 3+ growth.

---

## 5. Non-benchmarked capabilities

Carried forward from `CAPABILITIES_1.5.7.md` §6, re-confirmed unchanged, plus one new item this cycle.

- **The completions pipeline's architectural gap is closed in code** (#50/#88) — unchanged, still not
  independently re-confirmed by a fresh playtest since `1.5.7`.
- **The persona/corpus default flip** (#87) — unchanged, still invisible to CHATBENCH/AGENTBENCH/
  INFBENCH's case sets.
- **Item #92's ambiguity-refusal discipline** — was reported last cycle as "invisible to all four
  scalar benchmarks." **This is now partly superseded**: this cycle's INFBENCH run IS a scalar
  benchmark exercising item #92's fix, just not the ambiguity-surfacing branch itself — the
  determiner-agreement lexicon pruning underneath it now has a real, ladder-scale pass-rate number
  (299/299 rows through the fixed lexicon path, 0% fabrication). What remains genuinely non-
  benchmarked is narrower than `1.5.7`'s framing suggested: specifically the `assertTurn`
  disambiguation BRANCH (the "this could mean more than one thing" reply on a genuine 2+-reading
  declarative), which §2 above confirms no current benchmark case set can reach at all, not the
  underlying lexicon-candidate machinery, which INFBENCH's clean run now does exercise indirectly on
  every one of its 219 chat-arm cases (each one resolves through `lookupNounCandidates`/
  `lookupVerbCandidates`, whether or not it hits a genuine multi-reading collision).
- **HANDOVER.md is stale relative to this pin** — checked directly: its "Where we are" section still
  describes `v1.5.7` as "held locally, not yet pushed," with no mention of the version-1.6.0 bump, the
  ambiguity-resolution work, or this cycle's INFBENCH measurement. This is the same doc-lag pattern
  item #36's stale envelope version already names, now found in a second document — flagged here
  rather than silently worked around, per this project's own recurring "live wiring gap"/
  documentation-lag finding.

---

## 6. Summary

**Re-verified against real code:** all 92 rows from `CAPABILITIES_1.5.7.md`, confirmed via a direct
zero-drift check (`git diff --stat 96bfe4f..HEAD -- src/ bin/ test/ package.json`, one line, the
version bump only) rather than re-deriving each row from scratch — the correct discipline when the
underlying code provably has not moved. No row count changes: **92 total rows**, no new numbered
capability this cycle (the only candidate, INFBENCH's fix, is already item #92 from `1.5.7`).

- **Status flips since `CAPABILITIES_1.5.7.md`**: item #67 (INFBENCH, harness-broken-not-engine →
  fully measured and clean, 219/219 chat + 80/80 kernel, both 100%/0%). Items #19, #20, #22 keep their
  `implemented` status but gain a real re-measurement citation each, closing a caveat `1.5.7`
  explicitly left open ("not independently re-measurable this cycle"). Item #92 keeps its status but
  gains ladder-scale confirmation beyond the single hand-built transcript `1.5.7` had to rely on.
- **New this cycle**: the ambiguity-resolution synthesis (§2) — checked directly, neither of CEFR's
  two open weak spots (`am-tests-cover`, `g-a1-naming-9`) is caused by item #92's bug class; both are
  real, separate, still-open gaps in different subsystems. The CEFR pool structurally cannot exercise
  item #92's `assertTurn` branch at all (zero Pattern-3 declarative teach statements in 109 cases),
  and carries zero word-overlap with the fix's affected lexicon entries, so no regression is expected
  from a future re-run.
- **Real, unresolved gaps carried forward unchanged**: #44/#45 (Hanoi/guess-number), #53-58
  (marginalia/seonix/Bedrock/Copilot integration), #73/#74 (named grammar gaps), #75 (cochange
  conjunction parsing), #76-79 (research-horizon items), `am-tests-cover` and `g-a1-naming-9`/
  `g-a1-naming-8` (CEFR's two open weak spots, confirmed this cycle to be unrelated to item #92).
- **The single most consequential finding of this refresh**: `CAPABILITIES_1.5.7.md`'s own closing
  line predicted "the harness fix hasn't yet produced a fresh ladder measurement to confirm the engine
  underneath is still exactly what it was." That measurement has now run, and the prediction holds,
  with room to spare — the engine is not just "still what it was," it measures better than `1.4.1`'s
  own last clean baseline (80 kernel cases vs. 40, 219 chat cases vs. 196/209 passing, both arms at
  100% instead of a partial ceiling).
- **`npm test`**: 1872/1872 green, checked in the foreground for this overlay (docs-only change,
  confirmed unaffected).
