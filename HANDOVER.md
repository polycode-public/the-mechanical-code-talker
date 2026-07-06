# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
**"Where we are now"** block and **Phase 11** first; this file is the short version.
Session handle (inbox): `mechanic`.

## Where we are (2026-07-06)

- **v0.8.0 SHIPPED + PUBLISHED** (tmct `main` pushed; CI published on the version bump; `../bedrock-meter`
  pushed too). **v0.8.1 BUILT — push HELD for the operator** (`package.json` = 0.8.1 locally; pushing
  `main` triggers CI publish). `npm test` green (**916**), CLI smokes exit 0.
- **0.8.1 deepened the router with real reasoning measurement + the two frontier stages:**
  - **AGENTBENCH grades the executed composed RESULT** now, not just the call-plan (retires the biggest
    0.8.0 caveat). Resolver under result-grading: **97% plan / 91% result / 0% hallucination**.
  - **Stage 5 C2 goal-reasoner** (`src/router/goal-reasoner.mjs`, BDI + GDA). Honest **like-for-like**
    figure = the driver swap on the identical 39-case ladder (`AGENTBENCH_0.8.1_001`): resolver **85% →
    goal 95% result** (+10pp, 0% halluc). C2 cleared for **one declared coverage-invariant goal-rule** —
    real + phrasing-robust (held-out phrasings graded blind, grep-clean of request literals), but
    **thinly sampled, not rule-general**; open-world case honestly refused. *(The cross-release "0→83%
    C2" is on a grown 6-case ladder authored for the goal-reasoner — NOT like-for-like; same-basket win
    is one case, original C2 0→50%.)*
  - **Stage 2 intent frames + ACE** (`AGENTBENCH_0.8.1_002`, goal driver): **100% plan / 95% result /
    0% halluc**. `tmct_calls` **genuinely NL-reachable** (distinct edge-dump frame; `NOT_NL_REACHABLE`
    now `{}`, bidirectional-conformance-enforced). ACE wired **async** → the sync CHATBENCH spine is
    byte-identical; `interpret()` is called nowhere in the product path (chat/ask/server/bin), so ACE is
    inert in the shipped product — reach without regression.
  - **Chat (CHATBENCH_0.8.1):** quick wins (singular "what is a test", friendly commit-author refs, "No
    tests cover X", chatbench discourse-count flake root-caused = per-run provenance UUIDs scrubbed) +
    two playtests → **6 frozen `test/chatflow-*` transcripts**. Joint deterministic CHATBENCH (both new
    frame tables together): **no tier-1 regression vs 0.7.1** (verified on `main`). Judged tags the text
    changes touched were **re-judged, not blanket-reused** — see `CHATBENCH_0.8.1`.
- **Coordination artifact:** `STRATEGY_ADVISOR.log` — **37 findings over 15 advisor ticks** (11 in 0.8.0,
  4 + final in 0.8.1), all logged + actioned (the gameable-gate→metric-pair fix, the planner-hang
  backstop, plan-not-result, the C2 overfit trap, the same-basket caveat, the judged-reuse correction).

## Open follow-ups (next session)

1. **Author→commit querying** (a dead-end the friendly-commit-ref quick win OPENED): "what did Grace
   Hopper touch" / "who is Grace Hopper" wall — author is a Commit *attribute*, no author node. Fix:
   either an author→commits→touched traversal in `src/ask.mjs`, or (cheaper) pass the graph into the
   touch-query miss renderer so an object matching a known author yields a nudge.
2. **Grow C2 beyond one goal-rule** — C2 rests on a single coverage-invariant `GOAL_RULES` entry;
   author a second declared goal-rule + held-out phrasings so "C2 cleared" is rule-general, not thin.
3. **AGENTBENCH ladder depth** — B1/B2 are healthier now but the abstract rungs are still small; grow
   result-composition cases (static `expect.result` literals, fixture-linted).
4. **Product ← bench import smell** — `src/router/resolver.mjs` imports `hallucinationsIn` from
   `agentbench/grade.mjs`; the bench should not be a product dependency. Extract the shared check to
   `src/router/`.
5. **Lower-priority chat ceilings** (honest nudges, not walls): imperative "make a test for it",
   why-questions "why is it untested", churn-focus anaphora in the `runTurn(+last)` path.
6. **The push**: 0.8.1 is committed locally, not pushed. Pushing `main` triggers CI publish — operator-gated.

### Bench reuse map (0.8.0 & 0.8.1 are FROZEN; a re-run rolls the version, reusing what's still valid)

Deterministic AGENTBENCH/CHATBENCH reproduce byte-identically and are cheap to re-run. **The judged
CHATBENCH is the ONLY expensive part and must NOT be blanket-reused across a text change:** any lever
that alters answer *text* on a judged surface (as 0.8.1's quick wins + playtests did on graph-query /
ambiguity / multi-turn-focus / memory-recall / honesty-miss / A1-graded) makes those 0.8.0 judged
scores stale even though the deterministic `answerMatch` still passes. Re-judge the touched tags; carry
untouched tags. AGENTBENCH is fully deterministic (no judge) — always safe to re-run.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`); `npm test` green at every commit;
coordinator + background sub-agents, disjoint file-ownership, worktree-isolated, merged back; a ~5-min
completion-driven **strategy advisor** running throughout; CHATBENCH/AGENTBENCH artifacts match
`package.json` version, `_00N` for re-runs; no LLM in the product path (the CHATBENCH judge lives only
in the eval harness; AGENTBENCH grading is deterministic).

*History (Phases 0–10, releases 0.2.0→0.7.1) lives in git + the `CHATBENCH_*` / `archive/PLAN_*`
artifacts. Phase 11 (0.8.0 + 0.8.1) is in `CHATBENCH_0.8.*` / `AGENTBENCH_0.8.*` / `STRATEGY_ADVISOR.log`
+ `src/router/` + `agentbench/`.*
