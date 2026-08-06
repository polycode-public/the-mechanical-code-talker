// Every results/claims/<name>.json is generated, never hand-edited, so this
// re-checks the committed files directly rather than trusting whatever rig
// last wrote them: each must parse, match scripts/claims/schema.json, and
// cite sources that actually exist in the repo. A first sweep pins this to
// exactly what the claims page's own block manifest (CLAIMS_PAGE_BLOCKS,
// scripts/site-pages.mjs) promises to render; a second sweep keeps walking
// every JSON file present, so a file the page doesn't declare still holds
// to the same bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { checkClaim, loadSchema } from "../../scripts/claims/lib.mjs";
import { CLAIMS_PAGE_BLOCKS } from "../../scripts/site-pages.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLAIMS_DIR = join(ROOT, "results", "claims");

function claimFiles() {
  if (!existsSync(CLAIMS_DIR)) return [];
  return readdirSync(CLAIMS_DIR).filter((name) => name.endsWith(".json")).sort();
}

function declaredBlockNames() {
  return [...new Set(Object.values(CLAIMS_PAGE_BLOCKS).flat())].sort();
}

function assertValidClaim(name, path) {
  assert.ok(existsSync(path), `${name}: no results/claims/${name}.json`);
  const raw = readFileSync(path, "utf8");
  let payload;
  assert.doesNotThrow(() => { payload = JSON.parse(raw); }, `${name}: not valid JSON`);
  const problems = checkClaim(payload, loadSchema());
  assert.deepEqual(problems, [], `${name}: schema violations:\n${problems.join("\n")}`);
  for (const source of payload.sources ?? []) {
    assert.ok(existsSync(join(ROOT, source)), `${name}: sources entry "${source}" does not exist`);
  }
}

test("every block the claims page manifest declares has a valid, sourced JSON file", () => {
  for (const name of declaredBlockNames()) {
    assertValidClaim(name, join(CLAIMS_DIR, `${name}.json`));
  }
});

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
