# PLAN_MUD_DEMO.md — mud.html, the shipped single-page proof

Status: SHIPPED, linked from the home page as the tenth demonstration. Split out of
`PLAN_MUD.md` (2026-08-01); that document keeps the shared origin and baseline.

## Demo phase — `mud.html`: a self-contained proof of the shared, multi-character shape

**This demo does not touch Backend D or Tier 1/2 (PLAN_MUD_SERVER.md), or a real network at all.** It's a single-page,
client-side, deterministic simulation — the same architecture `spider-fly.html`/`adventure.html`/
`plan.html` already ship (the real engine runs in the visitor's browser, no server, no LLM
anywhere). What it proves is the *governing shape* the PLAN_MUD family is named for: a persistent
world several characters mutate together, one of them able to dig new content into existence,
each pathing toward a goal built from what it's actually been told. Backend D is how that shape
eventually reaches a network; `mud.html` is proof the shape itself works, independent of and prior
to that question.

Shipped and linked from the home page as the tenth demonstration (`public/index.html`'s
two-block-per-demo shape: a claim card plus a fuller feature section with a screenshot).
Capability claim: **"Multiple actors, one shared world."**

### Layout — a soil cross-section, not a flat grid

Every demo page picks one visual register and commits to it: spider-fly's flat top-down canvas
grid, adventure's text-first room digest, plan's step-by-step block replay. `mud.html`'s own
register is a **layered soil cross-section** — two burrow panes, side by side on desktop and
stacked on mobile, with a control deck and a graphical burrow survey sharing the page's own top
row: the deck takes the left two-thirds (play, reset, the players/npcs/delay/max-turns sliders,
the explanatory note), the survey takes the right third. The survey draws every currently-dug room as
a real connected graph — named chambers, tunnels as strokes, a vertical shaft dashed — rather than
a flat text list, so it reads as an actual map of the burrow.

