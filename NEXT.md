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

Four tracks. The mudiii page files came free when the seven-item batch landed, so they were refilled
the same turn rather than left idle — concurrency here is bounded by file ownership, not by batch
cadence.

- **T35 prey scoring** — the weighted evade/forage blend plus the comparison harness that can tell it
  from the priority chain. `predator-prey.mjs`, `agent-belief.mjs`, a new `scripts/` sweep. Top tier.
  Status: started.
- **T38 the mudiii page remainder** — thirteen items across `mudiii-viz.mjs` and `mudiii-scene.mjs`:
  both pill rails, the map panel's grid/key/aspect, the belief panel, EDIT mode, agent labels,
  click-to-turn and the directional ring, the compass ring, the eat-flourish hold, the teach
  checkbox, the eyebrow adoption, the stale headers, and the recast callers. One owner, in order,
  because that file is the bottleneck and parallel edits to it cost more than sequencing saves. Top
  tier. Status: started.

Not dispatchable: the CI-verification items wait on a pipeline, and `smoke:deploy`'s probe needs a
real deploy.

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

- **The deception rail is not on the page.** `pillsForMudiii` is fully implemented and unit-tested
  in `src/services/mudiii-turn.mjs`: address pills, true/false claim pairs, a point-reflected false
  cell, the food channel gated to prey addressees, grid-size aware. Nothing calls it outside its own
  test. It is not exported through `src/surfaces/web/mudiii-browser-entry.mjs`, not spliced into
  `pageScript()`, and `renderChatPills` builds its own two-pill list instead.
  **Tier:** Sonnet. Three files, one working pattern to copy, no new logic.
  **Do:** add `pillsForMudiii` to the `page` bag in `mudiii-browser-entry.mjs:221`, beside
  `pickMudiiiRoster`, the way `spider-fly-browser-entry.mjs:61` and `:221` do it. Replace
  `renderChatPills`'s body (`mudiii-viz.mjs:948`) with
  `tmct.page.pillsForMudiii(agentsById, itemsById, selectedAddresseeId, { gridSize: gridSizeOf() })`.
  Add `let selectedAddresseeId = null;` beside `livePills` (`:845`) and write back
  `result.addresseeId` each call, as `spider-fly-viz.mjs:1038` does. Render address pills as
  `data-role="dyn-addr"` with no `data-command` (they switch mode, and `pill-complete.mjs:268` only
  scans `[data-command]`), and claim pills as `data-role="dyn-claim" data-truth="true|false"` with
  `data-command` set to the sentence.
  **The operator's decision on clicking a pill:** a single click **appends** the pill's text to
  whatever is already in the input, with a separating space and the caret at the end. Pills compose
  that way: click `look at`, then click `the book`. Return submits. A double-click appends and
  submits in one gesture. This differs from every other pill rail in the repo — adventure
  (`adventure-viz.mjs:1537`) and mud both assign `chatqEl.value = btn.textContent`, replacing what
  was typed. Do not copy that line; write the append.
  **Feasibility:** `pillsForMudiii` is not `.toString()`-splice safe. It closes over `agentKindOf`,
  `liveIdsOfKind`, `parseCellId`, `cellId`, `oneStepDirectionBetween` and `MUDIII_ROLES` from two
  other modules, so the `tmct.page` bag is the only route. Needs `gridSizeOf()` from the grid-size
  item.
  **Risk:** `test/services/mudiii-viz.test.mjs:265` pins the literal rendered string
  `'<button type="button" class="pill" data-command="' + esc(p.command)`. Any rewrite breaks it.
  **Mitigation:** rewrite that test to assert `data-command` is present on claim pills rather than
  pinning one concatenation. In the e2e, click a claim pill and assert the chat log carries a line
  of `MUDIII_TOLD_RE`'s shape and that the answer is not the decline text.

