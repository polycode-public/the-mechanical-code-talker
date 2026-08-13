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

The method is `PLAN_NEWS_FEED_QUALITY.md`: run
(`node scripts/news-bench/capture-fixtures.mjs`, then
`node scripts/news-bench/run-live-cycle.mjs`), show every card whole in the
four-part form, fix the top item below, merge, repeat — never waiting on
pipelines. Position: iterations 1–12 run. Iteration 12's feed reads 14 cards,
7 with real background and 5 thin, ranked by substance with admission per source
printed — NYT 8 of 8 with something to say, Hacker News 1 of 6. The london card
carries the phrasal fix (`frenzy | mgx:take-over | london`) and no `year ⊑
eclipse` reaches the research rows. What the next run should show: the syrian
card without its filler, and "rescuers free quake victim" reading correctly
again. Harness note: `run-live-cycle.mjs` starts fresh state each run,
so the negative cache resets and the same misses re-burn lookup slots per run;
the deployed worker persists state and does not.

The work list, ranked by value against the plan's target card.

1. [ ] **A report's claim is not attributed to its speaker** — the recognizer now
   unwraps "President Trump said X" to the claim X, but the row states X flatly
   with no record of who said it. Shape decided: a reified finding, a Fact about
   a Fact, with a new name in the closed findings vocabulary
   (`src/adapters/memory/shacl.mjs`, `core.mjs`'s byte-pinned vocabulary note,
   `docs/adapter-contract.md`) — chosen over reusing `statedBy` and over leaving
   the speaker in provenance only. A design pass is running now to settle the
   name, whether this store can carry a fact id in subject position at all, the
   card rendering, and whether an attributed claim still counts as grounded.
   Implementation waits on items 3 and 5 to free `extract-facts.mjs` and
   `core.mjs`.
2. [ ] **An unplaced hub turns the sense scope off entirely** — in flight on
   `worktree-agent-a88fb2f1a0b11930f`, anchoring the scope on the terms the
   article itself names when the hub is unplaced (chosen over admitting
   nothing, accepting that a card naming few entities goes sparse). When `topsOf(hub)`
   is empty the bands never place it, the hub-anchored scope switches off, and
   every neighbour is admitted as filler. Iteration 11 killed the `bright`
   specimen by re-heading that card on `rescuers`, and the same cause
   immediately surfaced on another card: `syrian holdout province` emits
   "pronounce means the same as say. say is a kind of matter." Fixing a hub
   cures one card; the class needs the scope to do something better than switch
   off. One measured non-answer already: anchoring on the hub's seeds plus the
   far side of its reported rows reshuffles noise rather than cutting it.
3. [ ] **The lexicon arm's object scan doesn't read through a count of-chain** —
   in flight on `worktree-agent-ae96b58e71cd6d7ea`, carrying a second defect
   found in iteration 12: the free/release synonym fold is lexical, so
   "Rescuers Free Quake Victim" became "rescuers releases quake victim" — wrong
   sense (rescuers free from rubble, they do not release from custody) and wrong
   agreement (plural subject, singular verb surface). The agreement half is not
   news-only: any fold or mint whose canonical surface is third-person singular
   does it under a plural subject. The track's main job:
   "The blast triggers hundreds of evacuations." mints
   `blast | tmct:triggers | hundred`. The newswire frame reads through the count
   (`skipCountPhrase`); Pass 2a/2b's `nearestEntity(i, +1)` does not. Fixing it
   changes the object scan for every lexicon verb in every corpus lane, not just
   news, which is why it is its own item rather than a remainder of the frame
   work that found it.
4. [ ] **`buildMemoryIndex` rebuilt per write** — in flight on
   `worktree-agent-a382d01858173b066`. A measured "this does not pay" is an
   acceptable outcome. The prize is ~74 ms of a ~280 ms
   write. Two cheap restructurings measured neutral and were reverted. Making
   the index survive across writes needs a handle-level index beside
   `handle.cachedPayload` with a copy-on-write overlay per mutate — the copy
   gives every individual a new object identity, so `individualsById` can't be
   reused as-is, and `factRecordsByGroup`'s values are arrays that call sites
   mutate in place, so the overlay must copy on read. ~15 call sites plus
   `patchAssembledPayload`.
5. [ ] **The world editor supersedes a placement by arriving last** — in flight
   on `worktree-agent-a10784011d797633e`.
   `foldWorldState` ranks placements by `(epoch, turn)` with `turn >= prior.turn`,
   so at equal turn the row later in the array wins, and `adventure-editor.mjs`
   supersedes by appending an untimed duplicate that only wins by arrival order.
   `crdt.md` already documents the fold as arbitrary at ties, and a p2p store
   gets content-address order from `sortFactIndividualsById` today, so this is
   already broken there. The fix is to stamp an editor edit
   `snapshotSubject(subject, turn + 1, epoch)` so it outranks rather than relying
   on arrival.
6. [ ] **Wikidata** — the pinned dated dump
   (`wikidata-20260810-all.json.gz`, 155,457,882,747 bytes) is downloading in
   the operator's terminal via `bash scripts/resume-wikidata-dump.sh`, which
   resumes from wherever a break left it — re-run it after any interruption.
   At 2026-08-13 00:33 BST it stood at 82.7 GB, 53%, holding ~4.1 MB/s with
   roughly 4.5 hours left. Plan §5.5 gates the bulk band on live lookups proving
   too thin or slow per term, and iterations 8–11 point the other way: iteration
   11 resolved 6 of 8 lookups live, and the misses have been phrases and people
   ("yemeni government says", "canadian companies", "genevieve glatsky") that a
   dump would not define either. So the case to make is coverage breadth, not
   rescuing these misses. Row count and DynamoDB write cost print before any
   load. The 12-QID slice band is a pipeline proof only.

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
