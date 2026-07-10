# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative, including the full detail of
the 2026-07-10 uplift batch (largest single session to date). This file holds only what to do next —
no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-10)

`v1.4.1` is the current version (not yet pushed this session — see "Discipline" below). The
2026-07-10 batch closed out `PLAN_CHAT_FEEL.md` (fully archived, all 12 items), shipped
`PLAN_COMPLETIONS.md` Stages 0–3 end to end (a brand-new capability), closed `PLAN_INFERENCE_TESTING.md`
stages 3–5 (the full 6-band INFBENCH ladder now passes the gate for the first time — INF-B1
33%→100%, INF-C2 0%→100%), closed out most of `PLAN_AGENTS.md` Phase 0, restructured CHATBENCH's
case set (case-set v3, a 109-case go-to default), and ran all four benchmarks fresh
(`AGENTBENCH_1.4.1.md`, `INFBENCH_1.4.1.md`, `CHATBENCH_1.4.1.md`, `PLAYTESTBENCH_1.4.1.md`) plus a
full capability audit (`CAPABILITIES_AUDIT_2026-07-10.md`). All pre-1.4.1 benchmark reports are now
in `archive/`.

## Open follow-ups (next session, in priority order — ranked by the 4 fresh benchmark reports' own findings)

1. **C2 `pronoun-binding` — CHATBENCH's clearest, highest-impact lever.** 0/10 tier-1 green, 4/10
   judged hard fails, every one confidently-wrong (0 on both correctness AND honesty — the worse
   failure mode, not an honest miss). Long-standing, `PLAN_CHAT_FEEL.md`'s own hardest-tier ceiling;
   no work landed on it this session. See `CHATBENCH_1.4.1.md`'s hard-fail table for the exact case
   ids and dimension scores.
2. **`cls-svf1`'s live chat-query wiring — INFBENCH's last open gap, and the best-scoped item on
   this list.** The kernel rule passes 100%; the chat arm shows `unproven` on all 10 new positive
   cases purely because the query-time wiring wasn't built this session (only `cax-dw` got it). The
   exact pattern to copy (`src/chat.mjs`'s `isaAsk` block, the `deriveDisjointViolations` live-chase
   shape) is fresh in the codebase from this session's own `cax-dw` fix. Would plausibly close
   INF-B2 from 80% to ~100%. See `INFBENCH_1.4.1.md`'s "Next" section.
3. **"who last touched X" ignores the superlative — PLAYTESTBENCH's clearest lever.** Lists the full
   touch history instead of the single most-recent toucher; no distinct code path exists for this
   shape at all (a single-answer "last touched" shape exists for *when*-questions, not
   *who*-questions). Closely related to this session's own temporal-composition work
   (`PLAN_CHAT_FEEL.md` item 6). See `PLAYTESTBENCH_1.4.1.md` round 2.
4. **`A2 naming-vocabulary`'s 2 new CHATBENCH hard fails** (`g-a2-naming-2`, `g-a2-naming-6`) —
   fresh signal, not a known ceiling the way C2 pronoun-binding is. Needs a transcript read before
   it can even be prioritized properly; may be a quick fix or may reveal something deeper.
5. **Wire `src/completions/` into live chat dispatch.** The extractive pipeline (Stages 0–3) shipped
   this session and is real, tested, and unreachable from any actual chat turn — confirmed live by
   PLAYTESTBENCH round 3 ("give me a detailed summary of how X works" still hits the plain grammar
   wall). This is expected (wiring was never in this session's scope), not a regression, but it's
   the single largest unlock available: a whole shipped capability nobody can currently reach from
   chat.
6. **Trailing filler word "then" not stripped** — "so what is a component then" parses as the
   literal unknown term `"component then"` instead of surfacing the just-taught fact. Likely a small
   fix (extend whatever filler-stripping frame doesn't currently cover trailing "then"). See
   `PLAYTESTBENCH_1.4.1.md` round 3.
7. **A has-a-method teach shape** ("every Component has a render method") fails with a vague,
   non-actionable error. **Needs an operator scope decision before any implementation** — is this a
   new ACE pattern worth building, or a deliberate scope boundary (mirroring the lines
   `PLAN_TAUGHT_RELATIONS.md` already drew around which teach shapes to support)? See
   `PLAYTESTBENCH_1.4.1.md` round 2.
8. **Freeze the 2 dead-ends this session's playtest sprint fixed** (bare "what does this do";
   the closing-remark/thanks gap) as `test/chatflow-*.test.mjs` regression transcripts, per
   `SKILL_BENCHMARK_PLAYTEST.md` §5's "freeze what flows" discipline — skipped this cycle, flagged
   honestly rather than silently dropped.
9. **`scm-svf`/cardinality monotonicity** (`PLAN_INFERENCE_TESTING.md` stage 4's remainder) —
   confirmed unmeasurable against today's INF-C1 fixture (it's already at 90%, unrelated to what
   either rule would fix); revisit only if a future case-generation pass adds a template that
   actually exercises them.
10. **The chat-surface debt re-measure** (`PLAN_AGENTS.md` §3) is the one Phase 0 item this session
    didn't touch — still open.
11. **AGENTBENCH needs no action** — confirmed byte-identical to `0.8.2`, fully gate-passing on
    every rung; the router/goal-reasoner surface is stable. Noted for completeness, not because
    anything is broken.

**Also still open from this session's own tail, not benchmark-derived:** two pending skill-doc
renames (`SKILL_BENCHMARK_PLAYTEST.md` → `SKILL_BENCHMARK_CONVERSATION.md`, refocused on fluid
conversation/knowledge-acceptance-and-inference/completions retrieval via the hub-avoiding crawl;
`SKILL_BENCHMARK_CHAT.md` → `SKILL_BENCHMARK_CEFR_ENGLISH.md` with historic report renames to
match), a refresh of `CAPABILITIES_AUDIT_2026-07-10.md` incorporating this batch's benchmark
results, and a speculative comparative table (tmct vs. local/AWS/Anthropic model tiers, plus a
to-be sketch) — all explicitly operator-sequenced to run after this list, not yet started.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions. **A hard-won lesson from this
session**: background sub-agents sharing one working tree (no worktree isolation) can and did run
destructive/shared git operations (`git stash`) meant only for the coordinator — twice, both
recovered without loss, but now explicitly called out in every dispatch brief: sub-agents may only
`git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`. Also:
the harness's permission system blocks `git commit` for *background* sub-agents entirely in some
configurations (no live user to approve a permission-gated action) — the coordinator does the
committing itself in the foreground when this happens, verifying `git status` immediately before
every stage to avoid sweeping in another track's pre-staged files (a real near-miss this session,
caught and fixed before it landed). No LLM in the product path, ever.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CHATBENCH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`PLAYTESTBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped before the items above, including this session's own dated entry in full.*