- **True/false claim pills have no CSS.** `MUDIII_STYLE` carries only `.pill`, `.pill:hover`,
  `.pill.affordance` and `.pill.affordance[aria-pressed]`. No tick or cross glyph, no taught-green
  border, no dashed alert border. The `truth` field the pill builder returns has no consumer.
  **Tier:** Haiku alone, Sonnet landed with the deception rail, which is where it belongs.
  **Do:** add four rules after `.pill.affordance[aria-pressed="true"]` (`mudiii-viz.mjs:769`),
  copying `spider-fly-viz.mjs:392`-`:395`. `--taught` and `--alert` come from `THEME_TOKENS_CSS`
  (`src/services/viz-theme.mjs:72`), which mudiii.html already includes at `:476`. Put the glyph in
  `::before` so the submitted sentence never carries the tag.
  **Risk:** low. The selectors match nothing until the rail lands. No test asserts `MUDIII_STYLE`'s
  content today.
  **Mitigation:** same commit as the rail, then check the screenshot.

- **The chat pill rail offers commands the lane cannot read.** It emits `look` and `@<id> look`.
  `look` is in none of the lane's regexes, and `@fox-1 look` matches the address lead but not the
  told-fact pattern, so it returns "I heard you address the fox but couldn't read a position from
  that". The same dead string is the chat input's placeholder. There is no tick pill either.
  **Tier:** Sonnet. Needs the lane's real verb list.
  **Do:** the verbs `mudiii-turn.mjs` parses are `tick`/`next turn`/`advance` (`MUDIII_TICK_RE:70`),
  `put food at cell-3-4` (`:99`), `drop a morsel at cell-3-4` (`:100`), `@fox the goblin is east`
  (`MUDIII_TOLD_RE:81`), `what does the fox see` (`:89`), `where is the goblin` (`:488`), `what can I
  do` (`:490`), `what is the fox's goal` (`:491`), `stop watching` (`:66`). Seed `renderChatPills`
  (`:948`) with `tick`, `what does the fox see`, `where is the goblin` and `what can I do`, then
  append the rail's dynamic pills. Drop the `@<id> look` loop. Change the placeholder (`:587`) to
  `@fox the goblin is east`.
  **Feasibility:** leave `#foodPill`'s `data-command="place food"` (`:538`) alone. It is never
  submitted, its listener at `:973` only toggles `foodArmed`, and it sits outside `#chatPills`.
  Don't add a `put food at …` pill; that verb needs a cell, and click-to-place is how you supply one.
  **Risk:** same pin at `test/services/mudiii-viz.test.mjs:265`. Nothing clicks a pill in the e2e
  today, which is why a dead pill shipped.
  **Mitigation:** add an e2e that clicks every button in `#chatPills` and asserts no answer contains
  `couldn't read a position` or the generic chat decline.

- **The 2D map panel has no grid, draws no props, and is not square.** `.map-panel-board` is a flat
  tinted rectangle with absolutely-positioned dots for agents and food. The plan specifies the grid
  plus one dot per live agent, and a square whose buildings are invisible cannot be read against the
  3D view. `mapDotsFor`'s own doc comment (`mudiii-viz.mjs:311`) says "within a square panel" and the
  panel is not square, so every dot is stretched. It is also hidden under `body.editing`.
  **Tier:** Sonnet. One new pure function, one CSS block, one render change.
  **Do:** add `mapBlocksFor(props, gridSize)` beside `mapDotsFor` (`:319`), exported and pure,
  returning `{ id, xPct, yPct, sizePct }` per prop cell and dropping any placement with no parseable
  cell. Use `- 1` rather than `mapDotsFor`'s `- 0.5`: a dot is centred on its cell, a block fills it.
  Splice it in beside `mapDotsFor` (`:808`) and draw the blocks before the dots in `renderMapPanel`
  (`:1029`) so dots sit on top. Add `aspect-ratio: 1` to `.map-panel-board` (`:687`), draw the cell
  divisions with two `repeating-linear-gradient`s stepped by a `--map-cell-pct` custom property that
  `renderMapPanel` sets from `gridSizeOf()`, and remove `body.editing .deck-row .map-panel` from the
  hide list (`:718`). Edit mode is where a visitor moves a prop, and the map is the only place that
  move shows until the scene reboots.
  **Feasibility:** `props` is already a page-level binding set in `boot` (`:1212`) from
  `propPlacementsFrom`, so no new plumbing. Needs `gridSizeOf()` from the grid-size item.
  **Risk:** showing the panel in edit mode meets `body.editing .deck-row { grid-template-columns:
  1fr; }` (`:719`), which stacks the map under the deck; check the narrow breakpoint at `:771`.
  `aspect-ratio: 1` changes the deck row's height. `test-e2e/pages-mudiii.test.mjs:142` counts
  `.map-dot` and is unaffected by added `.map-block` spans.
  **Mitigation:** unit-test `mapBlocksFor` the way `mapDotsFor` is tested at
  `test/services/mudiii-viz.test.mjs:466`, including an unparseable cell. Assert in the e2e that
  `#mapPanelBoard .map-block` counts the scenario's prop rows. Screenshot both breakpoints.

