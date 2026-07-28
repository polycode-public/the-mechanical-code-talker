// adventure-viz.mjs — the adventure's own full-screen/home-page hero
// (PLAN_GAMES_UPLIFT_V2.md Part B), styled directly after
// spider-fly-viz.mjs's own self-contained page-builder: one inlined <style>
// importing viz-theme.mjs's shared tokens, behaviour as an inlined IIFE, the
// shared `createTicker` primitive spliced in via `.toString()` exactly the
// way that page splices its own render-glue helpers.
//
// Where this page's data-loading DIVERGES from spider-fly's, on purpose:
// spider-fly-world.mjs is itself a plain, dependency-free JS module (no I/O),
// so its browser entry can call it directly to bootstrap a board. Ashcombe
// Hall's canonical definition is a JSONL corpus source
// (corpus/worlds/src/ashcombe-hall.jsonl), read through a Node fs/gzip
// provider the browser cannot run. Rather than hand-duplicating the world as
// a second, hardcoded JS copy (exactly the kind of drift this project's
// worlds-pack build step exists to prevent), the real facts+rules are read
// ONCE at build time (scripts/build-demo-site.mjs, the same Node path
// test/services/adventure.test.mjs's own loadShippedWorldInto uses) and
// embedded into this page as plain JSON — the same posture ledger.html
// already takes with its own precomputed memory payload, just applied to a
// second kind of build-time data.
//
// Eight pure, `.toString()`-splice-safe pieces are exported as real functions
// (not raw inline-script text) so they can be pinned directly by tests, the
// same discipline spider-fly-viz.mjs holds classOfAgentId/
// threadCellsForSpiderPlan to: `spriteClassForObject` (an object's sprite
// class, from its own rdf:type or mgx:is-container fact), `visibleRoomOf`
// (the room a subject's placement resolves into, for visibility — mirroring
// adventure.mjs's own private `visibleRoomOf` the same way
// adventure-autoplay.mjs's own `roomOfSubject` already has to), `roomSceneObjects`
// (every subject actually visible in a room, built over `visibleRoomOf`),
// `scenePlacement` (an object's rendering plane and, if stacked, what it
// rests on — instance on-top-of/on-plane facts, then a class-default
// ancestor walk, then floor), `roomSceneLayout` (the room split into a wall
// band and floor stacks, over `roomSceneObjects` and `scenePlacement`),
// `roomKindForRoom` (a room's border treatment, from its own rdf:type),
// `carriedItems` (every object placed with the player), `exitDoorways` (the
// written ways out of one room, in compass order, each marked with whether
// this session has walked it — what the room view's own door plates are
// drawn from), and `visitedRoomGraph`
// (a directions-only layout of the rooms a session has actually visited —
// see its own header for the exposure discipline). None of these import
// anything beyond this module's own exports, which is what keeps a raw
// `.toString()` splice safe. Three further pure helpers are exported for
// testing but NOT spliced, because each calls another module's export the
// in-page script instead reaches through the browser bundle's own
// `tmctAdventure` global (mirroring how the inline script calls
// `tmctSpiderFly.*` rather than re-importing spider-fly-world.mjs):
// `roomCaptionText` (calls `worldDigestRows`; the in-page `captionFor`
// mirrors it against `tmctAdventure.worldDigestRows`), `pillsForRoom` (a thin
// wrapper over adventure.mjs's own exported `roomAffordances`, whose header
// explains why its list can never promise an action one of take/open/talk/
// examine would then refuse; the in-page `pillsFor` mirrors it against
// `tmctAdventure.roomAffordances`), and `goalStatusLines` (calls
// `foldWorldState` and adventure-autoplay.mjs's own `exposedFacts`; the
// in-page `goalStatusLinesFor` mirrors both against the `tmctAdventure`
// global too).
//
// The chat dock (chatlog/chatform/chatq/pills, below) mirrors
// spider-fly-viz.mjs's own side panel: every manual exchange (via
// adventure-browser-entry.mjs's new `session.turn(line)`) and every
// auto-play tick's own narration append to the SAME scrolling `#chatlog`, so
// a visitor sees one continuous history rather than a line overwritten every
// tick. `#caption`/`#goalLine` keep their existing job as the current-state
// summary; the chat log is the persistent addition.
//
// The chat dock is the whole of `.side`; carrying (`carriedItems`), the
// visited-room map (`visitedRoomGraph`) and goal status (`goalStatusLines`)
// render into their own panels in `.stage-left` instead, alongside the room
// view and its controls — all three read `session.snapshot()`'s own
// `visitedRoomIds`, the manual+auto-play exposure set
// adventure-browser-entry.mjs threads forward (see that module's header for
// why the two paths share one set rather than two).
//
// Edit mode (PLAN_GAMES_UPLIFT_V3.md Part C.4 item 4's operator addendum)
// adds: `allRoomIds` (every room the world defines, feeding the SAME
// `visitedRoomGraph` layout play mode's visited-only map already uses, just
// with the visitation filter dropped — a parameter, not a second map
// implementation), `suggestionsForTerm` (cursor-driven pills, calling
// adventure-editor.mjs's `wordBeforeCursor` plus skos-view.mjs's
// `relatedForTerm` and sprite-map.mjs's `classAncestorChain` — NOT spliced,
// for the same reason roomCaptionText/pillsForRoom aren't, see below), and
// `renderWorldEditorText`/`wordBeforeCursor` (adventure-editor.mjs's own
// splice-safe render/cursor helpers, spliced in directly). The store writes
// an edit implies run through the browser bundle's own `session.applyEdit`
// (adventure-browser-entry.mjs), never here — this module only renders and
// reads.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import { worldDigestRows, roomAffordances, foldWorldState } from "./adventure.mjs";
import { exposedFacts } from "./adventure-autoplay.mjs";
import { relatedForTerm } from "../domain/skos-view.mjs";
import { classAncestorChain } from "../domain/sprite-map.mjs";
import { renderWorldEditorText, wordBeforeCursor } from "./adventure-editor.mjs";

const DEFAULT_TITLE = "tmct — the adventure";
const PREVIEW_MAX_TICKS = 30;
const TICK_WAIT_MS = 900;

/** An object's sprite class: `container` when it carries mgx:is-container
 *  (a distinct icon from plain furniture, since Ashcombe's own cabinet and
 *  portrait are typed "furniture" but read more clearly as a container on
 *  screen), else its own rdf:type object, else the generic "portable"
 *  fallback for anything a world places with no type fact at all. Pure,
 *  self-contained — no reference to adventure.mjs's own private isContainer/
 *  isTyped, since those aren't exported. */
export function spriteClassForObject(rows, subject) {
  const isContainer = (rows || []).some(
    (r) => r.subject === subject && r.predicate === "mgx:is-container" && r.object === "true",
  );
  if (isContainer) return "container";
  const typeRow = (rows || []).find((r) => r.subject === subject && r.predicate === "rdf:type");
  return typeRow ? typeRow.object : "portable";
}

/** `rows` plus synthetic rdfs:subClassOf edges covering `subject`'s whole
 *  class chain — never written back to the corpus, just handed to
 *  sprite-templates.mjs's resolver so a NAMED object (`cabinet`, `butler`)
 *  can carry its own sprite template while an unauthored object of the same
 *  class still falls back cleanly, one ancestor at a time, to the nearest
 *  ancestor that HAS a sprite. Two kinds of edge are synthesized: one from
 *  the subject's own name to its declared sprite class
 *  (spriteClassForObject's own result), and one mirroring every `rdf:type`
 *  hop further up the chain. The mirroring is what makes the fallback reach
 *  past the first hop: the resolver walks rdfs:subClassOf only, so a world
 *  that writes `turnip rdf:type vegetable` would otherwise stop at `turnip`
 *  and skip a perfectly good `vegetable` sprite. Ashcombe Hall's own objects
 *  have no rdfs:subClassOf chain at all (each is directly typed, e.g.
 *  `cabinet rdf:type furniture`); this is the same ancestor-walk mechanism
 *  spider-fly's real poodle-IsA-dog taxonomy already exercises, synthesized
 *  at render time for a world whose taxonomy doesn't reach that deep. Returns
 *  `rows` itself when there is nothing to synthesize. Pure. */
export function spriteAncestryRows(rows, subject) {
  const declaredClass = spriteClassForObject(rows, subject);
  const synthesized = [];
  if (subject !== declaredClass) synthesized.push({ subject, predicate: "rdfs:subClassOf", object: declaredClass });
  const seen = new Set([subject]);
  const queue = [declaredClass];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const row of rows || []) {
      if (row.subject !== node || row.object === node) continue;
      if (row.predicate === "rdf:type") synthesized.push({ subject: node, predicate: "rdfs:subClassOf", object: row.object });
      else if (row.predicate !== "rdfs:subClassOf") continue;
      queue.push(row.object);
    }
  }
  return synthesized.length ? [...(rows || []), ...synthesized] : rows;
}

/** Every fact row belonging to `subject` — the small `{predicate, object}`
 *  set sprite-templates.mjs's resolver checks a parameterized/match template
 *  against (e.g. an mgx:hasProperty row). Pure. */
export function factsForSubject(rows, subject) {
  return (rows || []).filter((r) => r.subject === subject);
}

/** The room a subject's placement resolves into, for VISIBILITY — a room
 *  resolves to itself; an object placed directly in a room resolves to that
 *  room; an object one containment hop inside an OPEN container resolves to
 *  the container's own room; anything hidden, carried, or inside a closed
 *  container resolves to null. Mirrors adventure.mjs's own private
 *  `visibleRoomOf` / adventure-autoplay.mjs's own private `roomOfSubject`
 *  exactly, against whatever rows/state pair the caller hands it: feeding it
 *  the full fold (as `roomSceneObjects` does, since the player is already
 *  standing in the room being drawn) lets an open container's contents show;
 *  feeding it an exposure-filtered pair (as `goalStatusLines` does) is what
 *  keeps a not-yet-visited location unknown. Pure, self-contained — no
 *  reference to adventure.mjs's own private helpers, since those aren't
 *  exported. */
export function visibleRoomOf(rows, state, subject) {
  const isRoom = (id) => (rows || []).some((r) => r.subject === id && r.predicate === "rdf:type" && r.object === "room");
  if (isRoom(subject)) return subject;
  const place = state.placements.get(subject);
  if (!place || place.predicate === "mgx:hidden-in") return null;
  if (place.predicate === "mgx:currently-in" || isRoom(place.object)) return place.object;
  const holder = place.object;
  if (holder === "player") return null;
  if (!state.openness.get(holder)?.open) return null;
  const holderPlace = state.placements.get(holder);
  return holderPlace && holderPlace.predicate !== "mgx:hidden-in" ? holderPlace.object : null;
}

/** Every subject actually visible in `here`, sorted, each with its sprite
 *  class — built over `visibleRoomOf` (one containment hop through an OPEN
 *  container) so this can never draw a hidden or carried object the text
 *  digest wouldn't also mention. `player` is excluded; the caller draws the
 *  player's own adventurer sprite separately. Pure. */
export function roomSceneObjects(rows, state, here) {
  const out = [];
  for (const subject of [...state.placements.keys()].sort()) {
    if (subject === "player") continue;
    if (visibleRoomOf(rows, state, subject) !== here) continue;
    out.push({ subject, spriteClass: spriteClassForObject(rows, subject) });
  }
  return out;
}

/** Where `subject` renders in its room's scene: `{plane, stackedOn}`, plane
 *  one of "floor"/"surface"/"wall"/"ceiling". Resolution order: a CURRENT
 *  `mgx:on-top-of` row (plane "surface", `stackedOn` the object rested on) —
 *  "current" meaning its own newest turn is at least as new as `subject`'s
 *  own newest PLACEMENT turn (`state.placements`), so `take lamp` off a desk
 *  auto-invalidates a stale `lamp mgx:on-top-of desk` row with no extra
 *  write, the same staleness rule `foldWorldState` already applies within
 *  its own placement map; then a current `mgx:on-plane` row (its own object
 *  taken as the plane verbatim); then a class default, found by a breadth-
 *  first walk up `rdfs:subClassOf` edges FIRST (a directly-taxonomized
 *  individual such as "portrait rdfs:subClassOf painting", to its own
 *  superclass) for the first `mgx:default-plane` fact, falling back to a
 *  second walk that also follows `rdf:type` edges (an individual to its
 *  generic rendering class) only if the first finds nothing — a specific
 *  taxonomic fact about the individual must outrank its own coarser
 *  `rdf:type`, or which ancestor's default wins becomes an accident of fact
 *  order rather than a taxonomy decision; a DIFFERENT ancestor walk from
 *  sprite-map.mjs's own `classAncestorChain` (subClassOf-only, and an import
 *  this function can't take and stay `.toString()`-splice-safe); then the
 *  floor. Pure, fully self-contained in its own function body (no
 *  reference to any other name in this module) — reads `rows` fresh rather
 *  than a precomputed `positions` map, so it needs nothing beyond what
 *  `foldWorldState` already exposes on `state.placements`. */
