// tmct_describe — locate one symbol and list its typed edges, falling through to the
// memory/corpus facts when the concept is known there but absent from the code-map.

import { renderDescribe, resolveSymbol } from "../../domain/codegraph.mjs";
import { memoryFactRows, renderMemoryDefinition } from "../memory-fallthrough.mjs";
import { requiredArg, resolveOrThrow } from "./kit.mjs";

export async function tmct_describe(args, { graph, svc, config }) {
  const symbol = requiredArg(args, "symbol");
  const { match, candidates } = resolveSymbol(svc.graph, symbol);
  if (match) return renderDescribe(graph, match, { candidates }); // code-map wins when present
  const fallback = renderMemoryDefinition(await memoryFactRows(config), symbol);
  if (fallback) return fallback;
  resolveOrThrow(svc, symbol, "symbol"); // no code-map + no memory fact → the honest miss
}