- **The HUD belief panel is not expandable.** It renders as a single always-on
  `<p class="hud-belief">` line, not the collapsible panel the plan specifies. A goblin's belief map
  grows with the cast, so the line itself grows unboundedly.
  **Tier:** Sonnet. Markup plus disclosure state, against a working pattern.
  **Do:** in `agentCardMarkup` (`mudiii-viz.mjs:405`) wrap the belief line in a
  `<button class="hud-belief-toggle" aria-expanded aria-controls>` and add a sibling
  `<div class="hud-detail" hidden>`. Keep the `${w}-belief` id so `renderHudRow`'s summary write
  (`:1020`) still lands. Keep an `expandedAgents` Set in `renderHudRow` (`:1002`) the way
  `spider-fly-viz.mjs:834` does, fill the detail div from `believedFactSentence` (exported at
  `mudiii-turn.mjs:402`, splice-safe by design, and the same function the chat lane renders
  "X sees: …" from), and delegate click on `#hudRow` copying `spider-fly-viz.mjs:853`-`:863`. A
  `<button>` gives Enter and Space for free. Cap the summary line at three entries plus a count.
  Tokenize the CSS to this page's palette; spider-fly's `--chrome-*` tokens are not defined here.
  **Feasibility:** `renderHudRow`'s card-reuse guard (`:1005`) only rebuilds `row.innerHTML` when
  the card count changes, and card slots are positional while agents re-bind by sorted id. Key
  `expandedAgents` on the agent id and re-apply every render, never stash state in the DOM.
  **Risk:** `test/services/mudiii-viz.test.mjs:534` pins `agentCardMarkup`'s whole markup and
  breaks. That is the direct test for the function being changed, which is the right place to fail.
  **Mitigation:** e2e that clicks a belief toggle, asserts `aria-expanded` flips and the detail div
  loses `hidden`, then plays two ticks and asserts the expansion survived. That last assertion
  catches the id-versus-slot mistake.

- **EDIT mode is missing two pieces of mud.html's editor.** `#editorPills` is in the markup and
  `pillCandidates`/`matchPills` are spliced into the page script, but nothing populates or wires
  them, so the pill rail is dead markup. And an edit never re-boots the 3D scene, so moving or
  deleting a prop changes the facts and the side panel while the mesh stays put until a Reset.
  **Tier:** Sonnet. Two bounded copy jobs against a working sibling.
  **Do:** copy `mud-viz.mjs:2011`-`:2029` (`renderSuggestionPills`), `:2031`-`:2043` (the
  `editorPills` click handler) and `:2071`-`:2080` (`onEditorChanged`) into `mudiii-viz.mjs`. Add
  `wordBeforeCursor` to the existing `viz-theme.mjs` import and splice it into `pageScript()` beside
  the other splices. Replace the current single `el("editorText").addEventListener("input",
  scheduleSync)` with the `onEditorChanged` combinator and call `renderSuggestionPills` once in
  `enterEditMode()`. For the reboot half, in `applyEditorText()` (around `:1174`-`:1193`) reassign
  the outer `props` from `propPlacementsFrom(editRows, DATA.assetManifest)` (the same binding
  `blockedCellReason` reads) and re-issue the `callScene("boot", …)` call `boot()` makes at `:1219`.
  **Feasibility:** `mudiiiScene.boot()` (`mudiii-scene.mjs:701`-`:717`) clears `agentGroups` and
  `itemMeshes` and does not repopulate agents; only `applyTick` does. Auto-play is paused in edit
  mode, so agent meshes vanish until "back to playing" ticks. Follow the boot with a
  `callScene("applyTick", …)` built from the page's still-current `agentsById`/`itemsById`, which a
  prop edit does not change.
  **Risk:** `boot()` also resets the camera to overhead (`mudiii-scene.mjs:715`), so every debounced
  450ms sync would silently discard the visitor's chosen camera mode. That is worse than the bug.
  **Mitigation:** re-apply `callScene("setCamera", camera)` right after the boot, and add an e2e
  that edits a prop's cell, waits for the synced status, and asserts the camera mode survived.

