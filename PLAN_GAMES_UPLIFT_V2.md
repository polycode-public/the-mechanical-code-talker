# PLAN_GAMES_UPLIFT_V2.md — spider-fly ecology v2 (wandering, webs, mass symmetry) and an adventure graphical presence with goal-inferring auto-play

Status: DESIGNED, build in progress.

## Origin

2026-07-19, operator instruction, verbatim intent: flies should wander to random locations when
no spider is in sight, and evade when one is; spiders should avoid other spiders when one is in
sight, chase flies when one is in sight, and hold position (optionally building a web) otherwise;
a fly that enters a web cell can no longer move; webs last 10 turns; spiders must waste away (lose
mass) when they don't eat, the same as flies already do; a spider that eats a fly gains exactly
the fly's remaining mass, not a flat bonus. Separately: the adventure game needs a low-res
graphical display on the website — the room the player is in, with every stated object present —
embedded on the home page (mirroring spider-fly's embed), plus an auto-play mode where the game
infers its own goal and plans toward it using only the information the player has actually been
exposed to.

Both halves reuse substrate this session already built: `src/domain/seeded-random.mjs`
(mulberry32 + `src/domain/hash.mjs`'s `fnv1a32`) for reproducible "randomness"; `findActionPath`/
`findReachableSet` (`src/domain/planning.mjs`) for movement search; `src/domain/sprite-map.mjs`'s
ontology-to-sprite resolver; `src/services/viz-ticker.mjs`'s shared play/pause/step control.

## Part A — spider-fly ecology v2

### A.1 Current behavior (read from `src/services/spider-fly.mjs`, confirmed live)

- Fly: `greedyFlyMove` — moves to maximize distance from a *believed-visible* spider; when no
  spider is believed visible, `believedSpiderCell` is null and the function returns the fly's
  *current* cell unchanged (it holds still). No wandering exists today.
- Spider: always chases the nearest believed-visible fly (`planSpiderPath`/`greedySpiderApproach`);
  when no fly is believed visible, it also holds its current cell. No spider-vs-spider awareness
  exists (multiple spiders can already occur via egg-hatching, but nothing about a second spider
  currently affects a spider's own move).
  provenance
- Mass: only flies carry `mgx:mass` (`FLY_INITIAL_MASS = 10`, decrementing by
  `FLY_MASS_DECREMENT_PER_TURN = 1` every tick, `runEcologyPass`'s starve check removes a fly at
  mass ≤ 0). Spiders carry no mass at all; eating only increments `mgx:flies-eaten` (a pure count,
  used solely for the egg-laying threshold) — no mass transfer exists.
- The web is today a single STATIC zone: `WEB_HOME = {x:2,y:2}`, `WEB_RADIUS = 1`
  (`src/domain/spider-fly-world.mjs`), and `isInWebBlock(x,y)` is the fixed eat-precondition gate.
  There is no dynamic, spider-placed, time-limited web.
- Both flies' initial placement (`startSpiderFlyGame`) and the ecology pass's spawn step
  (`runEcologyPass` §5) pick a *deterministic* perimeter cell (an index formula / "first
  uncontested cell in `perimeterCells()`'s fixed order"), not a random one.

### A.2 Design

**Seeded randomness, not `Math.random()`.** Every "random" decision below is
`mulberry32(fnv1a32(`${WORLD_NAME}:${turn}:${subjectId}:${purpose}`))()` — the same
hash-of-(context)-seeds-a-PRNG idiom `answer-variants.mjs` already uses. This keeps spider-fly
fully deterministic and replayable (the `games/spider-fly` corpus lane and any future `--replay`
check depend on this): two runs from the same starting facts produce the byte-identical sequence
of "random" choices, because the seed is derived from data already in the facts (turn number,
subject id), never wall-clock or an unseeded generator.

**A.2.1 Fly movement — wander when blind, evade when sighted.**
`greedyFlyMove(flyCell, believedSpiderCell, applyActions, turn, flyId)`: unchanged when
`believedSpiderCell` is non-null (evade, exactly as today). When null, a new `randomFlyWander`
picks uniformly among `[flyCell, ...findReachableSet(flyCell, applyActions, {maxDepth:1})]` using
the seeded draw above (purpose `"wander"`) — the same one-ply reachable-set `bestOneStepBy` already
walks, just picked randomly instead of scored. A fly immobilized by an active web (A.2.3) skips
this entirely and stays put regardless.

**A.2.2 Fly random placement.** `startSpiderFlyGame`'s initial fly placement and
`runEcologyPass`'s spawn step both switch from "first uncontested `perimeterCells()` entry" to a
seeded pick among the uncontested perimeter cells (purpose `"spawn"`, keyed on turn + the new
fly's own about-to-be-minted id so two spawns in the same tick never collide). Still fully
deterministic from the starting facts; looks random to a human watching.

**A.2.3 The dynamic web — build, trap, expire.**
A web is a new lightweight entity, `web-<n>`, written the same way an egg is: `mgx:currently-in
<cell>` + `mgx:web-built-at-turn <k>` (expiry is computed as `builtAtTurn + WEB_DURATION_TURNS`
(10) rather than stored redundantly — matches the egg's own `laid-at-turn` + a fixed delay
convention). `foldSpiderFlyState` gains a `webs: Map(webId -> {cell, builtAtTurn})` fold, mirroring
the existing `laidAtTurn` fold exactly. A cell has an active web when `isInWebBlock(x,y)` (the
original static zone, unconditionally always "webbed", unchanged) **or** some live `web-<n>` at
that cell has `builtAtTurn + WEB_DURATION_TURNS > currentTurn`. `hasActiveWebAt(x, y, state, turn)`
is the one new predicate both the eat-precondition and the fly's movement gate consult, so the
static home zone and dynamic webs are ONE concept from here on, not two.

Trap semantics: **before** a fly's movement step this tick, check `hasActiveWebAt` at the fly's
*current* (pre-move) cell. If true, the fly's move is forced to "stay" — evasion and wandering are
both skipped. This matches "a fly entering a web location can no longer move": the turn it *enters*
the cell it can still have been evading/wandering (the web didn't exist at its old cell, or did but
it wasn't there yet); the turn it is discovered sitting in an active web, it's stuck.

Build semantics: "a spider holding position may build a web" — a spider builds (mints a fresh
`web-<n>` at its own current cell, `builtAtTurn = k`) exactly when this tick's move-decision
resolved to "hold position" (A.2.4's third branch), UNLESS an unexpired web it itself would be
re-planting already covers that exact cell (never double-mint the same cell/turn). No randomness
here — building is the deterministic consequence of holding position, not a coin flip; "may" reads
as "is now able to, where nothing could before," not as an optional per-turn dice roll, so it's
simpler and more predictable to make it unconditional.

**A.2.4 Spider priority: avoid spiders > chase flies > hold (and web).**
Per-tick, per spider: (1) if `nearestBelievedTarget` among *other live spiders* is non-null, move
to the one-ply reachable cell that **maximizes** Chebyshev distance from it (the same
`bestOneStepBy` kernel `greedyFlyMove` already uses, mirrored for spider-vs-spider — a new
`greedySpiderAvoid`); (2) else if a fly is believed visible, chase exactly as today
(`planSpiderPath`/`greedySpiderApproach`, unchanged); (3) else hold position and build/refresh a
web there (A.2.3). Rule (1) takes priority over (2) on the operator's own word order ("move away
from other spiders if there is a spider in sight and towards flies") and because a spider that is
itself food-competition-avoidant first, then predatory, then idle is the more defensible reading
when both a spider and a fly are simultaneously visible — recorded here as a judgment call, not a
certainty, since the instruction did not disambiguate the tie case explicitly.

**A.2.5 Mass symmetry.**
`SPIDER_INITIAL_MASS` (new constant, starting value 15 — spiders start heavier than a single fly's
worth on purpose, so a spider that eats nothing for a while has some runway before starving;
tunable, not fixed, same "starting value" framing the existing mass constants already carry) is
written for `spider-1` at game start and for every newly-hatched spider (the egg-hatch write,
`runEcologyPass` §4). Every spider's mass decrements by
`SPIDER_MASS_DECREMENT_PER_TURN` (new constant, starting value 1, same rate as a fly's for now) each
tick, in the same movement-write pass flies already decrement in. A spider at mass ≤ 0 is removed
(`mgx:starved`) by the SAME starve check `runEcologyPass` §2 already runs over flies — generalized
to iterate spiders too, in the same fixed pass order (eat still resolves first, so a spider that
eats on the exact tick it would otherwise starve survives on the strength of that meal, mirroring
how a fly claimed by an eat this turn cannot also separately starve).

**A.2.6 Eating gain — exactly the fly's remaining mass, not a flat bonus.**
The eat step (`runEcologyPass` §1) already knows the eaten fly's id; it reads that fly's
`postMoveMassByFly` value (the fly's mass AFTER this tick's decrement, the same number the starve
check would have compared against zero) and writes the eating spider's new mass as
`priorSpiderMass + eatenFlyMass`, clamped to not exceed some sane ceiling only if one turns out to
be needed in practice (none is designed here — uncapped growth is the honest reading of "gains its
mass", and nothing in the brief calls for a ceiling). The existing `mgx:flies-eaten` COUNT stays,
unchanged, as the egg-laying threshold's own input — mass and the eaten-count are two different
ledgers from here on, not one.

### A.3 Files touched

`src/services/spider-fly.mjs` (the bulk: `randomFlyWander`, `greedySpiderAvoid`, the web fold +
`hasActiveWebAt`, the priority-ordered per-spider tick loop, spider mass read/write/starve/gain),
`src/domain/spider-fly-world.mjs` (`WEB_DURATION_TURNS`, `SPIDER_INITIAL_MASS`,
`SPIDER_MASS_DECREMENT_PER_TURN` constants — kept beside the existing grid constants, same file),
`src/services/spider-fly-viz.mjs` (render the new mass bars for spiders too, not just flies, and
draw active dynamic webs distinctly from the static home zone — small, additive rendering changes),
`test/services/spider-fly.test.mjs` + `test/corpus/games/spider-fly.jsonl` (new coverage: wander
looks random but replays byte-identical from a fixed seed/turn/subject; spider-avoids-spider;
web-traps-fly; web-expires-after-10-turns; spider starves; eat transfers exact remaining mass).

## Part B — the adventure game's graphical web presence + goal-inferring auto-play

### B.1 What exists today (confirmed live)

No adventure web page exists at all (`public/` has `index.html`, `ledger.html`, `plan.html`,
`spider-fly.html` — no `adventure.html`). `src/domain/sprite-map.mjs`'s registry only carries
`spider/fly/egg/poodle/dog/animal` — none of Ashcombe Hall's classes (`room`, `furniture`,
`portable`, `person`, `adventurer`) are registered yet, though the resolver itself (ancestor-walk
over `rdfs:subClassOf`/`rdf:type` edges) is already fully general and needs no code change to
serve a new domain, only new registry entries. `src/services/adventure.mjs` already exports
exactly the read functions a renderer needs without any new plumbing: `foldWorldState`,
`roomAffordances`, `worldDigestRows`. There is no structured "this is the goal" fact anywhere in
`corpus/worlds/src/ashcombe-hall.jsonl` — the only signal a human player gets is the opening line's
prose, "Somewhere in this house is a letter meant for you." The win condition itself is simple and
already fixed: taking the letter (`archive/PLAN_ADVENTURE.md`'s own worked example: `take the
letter -> success; the win condition`).

`src/domain/router/goal-reasoner.mjs` **is a different system with a coincidentally similar name**
— checked directly. It is the code-graph capability router's BDI meta-loop for code-health
questions ("does an impactful module lack a test"), built on `GOAL_RULES`/`backwardChain`/the
registry's capabilities. Nothing about it is about a text-adventure world model, and it is not
reused here; the auto-play goal-inference below is purpose-built.

### B.2 Design — the graphical room renderer

`src/services/adventure-viz.mjs` (new, styled directly after `spider-fly-viz.mjs`'s self-contained
page-builder: inlined `<style>` importing `THEME_TOKENS_CSS`/`SERIF_STACK`/`MONO_STACK`/
`escapeHtml`/`embedJson` from `viz-theme.mjs`). Given a room id + the current fold, it renders:

- the room as a low-res background block (a flat-tinted rectangle, no photographic/detailed art —
  "low-res like spider fly" reads as "the same small-inline-SVG, geometric aesthetic," not a literal
  pixel-art renderer);
- every object `roomAffordances` already reports as present and visible in that room (the SAME
  visibility rule the text response already obeys — a hidden-in-a-closed-container object is never
  drawn, exactly as it's never narrated), each positioned on a simple grid inside the room block and
  drawn via `resolveSpriteForClass`;
- the player's own `adventurer` sprite in the room;
- a caption strip reusing the exact digest text `worldDigestRows`/the chat reply already produce, so
  the graphical page is never a second, divergent source of truth about what's true in the room —
  it draws what the text already says, never more.

New sprite registry entries (`src/domain/sprite-map.mjs`, purely additive): `room`, `furniture`,
`portable`, `person`, `adventurer`, `container` — generic class-level icons; any individual object
(`desk`, `cabinet`, `lamp`, `portrait`, `letter`, `key`, `butler`, `housekeeper`, …) falls back to
its nearest registered ancestor automatically via the existing resolver, exactly the mechanism this
registry was designed for. No per-object bespoke sprites in this pass — the fallback IS the design,
proven already by the spider-fly `poodle`/`dog`/`animal` chain.

### B.3 Design — goal inference and auto-play, respecting exposure

**Exposure**, the hard constraint ("only the information the player has been exposed to"), is
computed, never separately tracked as new written state: `exposedRoomIds` is the set of rooms the
auto-play run has actually moved into (starting room included, turn 0) — auto-play already knows
this, since it is the one making every move. `exposedFacts(allRows, exposedRoomIds)` is a pure
filter: a fact is exposed when its subject's current placement (`visibleRoomOf`, already exported
in spirit by `foldWorldState`'s placement map) resolves into `exposedRoomIds`, OR the subject is
`player` itself, OR the fact is the world's opening-line-declared objective marker (told to the
player at turn 0 unconditionally, by construction — see below). A hidden object (`mgx:hidden-in` a
closed container) is exposed only once that container has actually been opened in an exposed room —
the SAME reveal this project's `open` command already performs for a human player, read here rather
than reimplemented.

**The objective marker** — new, small, additive world-pack fact:
`{"world":"ashcombe-hall","kind":"fact","subject":"letter","predicate":"mgx:is-objective","object":"true"}`
alongside the letter's existing two facts. This does not tell the auto-play agent anything a human
player doesn't already learn from the opening line — it is the same information ("there is a
sought-after letter somewhere") made machine-legible instead of only human-legible prose. Any
world that ships no `mgx:is-objective` fact simply has no inferable goal for auto-play (an honest
"can't infer a goal for this world" state, not a guess) — this is deliberately generic, not
hard-coded to Ashcombe Hall's letter specifically.

**One auto-play tick** (`runAdventureAutoplayTick`, new — a sibling module,
`src/services/adventure-autoplay.mjs`, importing `adventure.mjs`'s exports rather than editing that
file, both to keep this a clean additive layer and to avoid colliding with this session's
in-flight rule-shape work on `adventure.mjs`):

1. Fold the world, compute `exposedRoomIds` from the auto-play session's own move history (an
   array the caller threads through, exactly like spider-fly's `agents` return shape threads state
   turn to turn) and `exposedFacts` from that.
2. **Goal inference**: find an `mgx:is-objective` individual in `exposedFacts` that
   `carriedByPlayer` says the player does not yet hold.
   - Not found at all (no objective fact exposed yet, or none exists in this world): the goal is
     **explore** — pick the lowest-sorted exit (`mgx:has-exit-*`) from the current room that leads
     to a room NOT in `exposedRoomIds` yet; if every exit from the current room leads somewhere
     already exposed, backtrack toward the nearest room (by `findActionPath` over the EXPOSED
     exit-graph only — auto-play can never path through an edge it hasn't seen) that still has an
     unexposed exit. No such room exists (the whole reachable-and-exposed world is exhausted with no
     objective ever found): auto-play reports an honest stall, same "no plan found" shape
     `findActionPath` already returns elsewhere, never a fabricated move.
   - Found, and exposed with a known room (a placement fact for it is in `exposedFacts`, whether
     visible directly or revealed by an opened container): the goal is **fetch** — `findActionPath`
     over the exposed exit-graph from the current room to the objective's room; once co-located,
     `take`.
   - Found, but its room still unknown (still hidden inside a closed or locked container): the goal
     is **progress a known container** — every `mgx:is-container` subject whose OWN placement is
     exposed (its room has been visited, even though its contents stay hidden) is a candidate. An
     unlocked, still-closed one is opened outright (opening can only ever reveal more, never a wrong
     guess); a locked one whose instrument (`mgx:unlocks-with`) is exposed and already carried is
     unlocked; a locked one whose instrument's own room is known but not yet carried gets that
     instrument fetched first (the same fetch logic, recursively, for the instrument instead of the
     objective). This is what actually lets auto-play reach a letter sitting behind Ashcombe Hall's
     locked cabinet — without it, "revealed by an opened container" above could never happen, since
     nothing ever issued `open` or `unlock` at all.
   - Found, but already carried: **win** — auto-play reports done, no further move.
3. Execute exactly the FIRST step of whatever plan step 2 produced (one `go <direction>`, one
   `take <object>`, one `open <container>`, or one `unlock <container> with <instrument>`) through
   the ordinary `runWorldCommand` path — auto-play is a caller of the existing command interpreter,
   not a second one.
4. Return the same shape spider-fly's tick already returns (`{turn, goal, plan, done}}`-ish) so the
   viz page's ticker can show a goal line and step count the way spider-fly's page already does.

**The ticker control**: `src/services/viz-ticker.mjs` (already built and already shared by
spider-fly's page and the guess-number retrofit) is reused unmodified for the adventure page's
Play/pause/step control — this is exactly the "one shared primitive, reused on demonstrated second
use" pattern this session's own Phase-5 decision (`archive/PLAN_ADVENTURE.md`) just confirmed
across three prior systems; adventure auto-play is the fourth.

### B.4 Home page + full-screen page

`src/surfaces/web/adventure-browser-entry.mjs` + `scripts/build-adventure-bundle.mjs` (mirroring
`build-spider-fly-bundle.mjs` exactly), wired into `scripts/build-demo-site.mjs`'s step sequence
alongside the spider-fly build step, writing `public/adventure.html`. `.adventure-hero` `<div>` +
`<iframe src="./adventure.html">` + "open full-screen →" link added to `index.html`, following the
shipped `.spider-fly-hero` pattern exactly, positioned per whatever ordering
`e2e/pages-index.test.mjs` already asserts (extend that assertion for the new hero, same as
spider-fly's own e2e coverage did).

### B.5 Files touched

New: `src/services/adventure-viz.mjs`, `src/services/adventure-autoplay.mjs`,
`src/surfaces/web/adventure-browser-entry.mjs`, `scripts/build-adventure-bundle.mjs`. Additive
edits: `src/domain/sprite-map.mjs` (new registry entries), `corpus/worlds/src/ashcombe-hall.jsonl`
(+1 fact, regenerate the worlds pack), `scripts/build-demo-site.mjs` (+1 build step),
`public/index.html` (+1 hero embed), `e2e/pages-index.test.mjs` (+1 assertion block). New tests:
`test/adapters/adventure-viz.test.mjs`, `test/services/adventure-autoplay.test.mjs` (goal inference
across explore/fetch/win states; exposure never leaks an unvisited room's facts into a decision —
the one test this feature's whole safety property rests on).

## Sequencing

Both parts build before this session's remaining playtest rounds (Stage 5: 5 adventure + 5
spider-fly rounds), per operator instruction, so those rounds exercise the uplifted games, not the
pre-uplift ones. Part A has no file overlap with this session's in-flight adventure rule-shape work
and can build immediately. Part B reads `adventure.mjs`'s exports but does not edit that file, so it
is safe to build in parallel too, EXCEPT the final merge should land after the in-flight rule-shape
work merges to `main`, so Part B's own tests run against the rule-shape work's final shape of
`adventure.mjs` rather than a stale one.

## Non-goals for this pass

- Not a full graphical adventure engine — the renderer draws exactly what the text digest already
  says, never a richer or divergent scene.
- Not a general-purpose goal-inference framework — one objective-marker predicate
  (`mgx:is-objective`), one win condition (carry it). A world with a multi-step or conjunctive goal
  is a further increment, not solved here.
- Not a redesign of spider-fly's belief/told-fact chat-integration seam — webs and mass ride the
  same ground-truth/vision-radius belief model already shipped; a player CHAT-telling an agent about
  a web is not wired in this pass.
