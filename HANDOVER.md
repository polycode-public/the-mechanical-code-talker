# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-16)

v1.12.1 in the working tree; v1.12.0 pushed to main, which CI publishes. Delivered since
1.11.5: src/ re-homed into five layers with a downward-only import rule, the test estate
rebuilt around six keyed corpus lanes with an e2e tier and a README example harness, and
the CI quality pipeline (dependency cooldown, licence and PII checks, pack gate,
post-deploy smoke).

The playtest record starts again from `playtests/PLAYTEST_LOG_001.md`. The open items below
carry their own reproducers, so they stand without it.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

## Open items

### 1. Chat parse and ask lanes (`src/services/chat.mjs`, `src/domain/ask.mjs`)

- **Misparse-receipt leakage on ask turns.** Fuzzy/stale Goal+Canonical receipts print under
  correct fact answers on ask turns ("rests"→"tests", "bigger"→"calls", "defines"): the
  existing `fuzzyVerb` drop covers teach and goal turns only. One coherent edge: extend
  the drop to fact-reader-answered ask turns.

- **Identical goals accumulate instead of folding.** The same goal restated in another
  voicing appends "(N goals held)" duplicates; fold a deep-equal incoming goal spec and say
  so.

- **Six frozen wrong answers.** The agent-debt rows pin answers that are still wrong, waiting
  for a fix to flip them: the yes/no `callsSymbol` union, a pronoun-echoing empty, a
  temporal-adverb misread, and a bare passive read as active. Both root causes are live
  (`KIND_UNIONS` unions `uses` only; `parseKeywordSpot` falls through to `forward`).

- **Three product bugs the migration surfaced, each pinned by a row.** An ask-level honest
  empty ("list modules in nope") falls through to the teach lane and stores a garbage fact.
  The describe wrappers disagree: "describe X" describes, "describe about X" misses, "please
  describe X" gives an orientation card, "please describe about X" describes. `/tests
  <function>` answers at module level.

- **Closed-set gate coverage (a pattern, not one bug).** Several dead-ends share one shape: the machinery that would answer
  correctly exists, but a narrower closed-set gate in front of it rejects a valid input variant.
  Two instances still live: `looksCodeish` (`src/services/chat.mjs`) flags any CamelCase compound as
  code-ish and blocks the bare-meta-fact fallback that knows how to answer "what is X"; and
  `CONTEXT_WORDS` (`src/services/chat.mjs`, four singular pronouns) has no plural/ordinal members, and
  object-position "that" never consults focus the way subject-position "it" does. A third
  instance (COUNT_NOUNS not consulting `EDGE_NOUN_TO_METRIC`) has since been fixed via
  `answerEdgeCount`, confirming the fix pattern: audit one gate, decide which members/table
  lookups are safe to add, pin the existing exclusions with regressions. Worth one shared design
  pass over the gates rather than a doc per instance.

- **The agentful passive answers the opposite of its active twin.** "is store.mjs tested by
  logger.mjs" says Yes where "does logger.mjs test store.mjs" correctly says No — the same
  fact, both confident. Nothing consumes the by-agent phrase: `tests`/`defines` drop it and
  fall to the unqualified `qualCheck` ("is X tested", true for any agent), while
  `calls`/`imports` glue the two operands and resolve to the first. The agentless passive
  ("what is X called by", "what is defined by X") is faithful on all five predicates, so the
  voice itself is understood. Measured across 16 probes.

- **A contracted comparative mis-teaches.** "disk-2's bigger than disk-1" stores
  `disk-2's mgx:big than disk-1` at trust 0.97 and reads back "remembered: disk-2's bigs than
  disk-1": the `'s` is taken as a genitive, so the subject keeps it and `bigger` is lemmatised
  into a predicate. The only probe that writes garbage to disk. Other contractions
  ("what's a dog", "who's calling X", "can't", "doesn't") are faithful to their uncontracted
  forms.

- **Negated polar questions never answer.** "doesn't X call Y" and "does X not call Y" both
  route to `forwardComplement`, which discards Y and never answers the yes/no.

- **The code-index wall fires on stores with no code**, advising "try who touched <a module
  that actually has commits>" where no index exists.

- **Contracted misses are less useful than their plain twins.** "it's bigger than X" never
  reaches the pronoun check that "it is bigger than X" hits; "what's on peg-a" prints the tool
  introduction where "what is on peg-a" names the term it couldn't find. Both honest in each
  pair — one is just less use.

- **Where-lane goal-line cosmetic.** "where is disk-1 now" answers correctly but the Goal line
  echoes the object as "disk-1 now".

### 2. Reader coverage — inputs with no lane at all

Each needs a new reader rather than a fix to an existing one, so this group is the natural
fan-out set.

- **Capability read-back over taught Rule rows.** "can you move a disk onto a peg?" is still a
  graph-question miss even when that exact signature was taught — a closed ask-lane reader over
  action-signature rules.

- **Verbless want-goal.** "i want every disk on peg-b" (no infinitive verb) still gets the
  teach lane's pronoun decline; recognizing it means inferring the location verb — a
  desire-frame family of its own. The verbed forms
  ("i want every disk to rest on peg-b") work.

- **Topic-shift ellipsis.** "what is a dog" → "what about cats" has no reader; the elliptical
  follow-up falls to the wall.

- **Anaphora depth.** The vocabulary antecedent decays after one turn, and a cold pronoun
  ("can it bark" with no prior turn) falls to the generic wall.

- **Negative capability as data.** "a penguin cannot fly" declines honestly (no
  fact-vocabulary predicate for it) and "what cannot fly" has no reverse listing.

- **Prepositional-fact leftovers.** Determiner-led multi-word subjects ("the small disk rests
  on the middle disk") decline; bare-copula "what is on peg-a" misses; "does disk-1 rest on
  peg-b" falls to the generic wall instead of a specific miss.

- **In-chat recovery for deep chains.** 3+-hop derivations need the `syllogise` CLI; chat has
  no `/syllogise` command and the honest deep-chain miss doesn't mention the recovery.

- **The reverse cleft rung has no reader.** "what is it that calls Y" misses — the leftover
  "it that" becomes the subject. The forward clefts work and assert nothing false: "is it X
  that calls Y" discriminates a false agent, "what X calls is Y" parses to the plain
  canonical. No cleft reaches the taught-fact lane. Measured across 14 probes.


## Discipline (unchanged)

**Working model: coordinator + background sub-agents** (copied verbatim from this repo's own
`CLAUDE.md`, so it's visible directly in this file too): run big tasks in concurrent background
sub-agents and keep the main chat free — the main session is the COORDINATOR (plans, launches,
integrates, answers the operator), not the worker. Decompose into workstreams with clear
file-ownership boundaries; serialize on shared files (one agent owns `package.json`, `src/`, `bin/`,
`test/` sequences; docs/site tracks run in parallel). Keep the chat for chat: anything long-running
(benchmarks, judge passes, builds, test sweeps) executes as a BACKGROUND task at maximum safe
concurrency; the main session launches it, keeps coordinating and conversing, and collects results
on the completion notification — never block the conversation on a run. Push/publish is gated on
the operator (CI publishes on version bump on `main`); versioning/commit/push cadence follows the
operator's explicit prompt instructions (see `CLAUDE.md`'s first section).

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit.

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
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped.*
