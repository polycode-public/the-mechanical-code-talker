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

- **The scope tail of a qualifier check is never read.** "is Task.title public in Task"
  answers `Yes — Task.title is public` from the term alone; so does "is Task.title public in
  SomeOtherClass". `parseQualifierCheck` now declines when a NAMED agent follows a qualifier
  that has a relation counterpart, but `public` has none, so the `in <scope>` tail stays
  unread. Validate it or decline — answering from the term while the tail says otherwise is
  the same defect the by-tail fix closed.

- **A coordinated agent resolves to its first operand.** "is A called by B and C" answers
  `Yes` about B and drops C silently; the active twin "does A and B call C" does the same.
  `resolveObjectCore`'s path/slash-stem heuristic deliberately resolves past trailing junk,
  so the fix reaches every shape and lane and would break that documented intent.
  Coordination is a parse tier that does not exist — no split-on-"and" heuristic.

- **The verb repair tier has no precision gate.** 7,821 real English words (with inflections)
  sit within the edit budget of a graph verb: `rest`→`test`, `during`→`using`,
  `bigger`→`trigger`, `ball`→`call`. A repair that shares a lemma is a reading and answers; a
  repair onto a different verb now declines by name, so nothing false is asserted — but a
  real verb typo (`impotr`) lands on the miss wall with it. The gate that restores it is a
  generated collision set, which needs inflections: `rests` is not in `/usr/share/dict/words`.

- **Closed-set gate coverage (a pattern, not one bug).** The machinery that would answer
  exists; a narrower gate in front of it rejects a valid variant. `looksCodeish`
  (`src/services/chat.mjs`) flags any CamelCase compound as code-ish — lane 2b has an
  exemption, so "what is a TaskHandler" answers, but the bare name at lane 2c does not reach
  `metaFallbackEntityAnswer`. There are FIVE overlapping pronoun sets: `DESCRIBE_PRONOUN_RE`
  and `STACCATO_PRONOUN_RE` carry the plurals, `CONTEXT_WORDS` and `IS_ADJECTIVE_PRONOUN_RE`
  do not, and the isa lane suppresses its "I don't know 'it'" miss without ever resolving the
  subject against focus. Ordinals ("the first one") have no member in any set. The fix
  pattern is `answerEdgeCount`'s: audit one gate, decide which members are safe to add, pin
  the existing exclusions with regressions.

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
