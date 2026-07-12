# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Version state (2026-07-12)

`package.json` is `1.8.2` locally, not yet pushed. What's live on npm is still `1.5.5` — several
version bumps have accumulated locally without a push. Per this project's own version-bump
discipline (`CLAUDE.md`), the next push should land whatever's actually ready as one release, not
chase every intermediate bump — don't bump again until that push.

## Open items

- **`archive/PLAN_CONVERSATION.md` Finding 4 — safety half fixed, 2026-07-12.** The first-increment
  fix (`hasMidSentenceInterrogative`, `src/chat.mjs`) landed: "it uses which controller as its base"
  and "TaskController uses which controller as its base" no longer misroute into `teachLane` (no
  garbage fact gets stored, no confusing pronoun-classification refusal) — both fall through to the
  honest structural miss instead. **Still genuinely open**: this does NOT make the question
  *answerable* — that needs the other two named sub-problems (a discontiguous verb-frame parser for
  "uses X as its base"-shaped constructions; a union-kind reverse-question capability for relation
  verbs like `uses`/`calls` that map to more than one stored predicate). Two CEFR cases
  (`g-c2-pron-1`/`g-c2-pron-2`) were checked and confirmed a DIFFERENT mechanism (`ask.mjs`'s
  compositional filter compiler, not `chat.mjs`'s teach routing) — not the same gap, don't expect
  them to move if the remaining sub-problems are picked up.

- **Two small typo-tolerance sub-cases, explicitly deferred, 2026-07-12** — `"w/"` → `"with"` and
  `"4"` → `"for"` (from `BENCHMARK_CONVERSATION_1.7.0.md`'s "Routed backlog"; the other two backlog
  items in that family, `"touchd"`/`"dat"` plus the `"wat about X"` routing gap, are fixed). Both
  need a genuinely new mechanism: the shared `MISSPELLINGS` regex builder can't match a
  `/`-terminated token (word-boundary requirement); digit tokens are deliberately protected
  everywhere in this codebase (shas/line numbers/counts) — a real guard, not an oversight to patch
  around.

- **`PLAN_BREADTH_FIRST_NLU.md`'s two open items** — (c) the paraphrase-verified-via-`syllogise.mjs`
  piece of "Ambition", not started; (d) a real "list/count all X of class Y" query shape for
  memory-graph classes via `ask.mjs` alone, a confirmed gap found during the viz chat panel's build.
  See `ROADMAP.md`'s "What's next" for detail. (`archive/PLAN_VIZ.md` and
  `archive/PLAN_TEMPLATE_COVERAGE.md` are archived; their own remaining scope is listed there too.)

- **`PLAN_SYLLOGIST.md`'s one genuinely open research question**: retraction-aware consistency under
  a hard budget + trust tiers (§3). Speculative sketch only, nothing implemented — next up only if
  the operator wants to push the reasoning engine further, not a near-term default.

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch (imperative command grammar,
  mutable turn-by-turn world/player state as graph nodes, an NPC turn scheduler). Design-only,
  nothing implemented yet.

- **Cross-repo playtest backlog (from seonix, `~/.claude/inboxes/mechanic.md`)**: (1) a paraphrase-
  coverage gap for describe-style queries — "what is X for" and "what does X do in Y" aren't
  recognized shapes even when the underlying data resolves correctly via other phrasings (3 confirmed
  instances); (2) a cross-language disambiguation-ranking false positive — "where is the main entry
  point defined" sprays across unrelated Java/test-fixture `main` matches with no relevance ranking;
  (3) a cosmetic label-spacing bug — a rendered type like `GlobalVariable` loses its word break. None
  implemented yet; not in this session's scope.

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
