// tmct_search — free-text/ranked lookup over the code-map, falling through to the
// memory/corpus facts when a plain concept query misses the code-map entirely.

import { ToolError } from "../../adapters/config.mjs";
import { renderSearch } from "../../domain/codegraph.mjs";
import { memoryFactRows, renderMemoryDefinition } from "../memory-fallthrough.mjs";

export async function tmct_search(args, { graph, config }) {
  const query = String(args?.query || "").trim();
  const kind = String(args?.kind || "").trim();
  if (!query && !kind) throw new ToolError("query is required");
  const out = renderSearch(graph, query, {
    kind,
    decorator: String(args?.decorator || "").trim(),
    name: String(args?.name || "").trim(),
    toolNamePrefix: config?.toolNamePrefix,
  });
  if (!kind && /^no module matches/.test(out)) {
    const fallback = renderMemoryDefinition(await memoryFactRows(config), query);
    if (fallback) return fallback;
  }
  return out;
}
