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

## In flight (2026-08-07 batch)

- **E1 definitional QA track** — covers the E1/OpenBookQA item below, rig side only (fixture,
  two new rigs, committed results). Status: spec landed; implementation running (Sonnet,
  worktree). Merges AFTER the reduction track; the coordinator then retires claim:commonsense
  and its results JSON.
- **Research-provider config track** — LANDED (merged to main, blast radius 248 + test:fast 220
  green on the merge; push pending the full suite now running). Worktree and branch removed.
- **Research-page flake-hardening track** — covers the pause-ticking flake sub-clause below.
  Status: started (Sonnet, worktree).
- **Claims-page reduction track** — covers the five-block reduction item below. Fully specified
  by the operator's prompt, no spec agent needed. Status: started (Sonnet, worktree).

Sequencing note: the claims-page source belongs to the reduction track for this batch. The E1
track's implementation is re-scoped to the rig side (fixture, scoring, delta, committed results);
its page-facing parts (the reworked E1 block, the OpenBookQA limits block) are its recorded
remainder, pending the reduced page's admission standard.

The two tracks own disjoint files (benchmark fixture + claims page source vs. toml/CLI/chat
wiring); the coordinator owns this file and the merges.

## Open items

- [ ] **E1 becomes a definitional QA set; the OpenBookQA zero moves to limits.** Author a
  committed definitional ("what is X"-shaped) question fixture, and point E1's extensibility
  motion at it: score out of the box, load wordnet-xl, score again, publish the delta. The
  OpenBookQA sample and its zero move to the claims page's limits section as a
  grammar-shape limit with its own what-this-does-not-mean line naming the unsupported
  causal phrasing.
- [ ] **claims.html reduces to the five blocks whose measurements hold up.** The page renders
  exactly C3 (latency), C4 (determinism), C5 (offline), C7 (planner envelope), L1 (prose
  grounding), keeping their anchor IDs. The "Measured extensibilities" section goes; the TOC
  covers the two remaining sections; retired pairing cross-references (C1↔L1, C2↔L2, C2↔E3) go;
  the intro rewords for two sections, keeps the Cyc passage and the "A claim ships with its
  number, or it does not ship" close, and states the admission standard (input from outside the
  repo, sampled beyond the author's choosing, or reader-checkable on own hardware), with a
  one-line tag under each surviving block naming which it satisfies. Retired rigs, fixtures and
  results JSON all stay in the repo and in `npm run claims` as regression checks. The homepage's
  "Every fact it gives you names where it came from" overclaims (C1 measured 5 of 222) and gets
  replaced with wording backed by the surviving blocks; no universal-citation claim anywhere on
  the site until the reworked C1 lands. Stale anchor links in public/ sources and the READMEs get
  updated or removed.
- [ ] **The research provider becomes config-selected, settable three ways.** Delivered and
  merged: `tmct.toml [research] source`, `--research-source` on init and chat, and in-chat
  `/wikipedia` and `/wikidata` (`/wiki` was already the live-reference toggle with a pinned
  non-mutating bare form, so the selectors got their own names and bare `/wiki` now reports the
  active source), plus the adjacent fixes the track folded in: research ingest now stores a
  Wikidata row's structured `facts`, and citations/miss lines name the active source instead of
  hard-coding Wikipedia. Remainder, the reason this stays open: the track's e2e runs hit a
  pre-existing flake three times — `test-e2e/pages-chat-research.test.mjs` "pause really stops
  the ticking", a CDP click timeout on `#researchPlay` whose in-test 3-attempt retry doesn't
  cover the browser-ticker-vs-driver race it documents. Harden that test; the item closes when
  it holds under repetition.

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
