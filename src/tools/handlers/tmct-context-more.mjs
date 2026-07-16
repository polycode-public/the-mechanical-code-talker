// tmct_context_more — the bundle sections a lean tmct_context omitted.

import { contextPlan, renderContextMore } from "../../domain/codegraph.mjs";
import { requiredArg, resolveOrThrow } from "./kit.mjs";

export function tmct_context_more(args, { graph, svc }) {
  const { match } = resolveOrThrow(svc, requiredArg(args, "symbol"), "symbol");
  return renderContextMore(contextPlan(graph, match));
}
