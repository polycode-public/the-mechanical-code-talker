# NEXT — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log` and the
`reports/BENCHMARK_*.md` reports hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## In-flight right now (2026-07-30)

**No worktrees active. Everything green.** Pipeline `2717338870` (`17673980`) passed every job on
the first attempt, no retries anywhere — `deploy:website`, `publish:npm`, and all four
`e2e:deployed:*` jobs (`shell`/`pages`/`pages-timing`/`mesh`) included.

Chasing that down took three rounds after the 4.0.1 deploy, each real: (1) the new fact-count tile
overflowed `research.html` on a 375px phone viewport, fixed in `6f1fca54`; (2) bundling
`e2e:deployed` into 45 files in one job (this session's own CI restructure, `3315a0f8`) caused
cross-file contention — split into `shell`/`pages`/`mesh` with capped `--test-concurrency`,
`5cd0f652`; (3) three files (`pages-chat-research`/`pages-chat-live-toggle`/
`pages-chat-persistence`, each racing a real elapsed-time budget against a mocked round trip) still
contended inside `:pages` at concurrency 4 — isolated into their own `:pages-timing` job at
concurrency 1, `fae19dd3`. Full detail in each commit's own message.

**Rover-bark regression coverage (`d6c84133`) and the service-worker stale-cache fix + visible
fact count (`9a9b58f7`) are both done and merged** — unit/TUI/chat.html tests and the fact-count
pills across chat/ingest/code/research all independently re-run green by the coordinator. Real
remainder from the service-worker work moved to Open items below.

**MUD3D renamed MUDIII, design only — not yet a build phase.** Full assessment (asset licensing
against `world-of-claudecraft`, planning-domain mechanics, naming/lineage research re: Richard
Bartle/mudii.co.uk) is in `PLAN_MUD.md`. Operator's chosen sequencing: ship `mudiii.html` with
credit to `world-of-claudecraft` and MUD1/MUD2 first, email Bartle once it's live. Still waiting on
the operator's call on timing for that email — noted directly in `PLAN_MUD.md`.

**`PLAN_FACT.md`** (multi-record-per-assertion fact model) is a complete, reviewed design doc, not
yet implemented. See the doc for the worked example, the Sybil/Riak-sibling-resolution research, the
"as of &lt;date&gt;" grammar design, and the migration/schema.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] `PLAN_TOOL_SURFACE.md` phase 1 — reviewed and recommended as worth doing before PLAN_FACT/
  MUDIII implementation (low-risk, already fully scoped), not yet started.
- [ ] MUDIII implementation itself (Three.js town square) — fully designed in `PLAN_MUD.md`, not
  started.
- [ ] `PLAN_FACT.md` implementation itself — fully designed, not started.
- [ ] **the turntable and the move pose — content wave**: bear/cat/dog/king carry four `mgx:faces`
  angles plus a `mgx:pose = moving` frame at the left angle. Fill in the rest: the moving frame at
  the other three angles, then both axes across the remaining animal and person catalog. The shape
  to copy and the anchor arithmetic are in `src/domain/sprite-templates.mjs`'s header.
- [ ] **sprites.html turning-character demo**: an animated swatch cycling the four turntable angles
  next to the existing static emoting character. The page's own cycle only steps `mgx:faces` and
  `mgx:feels` today, so a combined facing-and-pose swatch sits outside it.
- [ ] mud room rebind's epoch fold covers world-state predicates only — `knows-about` testimony
  claims still rank by bare turn across epochs, so a pre-recast "the fox is gone" claim can outrank
  a fresh post-recast sighting of the same fox. Real remainder from `p2p-room.mjs`'s rebind work.


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

4. Concurrent chat.mjs agents work when each brief pins its region (learn-on-miss block /
   logLines + slash commands / factReadBackReaders) and forbids refactors — but the merge gate
   must still rebuild the ask bundle (it inlines chat readers, so it drifts on every reader
   change), re-run the pack-manifest check (three separate agents forgot new `src/` files in one
   day), and watch for same-name declarations across branches (two batches both coined
   `spiderFlyContextAnswer`; esbuild's duplicate-symbol error at bundle time was the catch).
   Seed-content-dependent e2e pins are the other recurring merge hazard: raising the seed caps
   silently grounded the learn-on-miss demo's lookup term, and the sense-split chain rendering
   broke a source-adjacency pin — the fix each time is a probe against the real store, then the
   pin follows the behavior.

5. (2026-07-23) Lesson 2's pattern recurred three separate times in one session, across three
   different background sub-agents, each ending its turn on a variant of "I'll wait for the
   background monitor" while its own `npm test`/judge fan-out was still genuinely running as an
   untracked OS process. The fix each time was the same: verify via `ps aux` in the agent's
   worktree, then `SendMessage` an explicit correction telling it to stop backgrounding entirely
   and block synchronously in the foreground. Brief this into every dispatch up front next time
   ("run test commands in the foreground and let them block; do not end your turn on a command
   still running") rather than catching it after the fact three times running.
   Separately: `npm run roll` bumps the version and regenerates artifacts, but this session pushed
   the resulting commit without re-running `npm test` locally first, trusting CI to catch a
   problem — CI did (the screenshot-manifest gap above), but that's a real gap in this session's
   own discipline, not a success story. `npm test` green at every commit (`CLAUDE.md`'s own rule)
   applies to a roll commit too, even though `roll.mjs`'s own artifact regeneration feels like it
   should be self-verifying.

6. (2026-07-24) Lesson 5's brief line is necessary but not sufficient: with the up-front
   "foreground only, never end your turn on a running command" instruction in EVERY dispatch,
   four of eight background sub-agents in one session still ended turns on "I'll wait for the
   notification" — twice for runs that were genuinely live (those resume correctly on the real
   notification; leave them alone once `ps` confirms the process), twice for phantom waits
   (nothing running; `SendMessage` the correction, pointing at the teed log if the run already
   finished green). The triage that works: `ps aux | grep <worktree-id>` FIRST, then
   `git log`/`status` on the worktree — a live process means wait, a dead one means correct or
   take over. A second identical stall on the same agent means stop it and let the coordinator
   commit its (real, verified) work directly — that recovery took minutes and lost nothing.

7. (2026-07-24) The merge gate's blast-radius run is not a substitute for the full suite on a
   push to `main`. A merge whose own lane and estate guard were green went out without
   `npm test`; CI's `unit` job then failed on `test/adapters/memory-seed-perf.test.mjs`'s
   scaling ratio (12.72x against its 12x bar) — a contention flake, not a regression (the
   local full suite ran 4093/4093 straight after). Two corrections: run the full suite before
   every push that reaches the remote, and when a timing test flakes, harden it rather than
   re-running it. That test had already been hardened once (min-of-5 after flakes at 6.30x and
   10.49x); the remaining weakness is that a RATIO amplifies leftover noise asymmetrically —
   the long batch's every trial can catch contention while the short batch catches a quiet
   moment. Its bar is now 20x, which still leaves the whole quadratic band (64x up) outside.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `reports/BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
