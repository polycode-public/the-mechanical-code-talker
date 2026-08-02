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

Six tracks. The playtest and both benchmarks have landed, and each one spawned a fix track — running
them when the backlog's own files were claimed is what turned up the seventeen-minute freeze and the
router's phantom budget.

**The bottleneck is the browser, not the file graph.** At most two tracks may hold
`npm run demo:build` at once; three concurrent builds cost two tracks their work. T55 and T56 hold
those two slots. Two things that look like they need a build and do not: the `*-about.html` pages are
committed source, so a full build on `main` leaves them untouched, and a track can measure the
deployed site directly rather than serving its own.

- **T56 four page-behaviour playtest faults, plus mud's STEP button** — the `/help` banner the home
  page refuses, the animal-root fallback drawn for a lamp and a cabinet, the empty mud food pill
  before PLAY, spider-fly direction pills that append when they should replace, and a STEP button
  for `mud-viz.mjs`. Also checks the adventure and spider-fly step buttons advance a whole turn.
  `sprites-viz.mjs`, `mud-viz.mjs`, `spider-fly-viz.mjs`, `adventure-viz.mjs`, `index.html`. Sonnet.
  Holds a build slot. Status: started.

- **T55 mudiii's camera look, the double-minted cell and its STEP button** — drag to look in POV and
  FOLLOW, two agents opening on one cell, and a STEP button that advances one whole turn.
  `mudiii-scene.mjs`, `mudiii-viz.mjs`, the roster mint. Top tier. Holds a build slot.
  Status: started.
- **T60 INF-4's chain bound and its pins** — raise `maxHops` at both chat call sites and flip the 30
  pinned ceiling rows in the same commit, then re-run the bench. `chat.mjs`, `syllogise.mjs`, the
  INFBENCH generator. Top tier. Status: started.
- **T61 `run the impact of <file>`** — the tool name binds as a noun in an `of`-phrase. `ask.mjs`.
  Sonnet. Status: started.
- **T62 the deployed seed readiness race** — three `pages-timing` failures where the page reports
  ready with an empty store. `pages-ingest.test.mjs`, `pages-chat-export.test.mjs`,
  `pages-service-worker.test.mjs`, `ingest-viz.mjs`. Top tier. Status: started.
- **T41 prey sweep and status refresh** — one regime at a time after the sandbox killed its
  concurrent sweeps; `STATUS.md` prioritised over further sweeping. Sonnet. Status: started.

## Open items

### Found by playtest and benchmark, not yet fixed

- **The deployed pages report ready before their seed is in.** Job `e2e:deployed:pages-timing` on
  pipeline 2725564857: 34 tests, 31 pass, 3 fail. `pages-ingest` reads a starter-memory total of 0,
  `pages-chat-export` finds no `dog is a kind of animal` turn, and `pages-service-worker` gets
  `I don't know "dog" yet` from a page whose seed holds it.
  **These are not timeout failures.** The job already runs at `--test-concurrency=1`. The three files
  carry a 30s ready budget and 20s answer budgets, and all three failures landed in **under 2.4
  seconds** — 627ms for ingest. Nothing came near a budget, so raising one changes nothing.
  The tests do await the readiness promise (`pages-ingest.test.mjs:74`-`:77` does `goto`, then
  `waitForFunction` on `window.tmctIngestReady`, then `await page.evaluate` of it). The diagnostic
  already in the test reports **no console errors and no failed requests**. So the page said ready,
  every asset loaded, and the store was empty.
  **The refusal itself is correct, and this is not an honesty fault.** Operator's ruling: "the answer
  is not wrong. If the graph does not know what a dog is at the time that it is asked then it doesn't
  know. We are loading more data so we can be helpful and inform the user but there is no single
  state, the graph is a moving state." A miss is honest at the moment it is given, and the graph
  growing afterwards does not make it retrospectively a lie. So there is no "ready" boundary to build
  and nothing to gate the input on.
  **Tier:** top. **In flight** as T62.
  **Do:** two separate things. On the product side, an indicator that reports real load state read off
  the actual load — is it loading, has it loaded, and how far along as a percentage if a true number
  is available. `Content-Length` against streamed bytes is the likely source; a service-worker cache
  hit and any post-download parse phase both change what it means, so check rather than assume. On
  the test side, wait for the same loaded signal before asserting on seeded content — a
  test-correctness fix, not a product contract, and not a bigger budget.
  **The percentage is real or absent.** No timer-driven bar, no interpolation against an expected
  duration. A guessed percentage is the same fault in a progress bar that a guessed answer is in the
  chat. With a real signal nobody has to measure a window and guess a timeout, so the timing
  measurement stops being a design input and is only worth reporting.
  **Risk:** the cheap move is a longer budget or a retry, which turns a red test green while leaving
  it asserting against a store that has not finished arriving.

