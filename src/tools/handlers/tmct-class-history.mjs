// tmct_class_history — commits that touched one class symbol.

import { renderClassHistory } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_class_history = symbolHandler(renderClassHistory);
