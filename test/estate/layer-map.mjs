// Every module under src/ lives in its layer's own directory, so the path says
// which layer it is in and there is no list to keep in step with the tree. A
// module directly under src/, or under any directory that is not a layer, is
// claimed by nobody and the checker fails on it.

export const LAYER_RANK = { adapters: 0, domain: 1, services: 2, tools: 3, surfaces: 4 };

/** Layer for a src/-relative path, or null when nothing claims it. */
export function layerOf(relPath) {
  const [top] = relPath.split("/");
  return Object.hasOwn(LAYER_RANK, top) ? top : null;
}
