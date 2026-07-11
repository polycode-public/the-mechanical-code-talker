// ask-browser-bundle.test.mjs — proves the checked-in browser ask-engine
// bundle (scripts/build-ask-bundle.mjs's output, src/ask-browser.bundle.js,
// inlined by `tmct viz`'s "Ask the graph" panel) actually evaluates as a
// classic script with no Node built-ins, no wink model, and still answers —
// the same boundary test/ask-nlp.test.mjs's own "viewer bundle without wink"
// test proves for the underlying regex-strip approach, now proving the real
// esbuild artifact this project ships. Precedent: seonix's own
// test/ask-browser-bundle.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(here, "..", "src", "ask-browser.bundle.js");
const FIXTURE_PATH = join(here, "fixtures", "entities.fixture.json");

async function loadBundleContext() {
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  const ctx = vm.createContext({ console });
  vm.runInContext(bundle, ctx);
  return ctx;
}

test("ask-browser.bundle.js exists and is a checked-in build artifact (run `npm run build:ask-bundle` if this fails)", async () => {
  const stat = await readFile(BUNDLE_PATH, "utf8").catch(() => null);
  assert.ok(stat && stat.length > 1000, "the bundle exists and is non-trivial");
});

test("the bundle evaluates as a classic script with no live import/require/import.meta and exposes globalThis.tmctViz", async () => {
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  assert.doesNotMatch(bundle, /^import\s/m, "an import statement survived bundling — not a valid classic <script>");
  assert.doesNotMatch(bundle, /\bcreateRequire\(/, "a live createRequire call would throw in a browser");
  const ctx = await loadBundleContext();
  assert.equal(typeof vm.runInContext("tmctViz", ctx), "object", "globalThis.tmctViz is exposed");
});

test("tmctViz exposes ask, parseQuery, parseEntities, spiralExpand, mostRecentIndividual, derivedUpdatedAt, MEMORY_SPIRAL_EXPAND_KINDS, buildVizNodesAndEdges", async () => {
  const ctx = await loadBundleContext();
  const keys = vm.runInContext("Object.keys(tmctViz)", ctx);
  for (const name of ["ask", "parseQuery", "parseEntities", "spiralExpand", "mostRecentIndividual", "derivedUpdatedAt", "MEMORY_SPIRAL_EXPAND_KINDS", "buildVizNodesAndEdges"]) {
    assert.ok(keys.includes(name), `tmctViz.${name} is exposed`);
    assert.notEqual(vm.runInContext(`typeof tmctViz.${name}`, ctx), "undefined");
  }
});

test("e2e: the bundled engine answers a real query against a real fixture graph, adapter-less (no wink)", async () => {
  const ctx = await loadBundleContext();
  const payload = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  ctx.__raw = payload;
  vm.runInContext("globalThis.__graph = tmctViz.parseEntities(__raw);", ctx);

  // Exact grammar — the curated tier works with no adapter.
  const clean = vm.runInContext('tmctViz.ask(__graph, "which modules import a.mjs")', ctx);
  assert.equal(clean.tmct_ask.miss, false);
  assert.match(clean.content, /app\/lib\/b\.mjs/);
  // The canonical restatement (PLAN_BREADTH_FIRST_NLU.md Track 6) rides along too.
  assert.ok(clean.tmct_ask.canonical, "the canonical {english, machine} form is present in the bundle's ask() output");
  assert.equal(clean.tmct_ask.canonical.machine.startsWith("reverse("), true);

  // Curated misspelling correction — plain tables, no adapter needed.
  const typo = vm.runInContext('tmctViz.ask(__graph, "whcih moduels import a.mjs")', ctx);
  assert.equal(typo.tmct_ask.miss, false);

  // Lemma tier is honestly OFF (no wink in this bundle by design — a ~4MB model
  // deliberately kept out of a self-contained viz.html): an inflected form that
  // only the lemma tier resolves stays a grammar miss, exactly like
  // test/ask-nlp.test.mjs's own proven boundary.
  const inflected = vm.runInContext('tmctViz.ask(__graph, "what imported a.mjs")', ctx);
  assert.equal(inflected.tmct_ask.miss, true);
});

test("e2e: spiralExpand + buildVizNodesAndEdges reproduce the CLI's own viz-graph shape inside the bundle", async () => {
  const ctx = await loadBundleContext();
  const payload = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  ctx.__raw = payload;
  vm.runInContext("globalThis.__graph = tmctViz.parseEntities(__raw);", ctx);
  const seedId = vm.runInContext("__graph.individuals[0].id", ctx);
  ctx.__seedId = seedId;
  const walked = vm.runInContext(
    "tmctViz.spiralExpand(__graph, [], {classPredicate: () => true, idNormalizer: (id) => id, seeds: [__seedId]})",
    ctx,
  );
  assert.ok(walked.length > 0, "the walk reaches at least the seed");
  assert.equal(walked[0].id, seedId);
  assert.equal(walked[0].hop, 0);
  ctx.__walked = walked;
  const built = vm.runInContext("tmctViz.buildVizNodesAndEdges(__graph, __walked)", ctx);
  assert.equal(built.nodes.length, walked.length);
  assert.ok(Array.isArray(built.edges));
  assert.ok(built.nodes[0].label, "nodes carry a real label, not a placeholder");
});
