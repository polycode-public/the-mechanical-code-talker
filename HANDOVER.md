# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section for the full progress narrative. This file holds ONLY what to do
next — no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing
discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Version state (2026-07-11)

`package.json` is `1.6.2`, held locally — `main` is 1 commit ahead of `origin/main` (the bump
itself). What's live on npm is `1.6.1`. Push/publish is gated on the operator; don't bump the
version again until the moment of actually pushing (see Discipline, below).

## Open items

- **`PLAN_CONVERSATION.md` Finding 1 (adjective-taught-as-class) is unresolved, but now has a fresh
  canonical repro and a background fix agent in flight.** `"cheese is blue"` mints `blue` as a class
  (`cheese rdfs:subClassOf blue`) instead of a datatype property, then `"what is blue"` gives no
  useful answer at all — the mis-mint compounds into total silence, not just the wrong shape. Finding
  2 is already resolved (commit `85d46f0`). A background agent is implementing Finding 1 per its own
  documented fix sketch (POS-check gate in `unknownObjectFallback`, `src/chat.mjs:1959`) — check its
  worktree/PLAN_CONVERSATION.md's STATUS line before starting this fresh.

- **Fast-loop round 1 found 2 more real dead-ends, root-caused but correctly left unpatched** (both
  now being written up as new `PLAN_CONVERSATION.md` findings by the same background agent): (a)
  `ask.mjs`'s forward-shape query branch (~line 3198) computes the requested `entityType` but never
  filters on it, so `"what modules does X have"` can return function names instead of modules; (b)
  `TEACH_PRONOUN_RE` (`chat.mjs:2336`) has no question-lead guard and `RELATIONS.inherits`
  (`ask-vocab.mjs:153`) has no "uses X as its base" phrasing, so an anaphoric inheritance question
  like `"it uses which controller as its base"` gets misrouted into teach-a-fact.

- **Live testing also surfaced a query-side gap for the general-knowledge persona vocabulary**: there
  is no query shape for CapableOf (`"can a dog bark"`, `"what can a dog do"`) or reverse-HasA
  (`"what has a tail"`) at all — `ask.mjs`'s `RELATIONS` verb table is entirely code-graph-shaped
  (`has`/`have` is hardwired to the code `defines` relation), so these fall through to the generic
  code-graph miss wall even with no repo loaded. Separately, `"what is a tail"` silently resolves to
  ConceptNet's process/Unix-command sense only, dropping the animal-body-part sense the same session
  just taught via `dog has tail` — a corpus word-sense collision, root cause not yet confirmed.
  Under investigation by the same background agent; expect this to graduate into new
  `PLAN_CONVERSATION.md` findings rather than a fast-loop-safe patch.

- **`PLAN_SYLLOGIST.md`'s one genuinely open research question**: retraction-aware consistency under
  a hard budget + trust tiers (§3). Speculative sketch only, nothing implemented — next up only if
  the operator wants to push the reasoning engine further, not a near-term default.

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch (imperative command grammar,
  mutable turn-by-turn world/player state as graph nodes, an NPC turn scheduler). Design-only,
  nothing implemented yet.

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
