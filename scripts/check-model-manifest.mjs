#!/usr/bin/env node
// scripts/check-model-manifest.mjs — verify that public/models/ contains
// exactly the files listed in the closed allowlist (data/mudiii-assets.json),
// and that each matches its recorded byte size and sha256. The closed-list
// guard makes licence-trap miscopies structurally impossible, not just
// documented. Exits 1 with a detailed report on any mismatch.
//
//   node scripts/check-model-manifest.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadAllowlist() {
  const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/mudiii-assets.json"), "utf8"));
  return data.assets;
}

function getFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

function walkDir(dir, cb) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, cb);
    } else {
      cb(fullPath);
    }
  }
}

function main() {
  const allowlist = loadAllowlist();
  const allowedSet = new Set(allowlist.map((a) => a.destPath));
  const forbiddenPattern = /\b(eastbrook|yumi_cat|wolf_basic|greyjaw)\b/;

  let errors = [];
  let totalBytes = 0;
  const countedPaths = new Set();
  const table = [];

  // Check for forbidden sourcePaths (belt and braces).
  for (const asset of allowlist) {
    if (forbiddenPattern.test(asset.sourcePath)) {
      errors.push(
        `licence violation: ${asset.key} sourcePath "${asset.sourcePath}" matches forbidden pattern. ` +
          `This asset is licensed for use only within world-of-claudecraft, not extractable to standalone demos.`
      );
    }
  }

  // Verify each allowlist entry exists with correct bytes and hash.
  for (const asset of allowlist) {
    const destPath = path.join(REPO_ROOT, asset.destPath);
    if (!fs.existsSync(destPath)) {
      errors.push(`missing file: ${asset.destPath}`);
      continue;
    }

    const stats = fs.statSync(destPath);
    const actualBytes = stats.size;
    const actualSha256 = getFileSha256(destPath);

    const bytesMatch = actualBytes === asset.bytes;
    const sha256Match = actualSha256 === asset.sha256;

    if (!bytesMatch) {
      errors.push(
        `byte mismatch: ${asset.destPath} is ${actualBytes} bytes, expected ${asset.bytes}`
      );
    }

    if (!sha256Match) {
      errors.push(
        `sha256 mismatch: ${asset.destPath} has hash ${actualSha256}, expected ${asset.sha256}`
      );
    }

    // Check licence is allowed.
    if (!["CC0-1.0", "MIT"].includes(asset.licence)) {
      errors.push(`invalid licence: ${asset.destPath} has licence "${asset.licence}", must be CC0-1.0 or MIT`);
    }

    // Two keys can point at one file, so count bytes per file rather than per row.
    if (!countedPaths.has(asset.destPath)) {
      countedPaths.add(asset.destPath);
      totalBytes += actualBytes;
    }

    table.push({
      key: asset.key,
      file: path.basename(asset.destPath),
      bytes: actualBytes,
      bytesOK: bytesMatch ? "✓" : "✗",
      sha256: actualSha256.substring(0, 16) + "...",
      sha256OK: sha256Match ? "✓" : "✗",
    });
  }

  // Check for unexpected files in public/models/ not in allowlist.
  const modelDir = path.join(REPO_ROOT, "public/models");
  const allModelFiles = [];
  walkDir(modelDir, (file) => {
    if (file.endsWith(".glb")) {
      const relPath = path.relative(REPO_ROOT, file);
      allModelFiles.push(relPath);
    }
  });

  for (const file of allModelFiles) {
    if (!allowedSet.has(file)) {
      errors.push(`unexpected file: ${file} is not in the allowlist`);
    }
  }

  // Print results table.
  console.log("Model Manifest:");
  console.log("─".repeat(95));
  console.log("Key                 | File               | Bytes    | OK | SHA256(first 16)     | OK");
  console.log("─".repeat(95));

  for (const row of table) {
    const key = row.key.padEnd(18);
    const file = row.file.padEnd(18);
    const bytes = String(row.bytes).padEnd(8);
    const bytesOk = row.bytesOK.padEnd(3);
    const sha = row.sha256.padEnd(20);
    const shaOk = row.sha256OK;

    console.log(`${key}| ${file}| ${bytes}| ${bytesOk}| ${sha}| ${shaOk}`);
  }

  console.log("─".repeat(95));
  console.log(`Total: ${countedPaths.size} files, ${totalBytes} bytes (${(totalBytes / 1024 / 1024).toFixed(2)} MB)\n`);

  // Report errors if any.
  if (errors.length) {
    console.error(`${errors.length} error(s) found:`);
    for (const err of errors) console.error(`  • ${err}`);
    process.exit(1);
  }

  console.log("model-manifest check: OK — all files present with correct sizes and hashes");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
