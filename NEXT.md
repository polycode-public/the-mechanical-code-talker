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

- [ ] **Wikidata slice — the download must restart against a pinned dated dump** —
  the completed `latest-all.json.gz` download was corrupt by construction: the
  symlink moved mid-download across resume sessions (its expected size changed
  from 155,314,703,515 to 155,457,882,747 between the operator's own runs), so
  the file spliced two dump versions and the extraction died 124 GB in with a
  gzip Z_DATA_ERROR. Fixed at the root (`a77481d5`): the script now pins the
  newest dated dump on first run and every resume reads the pin; the corrupt
  file is deleted. Operator: re-run `bash scripts/resume-wikidata-dump.sh`
  (fresh full download, ~11 h at recent rates), then
  `node scripts/corpus-bands/extract-wikidata-slice.mjs`, then the band build
  and the operator-gated load per `PLAN_MEMORY_ROLLOUT.md` section 4. If the
  slice is wanted sooner, say so: the 12 seed entities and their objects can be
  fetched from the live entity API in minutes as an interim route (a route
  change from the plan's chosen full-dump path, so it waits for the word).

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
    The global-item-cap bug it surfaced is fixed and merged (`e491b061` +
    starvation-fixture test): the cap now bounds each source's own window, so a
    prolific source can no longer wipe a small source's window presence.
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
  and Wikimedia items carry the feed's own named UTC day. Article logs landed:
  every bench run writes `<run>-articles.md`, and both completed iterations have
  retroactive logs (baseline reproduction matched committed metrics exactly).
  Iteration 4 (rich-paragraph composition) merged, 7 commits through `71018582`:
  cards lead with the report as filed (headline + original summary + source +
  date, 52/53 present, floor 0.90), derived rows never speak (the wrong-sense
  identity dumps gone), background comes from the card's own subjects with
  region seeding ("mina, nevada" → nevada), sentences/card 1.11 → 1.36. In
  flight: the noisy metric's denominator moves to printed-lines-only (worktree
  `.claude/worktrees/agent-aca0ff54cbcd867bc`) — it currently overstates by
  counting unprinted entailed rows. Open question for the operator: region facts
  recur across same-region cards (repeated sentences 6.8% → 6.9%) — cross-card
  variety would trade a card's self-containedness for it. Bench note: the run
  label flag must be `--label=x`, the space form is ignored.
  What the logs exposed, in lever order:
  - **Attribution conflation — fixed and merged** (3 commits through `383be97e`):
    a card cites the items behind its own report ("mina, nevada" 44 sources → 1;
    total citations 1,252 → 55), "Around it" is per-hub with category nodes
    suppressed (repeat 79% → 0%, repeated sentences 37% → 6.8%), feed document
    300 KB → 68 KB, floors ratcheted. Remainder handed to the bench agent: the
    articles log's "backing item(s)" still derives from the two-hop factIds.
  - **The noisy-context metric is redefined and merged** (8 commits through
    `fec2b5d1`): a context line needs positive same-sense evidence (the object or
    its one-hop neighbours sharing a content word with the hub's own company) or
    it counts as noisy — no evidence means noisy, the honest-miss bias. Corrected
    reading on the current state: 24.24% of shown context lines are noisy (the
    blocklist said 3.70%); the old reading rides alongside for one release. New
    catches include "france is a kind of schema place / social station". That
    24% is N2's target number.
  - Identity dumps lead card paragraphs ("france is … a cognition, a condition …"
    before the news sentence); clause hubs ("boats hit by mystery attackers")
    still head cards; "ecuadorean fishings boats" pluralization slip (N2/N4).
  Current change queue, worst first (from the nyt-full and it5-start article logs):
  the hackernews publication card duplicates its story cards; hub naming picks the
  clause over the entity ("sacred glow", "election" instead of Bali, Farage);
  "ecuadorean fishings boats" pluralization; two NYT shapes parse but never ground;
  the fixture-lane `repeatedSentenceRate` smoke floor is red on `main` (0.2418 vs
  0.20 ceiling — must be resolved before the next push). Engine speed remainders,
  measured and named by the perf pass (per-article 10.8 s → 4.3 s live, a 60 s
  cycle grounds ~14 articles): seed re-assembly on any removal (~2 s each, an
  ordering-invariant change), `migrateStoredMemory` re-running per memory-handle
  load, `buildMemoryIndex` rebuilt per write. N5 floors into CI still pending.
  Bench operational notes: pass a distinct `--label` per run (same-day runs
  collide on the report filename), and xl metrics drift with freshly regenerated
  corpus artifacts (chat-seed inputs) — the run that measures a lever must
  rebuild its seed the same way its baseline did, or the pair lies.

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
