# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
**"Where we are now"** block and **Phase 11** first; this file is the short version.
Session handle (inbox): `mechanic`.

## Where we are (2026-07-06)

- **Built: v0.8.0 — Phase 11 landed (Phases 0–10 shipped in 0.7.1).** All five tracks built across
  concurrent background agents, merged to `main`, `npm test` green (**869**), CLI smokes exit 0.
  **`package.json` is bumped to 0.8.0 locally; the push is HELD for the operator** (CI publishes on a
  version bump on `main`).
- **Track 1 — chat levers (measured).** Pronoun/focus binding, discourse-count anaphora, C1
  temporal-over-relative. `CHATBENCH_0.8.0`: tier-1 spine **331→333**, all three lever families moved
  their cells, B1-temporal control did not spill; judged fixed tag `multi-turn-focus` **1.433→1.9**.
  Judged pooled mean **1.44 is NOT case-comparable** to 0.7.1's 1.488 (graded re-samples 10% each run
  — compare cell-level, not the scalar); the deterministic tier-1 spine is the load-bearing PASS.
- **Track 2 — the router (DEMONSTRATED).** `/v1/messages` shim (`serve` mode) → Stage-0 registry →
  resolver (S1) + guardrail (S4) + planner (S3, pure-JS POP/HTN + Steel & Ho monitor). Measured:
  `AGENTBENCH_0.8.0` (shim-transport floor, 46%) → `AGENTBENCH_0.8.0_001` (real router): **96%
  completion at 0% hallucination on every rung**, closed-world ladder cleared to **C1**.
  **Honest caveat (in the artifact + ROADMAP):** AGENTBENCH grades the correct **call-plan + causal
  proof, NOT the executed composed result**; B1/B2/C1 are **thin (2–3 cases)**; C2 is **refused**
  (Stage 5 unbuilt). "Closed-world C1" = provably-correct tool-plan, not end-to-end reasoning.
- **Track 3 — bedrock-meter.** `../bedrock-meter` has a cost-ascending router ladder with the tmct
  **`$0` rung at rank 0 below nova-micro**; e2e test meters an in-envelope request at **£0**, escalates
  out-of-envelope to nova-micro (73 green there; **unpushed**; no tmct-side change needed).
- **Track 4 — playtest.** 3 frozen transcripts: `test/chatflow-{coverage,history,architecture}.test.mjs`.
- **Track 5 — research.** `docs/references/planning/`: `STAGE_2_INTENT_FRAMES.md`,
  `STAGE_5_GOAL_REASONER.md`, `BDI_GOAL_DRIVEN_AUTONOMY.md`.
- **Coordination artifact:** `STRATEGY_ADVISOR.log` — 25 evidence-backed findings over 11 advisor
  ticks, all logged + actioned (the gameable-gate→metric-pair fix, the planner-hang backstop, the
  plan-not-result caveat, etc.). Worth skimming to see what shaped the build.

## Open follow-ups (next session)

1. **Stage 5 — the C2 goal-reasoner** (BDI + Goal-Driven Autonomy): the one AGENTBENCH C2 case is
   currently refused. Design note ready (`docs/references/planning/STAGE_5_GOAL_REASONER.md`), gated on
   Stage 3 (now done) — buildable next.
2. **Stage 2 — imperative intent frames** (`docs/references/planning/STAGE_2_INTENT_FRAMES.md`): widen
   NL→capability reach. Note the flagged prerequisite: the **ACE engine (`src/grammar/ace.mjs`) is not
   yet wired into the interpret pipeline** (`STRATEGIES` = grammar/keyword-spot/noise-strip only).
   `tmct_calls` is tagged `NOT_NL_REACHABLE` in the registry — Stage 2 is where it becomes reachable.
3. **AGENTBENCH depth**: B1/B2/C1 are 2–3 cases each; grow the ladder and add **result-composition**
   grading (today it grades the call-plan, not the executed answer) so C1 measures reasoning, not just
   routing. Relaxed/overfit cases are tagged in `agentbench/cases.jsonl`.
4. **Playtest dead-ends E could not fix in-scope** (chat.mjs / renderer): singular **"what is a test"**
   (needs `relationTermOf` widening in `src/chat.mjs`); **"who touched X"** renders raw commit hashes
   (want authors/friendly refs); **"tests cover" miss-renderer garble**; subject-anaphora "it"
   inconsistencies in the `last`-only test driver.
5. **Instrument flake**: `chatbench/run.mjs` tier-1 pass count is nondeterministic on the discourse-count
   graded cases (331–333) — **pre-existing** (present on the clean tree), not caused by 0.8.0. The
   authoritative `--compare` id-intersection gate is stable. Worth a deterministic-seed fix.
6. **The push**: 0.8.0 is committed locally, not pushed. Pushing to `main` triggers CI publish — operator-gated.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`); `npm test` green at every commit;
coordinator + background sub-agents with disjoint file-ownership, worktree-isolated, merged back;
CHATBENCH/AGENTBENCH artifacts match `package.json` version, `_00N` for re-runs; no LLM in the product
path (the CHATBENCH judge lives only in the eval harness; AGENTBENCH grading is deterministic).

*History (Phases 0–10, releases 0.2.0→0.7.1) lives in git + the `CHATBENCH_*` / `AGENTBENCH_*` /
`archive/PLAN_*` artifacts. Phase 11 (0.8.0) is in the `CHATBENCH_0.8.0` / `AGENTBENCH_0.8.0*` /
`STRATEGY_ADVISOR.log` artifacts + `src/router/` + `agentbench/`.*
