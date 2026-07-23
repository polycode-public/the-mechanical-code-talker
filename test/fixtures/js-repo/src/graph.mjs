// Core graph helpers — the module every other file in this fixture imports.
export const MAX_DEPTH = 32;

/**
 * Walk a node tree to a bounded depth and count the nodes seen.
 */
export function parseNode(node, depth = 0) {
  if (!node || depth > MAX_DEPTH) return 0;
  let total = 1;
  for (const child of node.children || []) {
    total += parseNode(child, depth + 1);
  }
  return total;
}