- **`smoke:deploy`'s new `mudiii.html` probe has not run against a real deployed URL.** The probe
  itself has landed: `mudiiiPage()` in `scripts/post-deploy-smoke.mjs` fetches `mudiii.html`
  relative to `PAGES_URL` and asserts both `res.ok` and a present `content-encoding`, registered in
  `checkOnce()` and folded into the `ok` boolean.
  **Tier:** Haiku, and it is a run rather than an edit.
  **Do:** run `npm run smoke:deploy` once after the next real deploy and confirm the `mudiii` row
  reports an encoding rather than an error. A wrong path is the only way this fails, and nothing
  local can tell you.
  **Risk:** none. No sibling probe is unit-tested; don't invent a test where the others have none.

- **The map has no key.** Dots are coloured by role and nothing says which colour is which.
  **Tier:** Haiku.
  **Do:** add a legend block inside `.map-panel` after `.map-panel-board` (around
  `mudiii-viz.mjs:550`) naming predator, prey and food, plus a small `.map-panel-legend` CSS block
  near the existing `.map-dot*` rules (`:688`-`:691`). The tokens already exist:
  `--square-predator` and `--square-prey` at `:611`.
  **Risk:** `.map-dot` is `position: absolute` with a negative centring margin (`:688`), so reusing
  the class in a static flow row makes the swatches position against `.map-panel-board` and vanish.
  **Mitigation:** use plain inline-block swatches carrying the same background custom properties.
  A Playwright `boundingBox()` assertion for non-zero swatch size catches the trap directly.

- **Agents carry no label in the scene or on the map.** Nothing on the board says which goblin is
  which; the id only exists in the HUD card.
  **Tier:** Sonnet. The map half has a precedent; the 3D half has none in-repo but is standard.
  **Do:** on the map, `mapDotsFor`/`renderMapPanel` (`mudiii-viz.mjs:319`-`:337`, `:1029`-`:1035`)
  already stamp `title="${esc(d.id)}"` as a hover tooltip. Add a sibling `<span class="map-label">`
  at the same `left`/`top` percentages, offset a few pixels, using the same absolutely-positioned
  pattern `.map-dot` uses (`:688`). In the scene, in `ensureAgent` (`mudiii-scene.mjs:570`-`:597`),
  draw the id to a canvas, wrap it in a `THREE.CanvasTexture` and `THREE.SpriteMaterial`, and add
  the `THREE.Sprite` as a child of `entry.group` at `targetHeight + 0.3`. Parenting it to the group
  means it tracks the tween for free; a sprite billboards to the camera with no facing math.
  **Feasibility:** set `sizeAttenuation: false` so labels stay a constant screen size regardless of
  camera distance. Decide the scale explicitly rather than taking three's default.
  **Risk:** a canvas texture per agent is cheap at this roster size, consistent with the file's own
  note at `mudiii-scene.mjs:565`-`:569`.
  **Mitigation:** the existing "3D scene canvas boots without a console error" e2e
  (`test-e2e/pages-mudiii.test.mjs:152`) is the practical check. Label legibility is not
  unit-testable; don't force it into one.

