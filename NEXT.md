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

- [ ] **CEFR levers from the 5.0.25 dual-draw baseline** — the run is delivered
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.25.md`); its decision log ranks these levers for the
  next tuning cycle, each its own measured round. The commit-window round is landed and
  measured (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`), and its own decision log re-ranks what
  is left:
  - [x] relative-embedded chain resolution
  - [x] converse verb readings — the placement phrasings ("live in", "sit inside") stay forward
    by design, since a taught locative fact stores the located thing as its subject
  - [x] the temporal-window boundary in commit counting — measured in
    `reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`; the pool's tier-1 failures drop from nine to two
  - [ ] a conditional-question lane
  - [ ] a `named <X>` qualifier inside a boolean branch — `g-c2-rel-17` and `g-c2-rel-25`, the
    last two frontier rows in C2 relative-embedded
  - [ ] a negation-scope filter
  - [ ] `g-c1-neg-rel-19` — "modules importing the module that defines fnAlpha but not tested"
    answers b, c and e; the tested importer b.mjs should be excluded
  - [ ] C2 pronoun-binding, 13/25 green with 12 frontier — the largest unexamined block; needs a
    diagnosis pass before it can be ranked against the rest
  - [ ] `g-b2-coord-4` and `g-c1-presup-4`, the two tier-1 failures the pool has left. Different
    cells, so two small levers rather than one
  - [x] growing the under-covered C2 relative-embedded census cell — the 5.0.36 round judges
    all 25 of it, so the cell is measured rather than excluded
- [ ] **Judge both chatbench arms against the same verdict-cache snapshot** — the 5.0.37 round
  scored four unchanged answers differently across its two arms, worth ±0.9 on a single case's
  mean, because each arm inherited a different partition of the cache
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md`, instrument note).
- [ ] **The judge context tells the judge that "touched by 2 commit(s)" is truthful for
  app/lib/a.mjs**, which the graded pool's own `^1 commit\.$` expectation denies — `run.mjs`'s
  `FIXTURE_CONTEXT`. It split `g-b2-count-temp-1`'s two draws between 2 and 0 on a correct answer
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`, instrument notes). Rewriting it moves
  `FIXTURE_CONTEXT_VERSION` and re-judges the pool, so it is a re-baseline run, not a lever round.
- [ ] **news.html's marketing screenshot now captures the empty state** — since the
  newsworthiness gate landed, the seed alone never heads a card, so the capture pipeline
  photographs the designed empty feed. Operator content call: keep the honest empty plate, or
  bake a fixture poll into the capture run so the shot shows a populated feed.

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
