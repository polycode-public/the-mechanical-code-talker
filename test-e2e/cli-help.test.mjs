import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

test("the tmct binary prints usage and exits 0 on --help", () => {
  const out = execFileSync(process.execPath, [path.join(repoRoot, "bin", "tmct.mjs"), "--help"], {
    encoding: "utf8",
  });
  assert.match(out, /tmct/i);
});
