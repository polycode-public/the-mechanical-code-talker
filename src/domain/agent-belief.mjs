// agent-belief.mjs — what one agent believes about where another agent or
// item is, this tick. Ground truth inside its own vision radius, else the
// newest position it was told, else nothing at all. The "nothing at all" rung
// is the point: an agent that has not seen and has not been told believes
// nothing, and a deceived agent stays visibly wrong until it looks.
//
// Vision is a plain Chebyshev radius with NO line of sight. Buildings block
// movement (a world pack omits its mgx:has-exit-* edges into an occupied cell)
// and do not block sight. Anyone tempted to add a raycast here should know
// that nothing else in the engine models occlusion, so belief would then
// disagree with the planner, the goal line and the belief panel at once.
//
// The module imports nothing, deliberately. Every world that runs on the
// planning engine shares it, and each world sizes its own board, so belief
// must not inherit any one world's grid constants. Asking a world for its
// clipped list of visible cells is what once bound this test to a 10x10 board
// and made every cell outside it invisible on a larger one.

export const DEFAULT_VISION_RADIUS = 4;

const CELL_ID_RE = /^cell-(\d+)-(\d+)$/;

const cellCoordsOf = (id) => {
  const m = CELL_ID_RE.exec(String(id ?? ""));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};

const cellIdOf = (x, y) => `cell-${x}-${y}`;

const chebyshevSteps = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** The one three-rung walk `believedCellOf` and `beliefOriginOf` both read,
 *  so the cell a panel shows and the "how it knows" label beside it can never
 *  disagree about which rung answered. Returns `{ origin, cell }` or null.
 *
 *  Three rungs, in order:
 *
 *  1. A target the board has removed (eaten, starved, hatched) is believed
 *     nowhere, and no told fact can put it back. A claim about an id that was
 *     never placed at all is a different case and still lands, which is what
 *     keeps deception working.
 *  2. Ground truth (`origin: "seen"`), when the target's real cell sits
 *     within `visionRadius` Chebyshev steps of `observerCell`.
 *  3. The newest told fact addressed to this observer about this target
 *     (`origin: { told: turn }`) — `opts.toldFacts` rows shaped
 *     `{ subject, toAgent, cell, turn }`. Otherwise null.
 *
 *  `state` is a folded world state: `.placements` (subject -> `{ cell }`) and
 *  `.removed` (a Set of subjects off the board). Pure. */
function believedRungOf(targetSubject, observerSubject, observerCell, state, opts = {}) {
  if (state.removed.has(targetSubject)) return null;
  const { visionRadius = DEFAULT_VISION_RADIUS, toldFacts = [] } = opts;
  const place = state.placements.get(targetSubject);
  const at = place ? cellCoordsOf(place.cell) : null;
  if (at && chebyshevSteps(observerCell.x, observerCell.y, at.x, at.y) <= visionRadius) {
    return { origin: "seen", cell: at };
  }
  const told = toldFacts
    .filter((f) => f.toAgent === observerSubject && f.subject === targetSubject)
    .sort((a, b) => (b.turn ?? 0) - (a.turn ?? 0))[0];
  if (!told) return null;
  const cell = cellCoordsOf(told.cell);
  return cell ? { origin: { told: told.turn ?? 0 }, cell } : null;
}

/** Where `observerSubject` currently believes `targetSubject` to be, as an
 *  `{ x, y }` cell, or null for no belief at all. See `believedRungOf` for
 *  the three-rung walk this reads the cell half of. Pure. */
export function believedCellOf(targetSubject, observerSubject, observerCell, state, opts = {}) {
  return believedRungOf(targetSubject, observerSubject, observerCell, state, opts)?.cell ?? null;
}

/** Which rung answered `believedCellOf` for this exact call: `"seen"` when
 *  the target sits within vision, `{ told: turn }` for the newest told fact
 *  that answered, or null when the observer believes nothing. A belief
 *  panel's own "how it knows" column reads this beside the cell
 *  `believedCellOf` returns, off the same walk (`believedRungOf`), so the two
 *  can never drift apart. Pure. */
export function beliefOriginOf(targetSubject, observerSubject, observerCell, state, opts = {}) {
  return believedRungOf(targetSubject, observerSubject, observerCell, state, opts)?.origin ?? null;
}

/** The nearest candidate (by believed Chebyshev distance) an observer has
 *  any belief about at all — null when the observer believes nothing about
 *  any candidate. `candidates` must already be in a deterministic order
 *  (ties favor the earlier candidate). */
export function nearestBelievedTarget(observerSubject, observerCell, candidates, state, opts = {}) {
  let best = null;
  let bestDist = Infinity;
  for (const subject of candidates) {
    const cell = believedCellOf(subject, observerSubject, observerCell, state, opts);
    if (!cell) continue;
    const dist = chebyshevSteps(observerCell.x, observerCell.y, cell.x, cell.y);
    if (dist < bestDist) { bestDist = dist; best = { subject, cell }; }
  }
  return best;
}

/** A full "world knowledge graph" snapshot for one observer this tick: every
 *  OTHER named candidate's believed cell (believedCellOf — ground truth
 *  inside vision, else the newest told fact addressed to this observer,
 *  else null for "unknown") — feeds a per-agent belief panel. Deliberately
 *  never ground truth: showing the observer's own honest gap
 *  between belief and reality (visibly widened by a deceiving pill or a fed
 *  false fact) is the whole point of that panel. Returns a plain
 *  `{ [candidateId]: cellId | null }` map. Exported as the read path for
 *  what one agent can currently observe — every caller (a tick loop, a viz
 *  panel, a chat lane) reads the same computation, never a re-derived copy
 *  of it. */
export function beliefSnapshotFor(observerSubject, observerCell, candidateIds, state, opts) {
  const belief = {};
  for (const candidateId of candidateIds) {
    if (candidateId === observerSubject) continue;
    const cell = believedCellOf(candidateId, observerSubject, observerCell, state, opts);
    belief[candidateId] = cell ? cellIdOf(cell.x, cell.y) : null;
  }
  return belief;
}
