// The sprite tier meant to be looked at closely (data/sprites-large/*.toml,
// 400px display target), in a real browser: several resolved instances —
// including two differently-valued instances of the SAME class, the exact
// shape a live page (an inventory grid, a room full of furniture) would
// produce — render at their real display size with no console error, and
// two differently-valued instances of one class never collide on a shared
// gradient id (the regression svg-instance-ids.mjs's own instanceKey exists
// to prevent — src/domain/sprite-templates.mjs's own header explains why).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { serveDirectory } from "./helpers/static-server.mjs";
import { readSpriteLargeTemplateFiles } from "../src/adapters/corpus/sprite-large-template-files.mjs";
import { resolveSpriteAsset } from "../src/domain/sprite-templates.mjs";
import { SPRITE_REGISTRY } from "../src/domain/sprite-map.mjs";

const DISPLAY_PX = 400;
const madeOf = (subject, value) => [{ subject, predicate: "mgx:madeOf", object: value }];

// Two instances of the SAME class (lamp) with different taught materials —
// the exact case that silently rendered identically before instanceKey
// existed — plus one non-material class and the shape-variant pair.
const feels = (subject, value) => [{ subject, predicate: "mgx:feels", object: value }];

const INSTANCES = [
  { id: "lamp-gold", cls: "lamp", facts: madeOf("lamp-gold", "gold") },
  { id: "lamp-ceramic", cls: "lamp", facts: madeOf("lamp-ceramic", "ceramic") },
  { id: "cabinet-wood", cls: "cabinet", facts: madeOf("cabinet-wood", "wood") },
  { id: "spider-1", cls: "spider", facts: [] },
  { id: "portrait-plain", cls: "portrait", facts: [] },
  { id: "portrait-round", cls: "portrait", facts: [{ subject: "portrait-round", predicate: "mgx:hasProperty", object: "round" }] },
  { id: "adult-plain", cls: "adult", facts: [] },
  { id: "adult-happy", cls: "adult", facts: feels("adult-happy", "happy") },
  { id: "adult-sad", cls: "adult", facts: feels("adult-sad", "sad") },
];

let siteDir;
let server;
let browser;

before(async () => {
  const templates = readSpriteLargeTemplateFiles();
  const boxes = INSTANCES.map(({ id, cls, facts }) => {
    const svg = resolveSpriteAsset(cls, [], facts, templates, SPRITE_REGISTRY, { instanceKey: id });
    return `<div class="box" data-instance="${id}">${svg}</div>`;
  }).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    .box { width: ${DISPLAY_PX}px; height: ${DISPLAY_PX}px; }
    .box svg { width: 100%; height: 100%; display: block; }
  </style></head><body>${boxes}</body></html>`;

  siteDir = mkdtempSync(join(tmpdir(), "tmct-sprites-large-visual-"));
  writeFileSync(join(siteDir, "index.html"), html);
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

test("every instance renders at its real 400px display size with no console error", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  try {
    await page.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
    for (const { id } of INSTANCES) {
      const box = page.locator(`.box[data-instance="${id}"]`);
      const svgBox = await box.locator("svg").boundingBox();
      assert.ok(svgBox, `${id}: no svg rendered`);
      assert.equal(Math.round(svgBox.width), DISPLAY_PX, `${id}: rendered width`);
      assert.equal(Math.round(svgBox.height), DISPLAY_PX, `${id}: rendered height`);
    }
    assert.deepEqual(consoleErrors, [], "no console error rendering the sprite tier, including its color-mix() gradients");
  } finally {
    await context.close();
  }
});

test("two differently-valued instances of the same class never share one gradient id in the DOM", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
    const ids = await page.evaluate(() => [...document.querySelectorAll("[id]")].map((el) => el.id));
    const seen = new Set();
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(duplicates, [], `duplicate DOM ids would make a browser reuse the FIRST instance's gradient for every later one: ${duplicates.join(", ")}`);
    assert.ok(ids.some((id) => id.includes("lamp-gold")), "the gold lamp's own namespaced id is present");
    assert.ok(ids.some((id) => id.includes("lamp-ceramic")), "the ceramic lamp's own namespaced id is present");
  } finally {
    await context.close();
  }
});

test("two differently-feeling adults render different faces from each other AND from the plain adult — the emotion parameter is not a no-op", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
    const markup = {};
    for (const id of ["adult-plain", "adult-happy", "adult-sad"]) {
      markup[id] = await page.locator(`.box[data-instance="${id}"] svg`).innerHTML();
    }
    assert.notEqual(markup["adult-happy"], markup["adult-sad"], "happy and sad resolve to genuinely different faces");
    assert.notEqual(markup["adult-happy"], markup["adult-plain"], "a felt emotion is not the plain silhouette");
    assert.notEqual(markup["adult-sad"], markup["adult-plain"]);
  } finally {
    await context.close();
  }
});

test("portrait-round renders different markup from the plain portrait — the shape variant is not a no-op", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
    const plainHtml = await page.locator('.box[data-instance="portrait-plain"] svg').innerHTML();
    const roundHtml = await page.locator('.box[data-instance="portrait-round"] svg').innerHTML();
    assert.notEqual(plainHtml, roundHtml);
  } finally {
    await context.close();
  }
});
