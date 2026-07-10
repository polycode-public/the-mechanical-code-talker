# CAPABILITIES_AUDIT_2026-07-10.md — tmct capability audit (refresh 2)

> **◻ Pending, sequenced after this refresh: a comparative model-tier table** (tmct vs. local/AWS/
> Anthropic model tiers, plus a speculative TO-BE sketch) — not started, tracked separately, not part
> of this doc's own scope.

**Refresh 2 — re-pinned at commit `4a102b5` ("docs: refresh HANDOVER.md — ranked follow-ups from
the 4 fresh 1.4.1 benchmark reports"), 2026-07-10, after the full session's batch landed and all
four fresh benchmark reports (`AGENTBENCH_1.4.1.md`, `INFBENCH_1.4.1.md`, `CHATBENCH_1.4.1.md`,
`PLAYTESTBENCH_1.4.1.md`) were written.** The prior version of this doc (refresh 1, pinned at
`0b730ad`, written *during* the session while tracks were still landing) is superseded by this one;
its own git history preserves it if needed. Unlike refresh 1, the working tree is now fully clean —
every capability below was verified against a committed, stable HEAD, not a moving target.

This refresh updates status on every row refresh 1 flagged as unmeasured/in-flight, adds ~15 new
rows for this session's later work (the chat-wiring fixes, the consistency checker, chatbench
case-set v3, the playtest sprint, the benchmark reports themselves), extends §4's plan-support
bullets with which benchmark uplifts would most help each plan, and adds a new §5 for capabilities
that don't reduce to a benchmark scalar. Everything NOT called out below as changed carries over
unchanged from refresh 1 — re-verified spot-checks, not blind carry-forward.

---

## 1. Status table (changed/new rows only — see refresh 1's git history for the full 83-row table; rows not listed here are unchanged)

**Status key:** `implemented` · `partial` · `undocumented` · `claimed-only`.

