// Which `tmct` binary the CLI/TUI e2e files spawn.
//
// The source tree's bin/tmct.mjs by default, which is what every local run and
// the pre-deploy pipeline wants. TMCT_E2E_CLI_BIN overrides it with an absolute
// path to some other copy — the post-publish job points it at the package it
// just installed from the registry, so the same test files prove the published
// tarball and not only the checkout. Mirrors what TMCT_E2E_BASE_URL does for
// the browser files.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TMCT_BIN = process.env.TMCT_E2E_CLI_BIN
  ? path.resolve(process.env.TMCT_E2E_CLI_BIN)
  : fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));
