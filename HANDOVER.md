# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handles (inboxes): `tmct` (the edge-hunt/playtest session) and `tmct-hanoi` (the
PLAN_HANOI/PLAN_VIZ_LEDGER session). See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-15)

v1.11.5 plus the full `archive/PLAN_OPEN_BACKLOG.md` delivery (workstreams A–F: the six
deferred playtest edges, the three seonix ask-engine items, river-crossing + router
consumption of taught records, justification for all five entailment rules, the ledger as THE
`tmct viz` surface, the goal field, the cardinality exemption) and playtests 015–017.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code per
`archive/TOO_HARD_AUDIT.md` (bulk ConceptNet download, not reachable from data in hand).

## Open items

- **Capability read-back over taught Rule rows.** "can you move a disk onto a peg?" is still a
  graph-question miss even when that exact signature was taught — a closed ask-lane reader over
  action-signature rules. Named in `playtests/PLAYTEST_LOG_016.md`.

- **Verbless want-goal.** "i want every disk on peg-b" (no infinitive verb) still gets the
  teach lane's pronoun decline; recognizing it means inferring the location verb — a
  desire-frame family of its own. Named in `playtests/PLAYTEST_LOG_017.md`. The verbed forms
  ("i want every disk to rest on peg-b") work.

- **Where-lane goal-line cosmetic.** "where is disk-1 now" answers correctly but the Goal line
  echoes the object as "disk-1 now". Named in `playtests/PLAYTEST_LOG_015.md`.

- **codegraph.mjs post-viz-removal prune.** `buildVizNodesAndEdges`, `deriveFactTermGraph`,
  `pickLegendDimension`, `edgeKindsFor`, `mostRecentIndividual`, `MEMORY_SPIRAL_EXPAND_KINDS`,
  `legendValueFor` now have no consumers outside their own tests — prune together with those
  tests.

- **plan-viz animation vs co-travel.** The plan page's recorded assumption that consecutive
  snapshots differ by one moved piece is broken by river-crossing's two-piece ferry moves —
  validate or extend the animation for multi-effect steps (risk named in `archive/PLAN_HANOI.md`'s
  addendum).

- **Misparse-receipt leakage on ask turns.** Fuzzy/stale Goal+Canonical receipts print under
  correct fact answers on ask turns ("rests"→"tests", "bigger"→"calls", "defines"): the
  playtest-015 `fuzzyVerb` drop covers teach and goal turns only. One coherent edge: extend
  the drop to fact-reader-answered ask turns. Found by the 018 uber retest
  (`playtests/PLAYTEST_LOG_018.md`).

- **Identical goals accumulate instead of folding.** The same goal restated in another
  voicing appends "(N goals held)" duplicates; fold a deep-equal incoming goal spec and say
  so. Found by the 018 uber retest.

- **Topic-shift ellipsis.** "what is a dog" → "what about cats" has no reader; the elliptical
  follow-up falls to the wall. Named in `playtests/PLAYTEST_LOG_002.md` and 005.

- **Anaphora depth.** The vocabulary antecedent decays after one turn, and a cold pronoun
  ("can it bark" with no prior turn) falls to the generic wall. Named in
  `playtests/PLAYTEST_LOG_005.md`.

- **Negative capability as data.** "a penguin cannot fly" declines honestly (no
  fact-vocabulary predicate for it) and "what cannot fly" has no reverse listing. Named in
  `playtests/PLAYTEST_LOG_003.md`.

- **Taught↔corpus predicate unification.** A taught "fire causes smoke" mints `mgx:cause`
  while the corpus fact is `mgx:causes`; the two never unify at read time. Named in
  `playtests/PLAYTEST_LOG_004.md`.

- **Prepositional-fact leftovers.** Determiner-led multi-word subjects ("the small disk rests
  on the middle disk") decline; bare-copula "what is on peg-a" misses; "does disk-1 rest on
  peg-b" falls to the generic wall instead of a specific miss. Named in
  `playtests/PLAYTEST_LOG_008.md`.

- **In-chat recovery for deep chains.** 3+-hop derivations need the `syllogise` CLI; chat has
  no `/syllogise` command and the honest deep-chain miss doesn't mention the recovery. Named
  in `playtests/PLAYTEST_LOG_007.md`.

- **Two standing design choices, revisit only with evidence** (decisions of record, not
  pending work): 3+-word terms stay outside the ACE fragment (`playtests/PLAYTEST_LOG_006.md`);
  comparative antisymmetry is not derived — asked directions only, an honesty choice
  (`playtests/PLAYTEST_LOG_009.md`).

- **Untouched playtest axes** (for the next edge-hunt dispatch): contractions and cleft rungs
  of the paraphrase ladder; passive↔active beyond UsedFor and the rule signature.

- **Closed-set gate coverage (a pattern, not one bug — mined from the strategy advisor's
  2026-07-12 sweep).** Several dead-ends share one shape: the machinery that would answer
  correctly exists, but a narrower closed-set gate in front of it rejects a valid input variant.
  Two instances still live: `looksCodeish` (`src/chat.mjs`) flags any CamelCase compound as
  code-ish and blocks the bare-meta-fact fallback that knows how to answer "what is X"; and
  `CONTEXT_WORDS` (`src/chat.mjs`, four singular pronouns) has no plural/ordinal members, and
  object-position "that" never consults focus the way subject-position "it" does. A third
  instance (COUNT_NOUNS not consulting `EDGE_NOUN_TO_METRIC`) has since been fixed via
  `answerEdgeCount`, confirming the fix pattern: audit one gate, decide which members/table
  lookups are safe to add, pin the existing exclusions with regressions. Worth one shared design
  pass over the gates rather than a doc per instance.

- **`PLAN_SYLLOGIST.md` research horizon**: the full ATMS generalization (de Kleer 1986). The
  four-rule justification slice shipped; the one inherited limit (a surviving conclusion keeps
  its stale single justification, so a later retraction of its other path won't re-examine it)
  is recorded in that doc's 2026-07-15 addendum.

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch. Its world-state and
  actions-as-data substrate shipped generically with the planning lane; still unbuilt and its own:
  the imperative command grammar, the NPC turn scheduler, the Ashcombe Hall corpus, and the
  room-look digest.

- **Standing cross-repo note (not closeable from this repo)**: if seonix's own chat surface goes
  through `runChat`/`createSession`, its `tmct.toml` needs to explicitly re-activate
  SEON/ConceptNet now that tmct's default persona has flipped to opt-in for those sources. See
  `ROADMAP.md` around the persona-batch entry.

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
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/domain/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions.

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
