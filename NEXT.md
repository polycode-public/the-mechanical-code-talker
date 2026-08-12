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
`~/.claude/inboxes/tmct-hanoi.md`.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] **Wikidata dump download — operator-run, outside any session** — run
  `bash scripts/resume-wikidata-dump.sh` from the repo root (re-run after any
  interruption; it resumes, prints a progress line per minute, and verifies the final
  byte count). File: `~/tmct-dumps/wikidata-latest-all.json.gz` (155.3 GB; ~85% on
  2026-08-12). When it reports done, the operator's sequence is (extraction tooling
  merged, `29d7549c`, streaming and per-phase resumable):
  `node scripts/corpus-bands/extract-wikidata-slice.mjs`, then
  `node scripts/corpus-bands/build-wikidata-slice.mjs --source ~/tmct-dumps/wikidata-slice.jsonl`,
  then the operator-gated `tmct corpus load wikidata-slice` per
  `PLAN_MEMORY_ROLLOUT.md` section 4.

- [ ] **News feed quality — the local bench and its loop** — plan of record is
  `PLAN_NEWS_FEED_QUALITY.md` (operator-commissioned 2026-08-12): frozen live-feed
  fixtures, a deterministic offline bench runner with mechanical metrics (admission,
  grounded-term proportion, de-dupe, entity preservation, noisy-hub-relation rate,
  paragraph shape, ranked-term noise, size), and a ratcheting floor per landed
  improvement. Phases N0–N5 there. In flight (dispatched 2026-08-12):
  - N0 bench harness + fixtures + baseline — merged to local `main` (4 commits
    through `f279537e`): `npm run bench:news` / `bench:news:fast`, dated fixtures for
    all five sources, floor-guarded smoke test, baseline
    `reports/newsbench/2026-08-12-xl.md` (admission 57%, grounded-terms 26%,
    "Around it" repeat 79%, date presence 0%, ranked noise 30% pre-noise-gate).
    Product bug it surfaced, unfixed: `itemCap` 30 is GLOBAL across the five
    sources, not per-source — most fetched items are evicted before ingestion;
    the bench pins 200 to measure past it. Next lever gets chosen from the
    post-N1 bench re-run.
  - N1 de-dupe — merged to local `main` (`5b7907c4`): per-source id + content keys
    (pure over the snapshot's fields), grounded-only seen memory, and the real
    duplicator fixed — item-cap churn no longer re-ingests window-dropped articles
    (convergence and order-independence both pinned by test)
  - "scientists reports" agreement fix (N4 wart) — merged (`695490e6`), and the
    live feed's own call site now passes its hub as subject (`d6b166f9`)
  - units/compass/particle noise out of ranked terms (N3 leg) — merged to local
    `main` (`84ea852e`); "u.s." kept ranking by design, borderlines ("la", "van",
    "di") recorded in the commit's agent report
  First loop iteration measured (`reports/newsbench/2026-08-12-xl-postwave.md`):
  ranked noise 30% → 5%, grounded terms 26% → 30%. Second lever merged to local
  `main` (4 commits through `f530db53`): card dates flow fetcher → feed → DOM,
  presence 0% → 100%, floor ratcheted; a card with no dated source shows none,
  and Wikimedia items carry the feed's own named UTC day. In flight: the bench
  articles log + retroactive per-iteration article files (worktree
  `.claude/worktrees/agent-ac803c63199fa2985`). Remaining: N2 context quality
  (incl. the junk-hub over-read and the 79% "Around it" repeat), NYT admission
  26%, the global item cap, N5 floors into CI. Bench operational notes: pass a
  distinct `--label` per run (same-day runs collide on the report filename), and
  xl metrics drift with freshly regenerated corpus artifacts (chat-seed inputs) —
  the run that measures a lever must rebuild its seed the same way its baseline
  did, or the pair lies.

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
