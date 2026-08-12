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

- [ ] **The news quality loop — run, look, fix, repeat** — plan of record is
  `PLAN_NEWS_FEED_QUALITY.md`: the target card (§2), the three blockers (§3), the
  loop and its commands (§4), the working order (§5). Position on 2026-08-12
  evening: iterations 1–4 run; merged levers so far — whole names reach the
  lookup queue as single terms with fragments folded and numeric shrapnel gated;
  one story mints one card with the entity taking the title and publications
  covering only uncovered stories; enrichment proven live (lookups hit,
  definitions reach cards — "russia is a country" on the russia card). The run
  command pair: `node scripts/news-bench/capture-fixtures.mjs` (fresh articles),
  `node scripts/news-bench/run-live-cycle.mjs` (the enriched cycle, four-part
  card print). Iterations 6-7 landed the
  first target-shaped card from live data: the tim-king card shows amigados'
  looked-up definitions plus a correct gated entailment (amigados ⊑ software).
  Merged: background-from-article-entities (`ddca4304` — cards read the entities
  their article names; also fixed the doubled article, "a a country"); the
  Wikidata media-work type gate + provenance-tag truncation fix (`85f79faa` —
  album/paper matches now miss); the sense-disjointness gate on the isa closure
  (through `9f4497a9` — a measured top-class table refuses ~38-40% of
  derivations, russia ⊑ body part dead, asserted rows never blocked).
  Next levers, in order:
  - the re-grounding half of §3.2: a new definition should also let MORE of the
    article's own sentences ground (`reprocessAfterGrounding` exists, unproven
    end to end on a card);
  - extraction widenings from named specimens — the Gilman description's
    sentences two and three ("released on a humanitarian basis, President Trump
    said" / "family had said he was in dire physical condition"), the
    "prime | mgx:minister | …" optimistic mint, agentless passives ("is banned
    from …"), "ecuadorean fishings" pluralization, the "new gun" fragment;
  - asserted cross-sense corpus rows still drift into neighbourhoods ("orifice ⊑
    passage" near the russia card) — the gate covers derivations only;
  - the bench's noisy metric under-counts the new article-entity background rows
    (`textShownRowsForCard` in `scripts/news-bench/metrics.mjs` doesn't see
    them); chat.mjs's read-time BFS still walks asserted edges across senses
    (same gate would fix it, 322 KB file, deferred);
  - engine speed remainders from the perf pass: seed re-assembly on any removal
    (~2 s each; a mid-implementation exploration is preserved on branch
    `worktree-agent-add917bc647f82f46`, unmerged), `migrateStoredMemory`
    re-running per memory-handle load, `buildMemoryIndex` rebuilt per write;
  - then bulk knowledge only on §5.5 evidence.
  Harness note: `run-live-cycle.mjs` starts fresh state each run, so the
  negative cache resets and the same misses re-burn lookup slots every run —
  the deployed worker persists state and does not suffer this.

- [ ] **Wikidata** — the pinned dated dump (`wikidata-20260810-all.json.gz`)
  downloads in the operator's terminal (started 19:26, ~10 h). No bulk band gets
  built or loaded until the loop's evidence says live lookups are too thin
  (plan §5.5); when it does, the builder must print row count and DynamoDB
  write cost before any load. The 12-QID slice band
  (`~/tmct-dumps/wikidata-slice.band.jsonl`) is a pipeline proof only.

- [ ] **Shipping** — local `main` runs ahead of origin (the loop never waits on
  deploys). At the next push moment: full suite, roll, push. The last pipeline's
  `build:image` died on GitLab runner availability
  (`stuck_pending_no_matching_runners`) — retry the pipeline if it repeats.
  6.0.18 is the last deployed version; everything since (iterations 3–4 of the
  loop, engine speed, per-source caps, NYT recognizer) is local-only.

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
