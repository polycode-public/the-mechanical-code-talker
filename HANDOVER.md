# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Version state (2026-07-11)

`package.json` is `1.7.3` locally, not yet pushed. What's live on npm is still `1.5.5` — several
version bumps (`1.6.0` through `1.7.3`) have accumulated locally without a push. Per this project's
own version-bump discipline (`CLAUDE.md`), the next push should land whatever's actually ready as one
release, not chase every intermediate bump — don't bump again until that push.

## Open items

- **`archive/PLAN_CONVERSATION.md` Finding 4** — an anaphoric "it uses which controller as its base"
  question misroutes into teach-a-fact; three independent sub-problems (a discontiguous verb-frame
  parser, a POS-aware mid-sentence interrogative detector, and a union-kind reverse-question gap).
  Bounded, not undesignable: `TOO_HARD_AUDIT.md`'s B1 entry traces a concrete first increment
  (a POS-aware mid-sentence interrogative detector alone closes the pronoun-removed repro). Large,
  three sub-problems, not attempted in a single pass — not "out of design-ability horizon." Findings
  1, 2, 3, and 5 are all resolved; the plan itself is archived (`archive/PLAN_CONVERSATION.md`) since
  Finding 4 is the only open item left. Two CEFR cases (`g-c2-pron-1`/`g-c2-pron-2`,
  `BENCHMARK_CEFR_ENGLISH_1.7.0.md`) are plausibly the same "which of them VERB" compositional-anaphora
  gap — worth checking as a side effect if this is picked up.

- **AGENTBENCH `ab-c2-what-to-test`'s composing gap, diagnosis sharpened** (`TOO_HARD_AUDIT.md` M2,
  refined 2026-07-11) — the keystone-ranking mechanism this case needs already exists and works
  (`src/router/goal-reasoner.mjs:421-431`, a declared-priority argmax). The real gap, confirmed by
  live-running the case: the request "what most needs a test in this codebase" never dispatches into
  the rule that owns that composition step (only `tmct_untested` gets called, never `tmct_impact`) —
  a request-to-rule routing gap, not a missing ranking mechanism. Next pickup: trace why this
  request's goal classification doesn't expand into the per-module `impact` sub-goals
  (`goal-reasoner.mjs:388-393`'s GDA expansion never fires for it).

- **A rephrase-hint pass on honest "nothing matches"/"no X found" misses**
  (`BENCHMARK_CEFR_ENGLISH_1.7.0.md`'s decision log, top pick) — 7+ cases across B1/C1 grades score
  zero on the judge's rephrase dimension despite being correct, honest misses, because the miss
  template offers no nudge toward a question that WOULD work. Scoped: a handful of history/touches-
  family miss templates in `src/ask.mjs`. Concrete evidence: `g-c1-temp-8`'s "from touches to X"
  wording also reads backwards and should be fixed in the same pass.

- **Persona-sweep routed backlog** (`BENCHMARK_CONVERSATION_1.7.0.md`'s "Routed backlog" section,
  not yet picked up by a fast-loop round): (1) ESL phrasing breaks recognition — `"what is X, please
  explain"` (trailer folded into the term), `"please learn (this/also):"` prefix breaking teach
  recognition; (2) a file-vs-symbol anaphora scoping miss — focus stays pinned to a method after a
  "where is it defined" answer names the containing file; (3) fragment-typer typo-tolerance misses
  (`"who touchd dat"`, `"wat about store.mjs"`, `"cochange w/ wat"`, `"inherits wat"`, `"tests 4 it"`);
  (4) identity-question phrasing fragility — `"are you an AI? like chatgpt?"` fails where `"are you
  chatgpt"` works. Each is scoped for `SKILL_AGENT_FAST_LOOP.md`, not attempted yet.

- **`PLAN_VIZ.md`** — the three scoped traversal/timestamp items (id-normalizer fix, edge
  `createdAt`/derived `updatedAt`, `spiralExpand` generalization) are implemented. Still open:
  the code-graph architectural decision (provider-populated timestamps vs. a new tmct-owned
  local-git mode), the git-log-corpus/README-ingestion situational-fact seeding, the eager
  session/sessionless anchor individual, and a rendering prototype spike. See the doc's own
  "Next step" for the order. Not archived — this remaining scope is real, unbuilt feature work
  (a rendering spike, situational-fact seeding), not a minor bug or a too-hard research question,
  so it stays a live root-level plan per `CAPABILITIES_1.7.3.md` §4's own call.

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
