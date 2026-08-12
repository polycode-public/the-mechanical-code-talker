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
pipelines. Position: iterations 1–8 run. Iteration 8's russia card is the
sharpest target-shaped case yet: its description carries three claims and we
extract one, while its background is anatomy (`orifice ⊑ passage`,
`duct ⊑ passage`) sitting beside the israel/turkey/australia country facts we
want — items 1 and 3 failing on the same card. Harness note:
`run-live-cycle.mjs` starts fresh state each run, so the negative cache resets
and the same misses re-burn lookup slots per run; the deployed worker persists
state and does not.

The work list, ranked by value against the plan's target card. Items 1–5 are all
in flight as worktree sub-agents; each names its own branch.

1. [ ] **Extraction widenings, shape by shape** — in flight on
   `worktree-agent-ac0d4448f66cb44a5`. The named specimens: the Gilman
   description's sentences two and three ("released on a humanitarian basis,
   President Trump said" / "family had said he was in dire physical condition"),
   the "prime | mgx:minister | …" optimistic mint, agentless passives ("is
   banned from …"), "ecuadorean fishings" pluralization, the "new gun" fragment,
   and headline-fragment hubs (iteration 8 mints hub `bright` with
   `bright | mgx:spot-in | colombia as rescuers free quake victim`, the object
   swallowing the rest of the headline). Expected: OUR PARAGRAPH grows from one
   sentence toward the target's three. Effort: one Opus agent, closed-set work,
   taxonomy already exists in `src/services/extract-facts.mjs`.
2. [~] **The §3.2 re-grounding proof** — CODE COMPLETE, merged as `2079a4b1`,
   awaiting the full suite at the next push. Provenance blocked it, not the
   path: enrichment writes definitions under `research:`, folding to source kind
   `referenceLive`, while the isa-anchor ladder counted only `corpus` and the
   taught tiers — so `reprocessAfterGrounding` ran and could never change its
   own answer. Remainder, still open: `CORPUS_ANCHOR_SOURCE_TYPES` and
   `isCorpusAnchorRow` are now misnamed, and the matching `corpusAnchored` key
   on `buildIsaTermIndex`'s exported return is pinned by tests, so the rename is
   a three-name change with test churn behind it.
3. [ ] **Asserted cross-sense neighbourhood drift** — in flight on
   `worktree-agent-ae8438ab8504d1e3c`. "orifice ⊑ passage" still wanders near
   the russia card; the disjointness gate covers derivations only, and
   `subgraphAround`'s hop-bounded BFS has no sense check at all. Its remainder,
   same cause: neighbourhood-sourced filler sentences in OUR PARAGRAPH ("dull is
   the opposite of bright", "Around it: country buys battery"). Expected:
   RELATED FACTS keeps israel/turkey/australia-are-countries, drops the anatomy
   strays, and the filler sentences starve. Effort: one Opus agent, same-sense
   discipline applied to neighbourhood selection.
4. [~] **chat.mjs read-time sense screen** — CODE COMPLETE, merged as `b83d058b`,
   awaiting the full suite at the next push. Four walks were leaking, not one:
   the 8-hop subtype BFS, the rendered superclass chain, the cax-sco/scm-sco
   proof chases, and the deep-chain probe that offers `/syllogise`. A strictly
   two-hop crossing is not screenable by construction — `topsOf` puts a term at
   its nearest level, so a subject two hops from `body part` reaches `place` and
   `body part` at the same level and keeps both, which is the deliberate "a term
   genuinely under two tops keeps both branches" rule. The leak was always the
   multi-hop walk.
5. [ ] **Engine speed remainders** — in flight on
   `worktree-agent-a8524b7876375a001`. Seed re-assembly on any removal (~2 s
   each; 15 lines of unwired slot-structure scaffolding preserved on branch
   `worktree-agent-add917bc647f82f46`, unmerged), `migrateStoredMemory`
   re-running per memory-handle load, `buildMemoryIndex` rebuilt per write.
   Expected: more articles ground per 60 s press; faster runs.
6. [ ] **Thin-source cards crowd the feed** — iteration 9 printed nine cards and
   seven were Hacker News, each reading "hackernews discuss X" with no
   background. The synthesised summary itself is right and deliberate
   (`news-sources.mjs` quotes the headline inside a fixed frame so its words
   can't be re-read as a claim; the comment there explains it), but a source
   whose items carry no body can never make a target-shaped card, and at seven
   of nine those cards dominate both the live page and this loop's own
   measurement. Wanted: admission or ranking that stops a bodyless source
   crowding out cards with real content — without silently dropping items,
   which would hide misses rather than fix them. Lands in
   `src/domain/news-feed.mjs`, so it waits for item 3 to merge.
7. [ ] **Fact-listing line order tracks arrival order** — the repo invariant says
   any read-time resolver over the fact store is a pure function of the fact
   set, and the listing reader is not yet one in its ordering.
   `rankByBiasThenTrust` is a stable sort, so equal-trust rows keep ingestion
   order: feed the same facts forward and reversed and "what do you know about
   X" gives the same fact SET in a different line order. Measured on both sides
   of the sense-screen change, so it predates it. The fix is a
   content-addressed tiebreak on every fact listing, which redraws pinned
   outputs across the estate — that width is why it is its own item rather than
   a remainder of item 4.
7. [ ] **Wikidata** — the pinned dated dump (`wikidata-20260810-all.json.gz`)
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
