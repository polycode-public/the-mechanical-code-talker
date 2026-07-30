// mud-facts.mjs — the one `mgx:is-predator` reader shared across the
// client/server boundary: mud-turn.mjs (the server-side turn engine, deciding
// which rooms to route an animal away from) and mud-viz.mjs (the client-facing
// view, deciding which room to draw a pounce against) each asked "which
// subject does the world mark dangerous" their own way, over the exact same
// filter. One reader here, so the two never drift apart on what counts as a
// predator.

/** Every subject the world marks `mgx:is-predator` true, in fact-row order.
 *  Pure. */
export function predatorSubjects(rows) {
  return (rows || [])
    .filter((r) => r.predicate === "mgx:is-predator" && r.object === "true")
    .map((r) => r.subject);
}
