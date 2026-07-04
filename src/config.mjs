// Configuration for the tmct tool layer. Unlike the marginalia original
// (remote API + key), this reads a LOCAL graph artifact — so the only knob is
// where that artifact lives.
//
//   TMCT_GRAPH_FILE — path to the JSON graph artifact. Default:
//                     <cwd>/.tmct/graph.json. Run with cwd = the repo, and the
//                     default resolves to that repo's artifact — no config needed.

import { join } from "node:path";

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
  const graphFile = env.TMCT_GRAPH_FILE && env.TMCT_GRAPH_FILE.trim()
    ? env.TMCT_GRAPH_FILE.trim()
    : join(cwd, DEFAULT_GRAPH_REL);
  return { graphFile };
}
