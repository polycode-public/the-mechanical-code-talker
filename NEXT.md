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

*(Footnote, not an open item: MUD3D was renamed MUDIII, design only, credit to
`world-of-claudecraft` and MUD1/MUD2 chosen if `mudiii.html` ever ships. An optional email to
Richard Bartle at that point is the operator's call to make if and when they choose to.)*

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## In flight (2026-08-07 second batch)

- **Page track** — running (Sonnet, worktree): three blocks + Cyc passage + per-block nav;
  owns site-pages.mjs, build-demo-site.mjs, site.css, test/estate/claims.test.mjs.
- **Purge track** — queued BEHIND the page track (hard order: a declared block whose JSON is
  deleted fails demo:build and the estate test, so the manifest must shrink first). Mechanical
  deletion of 26 files + 10 package.json claim:* lines; keeps planner, prose-band, openbookqa,
  definitions, paraphrase and all shared claims helpers.
- Editorial calls settled by the spec, adoptable without re-litigating: kickers stay C7/L1/L2
  (gaps are truthful; no external deep links exist); dead pairing CSS goes, delta CSS stays
  (definitions may earn a block back).

- **Benchmark-pins tracks** — ALL LANDED (idxbench fix + ladder pin; four pins + B1
  promotion; reports + skill descriptions). 79/79 on the five bench files on merged main.
- **Demo-deletion spec agent (Opus, read-only)** — mapping the removal of the five demo
  pages before implementation dispatches.

## Open items

- [ ] **Eight benchmark skills retire in favour of npm-test pins; only benchmark-cefr-english
  survives.** benchmark-agent, -inference, -code-index, -ingest, -research, -conversation,
  -agi-scales and -code-synthesis: their skill directories, root symlinks, skill-only
  supporting scripts, and mentions in .md files, site sources and data all delete. Kept: the
  underlying features and engines, the JS/chat/CLI surfaces, all previous results
  (reports/BENCHMARK_*, envelopes), and the test-benchmarks harnesses/graders/fixtures the
  suite pins now import. New test work before the deletion: a deterministic, quick,
  non-ceiling-graded slice of INFBENCH's chat arm gets pinned (the rest of that skill still
  goes). Spec agent running (Opus); implementation waits for the demo-deletion train (README
  and receipts.json ownership overlap).

- [ ] **Five demo pages delete; their features and JS/chat/CLI surfaces stay.** research.html,
  spider-fly.html, code.html, ingest.html and mud.html (and their paired about pages) leave
  the site: page list, builders, homepage grid cards and any other homepage links (operator
  flagged these explicitly), sitemap/head metadata, screenshots/og images, service-worker
  precache, and their page-level e2e/estate tests all go. NOT touched: the underlying
  engines and lanes (research lane in chat, spider-fly, code domain, ingest, mud) and their
  unit/corpus tests, the chat/CLI/JS consumer surfaces, mudiii (a different page), and
  pages-chat-research e2e (tests the chat page, not research.html). Cross-page links into
  the five (e.g. the claims page L1 block's "try it in ingest.html") get removed or
  repointed.

- [ ] **claims.html cuts to three blocks; the removed sections' rigs purge from the repo.**
  The page keeps only: the C7 planner block ("tmct solves a taught Hanoi puzzle in under a
  second up to this many disks."), the L1 prose-band block, the L2 OpenBookQA block, and C7's
  device-bench box. Everything else on the page goes — the lede, the admission-standard
  sentence, the Cyc passage (operator removed it after the first cut landed), both section
  headings and their intro paragraphs, and the closing line. The left "on this page" nav
  lists a short title per remaining block instead of the two section names. The rigs that captured removed sections (both this cut and the
  earlier five-block reduction) are deleted outright — scripts, results JSONs, npm hooks, and
  fixtures used only by them; this supersedes the earlier keep-as-regression-checks stance.
  Rigs that never had a page section (definitions, paraphrase) stay.

*(Two settled wording/scope decisions worth knowing when C1's rework starts: the claims
intro says "every fact answer stays checkable against the graph it came from" where
claims-notes.txt says "stays citable" — restore the notes' wording only if the rework
re-earns it; and `claim:definitions` publishes no page block until its fixture is sampled
from outside the repo, per the page's admission standard.)*

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