| # | Capability | Status | Realizing plan doc | Evidence |
|---|---|---|---|---|
| 19 | `cax-dw` disjointness entailment rule | **implemented AND re-measured — refresh 1's open caveat is now closed** | `PLAN_INFERENCE_TESTING.md` stage 3 | `src/syllogise.mjs` `deriveDisjointViolations`; **now also live-wired into `chat.mjs`'s `isaAsk` block** (commit `be1a22f`) closing the actual chat-query gap refresh 1 didn't catch (the rule existed but was unreachable from any real turn). `INFBENCH_1.4.1.md`: INF-B1 33%→**100%** |
| 22 | Consistency checking (INF-C2) | **implemented — was `claimed-only` in refresh 1** | `PLAN_INFERENCE_TESTING.md` stage 5 | `src/syllogise.mjs` `findConsistencyViolations` + live wiring into `chat.mjs`'s `KNOW_ABOUT_RE` handler (commit `be1a22f`). `INFBENCH_1.4.1.md`: INF-C2 0%→**100%** |
| 19b | `cls-svf1` (someValuesFrom restriction membership) | **partial, new row** | `PLAN_INFERENCE_TESTING.md` stage 4 | `src/syllogise.mjs` `deriveSomeValuesFromApplication` (commit `2386a07`) — kernel-level 100% pass, but **no live chat-query wiring built** (unlike `cax-dw`); `INFBENCH_1.4.1.md`: 10 new `b2Svf1Apply` cases all show `unproven` in the chat arm despite kernel 100%. Ranked `HANDOVER.md`'s #2 follow-up |
| 40 | Advanced-grammar: construction-grammar template bank | **implemented — was in-flight/uncommitted in refresh 1** | `PLAN_AGENTS.md` §3; `archive/PLAN_ADVANCED_GRAMMAR.md` track (d) | `src/interpret/strategies/constructions.mjs` + `data/templates/constructions/agent-noun-relations.toml` (commit `397a7a3`) — T11-T13 templates, cleanly committed |
| 50 | Mechanical text-generation pipeline (`src/completions/`) wired into a user-facing chat answer path | **claimed-only, now LIVE-CONFIRMED via playtest (was inferred from a grep in refresh 1, now directly observed)** | `PLAN_COMPLETIONS.md` | `PLAYTESTBENCH_1.4.1.md` round 3: "give me a detailed summary of how the task system works" hits the plain grammar wall with no inferred goal at all — direct behavioral confirmation the pipeline (Stages 0-3, all shipped this session) has zero chat-dispatch reachability. Ranked `HANDOVER.md`'s #5 follow-up — the single largest unlock available |
| 3 | ACE-OWL parser extracted to standalone MPL-2.0 npm package | implemented (unchanged from refresh 1, now fully settled — no longer "post-pin drift", this is stably committed) | `PLAN_AGENTS.md` §3 | `packages/ace-owl/` (commit `c57adbe`) |
| — | `resolveRelationChase`/`resolveRelationChaseReverse` extracted from `chat.mjs` into standalone exported functions | **implemented, new row** | `PLAN_COMPLETIONS.md` Stage 1's own prerequisite | `src/memory/core.mjs` (commit `5f44b2b`) — pure refactor, 26 existing relation tests pass byte-identical + 5 new standalone unit tests |
| — | PLAN_COMPLETIONS Stage 1 (cross-group inference, closed 4-relation vocabulary) | **implemented, new row** | `PLAN_COMPLETIONS.md` | `src/completions/infer.mjs` (commit `48578b2`) — supports/contradicts/elaborates/exemplifies, each with a named mechanical licensing test, zero-fabrication proven against all 28 pairs in its own fixture |
| — | PLAN_COMPLETIONS Stage 3 (pruning + grammar/voice pass, wired end to end) | **implemented, new row** | `PLAN_COMPLETIONS.md` | `src/completions/prune.mjs` + `complete.mjs` (commit `dc51168`) — `generateCompletion()` chains all six stages; `finish.mjs` generalized from single-answer to genuinely multi-sentence |
| — | SHACL ingest gate — using `shacl-engine` | **NOT implemented (deliberately rejected, refresh 1 undersold this)** | `PLAN_AGENTS.md` §2.1 | `shacl-engine`/`rdf-ext` were installed, found to pull in a full federated SPARQL engine (~560 packages, `@comunica/query-sparql-rdfjs-lite`), and explicitly ripped out in favor of the hand-rolled `src/memory/shacl.mjs` refresh 1 already correctly described — noted here only to make the *rejection* itself an explicit, documented decision, not silent |
| — | Chatbench case-set v3 (`graded-pool.jsonl` as a 109-case go-to default, full pool preserved at `graded-pool-max.jsonl`) | **implemented, new row** | `SKILL_BENCHMARK_CHAT.md` §1 | Commit `eaf33f0`; former `cases.jsonl`'s 49 cases folded in as real graded cells (Leg B — classified into CEFR grade+construction, not left ungraded); `CHATBENCH_1.4.1.md` is the first judged run against it |
| — | Playtest sprint capability — 2 real dead-ends found and fixed live | **implemented, new row** | `SKILL_BENCHMARK_PLAYTEST.md` §3 | Commits `e2b6f57` (bare "what does this do") and `bc1b441` (closing/thanks remark); `PLAYTESTBENCH_1.4.1.md` is the first versioned write-up under this convention — refresh 1 noted no `PLAYTESTBENCH_*.md` existed yet; it now does |
| — | Four fresh 1.4.1 benchmark reports (AGENTBENCH/INFBENCH/CHATBENCH/PLAYTESTBENCH) | **implemented, new row** | all four `SKILL_BENCHMARK_*.md` docs | Root-level `.md` files, each with a real timing section (start/end/write-up timestamps, concurrency, duration) reconstructed from result-file mtimes + commit timestamps. All pre-1.4.1 reports archived to `archive/` (commit `17019e0`) |
| — | Live wiring gap pattern, named generically | **new finding, not a row** | — | Two capabilities this session (`cax-dw`, the completions pipeline) shared the exact same failure shape: a real, unit-tested engine/module that nothing in the live chat dispatch surface actually calls. `cax-dw`'s case is now fixed; the completions pipeline's is not. Worth naming as a class of gap this project should watch for going forward — "unit-tested" and "reachable from a real chat turn" are not the same claim, and this audit (both refreshes) found real capabilities on both the fixed and unfixed side of that line |

---

## 2. The INF-B1 caveat (refresh 1's §2) — now fully resolved

Refresh 1 flagged that `cax-dw` was implemented but unmeasured, and that `ROADMAP.md`/`HANDOVER.md`'s
"still gated at INF-B1" language was already stale relative to the code. **This is now closed
correctly, not just updated**: `INFBENCH_1.4.1.md` measured the rule live, found it STILL didn't
move the chat-arm gate (33% → 33%, unchanged) because the rule had never been wired into any actual
chat query path — a distinct, deeper gap than refresh 1's "unmeasured" framing implied. That gap was
found and fixed in the same session (commit `be1a22f`), and a second, follow-up measurement
confirmed INF-B1 at 100%. The lesson generalizes (see the "live wiring gap pattern" row above):
"implemented and unit-tested" is a necessary but not sufficient condition for "the benchmark will
show it" — the benchmark measures the CHAT-reachable behavior, not the kernel.

---

## 3. Benchmark feature-support — updated with the fresh 1.4.1 measurements

