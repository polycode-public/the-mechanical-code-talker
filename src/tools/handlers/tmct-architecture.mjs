// tmct_architecture — package/module map plus the most-imported hub modules.

import { renderArchitecture } from "../../domain/codegraph.mjs";

export function tmct_architecture(args, { graph }) {
  return renderArchitecture(graph, { pkg: String(args?.package || "").trim() });
}
