#!/usr/bin/env node
// Write README.md's generated tool section, or check it for drift. The
// rendering itself is src/tools/readme-docs.mjs; this reads and writes the file.
//
//   node scripts/generate-tool-docs.mjs            rewrite the section in place
//   node scripts/generate-tool-docs.mjs --check     exit 1 if the README has drifted
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToolDocs, spliceToolDocs, BEGIN_MARKER, END_MARKER } from "../src/tools/readme-docs.mjs";

export { renderToolDocs, spliceToolDocs, BEGIN_MARKER, END_MARKER };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const README_FILE = path.join(REPO_ROOT, "README.md");

function main() {
  const check = process.argv.includes("--check");
  const readme = fs.readFileSync(README_FILE, "utf8");
  const next = spliceToolDocs(readme, renderToolDocs());
  if (next === readme) {
    console.log("README tool section is up to date.");
    return 0;
  }
  if (check) {
    console.error("README tool section has drifted from src/tools/definitions.mjs — run: node scripts/generate-tool-docs.mjs");
    return 1;
  }
  fs.writeFileSync(README_FILE, next);
  console.log(`wrote the tool section into ${path.relative(REPO_ROOT, README_FILE)}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
