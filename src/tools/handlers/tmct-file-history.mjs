// tmct_file_history — commits that touched a symbol's module, with author / date / subject.

import { renderFileHistory } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_file_history = symbolHandler(renderFileHistory);
