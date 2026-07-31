// hanoi-board.mjs — the one pure walk from a solved towers-of-hanoi plan to
// board-shaped fact rows, and from those rows to the `{individuals,
// objectProperties}` payload parseEntities consumes. The plan page's
// counterpart to sprite-facts.mjs, and to ask.mjs's own
// worldRelationGraphPayload.
//
// The plan lane already hands the page everything a board question needs:
// `plan.states[step]` is the position after `step` moves, one `mgx:rest-on`
// row per disk; `plan.actions` is the move list; `plan.domain` carries the
// taught taxonomy (`classMembers`), the taught size order (`ordering`) and
// the taught render hints. None of that is a graph, so `tmct.ask` over a plan
// session had nothing to traverse. These two functions close that.
//
// A row set is taken AT A STEP, because that is the question a visitor asks
// on that page: the transport bar scrubs the board, and "where are the disks"
// means where they are on the board in front of them.
//
// What travels, and why each row earns its place:
//   - `<piece> rdf:type <class>`     — the taught board taxonomy (disk, peg),
//     so ask()'s dynamic class lane answers "how many disks are there" and
//     "list the pegs" straight off `individual.class`, with no vocabulary
//     table to edit.
//   - `<disk> mgx:rest-on <support>` — the position itself, copied from the
//     state's own rows. The support is a disk or a peg.
//   - `<disk> mgx:currently-in <peg>`— the same position chased down the
//     support chain to the peg the disk is standing on. This is
//     ask-vocab.mjs's WORLD_RELATIONS.placement predicate, so "where are the
//     disks" and "list the locations of disks" answer over the live board the
//     way spider-fly's own board answers them.
//   - `<peg> mgx:top-disk <disk>`    — the topmost disk on a peg, the only one
//     a legal move can lift. Derived, not restated: a peg holding nothing
//     emits no row.
//   - `<disk> mgx:smaller-than <disk>` — the taught size order, straight from
//     `plan.domain.ordering`.
//   - `move-N rdf:type move`, `move-N mgx:moves-disk <disk>`,
//     `move-N mgx:moves-onto <target>` — the solution's own move list, so
//     "how many moves are there" and "list the moves" answer about the
//     puzzle the page is showing.
//
// The move rows cover the WHOLE solution rather than only the moves played so
// far, because that is what the movelist beside the board shows and what "how
// many moves does this take" means. The step is what the position rows read;
// the move list is the plan, and the plan does not change as you scrub it.
//
// Which classes count as board furniture follows computeBlocksLayout's own
// rule, for the same reason: `plan.domain.classMembers` is the whole memory's
// taxonomy, not just this puzzle's, so a session that has been taught a
// vocabulary carries hundreds of individuals with nothing to do with the game.
// A class DECLARED in the render hints contributes every member, empty or not
// (an unused peg is still a peg); an undeclared class contributes only the
// members the plan itself names.

/** The board relations a projected hanoi graph carries. `placement` is
 *  ask-vocab.mjs's own WORLD_RELATIONS.placement predicate, restated here
 *  rather than imported so this module stays a leaf with no imports — the
 *  spelling is checked against that table by test. */
export const HANOI_BOARD_RELATIONS = Object.freeze({
  placement: Object.freeze({
    predicate: "mgx:currently-in",
    comment: "disk -> peg: the peg this disk is standing on, chased down its own support chain.",
  }),
  support: Object.freeze({
    predicate: "mgx:rest-on",
    comment: "disk -> disk or peg: what this disk is resting directly on.",
  }),
  topDisk: Object.freeze({
    predicate: "mgx:top-disk",
    comment: "peg -> disk: the topmost disk on that peg, the only one a legal move can lift.",
  }),
  size: Object.freeze({
    predicate: "mgx:smaller-than",
    comment: "disk -> disk: the taught size order between two disks.",
  }),
  movesDisk: Object.freeze({
    predicate: "mgx:moves-disk",
    comment: "move -> disk: the disk that move lifts.",
  }),
  movesOnto: Object.freeze({
    predicate: "mgx:moves-onto",
    comment: "move -> disk or peg: what that move sets the disk down on.",
  }),
});

/** The class every solution move is filed under, so a count/list question
 *  reaches the move list by the word a visitor would use. */
export const HANOI_MOVE_CLASS = "move";

/** `move-1` … `move-N`, numbered the way the movelist beside the board
 *  numbers them. */
export const hanoiMoveId = (index) => `move-${index + 1}`;

const isThanPredicate = (predicate) => /-than$/.test(String(predicate || ""));

/** Every label the plan itself names, across its states and its actions —
 *  the same set computeBlocksLayout draws its undeclared anchors from. */
function namesInPlan(plan) {
  const named = new Set();
  for (const rows of plan?.states || []) {
    for (const r of rows || []) {
      if (r?.subject != null) named.add(r.subject);
      if (r?.object != null) named.add(r.object);
    }
  }
  for (const a of plan?.actions || []) {
    if (a?.subject != null) named.add(a.subject);
    if (a?.target != null) named.add(a.target);
  }
  return named;
}

