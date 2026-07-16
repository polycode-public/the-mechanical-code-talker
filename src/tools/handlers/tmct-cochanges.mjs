// tmct_cochanges — modules that historically change in the same commit as a symbol's module.

import { renderCochanges } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_cochanges = symbolHandler(renderCochanges);
