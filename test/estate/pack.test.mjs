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

// One real `npm pack --dry-run --json` call, shared by every test below that
// needs the packed file list — the call itself costs ~2s idle (observed past
// 120s when the whole suite runs at full parallelism), so nothing here pays
// for a second one just to check a different slice of the same list.
const packDryRunStdout = new Promise((resolve, reject) => {
  execFile(
    "npm",
    ["pack", "--dry-run", "--json"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 480_000 },
    (error, out) => (error ? reject(error) : resolve(out)),
  );
});

test("npm pack would ship exactly the committed manifest", async () => {
  const expected = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
  const { missing, unexpected } = comparePackManifest(packedPaths(await packDryRunStdout), expected);
  assert.deepEqual(
    { missing, unexpected },
    { missing: [], unexpected: [] },
    "pack contents drifted from test/estate/pack-manifest.json — if intentional, regenerate and commit the manifest",
  );
});

test("data/sprites-large/ (the sprite tier meant to be looked at closely) never ships in the npm package", async () => {
  const shipped = packedPaths(await packDryRunStdout).filter((p) => p.startsWith("data/sprites-large/"));
  assert.deepEqual(shipped, [], "data/sprites-large/ must stay excluded — only the deployed site's fetched pack carries this tier");
});

test("publint reports no problem with the package metadata", async () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const { messages } = await publint({ pkgDir: REPO_ROOT });
  assert.deepEqual(messages.map((m) => `${m.type}: ${formatMessage(m, pkg)}`), []);
});

test("every declared export subpath resolves through the exports map", async () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  for (const subpath of Object.keys(pkg.exports)) {
    const specifier = subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
    const mod = await import(specifier);
    assert.ok(
      Object.keys(mod).length > 0,
      `${specifier} resolves but exports nothing`,
    );
  }
});
