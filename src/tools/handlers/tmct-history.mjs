// tmct_history — recent commits that touched a symbol's module, newest first.

import { renderHistory } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_history = symbolHandler(renderHistory);
