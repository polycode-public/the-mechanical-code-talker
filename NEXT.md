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

Nothing in flight.

## Open items

### mudiii.html — behaviour the plan specifies that is missing or half built

`PLAN_MUD_MUDIII.md` is the design of record and is marked BUILT AND DEPLOYED. These are the
gaps between it and the shipped page.

- **The deception rail is not on the page.** `pillsForMudiii` is fully implemented and
  unit-tested in `src/services/mudiii-turn.mjs` — address pills, true/false claim pairs, a
  point-reflected false cell, the food channel gated to prey addressees, grid-size aware.
  Nothing calls it outside its own test. It is not exported through
  `src/surfaces/web/mudiii-browser-entry.mjs`, not spliced into `pageScript()`, and
  `renderChatPills` builds its own two-pill list instead.
  **Do:** export it through the browser entry, splice it into the page script, and have
  `renderChatPills` call it every tick, the way `spider-fly-viz.mjs:1030` does.

- **True/false claim pills have no CSS.** `MUDIII_STYLE` carries only `.pill`, `.pill:hover`,
  `.pill.affordance` and `.pill.affordance[aria-pressed]`. No tick or cross glyph, no
  taught-green border, no dashed alert border. The `truth` field the pill builder returns has no
  consumer anywhere.
  **Do:** copy spider-fly's two rules, using `::before` for the glyph so the submitted sentence
  never carries the tag. Lands with the item above; neither is worth doing alone.

- **The chat pill rail offers commands the lane cannot read.** It emits `look` and `@<id> look`.
  `look` is not a mudiii verb. `@fox-1 look` matches the address-lead pattern but not the
  told-fact pattern, so clicking it returns the honest decline "I heard you address the fox but
  couldn't read a position from that". The same dead string is the chat input's placeholder.
  There is no tick pill either, though the plan names one.
  **Do:** replace the rail's contents with verbs the lane actually parses — `tick`, the food
  verb, and the real teach-frames from the deception rail above.

- **A chat teach-frame runs a real tick whose result never reaches the page.** `sendCommand`
  never calls `applyTickResult` or `callScene`, so an addressed teach-frame advances the engine,
  prints text, and leaves `agentsById` and `itemsById` stale. The 3D scene does not move and the
  HUD belief line does not change until the next deck-driven tick. Watching a lie land in the
  belief panel is the point of the teach frame.
  **Do:** route any chat turn that advances a tick through `applyTickResult`, the path the
  ticker already uses.

- **The page's turn counter diverges from the engine's.** `session.tick(k)` ignores the `k` the
  page passes; the engine counts its own `tickCount`. They agree only while nothing else
  advances a turn, which the item above breaks as soon as it is fixed.
  **Do:** read the turn off the tick result and delete the page-level counter.

- **Scenario grid size never follows the scenario.** `scripts/build-demo-site.mjs` builds each
  scenario as `{ label, worldPayload, agents }` with no `gridSize`, and `renderMudiiiHtml` reads
  `gridSize` from the first scenario only, so `DATA.gridSize` is 12 forever. On chapel (14x14)
  cells 13 and 14 render off the ground plane, map dots land past 100%, and a raycast click
  clamps to 12 so the two outer rows and columns cannot be clicked. On market (10x10) the board
  is drawn two cells too large. Both sides already accept the value — `renderMudiiiHtml` reads
  `opening.gridSize` and `scene.boot` takes `gridSize` — only the per-scenario value is never
  supplied or re-read on switch.
  **Do:** pass `gridSize` per scenario from the layout, and re-read it in the scenario-change
  handler.

- **The Players and Npcs sliders cannot reach their stated ranges.** The controls have the right
  ranges and defaults, but `pickRoster` slices from `scenario.agents`, which the site build
  derives from `layout.cast`. Town-square casts 1 predator and 3 prey, so setting predators to 4
  still yields 1 fox and the prey slider caps at 3.
  **Do:** mint additional agents when a slider exceeds the layout's authored count, using the
  engine's own seeded roster.

- **The eat flourish never plays, on either side.** `applyTick` runs the `lastItemsById` diff
  loop with `removeItem(id, false)` before `applyEcology`, so an eaten item's mesh is already
  gone when the `"consume"` branch runs and the scale-to-zero never fires. And there is no
  predator-side animation at all: `clipForAction` maps `eat-agent` to `attack`, the fox rig
  ships a real `Eating` clip, and `applyEcology` only calls `removeAgent(prey)`.
  **Do:** run `applyEcology` before the item-diff removal, and play the predator's clip on
  `eat-agent`.

