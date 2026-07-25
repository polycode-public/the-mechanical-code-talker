// sprites.html in a real browser: the scene composer (the "there is a"
// lead-in plus a free-typed continuation resolves to real, already-rendered
// catalog sprites — never a hand-simulated stand-in, see
// sprite-catalog-viz.mjs's own header), the catalog itself (topbar filter,
// class cards), and the chat dock, which answers catalog questions from the
// sprite templates' own generated facts and hands everything else to the
// full engine, whose refusal is the honest miss.
//
// Third-party hosts are blocked for every run, exactly as in pages-home/
// pages-spider-fly: the whole page ships with itself, so nothing here needs
// the network.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { readSpriteTemplateFiles } from "../src/adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../src/adapters/corpus/sprite-large-template-files.mjs";
import { loadSpriteOntologyFactRows, renderSpriteCatalogHtml } from "../src/services/sprite-catalog-viz.mjs";

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  // Build this page's own chat-dock bundle and render sprites.html with the
  // dock enabled — the same two calls the site build makes for the other
  // chat-dock pages. If the snapshot build already did both, this rewrite is
  // byte-identical; if it rendered the page dock-less, this is what puts the
  // real artifact under test.
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-sprites-bundle.mjs")], {
    env: { ...process.env, TMCT_SPRITES_BUNDLE_OUT: siteDir },
    stdio: "pipe",
  });
  writeFileSync(path.join(siteDir, "sprites.html"), renderSpriteCatalogHtml({
    iconTemplates: readSpriteTemplateFiles(),
    largeTemplates: readSpriteLargeTemplateFiles(),
    factRows: await loadSpriteOntologyFactRows(),
    spritesBundleAvailable: true,
  }));
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

async function askDock(page, question) {
  await page.waitForFunction(() => {
    const input = document.getElementById("dockq");
    return input && !input.disabled;
  }, undefined, { timeout: 60_000 });
  const answered = await page.locator("#dockLog .a").count();
  await page.fill("#dockq", question);
  await page.press("#dockq", "Enter");
  await page.waitForFunction((n) => document.querySelectorAll("#dockLog .a").length > n, answered);
  return page.locator("#dockLog .a").last();
}

test("the dock grounds 'what parameters does a person sprite take?' in the template data's own real parameter", async () => {
  const { context, page, consoleErrors, failedRequests } = await openSpritesPage();
  try {
    const reply = await askDock(page, "what parameters does a person sprite take?");
    const text = await reply.innerText();
    assert.match(text, /emotion/, "the answer names the real parameter the person templates declare");
    assert.match(text, /happy/, "the answer carries the parameter's own real value set");
    assert.ok(await reply.evaluate((el) => el.classList.contains("grounded")), "the reply is marked as read from the embedded facts");
    assert.deepEqual(failedRequests, [], "the dock's bundle and wink asset both load same-origin");
    assert.deepEqual(consoleErrors, [], "the dock answers without a console error");
  } finally {
    await context.close();
  }
});

test("an ungrounded dock question gets a refusal, never a guess", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const reply = await askDock(page, "who painted the mona lisa?");
    const text = await reply.innerText();
    assert.match(text, /can't answer|don't know|no code graph/i, "the reply is a refusal");
    assert.doesNotMatch(text, /leonardo|da vinci/i, "nothing is invented to fill the gap");
    assert.ok(await reply.evaluate((el) => el.classList.contains("miss")), "the reply is marked as a miss");
    assert.deepEqual(consoleErrors, [], "a miss never throws");
  } finally {
    await context.close();
  }
});

