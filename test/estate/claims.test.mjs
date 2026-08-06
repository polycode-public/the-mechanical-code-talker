// Every results/claims/<name>.json is generated, never hand-edited, so this
// re-checks the committed files directly rather than trusting whatever rig
// last wrote them: each must parse, match scripts/claims/schema.json, and
// cite sources that actually exist in the repo. Once the claims page lands,
// this guard grows a companion check against the page's block manifest; for
// now it walks every JSON file present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { checkClaim, loadSchema } from "../../scripts/claims/lib.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLAIMS_DIR = join(ROOT, "results", "claims");

function claimFiles() {
  if (!existsSync(CLAIMS_DIR)) return [];
  return readdirSync(CLAIMS_DIR).filter((name) => name.endsWith(".json")).sort();
}

test("every results/claims JSON file parses and matches schema.json", () => {
  const schema = loadSchema();
  for (const name of claimFiles()) {
    const raw = readFileSync(join(CLAIMS_DIR, name), "utf8");
    let payload;
    assert.doesNotThrow(() => { payload = JSON.parse(raw); }, `${name}: not valid JSON`);
    const problems = checkClaim(payload, schema);
    assert.deepEqual(problems, [], `${name}: schema violations:\n${problems.join("\n")}`);
  }
});

test("every results/claims JSON file's sources exist in the repo", () => {
  for (const name of claimFiles()) {
    const payload = JSON.parse(readFileSync(join(CLAIMS_DIR, name), "utf8"));
    for (const source of payload.sources ?? []) {
      assert.ok(existsSync(join(ROOT, source)), `${name}: sources entry "${source}" does not exist`);
    }
  }
});
