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

1. [~] **Extraction widenings, shape by shape** — CODE COMPLETE on
   `worktree-agent-ac0d4448f66cb44a5`, merge pending. Six shapes widened:
   clause-shaped terms, Title Case headline reading, passives with and without a
   named actor, comma crossing plus name trimming, reported speech, and the term
   ledger. Two remainders, both real:
   - The Gilman card now grounds two near-synonymous rows ("russia frees robert
     gilman. russia releases robert gilman.") because headline and description
     state one event with two verbs. Deduplicating synonymous predicates is a
     vocabulary question, not a shape one.
   - An unwrapped claim is not attributed to its speaker on the row. That needs
     a new name in the memory layer's closed findings vocabulary
     (`src/adapters/memory/shacl.mjs`, `core.mjs`'s byte-pinned vocabulary note,
     `docs/adapter-contract.md`). The speaker still reaches the enrichment queue,
     and every row rides its article's provenance.
2. [ ] **The `bright` card's filler sentence** — "dull is the opposite of bright"
   survives the sense scope because `topsOf("bright")` is empty, so the bands
   never place the hub and a hub-anchored scope is off for that card. Item 1
   re-heads that card on `rescuers`, so check whether this dies on its own once
   item 1 merges before doing any more here.
3. [ ] **Engine speed remainders** — in flight on
   `worktree-agent-a8524b7876375a001`. Seed re-assembly on any removal (~2 s
   each; 15 lines of unwired slot-structure scaffolding preserved on branch
   `worktree-agent-add917bc647f82f46`, unmerged), `migrateStoredMemory`
   re-running per memory-handle load, `buildMemoryIndex` rebuilt per write.
   Expected: more articles ground per 60 s press; faster runs.
4. [ ] **Thin-source cards crowd the feed** — in flight on
   `worktree-agent-a5b1b24c0282ad707`. Iteration 9 printed nine cards and seven
   were Hacker News, each reading "hackernews discuss X" with no background. The
   synthesised summary itself is right and deliberate (`news-sources.mjs` quotes
   the headline inside a fixed frame so its words can't be re-read as a claim;
   the comment there explains it), but a source whose items carry no body can
   never make a target-shaped card, and at seven of nine those cards dominate
   both the live page and this loop's own measurement. Wanted: admission or
   ranking that stops a bodyless source crowding out cards with real content —
   without silently dropping items, which would hide misses rather than fix them.
5. [ ] **Fact-listing line order tracks arrival order** — the repo invariant says
   any read-time resolver over the fact store is a pure function of the fact
   set, and the listing reader is not yet one in its ordering.
   `rankByBiasThenTrust` is a stable sort, so equal-trust rows keep ingestion
   order: feed the same facts forward and reversed and "what do you know about
   X" gives the same fact SET in a different line order. Measured on both sides
   of the sense-screen change, so it predates it. The fix is a
   content-addressed tiebreak on every fact listing, which redraws pinned
   outputs across the estate — that width is why it is its own item.
6. [ ] **Wikidata** — the pinned dated dump
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