### `SKILL_BENCHMARK_AGENT.md` (AGENTBENCH)

Unchanged from refresh 1 — `AGENTBENCH_1.4.1.md` confirms the router/goal-reasoner surface is
byte-identical to `0.8.2`, fully gate-passing on every rung (100% plan / 98% result / 0%
hallucination). No feature-support bullet needs updating; nothing on this benchmark's measured
surface changed this session.

### `SKILL_BENCHMARK_CHAT.md` (CHATBENCH)

- Case-set v3 (`graded-pool.jsonl` as the 109-case go-to default) — **complete**, this session's own
  restructuring; `CHATBENCH_1.4.1.md` is the first-ever judged run against it (mean 1.624/2)
- C2 `pronoun-binding` — **todo**, confirmed by fresh measurement as the clearest concentrated
  weakness: 0/10 tier-1, 4/10 judged hard fails, every one confidently-wrong not honest-miss
- A2 `naming-vocabulary` — **todo, new signal**: 2 fresh hard fails not previously known as a
  ceiling; needs a transcript read before it can be triaged
- The 49 former-`cases.jsonl` core cases, now properly graded — **complete**, zero hard fails across
  all of them post-restructuring

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH)

- `cax-dw` + its live chat-query wiring (INF-B1) — **complete**, closed this session (33%→100%)
- Consistency checker (INF-C2) — **complete**, closed this session (0%→100%)
- `cls-svf1` kernel rule — **complete**; its live chat-query wiring — **todo**, the single
  best-scoped remaining lever on this benchmark (same pattern as `cax-dw`'s fix, fresh in the
  codebase)
- `scm-svf`/cardinality monotonicity — **todo, confirmed unmeasurable** against today's fixture
  (pre-check found INF-C1 already at 90%, unrelated to either rule) — correctly NOT built this
  session rather than built-and-unmeasurable

### `SKILL_BENCHMARK_PLAYTEST.md` (dialogue-flow, → pending rename to `SKILL_BENCHMARK_CONVERSATION.md`)

- Capped sprint mode, run for real this session — **complete** as a proven process, not just a
  documented one; `PLAYTESTBENCH_1.4.1.md` is the first versioned write-up
- Regression-freezing of playtest-found fixes into `test/chatflow-*.test.mjs` — **todo**, explicitly
  skipped this cycle per the report's own "Next" section, a real gap in the loop's own discipline
- (Once renamed/refocused per the pending task: conversation fluidity, knowledge-acceptance+
  inference, and completions-detail retrieval become this benchmark's explicit territory — see §5
  below for what that would newly cover)

---

## 4. Plan feature-support — extended with which benchmark uplifts help each plan most

### `PLAN_AGENTS.md`

Unchanged core dependencies from refresh 1 (RI, extension-pack seam, bias-weighted ranking, chat-
taught relations, SHACL gate all **complete**). **Which benchmark uplift helps most:** AGENTBENCH
directly measures this plan's Phase 0/1 router and goal-reasoner surface — it's already fully
gate-passing, so the highest-leverage uplift for THIS plan specifically is now CHATBENCH (a cleaner
C2 pronoun-binding score feeds directly into the "chat surface debt re-measure" item this plan's own
§3 still lists open) and wiring `src/completions/` into chat (unlocks Phase 4's marginalia
web-scrape-teach pipeline's natural output surface once that phase starts).

### `PLAN_CODE.md`

Unchanged from refresh 1 (Track 1 **complete**, Tracks 2-4 **todo**, blocked on a sandbox dependency
decision). **Which benchmark uplift helps most:** AGENTBENCH — Track 1's synthesized `GOAL_RULE`
entries are meant to feed new AGENTBENCH case coverage; since AGENTBENCH is currently fully
gate-passing with no red rungs, the natural next uplift for this plan is deepening the ladder (new
C2+ cases) rather than fixing anything currently broken, since there's nothing currently broken on
this surface.

### `PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`

Unchanged — both still explicitly "RESEARCH/DESIGN, not yet implemented" per their own headers, with
real reusable infrastructure already in place (`findActionPath`, `createSession`'s closure-threading
pattern) but no domain-specific code. **Which benchmark uplift helps most:** neither AGENTBENCH nor
CHATBENCH nor INFBENCH currently measures either plan's target capability at all (turn-based game
state, closed-loop planning over a synthetic domain) — the honest answer is that no existing
benchmark uplift moves either plan forward; a genuinely new case family would be needed on
whichever benchmark eventually adopts them (most naturally AGENTBENCH, given both are planning-shaped
problems close to its existing rung structure).

---

## 5. Non-benchmarked capabilities — real, shipped, but not reducible to any current benchmark scalar

