// Package hygiene: what `npm pack` would publish matches the committed
// manifest exactly (no stray file ships, nothing expected goes missing), every
// import inside that shipped tree resolves to another shipped file, and publint
// finds no error in the package metadata / exports map.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { packedPaths, comparePackManifest, MANIFEST_FILE } from "../../scripts/check-pack-manifest.mjs";
import { unshippedImports, packageEntryPaths } from "../../src/domain/pack-manifest.mjs";

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

// `files` takes src/ wholesale and subtracts maintainer-tier modules by name,
// so a shipped module can start importing a subtracted one without changing the
// packed list at all. The manifest check above stays green and the tarball still
// throws ERR_MODULE_NOT_FOUND on a consumer's first run. This walks the graph
// from the package's own entry points instead, over the same pack output.
test("every import the packed tree reaches resolves to a packed file", async () => {
  const shipped = packedPaths(await packDryRunStdout);
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const broken = unshippedImports({
    packedPaths: shipped,
    entryPaths: packageEntryPaths(pkg),
    readSource: (rel) => {
      try {
        return readFileSync(path.join(REPO_ROOT, rel), "utf8");
      } catch {
        return null;
      }
    },
  });
  assert.deepEqual(
    broken.map((b) => `${b.from} imports ${b.specifier}, which does not ship`),
    [],
    "the published tarball would fail to load — ship the target, or stop importing it from a shipped module",
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
