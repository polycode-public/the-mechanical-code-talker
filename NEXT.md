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

Five tracks. Two benchmarks landed this round and each produced a finding that became a fix track of
its own, which is what running them was for.

- **T49 the fifteen remaining CLI findings** — the retract-twice wall, `/help` never mentioning
  retraction, `define dog` routing to the code lane, `--repo <typo>` silently scaffolding a repo, and
  the rest. None is a wrong answer, so the bar is comfort without ever making the engine guess.
  `chat.mjs`, `ask.mjs`, `server.mjs`, `codegraph.mjs`, `bin/tmct.mjs`. Top tier. Status: started.
- **T50 the two deployed e2e failures** — reduced-motion's opening cast, and the chapel timeout. Both
  predate the facing fix. `pages-mudiii.test.mjs`, `mudiii-scene.mjs`. Top tier. Status: started.
- **T53 the router's bound and its tie guard** — a member-filter budget that counts steps it never
  takes, a command-register pick that answers a tie every other path declines, and a frame that
  re-executes a past-tense narration. `router/drive.mjs`, `router/resolver.mjs`. Top tier.
  Status: started.
- **T41 prey sweep and status refresh** — down to one regime at a time after the sandbox killed its
  concurrent sweeps; `STATUS.md` prioritised over further sweeping. Sonnet. Status: started.
- **T40 browser playtest** — all twenty-two pages as a visitor, at three viewport sizes. Top tier.
  Status: started.

## Open items

### Inference

- **INF-4's ceiling is a chat-layer bound, not a missing rule.** The benchmark at 5.0.5 reaches INF-8
  on the chat arm with zero fabrications across 499 rows. Of its 56 ceiling declines, **30 are
  already provable**: the bench's own read-only kernel proves all thirty at chain lengths 3, 4 and 5.
  The chat layer declines them because `chat.mjs:9696` and `:9717` pass `{ maxHops: 2 }` to
  `findIsaChain`, which declares `maxHops = 6` itself (`syllogise.mjs:1715`), check-then-extend and
  cycle-safe. So the cheapest next rung buys 30 of 56 with no new inference rule.
  **Tier:** Sonnet. Small edit, sharp trap.
  **The trap, and it will bite:** the generator pins those 30 as `expect: { verdict: "unproven" }`
  with a `ceiling` field. **Raising the bound alone turns 30 correct answers into 30 grader-counted
  fabrications and takes INF-4 from PASS to FAIL.** The pin flip has to land in the same commit.
  **Do:** raise the bound, flip the pins together, and re-run the bench to confirm INF-4 still passes
  and the ceiling count drops to 26. `reports/BENCHMARK_INFERENCE_5.0.5.md` briefs it in six steps.
  **Feasibility:** INF-7 needs Stage EL saturation and INF-8 a Stage DL tableau plus phase-0
  `unionOf`/`complementOf`/negative-assertion representation. Those are the path above, not this.
  **Risk:** deeper chains cost more per turn, and the per-turn cost has already grown (below).

- **A chat turn has got much heavier since 3.0.3.** The inference bench took roughly 25 minutes
  wall-clock for its double replay against about 4.5 minutes for the whole 3.0.3 cycle, while the
  case pool grew only 5%. Nothing about the verdicts changed, so this is cost rather than
  correctness.
  **Tier:** Sonnet. Measurement before any optimisation.
  **Do:** find where the time goes before changing anything. The bench replays a real chat turn per
  case, so the growth is in the turn itself, and the honest first step is a profile rather than a
  guess about which lane got expensive.
  **Risk:** the obvious suspects are the ones that landed recently, which makes it tempting to blame
  the newest change. Measure.


### mudiii.html — camera

- **In POV and FOLLOW the mouse cannot look around.** The operator wants to drag to look while
  following or riding an agent. Today `orbitControls.enabled = cameraState.mode === "overhead"`
  (`mudiii-scene.mjs:888`), so orbiting works only in overhead; in the other two modes the camera is
  pinned to whatever `cameraRigFor` computes and re-aimed on every tick.
  **Tier:** Sonnet. The hard part is what happens when the agent moves under a camera the visitor has
  turned.
  **Do:** let the visitor's drag own the *direction* while the rig keeps owning the *position*. In
  POV the rig sits the camera at the agent's eye (`world.x, 1.6, world.z`) and looks four cells along
  its facing; in follow it sits behind and above. Keep those positions tweened as they are, and apply
  a visitor-controlled yaw and pitch offset on top of the rig's own aim rather than replacing it.
  Orbit controls as they stand will fight the per-tick re-aim, because both want to set the camera.
  Either drive the offset directly from pointer events, or keep OrbitControls and re-seed its target
  from the rig each tick instead of letting it own the position.
  **Decisions worth making explicitly:** whether the look resets when the agent turns (it should not,
  or every tick would yank the view back), whether pitch is clamped so a visitor cannot roll under
  the ground plane, and whether switching camera mode clears the offset.
  **Risk:** `applyTickResult` re-issues `setCamera` on every tick, and `reseedTween` re-aims from
  wherever the camera currently is. A naive fix produces a camera that snaps back 220ms after every
  drag, which reads as broken rather than as locked.
  **Mitigation:** this is a feel change, so watch it rather than asserting it. A unit test can pin
  that the offset survives a tick; only using it tells you whether it moves nicely.


### The CLI answers where it should refuse

`reports/CLI_EDGE_HUNT.md` holds the transcripts. These break the product's central promise, so they
outrank every cosmetic item below.

- **Fifteen further CLI faults, from the edge-hunt report.** The worst four are fixed: the empty
  code index that claimed full test coverage, the forget that taught, the three-word question that
  sold instead of refusing, and the plural teach that stored what it could not then find.
  What remains, all in `reports/CLI_EDGE_HUNT.md` with transcripts: one high and eight medium — the
  retract-twice parse wall, `/help` never saying how to retract, "how do you know" dead-ending,
  `define dog` routing to the code lane, `cli`/`serve` not reading the memory store, `--repo <typo>`
  silently scaffolding a new repo, spider-and-fly never telling a first-time player the advance word
  is `tick`, and non-code questions getting an index-this-repo nudge — plus six cosmetics.
  **Tier:** Sonnet for the medium set; Haiku for the cosmetics.
  **Do:** three of them need routing work in `ask.mjs` and `server.mjs`, which the fix track did not
  own. Every one of the rest is a correct refusal rather than a wrong answer, so they are comfort
  items, not honesty ones. Work them as one batch.
  **Risk:** each is a closed-set addition, and widening a lane can capture sentences another lane
  owns. The corpus tests are where that shows.

### mudiii.html — further work

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

### Pipeline

- **Two mudiii e2e tests fail against the deployed site and predate the facing fix.** Found while
  fixing the facing sampler, checked out to a scratch copy and re-run against the pre-change file:
  both fail identically before those commits, and neither touches what changed.
  - "a visitor who asked for reduced motion…" fails on *the opening cast is still drawn*.
  - "switching to the 14x14 chapel yard…" times out on a 20s `waitForFunction`.
  **Tier:** Sonnet. Diagnosis first; the two may not share a cause.
  **Do:** run both against the deployed site and again against a local build. If they pass locally
  and fail deployed, the difference is latency to CloudFront or something the deploy does to the
  page, and that distinction is the finding. The reduced-motion one is the more interesting: it
  asserts the board is drawn but still, so a failure there could mean the opening cast never
  rendered, which would be a real fault rather than a timing artifact.
  **Risk:** raising a timeout is the fix that always appears to work. Establish what the page is
  actually doing before touching either test.


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
