# PLAN_MUD_MUDIII.md — MUDIII, a Three.js town square over the spider-fly planning engine

Status: DESIGN, nothing built. This document's scope completes with `mudiii.html` deployed
alongside https://tmct.polycode.co.uk/mud.html. Split out of `PLAN_MUD.md` (2026-08-01); that
document keeps the shared origin and baseline, and indexes the sibling phases.

## MUDIII — a Three.js town square over the spider-fly planning engine

Renamed from this section's earlier working title "MUD3D". The public name is MUDIII, with
`mudiii.html` as the deliverable page and `mudiii.co.uk` as the eventual public URL. The domain
was unregistered as of 2026-07-30 (Nominet WHOIS: `No match for "mudiii.co.uk"`).

2026-07-30 design pass, superseding the 2026-07-29 MUD3D assessment. That pass's
world-of-claudecraft architecture findings are kept, compressed, in the claudecraft subsection
below; its conclusion (render tmct-natively, keep the planning in tmct) stands. Nothing here is
built.

**What it is.** One page. A Three.js view of a town square, with a prowling predator and a
handful of scavengers visibly moving around it — v1 casts a wolf and goblins, and the pair is
swappable data (see the cast subsection). Each character plans for itself over the same
fact-graph memory every other demo uses,
with vision-gated belief, exactly as spider-fly.html's agents do today. Under the 3D view sits the
ordinary chat surface: the game stays text-addressable, the 3D canvas is a visualization layer
over fact rows, and everything the player does lands in the store as facts. A single player
watches, advances turns, asks the animals what they see, feeds them true or false positions, and
places food. It is spider-fly's competing-planning-agents engine, reskinned to a new role pair and
rendered, driven through a 1-player version of mud.html's deck. This section's scope completes
with `mudiii.html` deployed alongside https://tmct.polycode.co.uk/mud.html; mud.html's
share/join P2P layer follows as its own phase, in PLAN_MUD_MUDIII_SHARED.md.

### What already exists, verified against current source

- `src/domain/planning.mjs` — `findActionPath`/`findReachableSet`/`bfsLevels`, the pure search
  kernel. Used unchanged.
- `src/domain/spider-fly-world.mjs` — the pattern for a shipped world: one pure module owning grid
  constants, `cellId`/`parseCellId`/`chebyshevDistance`/`visibleCells`/`perimeterCells`/
  `DIRECTION_DELTA`, plus generators for the world's fact rows (`worldFactRows`: cell typing,
  `mgx:has-exit-<direction>` adjacency, taxonomy) and self-describing `structuralFactRows` so
  "what is the board?" grounds in chat. MUDIII gets a sibling, `town-square-world.mjs`.
- `src/services/spider-fly.mjs` — the tick engine: `foldSpiderFlyState` (fold fact rows to
  current state), `gridApplyActions` (successors from `has-exit` facts), `planSpiderPath`
  (multi-step BFS chase), `greedyFlyMove`/`greedySpiderApproach`/`greedySpiderAvoid` (one-ply
  Chebyshev scoring), `believedCellOf`/`beliefSnapshotFor` (vision-gated belief with a told-facts
  channel), `runEcologyPass` (catch/eat/starve/lay/hatch/spawn in one fixed-order pass), all
  seeded-deterministic (`mulberry32(fnv1a32(...))`, never `Math.random`). This is the machinery
  MUDIII instantiates with new roles. The grid-planning question is already settled here:
  hand-written `applyActions` over the world's own `has-exit` facts, because the taught
  action-rule DSL's precondition shapes cannot express grid adjacency (the header of
  `gridApplyActions` records this; `compileDomain`/`movesFromRules` in `src/domain/domain.mjs`
  stay the plan lane's tool, not this game's).
- `src/services/spider-fly-turn.mjs` — the chat lane pattern: closed-regex openers/stop/tick, the
  addressed spatial teach-frame (`@spider the fly is east` / `at cell-7-3`), the read-only belief
  question ("what does the fly see?"), in-game orientation asides, and `pillsForSpiderFly` (the
  dynamic true/false claim-pill rail). MUDIII gets a sibling lane with role-parameterized
  vocabulary.
