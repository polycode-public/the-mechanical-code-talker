# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section for the full progress narrative. This file holds ONLY what to do
next — no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing
discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Version state (2026-07-11)

`package.json` is `1.6.0`, held locally — `main` is 34 commits ahead of `origin/main`, none of it
pushed yet. What's live on npm is `1.5.5`. Push/publish is gated on the operator; don't bump the
version again until the moment of actually pushing (see Discipline, below).

## Open items

- **`BENCHMARK_CEFR_ENGLISH_1.6.0.md` re-measurement — not yet landed.** A re-run was dispatched to
  check whether the multi-candidate ambiguity fix (`PLAN_DID_YOU_SEE_HER_DUCK.md`) shows up in
  graded chat quality, alongside `CAPABILITIES_1.6.0.md`'s overlay audit. `CAPABILITIES_1.6.0.md`
  has since landed on `main` (commit `facbe6b`); the CEFR_ENGLISH re-measurement has not — no such
  file exists on `main` or in either of the other two live worktrees as of this check. Pick this up
  next: run the CEFR_ENGLISH benchmark at 1.6.0 and fold the result into `CAPABILITIES_1.6.0.md` if
  it changes the synthesis there.

- **`PLAN_CONVERSATION.md`'s two findings are unresolved, no fix landed for either.** (1) An unknown
  "every X is Y" always mints Y as a class, never a property, because `unknownObjectFallback`
  (`src/chat.mjs:1959`) has no POS check before minting — fix sketch and regression-guard caveats
  are written up in the doc. (2) `src/interpret/strategies/noise-strip.mjs`'s `stripNoise()` leans
  on wink-nlp's generic stopword list, which arbitrarily flags some main verbs ("keep", "put") as
  noise but not close synonyms ("store", "hold", "save") — causing real resolution collisions, not
  just missed strips. Both are scoped as broader-mechanism work, deliberately out of the fast loop's
  scope; read the doc before starting either.

- **`PLAN_SYLLOGIST.md`'s one genuinely open research question**: retraction-aware consistency under
  a hard budget + trust tiers (§3). Speculative sketch only, nothing implemented — next up only if
  the operator wants to push the reasoning engine further, not a near-term default.

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch (imperative command grammar,
  mutable turn-by-turn world/player state as graph nodes, an NPC turn scheduler). Design-only,
  nothing implemented yet.

- **Two stale worktree branches, still unmerged**: `worktree-agent-a162c165a7ce6bca6` (commit
  `2b724fd`, CHATBENCH_0.8.0) and `worktree-agent-a3a54d6e7c5ef9172` (commit `3fdc983`,
  CHATBENCH_0.8.1) — both confirmed still present in `git branch -a`, neither an ancestor of `main`.
  Their worktree directories are gone, only the branches remain. Low urgency, but if those old
  reports still matter, pull them from those branches before pruning.

- **Standing cross-repo note, can never close from this repo**: if seonix's own chat surface goes
  through `runChat`/`createSession`, its `tmct.toml` needs to explicitly re-activate SEON/ConceptNet
  now that tmct's own default persona has flipped to opt-in for those sources. See `ROADMAP.md`
  around the persona-batch entry for the full context.

## Discipline (unchanged)

**Working model: coordinator + background sub-agents** (copied verbatim from this repo's own
`CLAUDE.md`, so it's visible directly in this file too): run big tasks in concurrent background
sub-agents and keep the main chat free — the main session is the COORDINATOR (plans, launches,
integrates, answers the operator), not the worker. Decompose into workstreams with clear
file-ownership boundaries; serialize on shared files (one agent owns `package.json`, `src/`, `bin/`,
`test/` sequences; docs/site tracks run in parallel). Keep the chat for chat: anything long-running
(benchmarks, judge passes, builds, test sweeps) executes as a BACKGROUND task at maximum safe
concurrency (the chatbench judge defaults to `--concurrency 12`); the main session launches it,
keeps coordinating and conversing, and collects results on the completion notification — never block
the conversation on a run. Push/publish is gated on the operator (CI publishes on version bump on
`main`). Version bump timing: only bump the version at the moment of actually pushing a release,
never pre-staged and left sitting unpushed between releases — `package.json`'s version should always
equal whatever's actually live on npm between pushes.

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions.

Three hard-won lessons, carried forward:

1. Background sub-agents sharing one working tree (no worktree isolation) can and did run
   destructive/shared git operations (`git stash`) meant only for the coordinator — recovered
   without loss, but now explicitly called out in every dispatch brief: sub-agents may only
   `git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`.
   Also: the harness's permission system blocks `git commit` for *background* sub-agents entirely
   in some configurations (no live user to approve a permission-gated action) — the coordinator does
   the committing itself in the foreground when this happens, verifying `git status` immediately
   before every stage to avoid sweeping in another track's pre-staged files.

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
   --show-current` returning something other than `main`, no work lost). Full detail and the
   verification recipe live in `SKILL_AGENT_FAST_LOOP.md` §4 — this entry is a cross-reference, not
   a duplicate. The rule: before resuming any stalled round, check `git worktree list` for its path
   — if it's gone, `TaskStop` that round and dispatch a fresh one instead, never `SendMessage` it
   back to life.

No LLM in the product path, ever.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped.*