- **Clicking a cell does not turn the followed agent.** `window.mudiiiHandleSceneClick`
  (`mudiii-viz.mjs:991`-`:999`) early-returns unless `foodArmed`, so an unarmed click does nothing
  at all today.
  **Tier:** Sonnet.
  **Do:** add an unarmed branch that faces `camera.selectedId` toward the clicked cell. Get the
  direction from `oneStepDirectionBetween` (imported into `predator-prey.mjs` from
  `town-square-world.mjs:36`) if it is reachable client-side, or compute the cardinal from `(dx, dz)`
  using that function's own tie-break convention. Write it through the hand-facing predicate the
  drive-by-hand item introduces, so a clicked turn and a ring turn behave the same way and persist
  by the same rule.
  **Risk:** `applyAgentTick` (`mudiii-scene.mjs:614`-`:637`) sets `entry.group.rotation.y =
  yawForFacing(agent.facing)` unconditionally at `:625`, before the held/singleHop branch, so a
  same-cell facing update is already handled. Re-read that branch at implementation time rather than
  trusting this description.
  **Mitigation:** e2e that clicks an unarmed ground cell and asserts the followed agent's facing
  changed while `cellOf` did not, proving a turn rather than a move.

- **The ring of directional controls is not built.** The engine seam has landed.
  `session.driveAgent(agentId, direction)` returns a whole tick payload plus
  `driven: { agent, direction, accepted, from, cell, facing }`, so a press draws exactly the way a
  tick does. The exported `driveRequest(direction, { cell, facing })` resolves a press: `up`/`down`
  step along or against the facing and leave it alone, `left`/`right` turn ninety on the spot, the
  diagonals turn forty-five or a hundred and thirty-five, a cardinal steps and faces, an
  intercardinal turns. A refused press still spends the turn and that agent takes its own move.
  `mgx:driven-facing` holds while the agent stands still and is outranked by the planner's next step.
  **What is left is the page half**, which waits on `mudiii-viz.mjs`.
  **Tier:** Sonnet.
  **Do:** draw the ring around the view and call `driveAgent`. Land it with the click-to-turn item,
  which should write facing through the same predicate.
  **`clipForAction` has no `driven` key**, so a hand-walked agent falls to `idle` and slides without
  a walk cycle — `kindFor[action] || "idle"`. Add `driven: "walk"` in the same change.
  **Risk:** a press spends a turn and the whole board moves with it. The control has to read that
  way rather than as a free nudge.

- **Clicking a camera-mode button does nothing on the board.** There is no feedback tying the button
  to a place.
  **Settled:** this belongs to ground clicks, not to the camera buttons. FOLLOW / POV / OVERHEAD
  switch the camera and do nothing else. **Merge this item into the click-to-turn item above**: a
  click on a cell flashes it, draws a line from the followed agent, and has that agent plan a route
  there.
  **Tier:** Sonnet.
  **Do:** the buttons are `#cameraMode button[data-mode=…]` (`mudiii-viz.mjs:533`-`:537`), plain deck
  controls carrying no cell, and their handler (`:1058`-`:1064`) reads only `data-mode`. Leave them
  alone. Build the flash, the line and the route on the existing ground-click path.
  **Feasibility:** if the intent is a route preview on a ground click, the pathfinding half is fully
  groundable. Call `findActionPath` (`src/domain/planning.mjs:30`-`:61`) against the same
  `gridApplyActions(rows)` closure the engine uses, reachable client-side because
  `session.snapshot()` already exposes `rows`. `findActionPath` returns `null` on
  frontier exhaustion and `{ actions: [], states: [startState] }` when already at the goal.
  **Risk:** drawing a straight line from agent to target cuts through buildings, which is exactly
  what a board with obstacles must not show. Building the wrong reading of this item wastes the
  whole build; the two readings share almost no code.
  **Mitigation:** draw along the returned `states` sequence, never a straight line. When
  `findActionPath` returns `null`, decline visibly rather than drawing a route that does not exist,
  the same discipline `decide()` applies at `predator-prey.mjs:711`-`:721`.