**Palette** — named for the subject, not a template default (not cream+terracotta, not
near-black+acid-green): `--soil-deep #241710` (background), `--soil-mid #4A3324`, `--soil-light
#7A5A3D` (upper strata), `--root-moss #6B7A4F` (the garden surface), `--parchment #EFE6D8`
(pane/card background — dug clay, not white), `--mud-ink #2A211A` (text, warm near-black),
`--chalk #D9CDB9` (muted text on dark), `--burrow-glow #E8A33D` (the one warm accent — active
panes, the current turn, a freshly-dug room's flourish — spent in one place, not scattered).

**Type** — a characterful, slightly hand-cut display face for headings and room names (Fraunces'
register was the brief; no web font ships, so `DISPLAY_STACK` is the serif stack's own web-safe
serif and the one constant to repoint if a font pipeline ever lands), a plain
sans body face for descriptive text (IBM Plex Sans or Inter), and a monospace utility face for the
dense simulation readouts — turn counters, coordinates, mass/pouch stats (IBM Plex Mono) — so the
page's two registers (storybook burrow, live simulation telemetry) read as deliberately distinct
rather than accidentally inconsistent.

**Wireframe**:

```
+----------------------------------------+-------------------+
|  control deck                          |  BURROW SURVEY    |
|  play · reset · players · npcs ·       |  (every dug room, |
|  delay · max turns ·                   |   every character,|
|  the explanatory note                  |                   |
|                                         |   no fog of war)  |
+--------------------+--------------------+-------------------+
|  pane A            |          pane B                        |
|  (room · pouch ·   |          (room · pouch ·                |
|   compass ring ·   |           compass ring ·                |
|   chat+pills ·     |           chat+pills ·                  |
|   known ground)    |           known ground)                 |
+---------------------+---------------------+
```

Mobile stacks the same pieces top to bottom instead of side by side: the deck-and-survey row
first, then pane A, then pane B, scrolling — each pane a fixed size regardless of how much its
room description grows.

**Signature element**: a dug room visibly opens into the survey the turn it's created — a short,
`prefers-reduced-motion`-respecting dirt-particle flourish in `--burrow-glow` — the one bold move
on the page, everything else stays quiet and disciplined around it.

### Per-pane UI (×2)

- **Character**: the burrowing animals (mole, vole, badger, groundhog, meerkat) are drawn at random
  each time the world starts or resets, one per pane. Each world hand-authors its own cast — garden
  four, warren five, hollow two — and a cast bigger than
  that mints more instances of the same species (`mole-2`, `badger-3`), each opening with the
  authored animal's own type, room and mass, and an authored animal nobody is playing is left out
  of the world rather than standing in it inert.
- **Room view**: one row tall. The viewing character's own sprite stands on the right; any other
  character present in the room stands on the left; loose objects hang on the back wall in
  portrait frames rather than scattered across the floor, each captioned with the thing's own
  name whichever tier of sprite ends up drawn. Built over the same shared world state
  the chat log reads — the graphic is a rendering of it, not a second source of truth. **When two
  characters share a room and one talks to the other, a speech bubble renders over the speaker** in
  both panes that can see the room, holding the short form of what was said (the full exchange
  still lands in the chat log). A short, `prefers-reduced-motion`-respecting fade, matching the
  dug-room flourish's own restraint.
- **Pouch** (this demo's name for the inventory — a satchel doesn't fit a burrowing animal): shows
  clean item names, not the underlying minted id a dug object carries internally.
- **Chat, with pills**: a compass ring lays the six directions out at their own points on the
  room view — north/south centered top and bottom, east/west at the side edges, up/down as their
  own round chips — and offers only a `go` or a `dig` the world actually allows in that direction;
  a direction with neither draws nothing. Non-movement pills (`look`, `what do you know about
  food`, `talk to <character>`) sit below the ring, and only ever name a character actually
  present in the room.
- **Wave**: a typed `wave` command and a hand-icon button sitting with the non-movement pills,
  both the same action. Waving writes a real room-scoped fact into the shared world state, and
  every pane that can see the room — the
  waver's own included — renders a brief, larger waving-hand animation over that character's
  sprite the moment the fact lands. Same `prefers-reduced-motion` restraint as the dug-room
  flourish and the speech bubble. Nothing about this needs a network: it's a small, independently
  buildable addition to the shipped demo.
- **Movement / dig**: `go <direction>` unchanged from the original grammar work. `dig <direction>`
  still only succeeds where no exit exists yet, and now also respects the room's own kind: an
  underground room can be dug on any exit-less side, the surface can only ever be dug straight
  down (and back up again, once underground) — never sideways.
- **Per-pane play/pause/step, and a genuine per-character turn count** — that character's own
  tally, distinct from the deck's shared count.
- **Known ground** (this demo's fog-of-war minimap): the room names that character has personally
  visited, nothing more.
- **Out of play, two ways**: a character that walks into the fox's den (below) is eaten, and one
  whose mass reaches zero starves. Either way its pane grays out, its controls disappear behind a
  plain "eaten · N turns" / "starved · N turns" notice, and it takes no further turns. The engine
  places it at a sentinel named for the fate ("eaten", "starved"); `outOfPlayReasonOf(state,
  character)` and each session window's own `outOfPlayReason()` give the page the word to show.

### The control deck (the page's own top row, shared with the survey)

- **Play**: starts every animal's ticker at once, panes and npcs alike. Nothing plays on page load
  — a pane only starts once its own play control, or the deck's, is clicked, and an npc only under
  the deck's, since it has no control of its own.
- **Turn counter**: the shared count, incremented whenever any character takes a turn — shown
  alongside, and distinct from, each pane's own count.
- **Players slider**: how many characters get a pane (1, 2 or 4), redrawn on release.
- **Npcs slider**: how many more animals share the world with no pane at all (1 to 10, default 2).
  They run the same scripted turn, appear in the survey and in any room view that can see them, and
  can be talked to like any other character.
- **Delay slider**: the wait between turns in play mode.
- **Max-turns slider**: a hard cap on the simulation length, shared by every animal in play.
- **Reset**: starts a fresh world and redraws which characters are cast, panes and npcs both.
- **A short explanatory note**: plain prose describing what's actually happening on the page — two
  independent characters, one shared world, gaps that stay unknown rather than get guessed at —
  not sales copy, an orientation for a first-time visitor.

### World / map model

- **The garden is the surface** — pre-authored, all outdoor, and can only be dug straight down
  from, never sideways; the surface is the ceiling. A stationary predator lives in a den one dig
  off the underground start room and never moves on its own; a character that digs into it is
  eaten. Garden and warren both cast `fox-1`; warren adds `owl-1` on a stump, so the count is the
  world's to say, not one per world.
- **One level underground**, reached by digging down from the garden and extended sideways from
  there by digging any side with no exit yet.
- **The burrow has an edge.** The world names its own origin (`garden mgx:is-origin true`) and no
  dig may open a room more than `mgx:dig-reach` exits from it. A room at that distance offers no
  dig at all, so the compass ring never suggests one and the verb never has to refuse one; typing
  the dig anyway is declined in the world's own terms. Without the cap a character digs itself
  twenty-odd hops out into rooms nobody else will ever reach. The three shipped burrows set 6
  (garden), 3 (hollow) and 10 (warren); `DEFAULT_DIG_REACH` is 6 for a world that names none.
- **Some digs open a den.** A dug room is sometimes a food store rather than a bare tunnel, and
  some dens are lived in — a resident mouse that knows what its own den holds, so a
  character that digs one out has somebody new to ask about food. The rates are the world's too,
  through `mgx:dig-spawn-max`, `mgx:den-chance-in` and `mgx:den-resident-chance-in`: garden runs
  one in five and one in three, hollow one in three and one in six, warren one in eight and one
  in two. What a dig turns up is likewise world-authored, through `mgx:dig-spawns`,
  `mgx:den-spawns` and `mgx:den-resident` on the room kind.
- **The central survey is the operator's omniscient view** — every dug room, every character, no
  fog of war, drawn as a real graph rather than a flat list. Each pane's own "known ground" is
  where fog of war still applies.

### Creature stats

Per-species mass and hunger-drain rate. `game-config.mjs` holds one table entry per species, and a
world overrides any of them on its own cast — warren runs its badger at 12 where the config says
20, hollow drains its mole at 0.04 where the config says 0.06. The config is the fallback, the
world pack is the authority. The fox is stationary and doesn't carry the same move/dig-reach stat
the roaming species do; it only ever needs to be present in its den.

The drain is charged for real, at the end of every scripted turn, and a character that reaches
zero starves. The rates are sized against the page's own default run (400 shared turns, so about
200 each for two animals): an animal that never eats dies about two thirds of the way through, and
one that forages does not.

### The turn algorithm

Every acting character's turn, in order:

1. **Investigate the room** (always, every turn):
   1. If another character is present, talking to it is preferred over the other investigate
      steps below — two characters sharing a room default to talking to each other, not past each
      other.
   2. Otherwise, ask what's known about food, answer if asked, and learn from the answer — a real,
      provenanced fact written into the asking character's own memory, not a one-tick value.
   3. If an unexamined object or food item is present, examine it and remember the detail, also as
      a durable, provenanced fact.
   4. Randomly do one of: take an object, put an object, eat an object (if it's food and the
      character weighs under 10, half of the engine's `ASSUMED_FULL_MASS` of 20) — eating
      transfers the eaten item's remaining mass. The threshold is one number for every species,
      not half of each animal's own mass, so a mole starting at 8 is always hungry and a badger
      starting at 20 eats nothing until it has lost half.
   5. Update memory with whatever changed.
2. **Walk toward the nearest unexplored edge**, via a room-graph pathfinder. The goal is a room
   holding a food fact this character actually knows about. A character with no food fact yet has
   nothing to path toward, and the pathfinder returns a plain miss — that miss *is* "I don't know
   where any food is," not a bug to patch around.
3. **If this turn's walk reaches an edge**, independently roll a chance for *each* of the
   following (a separate roll per option, not a single pick-one-of-three):
   - each available exit toward food,
   - each available dig direction the room's own kind allows — digging into the fox's den ends
     that character's run instead of opening a room,
   - each edge direction, to just keep following the edge toward food.
4. **If nothing above moved it, set off for a room it has never stood in.** This step makes a
   different claim from the food walk: it reads the character's own placement history, not
   anything about where food might be, so it invents nothing. It skips rooms a predator stands in,
   which keeps the fox a gamble rather than the nearest unvisited room everyone walks into. When
   every room within reach has already been walked, it says so and the character stands still —
   and the mass drain then decides how that ends.
5. **Charge the turn's mass drain**, and place the character out of play if it hits zero.

### A new NLP lane: listing what a character knows

"What food do you know about," and the same question addressed to a specific character by name
("groundhog-1, what do you know about food"), both answer from that character's own accumulated
food-knowledge facts — never the whole world's food, and never falling through to the code-graph
chat lane's own fallback reply on a near-miss phrasing.

### Sprites and the nature corpus

Mole, vole, badger, and groundhog all have hand-authored sprites; badger set the quality bar
(a fixed-palette marking carrying the animal's own identity, limbs breaking the silhouette, a
highlight that stays inside the body), and vole, mole, and groundhog have since been brought up to
match it. A new fox sprite, sitting and marked as a predator rather than one of the playable
species, was added for the den. The meerkat sprite, which mud-warren casts as `meerkat-1`, is now
the visually weakest of the group and is a candidate for the same treatment. Nature-corpus content (real facts about each animal and its food) is unchanged
from the original plan.

Every object a player can find now has a sprite of its own too: carrot, lettuce, tomato, seed,
basket, and the root and worm a dig turns up, alongside the stone the pack already carried. The
room view resolves them through the same property-aware, large-tier resolver the characters use,
climbing the object's own class chain and drawing the nearest ancestor that has a picture — so a
future kind with no sprite of its own still shows its vegetable, fruit, or plant, and only a
chain with nothing anywhere lands on a plain tied bundle.

### Multiplayer threading

Done: `adventure.mjs` threads a real acting-subject parameter through its command path instead of
a hardcoded `"player"`, and this demo casts as many simultaneous characters as it needs from that
— no shared "agent loop" abstraction across spider-fly/adventure/plan/mud was needed to get there,
consistent with `archive/PLAN_ADVENTURE.md`'s own earlier call that a common wrapper isn't warranted.

