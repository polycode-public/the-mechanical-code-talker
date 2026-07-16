// tmct_subclasses — a class's bases plus the transitive set of classes that extend it,
// falling through to the memory/corpus isa-family facts for a concept the code-map
// doesn't hold.

import { renderSubclasses, resolveSymbol } from "../../domain/codegraph.mjs";
import { memoryFactRows, renderMemorySubclasses } from "../memory-fallthrough.mjs";
import { requiredArg, resolveOrThrow } from "./kit.mjs";

export async function tmct_subclasses(args, { graph, svc, config }) {
  const symbol = requiredArg(args, "class");
  const { match } = resolveSymbol(svc.graph, symbol);
  if (match) return renderSubclasses(graph, match); // code-map wins when present
  const fallback = renderMemorySubclasses(await memoryFactRows(config), symbol);
  if (fallback) return fallback;
  resolveOrThrow(svc, symbol, "class"); // no code-map subclass + no memory fact → honest miss
}