- **Picking an agent after a despawn fallback does not resume follow.** `nextCameraSelection`
  correctly falls back to `{ mode: "overhead", selectedId: null }` with a naming status line,
  but the dropdown's change handler preserves `camera.mode`, so choosing a new agent leaves you
  in overhead until you press follow.
  **Do:** remember the pre-fallback mode and restore it when a new agent is selected.

- **The 2D map panel has no grid.** `.map-panel-board` is a flat tinted rectangle with
  absolutely-positioned dots; the plan specifies the grid plus one dot per live agent. It is
  also hidden under `body.editing`.
  **Do:** draw cell divisions from `gridSize` — a repeating-linear-gradient is enough.

- **The HUD belief panel is not expandable.** It renders as a single always-on
  `<p class="hud-belief">` line, not the collapsible panel the plan specifies. The card grows
  unboundedly with the cast.
  **Do:** copy spider-fly's `.hud-row.clickable` / `.hud-detail` disclosure markup.

- **EDIT mode is missing two pieces of mud.html's editor.** `#editorPills` is in the markup and
  `pillCandidates`/`matchPills` are spliced into the page script, but nothing populates or wires
  them, so the related-word pill rail is dead markup. And an edit never re-boots the 3D scene,
  so moving or deleting a prop changes the facts and the side panel while the mesh stays put
  until a Reset.
  **Do:** wire the editor pills against `mud-viz.mjs:2012`'s working version, and call the
  scene's `boot` after a successful `applyEdit`.

- **"Who put that there?" has no recognizer.** `placeFood` writes `mgx:placed-by player` with
  world-taught provenance, and the plan names grounding that question as the reason for writing
  it. No verb in `mudiii-turn.mjs` reads it back; the question falls through to the generic
  lanes.
  **Do:** add the recognizer, answering from the `mgx:placed-by` row.

- **`smoke:deploy` never fetches `mudiii.html`.** `scripts/post-deploy-smoke.mjs` probes
  `version.txt`, `vendor/wink.js` and one model's byte length. A deploy that dropped the page
  entirely would still pass, and `smoke:deploy` is the plan's own done-check for its final step.
  **Do:** add a probe fetching the page and asserting a 200 with a content-encoding.

- **Food items render as primitive spheres.** The KayKit cheese and apple models are excluded
  because no row in the source repo's register names a KayKit resource pack, so their terms are
  unrecorded rather than free.
  **Do:** download the three files from KayKit's own CC0 pack and record that as the source,
  which removes the ambiguity entirely.

- **The screenshot ready-check has a dead branch.** It waits on
  `window.mudiiiScene?.cells?.()` **or** `cellOf("fox-1")`. The scene surface exposes only
  `boot`, `applyTick`, `setCamera`, `cellOf` and `ready` — `cells()` does not exist, so that
  disjunct is always false. The check therefore only proves a mesh has *a* cell, never that it
  *moved*, which is what the plan's done-check asks for.
  **Do:** delete the dead disjunct and compare two `cellOf` reads across ticks.

- **The predator is a fox.** The code casts a fox throughout and always has. The plan doc has
  been aligned. Nothing in `src/` needs changing — the only remaining `wolf` strings in the tree
  are the river-crossing puzzle, the sprite catalogue, and the guard that blocks `wolf_basic`.
  **Do:** nothing further. Recorded so nobody re-opens it.

### mudiii.html — the plan's own alternatives, none of them out of scope

These were named in `PLAN_MUD_MUDIII.md` as considered or later. They are open work, not
closed decisions.

- **Further role pairs.** The engine is role-parameterized and the asset pipeline is "drop a CC0
  GLB in, map its clip names". No second pair has been cast.
  **Do:** pick one pair, add its two manifest rows and a roles object, and confirm no engine
  edit is needed. That is the claim the parameterization was built to make.

- **Food as common knowledge on spawn.** Food is vision-gated exactly like agents. The plan
  notes a variant where a crumb is known to everyone the moment it appears, which changes the
  foraging feel.
  **Do:** add it as a `DEFAULT_GAME_CONFIG.mudiii` flag, default off, so it can be tried without
  a code change.

- **A blended one-ply score for the prey's evade/forage decision.** The shipped chain is strict
  priority: evade beats forage beats wander. The plan considered one score weighing predator
  distance against food distance, and parked it because it needs new scoring machinery and
  tuning against a real board.
  **Do:** the board is real now. Build it behind a config flag and compare survival time against
  the priority chain over a fixed seed set.

- **Evade tie-breaking toward the nearest believed food.** When evading, several cells are often
  equally safe and the prey picks by seeded order. Breaking that tie toward food would let a
  fleeing goblin still make progress.
  **Do:** add the comparator in the evade scorer. Small and self-contained.

- **The compass ring.** The plan dropped it on the grounds that a free camera replaces it. It
  is wanted.
  **Do:** bring it back — mud.html's own `DIR_GLYPH` ring is the working version to copy. It
  needs a decision about what it points at on a grid with no rooms: the followed agent's facing
  is the obvious reading.

