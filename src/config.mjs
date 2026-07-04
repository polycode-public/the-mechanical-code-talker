// Configuration for the seonix MCP server. Unlike the marginalia original
// (remote API + key), this server reads a LOCAL graph artifact written by the
// deterministic indexer — so the only knob is where that artifact lives.
//
//   SEONIX_GRAPH_FILE — path to the JSON graph artifact. Default:
//                     <cwd>/.seonix/graph.json. MCP launchers start the server with
//                     cwd = the indexed worktree, so the default resolves to the
//                     artifact `cli index_repository` wrote there — no config needed.

import { join } from "node:path";

export const DEFAULT_GRAPH_REL = join(".seonix", "graph.json");

/** A clean, caller-facing tool error — message shown to the MCP client verbatim,
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
