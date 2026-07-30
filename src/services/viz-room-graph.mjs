// viz-room-graph.mjs — the room-graph layout and SVG renderer mud-viz.mjs
// (`burrowGraph`/`burrowSvg`) and adventure-viz.mjs (`visitedRoomGraph`/its
// own inline `roomMapSvg`) each wrote separately, unified into one
// parametrized pair. mud-viz.mjs's own header already admits the copy.
//
// The two originals genuinely differ, not just in name: mud's burrow can be
// dug two ways into the same cell (down AND south from one room), so it
// nudges a colliding placement right rather than overlapping it, and it
// tracks each room's surface/soil `level` for the turf line; adventure's
// manor is fixed at authoring time and never collides, and marks the
// player's current room instead of a level. `opts` below select each
// behaviour rather than assuming one world's shape:
//   - `opts.root`, if given, is placed before every other room (a stable
//     anchor for one entry point) and turns on `level` (an "up"/"down" exit
//     moves the level by ∓1, tracked via a BFS from `root`).
//   - `opts.actingSubject`, if given, attaches `.current` (whether that
//     subject's own room is this node) instead of `.level`.
//   - `opts.nudgeCollisions` (default false) pushes a colliding placement
//     right instead of overlapping it.
// An edge is drawn only between two rooms BOTH in `roomIds`; `hints` names
// every exit from an included room toward one that is not — the direction
// only, never the excluded room's own name, so a fog-of-war caller can draw
// "there's a way on" and nothing more. Disconnected components lay out as
// separate side-by-side blocks. Pure.

import { escapeHtml } from "./viz-theme.mjs";

const EXIT_DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1] };

/** Every room's depth level, BFS from `root` at level 0: an "up"/"down" exit
 *  moves the level by ∓1, any other direction keeps it unchanged. A room
 *  unreachable from `root` is absent from the returned map. Pure. */
export function levelsOf(state, root) {
  const levels = new Map([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const room = queue.shift();
    const level = levels.get(room);
    for (const [direction, target] of state.exits.get(room) ?? []) {
      if (levels.has(target)) continue;
      const delta = direction === "down" ? -1 : direction === "up" ? 1 : 0;
      levels.set(target, level + delta);
      queue.push(target);
    }
  }
  return levels;
}

/** Lay `roomIds` out on an integer grid FROM the world's own has-exit-*
 *  directions — never a force-directed guess, so a room north of another
 *  sits one row above it and a room dug down sits one row below. See the
 *  file header for what `opts.root`/`opts.actingSubject`/
 *  `opts.nudgeCollisions` each turn on. Pure. */
export function directedGridLayout(state, roomIds, opts = {}) {
  const { root = null, actingSubject = null, nudgeCollisions = false } = opts;
  const known = new Set(roomIds || []);
  const here = actingSubject ? (state.placements.get(actingSubject)?.object ?? null) : null;
  const positions = new Map();
  const taken = new Set();
  const edges = [];
  const edgeKeys = new Set();
  const hints = [];
  const place = (room, x, y) => {
    let px = x;
    if (nudgeCollisions) {
      for (let guard = 0; taken.has(px + "," + y) && guard < 64; guard += 1) px += 1;
    }
    positions.set(room, { x: px, y });
    taken.add(px + "," + y);
  };
  const seeds = root ? [root, ...[...known].sort()] : [...known].sort();
  let offsetX = 0;
  for (const start of seeds) {
    if (!known.has(start) || positions.has(start)) continue;
    place(start, offsetX, 0);
    const queue = [start];
    const component = [start];
    while (queue.length) {
      const room = queue.shift();
      const pos = positions.get(room);
      const dirs = state.exits.get(room);
      for (const direction of [...(dirs?.keys() ?? [])].sort()) {
        const target = dirs.get(direction);
        if (!known.has(target)) { hints.push({ from: room, direction }); continue; }
        const key = [room, target].sort().join("\0");
        if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ from: room, to: target, direction }); }
        if (positions.has(target)) continue;
        const [dx, dy] = EXIT_DELTA[direction] ?? [0, 0];
        place(target, pos.x + dx, pos.y + dy);
        component.push(target);
        queue.push(target);
      }
    }
    offsetX = Math.max(...component.map((r) => positions.get(r).x)) + 2;
  }
  const levels = root ? levelsOf(state, root) : null;
  const xs = [...positions.values()].map((p) => p.x);
  const ys = [...positions.values()].map((p) => p.y);
  const minX = Math.min(0, ...xs);
  const minY = Math.min(0, ...ys);
  const nodes = [...known].filter((room) => positions.has(room)).sort().map((room) => {
    const p = positions.get(room);
    const node = { id: room, x: p.x - minX, y: p.y - minY };
    if (levels) node.level = levels.has(room) ? levels.get(room) : null;
    if (actingSubject) node.current = room === here;
    return node;
  });
  return { nodes, edges, hints };
}

/** Render a `directedGridLayout` graph as an inline SVG: one rect+label per
 *  room, a line per edge, a small dot per hint (an exit toward a room not in
 *  the graph). Returns `""` for an empty graph, so `roomGraphSvg(...) ||
 *  fallbackHtml` reads naturally either way.
 *
 *  `opts.compact` picks the smaller of two built-in cell/room size tiers
 *  (each overridable via `opts.cellX`/`cellY`/`roomW`/`roomH`).
 *  `opts.turf` switches on the burrow-flavoured rendering: a ground line
 *  between the surface and soil levels (wherever the graph's nodes carry
 *  `.level` and the layout genuinely splits level 0 from every other level),
 *  a "shaft" class on up/down edges, and `opts.occupants` (a `Map` or plain
 *  object keyed by room id to an array of `{ character, color }`) drawing a
 *  coloured, titled dot per occupant inside its room. Without `opts.turf`,
 *  rendering is the manor-board style instead: `opts.clickable` adds a
 *  `data-room` attribute and a `clickable` class, plus `selected` on
 *  `opts.selectedRoomId`. `opts.here`, if given, marks that room id as the
 *  current one (falling back to a node's own `.current` field from
 *  `directedGridLayout`'s `actingSubject` option); `opts.fresh` marks one
 *  room id as freshly created. `opts.wrapClass`, if given, wraps the `<svg>`
 *  in a `<div class="...">`; omit it for a bare `<svg>`. `opts.label` is the
 *  SVG's `aria-label`. Pure. */