export function scenePlacement(rows, state, subject) {
  const snapshotRe = /^(.+)@turn(\d+)$/;
  function newestRowFor(predicate) {
    let best = null;
    for (const row of rows || []) {
      if (row.predicate !== predicate) continue;
      const m = snapshotRe.exec(row.subject);
      const base = m ? m[1] : row.subject;
      if (base !== subject) continue;
      const turn = m ? Number(m[2]) : 0;
      if (!best || turn >= best.turn) best = { object: row.object, turn };
    }
    return best;
  }
  // Two passes, not one BFS over both edge kinds at once: an individual
  // directly `rdfs:subClassOf` a class (e.g. "portrait rdfs:subClassOf
  // painting") is a deliberate, specific taxonomic fact and must win over
  // its own, more generic `rdf:type` (e.g. "portrait rdf:type furniture",
  // the coarse sprite/rendering category) whenever BOTH ancestors carry
  // their own `mgx:default-plane` — a single combined-edge walk would
  // instead return whichever ancestor happens to appear earlier in the
  // fact rows, an accident of file order rather than a taxonomy decision.
  function walkForDefaultPlane(edgePredicates) {
    const seen = new Set([subject]);
    const queue = [subject];
    while (queue.length) {
      const node = queue.shift();
      const defaultRow = (rows || []).find((r) => r.subject === node && r.predicate === "mgx:default-plane");
      if (defaultRow) return defaultRow.object;
      for (const row of rows || []) {
        if (row.subject !== node || !edgePredicates.includes(row.predicate)) continue;
        if (!seen.has(row.object)) { seen.add(row.object); queue.push(row.object); }
      }
    }
    return null;
  }
  function classDefaultPlane() {
    return walkForDefaultPlane(["rdfs:subClassOf"]) ?? walkForDefaultPlane(["rdf:type", "rdfs:subClassOf"]);
  }
  const placementTurn = state?.placements?.get(subject)?.turn ?? 0;
  const onTopOf = newestRowFor("mgx:on-top-of");
  if (onTopOf && onTopOf.turn >= placementTurn) return { plane: "surface", stackedOn: onTopOf.object };
  const onPlane = newestRowFor("mgx:on-plane");
  if (onPlane && onPlane.turn >= placementTurn) return { plane: onPlane.object, stackedOn: null };
  const defaultPlane = classDefaultPlane();
  if (defaultPlane) return { plane: defaultPlane, stackedOn: null };
  return { plane: "floor", stackedOn: null };
}

/** The room scene laid out for drawing: `{wall, floor}`. `wall` is every
 *  wall- or ceiling-mounted visible object (deterministic, subject order).
 *  `floor` is one entry per floor-standing stack, `{items: [top..base]}` —
 *  a `mgx:on-top-of` chain is resolved transitively (an item on an item on a
 *  floor base becomes one three-level stack), and an item whose own
 *  `stackedOn` target is not itself VISIBLE in this room (or is itself
 *  wall/ceiling-mounted, so has no floor footprint to stack onto) demotes to
 *  its own single-item floor stack rather than vanishing. Built over
 *  `roomSceneObjects` and `scenePlacement`, so it can never draw an object
 *  the flat room view wouldn't already show. Pure. */
export function roomSceneLayout(rows, state, here) {
  const objects = roomSceneObjects(rows, state, here);
  const bySubject = new Map(objects.map((o) => [o.subject, o]));
  const placementOf = new Map(objects.map((o) => [o.subject, scenePlacement(rows, state, o.subject)]));

  const wall = [];
  const stackedOnBy = new Map(); // base subject -> [subjects resting directly on it]
  const bases = [];

  for (const o of objects) {
    const placement = placementOf.get(o.subject);
    if (placement.plane === "wall" || placement.plane === "ceiling") { wall.push(o); continue; }
    const targetPlacement = placement.stackedOn ? placementOf.get(placement.stackedOn) : null;
    const targetHasFloorFootprint = targetPlacement && targetPlacement.plane !== "wall" && targetPlacement.plane !== "ceiling";
    if (placement.plane === "surface" && placement.stackedOn !== o.subject && targetHasFloorFootprint) {
      if (!stackedOnBy.has(placement.stackedOn)) stackedOnBy.set(placement.stackedOn, []);
      stackedOnBy.get(placement.stackedOn).push(o.subject);
      continue;
    }
    bases.push(o.subject);
  }

  wall.sort((a, b) => a.subject.localeCompare(b.subject));
  bases.sort((a, b) => a.localeCompare(b));
  for (const list of stackedOnBy.values()) list.sort((a, b) => a.localeCompare(b));

  const visitedForStack = new Set();
  function stackFrom(base) {
    if (visitedForStack.has(base)) return [];
    visitedForStack.add(base);
    const items = [];
    for (const child of stackedOnBy.get(base) || []) items.push(...stackFrom(child));
    items.push(bySubject.get(base));
    return items;
  }

  return { wall, floor: bases.map((base) => ({ items: stackFrom(base) })) };
}

/** A room's kind for its border treatment: "outdoor" (`rdf:type
 *  outdoor-space`), "underground" (`rdf:type underground-space`), else
 *  "indoor" — the default, covering every room the current shipped world
 *  defines. Pure, self-contained. */
export function roomKindForRoom(rows, roomId) {
  const isRoomTyped = (kind) => (rows || []).some((r) => r.subject === roomId && r.predicate === "rdf:type" && r.object === kind);
  if (isRoomTyped("outdoor-space")) return "outdoor";
  if (isRoomTyped("underground-space")) return "underground";
  return "indoor";
}

/** Every object currently `mgx:located-in` "player", sorted, each with its
 *  sprite class — the exact placement `worldDigestRows`'/`inventoryAnswer`'s
 *  own "carries the" branch already reads, just returned as a plain list
 *  instead of prose. Pure. */
export function carriedItems(rows, state) {
  return [...state.placements]
    .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === "player")
    .map(([subject]) => ({ subject, spriteClass: spriteClassForObject(rows, subject) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** A visited-rooms-only map: one node per room `visitedRoomIds` actually
 *  names, laid out on an integer grid FROM the world's own has-exit-*
 *  directions — never a force-directed guess, so a room with a north exit to
 *  another visited room sits one row above it (up/down read the same way,
 *  since neither world this project ships gives a vertical exit its own
 *  lateral position). An edge is drawn only between two rooms BOTH already
 *  visited, mirroring adventure-autoplay.mjs's own exposedExitApplyActions:
 *  an exit fact belongs to the room whose subject it is, so it is only ever
 *  read off a VISITED room's own state.exits entry, never an unvisited
 *  room's. `hints` names every exit a visited room has toward a room not yet
 *  visited — the direction only, never the unvisited room's own name, so a
 *  caller can draw at most "there's an exit that way" and nothing more.
 *  Disconnected visited rooms (not reachable from each other by traveled
 *  edges) lay out as separate side-by-side blocks rather than overlapping.
 *  Pure. */
export function visitedRoomGraph(state, visitedRoomIds) {
  const DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1] };
  const visited = new Set(visitedRoomIds || []);
  const here = state.placements.get("player")?.object ?? null;
  const positions = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const hints = [];
  let offsetX = 0;
  for (const start of [...visited].sort()) {
    if (positions.has(start)) continue;
    positions.set(start, { x: offsetX, y: 0 });
    const queue = [start];
    const component = [start];
    while (queue.length) {
      const room = queue.shift();
      const pos = positions.get(room);
      const dirs = state.exits.get(room);
      for (const direction of [...(dirs?.keys() ?? [])].sort()) {
        const target = dirs.get(direction);
        if (!visited.has(target)) { hints.push({ from: room, direction }); continue; }
        const key = [room, target].sort().join("\0");
        if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ from: room, to: target, direction }); }
        if (!positions.has(target)) {
          const [dx, dy] = DELTA[direction] ?? [0, 0];
          positions.set(target, { x: pos.x + dx, y: pos.y + dy });
          component.push(target);
          queue.push(target);
        }
      }
    }
    offsetX = Math.max(...component.map((r) => positions.get(r).x)) + 2;
  }
  const minX = Math.min(0, ...[...positions.values()].map((p) => p.x));
  const minY = Math.min(0, ...[...positions.values()].map((p) => p.y));
  const nodes = [...visited].sort().map((room) => {
    const p = positions.get(room) || { x: 0, y: 0 };
    return { id: room, x: p.x - minX, y: p.y - minY, current: room === here };
  });
  return { nodes, edges, hints };
}

/** Every room the world DEFINES at all (every subject the fact rows type as
 *  `room`), regardless of whether the current session has ever visited it —
 *  the edit mode's own "whole map" is exactly `visitedRoomGraph(state,
 *  allRoomIds(rows))`: the SAME directional-grid layout play mode's visited-
 *  only map uses, just fed every room instead of the exposure-filtered set,
 *  so a room with no visited neighbour still lays out (as a disconnected
 *  block) rather than vanishing. Pure. */
export function allRoomIds(rows) {
  return [...new Set((rows || [])
    .filter((r) => r.predicate === "rdf:type" && r.object === "room")
    .map((r) => r.subject))];
}

/** One status line per exposed `mgx:is-objective` fact, using the SAME
 *  three-state logic adventure-autoplay.mjs's own goal inference already
 *  distinguishes, restricted to what `visitedRoomIds` actually supports:
 *  carried (the full, unfiltered state — carrying is always self-evidently
 *  known, the same unconditional exposure the marker fact itself gets);
 *  exposed with a known room (an `exposedFacts` filter, mirroring
 *  runAdventureAutoplayTick's own objectiveRoom lookup, so a location is
 *  never claimed before the room holding it has actually been visited); or
 *  not yet exposed at all (the opening-line-level knowledge every session
 *  gets unconditionally — the marker fact names the sought thing, nothing
 *  more). Pure. */
export function goalStatusLines(rows, state, visitedRoomIds) {
  const ids = [...new Set((rows || [])
    .filter((r) => r.predicate === "mgx:is-objective" && r.object === "true")
    .map((r) => r.subject))];
  const carriedIds = new Set(carriedItems(rows, state).map((o) => o.subject));
  const exposedRows = exposedFacts(rows, visitedRoomIds);
  const exposedState = foldWorldState(exposedRows);
  return ids.map((id) => {
    if (carriedIds.has(id)) return { subject: id, status: "carried", text: `carrying the ${id} — the adventure is won.` };
    const room = visibleRoomOf(exposedRows, exposedState, id);
    return room
      ? { subject: id, status: "known", text: `last known: the ${id} is in the ${room}.` }
      : { subject: id, status: "unknown", text: `there's a sought-after ${id} somewhere.` };
  });
}

/** Every written way out of `here`, in a fixed compass order, each with the
 *  room it leads to and whether this session has already walked there:
 *  `[{ direction, target, walked }]`. Only exits the world actually writes
 *  appear, so a doorway drawn from this list can never offer a `go` the
 *  engine would then refuse. `walked` reads the SAME visited set the manor
 *  map and the goal lines already do — the rooms the player has stood in, so
 *  marking a door as new tells them nothing they haven't earned. Ashcombe
 *  Hall teaches no `dig` action family, so unlike the burrow's own compass
 *  ring there is no second kind of way out to draw. Pure and
 *  `.toString()`-splice-safe. */
export function exitDoorways(state, here, visitedRoomIds) {
  const compass = ["north", "east", "south", "west", "up", "down"];
  const walked = new Set(visitedRoomIds || []);
  const exits = state.exits.get(here);
  if (!exits) return [];
  return compass.filter((direction) => exits.has(direction)).map((direction) => ({
    direction,
    target: exits.get(direction),
    walked: walked.has(exits.get(direction)),
  }));
}

/** The clickable command suggestions for the room the player is CURRENTLY
 *  in — a thin, testable wrapper over adventure.mjs's own `roomAffordances`
 *  (the exact same data take/open/talk/examine already check), so a pill can
 *  never promise an action one of those verbs would then refuse. Each
 *  returned string ("go north", "take lamp", "unlock cabinet", ...) is
 *  already a complete, submittable command in this world's own imperative
 *  grammar — the page inserts one into the chat input verbatim on click,
 *  never reformats it. Pure; recomputed fresh on every redraw, so a pill for
 *  a room the player has left, or an object already taken, never lingers. */
