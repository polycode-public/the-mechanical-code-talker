// tmct_tests_for — the test modules covering a symbol or module.

import { renderTestsFor } from "../../domain/codegraph.mjs";
import { symbolHandler } from "./kit.mjs";

export const tmct_tests_for = symbolHandler(renderTestsFor);
