// The BOOTSTRAP reference provider — the empty/degenerate graph a fresh repo
// "contains" before anything is indexed. archive/PLAN_REPOSITORY_INTERFACE.md deliverable
// 2: "bootstrap returns honest empties".
//
// It implements every Repository-Interface service over the empty bootstrap
// payload (src/source.mjs emptyEntities): every id-taking service returns
// miss(UNRESOLVED_TERM) — there are no individuals — and every aggregate returns
// an honest empty (stats.total = 0, untested.modules = [], …). Nothing throws.
// This is the other end of the compatibility kit: the provider that has no data
// must still CONFORM.

import { parseEntities } from "../codegraph.mjs";
import { emptyEntities } from "../source.mjs";
import { createGraphService } from "./graph-service.mjs";

/** The parsed empty bootstrap graph. */
export function bootstrapGraph() {
  return parseEntities(emptyEntities());
}

/** The bootstrap provider: every service over the empty graph — honest empties.
 *  `opts` passes straight through to createGraphService (e.g. `{ sourceAccess: true,
 *  repoRoot, readFile }`), same pass-through as fixtureProvider. */
export function bootstrapProvider(opts = {}) {
  return createGraphService(bootstrapGraph(), opts);
}
