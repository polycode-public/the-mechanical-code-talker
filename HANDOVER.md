# HANDOVER — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"What tmct is" and "What's next" sections for the full feature-level picture. This file holds ONLY
what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md` reports and
`CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-17)

v2.5.0 in the working tree; everything through 2.4.3 is pushed to `origin/main`. 2.5.0 is the
version the current benchmark round measures, committed locally and unpushed. CI publishes on a
version bump on main.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

## Open items

`PLAN_OPEN_ITEMS.md` is the build order and holds the detail — its "Execution status" section
carries the phase table, the operator decisions already taken, the traps this cycle hit, and the
list of this plan's own citations that proved false. Read that before quoting any fix site.

The `PLAN_OPEN_ITEMS.md` phase-table backlog is fully closed (`git log` and the plan doc hold the
record). What remains:

- **The 2.5.0 benchmark round's routed backlog.** All four axes re-ran at 2.5.0 (`BENCHMARK_{AGENT,
  INFERENCE,CEFR_ENGLISH,CONVERSATION}_2.5.0.md`). Every 2.0.3 confident-wrong is confirmed fixed;
  the CONVERSATION persona sweep (6 frames, ~410 probes) then found 11 new confident-wrong — full
  routed backlog in that report, worst first:
  - a taught subclass chain proves a conclusion the store holds `owl:disjointWith`
    (`rex is a dog`/`every dog is a cat`/`no dog is a cat`/`is rex a cat` → "yes, with a proof"). The
    direct disjointness query is correct, so the gap is the multi-hop prover not validating its
    conclusion against the stored disjointness.
  - `blast radius of X` is parsed as a teach and written to memory — a read-only question that
    mutates state.
  - the `i wanna know about X` first-person desire family misroutes to the teach frame — a new
    Tier-0 confident-wrong, so the flow ladder does **not** ratchet past Tier 0.
  - the multi-candidate half of the item-1.4 stale-modifier family still enumerates answers for
    modules the user never named.
  - plus a cluster of paraphrase-routing honest-misses (impact phrasings, the README board-read
    `where does disk-1 rest?`, expansion follow-ups).
- **CEFR two follow-ups:** `be-honest-empty` still expects the pre-rewording bootstrap-empty text (a
  frozen-expectation drift — the answer is an honest miss the judge scores 2/2), and `gq-impact-a`'s
  `/impact` depth-2 label (`(imports it)` for a transitive dependent) wants a small rephrase.
- **The resolver-floor `ab-c2-what-to-test` decision** (`BENCHMARK_AGENT_2.5.0.md`, and Phase 4.5 of
  `PLAN_OPEN_ITEMS.md`). On the AGENTBENCH resolver-floor driver arm, the C2 case
  `ab-c2-what-to-test` stopped producing a completed plan (`completed: true → false`), dropping the
  resolver's C2 plan-completion from 36% to 27%; the 2.5.0 re-run confirmed it holds at 27%, so it is
  a stable state, not a transient. The open question is which of two readings is right: either the
  floor's expectation should move down — the plan legitimately now comes from the goal reasoner,
  which the floor arm lacks by construction — or the resolver genuinely lost a plan it should still
  build. The goal driver still composes the case (56/56 clears C2), so only the floor arm is
  affected. Resolve it by either lowering the floor arm's expected result for this case or restoring
  the resolver's plan; do not leave the two arms silently disagreeing.

## Discipline

`CLAUDE.md` is the standing working model: the coordinator/background-sub-agent split, the test
blast radius, the versioning and push rules, and the repo-local identity. Read it there. This
section holds only what `CLAUDE.md` doesn't.

Three hard-won lessons, carried forward:

1. Background sub-agents sharing one working tree (no worktree isolation) can and did run
   destructive/shared git operations (`git stash`) meant only for the coordinator — recovered
   without loss, but now explicitly called out in every dispatch brief: sub-agents may only
   `git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`.
   Also: the harness's permission system blocks `git commit` for *background* sub-agents entirely
   in some configurations (no live user to approve a permission-gated action) — the coordinator does
   the committing itself in the foreground when this happens, verifying `git status` immediately
   before every stage to avoid sweeping in another track's pre-staged files. (Re-proven 2026-07-15:
   a `git add -A` swept another session's untracked design doc into a commit — caught and amended
   out. List paths explicitly, or review `git status` line by line first.)

2. A background sub-agent's own final "completed" notification is not reliable proof it actually
   finished — an agent reporting a vague "I'll wait for the Monitor notification" as its terminal
   output is a sign of unfinished work, not a status update, even when its worktree in fact holds
   complete, real, committed work. Always verify via `git log`/`git status` on the agent's own
   worktree directly before deciding whether to resume it or treat it as done — trust the commits,
   not the prose. An agent stuck repeating the same "still waiting" message across multiple
   notifications is a sign to `TaskStop` it explicitly rather than keep resuming, once its worktree
   confirms the real work is already complete.

3. Never resume (`SendMessage`) a round whose worktree has already been auto-removed — relaunch
   fresh instead. This was observed twice: once an agent fell back to operating directly in the
   coordinator's own shared working tree; on a later occasion this went as far as checking out a
   brand-new branch on the shared worktree itself (caught immediately via `git branch
   --show-current` returning something other than `main`, no work lost). The rule: before resuming
   any stalled round, check `git worktree list` for its path
   — if it's gone, `TaskStop` that round and dispatch a fresh one instead, never `SendMessage` it
   back to life.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