- **spider-fly migrating onto the shared engine.** MUDIII was built role-parameterized from day
  one specifically so spider-fly could move onto it, and spider-fly was left untouched to keep
  the regression surface small. It still has its own engine.
  **Do:** cast spider and fly as a roles object over `predator-prey.mjs`, keeping webs as the
  one genuine behavioural difference, and delete the duplicate.

### Teach mode

- **The UI half is unbuilt.** The engine half has landed: a declarative sentence is read as a
  fact against the live world, general semantics, world-scoped provenance, minting or moving
  depending on whether the world already answers to the subject. What is missing is the checkbox
  on adventure.html, mud.html and mudiii.html, its hint text (`Candle is in the study.`), and the
  route from the DOM to the turn call. `mudiii-viz.mjs` has no `teachToggle` at all.
  Relates to the mudiii item "Who put that there?" — both write player provenance nobody reads
  back.
  **Do:** one track covering all three pages, against the region-ownership table already written
  for the two viz files.

- **`QUESTION_LEAD_RE` is duplicated in `world-teach.mjs`** because it is private to `chat.mjs`.
  **Do:** move it to `src/domain/interpret/normalize.mjs`, beside `correctMisspellings`, and
  have both read it.

- **`world-teach.mjs` and `adventure.mjs` import each other.** The cycle is static and every
  binding crossing it is a hoisted function declaration, so it resolves. The danger is specific
  and known: converting either side to a top-level `await import()` turns the same cycle into a
  deadlock where both modules wait forever with no error. That is exactly what happened to
  `mudiii-viz.mjs` and `mudiii-scene.mjs` during this build.
  **Do:** add an estate test asserting neither file contains a top-level `await import()` of the
  other, so the failure is caught at the edit rather than at a silent hang.

### Predictive text

- **adventure.html's pill buttons carry no `data-command` attribute.** mud.html's already do,
  and `mudiii-viz.mjs` adopted `pill-complete` correctly, so only adventure is affected.
  Keyboard completion works; the rail highlight and `aria-activedescendant` wiring stay inert.
  **Do:** add the attribute in `pillsForRoom`'s render path.

### p2p

- **Retraction does not replicate.** `removeFacts` is a real local delete, reached by chat's
  `/retract` and by mud EDIT mode for the non-fold-versioned predicates. Those predicates are
  exactly the ones the sync filter replicates, and nothing broadcasts a removal, so over a mesh
  a retraction is undone by the next sync from any peer that still holds the fact.
  **Do:** a replicated summary record carrying the ids it absorbs, the shape `compaction.mjs`
  already uses, so absorption merges by union and stays a join.

- **The read-time resolver purity check is not written down where it will be read.**
  `foldWorldState` broke it once — it was not a pure function of the fact set — and was fixed
  from outside itself, by `p2p-room.mjs` sorting Fact individuals by content-addressed id after
  every merge. A resolver that reads a wall clock, a local counter, or array position passes a
  single-browser test and diverges on the mesh.
  **Do:** add the check to `CLAUDE.md`'s working model: any read-time resolver must be a pure
  function of the fact set, tested by feeding one peer's facts in two different orders and
  demanding the same answer.

### Pipeline

- **`e2e-web-index` and `e2e:deployed:shell` both fail on pipeline 2725071231 (4866f26d).**
  One cause: `public/index.html` now carries 11 claim blocks and 11 plates, and the e2e pins 10
  ("the feature sections repeat the claims in claim-grid order, plates numbered I to X").
  Adding mudiii's plate updated the estate guard's own list but not the e2e's separate count.
  jobs 15664444086 and 15664479225.
  **Do:** update the expected count and the plate-numeral range in the e2e, then re-run both
  jobs.

- **Stale header comments in `mudiii-browser-entry.mjs`, `mudiii-viz.mjs` and
  `mudiii-scene.mjs`.** They say sibling modules "do not exist in every worktree yet"; all are on
  `main`. `mudiii-scene.mjs:47` additionally claims the three scene calls "are not yet wired into
  mudiii-viz.mjs" — they are, at `mudiii-viz.mjs:886`, `888` and `1219`.
  **Do:** make the guarded dynamic imports static and delete the comments.

- **The engine ships no recast, so Reset re-opens a whole session.** That works for an in-memory
  store owned by one visitor, but `PLAN_MUD_MUDIII_SHARED.md` needs a recast for epoch bumps,
  and an EDIT-mode change that must re-boot the scene would be cheaper with one.
  **Do:** add `recastTownSquare` now — append a world-epoch fact, re-mint the roster at the new
  epoch — so the epoch path is exercised before p2p depends on it.

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