/** class -> the members of it this board carries, applying the declared/
 *  undeclared rule from this module's header. */
function boardMembersByClass(plan) {
  const classMembers = plan?.domain?.classMembers || {};
  const renderHints = plan?.domain?.renderHints || {};
  const named = namesInPlan(plan);
  const out = new Map();
  for (const cls of Object.keys(classMembers).sort()) {
    const declared = Object.prototype.hasOwnProperty.call(renderHints, cls);
    const members = [...(classMembers[cls] || [])]
      .filter((m) => declared || named.has(m))
      .sort();
    if (members.length) out.set(cls, members);
  }
  return out;
}

/** Follow `rest-on` from a piece down to whatever it finally stands on. Returns
 *  null when the piece rests on nothing, and when the chain loops back on
 *  itself — a cycle is a position no board can be in, and inventing a peg for
 *  it would be a guess. */
function groundUnder(piece, supportOf) {
  let here = piece;
  const seen = new Set([piece]);
  while (supportOf.has(here)) {
    const next = supportOf.get(here);
    if (seen.has(next)) return null;
    seen.add(next);
    here = next;
  }
  return here === piece ? null : here;
}

/**
 * The board rows for one position of a solved plan, as plain
 * `{ subject, predicate, object }` triples — deterministic for identical
 * inputs, deduplicated, and drawn only from the plan handed in. Pure.
 *
 * `step` is the number of moves played, so `0` is the starting position and
 * `plan.actions.length` is the solved one. Out-of-range steps clamp.
 */
export function hanoiBoardRows({ plan, step = 0 } = {}) {
  const states = plan?.states || [];
  const actions = plan?.actions || [];
  const rows = [];
  const seen = new Set();
  const add = (subject, predicate, object) => {
    if (subject == null || object == null || !predicate) return;
    const key = `${subject} ${predicate} ${object}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ subject: String(subject), predicate, object: String(object) });
  };

  for (const [cls, members] of boardMembersByClass(plan)) {
    for (const m of members) add(m, "rdf:type", cls);
  }

  const at = states.length
    ? states[Math.max(0, Math.min(states.length - 1, Math.floor(Number(step) || 0)))]
    : [];
  const supportOf = new Map();
  const supporting = new Set();
  for (const r of at || []) {
    if (r?.subject == null || r.object == null) continue;
    add(r.subject, r.predicate || HANOI_BOARD_RELATIONS.support.predicate, r.object);
    supportOf.set(String(r.subject), String(r.object));
    supporting.add(String(r.object));
  }

  const topOf = new Map();
  for (const piece of [...supportOf.keys()].sort()) {
    const ground = groundUnder(piece, supportOf);
    if (!ground) continue;
    add(piece, HANOI_BOARD_RELATIONS.placement.predicate, ground);
    if (!supporting.has(piece)) topOf.set(ground, piece);
  }
  for (const [ground, top] of [...topOf.entries()].sort()) {
    add(ground, HANOI_BOARD_RELATIONS.topDisk.predicate, top);
  }

  for (const row of plan?.domain?.ordering || []) {
    if (!isThanPredicate(row?.predicate)) continue;
    add(row.subject, HANOI_BOARD_RELATIONS.size.predicate, row.object);
  }

  actions.forEach((action, i) => {
    const id = hanoiMoveId(i);
    add(id, "rdf:type", HANOI_MOVE_CLASS);
    add(id, HANOI_BOARD_RELATIONS.movesDisk.predicate, action?.subject);
    add(id, HANOI_BOARD_RELATIONS.movesOnto.predicate, action?.target);
  });

  return rows;
}

/** Project hanoiBoardRows' own rows into the `{individuals, objectProperties}`
 *  payload parseEntities consumes, so a page holding a live puzzle can hand
 *  `ask()` a real graph of the position instead of an empty one.
 *
 *  Every `rdf:type` row makes its subject an individual of that class, and
 *  that is the whole individuals set — a term the board only ever mentions as
 *  the object of an edge is not a board piece and gets no class invented for
 *  it. Every other row travels as an edge under its own predicate. Pure. */
export function hanoiBoardGraphPayload(rows) {
  const individuals = new Map();
  for (const row of rows || []) {
    if (row?.predicate !== "rdf:type" || !row.subject || !row.object) continue;
    if (!individuals.has(row.subject)) {
      individuals.set(row.subject, { id: row.subject, label: row.subject, class: row.object });
    }
  }
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.subject || !row.predicate || row.predicate === "rdf:type") continue;
    if (!groups.has(row.predicate)) {
      groups.set(row.predicate, { prop: row.predicate, predicate: row.predicate, examples: [] });
    }
    groups.get(row.predicate).examples.push({ subject: row.subject, object: row.object });
  }
  return { individuals: [...individuals.values()], objectProperties: [...groups.values()] };
}
