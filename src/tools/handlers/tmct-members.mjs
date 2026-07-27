// tmct_members — a class's methods and attributes. A concept's "members" in the corpus
// sense are its subclasses (its instances), which is the fall-through when the code-map
// has no such class.

import { renderMembers, resolveSymbol } from "../../domain/codegraph.mjs";
import { memoryFactRows, renderMemorySubclasses } from "../memory-fallthrough.mjs";
import { requiredArg, resolveOrThrow } from "./kit.mjs";

export async function tmct_members(args, { graph, svc, config }) {
  const symbol = requiredArg(args, "class");
  const { match } = resolveSymbol(svc.graph, symbol);
  if (match) return renderMembers(graph, match, { toolNamePrefix: config?.toolNamePrefix }); // code-map wins when present
  const fallback = renderMemorySubclasses(await memoryFactRows(config), symbol);
  if (fallback) return fallback;
  resolveOrThrow(svc, symbol, "class"); // the honest miss
}
