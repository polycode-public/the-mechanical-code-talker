# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"What tmct is" and "What's next" sections for the full feature-level picture. This file holds ONLY
what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md` reports and
`CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-17)

v2.4.1 in the working tree, unpushed. CI publishes on a version bump on main.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

## Open items

`PLAN_OPEN_ITEMS.md` is the build order and holds the detail — its "Execution status" section
carries the phase table, the operator decisions already taken, the traps this cycle hit, and the
list of this plan's own citations that proved false. Read that before quoting any fix site.

Phases 1, 2, 4, 5 and 6 closed at 2.4.1. What remains:

- **Phase 3 — the honest-miss and parse gaps.** **3.1 and 3.3 are done.** 3.1: a bare negative now
  records a disagreement instead of retracting, and only `forget that X is a Y` deletes — the
  negative twin of `rdfs:subClassOf` had to be coined (`mgxneg:subClassOf`), since the shipped prefix
  swap only covers `mgx:` terms. 3.3: a pronoun's referent now survives a miss, via `last.grounded`
  — `last.answer` still records misses because the repeat-shortening walls compare through it.
  **3.2, 3.5, 3.6 and 3.7 are done as well**, and 3.4 no longer reproduces (closed, no code change).
  3.2/3.5/3.7 turned out to be **one defect wearing three faces: the ask path could not reach the
  spelling the teach path stores** — a quantifier glued to the subject, and an irregular plural the
  `-s` fold cannot recover. Both folds now live in `factTermVariants`, and `lookupNoun` (the
  lexicon's own lemmatizer) does the work, so "bus" is safe. 3.6: bare `what else` takes its subject
  from the standing referent, and asked cold it names what it cannot resolve.
  **Open: 3.8, 3.9, 3.10a-e, 3.11.** 3.9's fix site is `chat.mjs`, not `ask.mjs` — the investigation
  is recorded in the plan.
- **Phase 7 — every public example traces to a test.** Closed. Table at `docs/public-examples.md`,
  one row per example with the test that holds it and the tier. The site's examples now run:
  `e2e/pages-examples.test.mjs` replays the page's transcripts against the live CLI through the
  README's harness, `pages-demo-history` pins the demo box's 5 scripted answers, and
  `pages-demo-templates` asks all 56 pairs the box can pick. Three defects were shipping: the
  payment-module block (3 of 4 questions miss or fail to parse), the "what an answer looks like"
  transcript (a splice of two sessions that never happened together), and a drifted demo answer
  ("defined in" where the engine says "found in"). Still open, both listed in the table: three
  `dom`-tier rows on `index.html` (install line, CLI verbs, the `runChat` library block) where a
  browser test asserts the page shows a string and nothing asserts the product agrees, `runChat`
  being the one worth pinning next; and `docs/repository-interface.md`'s prose carries the contract
  numbers with no test holding them (the schema beside it is pinned to the source const).
- **Phase 10 fallout — four vocabulary fixes in files `PLAN_NORMATIVE.md` could not touch.** The
  plan is written and its ontology half has landed; `PLAN_NORMATIVE.md` §7 has the detail and a
  verdict for each, so none needs more research. In cost order: `seon:subKind` is a **stored
  undefined IRI** (`graph-build.mjs:146` writes it, and SEON has no such property) — rename to
  `mgx:subKind`, keep a legacy read key, re-index; no migration, a code graph is derivable.
  `seon:Module`/`seon:ClassDefinition` (`router/registry.mjs:31-32`) are not SEON terms either.
  The `cap:` (11 terms) and `taught:` (4) namespaces are declared nowhere, and `cap:`'s
  precondition/effect vocabulary is PDDL's under other names. Two stale comments name
  `mgx:subclassOf`, which nothing emits.
  **The two-casings defect this phase was told to fix first does not exist** — all 13 lowercase
  spellings are lookup keys in one table that lowercases before reading, nothing writes them, and
  `mgx:cause`/`mgx:causes` is a deliberate lemma fold. `PLAN_NORMATIVE.md` §1 has the proof.
- **Phase 8 — the tested-capability page.** Nothing started. Generated, not hand-written. No bare
  numbers: every figure carries its units, version, date, method link and caveat.
- **Phase 9 — the prose pass.** Nothing started, and last by design.
- **PLAN_DEPS Q1 and Q3** — both decided by the operator, neither built. Q1: stop shipping the
  13-module maintainer tier, which unblocks `yaml` as a devDependency and deletes 220 LOC of
  hand-rolled YAML. Q3: bound `tmct_search`'s `name` input — it is a verified ReDoS today
  (`(a+)+$` hangs the process past 20s on one 30-character label).

### Next-cycle recommendations the benchmarks made

- **Re-measure CEFR at N=2 and report the cell table, not the marginals.** 2.0.3 ran N=1 by operator
  choice, so no per-case judge score in it is noise-averaged. The cell table is now published by
  `chatbench/report.mjs` (`a46d92a`); it shows `A1 naming-vocabulary` at **1.475** is the real floor,
  which the 1.675 marginal hides by averaging the A1 and A2 cells. `ambiguity` at 1.625 is the worst
  tag but n=4 at N=1 — the least trustworthy number in the report.
- **Re-sweep CONVERSATION now the dropped-input family has landed, and add a sixth persona frame** —
  the returning user with a stale mental model ("the old X", "didn't you say Y"). No 2.0.3 frame
  covered it, and it is where the unknown-modifier bug's realistic trigger lives.
- **Re-run CEFR for Phase 2's movement**: `reversible-passive` 1.600 → ~1.900 and tier-1 back to
  109/109 is the expectation `7c05ffd` predicts and nothing has measured yet.
- **AGENTBENCH's ladder has no rung left to build past** — all 11 C2 cases are green on the goal
  driver, so the next AGENT cycle deepens the corpus, not the engine.

Two designs wait on a decision rather than a session: `PLAN_CONSISTENCY_CHECK.md` and
`PLAN_CHILD_CORPUS.md`.

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
