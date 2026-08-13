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

1. [ ] **A report's claim is not attributed to its speaker** — spec in
   `PLAN_ATTRIBUTION.md`. Commits 1, 2, 5 and 6 are merged: the `normFactTerm`
   carve-out, the phrase layer, the chat caveat, and every vocabulary site with
   an estate guard that parses all five live. What remains is the write path
   (commit 7, `extract-facts.mjs`), the card read side (commit 4,
   `news-feed.mjs`), `resolution.mjs` site 10, and the full chat route
   (commit 8). `reportedClauseOf` currently discards the speaker — its own
   comment says so — and neither of its two regexes captures it, so both need a
   capture group and its return type becomes `{ claim, speaker }`. It is
   exported and pinned, so that signature change is a real edit. The invariant
   to hold throughout: a surface that cannot render the attribution must not
   render the claim.
2. [ ] **The graph's own false fact becomes an anchor's sense** — in flight on
   `worktree-agent-a8aed6d0760b04093`. The unplaced-hub scope landed and the
   syrian card is byte-identical, because its strays never came through the hub
   walk. Instrumented: both arrive on the article-entity walk, and the article's
   own extraction minted `say | rdfs:subClassOf | matter` from "many say it is
   just a matter of time". That asserted isa places `say` under `substance`, so
   `matter` then legitimately meets the anchor pool — no sense gate can refuse
   it, because the graph believes it. Two upstream causes: the mint itself in
   `extract-facts.mjs`, and `articleEntityNames` in `news.mjs` admitting `say`
   and `moves`, neither of which is an entity. A measured lever left pending
   their fix: a strict article walk drops the genuine stray
   `dance | mgx:relatedTo | moves` from the trump tariff card (background 24 →
   15) and does not touch the syrian card.
3. [ ] **"hackernews discuss" reads as a plural** — live on 6 of 14 cards.
   `isSubjectPlural` reads a naive `-s` suffix, so a singular site name spelled
   with a trailing `-s` renders bare. The fix is one entry in the existing
   `SINGULAR_NOUNS_ENDING_S` closed set, but it moves 5 pinned assertions across
   `news-feed.test.mjs`, `news-card-article-entities.test.mjs` and
   `news-card-coverage.test.mjs`. Written and reverted once already because
   those files belong to the sense-scope track; land it when they are free.
   The wider version — a plural column on 43 of the curated table's 49 entries,
   plus a subject-number test that does not read "redis", "socrates" or "mjs"
   as plural — needs the lexicon's declared plurals, and `fact-phrase.mjs` is
   deliberately import-free so it can be stringified into the browser. That
   cost is the real one, and it is bigger than the typing.
4. [ ] **The rest of a 300 ms write** — the index was 18% of it and is now
   carried across writes (appendFact −15.6%, appendUtterance −16.1%,
   removeFacts −11.7% at 60k facts). The profile puts the remaining ~85% in
   `cacheUpsertEdge`'s per-edge filter, `sqlitePayloadStoreRows`, and
   `cloneJson`. The largest single item is `mutablePayloadCopy` copying all 60k
   individuals; skipping it needs the object-identity work the index change
   deliberately left alone, since three of the five index maps can't be reused
   precisely because every individual gets a new identity per mutation.
5. [ ] **`localeCompare` over fact rows, in ten places** — a locale-divergence
   class rather than an arrival-order one: two readers on machines with
   different locales sort the same rows differently, which breaks the same
   pure-function-of-the-fact-set invariant by another route. `fact-order.mjs`
   states the rule (codepoint, never `localeCompare`) and `inspect.mjs`'s four
   were fixed alongside the root sort. The rest sit in `core.mjs`'s
   `findContradictions` and its store-row listing, `digest/select.mjs`,
   `digest/compose.mjs` and `ledger-viz.mjs` — left deliberately rather than
   half-sweeping five files mid-task.
6. [ ] **`mud-editor.mjs` has the adventure editor's old loose contract** —
   `planMudEditorSync` returns bare triples and `mud-browser-entry.mjs` stamps
   them at the call site, exactly as the adventure pair did before the fix. Its
   one production caller stamps correctly, so there is no live break — this is
   symmetry, and the same mechanical change of shape.
7. [ ] **Wikidata** — the pinned dated dump
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
