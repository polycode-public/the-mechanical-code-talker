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

### Verified green at HEAD, on a quiet machine

The full `npm test` is **2771/2771** — it surfaced 11 cross-lane regressions from the concurrent
agents' changes (a `seon:` prefix proxy in the CEGIS enumerator broken by the §7.2 rename, and the
three-valued `tested` qualifier over-reaching to classes with no resolvable module); all were fixed
at root and re-run green. `npm run check:budgets` passes standalone (`test:smoke` 689ms/1000ms,
`test:fast` 1482ms/10000ms) — the earlier "over budget" reading was the self-inflicted-load error.
Nothing is pushed; the operator gates that.

## Open items

`PLAN_OPEN_ITEMS.md` is the build order and holds the detail — its "Execution status" section
carries the phase table, the operator decisions already taken, the traps this cycle hit, and the
list of this plan's own citations that proved false. Read that before quoting any fix site.

Phases 1–7 and 10 are closed. This session landed the §7 vocabulary fallout (the four inference
citations, the SEON renames, `cap:`/`taught:`, the OSA rename, the storage-vocab renames, the
honest-miss citation) and the 64-bit `factIdFor` migration, with the full suite green. What remains:

- **Phase 7's two leftover rows** (tracked in `docs/public-examples.md`): three `dom`-tier
  `index.html` rows (install line, CLI verbs, the `runChat` library block — `runChat` the one worth
  pinning) where a browser test asserts the page shows a string but nothing asserts the product
  agrees; and `docs/repository-interface.md`'s prose contract numbers, unpinned (the schema beside
  them is pinned to the source const).
- **Phase 8 — tested-capability claims on the public surfaces.** Operator decision (2026-07-17):
  NOT a new page — put the claims in the two existing public surfaces only, `README.md` and the
  GitLab home page (`public/index.html`). Every claim carries its evidence in place: the score with
  units, the version it was measured at (2.0.3), the date, a link to the method
  (`SKILL_BENCHMARK_*.md`), and its caveat. The internal `CAPABILITIES_<version>.md` audit (run via
  `SKILL_CAPABILITIES_AUDIT.md`) stays the source of truth; it is stale at 2.0.3 and wants a refresh.
- **Phase 9 — the plain-prose pass** over the same two surfaces, to `SKILL_PLAIN_PROSE.md`, done
  together with Phase 8. May rewrite prose freely; may not change an asserted fenced block's input
  or output without re-running the README harness.
- **Loose ends** (fold into the Phase 8/9 pass, or their own commit):
  - `README.md:942-943` calls the Repository Interface "versioned (1.0.0)"; it is **1.1.0**.
  - `test/fixtures/{entities-repo,large-scale}/.tmct/graph.json` still embed `seon:subKind` where the
    generators emit `mgx:subKind`; inert, but Phase 8 reads schema tokens. No generator for these two
    (like the example graphs) — hand-edit + check the `SchemaPredicate` description. Both pairs of
    unguarded fixture graphs want a drift guard.
  - `splitSentences` mis-splits a module path in `extract-facts.mjs` and `import-file.mjs`; the
    `chat.mjs` teach path already guards it with a real-boundary check.
  - 3 CHATBENCH cells are graded but absent from `GRADED_MATRIX` (`A2:assert-recall`, `B1:svo-query`,
    `B1:noise+svo-query`) — coverage is 9 of 36 declared, not 12.
- **Two vocabulary items still open** (`PLAN_NORMATIVE.md` §7.5/§7.6): the PROV Source split — a
  read-side reclassification derivable from the `sourceType` already stored on every Source
  individual — and SKOS concept identity, which needs concept identity for the corpus's bare-string
  terms before `skos:related` applies.
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