### mudiii.html — further work

- **The map is far too large on a desktop window.** Seen live. `.map-panel`'s base rule is
  `flex: 0 0 50%; max-width: 50%` (`mudiii-viz.mjs:693`-`:698`), and a percentage has no ceiling, so
  on a wide browser the panel takes about 950px and the square board takes 950px of height with it.
  The controls sit in a thin column beside a vast empty gap, and the 3D scene is pushed far down.
  **The operator's decision: about a third of that**, and **mobile portrait and landscape are both
  approved as they stand** — do not touch the `max-width: 900px` rules.
  **Tier:** Haiku. One wide-viewport cap.
  **Do:** add a `min-width: 901px` query capping `.map-panel` near 320px wide, which gives roughly a
  300px square minimap. The base sets `flex: 0 0 50%`, so a `max-width` alone will not shrink it —
  the basis has to change too.
  **This also settles the square question:** keep `aspect-ratio: 1` on desktop, where there is room.
  The square-versus-fold tension is a landscape-phone problem only, and the existing
  `aspect-ratio: auto` override already handles it.
  **Mitigation:** screenshot all three sizes and open them. The two phone layouts must come back
  unchanged.

- **The eat flourish barely reads at a 220ms tick.** The flourish now plays on both sides, but the
  predator's clip fades in over 150ms and an attack animation runs several hundred ms, so the next
  tick fades it out before it finishes. A viewer sees the wind-up blending into whatever comes next
  rather than a legible bite. The 220ms default is the operator's own choice, so slowing the page
  back down is not the answer.
  **Tier:** Sonnet, and it is a pacing decision before it is code.
  **Do:** give the one-shot a floor — hold it for its own clip duration, or a fixed minimum around
  400 to 500ms, before the next tick's fade may start. That is a change to how a tick and an
  animation share time, so decide it deliberately rather than tuning a number until it looks right.
  **Risk:** a hold that blocks the ticker turns a visual flourish into a simulation stall. It has to
  hold the animation, never the turn.
  **Mitigation:** watch it. This is a screenshot-or-video item, not a unit-test one.

