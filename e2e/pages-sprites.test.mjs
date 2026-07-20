// sprites.html's own scene composer, in a real browser: the "there is a"
// lead-in plus a free-typed continuation resolves to real, already-rendered
// catalog sprites (never a hand-simulated stand-in — see
// sprite-catalog-viz.mjs's own header), an unrecognized word or class is
// silently dropped rather than guessed at, and the rest of the catalog page
// (topbar filter, class cards) is unaffected by the new panels above it.
//
// Third-party hosts are blocked for every run, exactly as in pages-home/
// pages-spider-fly: the whole page ships with itself, so nothing here needs
// the network.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

async function openSpritesPage({ viewport } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];

  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const source = msg.location()?.url ?? "";
    if (source && !source.startsWith(server.origin)) return;
    consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/sprites.html`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors, failedRequests };
}

test("the heading is short and the old explanatory intro paragraph is gone", async () => {
  const { context, page } = await openSpritesPage();
  try {
    assert.equal(await page.locator("h1").innerText(), "Sprites");
    assert.equal(await page.locator("p.intro").count(), 0, "the old long intro paragraph no longer renders");
  } finally {
    await context.close();
  }
});

test("the composer's lead-in reads 'there is a' and the catalog below is untouched", async () => {
  const { context, page } = await openSpritesPage();
  try {
    assert.equal(await page.locator(".composeform .prompt").innerText(), "there is a");
    // The existing filter/topbar and the full class catalog still render —
    // this feature is additive above them, not a replacement.
    await assert.doesNotReject(page.locator("#q").waitFor({ state: "visible" }));
    assert.ok(await page.locator('.card[data-cls="cabinet"]').count() > 0, "the cabinet card still renders below");
  } finally {
    await context.close();
  }
});

test("typing three real class names renders all three as scene sprites, in order, with no console error", async () => {
  const { context, page, consoleErrors, failedRequests } = await openSpritesPage();
  try {
    await page.fill("#composeq", "a doctor with a hat, and a cabinet");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 3);
    const labels = await page.locator("#sceneRow .scene-label").allInnerTexts();
    assert.deepEqual(labels, ["doctor", "hat", "cabinet"]);
    for (const card of await page.locator("#sceneRow .scene-card .scene-sprite svg").all()) {
      assert.ok(await card.isVisible(), "every composed sprite actually rendered an svg");
    }
    assert.equal(await page.locator("#sceneEmpty").isVisible(), false, "the empty-state note hides once real items compose");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page logs no error of its own");
  } finally {
    await context.close();
  }
});

test("the operator's own 'bookcase' example: real classes render, the unrecognized word is silently dropped, never a crash", async () => {
  // "bookcase" is not one of this catalog's own 198 real classes (checked
  // directly against data/sprites-large/*.toml) — this is the same honest
  // miss "red lamp" demonstrates below, just for a whole unrecognized class
  // instead of an unrecognized material word.
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    await page.fill("#composeq", "a doctor with a hat, and a bookcase");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 2);
    const labels = await page.locator("#sceneRow .scene-label").allInnerTexts();
    assert.deepEqual(labels, ["doctor", "hat"], "doctor and hat render; the unrecognized 'bookcase' is silently skipped, not guessed at");
    assert.deepEqual(consoleErrors, [], "an unrecognized word never throws");
  } finally {
    await context.close();
  }
});

test("'red lamp' draws a plain lamp — 'red' names no real material for lamp, so it is silently ignored, not invented", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    await page.fill("#composeq", "red lamp");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 1);
    const labels = await page.locator("#sceneRow .scene-label").allInnerTexts();
    assert.deepEqual(labels, ["lamp"], "the label names no invented 'red' material");
    assert.deepEqual(consoleErrors, [], "the unrecognized modifier never throws");
  } finally {
    await context.close();
  }
});

test("a real taught material word immediately before its class renders that class's own real material swatch", async () => {
  const { context, page } = await openSpritesPage();
  try {
    await page.fill("#composeq", "wood cabinet");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 1);
    assert.equal(await page.locator("#sceneRow .scene-label").innerText(), "wood cabinet");
    const woodSvg = await page.locator("#sceneRow .scene-sprite svg").innerHTML();

    await page.fill("#composeq", "cabinet");
    await page.waitForFunction(() => document.querySelector("#sceneRow .scene-label")?.textContent === "cabinet");
    const plainSvg = await page.locator("#sceneRow .scene-sprite svg").innerHTML();

    assert.notEqual(woodSvg, plainSvg, "the wood-material swatch is a genuinely different render from the plain/fallback one");
  } finally {
    await context.close();
  }
});

test("a sentence naming zero real classes shows an honest 'nothing recognized' state, never a blank or crashing viewer", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    await page.fill("#composeq", "xyzzy plugh");
    await page.waitForFunction(() => document.getElementById("sceneEmpty")?.hidden === false);
    assert.equal(await page.locator("#sceneRow .scene-card").count(), 0);
    assert.deepEqual(consoleErrors, [], "an all-miss sentence never throws");
  } finally {
    await context.close();
  }
});

test("the viewer starts in the honest empty state before anything is typed", async () => {
  const { context, page } = await openSpritesPage();
  try {
    assert.equal(await page.locator("#sceneEmpty").isVisible(), true);
    assert.equal(await page.locator("#sceneRow .scene-card").count(), 0);
  } finally {
    await context.close();
  }
});

test("a pill click appends its real phrase to the input and composes it into the scene, without submitting the form", async () => {
  const { context, page } = await openSpritesPage();
  try {
    await page.locator('#composePills button[data-fill="doctor"]').click();
    assert.equal(await page.locator("#composeq").inputValue(), "doctor");
    await page.locator('#composePills button[data-fill="wood cabinet"]').click();
    assert.equal(await page.locator("#composeq").inputValue(), "doctor, a wood cabinet");

    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 2);
    const labels = await page.locator("#sceneRow .scene-label").allInnerTexts();
    assert.deepEqual(labels, ["doctor", "wood cabinet"]);
  } finally {
    await context.close();
  }
});

test("the page fits a phone viewport without sideways scrolling", async () => {
  const { context, page } = await openSpritesPage({ viewport: { width: 375, height: 667 } });
  try {
    await page.fill("#composeq", "a doctor with a hat, and a cabinet");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 3);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
  } finally {
    await context.close();
  }
});
