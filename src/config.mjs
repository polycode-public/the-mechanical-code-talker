// Configuration for the seonix tool layer. Unlike the marginalia original
// (remote API + key), this reads a LOCAL graph artifact — so the only knob is
// where that artifact lives.
//
//   SEONIX_GRAPH_FILE — path to the JSON graph artifact. Default:
//                     <cwd>/.seonix/graph.json. Run with cwd = the repo, and the
//                     default resolves to that repo's artifact — no config needed.

import { join } from "node:path";

export const DEFAULT_GRAPH_REL = join(".seonix", "graph.json");

/** A clean, caller-facing tool error — message shown to the caller verbatim,
 *  never a stack. */
export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const graphFile = env.SEONIX_GRAPH_FILE && env.SEONIX_GRAPH_FILE.trim()
    ? env.SEONIX_GRAPH_FILE.trim()
    : join(cwd, DEFAULT_GRAPH_REL);
  return { graphFile };
}
