import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { TMCT_BIN } from "./helpers/cli-bin.mjs";

test("the tmct binary prints usage and exits 0 on --help", () => {
  const out = execFileSync(process.execPath, [TMCT_BIN, "--help"], {
    encoding: "utf8",
  });
  assert.match(out, /tmct/i);
});
