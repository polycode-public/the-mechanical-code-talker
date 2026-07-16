// tmct_callers — modules that call into a symbol's module, one hop.

import { renderCallers } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_callers = symbolHandler(renderCallers);
