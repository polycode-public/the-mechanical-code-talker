// tmct_signature — one symbol's API surface without the body.

import { renderSignature } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_signature = symbolHandler(renderSignature);
