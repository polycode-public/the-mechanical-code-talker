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

## Open items

Four.

- **Overhead frames the board small in a wide window.** The overhead rig sits at `gridSize * 1.4`
  with a 55-degree camera, which fills the frame vertically and leaves most of a wide canvas on the
  sky either side. The 14x14 chapel yard is the worst of the three.
  **Owner:** a track is on it. **Tier:** Sonnet.
  **Confirmed from the other side:** the e2e ground-click test failed for 27s because it clicked sky.
  The 3D stage measures 1239x360 and the board draws as a 248px square in the middle, a fifth of the
  width.
  **Do:** rig the height off the canvas aspect as well as the board, so a wide window pulls in rather
  than backing off.
  **Risk:** a rig that fills a wide window crops a tall one. The height has to fit the tighter of the
  two axes, not the looser.

- **The belief line reads every unseen individual by name.** "What does the goblin see?" answers with
  each unobserved crumb listed one by one, so the sentence is mostly a list of things that are not
  there, and it grows with the food cap.
  **Owner:** a track is on it. **Tier:** Sonnet.
  **Do:** count the unobserved rather than naming them, keeping the named ones for what is in view.
  **Risk:** the deception rail's whole point is that a lie about a specific individual lands visibly,
  so a taught individual has to keep its name even while unseen.

- **`reports/PAGE_WEIGHTS.md` has no figure for the vendored three build.** It is the page's largest
  single asset and the only measurement of it anywhere is prose.
  **Owner:** a track is on it. **Tier:** Haiku.
  **Do:** fold `public/vendor/three.js` into the next page-weights pass.
  **Risk:** none beyond the report going stale on the next three bump, which is what it is for.

- **Four plan-doc audits are running.** `PLAN_MUD*` (six docs) and the language and reasoning set
  (six docs), each against the code rather than against itself. The mudiii audit that set the
  pattern found four real bugs, so expect these to produce items rather than only cuts.
  **Owner:** two tracks.

### Questions blocking work

Nothing is blocked. Every question that used to sit here is answered and written into its own item.

Settled, and written into the items themselves:

- **Claim pills append rather than replace or submit.** A single click appends the pill's text to
  whatever is already in the input, so pills compose: click `look at`, then click `the book`. Return
  submits, and a double-click appends and submits in one gesture. This is a change from every other
  pill rail in the repo — adventure and mud both assign `chatqEl.value = btn.textContent`, replacing
  what was typed. The mudiii rail must append with a separating space and put the caret at the end.
  Recorded on the deception-rail item.
- **Board feedback belongs to ground clicks, not camera buttons.** Clicking a cell flashes it, draws
  a line from the followed agent, and has that agent plan a route there. FOLLOW / POV / OVERHEAD
  switch the camera and do nothing else. The camera-feedback item merges into the click-to-turn item.
- **A retraction suppresses one source's assertion, not the whole triple group.** If two peers
  independently taught the same fact, one retracting leaves the fact standing, cited to the other,
  and the retraction stays on record rather than erasing the assertion. Recorded on the p2p item.

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
