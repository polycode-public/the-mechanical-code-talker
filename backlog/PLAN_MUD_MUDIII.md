# PLAN_MUD_MUDIII.md — MUDIII, a three.js town square over the spider-fly planning engine

Status: shipped. `mudiii.html` is deployed alongside https://tmct.polycode.co.uk/mud.html and
probed by `smoke:deploy`, which checks the page, the vendored three build and a model's served
byte length. What the build delivered is in `git log` and in the files below; this document is
what still binds and what is still open.

One page. A three.js town square where a fox hunts goblins, each planning for itself over the
same fact-graph memory every other demo uses, with vision-gated belief. Under the 3D view sits
the ordinary chat surface: the game stays text-addressable, the canvas is a view of fact rows,
and everything the visitor does lands in the store as facts. A visitor watches, advances turns,
walks one animal by hand, asks the animals what they see, feeds them true or false positions,
and places food.

Sibling phases have their own documents: `PLAN_MUD_MUDIII_SHARED.md` (the share/join P2P layer),
`PLAN_MUD_MUDMMORPG.md` (the online phase). `PLAN_MUD.md` keeps the shared origin and indexes
them. `mudiii.co.uk` is the eventual public URL and was unregistered as of 2026-07-30.

## Where the parts live

| piece | file |
|---|---|
| the world: three layouts, props as facts, self-describing board rows | `src/domain/town-square-world.mjs` |
| the tick engine: fold, believe, decide, move, ecology pass | `src/services/predator-prey.mjs` |
| the cast's knobs, keyed by role | `src/domain/game-config.mjs` (`DEFAULT_GAME_CONFIG.mudiii`) |
| the chat lane | `src/services/mudiii-turn.mjs` |
| the page shell: deck, HUD, map panel, chat, drive ring, edit mode | `src/services/mudiii-viz.mjs` |
| the three.js scene: models, cameras, tweens, raycast, look-drag | `src/services/mudiii-scene.mjs` |
| the browser seam: `driveRequest`, `routeBetweenCells`, the session API | `src/surfaces/web/mudiii-browser-entry.mjs` |
| the asset allowlist and its guards | `data/mudiii-assets.json`, `scripts/check-model-manifest.mjs`, `scripts/gen-model-credits.mjs` |
| the vendored three build | `scripts/build-three-vendor.mjs` → `public/vendor/three.js` |
| the frozen tick payload | `test/fixtures/mudiii-ticks.json` |

## The decisions that still bind

- **The cast is data, not code.** `MUDIII_ROLES` is a plain roles object and every engine entry
  point takes one; the knobs in `DEFAULT_GAME_CONFIG.mudiii` are keyed by role, never by species.
  spider-fly runs on the same engine with its own roles object and `food: null`. A new pair is a
  roles object plus manifest rows, with no engine edit. Carrying a catch to a web, spinning webs
  and laying eggs are opt-in features of the shared engine, and the town square switches none of
  them on.
- **Buildings are topology, not collision code.** The world generator omits `mgx:has-exit-*`
  edges both out of and into a prop's cell, so the planner routes around a building the same way
  it already respects the board edge. Grid size is a property of each layout, never a module
  constant: the three shipped boards run 12, 10 and 14.
- **Grid movement is hand-written over the world's own exit facts.** `gridApplyActions` reads
  `mgx:has-exit-*`; `compileDomain`/`movesFromRules` stay the plan lane's tool.
- **Belief is vision-gated for items as well as agents.** A goblin must see a crumb, or be told
  about it, before it will path to it. `foodVisionGated` can turn that off; on is the default
  because common-knowledge food sends every scavenger beelining across the square and kills the
  foraging feel.
- **Goblins cannot tell world crumbs from player morsels.** The forage read walks the `food`
  class chain, so the two compete on distance alone. Placing food beside a lurking fox is a
  working trap, and nobody wrote a trap mechanic.
- **Who preys on whom is in the cast, not in the branch.** Each role carries a `hunts` link, and
  the decision reads it both ways: an agent's threats are the agents whose role hunts it, its
  quarry the agents of the role it hunts. Nothing hunts a fox or a spider, so a predator that
  sees another predator keeps hunting. There is one rung for fleeing, `evade`, because every
  agent that flees now flees something that hunts it.
- **The prey's chain is priority order, not a blended score.** Evade a believed predator, else
  forage toward believed food, else wander. Ties among equally-safe cells break toward the
  nearest believed food, through `greedyAway`'s own `towardCell`. The blended one-ply score ships
  as an opt-in experiment (`blendPreyDecision`, `preyThreatWeight`) and stays off by default: it
  turns the goal line into mush that neither the HUD nor chat can narrate.
- **Every read is a pure function of the fact set.** Seeded through `mulberry32(fnv1a32(...))`,
  never `Math.random`; the fold ranks by `(epoch, turn)`.
- **The tick payload is frozen.** `{ turn, agents, items, ecology }`, each agent
  `{ role, cell, facing, goal, mood, plan, mass, belief }`, each item `{ kind, cell }`.
  `test/fixtures/mudiii-ticks.json` records ten turns of it and
  `test/services/predator-prey-fixture.test.mjs` asserts the live engine still matches, field set
  included.
