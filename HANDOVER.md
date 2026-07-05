# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
**"Where we are now"** block and **Phase 11** first; this file is the short version.
Session handle (inbox): `mechanic`.

## Where we are (2026-07-06)

- **Shipped: v0.7.1.** Phases 0–10 complete. `npm test` green (≈797), CLI smokes exit 0, main clean.
- The chat surface is strong + measured: concept force (nouns + relations), seed-all vocabulary,
  de-anthropomorphized rendering + cap-32/"more", `--ephemeral` demos, dead-end routing, the
  Repository Interface (v1, consumed by the seonix `codememory` session), provenance/trust, response
  finishing, speculative inference (`tmct syllogise`).
- **Last bench: `CHATBENCH_0.7.1`** — a quality **re-baseline** (seed-all + concept force moved the
  substrate), mean **1.488/2**, tier-1 spine **331/333**. CEFR ladder + the ranked next-levers are in
  that file.
- Completed feature plans are archived under **`archive/`**; the capability-router RFC
  (`PLAN_CAPABILITY_ROUTER.md`) + the planning reference library (`docs/references/planning/`) are the
  live forward docs.

## What's next — Phase 11 (see ROADMAP Phase 11 for the full queue)

The deterministic **capability router** + its own **AGENTBENCH** benchmark. Queued tracks:
1. **Chat-surface levers (next CHATBENCH), all three:** pronoun/focus binding, discourse-count
   anaphora, C1 temporal-over-relative — they raise the chat floor *and* are router prerequisites.
2. **Router build (in order):** Phase A shim (Anthropic `/v1/messages`, also `bedrock-meter`-pluggable)
   → Phase B measure → `AGENTBENCH_0.7.2.md` baseline → Phase C the grading ladder → Stage 0 registry
   → Stage 1 resolver → Stage 4 guardrail → Stage 3 planner (closed-world C1).
3. **`bedrock-meter` surface:** the shim slots into `../bedrock-meter`'s cost optimiser as the **$0
   floor below Nova-micro**; AGENTBENCH defines the envelope the optimiser trusts.
4. **Playtest alongside** (`SKILL_CHAT_PLAYTEST.md`) in a **`git worktree`**, merged back.
5. **Research agents:** Stage 2 (intent frames, controlled fragment) + Stage 5 (goal-reasoner,
   closed-world C2) — off the critical path.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`); `npm test` green at every commit;
push per completed step (operator-gated); coordinator + background sub-agents; CHATBENCH/AGENTBENCH
artifacts match `package.json` version, `_00N` for re-runs. Honest gate for the router: the headline
economic claim is **newly testable, not demonstrated** — the first demo must return a **0%
hallucination rate** on a real domain before any claim ships.

*History (Phases 0–10, releases 0.2.0→0.7.1, cycles 001→0.7.1) lives in git + the `CHATBENCH_*` /
`archive/PLAN_*` artifacts.*
