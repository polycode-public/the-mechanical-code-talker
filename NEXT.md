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

- **T49 the chat freeze and the CLI comfort items** — landed and merged, then broke five tests on
  `main`. Four in `code-explorer-browser-entry.test.mjs`: real questions over a real code graph stop
  parsing, so a lane change moved where a code-shaped question lands. One in `ui-context-miss.
  test.mjs`: the count decline dropped its CLI remedy for every surface, where the test pins keeping
  it for the CLI and dropping it only for a page. `main` is red and unpushed until both are fixed.
  Status: resumed on the regressions.
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
  **Tier:** top. **In flight** as T62.
  **Do:** find what the readiness promise actually waits for, and measure whether a real visitor hits
  the same window on a cold CloudFront hit. If chat.html refuses a fact it holds for a second after
  load, that is a user-facing honesty failure rather than a test flake. `.gitlab-ci.yml:647`-`:651`
  says the seed is ~93MB, which if true is the centre of this.
  **Risk:** the cheap move is a longer budget or a retry, and it would turn a red test green while
  leaving a page that lies about what it knows.

- **Five tests fail on merged `main` after the chat-freeze track landed.** Four in
  `test/adapters/code-explorer-browser-entry.test.mjs` (`:81`, `:98`, `:105`, `:121`) — the engine
  stops parsing questions it used to parse, and one asks for `['Task.title']` and gets `[]`. One in
  `test/services/ui-context-miss.test.mjs:49` — `answerCount`'s empty-graph miss now drops the
  `tmct index` remedy on every surface, where the test pins keeping it for the CLI and dropping it
  only for a page. The suite reads 6031 tests, 6026 pass, 5 fail.
  **Tier:** top. Same track that caused it, resumed with its own context.
  **Do:** find the real cause of the four rather than assuming a lane; the likely movers are the
  `define dog` vocabulary read after the code lane misses, and the held-back index-this-repo nudge.
  For the fifth, decide whether the remedy belongs on the CLI and restore it there.
  **Risk:** `main` cannot be pushed while these are red, so every other track's merge queues behind
  this one.

- **A plain English question locks the tab for seventeen minutes.**
  `who is the president of France` on chat.html froze the page for a measured **1054 seconds** before
  printing the correct refusal. A CPU profile puts 99% of self time in `findIsaChain`
  (`syllogise.mjs:1715`), reached from `relationFactsFor` (`chat.mjs:9141`-`:9156`), which walks all
  63,470 seed rows and runs a BFS per row. The trigger is the shape `<wh> is the <relation> of
  <thing>` — `what is the capital of Peru` and `who is the queen of England` freeze; `the capital of
  Peru` and `who is the president` answer in under 5s. The same lane freezes ingest, research and
  code. Transcript and profile in `reports/PLAYTEST_DEMO_PAGES.md`.
  **In flight** as the CLI track's new first item.
  **The refusal is correct; the cost of reaching it is not.** Do not make it answer.
  **Related:** a benchmark measured the same cycle at ~25 minutes against ~4.5 for an earlier
  version, with the case pool only 5% larger. This may be the same cause.

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
