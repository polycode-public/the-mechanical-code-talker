# NEXT — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded directly in its
own Open items entry (see the next paragraph for how). Prefer deleting a sentence to negating it.

**A bug found while fixing item A is A's remainder, not a new item.** Write it as a sub-clause of
A's own entry — what's fixed, what's still open — and leave A's checkbox open until the sub-clause
closes too, even if the sub-clause itself is deferred. Only promote it to a genuinely separate item
when it's actually unrelated to A's own scope (a different file or subsystem entirely), and say so
explicitly when you do. Closing A outright and opening a freshly-labeled item for the same discovery
is stalling dressed as progress: the open-item count looks flat or improved, but the record now hides
that A was never actually finished. (Landed 2026-08-01 after doing exactly this: a track's own
seed-fetch-retry fix got marked done and its test-coverage gap got logged as a brand new item,
until corrected.)

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log` and the
`reports/BENCHMARK_*.md` reports hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

*(Footnote, not an open item: MUD3D was renamed MUDIII, design only, credit to
`world-of-claudecraft` and MUD1/MUD2 chosen if `mudiii.html` ever ships. An optional email to
Richard Bartle at that point is the operator's call to make if and when they choose to.)*

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## In-flight right now

**MUDIII build** (`PLAN_MUD_MUDIII.md`), wave 0 of 5, dispatched 2026-08-02. Plus two features the
operator added to the same run: world teach mode and pill-driven predictive text.

Wave-0 prerequisites landed on `main` first (c45a6fc7): `three` as a devDependency, the two npm
script entries, two `.gitignore` page lines, `TRACKED_SITE_FILES` += `models`, and the
`ensure-worlds-pack.mjs` freshness fix.

| track | tier | worktree / branch | status |
|---|---|---|---|
| W0-SPIKE — belief extraction, tick fixture header, config sections | top | `.claude/worktrees/agent-a84b9cf55622784fb` | started |
| W0-ASSETS — `data/mudiii-assets.json` allowlist | Sonnet | merged, worktree removed | **landed** — 14 CC0 rows, 1.14 MB, verified against disk by size and sha256 |
| W0-AUDIT — lane/vocabulary collision check | Sonnet | read-only, no worktree | **landed** — findings below |
| PC-CORE — `src/services/pill-complete.mjs` + unit test | Sonnet | `.claude/worktrees/agent-a00a3089173c9c3b8` | started |
| WT-CORE — `world-teach.mjs`, the hook, both editor exports | top | `.claude/worktrees/agent-a22a65e499c3440bf` | started |

W0-AUDIT's findings, which the wave-2 lane brief is written against:

- The new lane's `chat.mjs` block goes after the spider-fly block and before `unclaimedAdventureOpening`.
  The phrasing at risk is `play mudiii` — the named-opener regex requires `play`/`let's play`, so
  `visit the town square` and `enter the town square` are free and never reach that decline.
- **There is no mud lane in `chat.mjs`.** `runMudTurn` is called only from the browser entry's
  autoplay tick; a typed line on a mud page is claimed by `adventureTurn` like any other world.
- `src/domain/real-word-collisions.json` is about fuzzy typo-repair for code-graph verbs, not game
  vocabulary. Adding `fox`/`goblin`/`town`/`square` trips nothing there.
- `test:fast`'s budget is 10s and it currently runs in ~2.1s, so a new lane's corpus has room.
- Narrow collision to design around: `drop a morsel at cell-3-4` is free by default, but with an
  adventure world live in the same session `drop` falls to the generic object arm and `adventureTurn`
  claims it with an honest miss.

Worktree paths and branches are filled in as each track reports; the coordinator holds these shared
files for the whole build and no track may edit them: `chat.mjs`, `build-demo-site.mjs`,
`public/index.html`, `package.json`, `test/estate/pack-manifest.json`, `test/fast/lanes.test.mjs`,
`scripts/gen-screenshots.mjs`, `.gitlab-ci.yml`, `NEXT.md`.

## Open items

- **MUDIII ships as `mudiii.html`** alongside `mud.html`, per `PLAN_MUD_MUDIII.md`. Closes when
  `smoke:deploy` passes against the live page. Known remainders folded in as sub-clauses:
  - `visibleCells` clips to a module-level `GRID_SIZE = 10`, so 44 of a 12x12 board's 144 cells are
    invisible to every agent. Fixed as part of the belief extraction.
  - `believedCellOf`'s docstring claims a removed target is never believed present; a told fact
    reaches the fallback and returns a cell anyway.
  - `gen-spider-fly-world.mjs` claims an estate freshness guard regenerates and compares its world
    source. No such guard exists. Build it for the town square, and for spider-fly while there.
- **Teach mode** on adventure.html, mud.html and mudiii.html: a checkbox that reads a declarative
  sentence as a fact against the live world. General semantics — any sentence the editor grammar
  can express, including moving world-authored things. Sub-clause: `adventure-browser-entry.mjs`'s
  `applyEdit` does not snapshot-stamp its writes, where mud's does; pre-existing, lands separately.
- **Pill-driven predictive text** on the same three pages: typing a prefix completes to a live pill's
  whole grounded command.

## Discipline

`CLAUDE.md` is the standing working model: the coordinator/background-sub-agent split (including
sub-agent git discipline, verifying a "waiting"/"completed" claim, and never resuming an
auto-removed worktree), the test blast radius (including the migration concept-sweep), the
versioning and push rules, and the repo-local identity. Read it there. This section holds only
what's specific enough to `tmct` that it doesn't belong in that general model.

- **Merging concurrent `chat.mjs` branches**: rebuild the ask bundle (it inlines chat readers, so
  it drifts on every reader change), rerun the pack-manifest check, and check for same-name
  top-level declarations across branches — esbuild's duplicate-symbol error at bundle time is the
  tell (two batches once both coined `spiderFlyContextAnswer`). Re-probe seed-content-dependent
  e2e pins against the real store after any seed-generation change — a raised seed cap can
  silently ground a demo's lookup term or break a source-adjacency pin.
- **`cd <repo-root>; pwd` as the literal first line of any merge-sequence Bash call.** The shell
  can carry a stale working directory across calls even with an explicit `cd` earlier in the same
  turn; a merge has run inside a sub-agent's worktree instead of the main checkout because of this.
- **Brief distinct naming when multiple agents extend the same shared test file.** Sibling
  content-authoring agents reliably collide on top-level `const`/`function` names even when their
  actual test content doesn't overlap — `git merge` can't auto-resolve that, only a manual rename
  can, so name the collision risk up front rather than reconciling it at every merge.
- **After closing an Open item, re-read the whole Open items section, not just your own diff.** A
  narrow text-replace edit's own match can end before a trailing item's text, leaving it
  unresolved and untouched for several commits even after the section's own summary line says
  "None open."

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `reports/BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
