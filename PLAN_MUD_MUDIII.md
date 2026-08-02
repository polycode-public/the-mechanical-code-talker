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
  their generated scripts by `.toString()`, so a spliced function must close over nothing the
  generated script does not itself declare.
- **One ticker for the whole world.** `runPredatorPreyTick` advances every agent in one call, so
  there is nothing a second ticker could drive. Every turn — the deck, the step button, the drive
  ring, a chat frame — goes through the same serialized queue, and the engine owns the count.
- **One write path per action.** A ground click with the food pill armed runs the same
  `put food at cell-x-y` the chat lane runs, so the provenance stamp is identical and
  "who put that there?" answers the same either way.
- **Movement is a snap with a cosmetic tween.** Per-agent meshes persist, a ~250ms lerp eases
  each one-cell hop, and the authoritative position is always the tick's cell. Spawns, despawns
  and any multi-cell jump use a scale flourish at the destination, no path animation. Reduced
  motion collapses the duration to zero and leaves the opening board standing still.
- **Chat answers are board reads.** No provenance chips — this page follows spider-fly, not
  chat.html. A line the lane cannot read gets the standing decline.

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

1. **The square has no sky.** `scene.background` is a flat slate colour, so every camera that
   looks past the board edge fills the rest of the frame with it — the opening follow shot, an
   overhead orbit, and a long look-drag in POV alike. The page already declares `--square-sky`
   and `--square-horizon` and the scene never reads either.
   *Do:* paint a two-stop horizon into `scene.background` from those tokens, built in the scene
   script so it costs no second asset. *Risk:* a gradient that reads as fog rather than sky;
   check it against the overhead rig, which sees the most of it.

2. **A camera mode with nothing followed is a silent no-op.** After a fallback to overhead the
   selection is cleared, but the agent dropdown still shows a live agent, so pressing `follow` or
   `pov` lights the button, leaves the camera overhead, and says nothing. The drive ring stays
   hidden for the same reason.
   *Do:* have a follow/pov press with no selection adopt the dropdown's own current agent, and
   say so in the status line when there is nobody left to adopt. *Risk:* adopting an agent the
   visitor did not pick; the dropdown is what they are looking at, so adopt that one rather than
   inventing a choice.

3. **"Who and what stands where" lists the whole tape.** The edit panel keys placements by raw
   subject, and the engine stamps every per-turn row as `<id>@turn<N>`, so the panel prints
   several hundred historical rows instead of the current board, and prints agents that have
   already been eaten.
   *Do:* fold placements by base subject on `(epoch, turn)` and drop anything carrying a removal
   row. *Risk:* props are authored with bare subjects and agents with stamped ones, so the fold
   has to rank a bare row below any stamped row for the same base rather than dropping it.

4. **`cameraRigFor` is not splice-safe.** It closes over `DEFAULT_GRID_SIZE` and `DEFAULT_FACING`,
   two module constants neither generated script declares, so the browser copy throws a
   `ReferenceError` on any facing outside the four cardinals. The drive ring's four diagonals set
   exactly such a facing, so one press while following stops the scene updating for that tick.
   *Do:* make the function self-contained, as its own header already claims, and guard the class
   rather than the instance — every spliced export has the same exposure.
   *Risk:* a Node unit test cannot see it, because the module copy has the constants in scope;
   the check has to run the spliced text in a bare scope.

5. **The vendored three build has no measured size.** `scripts/build-three-vendor.mjs`'s header
   still reads `// Measured size: [fill in after first build]`, and the only figure anywhere is
   prose in `build-demo-site.mjs`. *Do:* record the built size. *Risk:* it moves whenever three
   bumps, so a number written by hand goes stale — `reports/PAGE_WEIGHTS.md` is where a measured
   figure belongs.
