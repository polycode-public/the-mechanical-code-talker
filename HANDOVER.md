# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"What tmct is" and "What's next" sections for the full feature-level picture. This file holds ONLY
what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md` reports and
`CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-17)

v2.4.2 in the working tree, unpushed. CI publishes on a version bump on main.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

### Two things this cycle did NOT verify — do these before the push

Both are cheap, and both need a QUIET machine. Four agents ran concurrently all cycle, so every
timing taken today is worthless — that is the self-inflicted-load error this repo has now made
three times (the 2.0.3 report durations, the 4,135ms budget reading, and this).

1. **`npm run check:budgets` reported `test:smoke` OVER its 1s budget** (3,947ms under load;
   ~1.5s standalone, which would still be over). **Measure it alone.** If it is genuinely over,
   `CLAUDE.md` is explicit that the tier is the bug — cut its content, never raise the number. One
   suspect is new: `chat.mjs` gained a static `import { loadLexicon, lookupNoun }` this cycle
   (the 3.2/3.7 fold), and a static lexicon load is exactly the shape of thing that lands as
   start-up cost in a 1-second tier.
2. **The full `npm test` has NOT been run this cycle.** By design — it runs once, before the work
   reaches CI or another person, and nothing has been pushed. But that means **no one has seen the
   whole suite green over these 18 commits.** Run it on a quiet machine before pushing. Expect it to
   be the moment any cross-lane interaction between the four agents' changes shows up.

## Open items

`PLAN_OPEN_ITEMS.md` is the build order and holds the detail — its "Execution status" section
carries the phase table, the operator decisions already taken, the traps this cycle hit, and the
list of this plan's own citations that proved false. Read that before quoting any fix site.

Phases 1, 2, 3, 4, 5 and 6 are closed. What remains:

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
- **Phase 10 is WIDER than `PLAN_OPEN_ITEMS.md` §10 scoped it, on the operator's instruction
  (2026-07-17), and that pass is DONE.** §10 asked only for the RDF/CURIE vocabulary; the real
  brief is **every term the repo names, anywhere**, each traced to a published standard or paper —
  inference/deduction/predicate (Aristotle through description logic), classical AI planning
  (STRIPS/PDDL/Graphplan), grammar, NLP, IR scoring (Levenshtein vs Damerau), unit vs integration
  testing (Meszaros's taxonomy), and **the storage model, where the operator expects the most to be
  found** (OWL covers the data model; the ledger, trust, sessions, reification-vs-RDF-star and
  provenance around it are unnormalised). Plus a **README bibliography**: authoritative link, else a
  local copy where the licence permits, else a summary doc marked placeholder. `PLAN_NORMATIVE.md`
  is the record.
- **Four wrong citations in the inference engine, all re-confirmed at HEAD.** `PLAN_NORMATIVE.md`
  §7.12; verified against *OWL 2 Profiles (2nd ed.)*, W3C Rec 2012-12-11, whose table numbering is
  identical to the 1st ed., so no edition excuses them. **`cls-svf1` is cited as "OWL 2 RL Table 8"
  at 3 sites** (`syllogise.mjs:64`, `:314`, `chat.mjs:7406`) — it is **Table 6**; Table 8 is
  *The Semantics of Datatypes*. **`cax-maxc0` is not a W3C rule name** — no such rule exists; the
  real one is `cls-maxc1`. It is shaped like a W3C id and appears in `PLAN_SYLLOGIST.md` and
  `infbench/`, where a reader takes it for one. **`PLAN_SYLLOGIST_EL_DL.md:11` says all seven
  kernels are "inside the OWL 2 RL fragment"** — two are not, and `syllogise.mjs:527` already says
  so; `cax-maxc0` derives a class-level negative where `cls-maxc1` derives `false` for one
  individual, a strictly stronger step RL does not license. **`syllogise.mjs:972`'s "JTMS-style
  dependency-directed removal" is DRed** (Gupta/Mumick/Subrahmanian, SIGMOD 1993), not JTMS: it
  recomputes the materialization, not belief labels.
- **Phase 10 fallout — vocabulary fixes in files `PLAN_NORMATIVE.md` could not touch.** §7 has a
  verdict for each, so none needs more research. `fuzzy.mjs` implements **Optimal String Alignment**,
  not Damerau-Levenshtein (`editDistance("CA","ABC")=3`; true DL gives 2) — a comment and
  `PLAN_DEPS.md` §3.5 both misname it, though §3.5's *decision* survives untouched. `ledger` (81
  uses) is a view of the memory graph, not an append-only log, and the store underneath is not
  append-only either. `syllogise` is a public CLI verb and only partly a syllogism — an operator
  call. Full list at §7.1-7.11.
- **Phase 10 fallout — declare the `cap:` and `taught:` namespaces (`PLAN_NORMATIVE.md` §7.4).**
  `cap:` (11 terms) and `taught:` (4) are declared in no ontology file, and `cap:`'s
  precondition/effect vocabulary is PDDL's under other names. Declare the namespace and the
  generative convention (the `mgxneg:` precedent, §5.2), cite PDDL; lands in `tmct-core.ttl`. The
  `seon:subKind`/`seon:Module`/`seon:ClassDefinition` renames and the two stale `mgx:subclassOf`
  comments (§7.1-7.3) have landed.
- **Phase 8 — the tested-capability page.** Nothing started. Generated, not hand-written. No bare
  numbers: every figure carries its units, version, date, method link and caveat.
  - `examples/{mini-webapp,polyglot}/.tmct/graph.json` have no generator and no drift guard — a
    rename or hand-edit ships unchecked; needs a module spec + fixture-repos-style test.
- **Phase 9 — the prose pass.** Nothing started, and last by design.
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