test("the dock's classes-on-record question grounds in the embedded catalog rows, naming the real class count", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const catalogCards = await page.locator(".card").count();
    const reply = await askDock(page, "what classes can you render?");
    const text = await reply.innerText();
    const counted = Number((text.match(/^(\d+) sprite classes are on record/) || [])[1]);
    assert.ok(Number.isFinite(counted), `the answer opens with a real count, got: ${text}`);
    assert.equal(counted, catalogCards, "the dock's count and the rendered catalog agree card for card");
    assert.ok(await reply.evaluate((el) => el.classList.contains("grounded")), "the reply is marked as read from the embedded facts");
    assert.deepEqual(consoleErrors, [], "the classes question answers without a console error");
  } finally {
    await context.close();
  }
});

test("a dock pill fills the input with its exact question without submitting it", async () => {
  const { context, page } = await openSpritesPage();
  try {
    await page.locator('#dockPills .pill[data-q="what parameters does a cabinet sprite take?"]').click();
    assert.equal(await page.locator("#dockq").inputValue(), "what parameters does a cabinet sprite take?");
    assert.equal(await page.locator("#dockLog .a").count(), 0, "the pill only fills — the visitor presses Enter");
  } finally {
    await context.close();
  }
});

test("the catalog filter narrows the cards, hides emptied groups, counts the survivors, and clears back to everything", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const total = await page.locator(".card").count();
    await page.fill("#q", "cabinet");
    const shown = await page.locator(".card:not([hidden])").count();
    assert.ok(shown > 0 && shown < total, "the needle keeps some cards and drops others");
    for (const cls of await page.locator(".card:not([hidden])").evaluateAll((els) => els.map((el) => el.dataset.cls + " " + el.dataset.group))) {
      assert.match(cls, /cabinet/, "every surviving card matches the needle by class or group");
    }
    assert.equal(await page.locator("#qcount").innerText(), `${shown} / ${total}`, "the counter reads survivors over total");
    const emptiedGroupsShown = await page.locator(".group").evaluateAll((els) =>
      els.filter((el) => el.querySelectorAll(".card:not([hidden])").length === 0 && el.style.display !== "none").length,
    );
    assert.equal(emptiedGroupsShown, 0, "a group whose every card is filtered out hides its heading too");

    await page.fill("#q", "");
    assert.equal(await page.locator(".card:not([hidden])").count(), total, "clearing the filter restores every card");
    assert.equal(await page.locator("#qcount").innerText(), "", "the counter goes quiet when nothing is filtered");
    assert.deepEqual(consoleErrors, [], "filtering logs no console error");
  } finally {
    await context.close();
  }
});

test("every topbar jump anchor targets a real group section on this same page", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const hrefs = await page.locator(".jump").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.ok(hrefs.length >= 3, "the topbar offers real group anchors");
    for (const href of hrefs) {
      assert.match(href, /^#g-/, "every jump is an in-page anchor");
      assert.equal(await page.locator(`section[id="${href.slice(1)}"]`).count(), 1, `${href} names a real section`);
    }
    const personJump = page.locator('.jump[href="#g-person"]');
    await personJump.click();
    await page.waitForFunction(() => {
      const rect = document.getElementById("g-person")?.getBoundingClientRect();
      return rect && rect.top >= -8 && rect.top < window.innerHeight;
    });
  } finally {
    await context.close();
  }
});

test("the person card renders all six curated emotion variants as genuinely different sprites", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const card = page.locator('.card[data-cls="person"]');
    await card.waitFor({ state: "visible" });
    const swatches = await card.locator('.tier-row[data-tier="large"] .swatch').evaluateAll((els) => els.map((el) => ({
      label: el.querySelector(".swatch-label")?.textContent?.trim() ?? "",
      svg: el.querySelector(".swatch-img")?.innerHTML ?? "",
    })));
    const emotions = ["happy", "sad", "angry", "scared", "surprised", "calm"];
    for (const emotion of emotions) {
      assert.ok(swatches.some((s) => s.label === emotion), `the ${emotion} variant renders as its own swatch`);
    }
    const markups = new Set(swatches.filter((s) => emotions.includes(s.label)).map((s) => s.svg));
    assert.equal(markups.size, emotions.length, "no two emotion variants share the same markup — the face genuinely changes");
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
