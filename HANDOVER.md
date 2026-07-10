# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative, including the full detail of
the 2026-07-10 uplift batch (largest single session to date). This file holds only what to do next —
no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-10, later same day)

`v1.5.0` is the current version (not yet pushed this session — see "Discipline" below), one commit
(`ae926a8`) ahead of what shipped. This session closed all 12 of the prior "Open follow-ups" below
(items 1–12, each committed individually — see `git log` for the exact commit per item) plus ran a
3-round `SKILL_BENCHMARK_CONVERSATION.md` capped sprint that found and fixed 5 more real dead-ends
along the way. Full narrative (what each item's fix actually was) lives in `ROADMAP.md`'s "Where we
are now" and the git history itself, per this file's own no-completed-work-narrative discipline.
Post-merge full re-runs confirmed **zero regressions**: CHATBENCH 108/109 tier-1 (the one fail is
pre-existing, present in the `run-1.4.1` baseline from before this session started); INFBENCH
206/209 (99%), the only 3 fails the same pre-existing INF-C1 cardinality cases item 11 already
names as unmeasurable/no-action. `npm test` is green at 1740 (was ~1673 at session start).

## Open follow-ups (next session, ranked by what was actually found working the sprint end to end)

1. **`src/completions/`'s live wiring is real but structurally can't answer a first-time question —
   this is the single biggest lever left.** The (4e) COMPLETIONS RESCUE lane (shipped this session)
   correctly calls `generateCompletion()`, but `completionsRescueAnswer` never passes a
   `graphService` adapter through to `broadSearch` (`src/completions/search.mjs`) — so `broadSearch`
   can ONLY ever search memory **blocks** written via an explicit `saveBlock()` call
   (`src/memory/blocks.mjs`), never the live code graph or taught Facts directly. Nothing in
   ordinary chat teaching/asking ever calls `saveBlock()`. Net effect: "give me a detailed summary
   of how X works" declines for ANY subject on its first real mention in a session, no matter how
   much the graph or memory actually knows about it — confirmed live, twice, in the playtest sprint
   (round 1: `src/core/store.mjs`; round 2: `TaskController`), and it only ever worked in this
   session's own unit tests because they pre-seed blocks directly via `saveBlock()`. The fix is a
   real `graphService`-shaped adapter (an object with `.search(q, {limit})`/`.ask(q)` methods —
   `src/completions/search.mjs`'s own `broadSearch` already expects this shape) wrapping the loaded
   graph/`ask()`, wired into `completionsRescueAnswer`'s call to `generateCompletion`. Non-trivial
   (needs its own scoping pass), not a quick regex fix.
2. **A short (≤3-word) general-verb or ownership teach sentence silently fails to store, with no
   diagnostic — root cause not yet traced.** "grace mentors alan" and "sam owns TaskController"
   (memoryDir set, real graph loaded) both produce the raw structural wall
   ("couldn't parse this as a graph question…") instead of either storing or giving an honest
   teach-miss message. `generalVerbTeach`'s own regex (`GENERAL_VERB_TEACH_RE`) matches "mentors" in
   isolation; `OWNS_TEACH_RE` matches "owns"/"TaskController" in isolation too — both confirmed via
   direct regex testing. But neither actually fires through the real `teachLane` dispatch, even at
   4+ words (ruling out the isConversationalCandidate word-count race that explains a related,
   already-understood class of bug elsewhere). `teachLane` is gated on `via === "composed"`
   (chat.mjs ~6486) after `assertTurn` (the formal ACE-OWL `parseAce` path, a completely different
   mechanism) has already declined — the actual failure point is somewhere in that handoff or in
   `teachLane`'s own internal pattern sequence (multiple regexes tried in order — one may be
   mis-firing ahead of `generalVerbTeach`/`OWNS_TEACH_RE` and swallowing the sentence without
   storing). Needs tracing through `teachLane`'s actual call sequence with a real payload, not just
   isolated regex tests. Found live, playtest sprint round 3.
3. **The farewell/thanks multi-clause generalization (this session's own item 2 fix) still has a
   narrower gap than a plain THANKS-set miss: an unlisted acknowledgement word combined with a
   longer-than-3-word second clause.** "brilliant, that's all I needed" hit the wall — "brilliant"
   itself is now fixed (added to `THANKS`, this session), but the underlying `farewellOrThanksSignal`
   guard requiring every OTHER clause be ≤3 words/non-codeish is stricter than real closings need
   ("that's all I needed" is 4 words). Worth revisiting that specific threshold/guard now that it's
   been hit by a second real phrasing (see the guard's own docblock in `src/chat.mjs` for why it was
   set conservatively in the first place). Found live, playtest sprint round 3.
4. **A stranger's very first turn, wrapped in an unrecognized opener, still hits the raw wall.**
   "hey, first time trying this out - what is in here?" — `GREETING_PREAMBLE_RE` strips "hey,"
   correctly, but the remainder ("first time trying this out - what is in here?") matches no
   existing preamble frame (`BROWSING_PREAMBLE_RE` only covers "just poking/looking around" style
   phrasings) nor any `CAPABILITY_PHRASES` entry, so it falls through to ask()'s structural
   pipeline and fails outright. A narrower, standalone bare "hey what is in here" already resolves
   as a context-pronoun-unresolved miss (better, but still not ideal for a first-time user with no
   focus at all). Two independent, smaller fixes needed: widen the preamble-frame recognition, and
   consider a no-standing-focus fallback for bare "what is in here"-shaped queries to the
   orientation reading. Found live, playtest sprint round 1; not fixed this session (lower priority
   than the two real fixes that round did ship).
5. **`A2 naming-vocabulary`'s 2 CHATBENCH hard fails are now fixed** (`g-a2-naming-2`,
   `g-a2-naming-6` — item 6) — noted here only because CHATBENCH's own case-set may still show them
   as `baselineFail`-tagged from the pre-fix run; re-run the judge (not just tier-1) to confirm the
   graded mean actually moved, if that number matters for the next write-up.
6. **`scm-svf`/cardinality monotonicity** (`PLAN_INFERENCE_TESTING.md` stage 4's remainder) —
   still confirmed unmeasurable against the current INF-C1 fixture (steady at 90%, unrelated to
   what either rule would fix, unchanged this session); revisit only if a future case-generation
   pass adds a template that actually exercises them.
7. **AGENTBENCH needs no action** — not re-run this session (nothing touched its surface); confirm
   it's still byte-identical to `0.8.2` next time something near the router/goal-reasoner changes.
8. **15 stale git worktrees under `.claude/worktrees/`** (dated 2026-07-06/07, unrelated to this
   session) were found and left untouched pending operator confirmation — see the operator's own
   chat log this session for the exact list + `git worktree remove` commands per one, 13 of 15
   confirmed fully merged into `main` already (safe to delete), 2 not (worth a `git diff` check
   first). Not acted on without explicit sign-off, per this repo's own destructive-action discipline.

**Everything else from the prior "Open follow-ups" list (items 1–12: C2 pronoun-binding, the
farewell/thanks closed-set generalization, the teach-refusal message + recall gap, `cls-svf1`'s live
wiring, "who last touched X", the A2 naming-vocabulary hard fails, wiring `src/completions/` into
dispatch at all, the trailing "then" filler, the has-a-method teach shape, the batch of smaller
parsing gaps, and the chat-surface debt re-measure) is DONE, committed, and confirmed regression-free
by the post-merge full CHATBENCH/INFBENCH re-run above — see `git log --oneline` for the individual
commits, each referencing its item number.**

## Discipline (unchanged)

**Working model: coordinator + background sub-agents** (copied verbatim from this repo's own
`CLAUDE.md` on 2026-07-10, at the operator's request, so it's visible directly in this file too):
run big tasks in concurrent background sub-agents and keep the main chat free — the main session
is the COORDINATOR (plans, launches, integrates, answers the operator), not the worker. Decompose
into workstreams with clear file-ownership boundaries; serialize on shared files (one agent owns
`package.json`, `src/`, `bin/`, `test/` sequences; docs/site tracks run in parallel). Keep the chat
for chat: anything long-running (benchmarks, judge passes, builds, test sweeps) executes as a
BACKGROUND task at maximum safe concurrency (the chatbench judge defaults to `--concurrency 12`);
the main session launches it, keeps coordinating and conversing, and collects results on the
completion notification — never block the conversation on a run. Push/publish is gated on the
operator (CI publishes on version bump on `main`). Version bump timing: only bump the version at
the moment of actually pushing a release, never pre-staged and left sitting unpushed between
releases — `package.json`'s version should always equal whatever's actually live on npm between
pushes.

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
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped before the items above, including this session's own dated entry in full.*
