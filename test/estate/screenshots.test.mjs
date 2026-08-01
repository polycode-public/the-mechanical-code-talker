// public/screenshots/ holds the marketing plates public/index.html's feature
// sections embed. They are generated (scripts/gen-screenshots.mjs) rather than
// hand-made, so this checks the committed set stays internally consistent —
// every plate index.html asks for exists, the manifest lists exactly the
// shipped PNGs, and each PNG's own pixel dimensions match what the manifest
// says it captured. It never compares pixel bytes against a fresh capture:
// font hinting and GPU rasterisation differ across machines, so a byte
// comparison would fail on a platform difference having nothing to do with a
// stale screenshot. The manifest's sha256 documents provenance for whoever
// wants to check a specific capture; it is not what this guard re-derives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readPngDimensions } from "../../scripts/gen-screenshots.mjs";

const SCREENSHOTS_DIR = fileURLToPath(new URL("../../public/screenshots/", import.meta.url));
const INDEX = fileURLToPath(new URL("../../public/index.html", import.meta.url));

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", `file://${SCREENSHOTS_DIR}`), "utf8"));
const shippedPngNames = readdirSync(SCREENSHOTS_DIR).filter((name) => name.endsWith(".png"));

test("every screenshot public/index.html's feature plates ask for exists in public/screenshots/", () => {
  const html = readFileSync(INDEX, "utf8");
  const requested = [...html.matchAll(/<img src="\.\/screenshots\/([^"]+\.png)"/g)].map((m) => m[1]);
  assert.ok(requested.length > 0, "the home page requests at least one screenshot");
  for (const name of requested) {
    assert.ok(shippedPngNames.includes(name), `public/screenshots/${name} is referenced by index.html but not shipped`);
  }
});

test("the manifest lists exactly the PNGs shipped in public/screenshots/", () => {
  const manifestFiles = manifest.pages.map((entry) => entry.file).sort();
  assert.deepEqual(manifestFiles, [...shippedPngNames].sort(), "the manifest's file list and the directory's PNGs match exactly");
});

test("the manifest names one page per entry, with no duplicates", () => {
  const names = manifest.pages.map((entry) => entry.page);
  assert.deepEqual(names, [...new Set(names)], "no page is captured twice");
});

test("every manifest entry's viewport matches its own PNG's actual pixel dimensions", () => {
  for (const entry of manifest.pages) {
    const png = readFileSync(new URL(`./${entry.file}`, `file://${SCREENSHOTS_DIR}`));
    const dims = readPngDimensions(png);
    assert.deepEqual(
      dims,
      entry.png,
      `${entry.file}'s manifest entry says ${entry.png.width}x${entry.png.height} but the PNG itself is ${dims.width}x${dims.height} — run \`npm run gen:screenshots\``,
    );
    assert.deepEqual(dims, entry.viewport, `${entry.file} was captured at a viewport its own PNG dimensions don't match`);
  }
});

test("every manifest entry shares the one viewport the manifest declares up front", () => {
  for (const entry of manifest.pages) {
    assert.deepEqual(entry.viewport, manifest.viewport, `${entry.file} does not share the manifest's declared viewport`);
  }
});
