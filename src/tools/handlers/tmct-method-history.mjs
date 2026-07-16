// tmct_method_history — commits that touched one method symbol.

import { renderMethodHistory } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_method_history = symbolHandler(renderMethodHistory);
