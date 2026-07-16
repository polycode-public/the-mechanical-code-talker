// tmct_impact — transitive reverse closure over imports/calls: what breaks if a module changes.

import { renderImpact } from "../../domain/codegraph.mjs";
import { requiredArg, resolveOrThrow } from "./kit.mjs";

export function tmct_impact(args, { graph, svc }) {
  const { match } = resolveOrThrow(svc, requiredArg(args, "module"), "module");
  return renderImpact(graph, match);
}