export function pillsForRoom(rows, state, here) {
  return roomAffordances(rows, state, here);
}

/** The chat input's grounding placeholder, built from an affordance list: the
 *  first couple of OBJECT commands (examine/take/open/unlock/talk to <thing>)
 *  spelled with the room's real props, so the empty input teaches the grounded
 *  noun form ("examine lamp, take letter…") rather than a bare pronoun the
 *  player has no antecedent for yet. `fallback` stands in when the list holds
 *  no object command (a room with only exits, or a just-emptied object dock).
 *  Pure and `.toString()`-splice-safe — the page splices it in and drives both
 *  input docks off it every redraw. */
export function groundedPlaceholder(actions, fallback) {
  const objectActions = (actions || []).filter((a) => /^(?:examine|take|open|unlock|talk to) /.test(a));
  if (!objectActions.length) return fallback;
  return objectActions.slice(0, 2).join(", ") + "…";
}

/** Edit mode's cursor-driven suggestion pills for one typed `term`: the
 *  lateral SKOS neighbourhood (`relatedForTerm`'s own synonyms/related
 *  concepts) plus the vertical rdfs:subClassOf ancestor chain
 *  (`classAncestorChain`, ancestors only — the term itself is dropped),
 *  deduplicated and capped so a well-connected term never floods the pill
 *  row. `[]` on an honest miss (neither lookup returns anything) — never a
 *  fabricated suggestion. NOT .toString()-splice-safe (it calls two other
 *  modules' exports) — the in-page script mirrors this same combination
 *  against the browser bundle's own `tmctAdventure.relatedForTerm`/
 *  `tmctAdventure.classAncestorChain`, the same reach-through-the-global
 *  pattern `pillsFor`/`captionFor` already use for their own adventure.mjs
 *  calls (see this module's header). */
export function suggestionsForTerm(rows, term) {
  const t = String(term || "").trim().toLowerCase();
  if (!t) return [];
  const out = [];
  const seen = new Set([t]);
  const push = (label) => { if (label && !seen.has(label)) { seen.add(label); out.push(label); } };
  const related = relatedForTerm(rows, t);
  if (related) {
    for (const syn of related.synonyms) push(syn);
    for (const rel of related.related) push(rel.prefLabel);
  }
  for (const ancestor of classAncestorChain(t, rows).slice(1)) push(ancestor);
  return out.slice(0, 8);
}

/** A short caption for `here`, built ONLY from the rows worldDigestRows
 *  itself already produces (the exact same view the chat reply's own digest
 *  reads) — every row already reads as a plain sentence
 *  (`${subject} ${predicate} ${object}.`), so this never invents a phrase
 *  the text digest doesn't already carry. Filters to rows about the room
 *  itself (its own exits) or about something placed IN it — the same
 *  "visible here" boundary `roomSceneObjects` draws from. The player's own
 *  "is in the" row is excluded: the room frame already IS the current room,
 *  so restating "you are here" is redundant, never informative. */
export function roomCaptionText(rows, state, here) {
  const hereCased = here.charAt(0).toUpperCase() + here.slice(1);
  const lines = worldDigestRows(rows, state)
    .filter((row) => row.subject !== "Player" && (row.object === here || row.subject === hereCased))
    .map((row) => `${row.subject} ${row.predicate} ${row.object}.`);
  return lines.length ? lines.join(" ") : `Nothing more about the ${here} is written down yet.`;
}

/** The self-contained adventure page. Pure given `worldPayload` (the build
 *  step's own read of the real Ashcombe Hall world — `{ facts, rules,
 *  opening }`), the same "byte-identical for identical input" invariant
 *  every other viz page in this project holds. `spriteTemplates` is the
 *  build step's own read of data/sprites/*.toml (sprite-template-files.mjs's
 *  readSpriteTemplateFiles), embedded as page data the same way the world
 *  payload is — the browser cannot read the filesystem, so the parsed
 *  templates travel as JSON rather than as a bundled fs read. Defaults to
 *  `[]` (every sprite falls back to the flat SPRITE_REGISTRY, unchanged from
 *  before this module existed) so existing callers that don't pass one keep
 *  working. `largeSpriteTemplates` is the gradient-shaded 400px tier
 *  (data/sprites-large/*.toml, the same resolved array
 *  scripts/build-demo-sprites-pack.mjs writes as its whole manifest) —
 *  embedded at build time exactly like the icon tier, so the page makes no
 *  runtime fetch for it; empty, the icon tier simply stays active, the same
 *  fallback the old lazy fetch degraded to. `?preview=1` switches into the
 *  small, auto-playing, non-interactive mode the home page's hero iframe
 *  embeds, matching spider-fly.html's own dual-purpose file.
 *  `engineBundleJs` (the built adventure-browser bundle's own text) inlines
 *  the engine into the page instead of the sibling `<script src>`, for the
 *  CLI's standalone export — one downloadable file that runs from file://
 *  with no sibling assets. Default empty keeps the site build's sibling-file
 *  arrangement byte-identical, favicon links included; the standalone export
 *  drops them too, since a relative ./favicon.svg would be a dangling
 *  external reference the "no sibling assets" export can't carry. */
