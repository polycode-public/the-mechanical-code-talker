// The README's tool section is generated from the tool definitions, so it cannot
// drift from them: edit src/tools/definitions.mjs and the section must be
// regenerated (node scripts/generate-tool-docs.mjs) in the same change.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToolDocs, spliceToolDocs, README_FILE } from "../../scripts/generate-tool-docs.mjs";
import { TOOL_DEFINITIONS } from "../../src/tools/definitions.mjs";

test("the README tool section matches what the tool definitions render", () => {
  const readme = readFileSync(README_FILE, "utf8");
  assert.equal(
    spliceToolDocs(readme, renderToolDocs()),
    readme,
    "README.md's tool section drifted from src/tools/definitions.mjs — run: node scripts/generate-tool-docs.mjs",
  );
});

test("every tool the definitions declare is named in the README section", () => {
  const readme = readFileSync(README_FILE, "utf8");
  for (const { name } of TOOL_DEFINITIONS) {
    assert.ok(readme.includes(`\`${name}\``), `${name} is missing from the README tool section`);
  }
});
