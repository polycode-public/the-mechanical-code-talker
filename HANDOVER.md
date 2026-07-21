# HANDOVER — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md`
reports and `CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Open items

`archive/` holds delivered plan docs; each records what its delivery deliberately did not include.
What remains:

- CONVERSATION persona-sweep backlog (`BENCHMARK_CONVERSATION_2.7.11.md`): 29 fresh findings
  across 6 personas, ranked in the report. Worked in the report's priority order; what's still
  open, named explicitly (genuine horizons, not forced): filler-clause prefix widening (the report
  identifies one root cause behind several surface symptoms — "ok so", "oh nice. um what about",
  "one more random thing," — but widening the existing short-prefix stripper to longer clause
  shapes without over-matching real content needs its own design pass); silent narrowing without
  disclosure ("the router" resolving to the Router class over the router.mjs module, a directory
  reference narrowing to one of several members) — needs a design decision on how/where to surface
  the narrower reading, not just a string tweak; plan-justification counterfactual and
  alternative-choice questions ("what if disk-1 started on peg-c instead?", "why did you send
  crate-c to a pallet instead of stacking it on crate-b?") — these ask the planner to explain a
  path it did NOT take, which the current BFS never computes at all; the session sidecar/log still
  rewrites verbatim natural-language input to the canonical form matched (a recurrence of a
  previously-known, still-open item); and the smaller wall gaps not yet investigated — "give me the
  big picture on this codebase", "tell me about the router thing", "what is the entry point"/"where
  do i start reading", "what is the purpose of the validate module", "whats the most important
  file" (a superlative with no default ranking criterion), casual/longer farewells. Full ranked list
  and routing in the report.

- Page-vocabulary audit findings routed to the chat engine (from the six-pages round): "what is
  the letter?" on an adventure session reads back the `mgx:hidden-in` fact and spoils the hidden
  key — the describe lane should exclude world-secret predicates the way the adventure lane's own
  where-reader already does; predicate verbalization garbles world predicates ("currentlies in",
  "workses in") — wants curated `FACT_PREDICATE_PHRASES` rows; lane gaps: "where am I?"/"what can
  I do?"/"what is the quest?" on adventure sessions, "where is the spider?" on spider-fly, "what
  is the goal?" on plan sessions (answers from the child corpus instead of planState), "how many
  X are there?" cannot count taught class members, and the teach frame declines "the tower has 3
  disks." (determiner subject) while the bare form teaches.

- Live-Wikipedia trust prior: `reference:wikipedia-live` content scores the same 0.6 prior as the
  curated, revision-pinned shipped pack. If live content should rank lower, that is one new
  source kind in trust.mjs plus a parse branch.

- Chat-seed scale: conceptnet is capped at 2,000 facts (10x the old 200) because the uncapped
  init:xl set measures ~86 MB serialized. Lifting the caps means leaving the 16-24 MB seed
  ceiling range — an operator call.

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
