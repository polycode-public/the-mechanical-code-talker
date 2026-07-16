// tmct_callees — modules a symbol's module calls into, one hop.

import { renderCallees } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_callees = symbolHandler(renderCallees);
