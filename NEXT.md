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

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] **`does X have Y` misses property inheritance through a taught `⊑` hop** — found live while
  regenerating infbench for `PLAN_DL_ENGLISH_SURFACE.md`'s B3 (`reports/BENCHMARK_INFERENCE_5.0.28.md`),
  pre-existing and unrelated to that plan's own changes. Example: teach "every argyle has a
  receptacle", "e150.mjs is a argyle"; ask "does e150.mjs have a receptacle" — an honest miss
  instead of the "yes" the stored someValuesFrom restriction plus the type assertion entail. 10 of
  15 `b2PropertyInheritance` infbench rows (the `member` and `grandparent` variants) show this; the
  `class-direct` variant (no individual involved) already passes. The gap sits in the `does X have
  Y` lane (`DOES_HAVE_ASK_RE`/`restrictionExistentialHit`, `src/services/chat.mjs`), not the isa
  ladder — a different code path from `PLAN_DL_ENGLISH_SURFACE.md`'s B1/B2 fallback and case-naming
  work.
- [ ] **PLAN_NEWS_FEED.md — phase 9, in flight** — phases 0-8 are landed and the page's UX
  contract is pinned green end to end (`test-e2e/pages-news.test.mjs`,
  `pages-news-feed.test.mjs`). Phase 9 (the fixture rig, `reports/NEWS_RIG.md`, the claims
  block, the share-post number) is running in a worktree sub-agent and closes the plan.
- [ ] **MUDIII's chat surface can't reach the river scenario or the drive-trait sentences** —
  the plan-ladder remainder `PLAN_RIVER_CROSSING.md`'s R7 section records: the chat opener is
  a closed regex naming only the three grid layouts (no chat line opens a layout-less puzzle
  world), and the per-instance drive sentences (`agent-editor.mjs`'s closed table) are spliced
  into the browser page only, with no ask-lane grammar for those predicates. Both are new
  engine work if wanted; four planned corpus rows wait on them.
- [ ] **Runtime-readable AGENTBENCH envelope stamp in the npm tarball** — bedrock-meter asks
  for a shipped `envelope.json` (or equivalent) in `files` so consumers replace hardcoded
  tripwire literals with a measured read.
- [ ] **CEFR levers from the 5.0.25 dual-draw baseline** — the run is delivered
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.25.md`); its decision log ranks the levers a tuning
  cycle should try next: relative-embedded chain resolution, a conditional-question lane, a
  negation-scope filter, the temporal-window boundary in commit counting, and growing the
  under-covered C2 relative-embedded census cell.
- [ ] **Archive the delivered plan docs and refresh STATUS.md** — once phase 9 lands:
  `PLAN_SYLLOGIST_EL_DL.md`, `PLAN_DL_ENGLISH_SURFACE.md`, `PLAN_COMMON_SENSE_QA.md`,
  `PLAN_RIVER_CROSSING.md` and `PLAN_NEWS_FEED.md` are delivered end to end and move to
  `archive/` with their live references repointed; STATUS.md's plan table resynthesizes via
  the `refresh-status` skill (its syllogist row still reads DESIGN).

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
- **A fresh worktree has no `corpus/worlds/`, no `corpus/sprites/` and no ask bundle, and
  `node --test <file>` does not build them** — only the `npm run test:*` scripts do. So a targeted
  run in a new worktree fails tests that pass everywhere else, and the failure reads as a lane
  regression rather than a missing artifact (`spider-fly-turn.test.mjs` fails 7 of 17 at pristine
  HEAD for this reason alone). Every dispatch brief should say: run `node scripts/ensure-worlds-pack.mjs`,
  `node scripts/ensure-sprite-facts.mjs` and `npm run build:ask-bundle` before any `node --test`.
- **After closing an Open item, re-read the whole Open items section, not just your own diff.** A
  narrow text-replace edit's own match can end before a trailing item's text, leaving it
  unresolved and untouched for several commits even after the section's own summary line says
  "None open."

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `reports/BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