Prompted by the operator's own observation: some of this session's most significant shipped work
doesn't move any of the four benchmarks' numbers at all, because none of them are built to measure
it. Naming these explicitly rather than letting "no benchmark moved" read as "nothing happened":

- **PLAN_COMPLETIONS' entire pipeline** (broad search → group → infer → rank → prune → voice pass) —
  a genuinely new capability category, fully shipped (Stages 0-3), with real unit tests proving each
  stage's own correctness (zero-fabrication inference, deterministic double-run diffs, source-span
  traceability) — but AGENTBENCH/INFBENCH/CHATBENCH don't test multi-sentence extractive synthesis at
  all, and it's not even reachable from chat yet (see §1's "live wiring gap" row). There is currently
  **no benchmark that would show this shipped**, positive or negative.
- **Taught-relation learning + inference** (`PLAN_TAUGHT_RELATIONS.md`'s six-item scope: fact teach,
  alias/union, `compose2`, `filter`, `recursive`, reverse-"who") — fully implemented, 26+ tests, but
  INFBENCH's own generator produces zero cases that touch this surface (confirmed by direct grep in
  a prior session's `INFBENCH_1.3.1.md`, unchanged this session) — the classical-logic ladder and the
  taught-relations surface are structurally disjoint case populations.
- **Fluid conversational flow itself** (greetings, closing remarks, teach-then-recall round-trips,
  anaphora, typo tolerance) — CHATBENCH scores fragments of this (the `conversational`/
  `memory-recall`/`typo-fuzzy` tags), but the END-TO-END feel of a real multi-turn session — does it
  open naturally, does it close naturally, does a taught fact actually get used in a LATER inference,
  not just recalled verbatim — is exactly what this session's playtest sprint tested and CHATBENCH
  structurally cannot (it grades single isolated cases, not session arcs).

**This is precisely the gap the pending `SKILL_BENCHMARK_PLAYTEST.md` → `SKILL_BENCHMARK_CONVERSATION.md`
rename/refocus (queued, not yet done) is meant to close**: fluid conversation with greetings and
guided exploration, the ability to accept taught knowledge and use it to make further inferences
(not just recall it), and obtaining a detailed PLAN_COMPLETIONS response via the hub-avoiding crawl
(the degree-dampened `broadSearch`/`groupHits`/`rankSentences` pipeline in `src/completions/`) are
all named, in the operator's own framing, as exactly the territory a scalar benchmark can't capture
but a renamed, refocused conversational benchmark could. Until that rename lands, these three
capability areas are real, shipped (or partially shipped, for completions-in-chat), and
**structurally invisible to every existing benchmark** — worth stating plainly rather than leaving
implicit.

---

## 6. Summary (refresh 2)

Counts below are for the FULL table (refresh 1's 83 rows + this refresh's changes/additions), not
just the delta shown in §1.

- **implemented**: **63** (was 57 in refresh 1; +2 for `cax-dw`'s wiring fix and the consistency
  checker moving from partial/claimed-only to fully implemented-and-measured, +6 new rows for
  session-later work: the relation-chase extraction, Completions Stages 1+3, chatbench case-set v3,
  the playtest sprint's shipped fixes, the four benchmark reports themselves — minus 1 for
  reclassifying the SHACL-gate-via-`shacl-engine` row as explicitly NOT implemented/rejected rather
  than silently folded into the already-correct hand-rolled-validator row)
- **partial**: **4** (refresh 1's 3, +1 new: `cls-svf1`, kernel-complete but chat-wiring-incomplete —
  exactly the same shape as `cax-dw` was before this session's fix)
- **claimed-only**: **21** (unchanged count from refresh 1 — nothing in this bucket moved this
  session; the completions-in-chat row stays here, now with direct behavioral confirmation via
  playtest rather than an inferred grep)
- **explicit scope decision**: **1** (unchanged — multi-language AST extraction)
- **in-flight/uncommitted**: **0** (was 1 in refresh 1 — the construction-grammar bank fully landed)

**The single most consequential finding of this refresh**: two of this session's biggest engineering
efforts (`cax-dw`'s chat-wiring, and everything upstream of PLAN_COMPLETIONS) shared the exact same
failure shape — real, tested, engine-level code with no path from a live chat turn to actually reach
it. One got caught and fixed within the same session (because INFBENCH directly measures it and
flagged zero movement). The other is still open, because **no benchmark currently measures whether
`src/completions/` is reachable from chat at all** — it took a live playtest turn, not any of the
three scalar benchmarks, to surface it. This is the single strongest argument for the pending
`SKILL_BENCHMARK_CONVERSATION.md` refocus: scalar benchmarks are structurally blind to exactly this
class of gap, and this session found two real instances of it by accident, not by design.