- **Two agents are minted on one cell.** `goblin-1` and `goblin-2` both open on `cell-14-14` in the
  chapel yard, while `blockedCellReason` treats a single agent as enough to block a cell. Found while
  diagnosing an unrelated e2e failure, and not on its path.
  **Tier:** Sonnet.
  **Do:** decide which is right — a mint that refuses to stack, or a blocked-cell rule that tolerates
  it — rather than patching whichever is nearer. `seededRoster` filters `taken` and then falls back
  to the unfiltered cell list, which is the likely route to a collision.

- **23 further playtest findings.** In `reports/PLAYTEST_DEMO_PAGES.md`, grouped by page.
  **Fixed so far:** the ingest-about page claiming a preloaded sample it does not ship, the share
  sheet's hard-coded post count, and the ledger focus crumb printing the whole typed question.
  **The about-page overflow is fixed**, all eleven pages at 375px, 320px and 1440px, with a guard at
  `test-e2e/pages-about-overflow.test.mjs` (22 tests). The cause was `site.css`'s bare `main {
  margin: 0 auto }` rule, meant to centre a lone `<main>` on the other demo pages. Auto margins on a
  grid item turn off Grid's default stretch and fall back to shrink-to-fit, so the column grew to its
  own min-content width — set by an unbreakable file path inside a `<code>` tag, up to 448px on
  `plan-about`. Clamping the track to `minmax(0, 1fr)` was necessary and not sufficient: it
  constrains the track, and the bug lived in the item.
  **Still open, all page behaviour:** the home page advertises `/help` in its own banner and refuses
  it; sprites draws the animal-root fallback for a lamp and a cabinet whose templates both exist;
  the mud food pill is empty until you press PLAY; spider-fly direction pills append rather than
  replace, so a second click builds an unparseable sentence.
  **Tier:** Sonnet. **Queued behind T54's build slot**, not unowned — see the in-flight block.
  **Not covered by that playtest:** the p2p handshake past minting an invite, file-upload paths, the
  four sprite group pages, ingest's Document mode, and reduced-motion behaviour. **In flight** as
  T57, against the deployed site so it needs no build slot.

- **`run the impact of <file>` parses as a reverse-calls question about a file called "impact".**
  Surfaced by the router track, which reproduced it and correctly did not fix it: the object binds as
  `"impact app/lib/a.mjs"`, so nothing resolves and the chat refuses with an ambiguous-meta-goal
  message. The refusal is honest, so this is comfort rather than a broken promise, but "run the
  impact of X" is the phrasing the tool's own help suggests. It lives in `ask.mjs`'s grammar, which
  the router track did not own. Genuinely a different subsystem from the router items that surfaced
  it, so it is written here as its own item rather than as their remainder.
  **Tier:** Sonnet.
  **Do:** teach the grammar that `impact`, and the other tool names the help text uses, are verbs in
  an imperative frame rather than nouns in an `of`-phrase.
  **Risk:** widening a lane can capture sentences another lane owns. The corpus tests are where that
  shows.


- **Every demo page with PLAY needs a STEP button that advances one whole turn.** Operator request.
  Three pages already have one and are the pattern: `plan-viz.mjs:452` (`step ▶`),
  `adventure-viz.mjs:1012` (`stepBtn`, wired to `ticker.stepOnce()` at `:1884`, disabled while
  playing at `:1868`) and `spider-fly-viz.mjs:458`. The two missing it are `mud-viz.mjs`, whose play
  control is `autoToggle`, and `mudiii-viz.mjs`.
  **Tier:** Sonnet for mud, top tier for mudiii. **In flight**, folded into T56 and T55 respectively
  since they already own those two files.
  **Do:** one whole turn means every agent acts once, not one agent's single move. The check is that
  the turn counter reads exactly one higher after a click. T56 also checks the adventure and
  spider-fly buttons against that reading and fixes either if it steps a fraction of a turn.
  **Risk:** stepping during autoplay is meaningless, so the button disables while playing, the same
  way FOLLOW does.

- **Reset should leave every page paused.** Operator request. Opening a page keeps its autoplay; only
  reset changes. The shared `createTicker.reset()` (`viz-ticker.mjs:98`) already clears `playing`
  before calling `onReset`, so adventure (`adventure-viz.mjs:1885`) and spider-fly
  (`spider-fly-viz.mjs:1135`) inherit it. Two pages bypass the ticker: `mud-viz.mjs:2924` calls
  `boot()`, which re-runs the whole opening path, and `mudiii-viz.mjs:1510` calls `resetBoard()`.
  `plan-viz.mjs:449` has its own reset outside the ticker too.
  **Tier:** Sonnet. **In flight**, folded into T56 (mud, plan, and verifying the two ticker pages)
  and T55 (mudiii).
  **Do:** the check is the same on each page — play, run a few turns, reset, and confirm the board is
  seeded and not advancing. A PLAY button still reading "pause" over a stopped board is the same bug.

- **mudiii should open following a goblin, and cut to overhead when it is eaten.** Operator request,
  and the reasoning is the spec: "I like that we get a crazy run through then it gets eaten and we
  see a more sedate overhead view to what it play out." So autoplay-on-open sets FOLLOW and picks a
  goblin, and when the followed agent leaves the board the camera drops to OVERHEAD and keeps
  playing — no stop, no second goblin, no camera stranded on a dead agent.
  **Tier:** top. **In flight** as T55.
  **Do:** decide and record what happens when the followed agent leaves for a reason other than being
  eaten, whether the cut lands on the death tick or one after (one after, so the visitor sees the
  moment rather than cutting away from it), and whether the same fallback applies when a visitor has
  chosen FOLLOW themselves mid-session.
  **Risk:** FOLLOW disables while playing, with a "pause to swap" hint. Opening in FOLLOW while
  autoplaying shows a disabled follow control on a page that is following something, so check the
  hint explains that rather than confusing it.

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

- **A chat turn got much heavier since 3.0.3, and the likely cause is now fixed but unconfirmed.**
  The inference bench took roughly 25 minutes wall-clock for its double replay against about 4.5
  minutes for the whole 3.0.3 cycle, while the case pool grew only 5%.
  **The candidate:** `findIsaChain` rebuilt its adjacency index over the whole subClassOf edge set on
  every call, and `shortestChainTo` in `src/domain/memory/capability.mjs` is called once per
  candidate row from `chat.mjs`, so the pair was nested quadratic. Threading a prebuilt successor
  index through took a 63,470-row store from a 1054-second freeze to 577ms, and the corpus tier from
  145s to 54s.
  **What is still open:** nobody has re-run the inference bench since. The 25-minute figure stands
  until a fresh cycle replaces it.
  **Tier:** Sonnet. **In flight** as T60, which re-runs the bench for its own reason and will
  produce the number as a side effect.


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
