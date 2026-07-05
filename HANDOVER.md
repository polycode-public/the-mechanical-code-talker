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
| 0 — foundations | ✅ DONE, pushed | hash single-source, wink shared loader + browser seam, security + npm provenance. |
| 1 — provenance & trust | ✅ DONE, pushed | createdAt, Source edges, computeTrust, trust-weighted retrieval, contradiction inspector; legacy string kept as compat shim. |
| 2 — Phase 5 levers | ✅ DONE, pushed | negation set-complement + reversible-passive (guards green); harness Meta-1/2 + pool + dual-banding; assert-recall read-back. |
| 3 — Phase 6 | ✅ DONE, pushed | dual-banding + technical (C1) register. |
| 4 — Phase 7 | ✅ DONE, pushed | segmentation IR + grammar-rule engine (a/an active, voice rules parked) + finish seam + canonise-link. |
| 5 — Phase 8 | ✅ DONE, pushed | typed service + versioned contract + conformance kit + providers + session handle + `tmct init`. |
| 6 — Phase 9 | ✅ DONE, pushed | `tmct syllogise` subClassOf closure, budget/focus/trust guards; kill criterion MET (flips real misses on default seed). |
| 7 — ACE parser | deferred | doc-only; PLAN_OSS_ACE_PARSER.md is the follow-up spec. |
| 8 — docs + release | 🔄 in progress | docs agent updating README/homepage/ROADMAP/PLANs; 0.4.0 bump is the LAST commit (after 004). |
| final — chatbench 004 | 🔄 running | product replay done (333 rows, NO tier-1 regressions; B1 negation 5/5, passive 5/5 green); judge fanning out x3 @ conc 12. |

## Test / smoke state
- `npm test`: **714 pass / 0 fail**. Both smokes exit 0. `tmct init` + `tmct syllogise` drive clean.

## chatbench 004 (in flight)
- Product replay: `chatbench/results/raw/run-cycle-004/product-a.jsonl` (333 rows), `product-b.jsonl`, `agreement.json`.
- No tier-1 regressions vs cycle-003. B1 negation 5/5 green (was 0.200), reversible-passive 5/5 (was 0.478).
- Judge: pinned claude-haiku-4-5 / judge-prompt-v1, N=3, concurrency 12 → judged.jsonl + summary.json.
- Cycle 4 is a **groundedness RE-BASELINE** (FIXTURE_CONTEXT → fixture-context-v2); do not compare v1-context groundedness to v2-context.
- Pending write-up: CHATBENCH_004.md + CHATBENCH_004_TRANSCRIPTS.md.

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
