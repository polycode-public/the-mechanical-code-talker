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

v2.4.2 in the working tree, unpushed. CI publishes on a version bump on main.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

### Verified green at HEAD, on a quiet machine

The full `npm test` is **2771/2771** — it surfaced 11 cross-lane regressions from the concurrent
agents' changes (a `seon:` prefix proxy in the CEGIS enumerator broken by the §7.2 rename, and the
three-valued `tested` qualifier over-reaching to classes with no resolvable module); all were fixed
at root and re-run green. `npm run check:budgets` passes standalone (`test:smoke` 689ms/1000ms,
`test:fast` 1482ms/10000ms) — the earlier "over budget" reading was the self-inflicted-load error.
Nothing is pushed; the operator gates that.

## Open items

`PLAN_OPEN_ITEMS.md` is the build order and holds the detail — its "Execution status" section
carries the phase table, the operator decisions already taken, the traps this cycle hit, and the
list of this plan's own citations that proved false. Read that before quoting any fix site.

Phases 1–7 and 10 are closed, and this round closed the last of the phase-table backlog: the two
parser defects (the multi-sentence teach bullet and the silent count-restrictor total), Phase 7's
two leftover rows (the `runChat` block and the `repository-interface.md` prose, both now pinned),
and `PLAN_NORMATIVE.md` §7.5 (the PROV Source split) and §7.6 (the SKOS derived-view). What remains:

- **N1 — universal quantifier over a module set.** `do all modules import X` fails on a duplicated
  ambiguous parse; wire it to the set-complement machinery `which modules do not import X` already
  has. Found by the 2.0.3 benchmark re-audit (`BENCHMARK_CONVERSATION` item 17), not previously
  tracked. See `PLAN_OPEN_ITEMS.md`.
- **N2 / N3 — two stale-doc corrections** the benchmark re-audit surfaced, not yet folded into
  Phase 5: `PLAN_PARAPHRASE_VERIFICATION.md` frames an already-chat-wired slice as future (and no
  corpus row pins that surface), and `PLAN_SYLLOGIST_EL_DL.md` still lists the shipped-and-archived
  defeasible tier as an undesigned future tier.
- **Phase 4's re-measurements** (sequencing item 11, not yet run): CEFR back to N=2, the INFBENCH
  existential probe, the 6th CONVERSATION persona, the 315-case CHATBENCH pool, and the
  resolver-floor `ab-c2-what-to-test` decision. The phase table's "Phase 4 DONE" marks the pinning
  commits, not these measurements.

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
