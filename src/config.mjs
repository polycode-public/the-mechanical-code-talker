// Configuration for the tmct tool layer. Unlike the marginalia original
// (remote API + key), this reads a LOCAL graph artifact — so the only knob is
// where that artifact lives.
//
//   TMCT_GRAPH_FILE — path to the JSON graph artifact. Default:
//                     <cwd>/.tmct/graph.json. Run with cwd = the repo, and the
//                     default resolves to that repo's artifact — no config needed.

import { join, resolve } from "node:path";

export const DEFAULT_GRAPH_REL = join(".tmct", "graph.json");

/** A clean, caller-facing tool error — message shown to the caller verbatim,
 *  never a stack. */
export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  // Always resolve to an absolute path, even when TMCT_GRAPH_FILE is set to a
  // relative one — src/source-slice.mjs's path-traversal guard compares an
  // always-absolute resolve(repoRoot, site.path) against repoRoot itself, so a
  // relative repoRoot (derived from this graphFile) would make that guard
  // reject every read, not just traversal attempts.
  const graphFile = env.TMCT_GRAPH_FILE && env.TMCT_GRAPH_FILE.trim()
    ? resolve(cwd, env.TMCT_GRAPH_FILE.trim())
    : join(cwd, DEFAULT_GRAPH_REL);
  return { graphFile };
}
