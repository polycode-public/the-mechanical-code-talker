// The packed-tree import walk: what it follows, what it reports, and what it
// deliberately ignores. The estate tier runs the same function against the real
// `npm pack` output; these pin its behaviour against small fixed graphs, so a
// green estate run means the graph is clean rather than that the walk is blind.
import test from "node:test";
import assert from "node:assert/strict";
import { unshippedImports, packageEntryPaths } from "../../src/domain/pack-manifest.mjs";

/** A readSource over a plain {path: source} map. */
const reader = (files) => (rel) => (rel in files ? files[rel] : null);

test("a shipped module importing an unshipped one is reported with both ends", () => {
  const files = {
    "bin/cli.mjs": `import { render } from "../src/services/page.mjs";`,
    "src/services/page.mjs": `import { pluralOf } from "../domain/inflect.mjs";`,
  };
  const broken = unshippedImports({
    packedPaths: ["bin/cli.mjs", "src/services/page.mjs"],
    entryPaths: ["bin/cli.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken, [
    { from: "src/services/page.mjs", specifier: "../domain/inflect.mjs", target: "src/domain/inflect.mjs" },
  ]);
});

test("a fully packed graph reports nothing", () => {
  const files = {
    "bin/cli.mjs": `import { render } from "../src/services/page.mjs";`,
    "src/services/page.mjs": `import { pluralOf } from "../domain/inflect.mjs";`,
    "src/domain/inflect.mjs": `export const pluralOf = (w) => \`\${w}s\`;`,
  };
  const broken = unshippedImports({
    packedPaths: Object.keys(files),
    entryPaths: ["bin/cli.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken, []);
});

test("an unshipped module nothing reachable imports is left alone", () => {
  const files = {
    "bin/cli.mjs": `import { render } from "../src/services/page.mjs";`,
    "src/services/page.mjs": `export const render = () => "";`,
    "src/domain/maintainer-only.mjs": `import { x } from "./gone.mjs";`,
  };
  const broken = unshippedImports({
    packedPaths: ["bin/cli.mjs", "src/services/page.mjs"],
    entryPaths: ["bin/cli.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken, []);
});

test("a re-export edge counts, the same as a plain import", () => {
  const files = {
    "src/services/index.mjs": `export { wordBeforeCursor } from "./theme.mjs";`,
    "src/services/theme.mjs": `export { pluralOf } from "../domain/inflect.mjs";`,
  };
  const broken = unshippedImports({
    packedPaths: ["src/services/index.mjs", "src/services/theme.mjs"],
    entryPaths: ["src/services/index.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken.map((b) => b.target), ["src/domain/inflect.mjs"]);
});

test("a dynamic import counts too — it fails on the consumer's second command instead of the first", () => {
  const files = {
    "bin/cli.mjs": `const m = await import("../src/services/viz.mjs");`,
    "src/services/viz.mjs": `import { pluralOf } from "../domain/inflect.mjs";`,
  };
  const broken = unshippedImports({
    packedPaths: ["bin/cli.mjs", "src/services/viz.mjs"],
    entryPaths: ["bin/cli.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken.map((b) => b.target), ["src/domain/inflect.mjs"]);
});

test("a browser-runtime URL in an emitted page is not a module edge", () => {
  const files = {
    "src/services/page.mjs": "export const html = `<script>import(\"./vendor/wink.js\")</script>`;",
  };
  const broken = unshippedImports({
    packedPaths: ["src/services/page.mjs"],
    entryPaths: ["src/services/page.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken, []);
});

test("a cycle terminates instead of walking forever", () => {
  const files = {
    "a.mjs": `import "./b.mjs";`,
    "b.mjs": `import "./a.mjs";\nimport "./missing.mjs";`,
  };
  const broken = unshippedImports({
    packedPaths: ["a.mjs", "b.mjs"],
    entryPaths: ["a.mjs"],
    readSource: reader(files),
  });
  assert.deepEqual(broken.map((b) => b.target), ["missing.mjs"]);
});

test("the entry paths are the bin, main and exports targets, deduped and root-relative", () => {
  const entries = packageEntryPaths({
    bin: { tmct: "./bin/tmct.mjs" },
    main: "./src/services/index.mjs",
    exports: { ".": "./src/services/index.mjs", "./ingest": "./src/services/extract-facts.mjs" },
  });
  assert.deepEqual(entries, ["bin/tmct.mjs", "src/services/extract-facts.mjs", "src/services/index.mjs"]);
});

test("a conditional exports entry contributes each of its condition targets", () => {
  const entries = packageEntryPaths({
    exports: { "./ask-browser": { browser: "./src/surfaces/web/entry.mjs", default: "./src/services/ask.mjs" } },
  });
  assert.deepEqual(entries, ["src/services/ask.mjs", "src/surfaces/web/entry.mjs"]);
});
