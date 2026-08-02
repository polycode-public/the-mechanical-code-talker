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

## In-flight right now

Five tracks, and **four of them are generating work rather than closing items**. The thirteen-item
mudiii batch landed, which took the open count from 23 to 7 — so the backlog's own files are almost
exhausted, and the playtest, the docs audit, the weights refresh and the CLI edge-hunt are what fill
the slots. Their output is the next wave's items.

- **T40 browser playtest** — drives all eleven demo pages and eleven about pages as a visitor, at
  three viewport sizes: every pill clicked, every suggested sentence typed, every Next button walked.
  Fixes nothing; writes `reports/PLAYTEST_*.md`. Top tier. Status: started.
- **T41 prey sweep and status refresh** — the regimes the first comparison could not cover (market
  and chapel boards, other vision radii, a starvation regime), then resynthesizes `STATUS.md`.
  Sonnet. Status: started.
- **T42 docs against code** — every README capability claim traced to the code that does it, every
  `PLAN_*.md` status line checked against what has landed, and `crdt.md` read as one account rather
  than three layers. Top tier. Status: started.
- **T43 page weights** — `reports/PAGE_WEIGHTS.md` is stale by eleven about pages, a shared
  stylesheet and a 3D page carrying model binaries. Sonnet. Status: started.
- **T44 CLI edge-hunt** — hunts the command-line surface for dead-ends and, above all, for any answer
  it guessed where a refusal was due. Writes a report. Top tier. Status: started.

Waiting on one job: `e2e:deployed:pages` on pipeline 2725436237, the last of its 25. The other 24 are
green. A docs-only push gets a 4-job pipeline that runs no tests, so those greens prove nothing —
only a code push exercises the deployed tier.

## Open items

### mudiii.html — behaviour the plan specifies that is missing or half built

- **The goblin sizing fix is green locally and unproven on CI.** Goblins used to render at a
  different wrong scale on every load, with one coming out many times house height, its foot above
  the ground. The cause was a race with the spawn tween: a cached loader handed every agent of a kind
  the same parsed `gltf.scene`, and `normalizeToHeight` measured it through a parent group's world
  matrix while `playSpawnFlourish` was still tweening that group's scale, so the applied scale
  depended on which frame the parse landed on. At or near scale zero the measured height read zero,
  the `|| 1` fallback invented a height, and the scale became `targetHeight` against the raw model.
  Fixed: each model URL's bytes are fetched once and parsed per agent off the shared buffer, so every
  agent owns its own object graph without a duplicate request. `normalizeToHeight` throws on an
  already-parented object and on a repeat call, the `|| 1` fallback is gone, `meshHeightOf(id)` is on
  the scene surface, and `boot` is awaited so the opening tick no longer runs against a null scene.
  `node --test test-e2e/pages-mudiii.test.mjs` passes 6/6 across three consecutive local runs, and
  each of `fox.glb` and `goblin.glb` is requested exactly once across a load, a slider reboot and a
  Reset.
  **What is left:** none of that has reached CI. `e2e:deployed:pages` failed this test on pipeline
  2725214193, which ran against a commit predating the fix.
  **Tier:** none. It closes on the next green pipeline.
  **Do:** confirm the job passes on the push that clears the red suite, then delete this item.

- **`smoke:deploy`'s new `mudiii.html` probe has not run against a real deployed URL.** The probe
  itself has landed: `mudiiiPage()` in `scripts/post-deploy-smoke.mjs` fetches `mudiii.html`
  relative to `PAGES_URL` and asserts both `res.ok` and a present `content-encoding`, registered in
  `checkOnce()` and folded into the `ok` boolean.
  **Tier:** Haiku, and it is a run rather than an edit.
  **Do:** run `npm run smoke:deploy` once after the next real deploy and confirm the `mudiii` row
  reports an encoding rather than an error. A wrong path is the only way this fails, and nothing
  local can tell you.
  **Risk:** none. No sibling probe is unit-tested; don't invent a test where the others have none.

### mudiii.html — further work

- **The desktop deck still carries a wide empty band.** With the map reduced to a 240px minimap in
  its own grid column, the left of the deck holds four sliders in one row and a camera row below,
  with roughly 200px of blank parchment between them. The track that shrank the map called it
  "spacing bracketed by controls"; on the screenshot it still reads as a void, because the deck
  genuinely has fewer controls than the minimap is tall.
  **Tier:** Haiku, but it is a design call before it is CSS.
  **Do:** either give the column something to hold, or stop the deck stretching to the map's height.
  Candidates for the space: the chat pill rail, which currently sits below the scene; the turn
  counter; a compact legend. Or let the map sit in a shorter panel and allow the deck to close up.
  **Risk:** the phone layouts are approved and must not move. Any fix belongs inside the
  `min-width: 901px` query.
  **Mitigation:** screenshot the desktop and both phone sizes, and confirm the phones are unchanged.