- **The asset manifest is a closed allowlist.** CC0 rows only, checked by bytes and sha256, with
  a forbidden-name pattern for the sibling repo's licence-restricted kits and a sweep that errors
  on any `.glb` under `public/models` the table does not name. `public/models/CREDITS.md` is
  generated from the same table and `check:model-credits` fails on drift. The pipeline for a
  later cast is: drop a CC0 GLB in, add its row, map its clip names.
- **The page and the scene share no scope.** `mudiii-viz.mjs` owns the shell,
  `mudiii-scene.mjs` owns the 3D, and the two talk through `window.mudiiiScene` one way and
  `window.mudiiiHandleSceneClick` the other. Every scene call from the page is guarded, so a
  failed three.js load costs the canvas and nothing else. Both files splice pure functions into
  their generated scripts by `.toString()`, so **a spliced function must close over nothing the
  generated script does not itself declare** — every export of either module except its
  page/script builder is spliced, and `mudiii-viz.test.mjs` fails the build on a leak. Node
  cannot catch this by running the function: the module copy has the module's bindings in scope
  and the browser copy does not.
- **One ticker for the whole world.** `runPredatorPreyTick` advances every agent in one call, so
  there is nothing a second ticker could drive. Every turn — the deck, the step button, the drive
  ring, a chat frame — goes through the same serialized queue, and the engine owns the count.
- **One write path per action.** A ground click with the food pill armed runs the same
  `put food at cell-x-y` the chat lane runs, so the provenance stamp is identical and
  "who put that there?" answers the same either way.
- **The board is open, so the backdrop is a sky.** Twelve units across with nothing beyond it,
  which means most cameras spend part of the frame looking off it. `skyGradientStops` paints an
  equirectangular sky from the page's own sky/horizon/stone custom properties, so the canvas
  continues the page rather than cutting a hole in it, and the horizon holds still as the visitor
  turns.
- **The overhead rig fits the tighter of the two axes.** Its height comes from the board size,
  the camera's field of view and the canvas aspect together, so a wide window pulls the camera
  in and a narrow one backs it off, and the whole board stays in frame either way. It leaves
  enough room past the ground plane for a goblin standing in an outermost cell and the id label
  above its head, both of which looking straight down pushes outward from the centre of frame.
  Taller props overhang.
- **Movement is a snap with a cosmetic tween.** Per-agent meshes persist, a ~250ms lerp eases
  each one-cell hop, and the authoritative position is always the tick's cell. Spawns, despawns
  and any multi-cell jump use a scale flourish at the destination, no path animation. Reduced
  motion collapses the duration to zero and leaves the opening board standing still.
- **Chat answers are board reads.** No provenance chips — this page follows spider-fly, not
  chat.html. A line the lane cannot read gets the standing decline.
- **The belief line names what a visitor can act on and counts the rest.** "What does the goblin
  see?" names anything the observer can place, and anything a visitor put where it stands: a
  taught position or a hand-dropped morsel, both stamped `:taught:turnK` on the winning placement
  row. Everything else unobserved is one count. Naming every unseen crumb instead made the answer
  grow with the food cap and buried the one individual a visitor had just planted a claim on.
- **Board feedback belongs to ground clicks, not camera buttons.** Clicking a cell flashes it,
  draws a line from the followed agent, and has that agent plan a route there
  (`walkFollowedTo` in `mudiii-viz.mjs`, `flashCell`/`showRoute` in `mudiii-scene.mjs`). FOLLOW /
  POV / OVERHEAD switch the camera and do nothing else.
- **Claim pills append rather than replace or submit.** A single click appends the pill's text to
  whatever is already in the input, so pills compose: click `look at`, then click `the book`.
  Return submits, and a double-click appends and submits in one gesture. `appendToChatInput` in
  `mudiii-viz.mjs` adds a separating space and puts the caret at the end. This differs from every
  other pill rail in the repo: adventure-viz.mjs assigns `chatqEl.value = btn.textContent`,
  replacing what was typed, and mud-viz.mjs's chat pills skip the input altogether and call
  `sendCommand` straight away.

## Where the page went past the plan

Three things the original design called differently, kept because the page is better for them:

- **The compass ring became a drive ring.** The design retired mud.html's ring on the grounds
  that a free camera replaces it. The page instead repurposed it: eight glyphs around the canvas
  that walk the followed agent, one lit for its current facing. Lighting available exits would
  light nearly the whole ring on an open grid and say nothing, so facing is the reading.
- **The predator is a fox, not a wolf.** `wolf_basic.glb` in the sibling repo turned out to be an
  unrecorded Tripo asset rather than the CC0 Quaternius wolf. `check-model-manifest.mjs` fails on
  its name so it cannot be picked up by mistake.
- **Crumb and morsel are the same hay bale** at the same target height. The two knobs stay
  separate so a later world can tell them apart.

## Open

1. **`reports/PAGE_WEIGHTS.md` has no figure for the vendored three build.** It is the page's
   largest single asset and the only measurement of it anywhere is prose.
   *Do:* fold `public/vendor/three.js` into the next page-weights pass. *Risk:* none beyond the
   report going stale on the next three bump, which is what that report is for.
