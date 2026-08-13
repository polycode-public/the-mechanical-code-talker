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
pipelines. Position: iterations 1–13 run, all merged and pushed. Iteration 13's
feed reads 14 cards, 6 with real background and 5 thin, ranked by substance with
admission per source printed — NYT 8 of 8 with something to say, Hacker News 1
of 6. The syrian card is clean, `rescuers free quake victim` reads correctly,
the london card carries the phrasal fix, and the research rows come out in
content order rather than in the order the lookups returned. Harness note:
`run-live-cycle.mjs` starts fresh state each run, so the negative cache resets
and the same misses re-burn lookup slots per run; the deployed worker persists
state and does not.

The work list, ranked by value against the plan's target card.

1. [ ] **A report's claim is not attributed to its speaker** — the shape is a
   reified finding: the claim row carries `mgx:extractionFinding =
   "reported-speech"`, and a second row states
   `fact:<claimId> | mgx:attributedTo | <speaker>`. The finding is the durable
   half, so a lost attribution degrades to "reported speech, speaker unrecorded"
   rather than to a bare assertion. An attributed claim STAYS GROUNDED and every
   rendering names the speaker — refusing it would be a judgement that a grounded
   claim might be false, which is a guess in the direction tmct exists to avoid,
   and a trust penalty is banned outright by the findings vocabulary's own
   constitution. **The invariant: a surface that cannot render the attribution
   must not render the claim.**
   - Merged: the `normFactTerm` carve-out (a `fact:` id survives the CURIE strip,
     without which the reference is unrecoverable), the phrase layer, the chat
     caveat, and the finding at all five vocabulary sites with an estate guard
     parsing each one live.
   - CODE COMPLETE and DELIBERATELY UNMERGED on
     `worktree-agent-ad6f9b1744d17d6b2`: the write path and
     `resolution.mjs`'s `MERGE_PREDICATE_STEMS` entry (without which two outlets
     attributing one claim to two speakers read as a contradiction). Merging it
     alone breaks the invariant — the russia card renders the claim with no
     speaker, and where the seed graph does not out-rank it,
     `looksLikeEntityTerm` accepts `fact:285cf16183…` as a one-word term and
     heads a card with the hex id.
   - In flight on `worktree-agent-abdd759e4cdcb7f98`: the card read side, which
     unblocks that merge. Suppress attribution rows from every card lane at the
     top of `buildNewsItems`, and read the speaker off the entry's WHOLE `rows`
     array — on the russia card the kept sentence is the headline row while the
     folded row carries the speaker.
   - Still open: the full chat route, where `foldFactRows` attaches an
     `attributedTo` field so every reader inherits it, rather than chat showing
     only the caveat. And retraction does not cascade — `removeFacts` scrubs
     `objectProperties` edges, while an attribution holds the claim id in an
     attribute value, so retracting a claim leaves its attribution behind.
   - Unverified, and worth checking before trusting: an attribution row's trust
     behaviour is untraced (`trust.mjs` was never read), and whether attribution
     rows should count toward the bench's grounded numbers needs
     `scripts/news-bench/metrics.mjs`.
2. [ ] **One event, two verbs, two rows on the card** — in flight on
   `worktree-agent-a2ed151e88e6c10f0`, at paragraph assembly where the whole row
   set is in view. The russia card reads
   "russia frees robert gilman. russia releases robert gilman." because the
   headline says "Freed by Russia" and the description says "released". Both
   rows are true and the graph is right to hold both; the card is wrong to say
   it twice. A lexical synonym fold was tried and reverted — free/release split
   on the subject's kind, which is an open set, so folding them called a rescue
   a jail delivery ("rescuers releases quake victim"). The fix belongs at
   paragraph assembly, where the whole row set is in view, not at extraction
   where one row is. Against the plan's §2 target card this is now the most
   visible defect on the best card.
3. [ ] **"hackernews discuss" reads as a plural** — in flight on
   `worktree-agent-a2ed151e88e6c10f0`, same agent as item 2 since both land in
   paragraph rendering. Live on 6 of 14 cards.
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
4. [ ] **The news fact cap evicts by content hash, not by age** —
   `evictNewsFacts` reads `r.observedAt` off the row, but `readFactRows` keeps
   `observedAt` on the assertion records; `rowObservedMs` exists for exactly
   that and eviction does not call it, though three other readers in the same
   file do. Every news row therefore scores 0 and the sort collapses to id
   order, so the cap drops whichever facts happen to hash low rather than the
   oldest. `test/domain/news-feed.test.mjs`'s eviction test passes only
   because its fixture sets a top-level `observedAt` that no real row
   carries — so the test needs fixing alongside the code, or it will keep
   passing over the bug. Found while measuring the attribution write's
   eviction hazard; separate from it, and live today.
5. [ ] **`localeCompare` over fact rows, in ten places** — a locale-divergence
   class rather than an arrival-order one: two readers on machines with
   different locales sort the same rows differently, which breaks the same
   pure-function-of-the-fact-set invariant by another route. `fact-order.mjs`
   states the rule (codepoint, never `localeCompare`) and `inspect.mjs`'s four
   were fixed alongside the root sort. The rest sit in `core.mjs`'s
   `findContradictions` and its store-row listing, `digest/select.mjs`,
   `digest/compose.mjs` and `ledger-viz.mjs` — left deliberately rather than
   half-sweeping five files mid-task.
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