- **The prey blend is measured and shipped off; one regime is unmeasured.** The weighted
  evade/forage score exists behind `blendPreyDecision`, default false, and the comparison harness is
  committed at `scripts/compare-prey-decision.mjs`. Over 12 seeds the priority chain wins the mean on
  10, the median on 9, and the longest-lived prey on 9, so the default stayed. The behavioural metric
  cleared the trap: the blend forages within a predator's reach about 10% of the time where the chain
  never does, so it is losing by foraging, not by evading more.
  Chebyshev distances are integers and one step moves each by at most 1, so any weight above 0.5 is
  byte-identical to the chain. The knob has three settings, not a continuum.
  **What is unmeasured:** every run used one predator on town square with `preyVisionRadius: 3`, and
  nothing starved on the shipped drain. A prey that sees further than it can be caught from, or a
  board with more crumbs than foxes, could move where the trade breaks even.
  **Tier:** Haiku. It is a re-run, not new work.
  **Do:** the harness already takes `--layout` and `--set`. Sweep the chapel and market boards and a
  couple of vision radii, and record what the numbers say. If they still favour the chain, delete
  this item and leave the flag off.

### Teach mode

### Pipeline

- **`e2e:deployed:pages` fails on the teach-frame test's own precondition.** Job 15665986632, against
  `ab32c1ce`: "an addressed teach-frame moves the board and the page redraws it, with nothing
  playing" fails at `the opening cast has both a fox and a goblin to address`. The precondition
  fails, not the behaviour under test — the deployed page's opening cast did not hold one of each.
  **Tier:** Sonnet, and it may already be fixed.
  **Do:** the roster mint in flight replaces `pickRoster`, which decides the opening cast and today
  slices from a layout casting fewer agents than the sliders ask for. Re-run the job once that lands
  before diagnosing further. If it still fails, the test should pick its two addressees from whatever
  cast exists rather than assuming one of each — cast size is a slider value, so hardcoding a shape
  repeats the mistake the Reset wait made by pinning a pre-Reset count.
  **Risk:** its title also says "with nothing playing", which stops being true once the page opens
  playing. Settle both in the same change.

- **The seed-perf bar is widened and unproven on CI.** The
  `unit` job on pipeline 2725214193 reports "16000-fact batch's best-of-5 took 3944ms vs 2000-fact
  batch's best-of-5 187ms (21.09x)". It does **not** fail locally, and the pushed commit predates the
  retraction work, so nothing in this batch caused it. A shared CI runner and a bar the measurement
  sits right on top of are enough to explain it.
  **Fixed, unproven on CI.** The bar moved from 20x to 32x, halfway between the two hypotheses in
  wall-clock terms rather than sitting on top of the linear band's own noise. Quadratic still fails
  with a 2x margin. Green locally.
  **Tier:** none. It closes on the next green pipeline.

- **The two page-order jobs are fixed in the tree but have not re-run.** `pages-index.test.mjs` and
  `pages-home.test.mjs` both carry `mudiii` and the numeral XI now, and both pass locally against a
  fresh `npm run demo:build`. `e2e-web-index` and `e2e:deployed:shell` have not been exercised since,
  because nothing has been pushed.
  **Tier:** none. It closes on the next green pipeline.
  **Do:** confirm both jobs pass on the push that clears the red suite. If they do, delete this item.

### Questions blocking work

Three answers are outstanding. Each names the item it blocks. The three settled ones are recorded
against their own items above and are repeated here only so nothing is looked for twice.

- **Which model stands in for a pile of animal feed?** Partly answered. The operator asked for feed
  on the ground — seeds, a sack or hay — and `haybale.glb` is committed and credited, tied to
  KayKit's Dungeon Remastered pack through a real CC0 row rather than assumed from its filename. So
  the food item is unblocked and needs no download. What is still open is whether a hay bale is the
  wanted reading for both `crumb` and `morsel`, since one file now serves both at different heights.
  The `world-of-claudecraft` `resources/` directory holds `food_pile_small/medium/large.glb`,
  `food_flour.glb` and `gems_sack.glb`, which look closer to seeds and sacks, but that directory has
  no pack provenance recorded anywhere, so none of them can be used until someone can name their
  pack. Default: ship the hay bale and revisit only if the operator wants a different shape.
Nothing is blocked. The three questions that used to sit here are answered and written into their
own items.

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
