#!/usr/bin/env node
// Write public/models/CREDITS.md from the allowlist in data/mudiii-assets.json,
// or check it for drift. Renders a table of model files with author, source, and
// licence for each, plus the CC0 and three.js MIT licence URLs.
//
//   node scripts/gen-model-credits.mjs            rewrite the file in place
//   node scripts/gen-model-credits.mjs --check     exit 1 if CREDITS.md has drifted

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CREDITS_FILE = path.join(REPO_ROOT, "public/models/CREDITS.md");

function loadAllowlist() {
  const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/mudiii-assets.json"), "utf8"));
  return data.assets;
}

function dedupeByDestPath(assets) {
  // Two manifest keys can share one destPath (a single GLB reused at two
  // target heights, e.g. the food-crumb/food-morsel pair both pointing at
  // haybale.glb). CREDITS.md lists each file once, not once per key.
  const seen = new Set();
  const unique = [];
  for (const asset of assets) {
    if (seen.has(asset.destPath)) continue;
    seen.add(asset.destPath);
    unique.push(asset);
  }
  return unique;
}

export function generateCredits() {
  const assets = dedupeByDestPath(loadAllowlist());

  // Sort by key for readability.
  assets.sort((a, b) => a.key.localeCompare(b.key));

  let markdown = `# Model Credits

Each asset in this directory is governed by the licence recorded below.

| File | Author | Source | Licence | Size |
|------|--------|--------|---------|------|
`;

  let totalBytes = 0;
  for (const asset of assets) {
    const filename = path.basename(asset.destPath);
    const bytes = asset.bytes.toLocaleString();
    totalBytes += asset.bytes;

    markdown += `| ${filename} | ${asset.author} | [${new URL(asset.source).hostname}](${asset.source}) | [${asset.licence}](#${asset.licence.toLowerCase().replace(/\./g, "")}) | ${bytes} |
`;
  }

  markdown += `

**Total: ${totalBytes.toLocaleString()} bytes**

## Licences

### CC0-1.0

CC0 1.0 Universal (CC0 1.0) Public Domain Dedication: https://creativecommons.org/publicdomain/zero/1.0/

### MIT

MIT License: https://opensource.org/licenses/MIT

---

**three.js** (WebGL renderer, loaded in the model viewer on the demo site) is distributed under the MIT License. See https://github.com/mrdoob/three.js/blob/master/LICENSE for details.
`;

  return markdown;
}

function main() {
  const check = process.argv.includes("--check");
  const next = generateCredits();

  if (!fs.existsSync(CREDITS_FILE)) {
    if (check) {
      console.error(`${path.relative(REPO_ROOT, CREDITS_FILE)} does not exist — run: node scripts/gen-model-credits.mjs`);
      return 1;
    }
    fs.writeFileSync(CREDITS_FILE, next);
    console.log(`wrote ${path.relative(REPO_ROOT, CREDITS_FILE)}.`);
    return 0;
  }

  const current = fs.readFileSync(CREDITS_FILE, "utf8");
  if (next === current) {
    console.log("model credits are up to date.");
    return 0;
  }

  if (check) {
    console.error(`${path.relative(REPO_ROOT, CREDITS_FILE)} has drifted from data/mudiii-assets.json — run: node scripts/gen-model-credits.mjs`);
    return 1;
  }

  fs.writeFileSync(CREDITS_FILE, next);
  console.log(`wrote ${path.relative(REPO_ROOT, CREDITS_FILE)}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