- `src/services/mud-viz.mjs` + `src/surfaces/web/mud-browser-entry.mjs` — the 1-player deck
  MUDIII inherits: an in-memory fact store per session, `session.snapshot()` as the one
  omniscient read, `serializeTick` (a shared promise chain making turn order well-defined), one
  `createTicker` per animal, play/reset/delay/count sliders, scenario dropdown. mud.html is
  already single-player-capable: its P2P layer is a lazily-imported add-on
  (`import("./vendor/p2p.js")` on share/join only), so "1-player mud.html" means shipping without
  that import and without the `.state-pill`/net-panel/join-card/claim machinery, and changing
  nothing else. The shared-worlds phase (PLAN_MUD_MUDIII_SHARED.md) re-adds exactly those pieces after this
  page ships, from the same bundle.
- `src/domain/game-config.mjs` — `DEFAULT_GAME_CONFIG.spiderFly`/`mud` plus tmct.toml overrides;
  MUDIII adds its own table.

### The world: a town square as a grid with buildings on it

`src/domain/town-square-world.mjs`, mirroring `spider-fly-world.mjs`. A 12x12 grid (spider-fly is
10x10; a square with buildings needs the extra room, and the size is one constant in one module).
The town-square dressing — buildings around the edge, a well, market stalls — is authored as prop
facts in the same world pack:

    stall-1   rdf:type          prop
    stall-1   mgx:currently-in  cell-4-3
    stall-1   mgx:model         market-stall
    stall-1   mgx:rotation      90

A prop's cell is solid. The world generator simply omits `mgx:has-exit-*` edges into occupied
cells, so buildings are pure topology: the planner routes around them with zero new code, the
same way it already respects the board edge. This is the one structural difference from
spider-fly's open board.

`mgx:model` names an asset key the render layer resolves to a mesh; fact rows never carry file
paths. The shape (name, cell, rotation, optional scale) follows world-of-claudecraft's
`PlacedAsset` as a reference (see the claudecraft subsection), restated as fact rows so the scene
stays askable in chat ("what is at cell-4-3?" grounds).

### The cast: a parameterized predator/scavenger pair

spider-fly hardcodes its roles everywhere: id regexes (`/^spider-\d+$/`), config keys
(`spiderInitialMass`), chat vocabulary, and the viz layer's class literals (a fact NEXT.md's
generic-page-API item already names). The operator plans several character pairs over time, so
MUDIII does not copy that pattern. Two options:

1. Parameterize `spider-fly.mjs` itself and make spider-fly one instantiation. Touches a shipped,
   tested engine and its chat lane; largest payoff, largest regression surface.
2. Write the new engine role-parameterized from day one — `src/services/predator-prey.mjs`,
   taking a roles object — and leave spider-fly untouched. spider-fly can migrate onto it later
   if that ever earns its cost.

Option 2 is the design. The roles object is plain data:

    { predator: { kind: "wolf",   idPrefix: "wolf"   },
      prey:     { kind: "goblin", idPrefix: "goblin" },
      food:     { spawnedKind: "crumb", placedKind: "morsel" } }

with the numeric knobs in `DEFAULT_GAME_CONFIG.mudiii` keyed by role, not species
(`predatorInitialMass`, `preyVisionRadius`, `foodSpawnIntervalTurns`, ...), so a later pair is a
new roles object plus sprite/model mappings, with no engine edit. Note `game-config.mjs`'s `mud`
table went the other way (per-species keys: `moleInitialMass`, `badgerSpeed`, ...); that fits
mud's authored-cast worlds, but MUDIII's cast is a role pair by construction, so role-keyed knobs
fit here.

**Which pair, and why.** Wolf and goblins is the v1 cast (the per-model rig evidence sits in the
claudecraft subsection below). Both bodies are CC0 with full wired ground rigs
(idle/walk/run/death), and the fiction maps 1:1 onto the mechanics: goblins raiding a medieval
square for scraps, a wolf hunting the goblins. Nothing in the crumb/forage/evade design bends to
fit it.

### Mechanics, as planning-domain content

All of these run inside the engine's per-tick loop (fold, believe, decide, move, ecology pass,
append this turn's `@turnN` facts), which carries over structurally intact.

