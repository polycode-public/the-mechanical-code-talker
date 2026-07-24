# NEXT — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log` and the `BENCHMARK_*.md`
reports hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## In flight (2026-07-24, ten concurrent worktree agents off `3f7a209c`, coordinator batching to main)

Each line names its worktree branch; delete the line in the same commit that integrates the work.

- discourse record slices 1+2 (PLAN_DISCOURSE_AND_RECOGNITION Part A) — `worktree-agent-a7e1eb742050b37d0`
- repo-index phase 6, PLAN_CODE.md → seonix + tmct-side Track 5/§2.1 extraction — `worktree-agent-afa3e9b694e3d26fd`
- benchmark mechanisation levers 1+6/2/3/7 (PLAN_BENCHMARK_MECHANISATION) — `worktree-agent-aef6ab2019223c753`
- digest stages 1–4 as pure modules (PLAN_DIGEST; stage-5 wiring dispatches after discourse lands) — `worktree-agent-a9f701e5d2c1029b8`
- idxbench + researchbench harnesses (their SKILL_BENCHMARK docs) — `worktree-agent-af3e4262349bcba57`
- ingestbench harness (ING-8 checker; ING-9 dry-run only) — `worktree-agent-a32126735fd410725`
- PLAN_CODE Track 5 foundations §3.1–3.3 + §2.1 scoping spike — `worktree-agent-af82e4e64eee61759`

## Open items

- [ ] playtest batch (2026-07-24, 3.0.0 indexing surface; fix together once the discourse agent
  releases chat.mjs — no fabrications found, all items are routing/orientation):
  1. "show me the architecture" resolves the SYMBOL `renderArchitecture` and dumps its definition
     instead of routing to the architecture map — the symbol-describe lane wins on the literal
     token before any architecture-intent lane (chat.mjs ~334);
  2. no NL phrasing reaches the architecture overview at all ("what is the architecture of this
     repo" falls to the vocabulary-touch teach-offer) — the map is reachable only via `tmct cli
     digest`;
  3. "give me an overview" fails to parse while "the big picture"/"the lay of the land" are wired
     (META_ORIENT closed set, chat.mjs ~1075) — add the overview phrasings;
  4. `tmct init` on a source tree already auto-indexes (9-module call answers work) but announces
     only paths+seeds — add an "indexed N modules" line so the capability is discoverable;
  5. "what is codegraph" (bare module basename) gets orientation boilerplate while "what is
     codegraph.mjs" and "describe codegraph" both resolve — align the "what is X" resolver with
     describe's basename resolution;
  6. importer disambiguation notes leak fuzzy non-matches ("3 other matches" naming modules with
     no textual relation to the query);
  7. (recorded, decide separately) teaching a fact about a code entity is refused because graph
     entities don't count as grounded terms for teach — the one place code-graph and taught
     memory don't compose today.

- [ ] start `PLAN_DISCOURSE_AND_RECOGNITION.md` Part A slice 1 — build `src/domain/discourse.mjs` (the four closed tables, `emptyRecord`/`register`/`bind`/`retire`), thread the record through `runTurn` beside `focus` and `last`, and register from the commit-filter lane only. Nothing reads it yet, so no lane can regress; a unit file over the pure module plus a probe that the record fills is the whole test surface. Slice 2 then flips the frozen row `games/cross-turn-temporal-composition-unbuilt`
- [ ] finish the repo index: the `repo-index` branch is merged (3.0.0); what remains is the `PLAN_REPO_INDEX.md` remainder — phase 5 (`init --repo --with-persona code` runs `indexRepository` after scaffolding) and phase 6 (the PLAN_CODE.md move into seonix, cross-repo). Language scope is settled: tmct ships JS/TS + Python, seonix registers C#/Java through the backend seam, so what remains on the language axis is proving that seam admits an out-of-repo backend with no tmct change

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
history, plus the `BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
