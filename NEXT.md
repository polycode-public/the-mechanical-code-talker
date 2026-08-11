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
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] **The memory backend and turn surface: the AWS-side remainders** —
  `PLAN_MEMORY_BACKEND.md` is BUILT (every phase carries its marker; 6.0.x on npm ships
  the library half; the closing push is gate-green at 7968/0). What keeps this item open
  is deployment, not build: (a) the live-API fix set is in flight — the first orphan
  table is deleted and the stack deploys, and three live-verified defects have their
  fixes dispatched: Lambda URL auth needs `lambda:InvokeFunction` for the CloudFront
  principal BESIDE the InvokeFunctionUrl grant CDK adds (proven live: adding it flipped
  the edge from 403 to serving; a manual out-of-band statement sits on the row service
  and comes off once CDK owns it), the table's key attributes must be `pk`/`sk` like
  every shipped consumer (the deployed `sessionKey` table gets replaced; the explicit
  tableName drops so replacements stop colliding, corpus:load reads the name from a
  stack output; the replaced table is RETAIN-orphaned and needs one manual delete after
  the deploy), and every body-carrying client call must send `x-amz-content-sha256`
  (Lambda URLs behind OAC reject unsigned payloads; GETs stay bare); (b) the
  wikidata-slice and conceptnet-full bands stay empty until their raw dumps are
  downloaded and loaded by hand — the pipelines are built and fixture-proven, only the
  dumps are missing. The exact steps, from each script's own header:
  - conceptnet-full: `curl -s https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz | gunzip -c > dump.tsv`,
    then `node scripts/corpus-bands/build-conceptnet-full.mjs --source dump.tsv`, then
    `tmct corpus load conceptnet-full --table tmct-prod-prod-rows --source <out>` with
    `AWS_PROFILE=tmct-prod`. Admits every en→en canonical-relation edge (the superset
    the capped committed slice moved out into); CC BY-SA 4.0, the pipeline writes its
    own NOTICE beside the jsonl.
  - wikidata-slice: download a Wikidata JSON-lines entity dump (the `wikidata-*-all`
    dump split to one entity per line, or any pre-filtered slice carrying the committed
    SEED_QIDS), then `node scripts/corpus-bands/build-wikidata-slice.mjs --source
    <dump.jsonl>`, then `tmct corpus load wikidata-slice --table tmct-prod-prod-rows
    --source <out>`. Only SEED_QIDS entities' claims through the shared
    property-relation map become facts; growing the slice is adding SEED_QIDS entries
    and re-running. CC0, no notice.
  Loads are idempotent (content-addressed rows; a matching source digest is a no-op)
  and resumable (a mid-load death re-runs as harmless re-puts; the manifest writes
  last).
- [ ] **The two empty leads the composition receipt did not reach** — `whereSet` still answers
  "nothing in the index matches that clause (classes), so there is no location to cite" and
  `temporal` still answers "nothing in the index matches the inner set", the last two empties
  that name neither the branch that emptied them nor the population the index holds. The walk
  that names them exists (`emptiedBranch` in `src/domain/ask.mjs`); these two renderers do
  not call it, and each has a tail sentence of its own to compose with (whereSet's location
  cite, temporal's time qualifier), so each needs its own composition rather than a copy of
  the shared lead. (The combined miss-lead + empty-composition round itself landed: +0.084
  answer-identity-controlled on changed answers, every cell up, report
  `reports/BENCHMARK_CEFR_ENGLISH_5.0.46.md`.)
- [ ] **The judge instrument moved: decide whether to re-baseline the judged pool** —
  `g-b1-neg-11`, the case whose two honesty-0 samples originally evidenced the miss-lead
  item, scored honesty 2 on a fresh draw of the UNCHANGED base text in the 5.0.46 round —
  same pinned judge (`claude-haiku-4-5-20251001`), same `judge-prompt-v2`, N=2, no verdict
  cache on either arm. The same sentence moved 0→2 between rounds with nothing about the
  answer changing, so that cell can no longer be cited in either direction and any
  raw-score comparison across rounds inherits the doubt; the 5.0.46 report's
  answer-identity-controlled views (scoring only answers whose text actually changed, with
  byte-identical answers as the instrument-noise control) are the trustworthy lens until
  the instrument is re-anchored. A re-baseline round means re-scoring the full held judged
  pool once against current answers to reset every cell's baseline (~1,075 cases × N=2
  judge calls, same spend class as the miss-round's 850). Operator's call whether and when
  to spend it; until then, judged rounds keep leading with the identity-controlled view.

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