export function roomGraphSvg(graph, opts = {}) {
  if (!graph.nodes.length) return "";
  const compact = !!opts.compact;
  const turf = !!opts.turf;
  const cellX = opts.cellX ?? (compact ? 44 : 76);
  const cellY = opts.cellY ?? (compact ? 26 : 54);
  const roomW = opts.roomW ?? (compact ? 34 : 62);
  const roomH = opts.roomH ?? (compact ? 14 : 26);
  const maxX = Math.max(...graph.nodes.map((n) => n.x));
  const maxY = Math.max(...graph.nodes.map((n) => n.y));
  const w = (maxX + 1) * cellX, h = (maxY + 1) * cellY;
  const byRoom = new Map(graph.nodes.map((n) => [n.id, n]));
  const cx = (n) => (n.x + 0.5) * cellX;
  const cy = (n) => (n.y + 0.5) * cellY;
  const occupants = opts.occupants instanceof Map ? opts.occupants : new Map(Object.entries(opts.occupants || {}));

  let groundBand = "";
  if (turf) {
    const surfaceRows = graph.nodes.filter((n) => n.level === 0).map((n) => n.y);
    const soilRows = graph.nodes.filter((n) => n.level != null && n.level !== 0).map((n) => n.y);
    if (surfaceRows.length && soilRows.length && Math.max(...surfaceRows) < Math.min(...soilRows)) {
      const groundY = (Math.max(...surfaceRows) + 0.5) * cellY + roomH / 2 + (compact ? 3 : 7);
      groundBand = `<rect class="turf" x="0" y="0" width="${w}" height="${groundY}"></rect>`
        + `<line class="ground-line" x1="0" y1="${groundY}" x2="${w}" y2="${groundY}"></line>`;
    }
  }

  const edgesSvg = graph.edges.map((e) => {
    const a = byRoom.get(e.from), b = byRoom.get(e.to);
    if (!a || !b) return "";
    const cls = turf ? "tunnel" + (e.direction === "up" || e.direction === "down" ? " shaft" : "") : "room-edge";
    return `<line class="${cls}" x1="${cx(a)}" y1="${cy(a)}" x2="${cx(b)}" y2="${cy(b)}"></line>`;
  }).join("");

  const hintsSvg = graph.hints.map((hi) => {
    const from = byRoom.get(hi.from);
    if (!from) return "";
    const [dx, dy] = EXIT_DELTA[hi.direction] || [0, 0];
    const reach = turf ? 0.36 : 0.42;
    const radius = compact ? 2 : turf ? 3.2 : 3.5;
    return `<circle class="${turf ? "hint" : "room-hint"}" cx="${cx(from) + dx * cellX * reach}" cy="${cy(from) + dy * cellY * reach}" r="${radius}"></circle>`;
  }).join("");

  const nodesSvg = graph.nodes.map((n) => {
    const label = escapeHtml(n.id);
    const isHere = opts.here !== undefined ? opts.here === n.id : !!n.current;
    if (turf) {
      const cast = occupants.get(n.id) || [];
      const step = Math.min(compact ? 6 : 9, (roomW - 6) / Math.max(1, cast.length));
      const dots = cast.map((c, i) => {
        const spread = (i - (cast.length - 1) / 2) * step;
        return `<circle class="occupant" cx="${cx(n) + spread}" cy="${cy(n) + roomH / 2}" r="${compact ? 2.4 : 3.6}" fill="${c.color}"><title>${escapeHtml(c.character)}</title></circle>`;
      }).join("");
      const fit = label.length * (compact ? 3.6 : 4.3) > roomW - 6
        ? ` textLength="${roomW - 6}" lengthAdjust="spacingAndGlyphs"` : "";
      const cls = "room" + (n.level === 0 ? " surface" : "") + (isHere ? " here" : "") + (opts.fresh === n.id ? " freshly-dug" : "");
      return `<g class="${cls}" data-room="${label}"><rect x="${cx(n) - roomW / 2}" y="${cy(n) - roomH / 2}" width="${roomW}" height="${roomH}" rx="3"></rect>`
        + `<text x="${cx(n)}" y="${cy(n) + (compact ? 2 : 2.5)}"${fit}>${label}</text>${dots}</g>`;
    }
    const cls = "room-node" + (isHere ? " current" : "") + (opts.clickable ? " clickable" : "") + (opts.clickable && n.id === opts.selectedRoomId ? " selected" : "");
    const attr = opts.clickable ? ` data-room="${label}"` : "";
    return `<g class="${cls}"${attr}><rect x="${cx(n) - roomW / 2}" y="${cy(n) - roomH / 2}" width="${roomW}" height="${roomH}" rx="3"></rect>`
      + `<text x="${cx(n)}" y="${cy(n) + 2.5}">${label}</text></g>`;
  }).join("");

  const svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.label || "the room graph")}">${groundBand}${edgesSvg}${hintsSvg}${nodesSvg}</svg>`;
  return opts.wrapClass ? `<div class="${opts.wrapClass}">${svg}</div>` : svg;
}