export function renderAdventureHtml({
  title = DEFAULT_TITLE,
  worldPayload = { facts: [], rules: [], opening: "" },
  spriteTemplates = [],
  largeSpriteTemplates = [],
  engineBundleJs = "",
} = {}) {
  const pageData = embedJson({
    world: worldPayload,
    previewMaxTicks: PREVIEW_MAX_TICKS,
    tickWaitMs: TICK_WAIT_MS,
    spriteTemplates,
    largeSpriteTemplates,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${engineBundleJs ? "" : `<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">`}
<style>
${THEME_TOKENS_CSS}
  /* Murder-mystery board-game chrome — layered over the shared neutrals/
     accents above, never replacing them: taught/corpus/entail/alert stay the
     SAME provenance palette every other tmct viz page uses, repurposed here
     as the class-badge ring colors (hero/townsfolk/fixture/item) — a visitor
     who already knows what green/blue/gold/red means from ledger.html reads
     this page's "class" system for free. The page-local decorative tokens:
     parchment/gilt (the case-file paper and brass), baize (the board-game
     felt the manor map sits on), and wall/floor (the room scene's papered
     wall and parquet). */
  :root {
    --parchment: #ECE1C8; --parchment-strong: #E1D2A6; --gilt: #93701F;
    --baize: #4A6B52; --baize-line: #33503C; --board-path: #E7DAB8;
    --wall: #E9DDBE; --wall-stripe: rgba(147, 112, 31, .10);
    --floor-a: #D9C398; --floor-b: #CFB884;
    --sky: #BFE0EE; --hedge: #3F6B45;
    --stone: #6E6A63; --stone-b: rgba(110, 106, 99, .18);
    --stone-floor-a: #504C46; --stone-floor-b: #464340;
  }
  @media (prefers-color-scheme: dark) { :root {
    --parchment: #241E12; --parchment-strong: #2C2416; --gilt: #C0A054;
    --baize: #1E2C22; --baize-line: #4A6852; --board-path: #56604D;
    --wall: #262013; --wall-stripe: rgba(192, 160, 84, .07);
    --floor-a: #2B2314; --floor-b: #241E10;
    --sky: #16232B; --hedge: #2E4A33;
    --stone: #3A3834; --stone-b: rgba(255, 255, 255, .05);
    --stone-floor-a: #17150F; --stone-floor-b: #100E0A;
  } }
  :root[data-theme="dark"] {
    --parchment: #241E12; --parchment-strong: #2C2416; --gilt: #C0A054;
    --baize: #1E2C22; --baize-line: #4A6852; --board-path: #56604D;
    --wall: #262013; --wall-stripe: rgba(192, 160, 84, .07);
    --floor-a: #2B2314; --floor-b: #241E10;
    --sky: #16232B; --hedge: #2E4A33;
    --stone: #3A3834; --stone-b: rgba(255, 255, 255, .05);
    --stone-floor-a: #17150F; --stone-floor-b: #100E0A;
  }
  :root[data-theme="light"] {
    --parchment: #ECE1C8; --parchment-strong: #E1D2A6; --gilt: #93701F;
    --baize: #4A6B52; --baize-line: #33503C; --board-path: #E7DAB8;
    --wall: #E9DDBE; --wall-stripe: rgba(147, 112, 31, .10);
    --floor-a: #D9C398; --floor-b: #CFB884;
    --sky: #BFE0EE; --hedge: #3F6B45;
    --stone: #6E6A63; --stone-b: rgba(110, 106, 99, .18);
    --stone-floor-a: #504C46; --stone-floor-b: #464340;
  }

  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 920px; margin: 0 auto; padding: 1.4rem 1.2rem 2.2rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; color: var(--gilt); }
  .titlebar { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin: .3rem 0 1rem; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .mode-toggle { font-family: ${MONO_STACK}; font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; padding: .4rem .8rem; border: 1px solid var(--gilt); background: var(--parchment); color: var(--ink); white-space: nowrap; }
  .mode-toggle:hover:not(:disabled) { background: var(--parchment-strong); }
  .mode-toggle:disabled { opacity: .5; cursor: default; }

  /* the room-view + map column runs roughly two-thirds width, the manor's
     own account (chat log + pills + caption) a third. */
  .stage { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 1rem; align-items: start; }
  @media (max-width: 760px) { .stage { grid-template-columns: 1fr; } }

  /* the room's own opening prose, relocated (operator feedback) out of a
     bottom-of-page strip and into a spider-fly-style note directly under the
     titlebar — the same "sight-read the world before you touch anything"
     framing spider-fly.html's own header paragraph already gives its board. */
  .page-note { background: var(--parchment); border-left: 3px solid var(--gilt); padding: .6rem .85rem; font-size: .9rem; font-style: italic; margin: 0 0 1rem; }
  .page-note:empty { display: none; margin: 0; }

  /* the left column: quest, the room itself, the reset/play/step/turn strip,
     the goal/status lines, satchel, the command box and the manor map, all
     as full-width strips sharing the room's own width — the column's total
     height tracks the side column instead of leaving a gap under a lone,
     short room panel. */
  .stage-left { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }

  /* the room view — a 90s-RPG interior cutaway, all CSS gradients, no
     external asset: a striped papered wall over a gilt dado rail over a
     diagonal-plank floor, framed by the same ornate double rule as before.
     The sprite tiles sit on the floor band (align-items flex-end), so
     furniture and people read as standing IN the room, against its wall,
     rather than floating in a chip strip. */
  .room-frame {
    position: relative; min-height: 250px;
    background:
      repeating-linear-gradient(90deg, var(--wall-stripe) 0 4px, transparent 4px 30px) 0 0 / 100% 58% no-repeat,
      linear-gradient(var(--wall), var(--wall)) 0 0 / 100% 58% no-repeat,
      linear-gradient(var(--gilt), var(--gilt)) 0 58% / 100% 3px no-repeat,
      repeating-linear-gradient(78deg, var(--floor-a) 0 26px, var(--floor-b) 26px 52px);
    border: 1px solid var(--gilt); outline: 1px solid var(--line); outline-offset: 4px;
    padding: 2.6rem 1.1rem .8rem; display: flex; flex-direction: column; justify-content: flex-end; gap: .6rem;
  }
  .room-frame::before, .room-frame::after { content: "\\2766"; position: absolute; font-size: 1.1rem; color: var(--gilt); opacity: .85; line-height: 1; }
  .room-frame::before { top: -.6rem; left: -.35rem; }
  .room-frame::after { bottom: -.6rem; right: -.35rem; transform: rotate(180deg); }
  /* outdoor: a sky band over a hedge-green divider, no gilt — cellar and
     study/library etc. stay on the indoor gradient above (the default), so
     only a room actually typed outdoor-space/underground-space repaints. */
  .room-frame[data-room-kind="outdoor"] {
    background:
      linear-gradient(var(--sky), var(--sky)) 0 0 / 100% 58% no-repeat,
      linear-gradient(var(--hedge), var(--hedge)) 0 58% / 100% 3px no-repeat,
      repeating-linear-gradient(78deg, var(--floor-a) 0 26px, var(--floor-b) 26px 52px);
    border-color: var(--hedge);
  }
  /* underground: stone-grey stripes over a darker floor, no gilt rail. */
  .room-frame[data-room-kind="underground"] {
    background:
      repeating-linear-gradient(90deg, var(--stone-b) 0 4px, transparent 4px 30px) 0 0 / 100% 58% no-repeat,
      linear-gradient(var(--stone), var(--stone)) 0 0 / 100% 58% no-repeat,
      repeating-linear-gradient(78deg, var(--stone-floor-a) 0 26px, var(--stone-floor-b) 26px 52px);
    border-color: var(--stone);
  }
  /* the brass door plaque naming the room the scene is drawing — filled
     from the same snapshot the caption already reads, never a new fact. */
  .room-plaque {
    position: absolute; top: .55rem; left: 50%; transform: translateX(-50%);
    font-size: .66rem; letter-spacing: .14em; text-transform: uppercase;
    color: var(--gilt); background: var(--parchment); border: 1px solid var(--gilt);
    box-shadow: inset 0 0 0 2px var(--parchment-strong);
    padding: .22rem .9rem; white-space: nowrap;
  }
  .room-plaque:empty { display: none; }
  /* the room-kind icon — filled through the exact same property-aware
     sprite resolver the room's own object cards use, keyed on the room's own
     name (so library/kitchen/garden reach their large TOMLs, everything else
     falls back through room's own ancestor chain to the generic room icon).
     Rendered at 120px — twice a room-object sprite's own 60px frame
     (.sprite-frame below) — so the room itself reads as the biggest thing
     drawn in its own scene. It takes the wall's own brass rather than the
     page ink: at that size an ink-black icon out-shouts every person and
     prop standing in front of it, and this is a mark ON the wall, not
     another thing in the room. */
  .room-kind-icon { position: absolute; top: .5rem; right: .6rem; width: 120px; height: 120px; color: var(--gilt); opacity: .42; }
  .room-kind-icon svg { width: 100%; height: 100%; display: block; }
  .room-kind-icon:empty { display: none; }
  /* the doorways — every written way out drawn where it actually points,
     as a brass door plate set into the wall it leads through. The plate
     borrows the room plaque's own treatment above (parchment ground, gilt
     rule, inset mat): a manor has one brass vocabulary, and a door plate and
     a room plate are the same object. North and south sit in a band OUTSIDE
     the frame so neither fights the plaque or the room-kind icon; west and
     east sit just inside their own walls. Stairs get a round chip instead —
     neither up nor down is a compass point, and neither hangs on a wall. */
  .room-stage { position: relative; padding: 1.35rem 0; }
  .dir-ring { position: absolute; inset: 0; pointer-events: none; }
  .dir-slot { position: absolute; pointer-events: auto; }
  .dir-north { top: 0; left: 50%; transform: translateX(-50%); }
  .dir-south { bottom: 0; left: 50%; transform: translateX(-50%); }
  .dir-west { left: .3rem; top: 50%; transform: translateY(-50%); }
  .dir-east { right: .3rem; top: 50%; transform: translateY(-50%); }
  /* the stairs stand at the left of each band: the frame's own corner
     flourishes sit top-left and bottom-right, and this is the one inset that
     clears both. */
  .dir-up { top: 0; left: 1.4rem; }
  .dir-down { bottom: 0; left: 1.4rem; }
  .dir-door {
    position: relative; display: inline-flex; align-items: center; justify-content: center;
    font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .14em; text-transform: uppercase;
    color: var(--gilt); background: var(--parchment); border: 1px solid var(--gilt);
    box-shadow: inset 0 0 0 2px var(--parchment-strong);
    padding: .2rem .6rem; white-space: nowrap;
  }
  .dir-door:hover, .dir-door:focus-visible { background: var(--parchment-strong); color: var(--ink); }
  .dir-door.stair { border-radius: 50%; width: 1.5rem; height: 1.5rem; padding: 0; font-size: .72rem; letter-spacing: 0; }
  /* a door onto a room this session has not stood in yet, marked with the
     same gilt dot the manor board prints for a direction it cannot draw a
     room for — one hint shape, two surfaces. */
  .dir-door .unwalked { position: absolute; top: -.16rem; right: -.16rem; width: .34rem; height: .34rem; border-radius: 50%; background: var(--gilt); }

  .sprite-row { display: flex; align-items: flex-end; gap: .9rem .7rem; min-height: 2.5rem; }
  /* the floor band: every non-wall-mounted stack, wrapping and pinned to the
     left edge of the room, as the flat sprite row always has. */
  .floor-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .9rem .7rem; }
  /* the adventurer's own card, pinned to the right edge of the room view —
     margin-left: auto inside the shared flex row pushes it there regardless
     of how many floor stacks sit to its left. */
  .you-slot { margin-left: auto; display: flex; align-items: flex-end; flex: none; }
  /* one on-top-of chain, drawn as a column: the topmost item first, the
     floor-standing base last — shrink-wrapped so the stack's own width is
     whichever level is widest, never the room's full width. */
  .sprite-stack { display: flex; flex-direction: column; align-items: center; gap: .3rem; width: max-content; }
  /* the wall band: centered, absolutely laid over the papered-wall portion
     of the room frame (roughly its top 8%-52% — the gilt dado sits at 58%),
     items bottom-aligned so a hung painting's own frame reads as flush
     against the dado rail beneath it. */
  .wall-row {
    position: absolute; left: 1.1rem; right: 1.1rem; top: 8%; height: 44%;
    display: flex; justify-content: center; align-items: flex-end; gap: .9rem .7rem;
    flex-wrap: wrap; pointer-events: none;
  }
  .wall-row:empty { display: none; }

  /* the class-badge system — this design's signature element: every sprite
     gets a small ringed portrait frame plus a genre-flavored class word
     (hero/townsfolk/fixture/item), colored through the SAME data-cls tokens
     the rest of the site already uses for provenance. The sprite LABEL
     underneath always names the real, specific thing (the cabinet, the
     butler) — chrome around honest content, never instead of it. */
  .sprite-card { display: flex; flex-direction: column; align-items: center; width: 70px; }
  /* a room sprite the visitor can click for a lights-down close look — a
     pointer cursor and a gilt ring on hover. Wall-mounted cards live in a
     pointer-events: none band (so the band never eats a floor click), so a
     clickable one re-enables its own pointer events. */
  .sprite-card.clickable { cursor: pointer; }
  .sprite-card.clickable:hover .sprite-frame { border-color: var(--gilt); box-shadow: inset 0 0 0 3px var(--parchment), 0 0 0 2px var(--gilt), 0 2px 3px rgba(0, 0, 0, .22); }
  .wall-row .sprite-card.clickable { pointer-events: auto; }
  /* a squared inventory-slot tile (the 90s-RPG idiom) instead of the old
     thin circular ring: a raised card with an inner mat, the class color on
     the outer border, and a soft ground shadow so the tile sits ON the
     floor rather than hovering over it. */
  .sprite-frame {
    width: 60px; height: 60px; border-radius: 5px; background: var(--card);
    border: 2px solid var(--line); box-shadow: inset 0 0 0 3px var(--parchment), 0 2px 3px rgba(0, 0, 0, .22);
    display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 8px;
  }
  .sprite-frame[data-cls="adventurer"] { border-color: var(--taught); }
  .sprite-frame[data-cls="person"] { border-color: var(--corpus); }
  .sprite-frame[data-cls="container"], .sprite-frame[data-cls="furniture"] { border-color: var(--entail); }
  .sprite-frame[data-cls="portable"] { border-color: var(--alert); }
  .sprite-frame[data-cls="room"] { border-color: var(--muted); }
  .sprite { width: 100%; height: 100%; }
  .sprite svg { width: 100%; height: 100%; display: block; }
  .sprite[data-cls="adventurer"] { color: var(--taught); }
  .sprite[data-cls="person"] { color: var(--corpus); }
  .sprite[data-cls="container"], .sprite[data-cls="furniture"] { color: var(--entail); }
  .sprite[data-cls="portable"] { color: var(--alert); }
  .sprite[data-cls="room"] { color: var(--muted); }
  /* the name plate under each tile gets its own parchment ground so it
     stays legible over the parquet floor the row now sits on. */
  .sprite-label { font-size: .74rem; text-align: center; color: var(--ink); margin-top: .3rem; line-height: 1.15; background: var(--parchment); border: 1px solid var(--line); border-radius: 2px; padding: .02rem .3rem; max-width: 100%; }
  .class-badge { font-family: ${MONO_STACK}; font-size: .55rem; letter-spacing: .06em; text-transform: uppercase; margin-top: .15rem; padding: .04rem .4rem; border-radius: 999px; border: 1px solid var(--muted); color: var(--muted); }
  .class-badge[data-cls="adventurer"] { border-color: var(--taught); color: var(--taught); }
  .class-badge[data-cls="person"] { border-color: var(--corpus); color: var(--corpus); }
  .class-badge[data-cls="container"], .class-badge[data-cls="furniture"] { border-color: var(--entail); color: var(--entail); }
  .class-badge[data-cls="portable"] { border-color: var(--alert); color: var(--alert); }

  .side { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  .chat, .panel { background: var(--card); border: 1px solid var(--line); border-top: 5px double var(--gilt); padding: .65rem .75rem; }
  .chat h2, .panel h2 { font-family: ${SERIF_STACK}; font-variant: small-caps; font-size: .8rem; letter-spacing: .06em; color: var(--gilt); font-weight: 600; margin: 0 0 .5rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
  .empty-note { font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
  .chip { font-family: ${MONO_STACK}; font-size: .72rem; padding: .25rem .6rem; border: 1px solid var(--gilt); background: var(--parchment); color: var(--ink); border-radius: 3px; }

  /* the manor map — a FIXED-size viewport regardless of room count or
     layout shape (an operator report: an earlier version's container grew
     and shrank with the graph, shoving the panels below it around as the
     game progressed). The svg scales to fit via preserveAspectRatio, same
     graph, same nodes, just letterboxed into a stable box. */
  /* the wrapper div gets an explicit height too, not just .map-viewport
     itself — an svg's own height:100% resolves against ITS PARENT's
     height, and a percentage against an auto-height parent computes to
     "auto" per spec, silently undoing the fixed-viewport intent below. */
  /* the manor board — this redesign's signature element: the visited-rooms
     graph drawn as a Cluedo-style game board. Green baize under a brass
     frame; each room a parchment rectangle with its name printed INSIDE;
     the corridors parchment paths between rooms; the player's current room
     ringed in the same taught-green every page uses for "this is live". */
  .map-viewport { height: 190px; box-sizing: content-box; padding: 7px; background: var(--baize); border: 2px solid var(--gilt); box-shadow: inset 0 0 0 1px var(--baize-line); overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .map-viewport > div { width: 100%; height: 100%; }
  .map-viewport svg { width: 100%; height: 100%; display: block; }
  .map-viewport .empty-note { color: var(--parchment); opacity: .8; }
  /* the play-mode map only: a fixed SQUARE viewport (width pinned to the
     same 190px height above, centered) rather than stretching to the side
     column's own width — the svg still scales to fit inside it either way,
     this just keeps the board's own footprint stable and click-to-enlarge
     honest about what it's enlarging. */
  .map-viewport-fixed { width: 190px; margin: 0 auto; cursor: zoom-in; }
  /* the lights-down map lightbox — the same board, the same roomMapSvg
     output, just drawn bigger over a dimmed backdrop. Closes on a click
     anywhere outside the enlarged board, or Escape. */
  .map-lightbox { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 2.4rem; background: rgba(10, 8, 4, .74); }
  .map-lightbox[hidden] { display: none; }
  .map-lightbox-inner { width: min(70vmin, 640px); height: min(70vmin, 640px); background: var(--baize); border: 3px solid var(--gilt); box-shadow: inset 0 0 0 1px var(--baize-line), 0 12px 48px rgba(0, 0, 0, .5); padding: 16px; box-sizing: border-box; }
  .map-lightbox-inner svg { width: 100%; height: 100%; display: block; }
  .roommap .room-edge { stroke: var(--board-path); stroke-width: 7; }
  .roommap .room-hint { fill: var(--board-path); opacity: .8; }
  .roommap .room-node rect { fill: var(--parchment); stroke: var(--baize-line); stroke-width: 1.5; }
  .roommap .room-node.current rect { stroke: var(--taught); stroke-width: 2.5; }
  .roommap .room-node text { font-family: ${MONO_STACK}; font-size: 7px; fill: var(--ink); text-anchor: middle; }
  .roommap .room-node.clickable { cursor: pointer; }
  .roommap .room-node.clickable:hover rect { stroke: var(--gilt); stroke-width: 2.5; }
  .roommap .room-node.selected rect { stroke: var(--alert); stroke-width: 2.5; }

  /* the object lightbox — the SAME lights-down treatment the map lightbox
     uses (fixed dimmed backdrop, z-index 60, close on backdrop click/Escape),
     framed as a parchment case-file card: the clicked object's large sprite
     (the sprites-page 400px tier, via the same resolveObjectSprite the room
     cards use), its live "look <object>" reply, and an object-scoped chat
     dock — its own affordance pills filtered to this object, plus free text.
     Every dock turn runs through the ONE live session, so the main
     transcript/quest/satchel reflect it. */
  .obj-lightbox { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 2.4rem; background: rgba(10, 8, 4, .74); }
  .obj-lightbox[hidden] { display: none; }
  .obj-lightbox-inner { width: min(92vw, 560px); max-height: 88vh; overflow-y: auto; background: var(--parchment); color: var(--ink); border: 3px solid var(--gilt); box-shadow: inset 0 0 0 2px var(--parchment-strong), 0 12px 48px rgba(0, 0, 0, .5); padding: 1.1rem 1.2rem 1.2rem; box-sizing: border-box; }
  .obj-title { font-family: ${SERIF_STACK}; font-variant: small-caps; font-size: 1rem; letter-spacing: .06em; color: var(--gilt); font-weight: 600; margin: 0 0 .6rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
  .obj-scene { display: flex; align-items: center; justify-content: center; padding: .5rem 0 1rem; }
  .obj-sprite { width: min(46vmin, 300px); height: min(46vmin, 300px); }
  .obj-sprite svg { width: 100%; height: 100%; display: block; }
  .obj-look { font-size: .9rem; line-height: 1.45; white-space: pre-wrap; background: var(--card); border-left: 3px solid var(--gilt); padding: .55rem .7rem; margin: 0 0 .8rem; }
  .obj-look:empty { display: none; }
  .docklog { display: flex; flex-direction: column; gap: .4rem; max-height: 200px; overflow-y: auto; margin-bottom: .5rem; }
  .docklog:empty { display: none; }
  .docklog .u { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  .docklog .u::before { content: "tmct> "; color: var(--taught); }
  .docklog .a { font-size: .86rem; line-height: 1.4; white-space: pre-wrap; }

  .goal-status { display: flex; flex-direction: column; gap: .4rem; }
  .goal-status .g { display: flex; align-items: baseline; gap: .4rem; font-size: .86rem; line-height: 1.35; }
  .goal-status .dot { width: .5rem; height: .5rem; border-radius: 50%; flex: none; background: var(--muted); }
  .goal-status .g.known .dot { background: var(--corpus); }
  .goal-status .g.carried .dot { background: var(--taught); }
  .chatlog { display: flex; flex-direction: column; gap: .4rem; max-height: 260px; overflow-y: auto; margin-bottom: .5rem; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  .chatlog .u::before { content: "tmct> "; color: var(--taught); }
  .chatlog .a { font-size: .88rem; line-height: 1.4; white-space: pre-wrap; }
  .chatlog .t { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); font-style: italic; }
  .chatlog .t::before { content: "\\2022 "; }
  .pills { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .5rem; }
  .pills:empty { display: none; margin-bottom: 0; }
  .pill { font-family: ${MONO_STACK}; font-size: .72rem; padding: .25rem .6rem; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 999px; }
  .pill:hover { border-color: var(--gilt); background: var(--parchment); }
  /* the room's own prose, relocated (operator feedback) out of a bottom-of-
     page strip and into the flow between the history/pills and the input —
     a quoted manuscript line reporting what "look" would say right now. */
  .caption { background: var(--parchment); border-left: 3px solid var(--gilt); padding: .55rem .7rem; font-size: .86rem; font-style: italic; margin: 0 0 .5rem; }
  .caption:empty { display: none; margin: 0; }
  /* "what would you like to do" — the room's own contextual pills sit
     top-right of the heading, on the header's own row; more pills than fit
     wrap onto further lines still pinned to the right (justify-content:
     flex-end on the inner .pills flex box), so the block grows down and
     toward the left rather than pushing the heading around. */
  .command-head { display: flex; align-items: flex-start; justify-content: space-between; gap: .3rem .6rem; margin: 0 0 .5rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
  .command-head h2 { flex: 0 0 auto; margin: 0; padding: 0; border-bottom: none; }
  /* nowrap on .command-head itself keeps the pills box on the SAME row as
     the heading (top-right); .pills' own min-width: 0 lets IT shrink below
     its natural width so ITS children (not the whole box) are what wraps
     onto further lines, staying right-anchored rather than dropping the
     whole pill row under the heading. */
  .command-head .pills { flex: 1 1 auto; min-width: 0; justify-content: flex-end; margin-bottom: 0; }
  .chatask { display: flex; align-items: center; gap: .5rem; border-top: 1px solid var(--line); padding-top: .5rem; }
  .chatask .prompt { color: var(--taught); font-size: .78rem; font-family: ${MONO_STACK}; }
  .chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); padding: .32rem .55rem; min-width: 0; }
  .chatask input:disabled { opacity: .5; }
  .controls-row { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .controls-row button { font-family: ${MONO_STACK}; font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; padding: .38rem .85rem; border: 1px solid var(--gilt); background: var(--parchment); color: var(--ink); }
  .controls-row button:hover:not(:disabled) { background: var(--parchment-strong); }
  .controls-row button:disabled { opacity: .4; cursor: default; }
  .controls-row .turn { margin-left: auto; font-family: ${MONO_STACK}; font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--ink); background: var(--parchment); border: 1px solid var(--gilt); padding: .3rem .6rem; font-variant-numeric: tabular-nums; }
  .goal-line { font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); margin-top: .5rem; }
  .status { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); margin-top: .3rem; }

  /* edit mode */
  body:not(.editing) #editStage { display: none; }
  body.editing #playStage { display: none; }
  /* .stage's inherited align-items: start (kept for #playStage's own fixed-
     size room panel) would otherwise top-align .edittext against the
     manor-map/room-detail/legend column and leave a dead gap below the
     textarea once that column grows taller — override to stretch just for
     the editor, and let the textarea (not just its wrapper) absorb the
     extra height so the editing area actually grows, not just its padding. */
  .editor-stage { margin-top: .5rem; align-items: stretch; }
  .editor-stage .edittext { display: flex; flex-direction: column; }
  .edittext textarea { width: 100%; box-sizing: border-box; min-height: 380px; flex: 1 1 auto; font-family: ${MONO_STACK}; font-size: .82rem; line-height: 1.55; background: var(--bg); color: var(--ink); border: 1px solid var(--line); padding: .6rem; resize: vertical; }
  .edit-status { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); margin-top: .4rem; min-height: 1.1em; }
  .edit-status.pending { color: var(--entail); }
  .edit-status.ok { color: var(--taught); }
  .roomdetail .sprite-row { min-height: 3.2rem; }
  .roomdetail[data-room-kind="outdoor"] { border-top-color: var(--hedge); }
  .roomdetail[data-room-kind="underground"] { border-top-color: var(--stone); }
  #legendList { display: flex; flex-wrap: wrap; gap: .5rem .3rem; }

  body.preview .side, body.preview .stage-left > .panel, body.preview .controls-row, body.preview .status { display: none; }
  /* the hero iframe is a picture of a room, not a control surface — every
     other control is hidden there, and the doorways go with them. */
  body.preview .room-stage { padding: 0; }
  body.preview .dir-ring { display: none; }
  body.preview main { padding: 0; max-width: none; }
  body.preview .stage { display: block; }
  body.preview .eyebrow, body.preview .mode-toggle, body.preview #editStage, body.preview .page-note { display: none; }
</style>
</head>
<body>
<main>
  <div class="titlebar">
    <div class="eyebrow">tmct &middot; the adventure</div>
    <button id="editModeBtn" type="button" class="mode-toggle" disabled>edit the world</button>
  </div>
  <p class="page-note">${escapeHtml(worldPayload.opening)}</p>
  <div class="stage" id="playStage">
    <div class="stage-left">
      <div class="controls-row" id="playControls">
        <button id="resetBtn" type="button" disabled>reset</button>
        <button id="playBtn" type="button" disabled>&#9654; play</button>
        <button id="stepBtn" type="button" disabled>step</button>
        <span class="turn mono" id="turnLabel">turn: 0</span>
      </div>
      <div class="goal-line" id="goalLine"></div>
      <div class="status" id="status">loading the engine&hellip;</div>
      <div class="panel goals">
        <h2>quest</h2>
        <div id="goalList"></div>
      </div>
      <div class="panel carrying">
        <h2>satchel</h2>
        <div class="chips" id="carryList"></div>
      </div>
      <div class="room-stage">
        <div class="room-frame" id="roomFrame">
          <div class="room-plaque mono" id="roomName"></div>
          <div class="room-kind-icon" id="roomKindIcon"></div>
          <div class="wall-row" id="wallRow"></div>
          <div class="sprite-row" id="spriteRow">
            <div class="floor-row" id="floorRow"></div>
            <div class="you-slot" id="youSlot"></div>
          </div>
        </div>
        <div class="dir-ring" id="dirRing" aria-label="the ways out of this room">
          <div class="dir-slot dir-north" id="dir-north"></div>
          <div class="dir-slot dir-east" id="dir-east"></div>
          <div class="dir-slot dir-south" id="dir-south"></div>
          <div class="dir-slot dir-west" id="dir-west"></div>
          <div class="dir-slot dir-up" id="dir-up"></div>
          <div class="dir-slot dir-down" id="dir-down"></div>
        </div>
      </div>
      <div class="panel command">
        <div class="command-head">
          <h2>What would you like to do</h2>
          <div class="pills" id="pills"></div>
        </div>
        <form class="chatask" id="chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="chatq" type="text" placeholder="go north" aria-label="Type a command, or ask a question" disabled>
        </form>
      </div>
    </div>
    <aside class="side" aria-label="The adventure's log and chat">
      <div class="panel roommap">
        <h2>the manor, so far</h2>
        <div class="map-viewport map-viewport-fixed" id="mapViewport"><div id="mapWrap"></div></div>
      </div>
      <div class="chat">
        <h2>the manor's own account</h2>
        <div class="chatlog" id="chatlog" aria-live="polite"></div>
        <div class="caption" id="caption"></div>
      </div>
    </aside>
  </div>
  <div class="map-lightbox" id="mapLightbox" role="dialog" aria-modal="true" aria-label="The manor map, enlarged" hidden>
    <div class="map-lightbox-inner roommap" id="mapLightboxInner"></div>
  </div>
  <div class="obj-lightbox" id="objLightbox" role="dialog" aria-modal="true" aria-label="A closer look at an object" hidden>
    <div class="obj-lightbox-inner" id="objLightboxInner">
      <h2 class="obj-title" id="objTitle"></h2>
      <div class="obj-scene" id="objScene"></div>
      <div class="obj-look" id="objLook"></div>
      <div class="pills" id="objPills"></div>
      <div class="docklog" id="objDockLog" aria-live="polite"></div>
      <form class="chatask" id="objForm">
        <span class="prompt mono">tmct&gt;</span>
        <input id="objInput" type="text" placeholder="examine lamp, take key&hellip;" aria-label="Type a command for this object">
      </form>
    </div>
  </div>

  <div class="stage editor-stage" id="editStage" aria-label="The world editor">
    <div class="panel edittext">
      <h2>the world, in plain sentences</h2>
      <textarea id="editorText" spellcheck="false" aria-label="The world's own facts as plain sentences, one per line — edit one and it flows back into the running world"></textarea>
      <div class="pills" id="editorPills" aria-label="Ontologically related terms for the word before the cursor"></div>
      <div class="edit-status" id="editorStatus"></div>
    </div>
    <aside class="side" aria-label="The whole manor, a clicked room, and the legend">
      <div class="panel roommap">
        <h2>the whole manor</h2>
        <div class="map-viewport"><div id="editMapWrap"></div></div>
      </div>
      <div class="panel roomdetail" id="roomDetailPanel">
        <h2 id="roomDetailTitle">click a room</h2>
        <div class="sprite-row" id="roomDetailSprites"></div>
        <div class="caption" id="roomDetailCaption"></div>
      </div>
      <div class="panel legend">
        <h2>legend</h2>
        <div id="legendList"></div>
      </div>
    </aside>
  </div>
</main>
<script>
const ADVENTURE = ${pageData};
</script>
${engineBundleJs ? `<script>\n${embedScriptText(engineBundleJs)}\n</script>` : `<script src="./adventure-browser.bundle.js"></script>`}
<script>
(function () {
  "use strict";
  const createTicker = ${createTicker.toString()};
  const spriteClassForObject = ${spriteClassForObject.toString()};
  const visibleRoomOf = ${visibleRoomOf.toString()};
  const roomSceneObjects = ${roomSceneObjects.toString()};
  const scenePlacement = ${scenePlacement.toString()};
  const roomSceneLayout = ${roomSceneLayout.toString()};
  const roomKindForRoom = ${roomKindForRoom.toString()};
  const carriedItems = ${carriedItems.toString()};
  const visitedRoomGraph = ${visitedRoomGraph.toString()};
  const allRoomIds = ${allRoomIds.toString()};
  const groundedPlaceholder = ${groundedPlaceholder.toString()};
  const exitDoorways = ${exitDoorways.toString()};
  const spriteAncestryRows = ${spriteAncestryRows.toString()};
  const factsForSubject = ${factsForSubject.toString()};
  const renderWorldEditorText = ${renderWorldEditorText.toString()};
  const wordBeforeCursor = ${wordBeforeCursor.toString()};
  const esc = ${escapeHtml.toString()};
  const el = (id) => document.getElementById(id);
  const roomFrameEl = el("roomFrame");
  const roomNameEl = el("roomName");
  const roomKindIconEl = el("roomKindIcon");
  const dirRingEl = el("dirRing");
  const wallRowEl = el("wallRow");
  const floorRowEl = el("floorRow");
  const youSlotEl = el("youSlot");
  const captionEl = el("caption");
  const goalLineEl = el("goalLine");
  const statusEl = el("status");
  const turnLabelEl = el("turnLabel");
  const resetBtn = el("resetBtn");
  const playBtn = el("playBtn");
  const stepBtn = el("stepBtn");
  const chatlogEl = el("chatlog");
  const pillsEl = el("pills");
  const chatformEl = el("chatform");
  const chatqEl = el("chatq");
  const carryListEl = el("carryList");
  const mapWrapEl = el("mapWrap");
  const mapViewportEl = el("mapViewport");
  const mapLightboxEl = el("mapLightbox");
  const mapLightboxInnerEl = el("mapLightboxInner");
  const objLightboxEl = el("objLightbox");
  const objTitleEl = el("objTitle");
  const objSceneEl = el("objScene");
  const objLookEl = el("objLook");
  const objPillsEl = el("objPills");
  const objDockLogEl = el("objDockLog");
  const objFormEl = el("objForm");
  const objInputEl = el("objInput");
  const goalListEl = el("goalList");
  const editModeBtn = el("editModeBtn");
  const editorTextEl = el("editorText");
  const editorPillsEl = el("editorPills");
  const editorStatusEl = el("editorStatus");
  const editMapWrapEl = el("editMapWrap");
  const roomDetailPanelEl = el("roomDetailPanel");
  const roomDetailTitleEl = el("roomDetailTitle");
  const roomDetailSpritesEl = el("roomDetailSprites");
  const roomDetailCaptionEl = el("roomDetailCaption");
  const legendListEl = el("legendList");

  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  document.body.classList.toggle("preview", preview);

  let session = null;
  let lastTicks = 0;
  let lastSnapshot = null;
  let selectedRoomId = null;
  let objLightboxSubject = null;
  let editRows = [];
  let editState = { placements: new Map(), openness: new Map(), exits: new Map() };
  let allStoreRows = [];

  // ---- persistence — the manor remembers your visit, on this device -------
  // Best-effort IndexedDB (tmctAdventure.openPersistedStore): after any
  // state-changing redraw, the whole Backend-B payload plus the visited-room
  // exposure set snapshots under the "adventure" key, debounced. Restored on
  // boot; reset clears it and starts the world over. The home page's preview
  // iframe never persists — an auto-playing demo must not overwrite, or
  // resurrect as, a visitor's own game.
  let persist = null;
  let persistSaveTimer = null;
  window.tmctAdventureLastSave = null;

  // The deploy's own version, read off the service worker file the build
  // already stamps (its cache name embeds package.json's version) — the only
  // same-origin place the number exists at runtime. Best-effort: "dev".
  async function fetchSiteVersion() {
    try {
      const res = await fetch("./tmct-sw.js");
      if (!res.ok) return "dev";
      const found = /tmct-precache-v(\\d+\\.\\d+\\.\\d+)/.exec(await res.text());
      return found ? found[1] : "dev";
    } catch {
      return "dev";
    }
  }

  function schedulePersistSave() {
    if (!persist || !session) return;
    clearTimeout(persistSaveTimer);
    persistSaveTimer = setTimeout(() => {
      persistSaveTimer = null;
      if (!session) return;
      const started = performance.now();
      let memoryPayload;
      try {
        memoryPayload = structuredClone(session.memoryDir.payload);
      } catch {
        try { memoryPayload = JSON.parse(JSON.stringify(session.memoryDir.payload)); } catch { return; }
      }
      const visitedRoomIds = lastSnapshot ? lastSnapshot.visitedRoomIds : [];
      persist.save({ memoryPayload: memoryPayload, visitedRoomIds: visitedRoomIds }).then((saved) => {
        if (saved) window.tmctAdventureLastSave = { at: Date.now(), ms: Math.round(performance.now() - started) };
      });
    }, 500);
  }

  // ---- serialize every engine-touching call: the ticker, the chat dock and
  // the editor sync all share one in-memory store, and any overlapping pair
  // could race against the same write.
  let lock = Promise.resolve();
  function withLock(fn) {
    const run = lock.then(fn, fn);
    lock = run.catch(() => {});
    return run;
  }

  // ---- large-sprite-tier wiring — the gradient-shaded 400px tier
  // (data/sprites-large/*.toml) arrives embedded at build time as
  // ADVENTURE.largeSpriteTemplates, resolved through the exact same
  // sprite-templates.mjs resolver the icon tier already used — no runtime
  // fetch. A build without the large tier just leaves the icon tier
  // (ADVENTURE.spriteTemplates) as the working fallback — this page is never
  // blank because one tier is absent, the same posture this project already
  // takes elsewhere.
  const largeTier = ADVENTURE.largeSpriteTemplates;
  const activeSpriteTemplates = Array.isArray(largeTier) && largeTier.length ? largeTier : ADVENTURE.spriteTemplates;

  // ---- the class-badge system — this redesign's signature element: every
  // sprite gets a small genre-flavored class word underneath its own real
  // name, colored through the same data-cls tokens the rest of the site
  // already uses for provenance (see the CSS block's own comment). Chrome
  // wraps the content; the content itself — the sprite's real subject name,
  // the caption text — is never replaced by it.
  const CLASS_BADGE = { adventurer: "hero", person: "townsfolk", container: "fixture", furniture: "fixture", portable: "item", room: "room" };
  const badgeFor = (cls) => CLASS_BADGE[cls] || cls;
  // A truthy subject marks the card clickable and tags it with the object it
  // names, so the room frame's own delegated handler can open the object
  // lightbox for it. The player's own "you" card and the edit-mode / legend /
  // satchel cards pass none, so only real room props are clickable.
  function clickAttrs(subject) {
    return subject ? ' clickable" data-look-subject="' + esc(subject) + '"' : '"';
  }
  function spriteCardHtml(label, cls, svg, subject) {
    return '<div class="sprite-card' + clickAttrs(subject) + '><div class="sprite-frame" data-cls="' + esc(cls) + '"><div class="sprite" data-cls="' + esc(cls) + '">' + svg + '</div></div>'
      + '<div class="sprite-label">' + esc(label) + '</div>'
      + '<div class="class-badge" data-cls="' + esc(cls) + '">' + esc(badgeFor(cls)) + "</div></div>";
  }

  // A stacked item ABOVE the floor base: the frame only, no label/badge
  // block underneath — stacking full cards (each carrying its own name +
  // class badge under the icon) put that text between every pair of icons,
  // reading as a large floating gap even though the CSS gap between the
  // card boxes themselves was always the intended small one. The base
  // item (bottom of the stack, standing on the floor) keeps its full
  // spriteCardHtml identification; every item resting on something else
  // shows an aria-label in its place, so the name is still available to
  // assistive tech even though the sighted layout stays compact.
  function stackedSpriteCardHtml(label, cls, svg, subject) {
    return '<div class="sprite-card' + clickAttrs(subject) + ' aria-label="' + esc(label) + '"><div class="sprite-frame" data-cls="' + esc(cls) + '"><div class="sprite" data-cls="' + esc(cls) + '">' + svg + "</div></div></div>";
  }

  function captionFor(rows, state, here) {
    const hereCased = here.charAt(0).toUpperCase() + here.slice(1);
    const lines = tmctAdventure.worldDigestRows(rows, state)
      .filter((row) => row.subject !== "Player" && (row.object === here || row.subject === hereCased))
      .map((row) => row.subject + " " + row.predicate + " " + row.object + ".");
    return lines.length ? lines.join(" ") : "Nothing more about the " + here + " is written down yet.";
  }

  // ---- goal status — mirrors adventure-viz.mjs's own goalStatusLines
  // against tmctAdventure.foldWorldState/tmctAdventure.exposedFacts (the
  // same mirroring captionFor/pillsFor already do against their own
  // adventure.mjs exports), so a location is never claimed before the room
  // holding it has actually been visited this session.
  function goalStatusLinesFor(rows, state, visitedRoomIds) {
    const ids = Array.from(new Set(rows.filter((r) => r.predicate === "mgx:is-objective" && r.object === "true").map((r) => r.subject)));
    const carriedIds = new Set(carriedItems(rows, state).map((o) => o.subject));
    const exposedRows = tmctAdventure.exposedFacts(rows, visitedRoomIds);
    const exposedState = tmctAdventure.foldWorldState(exposedRows);
    return ids.map((id) => {
      if (carriedIds.has(id)) return { subject: id, status: "carried", text: "carrying the " + id + " \\u2014 the adventure is won." };
      const room = visibleRoomOf(exposedRows, exposedState, id);
      return room
        ? { subject: id, status: "known", text: "last known: the " + id + " is in the " + room + "." }
        : { subject: id, status: "unknown", text: "there's a sought-after " + id + " somewhere." };
    });
  }

  // ---- carrying panel — every object placed with the player, rendered as
  // the same non-interactive chip shape the room's own pills use for
  // actions, so the sidebar reads as one visual family.
  function renderCarrying(rows, state) {
    const items = carriedItems(rows, state);
    carryListEl.innerHTML = items.length
      ? items.map((o) => '<span class="chip">' + esc(o.subject) + "</span>").join("")
      : '<span class="empty-note">nothing yet</span>';
  }

  // ---- room map — ONE svg-building routine shared by play mode's visited-
  // only map and edit mode's whole-map (visitedRoomGraph fed allRoomIds
  // instead of the exposure set — a parameter, not a second layout), so the
  // fixed-size-viewport CSS treatment and the node layout can never drift
  // between the two. clickable adds a data-room attribute and a pointer
  // cursor per node; play mode's own map stays purely informational.
  function roomMapSvg(graph, clickable) {
    if (!graph.nodes.length) return null;
    // Board-game footprints: each room a named rectangle (the name INSIDE
    // it, the way a Cluedo board prints its rooms), corridors as wide paths
    // between the footprints, direction-only hints as path stubs fading
    // toward rooms not yet visited.
    const cell = 64, roomW = 56, roomH = 26;
    const maxX = Math.max.apply(null, graph.nodes.map((n) => n.x));
    const maxY = Math.max.apply(null, graph.nodes.map((n) => n.y));
    const w = (maxX + 1) * cell, h = (maxY + 1) * cell;
    const cx = (n) => (n.x + 0.5) * cell;
    const cy = (n) => (n.y + 0.5) * cell;
    const byRoom = new Map(graph.nodes.map((n) => [n.id, n]));
    const edgesSvg = graph.edges.map((e) => {
      const a = byRoom.get(e.from), b = byRoom.get(e.to);
      return '<line class="room-edge" x1="' + cx(a) + '" y1="' + cy(a) + '" x2="' + cx(b) + '" y2="' + cy(b) + '"></line>';
    }).join("");
    const HINT_DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1] };
    const hintsSvg = graph.hints.map((hi) => {
      const from = byRoom.get(hi.from);
      const d = HINT_DELTA[hi.direction] || [0, 0];
      return '<circle class="room-hint" cx="' + (cx(from) + d[0] * cell * 0.42) + '" cy="' + (cy(from) + d[1] * cell * 0.42) + '" r="3.5"></circle>';
    }).join("");
    const nodesSvg = graph.nodes.map((n) => {
      const cls = "room-node" + (n.current ? " current" : "") + (clickable ? " clickable" : "") + (clickable && n.id === selectedRoomId ? " selected" : "");
      const attr = clickable ? ' data-room="' + esc(n.id) + '"' : "";
      return '<g class="' + cls + '"' + attr + '><rect x="' + (cx(n) - roomW / 2) + '" y="' + (cy(n) - roomH / 2) + '" width="' + roomW + '" height="' + roomH + '" rx="3"></rect>'
        + '<text x="' + cx(n) + '" y="' + (cy(n) + 2.5) + '">' + esc(n.id) + "</text></g>";
    }).join("");
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + (clickable ? "the whole manor \\u2014 click a room to inspect it" : "the rooms visited so far") + '">'
      + edgesSvg + hintsSvg + nodesSvg + "</svg>";
  }
  function renderRoomMap(rows, state, visitedRoomIds) {
    mapWrapEl.innerHTML = roomMapSvg(visitedRoomGraph(state, visitedRoomIds), false) || '<span class="empty-note">nowhere yet</span>';
  }

  // ---- the map lightbox — clicking the fixed-square play-mode map redraws
  // the SAME roomMapSvg output larger, over a dimmed backdrop; clicking the
  // backdrop (not the board itself) or pressing Escape closes it.
  function openMapLightbox() {
    if (!lastSnapshot) return;
    const svg = roomMapSvg(visitedRoomGraph(lastSnapshot.state, lastSnapshot.visitedRoomIds), false);
    if (!svg) return;
    mapLightboxInnerEl.innerHTML = svg;
    mapLightboxEl.hidden = false;
  }
  function closeMapLightbox() {
    mapLightboxEl.hidden = true;
    mapLightboxInnerEl.innerHTML = "";
  }
  mapViewportEl.addEventListener("click", openMapLightbox);
  mapLightboxEl.addEventListener("click", (e) => { if (e.target === mapLightboxEl) closeMapLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !mapLightboxEl.hidden) closeMapLightbox(); });

  // ---- the object lightbox — clicking a room sprite opens a lights-down
  // close look at that thing (the SAME lights-down/backdrop/Escape pattern as
  // the map lightbox): its large sprite, its live "look <object>" reply
  // (adventure.mjs's grounded look, run through THIS session), and an
  // object-scoped chat dock. The dock's pills are the room's own affordance
  // list filtered to this object (pillsFor, the same source the main hint
  // pills read), plus a free-text input. Every dock turn runs through the ONE
  // live session, echoes into the MAIN transcript and redraws the main page,
  // so the satchel/quest/room all reflect it after close — no forked state.
  function addObjDockLine(cls, html) {
    const d = document.createElement("div");
    d.className = cls; d.innerHTML = html;
    objDockLogEl.appendChild(d); objDockLogEl.scrollTop = objDockLogEl.scrollHeight;
  }
  function objectPillsFor(rows, state, here, subject) {
    return pillsFor(rows, state, here).filter((a) => a.split(" ").pop() === subject);
  }
  function renderObjScene() {
    if (!lastSnapshot || !objLightboxSubject) { objSceneEl.innerHTML = ""; return; }
    const cls = spriteClassForObject(lastSnapshot.rows, objLightboxSubject);
    const svg = resolveObjectSprite(lastSnapshot.rows, { subject: objLightboxSubject, spriteClass: cls });
    objSceneEl.innerHTML = '<div class="obj-sprite" data-cls="' + esc(cls) + '">' + svg + "</div>";
  }
  function renderObjPills() {
    if (!lastSnapshot || !objLightboxSubject) { objPillsEl.innerHTML = ""; return; }
    const actions = objectPillsFor(lastSnapshot.rows, lastSnapshot.state, lastSnapshot.here, objLightboxSubject);
    objPillsEl.innerHTML = actions.map((a) => '<button type="button" class="pill">' + esc(a) + "</button>").join("");
    // Grounded to the open object itself ("take lamp…"), so the dock teaches
    // the noun form even though a bare pronoun now binds here too.
    objInputEl.placeholder = groundedPlaceholder(actions, "examine " + objLightboxSubject);
  }
  // A dock turn: paused, echoed into the main transcript AND the dock, run on
  // the one session, then the main page and the lightbox both redraw off the
  // fresh snapshot — the board stays open.
  function runObjTurn(line) {
    ticker.pause();
    addChatLine("u", esc(line));
    addObjDockLine("u", esc(line));
    return withLock(async () => {
      const result = await session.turn(line);
      addChatLine("a", esc(result.answer).replace(/\\n/g, "<br>"));
      addObjDockLine("a", esc(result.answer).replace(/\\n/g, "<br>"));
      const snap = await session.snapshot();
      redraw(snap);
      renderObjScene();
      renderObjPills();
    });
  }
  async function openObjectLightbox(subject) {
    if (!session || !lastSnapshot) return;
    ticker.pause();
    objLightboxSubject = subject;
    objTitleEl.textContent = "the " + subject;
    objDockLogEl.innerHTML = "";
    objLookEl.textContent = "";
    objInputEl.value = "";
    renderObjScene();
    renderObjPills();
    objLightboxEl.hidden = false;
    objInputEl.focus();
    // The initial look is a real, read-only turn on the live session (it writes
    // nothing, so it needs no main-transcript echo — it IS the board's own
    // content); pill/typed turns below do echo, since they can change state.
    await withLock(async () => {
      const result = await session.turn("look " + subject);
      objLookEl.textContent = result.answer;
    });
  }
  function closeObjectLightbox() {
    objLightboxEl.hidden = true;
    objLightboxSubject = null;
    objDockLogEl.innerHTML = "";
    objInputEl.value = "";
  }
  roomFrameEl.addEventListener("click", (e) => {
    const card = e.target.closest(".sprite-card[data-look-subject]");
    if (!card) return;
    openObjectLightbox(card.getAttribute("data-look-subject"));
  });
  objPillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    runObjTurn(btn.textContent);
  });
  objFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = objInputEl.value.trim();
    if (!q || !session) return;
    objInputEl.value = "";
    runObjTurn(q);
  });
  objLightboxEl.addEventListener("click", (e) => { if (e.target === objLightboxEl) closeObjectLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !objLightboxEl.hidden) closeObjectLightbox(); });

  function renderEditMap(rows, state) {
    editMapWrapEl.innerHTML = roomMapSvg(visitedRoomGraph(state, allRoomIds(rows)), true) || '<span class="empty-note">this world defines no rooms</span>';
  }
  editMapWrapEl.addEventListener("click", (e) => {
    const g = e.target.closest("[data-room]");
    if (!g) return;
    selectedRoomId = g.getAttribute("data-room");
    renderEditMap(editRows, editState);
    renderRoomDetail();
  });

  // ---- goal panel — one line per exposed objective, a colored dot carrying
  // the same three-state read goalStatusLinesFor's own status field names.
  function renderGoals(rows, state, visitedRoomIds) {
    const lines = goalStatusLinesFor(rows, state, visitedRoomIds);
    goalListEl.innerHTML = lines.length
      ? '<div class="goal-status">' + lines.map((l) =>
          '<div class="g ' + l.status + '"><span class="dot"></span><span>' + esc(l.text) + "</span></div>").join("")
        + "</div>"
      : '<span class="empty-note">this world names no goal.</span>';
  }

  // ---- chat/event log — every manual exchange AND every auto-play tick's
  // own narration append here, in order, so it reads as one continuous
  // history rather than a line overwritten every tick.
  function addChatLine(cls, html) {
    const d = document.createElement("div");
    d.className = cls; d.innerHTML = html;
    chatlogEl.appendChild(d); chatlogEl.scrollTop = chatlogEl.scrollHeight;
  }

  // ---- contextual pills — refreshed every redraw from the CURRENT room's
  // own roomAffordances-derived list (mirroring pillsForRoom against
  // tmctAdventure.roomAffordances, the same way captionFor above mirrors
  // roomCaptionText against tmctAdventure.worldDigestRows), so a pill for a
  // room the player has left, or an object already taken, never lingers.
  // Clicking one inserts its exact command text into the input and focuses
  // it; it never auto-submits, so free typing still works and a clicked
  // suggestion can still be edited first.
  //
  // The row shows what to do with the things IN the room; the doorways above
  // own every way OUT of it. A "go" command is the one affordance no player
  // ever wants to edit before running, and drawing it in both places would
  // make one control a suggestion and its twin an action.
  function pillsFor(rows, state, here) {
    return tmctAdventure.roomAffordances(rows, state, here);
  }
  function renderPills(rows, state, here) {
    const actions = pillsFor(rows, state, here).filter((a) => a.indexOf("go ") !== 0);
    pillsEl.innerHTML = actions.map((a) => '<button type="button" class="pill">' + esc(a) + "</button>").join("");
    // The empty input teaches the grounded noun form off the same affordance
    // list the pills read — real props from THIS room, so a first-time player
    // types "examine lamp", not a pronoun with nothing to bind to yet.
    chatqEl.placeholder = groundedPlaceholder(actions, "go north");
  }
  pillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn || !chatqEl) return;
    chatqEl.value = btn.textContent;
    chatqEl.focus();
  });
  // A double-click runs the pill's own command immediately — the single
  // click above still only fills the input, so a visitor who meant to edit
  // it first loses nothing.
  pillsEl.addEventListener("dblclick", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn || !chatqEl || !chatformEl) return;
    chatqEl.value = btn.textContent;
    chatformEl.requestSubmit();
  });

  // ---- sprite resolution — property/instance-aware (sprite-templates.mjs's
  // resolveSpriteAsset), keyed on the OBJECT'S OWN NAME (via
  // spriteAncestryRows' synthetic subClassOf edge to its declared class) so
  // a named object (cabinet, butler) can carry its own data/sprites*.toml
  // template while the data-cls attribute still reflects the DECLARED class
  // (container/furniture/portable/person/room) — the CSS accent-color rules
  // stay keyed on that declared class unchanged. The player's own "you" row
  // has no backing fact row, so it resolves directly by its fixed
  // "adventurer" class with no ancestry/property rows to check.
  //
  // When the whole chain misses, the root the resolver lands on is chosen by
  // what KIND of thing the class is, never the resolver's own "animal"
  // default: an unknown prop in a manor should read as a plain parcel and an
  // unknown character as a figure, and neither should ever draw a creature.
  const ROOT_FALLBACK_BY_CLASS = { adventurer: "person", person: "person", room: "room" };
  const rootFallbackFor = (cls) => ROOT_FALLBACK_BY_CLASS[cls] || "portable";
  function resolveObjectSprite(rows, s) {
    if (s.subject === "you") return tmctAdventure.resolveSpriteAsset("adventurer", [], [], activeSpriteTemplates, tmctAdventure.SPRITE_REGISTRY, { rootFallback: "person", instanceKey: "you" });
    return tmctAdventure.resolveSpriteAsset(
      s.subject, spriteAncestryRows(rows, s.subject), factsForSubject(rows, s.subject),
      activeSpriteTemplates, tmctAdventure.SPRITE_REGISTRY,
      { rootFallback: rootFallbackFor(s.spriteClass), instanceKey: s.subject },
    );
  }

  // ---- the room-kind icon — filled through the SAME property-aware
  // resolver the sprite cards use, keyed on the room's own name, so a room
  // with its own large-tier template (library, kitchen, garden) shows it and
  // everything else falls back through room's own ancestor chain to the
  // generic room icon.
  function roomKindIconSvg(rows, here) {
    return tmctAdventure.resolveSpriteAsset(
      here, spriteAncestryRows(rows, here), factsForSubject(rows, here),
      activeSpriteTemplates, tmctAdventure.SPRITE_REGISTRY,
      { rootFallback: "room", instanceKey: "roomkind-" + here },
    );
  }

  // ---- the doorways — one brass plate per written exit, in the slot that
  // exit actually points at, drawn from exitDoorways over the SAME snapshot
  // the room scene reads. A direction the world writes no exit for draws
  // nothing at all, so the ring never offers a "go" the engine would refuse.
  const STAIR_GLYPH = { up: "\\u2191", down: "\\u2193" };
  function renderDoorways(state, here, visitedRoomIds) {
    const bySlot = {};
    exitDoorways(state, here, visitedRoomIds).forEach((d) => { bySlot[d.direction] = d; });
    for (const direction of ["north", "east", "south", "west", "up", "down"]) {
      const slot = el("dir-" + direction);
      const doorway = bySlot[direction];
      if (!doorway) { slot.innerHTML = ""; continue; }
      const stair = direction === "up" || direction === "down";
      const label = "go " + direction + (doorway.walked ? "" : " (not walked yet)");
      slot.innerHTML = '<button type="button" class="dir-door' + (stair ? " stair" : "") + '"'
        + ' data-direction="' + esc(direction) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">'
        + (stair ? STAIR_GLYPH[direction] : esc(direction))
        + (doorway.walked ? "" : '<span class="unwalked" aria-hidden="true"></span>') + "</button>";
    }
  }
  // A door is not a suggestion to edit — clicking one walks through it.
  dirRingEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".dir-door");
    if (!btn || !session) return;
    runTurn("go " + btn.getAttribute("data-direction"));
  });

  function redraw(snap) {
    lastSnapshot = snap;
    const layout = roomSceneLayout(snap.rows, snap.state, snap.here);
    wallRowEl.innerHTML = layout.wall.map((s) => spriteCardHtml(s.subject, s.spriteClass, resolveObjectSprite(snap.rows, s), s.subject)).join("");
    floorRowEl.innerHTML = layout.floor.map((stack) => {
      const baseIndex = stack.items.length - 1;
      return '<div class="sprite-stack">' + stack.items.map((s, i) => {
        const svg = resolveObjectSprite(snap.rows, s);
        return i === baseIndex ? spriteCardHtml(s.subject, s.spriteClass, svg, s.subject) : stackedSpriteCardHtml(s.subject, s.spriteClass, svg, s.subject);
      }).join("") + "</div>";
    }).join("");
    youSlotEl.innerHTML = spriteCardHtml("you", "adventurer", resolveObjectSprite(snap.rows, { subject: "you", spriteClass: "adventurer" }));
    roomNameEl.textContent = "the " + snap.here;
    roomFrameEl.setAttribute("data-room-kind", roomKindForRoom(snap.rows, snap.here));
    roomKindIconEl.innerHTML = roomKindIconSvg(snap.rows, snap.here);
    captionEl.textContent = captionFor(snap.rows, snap.state, snap.here);
    turnLabelEl.textContent = "turn: " + snap.turn;
    renderPills(snap.rows, snap.state, snap.here);
    renderDoorways(snap.state, snap.here, snap.visitedRoomIds);
    renderCarrying(snap.rows, snap.state);
    renderRoomMap(snap.rows, snap.state, snap.visitedRoomIds);
    renderGoals(snap.rows, snap.state, snap.visitedRoomIds);
    schedulePersistSave();
  }

  // Every command a visitor issues by hand — typed, or walked through a
  // doorway — runs here, so the transcript, the pause and the redraw are the
  // same for both. A manual command lands mid-tick otherwise, so this pauses
  // first, and stays paused until the visitor presses play again.
  function runTurn(line) {
    ticker.pause();
    addChatLine("u", esc(line));
    return withLock(async () => {
      const result = await session.turn(line);
      addChatLine("a", esc(result.answer).replace(/\\n/g, "<br>"));
      const snap = await session.snapshot();
      redraw(snap);
    });
  }

  chatformEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = chatqEl.value.trim();
    if (!q || !session) return;
    chatqEl.value = "";
    runTurn(q);
  });

  // ---- edit mode ---------------------------------------------------------
  //
  // The textarea is seeded from renderWorldEditorText over the world's OWN
  // facts (session.applyEdit's own return already scopes writes to the
  // world's provenance tag; here we scope READS the same way — the live
  // store also carries the default persona's background corpus, and this
  // page must never show, or risk retracting, a fact that isn't part of
  // THIS world). Typing debounces two independent things at different
  // paces: cursor-suggestion pills (fast, ~180ms — cheap, in-memory lookups
  // per the investigation behind this feature) and the actual store sync
  // (slower, ~400ms — so a mid-word keystroke state is never what gets
  // read as "the user's intent"). session.applyEdit does the real parse +
  // diff + write; this page only ever reads its result back.

  function worldOnlyRows(rows) {
    const prefix = "world:" + ADVENTURE.world.name;
    return (rows || []).filter((r) => typeof r.provenance === "string" && r.provenance.indexOf(prefix) === 0);
  }

  function renderRoomDetail() {
    if (!selectedRoomId) {
      roomDetailPanelEl.setAttribute("data-room-kind", "");
      roomDetailTitleEl.textContent = "click a room";
      roomDetailSpritesEl.innerHTML = "";
      roomDetailCaptionEl.textContent = "";
      return;
    }
    roomDetailPanelEl.setAttribute("data-room-kind", roomKindForRoom(editRows, selectedRoomId));
    roomDetailTitleEl.textContent = selectedRoomId;
    const objects = roomSceneObjects(editRows, editState, selectedRoomId);
    roomDetailSpritesEl.innerHTML = objects.length
      ? objects.map((o) => spriteCardHtml(o.subject, o.spriteClass, resolveObjectSprite(editRows, o))).join("")
      : '<span class="empty-note">nothing placed here yet</span>';
    roomDetailCaptionEl.textContent = captionFor(editRows, editState, selectedRoomId);
  }

  // ---- legend — every known object/character class this world actually
  // uses, by its real icon. Scoped to worldOnlyRows so the background
  // corpus's own (unrelated) rdf:type vocabulary never floods the list.
  // Each class resolves through the SAME ancestry walk and kind-aware root
  // the room's own cards use, so a class an edited world invents climbs to
  // the nearest ancestor that has a picture instead of dropping straight to
  // a generic one.
  function renderLegend(rows) {
    const subjects = new Set(rows.filter((r) => r.predicate === "rdf:type").map((r) => r.subject));
    const classes = new Set(["adventurer"]);
    subjects.forEach((s) => { if (s !== "player") classes.add(spriteClassForObject(rows, s)); });
    legendListEl.innerHTML = Array.from(classes).sort().map((cls) => {
      const svg = tmctAdventure.resolveSpriteAsset(
        cls, spriteAncestryRows(rows, cls), factsForSubject(rows, cls),
        activeSpriteTemplates, tmctAdventure.SPRITE_REGISTRY,
        { rootFallback: rootFallbackFor(cls), instanceKey: "legend-" + cls },
      );
      return spriteCardHtml(cls, cls, svg);
    }).join("");
  }

  function refreshEditPanels() {
    renderEditMap(editRows, editState);
    renderLegend(editRows);
    renderRoomDetail();
  }

  function wordRangeBeforeCursor(text, cursorPos) {
    const word = wordBeforeCursor(text, cursorPos);
    return [cursorPos - word.length, cursorPos];
  }

  // ---- cursor-driven suggestion pills — the lateral SKOS neighbourhood
  // (tmctAdventure.relatedForTerm) plus the vertical is-a ancestor chain
  // (tmctAdventure.classAncestorChain), mirroring adventure-viz.mjs's own
  // suggestionsForTerm against the browser bundle's global (the same
  // reach-through-the-global pattern captionFor/pillsFor already use).
  // Reads the FULL store (allStoreRows), not worldOnlyRows — a term's
  // synonym/related-concept facts mostly live in the default background
  // corpus, not in Ashcombe Hall's own vocabulary. Empty on an honest miss.
  function renderSuggestionPills() {
    const term = wordBeforeCursor(editorTextEl.value, editorTextEl.selectionStart);
    if (!term) { editorPillsEl.innerHTML = ""; return; }
    const related = tmctAdventure.relatedForTerm(allStoreRows, term);
    const chain = tmctAdventure.classAncestorChain(term, allStoreRows);
    const seen = new Set([term]);
    const out = [];
    const push = (label) => { if (label && !seen.has(label)) { seen.add(label); out.push(label); } };
    if (related) { related.synonyms.forEach(push); related.related.forEach((r) => push(r.prefLabel)); }
    chain.slice(1).forEach(push);
    editorPillsEl.innerHTML = out.slice(0, 8)
      .map((s) => '<button type="button" class="pill" data-insert="' + esc(s) + '">' + esc(s) + "</button>").join("");
  }
  editorPillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    const pos = editorTextEl.selectionStart;
    const range = wordRangeBeforeCursor(editorTextEl.value, pos);
    const value = editorTextEl.value;
    const insert = btn.getAttribute("data-insert");
    editorTextEl.value = value.slice(0, range[0]) + insert + value.slice(pos);
    const newPos = range[0] + insert.length;
    editorTextEl.setSelectionRange(newPos, newPos);
    editorTextEl.focus();
    onEditorChanged();
  });

  async function applyEditorText() {
    if (!session) return;
    editorStatusEl.className = "edit-status pending";
    editorStatusEl.textContent = "reading the manor\\u2019s ledger\\u2026";
    const result = await session.applyEdit(editorTextEl.value);
    const snap = await session.snapshot();
    allStoreRows = snap.rows;
    editRows = worldOnlyRows(snap.rows);
    editState = tmctAdventure.foldWorldState(editRows);
    if (result.unrecognized.length) {
      const lines = result.unrecognized.map((u) => u.line).join(", ");
      editorStatusEl.className = "edit-status pending";
      editorStatusEl.textContent = result.unrecognized.length + " line" + (result.unrecognized.length === 1 ? "" : "s")
        + " not understood yet (line " + lines + ") \\u2014 left untouched until fixed.";
    } else {
      editorStatusEl.className = "edit-status ok";
      editorStatusEl.textContent = (result.added || result.removed)
        ? "synced \\u2014 " + result.added + " fact(s) added, " + result.removed + " retracted."
        : "synced \\u2014 no change.";
    }
    refreshEditPanels();
  }

  let suggestTimer = null;
  let syncTimer = null;
  function scheduleSuggestions() { clearTimeout(suggestTimer); suggestTimer = setTimeout(renderSuggestionPills, 180); }
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => withLock(applyEditorText), 400); }
  function onEditorChanged() { scheduleSuggestions(); scheduleSync(); }
  editorTextEl.addEventListener("input", onEditorChanged);
  editorTextEl.addEventListener("click", scheduleSuggestions);
  editorTextEl.addEventListener("keyup", (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) !== -1) scheduleSuggestions();
  });

  async function enterEditMode() {
    ticker.pause();
    const snap = await session.snapshot();
    allStoreRows = snap.rows;
    editRows = worldOnlyRows(snap.rows);
    editState = tmctAdventure.foldWorldState(editRows);
    editorTextEl.value = renderWorldEditorText(editRows, editState);
    editorStatusEl.className = "edit-status";
    editorStatusEl.textContent = "";
    editorPillsEl.innerHTML = "";
    selectedRoomId = null;
    document.body.classList.add("editing");
    refreshEditPanels();
    editModeBtn.textContent = "back to playing";
  }
  async function exitEditMode() {
    document.body.classList.remove("editing");
    editModeBtn.textContent = "edit the world";
    const snap = await session.snapshot();
    redraw(snap);
  }
  editModeBtn.addEventListener("click", () => withLock(() =>
    (document.body.classList.contains("editing") ? exitEditMode() : enterEditMode())));

  async function boot({ fresh = false } = {}) {
    const saved = !fresh && persist ? await persist.load() : null;
    session = await tmctAdventure.createAdventureSession(
      ADVENTURE.world,
      saved && saved.payload && saved.payload.memoryPayload
        ? { restoredPayload: saved.payload.memoryPayload, restoredVisitedRoomIds: saved.payload.visitedRoomIds }
        : {},
    );
    lastTicks = 0;
    const snap = await session.snapshot();
    redraw(snap);
    goalLineEl.textContent = "";
    chatlogEl.innerHTML = "";
    statusEl.textContent = "";
    addChatLine("t", esc(ADVENTURE.world.opening || "the adventure begins."));
    if (saved && snap.turn > 0) {
      addChatLine("t", "resumed where you left off (turn " + snap.turn + ") \\u2014 progress kept best-effort on this device; reset starts the manor over.");
    }
    chatqEl.disabled = false;
    resetBtn.disabled = false; playBtn.disabled = false; stepBtn.disabled = false; editModeBtn.disabled = false;
  }

  const ticker = createTicker({
    onTick: () => withLock(async () => {
      const result = await session.autoplayTick();
      lastTicks += 1;
      const snap = await session.snapshot();
      redraw(snap);
      goalLineEl.textContent = result.goal || "";
      addChatLine("t", esc(result.goal || ""));
      if (result.done || result.stalled) ticker.pause();
    }),
    onRender: (state) => {
      playBtn.textContent = state.playing ? "\\u23f8 pause" : "\\u25b6 play";
      playBtn.disabled = state.animating;
      stepBtn.disabled = state.animating || state.playing;
      resetBtn.disabled = state.animating;
    },
    onReset: () => withLock(async () => {
      // Reset means "start the manor over", so the saved snapshot goes too —
      // without the clear, the next visit would restore the game reset just
      // threw away.
      clearTimeout(persistSaveTimer);
      persistSaveTimer = null;
      if (persist) await persist.clear();
      await boot({ fresh: true });
    }),
    hasNext: () => !preview || lastTicks < ADVENTURE.previewMaxTicks,
    waitMs: ADVENTURE.tickWaitMs,
  });
  playBtn.addEventListener("click", () => ticker.play());
  stepBtn.addEventListener("click", () => ticker.stepOnce());
  resetBtn.addEventListener("click", () => ticker.reset());

  (async () => {
    if (!preview && tmctAdventure.openPersistedStore) {
      const siteVersion = await fetchSiteVersion();
      persist = tmctAdventure.openPersistedStore({ storeKey: "adventure", stamp: siteVersion + ":" + ADVENTURE.world.name });
    }
    await boot();
    if (preview) ticker.play();
  })();
})();
</script>
</body>
</html>
`;
}