**Crumbs appear on their own.** A world-tick event in the ecology pass, exactly where fly
spawning lives today: every `foodSpawnIntervalTurns` turns, one `crumb-N` is minted at a seeded
pick among uncontested cells (seeded by world name, turn and id, so runs replay
byte-identically). Crumbs are inert items, not agents: `rdf:type crumb`, `crumb rdfs:subClassOf
food` in the pack taxonomy, `mgx:currently-in`, and `mgx:eaten-by` when consumed. Unlike
spider-fly's perimeter-only fly spawns, crumbs land anywhere open — they are dropped bread, not
arriving animals. Goblins still arrive at the perimeter, wandering in from the edge of view,
which is the fly-spawn rule verbatim.

**Goblins plan to eat crumbs.** A goblin that believes food stands somewhere runs
`findActionPath` toward the nearest believed food cell and takes the first step (the spider's
chase machinery, pointed at an item instead of an agent). Co-location eats it: an eat step in
the ecology pass writes `mgx:eaten-by` and adds the crumb's mass to the goblin. Belief is
vision-gated for food exactly as for agents — a goblin must wander within its vision radius of
a crumb (or be told about it) before it will path to it. The alternative, food as common
knowledge on spawn, would send every scavenger beelining across the square and kill the
foraging feel; it stays a config experiment, never the default.

