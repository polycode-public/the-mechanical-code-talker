// Every file under public/models/ must be in the allowlist, and each allowlist
// entry must exist on disk with the recorded byte size and SHA256 hash. This
// estate guard makes the licence-trap (miscopied assets) structurally impossible
// to miss — a drift fails in the normal unit tier.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

test("all files in public/models/ are in the allowlist", () => {
  const allowlist = loadAllowlist();
  const allowedSet = new Set(allowlist.map((a) => a.destPath));
  const modelDir = path.join(REPO_ROOT, "public/models");
  const allModelFiles = [];

  walkDir(modelDir, (file) => {
    if (file.endsWith(".glb")) {
      const relPath = path.relative(REPO_ROOT, file);
      allModelFiles.push(relPath);
    }
  });

  for (const file of allModelFiles) {
    assert.ok(allowedSet.has(file), `unexpected file: ${file} is not in the allowlist`);
  }
});

test("every allowlist entry exists with correct byte size and SHA256", () => {
  const allowlist = loadAllowlist();

  for (const asset of allowlist) {
    const destPath = path.join(REPO_ROOT, asset.destPath);
    assert.ok(fs.existsSync(destPath), `missing file: ${asset.destPath}`);

    const stats = fs.statSync(destPath);
    const actualBytes = stats.size;
    const actualSha256 = getFileSha256(destPath);

    assert.equal(actualBytes, asset.bytes, `byte mismatch: ${asset.destPath} is ${actualBytes} bytes, expected ${asset.bytes}`);
    assert.equal(actualSha256, asset.sha256, `sha256 mismatch: ${asset.destPath} has hash ${actualSha256}, expected ${asset.sha256}`);
  }
});

test("all allowlist entries have allowed licences", () => {
  const allowlist = loadAllowlist();
  const allowedLicences = new Set(["CC0-1.0", "MIT"]);

  for (const asset of allowlist) {
    assert.ok(allowedLicences.has(asset.licence), `invalid licence: ${asset.destPath} has licence "${asset.licence}", must be CC0-1.0 or MIT`);
  }
});

test("no allowlist entry matches forbidden sourcePath patterns (eastbrook/yumi_cat/wolf_basic/greyjaw)", () => {
  const allowlist = loadAllowlist();
  const forbiddenPattern = /\b(eastbrook|yumi_cat|wolf_basic|greyjaw)\b/;

  for (const asset of allowlist) {
    assert.ok(
      !forbiddenPattern.test(asset.sourcePath),
      `licence violation: ${asset.key} sourcePath "${asset.sourcePath}" matches forbidden pattern. This asset is licensed for use only within world-of-claudecraft, not extractable to standalone demos.`
    );
  }
});

test("public/models/CREDITS.md matches what gen-model-credits.mjs would write", async () => {
  const { generateCredits } = await import("../../scripts/gen-model-credits.mjs");
  const onDisk = fs.readFileSync(path.join(REPO_ROOT, "public/models/CREDITS.md"), "utf8");
  assert.equal(onDisk, generateCredits(), "public/models/CREDITS.md has drifted from data/mudiii-assets.json — run: node scripts/gen-model-credits.mjs");
});

test("two allowlist keys that share a destPath appear once in CREDITS.md, not once per key", () => {
  const allowlist = loadAllowlist();
  const destPaths = allowlist.map((a) => a.destPath);
  const sharedDestPath = destPaths.find((d, i) => destPaths.indexOf(d) !== i);
  assert.ok(sharedDestPath, "expected at least one destPath reused by two keys to exercise the dedupe path");

  const onDisk = fs.readFileSync(path.join(REPO_ROOT, "public/models/CREDITS.md"), "utf8");
  const filename = path.basename(sharedDestPath);
  const occurrences = onDisk.split(`| ${filename} |`).length - 1;
  assert.equal(occurrences, 1, `${filename} should list once in CREDITS.md even though ${destPaths.filter((d) => d === sharedDestPath).length} allowlist keys point at it`);
});
