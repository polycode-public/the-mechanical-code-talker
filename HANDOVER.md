# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Version state (2026-07-12, fast-loop batch in progress)

`main` is mid-way through a fixed 10-round `SKILL_AGENT_FAST_LOOP.md` batch (round 3/10 as of this
edit), each round bumping+pushing regardless of outcome per explicit operator instruction. CI was red
for 16 straight pipelines (#139-154) on a platform-dependent symlink bug in `bin/tmct.mjs`'s
repo-relative path logic — fixed; `publish:npm` unblocked and confirmed live through 1.8.5 on npm.

## Open items

- **`PLAN_SYLLOGIST.md`'s remaining ATMS generalization**: the scm-sco (subClassOf) retraction slice
  from §3 is now real and shipped (`retractSubClassOf`, `src/syllogise.mjs`) — a bounded, re-verified
  local check, not full alternate-justification-set tracking. The other four entailment rules
  (cax-sco/cax-dw/cls-svf1/scm-svf1) don't carry justification yet — mechanical extension, not done.
  The full ATMS generalization (de Kleer 1986) is the one piece still genuinely open, cited in
  `ROADMAP.md`'s research horizon, not attempted here.

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

- **`BENCHMARK_CONVERSATION_1.8.14.md` persona-sweep backlog (2026-07-12)**: pronoun-subject
  questions ("are you happy", "are you like chatgpt") get misparsed as teach-fact requests about the
  literal pronoun — `IS_ADJECTIVE_YESNO_RE` (`src/chat.mjs:4884`) has no pronoun guard, unlike the
  sibling `TEACH_PRONOUN_RE` (`src/chat.mjs:2648`) — hit by 4 independent playtest personas, highest
  cross-persona signal in the run. Route: `SKILL_AGENT_FAST_LOOP.md`.

- **`BENCHMARK_CONVERSATION_1.8.14.md`: the canonical "john is a man"/"all men are mortal" syllogism
  is broken again**, via a singular/plural storage mismatch — `unknownSubjectFallback`
  (`src/chat.mjs:2127`, reached via `UNKNOWN_SUBJECT_RE` at `src/chat.mjs:1996`) stores "all men are
  mortal" as `men rdfs:subClassOf mortal` (plural, un-lemmatized) instead of singularizing to `man`,
  unlike the sibling `SOME_A_FEW_RE` path (`src/chat.mjs:2907-2908`), which already calls the
  existing `singularizeSurface()` helper (`src/chat.mjs:1966`). This is the README's own headline
  demo shape. Route: `SKILL_AGENT_FAST_LOOP.md`.

- **`BENCHMARK_CONVERSATION_1.8.14.md`: taught-fact retraction never takes, in any phrasing** ("a
  Task is not an animal", "forget that a gizmo is a widget", "actually, a gizmo is not a widget") —
  confirmed by 2 independent personas across 5 attempts, 0 successes; the fact persists unchanged on
  re-query every time. The data-layer primitive already exists and shipped (`retractSubClassOf`,
  `src/syllogise.mjs`, `PLAN_SYLLOGIST.md` §3 / commit `f7b3644`) but no chat-level phrasing calls
  it. Route: `PLAN_SYLLOGIST.md` (needs a closed-set intent design, not a quick patch).

- **`BENCHMARK_CONVERSATION_1.8.14.md`: teaching a fact against a subject name that's already a real
  graph symbol (e.g. "Task") is entirely unreachable** — "a Task is a kind of animal"/"remember Task
  is a kind of animal" always resolve to the real graph fact (`Record`) instead of storing or even
  acknowledging the taught object, confirmed across 4 phrasings by the breaker persona. A genuine
  precedence/coexistence design question. Route: `PLAN_SYLLOGIST.md`.

- **`BENCHMARK_CONVERSATION_1.8.14.md`: `calls` up-refinement (Class→containing Module) is
  deliberately excluded** (`src/ask.mjs:3505-3515`) on the assumption that `calls` edges are always
  symbol-precise, but `examples/mini-webapp`'s own vocabulary (`mgx:callsCoarse`) stores `calls` at
  module grain only — "who calls Router" (a Class) wrongly returns empty while "what calls
  src/server/router.mjs" (same edge, module name) correctly returns `src/server/app.mjs`. Route:
  `SKILL_AGENT_FAST_LOOP.md`.

- **`BENCHMARK_CONVERSATION_1.8.14.md`: smaller routed gaps**, all `SKILL_AGENT_FAST_LOOP.md`-sized:
  personal/small-talk questions ("how are you doing today", "what's your favorite color") mostly hit
  the bare grammar wall instead of the on-brand capability banner, and the banner-vs-wall selection
  looks inconsistent across near-identical phrasings; a plain declarative ("the Router is used by
  every handler") misfires into the verification-question path and leaks a raw commit-hash-shaped id
  to the user; entity comparison's `COMPARE_PATTERNS` (`src/chat.mjs:6739-6745`) doesn't accept "diff
  from"/"diff between" phrasing; syllogise-verified paraphrase only fires on bare "is X a Y", not
  "why is X a Y"/"explain how you know"; memory-class count/list (`dec95e8`) is reachable via
  `/memory` but not natural language ("how many things have I taught you"); bare CamelCase "what is
  X" (fixed in `25185f0`) breaks again behind filler ("hey quick q, what is TaskController") or a
  no-apostrophe contraction ("whats UserController"); plural anaphora (`1bfee74`) doesn't cover "are
  them all in X" and loses the referent after several intervening turns on "list them again". Full
  verbatim inputs and diagnoses in the report.

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
