// tmct_calls — the in-repo symbols a function calls, each with file:line.

import { renderCalls } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_calls = symbolHandler(renderCalls);
