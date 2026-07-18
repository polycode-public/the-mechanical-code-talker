# HANDOVER — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md`
reports and `CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-18)

v2.6.0 in the working tree, measured by the four `BENCHMARK_*_2.6.0.md` reports and
`CAPABILITIES_2.6.0.md`, about to push (CI publishes on a version bump on main).

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

## Open items

The five-plan run of 2026-07-18 is delivered, benchmarked at 2.6.0 on all four axes, and audited
(143/172 capability rows implemented, none moved down). Full detail: the four
`BENCHMARK_*_2.6.0.md` reports and `CAPABILITIES_2.6.0.md`; the delivered plan docs live in
`archive/`. Every open line below names its source.

**The write boundary — the FLOW-0 gate and the round's worst cluster** (CONVERSATION rows 1–8):

- A negative universal with no stored positive mints a subject-literal `"no dog"` fact, so a
  2-hop chain proves yes one turn after the "no" (row 1, proof-shaped, worst). Ground the
  negation on the resolved class pair or decline by name.
- Interrogative shapes reach the teach lane and write: `dog have tail?` stores at trust 1.00
  (row 2); `I'm new here, what should I read first` stores a garbled fact (row 3); a typo'd
  interrogative gets a teach suggestion (row 8). A trailing `?` or question-clause must gate the
  write boundary outright.
- `what was X called before` fuzzes "called" to the calls relation and confirms a rename that
  never happened (row 4); a collective plural (`what do the handlers import`) silently
  best-matches one module (row 5); a mid-plan board teach is accepted then ignored by `next`
  (row 6); an `undefined` leaks into the exports none-renderer (row 7).

**Soft and regression rows** (CONVERSATION 9–17): assumed-position notes only cover goal-named
pieces (9); the needs-a-test superlative lacks `/untested`'s test-module filter (10, also CEFR's
`gq-needs-test-inversion`); adverbial negation in a passive yes/no is dropped (11); the describe
lane is the last without the stale-modifier residue guard (12); decision-recall phrasing misses
the session-recall surface (13); bare `dog` and post-expansion `and a cat` regressed to the
identity blurb (14–15 — refreeze pins when fixed); plan-navigation gestures (`undo`, `forget the
goal`, done-plan `next`) and goal revision (`actually the goal is…`) are unrouted (16–17).

**Honest-miss clusters** (CONVERSATION 18–29): game-invitation openers (`let's play guess the
number`) and non-numeric mid-game nudges (18); graph-less miss guidance offers code shapes to
vocabulary questions (19); SKOS recogniser misses like/what's wrappers (20); the negative-polarity
opener (`I don't suppose…`) is the one unpeeled wrapper — also CEFR's P1 edge (21); converse
nudge is taught-fact-only, not code-graph (22); did-you-mean ranking admits non-symbol kinds
(23); the app-overview phrasing never fires the completions rescue (24); property inheritance is
1-hop (25, also INFERENCE row 3 with its 5 ceiling rows); two sentence-split edges on the shipped
hanoi recipe lines (26); the adventure easter egg fires on `hello there` in a first session (27);
the session sidecar records rewritten queries, misquoting the user and blinding bench session
mode — record verbatim input beside the rewrite (28); four minor items noted in row 29.

**INFERENCE rows 1–2:** the quantified-has teach silently declines verb-tagged subjects ("every
overbid has a gouger" — let the quantifier lead override the single-token POS gate or decline
loudly), and clips s-final singular subjects ("lens" cited as "len").

**AGENT rows 1–6:** the resolver's silent tier-3 pick on an ambiguous entity should return
`candidateResults` instead (1, TOOL-8's live edge); the conditional-fallback phrasing plans both
branches with a duplicated primary — the observe-and-replan branch TOOL-7 names (2–3); the bench
fixture's `mod-a`-style module ids block symbol-seeded result literals — align them with
`mod:<path>` (4); `tmct_related` sits in neither the router registry nor
`EXCLUDED_FROM_REGISTRY` — register it (params: term) or document the exclusion (5); the registry
declares `tmct_impact`'s param Module-kinded while a Function seed now binds (6).

**CEFR levers for the next cycle:** `FIXTURE_CONTEXT` lacks schema-doc glosses (a truthful schema
answer grounds at 0.000); `judge-prompt-v2` should name the game/planner/reference-pack surface
(a correct game draws honesty 0); stamp the 15 now-passing baselineFail turns `improvedIn`; 10
construction shapes still lack go-to-pool cases.

**Standing decisions:**

- **Teach-path predicate minting for prepositional verbs** (operator decision): "cat relates to
  milk" stores `cat mgx:relate "to milk"`. Mapping the closed "relates to" / "is related to" pair
  onto `mgx:relatedTo` fixes the garble and gives the SKOS lane a teach phrasing; it changes
  predicate minting, so it needs the operator's word.
- `archive/PLAN_BENCHMARK_LADDERS.md`'s banner still reads "DESIGN — not yet implemented" though
  the reform is implemented and measured (audit §4.3) — a one-line truth-up.

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

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
