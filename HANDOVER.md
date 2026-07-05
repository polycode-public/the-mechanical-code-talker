# HANDOVER — Phases 5–9 + provenance + security + release

Living handover for the multi-stage roadmap push. Any session can resume from here.
Plan of record: `/Users/antony/.claude/plans/hello-claude-please-complete-hidden-quokka.md`.
Session handle (inbox): `mechanic`.

## Operator decisions (locked)
- Release: **bump 0.4.0 + `npm publish --provenance`** (version bump is the LAST commit).
- Measurement: **single final chatbench 004** (batch measure; per-lever attribution collapsed;
  004 marked a groundedness re-baseline per Meta-1).
- OSS ACE parser: **deferred** (Stage 7 doc-only).
- Push cadence: **push per completed stage**, `npm test` green each time.

## Build order (dependency-gated)
Stage 0 foundations → Stage 1 provenance&trust → Stage 2 Phase-5 levers → Stage 3 Phase 6 →
Stage 4 Phase 7 → Stage 5 Phase 8 → Stage 6 Phase 9 → Stage 7 (deferred doc) → Stage 8 docs+0.4.0
→ chatbench 004.

## Status

| Stage | State | Notes |
|---|---|---|
| 0 — foundations | ✅ DONE, pushed | src/hash.mjs single-source fnv1a; src/wink-model.mjs shared loader + browser seam; seonix security port + npm provenance. 602 tests green, both smokes exit 0. Commits 5225e62 / 5794443 / 9409685. |
| 1 — provenance & trust | ⏳ next | PLAN_PROVENANCE_TRUST.md a→d. Blocks 6/7/9. |
| 2 — Phase 5 levers | pending | PLAN_CYCLE_4.md |
| 3 — Phase 6 | pending | PLAN_FORMULAIC_COMPETENCE.md |
| 4 — Phase 7 | pending | PLAN_RESPONSE_FINISHING.md |
| 5 — Phase 8 | pending | PLAN_REPOSITORY_INTERFACE.md |
| 6 — Phase 9 | pending | PLAN_SPECULATIVE_INFERENCE.md |
| 7 — ACE parser | deferred | doc-only this round |
| 8 — docs + release | pending | README, homepage, ROADMAP status, 0.4.0 bump |
| final — chatbench 004 | pending | SKILL_TUNING_CYCLE.md |

## Test / smoke state
- `npm test`: **602 pass / 0 fail** (as of Stage 0).
- Smokes: graph-less bootstrap (seeds 500 facts, exit 0) + fixture-graph (8 modules, exit 0).

## Last bench numbers (baseline to beat, from CHATBENCH_003 / Cycle 3)
CEFR: A1 1.72 · A2 1.70 · **B1 0.77 (cliff)** · B2 0.97 · C1 1.07 · C2 0.69. Combined 1.258 (trap
number). Dual-draw agreement 27/30 cells (3 under-covered: B1 pron, B1 temporal, C1 temporal).

## Open decisions / risks
- Negation set-complement needs a **bounded universe**; refuse complement over the non-enumerable
  `Change` pseudo-type (PLAN_CYCLE_4 open Q).
- chatbench 004 is a groundedness **re-baseline** (Meta-1 changed FIXTURE_CONTEXT) — never compare
  v1-context groundedness to v2-context.

## Strategy advisor
Background Opus 4.8, ~5-min re-arm on completion; append-only OPEN items in `STRATEGY_ADVISOR.log`.
Tick 1 confirmed the fnv1a byte-identity (200k fuzz).
