// Package hygiene: what `npm pack` would publish matches the committed
// manifest exactly (no stray file ships, nothing expected goes missing), and
// publint finds no error in the package metadata / exports map.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { packedPaths, comparePackManifest, MANIFEST_FILE } from "../../scripts/check-pack-manifest.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

test("npm pack would ship exactly the committed manifest", async () => {
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      "npm",
      ["pack", "--dry-run", "--json"],
      // Generous timeout: `npm pack --dry-run` takes ~2s idle but has been
      // observed past 120s when the whole suite runs at full parallelism.
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 480_000 },
      (error, out) => (error ? reject(error) : resolve(out)),
    );
  });
  const expected = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
  const { missing, unexpected } = comparePackManifest(packedPaths(stdout), expected);
  assert.deepEqual(
    { missing, unexpected },
    { missing: [], unexpected: [] },
    "pack contents drifted from test/estate/pack-manifest.json — if intentional, regenerate and commit the manifest",
  );
});

test("publint reports no problem with the package metadata", async () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const { messages } = await publint({ pkgDir: REPO_ROOT });
  assert.deepEqual(messages.map((m) => `${m.type}: ${formatMessage(m, pkg)}`), []);
});