- **Prey decide by strict priority: evade beats forage beats wander.** A single score weighing
  predator distance against food distance would let a goblin take a crumb that costs it nothing,
  instead of abandoning food the moment anything is in view.
  **Tier:** top for the scoring function and the comparison; Sonnet can wire the flag afterwards.
  **Do:** the score is one weighted sum over the two rungs' existing distance terms,
  `w * chebyshevDistance(cell, predatorCell) - (1 - w) * chebyshevDistance(cell, foodCell)`,
  maximized, reusing `chebyshevDistance` and `bestOneStepBy`'s shape, so the new rung sits beside
  `greedyAway`/`greedyToward`. `w` is the one knob, in `DEFAULT_GAME_CONFIG.mudiii`, started at 0.5
  and tuned from the comparison. Build the comparison as a committed headless script: run
  `runTownSquareTick` over N fixed seeds (the layout name plus a seed index, the convention `seedKey`
  already uses), M turns each, once per mode, same starting roster. Survival is turns-until-starved-
  or-eaten per prey id, keeping the full per-seed distribution rather than only the mean.
  **Feasibility:** harder than the item implies. There is no existing benchmark harness for this
  engine to copy; the `benchmark-*` skills cover chat, inference and agent capability. The code
  change is a few hours; designing a comparison that answers the question is the real work.
  **Risk:** a blend that scores higher on survival by being more evasive everywhere validates the
  wrong hypothesis, and mushes the goal lines `PLAN_MUD_MUDIII.md` warns about ("mostly evading,
  somewhat hungry"). Nothing asserts goal-line readability today.
  **Mitigation:** measure a behavioural metric alongside survival, such as how often a prey forages
  while a predator is within N cells. Keep the priority chain as the shipped default and land the
  blend behind the flag, with the comparison script committed so a later session can re-run it.

- **There is no compass ring.** mud.html's `DIR_GLYPH` ring is the working version to copy.
  **Tier:** Sonnet.
  **Do:** copy the glyphs and the CSS positioning idiom from `mud-viz.mjs:1174` (`DIR_GLYPH`) and its
  `dir-pill` rendering (`:1710`-`:1715`), not the logic. mud's ring lights per available exit from
  `mgx:has-exit-*` facts; mudiii's is a single active glyph showing the followed agent's facing, the
  reading that makes sense on an open grid. The tick payload already carries `agents[id].facing`, one
  of four cardinals (`town-square-world.mjs`'s `DEFAULT_FACING`/`DIRECTION_DELTA`, no up or down on a
  flat grid). Mark the matching glyph active on every redraw. No facts, no engine change.
  **Risk:** drawing it for a despawned or unfollowed agent. Hide the ring when `followedId` is null,
  reusing the `nextCameraSelection` fallback status pattern.
  **Mitigation:** a screenshot check is enough; there is no new fact path to unit-test.

### Teach mode

- **The mudiii teach checkbox is not on the page.** The lane is built and gated on
  `gameConfig.mudiii.teach`, off by default. Five sentence families, every one a predicate
  `foldTownSquareState` folds, and nothing mints. Two one-line changes remain, both in files another
  track holds: `createMudiiiSession` takes a `getTeachEnabled` and passes
  `gameConfig: { ...DEFAULT_GAME_CONFIG, mudiii: { ...DEFAULT_GAME_CONFIG.mudiii, teach:
  getTeachEnabled() } }` through `buildExtraOptions`, and the deck grows the checkbox.
  **Tier:** Haiku.
  **Do:** copy `mud-browser-entry.mjs:158` and `mud-viz.mjs:415`. The hint must be the town square's
  own vocabulary — `The fox is at cell-3-4.` — not the manor's sentence.
  **Risk:** none beyond copying the wrong hint, which is the bug below.

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

- **Stale header comments in `mudiii-browser-entry.mjs`, `mudiii-viz.mjs` and `mudiii-scene.mjs`.**
  They say sibling modules "do not exist in every worktree yet"; all are on `main`.
  `mudiii-scene.mjs:46` additionally claims the three scene calls "are not yet wired into
  mudiii-viz.mjs". They are, at `mudiii-viz.mjs:886`, `888` and `1219`. `mudiii-viz.mjs:66` carries
  the same stale "must NOT be a top-level `await import()`" framing.
  **Tier:** Haiku.
  **Do:** convert the guarded dynamic imports to static top-level imports in all three files
  (`mudiii-browser-entry.mjs:34` is one) and delete the stale comments.
  **Risk:** converting without checking for a live cycle between these three files would reproduce
  the silent deadlock the teach-mode estate-guard item describes, this time for real. This item is
  exactly the case that guard would catch.
  **Mitigation:** grep both directions for a static cycle across the three files before converting.
  After, `node --check` each and load `mudiii.html` to confirm boot completes.

- **Nothing calls `recastTownSquare` yet.** The engine half landed: `recastTownSquare(memoryDir,
  { layout, epoch, … })` appends `worldEpochFact(epoch)` and re-mints the roster, and
  `startTownSquareGame`'s guard now compares the existing placement's epoch rather than its bare
  existence, with the roster's bootstrap facts snapshot-stamped so that guard has something to read.
  A test recasts a store that has already run five real ticks and asserts the roster matches a store
  opened straight onto that epoch. What is missing is the callers the recast was built for: Reset on
  mudiii.html still re-opens a whole session, and EDIT mode still cannot re-boot the scene cheaply.
  **Tier:** Sonnet. The engine side is done; this is page wiring.
  **Do:** call it from `boot()`'s Reset path in `mudiii-viz.mjs` instead of re-opening the session,
  and from `applyEditorText()` once the EDIT-mode item lands. Both sit in a file another item already
  rewrites, so land it with one of those rather than alone.
  **Risk:** an epoch bump the page does not track leaves `globalTurn` and the engine's own count
  disagreeing, which is the turn-counter item's territory.

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
