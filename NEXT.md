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
pipelines. Position: iterations 1–7 run; the tim-king card is the first
target-shaped card from live data (looked-up definitions plus a correct gated
entailment on the card). Harness note: `run-live-cycle.mjs` starts fresh state
each run, so the negative cache resets and the same misses re-burn lookup slots
per run; the deployed worker persists state and does not.

The work list, ranked by value against the plan's target card:

1. [ ] **Extraction widenings, shape by shape** — the named specimens: the Gilman
   description's sentences two and three ("released on a humanitarian basis,
   President Trump said" / "family had said he was in dire physical condition"),
   the "prime | mgx:minister | …" optimistic mint, agentless passives ("is
   banned from …"), "ecuadorean fishings" pluralization, the "new gun" fragment.
   Expected: OUR PARAGRAPH grows from one sentence toward the target's three.
   Effort: one Opus agent, closed-set work, taxonomy already exists.
2. [ ] **The §3.2 re-grounding proof** — a new definition lets more of the
   article's own sentences ground (`reprocessAfterGrounding` exists, unproven
   end to end on a card). Expected: FACTS LEARNED grows after enrichment defines
   a term the article names. Effort: one Opus agent, prove-then-fix.
3. [ ] **Asserted cross-sense neighbourhood drift** — "orifice ⊑ passage" still
   wanders near the russia card; the disjointness gate covers derivations only.
   Expected: RELATED FACTS keeps israel/turkey/australia-are-countries, drops
   the anatomy strays. Effort: one Opus agent, same-sense discipline applied to
   neighbourhood selection.
4. [ ] **Bench article-entity under-count** — `textShownRowsForCard` in
   `scripts/news-bench/metrics.mjs` cannot see the new background rows.
   Measurement-only fix. Effort: main thread, ~20 min.
5. [ ] **Shipping** — 22 commits local-only; 6.0.18 is the last deployed
   version. Roll, full suite, push; retry the pipeline if GitLab's runner
   shortage (`stuck_pending_no_matching_runners`) recurs. Effort: ~20 min,
   mostly unattended.
6. [ ] **chat.mjs read-time BFS gate** — the chat surface still walks asserted
   cross-sense edges live (russia can reach body part in a two-hop chase).
   Same gate, different reader. Effort: one careful Opus agent, 322 KB file.
7. [ ] **Engine speed remainders** — seed re-assembly on any removal (~2 s
   each; mid-implementation exploration preserved on branch
   `worktree-agent-add917bc647f82f46`, unmerged), `migrateStoredMemory`
   re-running per memory-handle load, `buildMemoryIndex` rebuilt per write.
   Expected: more articles ground per 60 s press; faster runs. Effort: resume
   the branch (Opus) plus two small fixes.
8. [ ] **`research.mjs` media-gate opt-out** — the explicit chat research
   command inherits the news lane's media-work miss; it may deliberately want
   the album. Effort: main thread, ~30 min.
9. [ ] **Wikidata** — the pinned dated dump (`wikidata-20260810-all.json.gz`)
   downloads in the operator's terminal; when the loop's evidence says live
   lookups are too thin (plan §5.5), build the bulk band with row count and
   DynamoDB write cost printed before any load. Until then: nothing. The
   12-QID slice band is a pipeline proof only.

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