**The wolf plans to eat goblins.** The spider's chase priority chain, minus webs: a wolf that
believes a goblin is visible paths toward the believed cell (multi-step BFS when one exists,
one-ply greedy approach otherwise) and eats on co-location, gaining the goblin's remaining
mass. spider-fly separates catch from eat because eating needs a web; a wolf needs no
apparatus, so catch and eat merge into one ecology step. Two wolves avoid each other
(`greedySpiderAvoid`'s mirror), and a wolf with nothing in view wanders (seeded) rather than
holding still — there is no web to build, and a motionless predator reads as a broken page in
3D. Eggs and hatching stay out of v1; the goblin spawn interval keeps the population up, and
the wolf count is a slider. Mass and starvation stay for both roles — hunger is what makes the
foraging real.

**Goblins evade the wolf; the eat-versus-evade conflict resolves by priority order.** The fly
already resolves this shape: its move chain is trapped > evade > wander. The goblin's chain
inserts the forage branch one rung down:

    1. a wolf is believed visible -> evade: one-ply greedy, maximize Chebyshev distance
                                     from the nearest believed wolf (greedyFlyMove verbatim)
    2. food is believed somewhere -> forage: first step of findActionPath toward it
    3. otherwise                  -> wander: seeded pick among stay + one-ply neighbors

Threat response needs no event system: the whole engine replans every tick from the folded
facts, so a wolf entering vision radius flips the goblin from rung 2 to rung 1 on the next tick
by construction, and its goal line flips with it ("evading — last saw wolf-1 at cell-6-2"). The
alternative — one blended one-ply score weighing wolf distance against crumb distance — was
considered and parked: it needs new scoring machinery, its weights need tuning against a real
board, and it turns the goal line into mush ("mostly evading, somewhat hungry") that neither the
HUD nor chat can narrate cleanly. A cheap middle ground exists later without restructuring:
when evading, break ties among equally-safe cells toward the nearest believed food. That is one
comparator in the evade scorer, flagged as a tuning knob, not v1.

**The player places food.** A chat verb (closed regex, in the lane: "put food at cell-3-4" /
"drop a morsel at cell-3-4") and a click affordance in the 3D view (click an empty cell while
the food pill is armed). The click resolves by raycasting — three's stock
`Raycaster.setFromCamera` intersecting the ground plane, the hit point snapped to its cell — the
standard pick mechanism, and the page's only use of it. A click on a prop's cell or an occupied
cell appends nothing and says why in the status line ("cell-4-3 is blocked"); the pill stays
armed so the next click can land. Both append one fact set: `morsel-N rdf:type morsel`, `morsel
rdfs:subClassOf food`, `mgx:currently-in cell-x-y`, with player provenance rather than the world
tag — so "who put that there?" grounds, and the answer names the player. Goblins never
distinguish crumbs from morsels: the forage read walks the `food` class chain
(`objectClassChain`, as mud-turn.mjs's `isFood` does), so player food and world crumbs compete
on distance alone. Placing food next to a lurking wolf is thereby a working trap, and nobody
wrote a trap mechanic — it falls out of the three rules above.

**Telling characters things carries over whole.** The addressed teach-frame ("@goblin the wolf
is east", "@wolf the goblin is at cell-7-3") and the true/false claim-pill rail lift from
spider-fly-turn.mjs with role vocabulary swapped, and the told-fact channel extends naturally
to food ("@goblin the crumb is at cell-2-9"). Deception stays the page's sharpest trick: the
belief panel shows the lie landing.

### The render layer: vendored Three.js, facts in, meshes out

**Vendoring.** `three` is not currently a dependency and no page loads anything from a CDN — the
repo's standing rule, with the recipe already proven: `build-wink-vendor.mjs` bundles wink-nlp
into `public/vendor/wink.js` (3.6 MB raw / 790 KB brotli), precached by the service worker so
LAN demos work offline. Three.js follows the identical recipe: `npm i three`, a
`scripts/build-three-vendor.mjs` copied from the wink one (esbuild, ESM, minified,
write-to-tmp-and-rename), called from `build-demo-site.mjs`, added to the service-worker
precache, and lazily `import("./vendor/three.js")`-ed from the page's inline script. A minimal
three build is ~600 KB, well inside the wink precedent. OrbitControls ships in three's examples
tree and joins the same vendor bundle, as does the meshopt decoder (see the claudecraft
subsection for why).

**Page anatomy** mirrors every other game page: `renderMudiiiHtml()` in
`src/services/mudiii-viz.mjs` (markup + CSS + inline IIFE), an engine bundle from
`src/surfaces/web/mudiii-browser-entry.mjs` stashing exports on `globalThis.tmctMudiii`, a
`scripts/build-mudiii-bundle.mjs` through the shared `browser-bundle.mjs`, and a
`build-demo-site.mjs` block writing `public/mudiii.html`.

**The landing page plate.** `public/index.html` is committed, hand-authored markup, and every
demo page it features gets a numbered plate: an `open mudiii.html →` link plus a
`.plate-frame` card wrapping a 640x375 `./screenshots/mudiii.png`, following the existing
plates verbatim. The screenshot comes from `scripts/gen-screenshots.mjs`: add `"mudiii"` to its
`PAGE_ORDER` and give it a ready check in the mud.html style — mud is already the precedent for
a plate that must look busy rather than freshly loaded, so the check drives the simulation
several turns and waits for agent meshes to have moved before the shot fires. The PNG and the
updated `public/screenshots/manifest.json` are committed like the other nine.

**Scene graph from facts.** One ground plane with the grid drawn on it; prop meshes at their
authored cells (resolved from `mgx:model` keys); one mesh per live agent at its cell center; a
small marker mesh per crumb/morsel. The renderer consumes exactly the tick payload spider-fly's
2D page consumes (`{ turn, agents: { id: { cell, goal, plan, mass, belief } }, ecology }`) plus
the prop facts once at boot. `plan[0]` drives facing, as it already does for 2D sprite rotation.

**Movement is a snap with a cosmetic tween.** The engine's truth is one cell hop per tick, and
characters can simply appear in new cells — which is what mud.html and adventure.html already
do (both re-stamp the character at its new room per redraw; a survey of both viz files found no
position tweening in either). spider-fly.html is the one page with interpolated motion:
persistent per-agent DOM nodes whose `left`/`top` transition over 250ms, disabled under
`prefers-reduced-motion`. The 3D layer copies that exact convention: per-agent meshes persist
across ticks, a ~250ms lerp eases each one-cell hop, and the authoritative position is always
the tick's cell (the lerp is presentation, never state). Spawns, despawns and any multi-cell
appearance use a short scale/fade flourish at the destination cell, no path animation — the
mud-viz event-flourish idiom (dig-pulse, fox-pounce) in 3D. Reduced motion disables both.

**Camera and visibility.** Three camera modes, switched by a dashboard control, with the
dashboard's agent-select dropdown (below) choosing which cast member the first two track:

1. **Follow** (the default) — a third-person chase camera sitting behind and above the selected
   agent, looking at it, so your own character is always in frame. This is the familiar
   third-person game view, and it's the default because a visible body is what makes the mesh,
   its facing, and its walk animation legible to a first-time visitor.
2. **POV** — first-person: the camera sits at the selected agent's own position and facing,
   world-of-claudecraft-style. The same dropdown drives it; switching modes keeps the selection.
3. **Overhead** — an orbitable camera around the square's centre, the counterpart of mud.html's
   whole-burrow survey, for a full-board view at any time.

If the followed agent is eaten or despawns, the camera falls back to overhead automatically with
a status line naming what happened ("wolf-1 ate goblin-2 — switching to overhead"); picking
another agent in the dropdown resumes follow. "NPCs wandering in and out of view" stays the
agents' own vision model regardless of which camera mode is active: what each animal can see is
vision-radius belief, surfaced through the belief panel and "what does the goblin see?", never
gated by what the camera itself currently renders.

**The map panel.** A small, always-visible 2D top-down panel alongside the 3D view — the same
role adventure.html's `roommap` panel plays, simplified: one square, no visited-room tracking to
draw, just the grid with a tiny dot per live agent at its current cell. It reads the same tick
payload the 3D scene does, so it's a second, cheap rendering of the same truth rather than a
second state to keep in sync. With a single square, it covers exactly the same ground the
overhead camera already shows — the two read as duplicates of each other for now. They stay
structurally different views, though: the overhead camera is inherently local, orbiting one
square's own centre, while the map panel draws whatever the world pack actually contains. That
distinction earns its keep the moment a world has more than one square to show at once, and
costs nothing to carry now.

### The dashboard: a 1-player mud deck

The deck adopts mud.html's own control set unchanged, same ranges and defaults: Play (starts
every animal's ticker at once, wolves and goblins alike), the shared turn counter, Reset (starts
a fresh world and redraws the whole cast), a Players slider (1/2/4, redrawn on release) sizing
the wolf roster, an Npcs slider (1..10, default 2) sizing the goblin roster, a Delay slider
(80-2000ms, default 650ms) and a Max-turns slider (20-2000, default 400). The agent-select
dropdown (which cast member the POV camera follows) sits alongside them. Turn flow reuses
`serializeTick` plus one ticker per animal. Below or beside the 3D view: the chat
log and input with the pill rail, and per-agent HUD cards (mass bar, goal line, expandable belief
panel) following spider-fly's HUD. mud's EDIT mode (the facts-as-sentences textarea in
`mud-editor.mjs`) applies to this world unchanged, because the world is the same kind of fact
rows. Three scenarios ship in the scenario dropdown, mirroring mud.html's own three-burrow set —
town-square variants of the wolf/goblin cast, each varying grid size, building layout, and
predator/scavenger counts. The P2P layer arrives after this page ships (PLAN_MUD_MUDIII_SHARED.md), the same lazy way mud.html gained it, since the session store is the same shape;
at that phase the deck gains the share control, the net panel and the `.state-pill`, and nothing
in this section depends on them.

### "Pills and pointers", concretely

What the phrase means in this codebase today (verified across all four pages): there is no
single convention, and no pointer-from-chat-into-the-viz anywhere. The real inventory:

- **Affordance pills** — click-to-fill (or double-click-to-run) command chips above the chat
  input: adventure.html's `pillsForRoom` ("take lamp", "open desk"), mud.html's `.pill.way` (go)
  and `.pill.affordance` (dashed), spider-fly.html's static address/direction pills.
- **The deception rail** — spider-fly's dynamic `pillsForSpiderFly` claim pills, tagged true
  (✓, taught-green border) or false (✕, dashed alert border) by CSS only, so the submitted
  sentence never carries the tag.
- **Provenance chips** — chat.html's `.provchip` / `.pc-taught|corpus|entail` under settled
  answer bubbles; a miss gets no chip, the absence being the signal.
- **`.state-pill`** — the P2P wire-state chip on chat.html and mud.html. P2P only.
- **Pointer glyphs** — the compass/door rings: mud's `▲ N / ▼ S / ◀ W / E ▶` positioned around
  the room box, adventure's `▸` door prefix and unwalked-door dot.

MUDIII carries forward: the affordance pills (addresses `@wolf`/`@goblin`, tick, the food verb),
the deception rail generalized to the role pair, and the goal/belief HUD. The compass ring dies
here — the free 3D camera (POV or overhead) replaces it, and directions live on in the
teach-frame pills ("the wolf is north"). `.state-pill` arrives with the shared-worlds phase (PLAN_MUD_MUDIII_SHARED.md), exactly as on mud.html. Provenance
chips stay a chat.html surface; this page's chat is a game lane whose answers are board reads,
and it follows spider-fly (no provchips) rather than chat.html.

### The chat lane

`src/services/mudiii-turn.mjs`, the fifth lane on the shared plan-slot, shaped exactly like
spider-fly-turn.mjs with vocabulary from the roles object: openers ("visit the town square",
"watch the wolf and the goblins"), stop, tick, the addressed teach-frame, "what does the goblin
see?", the orientation asides (where/options/goal), plus the one new verb: the food placement.
Every
lane answer stays a board read or an appended fact; a line the lane cannot read gets the
standing decline-never-guess treatment.

### world-of-claudecraft: what it actually offers this page

The 2026-07-29 architecture assessment stands, compressed: claudecraft is a real Three.js/
TypeScript MMO whose authoritative `Sim` class (9,673 lines) satisfies a 256-member `IWorld`
interface with a monolithic RPG entity map underneath — no graph, no fact/tuple representation
anywhere. Reusing its renderer would mean satisfying that whole interface or forking
`src/render`; its crafting/economy code has no graph to import from. So the planning and the
render layer are tmct-native, and claudecraft's value to MUDIII is its assets and a handful of
techniques. This pass surveyed both, file by file, in the sibling checkout at
`../world-of-claudecraft`.

**Licensing is two-layer, and the layer that matters is CREDITS.md.** The repo `LICENSE` is MIT
("MIT License / Copyright (c) 2026 Levy Street"), but it covers source code only. `CREDITS.md`
is the operative register for art: it states that the per-asset licence recorded there
"controls over the project's MIT license", and that unlisted media assets are not licensed at
all. Per-asset provenance therefore decides everything:

- **CC0 1.0** (free, no attribution): the bulk of the 970 bundled GLBs — the KayKit character
  and dungeon packs, the Quaternius creature/nature/Medieval Village/Fantasy Props kits, the
  Kenney kits, ambientCG terrain textures, Poly Haven HDRIs.
- **Attribution-required**: two entries only (an ESO galaxy panorama, CC BY 4.0; three.js water
  normal maps, MIT). A town square needs neither.
- **"With the project only"** — may not be extracted into a standalone demo. This tier is the
  trap, because it holds exactly the two things this page would want most: the entire
  `eastbrook_*` town kit (bank, smithy, inn, chapel, market stall, civic well, walls — the
  repo's one worked town square) and `yumi_cat.glb`, the only cat model in the repo (which also
  has no wired idle/walk/run clips, so it would need new animation work even if it were free).
- **"Permission required"** (weapons, UI icon sets) and CC BY-NC audio: out entirely.

**What we take (all CC0, sizes as shipped).** The Quaternius Medieval Village and Fantasy Props
sets rebuild the square cleanly: `well.glb` (27K), `house_1/2/3.glb` (~83K each), `inn.glb`
(91K), `blacksmith.glb` (95K), `market_stand_1/2.glb` (25K), `cart.glb`, `fence.glb`, barrels
and crates, lanterns, plus foliage (`oak_*`, `bush`, ~180K each) and, for stall dressing and
scavenger bait, the `resources/` food props (`food_apple_*`, `food_cheese`, `food_crate_large_apples`
— a CC0 cheese model is a gift for baiting scavengers). A dozen props plus two character rigs
lands around 1.5 MB, inside the wink vendor precedent. tmct keeps its own per-asset credit
register listing each copied file's source and licence — the same discipline CREDITS.md itself
models — even though CC0 requires none.

**The cast, verified against their clip maps** (`src/render/characters/manifest.ts` — checked
directly, since a model file proves nothing about its animations):

- `goblin.glb` (47K, Quaternius, CC0) — wired as their `mob_kobold` with the ENEMY7 rig:
  Idle/Walk/Run/Attack/HitRecieve/Death. A full ground-locomotion set, and Death gives the
  eaten-flourish a real clip. The v1 scavenger.
- `wolf_basic.glb` (325K, CC0) — their `mob_wolf`, the baked animal rig: Idle/Walk/Gallop plus
  hit-reacts, Death, Sit and Fall. The v1 predator.

The pipeline this sets up — drop a CC0 GLB in, map its clip names — is what makes every later
role pair cheap.

**Code worth imitating (MIT, so copying is fine; no dependency is taken):**

- `src/render/eastbrook_town.ts` (1,058 lines): a declarative town-square builder — a layout
  table of buildings/stalls/fences with local-to-world helpers, geometry merging,
  roof-fade-on-approach. The code is MIT and its structure maps directly onto our
  props-as-facts; only its Tier-C assets are off limits. The strongest single reference for
  scene assembly.
- `src/sim/types.ts`'s `PlacedAsset` — `{ path, x, z, rotY, scale, collideRadius? }` — the
  transform vocabulary our prop facts restate.
- `src/render/placed_assets.ts` (385 lines): normalization discipline — every GLB scaled to a
  target height before per-placement scale (their comment: catalogue GLBs "vary wildly in
  source units"), lowest point seated on the ground, one cached template per path cloned per
  placement.
- `src/render/assets/loader.ts`: promise-cached loading with rejected-promise eviction (their
  "black void" fix) and small concurrency queues.
- `src/render/characters/manifest.ts`: per-rig maps from semantic slots (idle/walk/run/...) to
  literal in-GLB clip names — saves reverse-engineering each rig by hand.
- `src/sim/rng.ts`'s `fbm2` (89 lines, zero imports): the seeded value-noise terrain function.
  A paved plaza is flat, so this stays reference-only unless the square gets ground-level
  undulation.

**One operational gotcha, documented in their own tree:** their GLBs are meshopt-compressed and
their loader wires MeshoptDecoder only; such a file parses in offline tools but silently fails
a bare browser `GLTFLoader`. Copied assets either keep meshopt (vendor the small decoder next
to three.js) or get re-transcoded to plain GLB once at import. Vendoring the decoder keeps the
files smaller and is the default. Their stack is plain Three.js `^0.165.0`, no framework —
confirming a vanilla-three page is the right shape for ours.

### Build order

1. `town-square-world.mjs` + the worlds-pack build, and `predator-prey.mjs` with its tests —
   pure modules first, provable headless in seconds, mirroring spider-fly's own test estate. The
   fold ranks by `(epoch, turn)` from day one — a shared-worlds requirement (PLAN_MUD_MUDIII_SHARED.md) that's cheaper built in than retrofitted, as mud.html's own retrofit showed.
2. `mudiii-turn.mjs` — the lane, playable from the CLI before any 3D exists (the same order
   spider-fly shipped in).
3. Vendored three + the minimal scene: ground, grid, box placeholders for agents and props,
   tick wiring, the deck. The page is playable and ugly.
4. Assets and polish: the claudecraft-derived models above, the movement tween, flourishes, HUD
   cards, the pill rail, the follow/POV/overhead camera modes and map panel, EDIT mode, the
   three scenarios, and the landing-page plate (the `gen-screenshots.mjs` entry and
   `public/index.html` card above).
5. Deploy: `mudiii.html` live at https://tmct.polycode.co.uk/mudiii.html alongside mud.html,
   probed by `smoke:deploy`. This completes MUDIII's own scope.

Later phases live in their own documents, not this one: the shared-worlds share/join phase
(PLAN_MUD_MUDIII_SHARED.md), further role pairs whenever a new cast earns one, and the online
phase (PLAN_MUD_MUDMMORPG.md).

### Delivery: packaging the build for coordinator + sub-agents

The build order above is the dependency spine; delivery runs on CLAUDE.md's coordinator model,
and this subsection fixes up front everything a simpler model would otherwise have to judge for
itself. The pattern in every item is the same: convert a judgment call into data an agent can
execute against and the coordinator can check mechanically.

**Freeze the interfaces as a fixture, not prose.** Before any dispatch, write
`test/fixtures/mudiii-ticks.json`: ten recorded ticks in the frozen payload shape

    { turn,
      agents: { "<id>": { role, cell, facing, goal, plan, mass, belief } },
      items:  { "<id>": { kind, cell } },
      ecology: [ ...this turn's spawn/eat/starve events... ] }

which extends spider-fly's payload with the `items` map — spider-fly has no items, so that map
is the one shape change, named here so nobody improvises it. The prop facts sit once in the
fixture's header, as at boot. The viz workstream then builds the whole 3D page against the
fixture while the engine workstream builds `predator-prey.mjs`. This is the single change that
makes the workstreams parallel instead of sequential.

**The asset manifest is a checked allowlist.** One committed table, `data/mudiii-assets.json`:
per row `{ key, sourcePath, destPath, licence, bytes, targetHeight, clips }`, where `sourcePath`
names the file in `../world-of-claudecraft` and `destPath` lands under a committed
`public/models/` (the `public/screenshots/` precedent: a committed exception inside otherwise
generated `public/`). The import task becomes: copy exactly the listed files, nothing else.
That makes the Tier-C trap structurally impossible — the `eastbrook_*` kit is the most findable
wrong answer in that repo, and an agent that only copies manifest rows can't reach it, while the
coordinator checks the work by diffing the directory against the table. The credit register
(`public/models/CREDITS.md`) is generated from the same table, and the meshopt transcode/vendor
commands are written literally in the manifest's own header.

**The numbers are written, not implied.** `DEFAULT_GAME_CONFIG.mudiii` ships these first-guess
defaults — role-keyed as designed above, drains on mud's scale (the deck defaults to 400 shared
turns), vision on spider-fly's:

    predatorInitialMass: 20,  predatorMassDecrementPerTurn: 0.08,  predatorVisionRadius: 4,
    preyInitialMass: 8,       preyMassDecrementPerTurn: 0.06,      preyVisionRadius: 3,
    preySpawnIntervalTurns: 5,  foodSpawnIntervalTurns: 3,
    spawnedFoodMass: 1,  placedFoodMass: 2

A wrong default gets tuned on a working board; an absent one gets invented differently by every
sub-agent. The three scenario layouts get the same treatment: authored as prop-fact tables
(cells, models, rotations, cast counts, grid size) in the world-pack dispatch brief, so that
workstream is data entry against this section's design.

**The lane is enumerated.** The `mudiii-turn.mjs` brief lists every behavior with one example
utterance and its reply shape: openers ("visit the town square" / "watch the wolf and the
goblins"), stop, tick, the addressed teach-frame ("@goblin the wolf is west" / "@wolf the
goblin is at cell-7-3"), the belief question ("what does the goblin see?"), the orientation
asides (where/options/goal), and the food verb ("put food at cell-3-4" / "drop a morsel at
cell-3-4"). The brief names the two required checks: no opener/verb collision with the four
existing lanes on the shared plan-slot, and the estate guard for any vocabulary that touches the
real-word collision table.

**One spike before the engine dispatch.** The mechanics section asserts belief "extends
naturally" to items; a short top-tier spike verifies `believedCellOf`/`beliefSnapshotFor`
actually take inert items before the engine brief is written. It's the one place this section
may be quietly wrong about carry-over cost, and finding out costs an hour, not a workstream.

**Every workstream carries its own done-check.** Step 3's "playable and ugly" means, concretely:
a Playwright smoke loads `mudiii.html`, presses Play, waits five ticks, and asserts at least one
agent mesh changed cells and the turn counter advanced. Steps 1-2 cite their node --test files
(spider-fly's estate mirrored); step 4 adds the screenshot ready-check; step 5's check is
`smoke:deploy` against the live page. Each brief names its blast-radius files, with `test:fast`
as the sub-agent ceiling per CLAUDE.md.

**Workstreams and tiers**, grouped so one hard task doesn't price a whole batch at the top tier:

| workstream | owns | tier |
|---|---|---|
| engine + world | `predator-prey.mjs`, `town-square-world.mjs`, their tests | top of the ladder |
| lane | `mudiii-turn.mjs` and its tests | Sonnet, against the enumerated brief |
| viz + bundles | `mudiii-viz.mjs`, browser entry, bundle + vendor scripts | Sonnet; the three-vendor script is a Haiku copy of the wink recipe |
| assets + data | manifest-listed copies, CREDITS.md, scenarios, config table | Haiku, against the manifest and tables |

The lane, viz and asset workstreams all hang off the frozen fixture and the written tables,
which is why those get written first.

