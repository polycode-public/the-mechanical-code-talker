// Every module under src/ lives in its layer's own directory, so the path says
// which layer it is in and there is no list to keep in step with the tree. A
// module directly under src/, or under any directory that is not a layer, is
// claimed by nobody and the checker fails on it.

// domain is the core: pure rules and pure data, importing nothing at all — not a
// node builtin, not a package, not another layer. Every layer above it may reach
// down to it. adapters implement I/O in terms of that core, so a store reaching
// for a hash or a trust score points inward, which is the direction of the rule.
// A core module reaching back out to an adapter is what the checker exists to
// catch: inject the adapter instead.
//
// tools sits under services because that is the way the dependency actually runs:
// a tool answers one graph question over domain and adapters and needs no service,
// while chat is a service whose job includes dispatching tools. surfaces sit on top
// and may reach anything below.
export const LAYER_RANK = { domain: 0, adapters: 1, tools: 2, services: 3, surfaces: 4 };

/** Layer for a src/-relative path, or null when nothing claims it. */
export function layerOf(relPath) {
  const [top] = relPath.split("/");
  return Object.hasOwn(LAYER_RANK, top) ? top : null;
}
