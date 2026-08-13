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
pipelines. Position: iterations 1–10 run. The russia card carries the
neighbourhood fix live (anatomy gone, twelve geography rows in its place), and
the extraction widenings that give it a second and third sentence are built and
awaiting merge. Harness note: `run-live-cycle.mjs` starts fresh state each run,
so the negative cache resets and the same misses re-burn lookup slots per run;
the deployed worker persists state and does not.

The work list, ranked by value against the plan's target card.

1. [~] **Extraction widenings, shape by shape** — CODE COMPLETE, merged as
   `1ef4b7a5`, awaiting the full suite at the next push. Six shapes widened:
   clause-shaped terms, Title Case headline reading, passives with and without a
   named actor, comma crossing plus name trimming, reported speech, and the term
   ledger. Iteration 11 measured the result: 9 cards became 14, enrichment
   defined 6 terms where it defined 4, and only 2 lookups missed where 4 did.
   Remainder, still open: an unwrapped claim is not attributed to its speaker on
   the row. That needs a new name in the memory layer's closed findings
   vocabulary (`src/adapters/memory/shacl.mjs`, `core.mjs`'s byte-pinned
   vocabulary note, `docs/adapter-contract.md`). The speaker still reaches the
   enrichment queue, and every row rides its article's provenance.
2. [ ] **An unplaced hub turns the sense scope off entirely** — when `topsOf(hub)`
   is empty the bands never place it, the hub-anchored scope switches off, and
   every neighbour is admitted as filler. Iteration 11 killed the `bright`
   specimen by re-heading that card on `rescuers`, and the same cause
   immediately surfaced on another card: `syrian holdout province` emits
   "pronounce means the same as say. say is a kind of matter." Fixing a hub
   cures one card; the class needs the scope to do something better than switch
   off. One measured non-answer already: anchoring on the hub's seeds plus the
   far side of its reported rows reshuffles noise rather than cutting it.
3. [ ] **`buildMemoryIndex` rebuilt per write** — the remainder of the engine
   speed work, which shipped the other two (removal patching 2231→409 ms, the
   load-time migrations settled 21.8→0.0 ms, and the seed's ord map handed to
   the projection rather than rebuilt, appendFact 341.7→288.8 ms). Two cheap
   restructurings of the index build measured neutral and were reverted. Making
   the index survive across writes needs a handle-level index beside
   `handle.cachedPayload` with a copy-on-write overlay per mutate — the copy
   gives every individual a new object identity, so `individualsById` can't be
   reused as-is, and `factRecordsByGroup`'s values are arrays that call sites
   mutate in place, so the overlay must copy on read. ~15 call sites plus
   `patchAssembledPayload`. Worth ~74 ms of a ~280 ms write.
4. [ ] **Enrichment mints junk off a definition body** — in flight on
   `worktree-agent-acb29adac571da0a8`. Iteration 11 wrote
   `year | rdfs:subClassOf | eclipse` from simple-wikipedia's solar_eclipse
   body, and it reached a live card's background. Same family as the wikidata
   rows already fixed, through a different source path.
5. [~] **Phrasal verbs split, and one event states itself twice** — CODE
   COMPLETE on `worktree-agent-a98d6491e094d48a8`, awaiting the full suite at
   the next push. `worktree-agent-a8807a5a6b26758d7` was never merged and can
   be deleted: its work is ported, not taken.
6. [~] **Thin cards crowd the feed** — CODE COMPLETE, merged as `2685a438`,
   awaiting the full suite at the next push. The source was the wrong key: the
   tim-king card comes off the same bodyless source and is the plan's first
   target-shaped card, so a rule keyed on Hacker News would have thrown it away.
   A card is now ranked by what it carries — its own claims, the headline
   mentions that only restate its ORIGINAL TEXT block, and its background rows —
   and the scores print admission per source, which is plan §4.2's line. Nothing
   is dropped: a thin card still builds, still cites its source, still prints,
   and carries its counts.
7. [~] **Fact-listing line order tracks arrival order** — CODE COMPLETE, merged
   as `4d5505d6`, full suite already green on the branch (8262 pass, 0 fail).
   `factOrderKey` in `src/domain/memory/fact-order.mjs` breaks ties on content
   for `rankByBiasThenTrust`, chat's `byTrust`, the four readers that render
   rows without ranking, `capability.mjs` and `digest/select.mjs`. Two
   remainders:
   - `news-feed.mjs`'s `tierOf` and `/memory`'s listing are still
     arrival-dependent. Reaching them means sorting `foldFactRows`' output at
     the root, which is the wider fix.
   - `"what do you know about cache"` ends rather than opens on "cache is a kind
     of store". Nothing pins it, so it is a voice decision, not a defect.
8. [ ] **The world editor supersedes a placement by arriving last** —
   `foldWorldState` ranks placements by `(epoch, turn)` with `turn >= prior.turn`,
   so at equal turn the row later in the array wins, and `adventure-editor.mjs`
   supersedes by appending an untimed duplicate that only wins by arrival order.
   `crdt.md` already documents the fold as arbitrary at ties, and a p2p store
   gets content-address order from `sortFactIndividualsById` today, so this is
   already broken there. Found when a root-level content sort made the edit
   silently vanish (`adventure-editor.test.mjs:180`). The fix is to stamp an
   editor edit `snapshotSubject(subject, turn + 1, epoch)` so it outranks rather
   than relying on arrival. Doing this unblocks the root sort above: of the 13
   pins that moved under it, this was the only real break, 4 are already fixed
   and 8 were benign reorderings.
8. [ ] **Wikidata** — the pinned dated dump
   (`wikidata-20260810-all.json.gz`, 155,457,882,747 bytes) is downloading in
   the operator's terminal via `bash scripts/resume-wikidata-dump.sh`, which
   resumes from wherever a break left it — re-run it after any interruption.
   At 2026-08-13 00:33 BST it stood at 82.7 GB, 53%, holding ~4.1 MB/s with
   roughly 4.5 hours left. When the loop's evidence says live lookups are too
   thin (plan §5.5), build the bulk band with row count and DynamoDB write cost
   printed before any load. Until then: nothing. The 12-QID slice band is a
   pipeline proof only.

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
