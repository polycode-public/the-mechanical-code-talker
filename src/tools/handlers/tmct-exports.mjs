// tmct_exports — a module's public __all__ surface, each name resolved to its definer.

import { renderExports } from "../../domain/codegraph.mjs";
import { requiredArg, resolveOrThrow } from "./kit.mjs";

export function tmct_exports(args, { graph, svc }) {
  const { match } = resolveOrThrow(svc, requiredArg(args, "module"), "module");
  return renderExports(graph, match);
}
