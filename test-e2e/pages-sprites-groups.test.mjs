// The four full-gallery sprite pages a real browser reaches from
// sprites.html's own landing cards: sprites-adventure-props.html,
// sprites-person-roles.html, sprites-objects.html, sprites-emotions.html —
// one per src/services/sprite-catalog-viz.mjs's own CATALOG_GROUPS entry.
// Each renders that ONE group's full card gallery: same styling, same
// swatches, and one animated cell per class that clicks through its display
// modes. The section ontology trees are not repeated here — a card's
// ancestry pills link across to the landing page's tree instead, which is
// what several tests below follow. The composer and the ask dock still
// answer over the WHOLE catalog from any one of these pages, never just
// this group's own classes — test-e2e/pages-sprites.test.mjs covers the
// lighter landing page these link out from.
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
  // build-demo-site.mjs itself now writes all four group pages (and the
  // sprites.html landing page) with the dock/composer bundle already wired
  // in, so one ordinary snapshot build covers every page this file tests —
  // no separate bundle-and-rewrite step needed.
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

async function openGroupPage(pageFile, { viewport, reducedMotion } = {}) {
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ...(reducedMotion ? { reducedMotion } : {}),
  });
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

  await page.goto(`${server.origin}/${pageFile}`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors, failedRequests };
}

const GROUP_PAGES = [
  { file: "sprites-adventure-props.html", label: "Ashcombe Hall's own adventure props", count: 23, sampleClass: "cabinet" },
  { file: "sprites-person-roles.html", label: "Person roles", count: 57, sampleClass: "doctor" },
  { file: "sprites-objects.html", label: "Physical objects, creatures & places", count: 130, sampleClass: "bear" },
  { file: "sprites-emotions.html", label: "Emotions & events", count: 20, sampleClass: "anger" },
];

for (const { file, label, count, sampleClass } of GROUP_PAGES) {
  test(`${file} renders its own group's full gallery — every one of its ${count} real classes gets a card, and no other group's class does`, async () => {
    const { context, page, consoleErrors } = await openGroupPage(file);
    try {
      assert.equal(await page.locator(".card").count(), count, `${label} carries ${count} real classes today`);
      assert.equal(await page.locator(`.card[data-cls="${sampleClass}"]`).count(), 1);
      assert.deepEqual(consoleErrors, [], `${file} logs no console error just loading`);
    } finally {
      await context.close();
    }
  });
}

test("every group page's topbar nav links to the other three group pages and back to the sprites.html landing page", async () => {
  for (const { file } of GROUP_PAGES) {
    const { context, page } = await openGroupPage(file);
    try {
      const hrefs = await page.locator(".jump").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
      for (const other of GROUP_PAGES) assert.ok(hrefs.includes(`./${other.file}`), `${file} links to ${other.file}`);
      assert.ok(hrefs.includes("./sprites.html"), `${file} links back to the landing page`);
      const current = await page.locator('.jump[aria-current="page"]').getAttribute("href");
      assert.equal(current, `./${file}`, `${file} marks its own nav link as the current page`);
    } finally {
      await context.close();
    }
  }
});

test("clicking a group page's own overview link really returns to the sprites.html landing page", async () => {
  const { context, page } = await openGroupPage("sprites-objects.html");
  try {
    await page.locator(".jump-overview").click();
    await page.waitForURL(/sprites\.html$/);
    assert.equal(await page.locator(".card").count(), 23, "the landing page's own one-card-per-section examples render, not the full objects gallery");
  } finally {
    await context.close();
  }
});

test("the person-roles page's person card renders all six curated emotion variants as genuinely different sprites", async () => {
  const { context, page } = await openGroupPage("sprites-person-roles.html");
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

test("the objects page's bear card carries one image cell that clicks through every display mode and wraps back to static", async () => {
  // reducedMotion pins the page's auto-step off, so every frame change below
  // is the test's own click and the walk is fully deterministic.
  const { context, page, consoleErrors } = await openGroupPage("sprites-objects.html", { reducedMotion: "reduce" });
  try {
    const card = page.locator('.card[data-cls="bear"]');
    await card.waitFor({ state: "visible" });
    const cell = card.locator(".swatch.cycle-mode");
    assert.equal(await cell.count(), 1, "one animated cell for the whole class");
    assert.equal(await card.locator(".swatch.cycle").count(), 1, "no separate cell per axis any more");
    const cellButton = cell.locator(".swatch-img");
    // The card sits far down a content-visibility:auto page — bring it on
    // screen before reading, so the first frame's text is really rendered.
    await cellButton.scrollIntoViewIfNeeded();
    const walk = [];
    const markups = new Set();
    // bear's cell is the static sprite + its moving pose + five turntable
    // angles + six moods = 13 frames; the fourteenth read proves the wrap.
    for (let i = 0; i < 14; i += 1) {
      walk.push({
        mode: await cell.locator(".swatch-mode").textContent(),
        label: await cell.locator(".swatch-label").textContent(),
      });
      markups.add(await cellButton.innerHTML());
      await cellButton.click();
    }
    assert.deepEqual([...new Set(walk.map((f) => f.mode))], ["static", "moving", "turning", "emotions"],
      `the clicks walk every mode in order (saw: ${walk.map((f) => f.mode).join(", ")})`);
    assert.deepEqual(walk[0], { mode: "static", label: "bear" }, "the cell rests on the class's own plain sprite");
    assert.deepEqual(walk[13], walk[0], "the fourteenth frame wraps back to where it started");
    for (const expected of ["moving", "left", "centre", "right", "happy", "calm"]) {
      assert.ok(walk.some((f) => f.label === expected), `the walk names its ${expected} frame`);
    }
    // 12 distinct drawings for 13 frames: the turntable's centre angle is the
    // class's own plain sprite, the same one the cell rests on.
    assert.equal(markups.size, 12, `each frame is its own real drawing, got ${markups.size}`);
    assert.deepEqual(consoleErrors, [], "cycling logs no console error");
  } finally {
    await context.close();
  }
});

test("with reduced motion the cell only ever moves when clicked, and hovering it does nothing", async () => {
  const { context, page } = await openGroupPage("sprites-objects.html", { reducedMotion: "reduce" });
  try {
    const cell = page.locator('.card[data-cls="bear"] .swatch.cycle-mode');
    await cell.scrollIntoViewIfNeeded();
    await cell.hover();
    assert.equal(await cell.getAttribute("data-mode"), "static", "hovering never previews under reduced motion");

    await cell.locator(".swatch-img").click();
    const parked = { mode: await cell.getAttribute("data-mode"), svg: await cell.locator(".swatch-img").innerHTML() };
    assert.equal(parked.mode, "moving", "the click is what moved it");
    await page.waitForTimeout(2000);
    assert.equal(await cell.getAttribute("data-mode"), parked.mode, "nothing steps the cell on by itself");
    assert.equal(await cell.locator(".swatch-img").innerHTML(), parked.svg);
  } finally {
    await context.close();
  }
});

test("with motion allowed the resting cell previews the moving pose while the pointer is over it, and lets go on mouse-out", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-objects.html");
  try {
    const cell = page.locator('.card[data-cls="bear"] .swatch.cycle-mode');
    await cell.scrollIntoViewIfNeeded();
    assert.equal(await cell.getAttribute("data-mode"), "static", "the static frame is the resting state and never auto-steps");
    await cell.hover();
    await page.waitForFunction(() => document.querySelector('.card[data-cls="bear"] .swatch.cycle-mode')?.dataset.mode === "moving");
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.querySelector('.card[data-cls="bear"] .swatch.cycle-mode')?.dataset.mode === "static");
    assert.deepEqual(consoleErrors, [], "the hover preview logs no console error");
  } finally {
    await context.close();
  }
});

test("a group page's ancestry pills link to the landing page's own tree node for each term", async () => {
  const { context, page } = await openGroupPage("sprites-person-roles.html");
  try {
    assert.equal(await page.locator(".ontology").count(), 0, "the trees all live on the landing page");
    const card = page.locator('.card[data-cls="driver"]');
    await card.scrollIntoViewIfNeeded();
    const hrefs = await card.locator("a.chain-link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(hrefs, [
      "./sprites.html#tree-person-worker-driver",
      "./sprites.html#tree-person-worker-worker",
      "./sprites.html#tree-person-worker-doer",
      "./sprites.html#tree-person-worker-person",
      "./sprites.html#tree-person-worker-organism",
    ], "every pill points at driver's own cluster tree, not some other section's");

    await card.locator("a.chain-link").first().click();
    await page.waitForURL(/sprites\.html#tree-person-worker-driver$/);
    assert.equal(await page.locator("#tree-person-worker-driver .tree-term").textContent(), "driver", "the link lands on a node that really exists");
  } finally {
    await context.close();
  }
});

test("the adventure-props page's lamp card never grows a cycle swatch — materials are choices, not motion", async () => {
  const { context, page } = await openGroupPage("sprites-adventure-props.html", { reducedMotion: "reduce" });
  try {
    const lamp = page.locator('.card[data-cls="lamp"]');
    await lamp.waitFor({ state: "visible" });
    assert.equal(await lamp.locator(".swatch.cycle").count(), 0);
  } finally {
    await context.close();
  }
});

test("the adventure-props page's cabinet card renders real, distinct material swatches", async () => {
  const { context, page } = await openGroupPage("sprites-adventure-props.html");
  try {
    const cabinet = page.locator('.card[data-cls="cabinet"]');
    await cabinet.waitFor({ state: "visible" });
    const svgs = await cabinet.locator('.tier-row[data-tier="large"] .swatch .swatch-img').evaluateAll((els) => els.map((el) => el.innerHTML));
    assert.ok(svgs.length >= 2, "cabinet carries more than one large-tier swatch");
    assert.equal(new Set(svgs).size, svgs.length, "every cabinet swatch is a genuinely distinct render");
  } finally {
    await context.close();
  }
});

test("the objects page's filter narrows its 130-card gallery, hides emptied clusters, and clears back to everything", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-objects.html");
  try {
    const total = await page.locator(".card").count();
    await page.fill("#q", "cat");
    const shown = await page.locator(".card:not([hidden])").count();
    assert.ok(shown > 0 && shown < total, "the needle keeps some cards and drops others");
    for (const cls of await page.locator(".card:not([hidden])").evaluateAll((els) => els.map((el) => el.dataset.cls + " " + el.dataset.group))) {
      assert.match(cls, /cat/, "every surviving card matches the needle by class or group");
    }
    assert.equal(await page.locator("#qcount").innerText(), `${shown} / ${total}`, "the counter reads survivors over total");

    await page.fill("#q", "");
    assert.equal(await page.locator(".card:not([hidden])").count(), total, "clearing the filter restores every card");
    assert.deepEqual(consoleErrors, [], "filtering logs no console error");
  } finally {
    await context.close();
  }
});

test("the composer on the adventure-props page still resolves a person-group class it shows no card for — 'a doctor' composes from a different group's page", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-adventure-props.html");
  try {
    assert.equal(await page.locator('.card[data-cls="doctor"]').count(), 0, "doctor has no card on this group's own page");
    await page.fill("#composeq", "a doctor");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 1);
    assert.equal(await page.locator("#sceneRow .scene-label").innerText(), "doctor");
    assert.deepEqual(consoleErrors, [], "composing a class from a different group logs no console error");
  } finally {
    await context.close();
  }
});

test("the dock on the person-roles page still counts and enumerates the WHOLE catalog, not just its own 57 person-role cards", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-person-roles.html");
  try {
    await page.waitForFunction(() => {
      const input = document.getElementById("dockq");
      return input && !input.disabled;
    }, undefined, { timeout: 60_000 });
    await page.fill("#dockq", "how many sprite classes are there?");
    await page.press("#dockq", "Enter");
    await page.waitForFunction(() => document.querySelectorAll("#dockLog .a").length > 0);
    const text = await page.locator("#dockLog .a").last().innerText();
    // The count answer carries its own "say list ... to see them" nudge after
    // the count itself, so the count is a prefix match, not the whole line.
    const counted = Number((text.match(/^(\d+) sprite classes\./) || [])[1]);
    const cardsOnThisPage = await page.locator(".card").count();
    assert.equal(cardsOnThisPage, 57, "this page's own gallery is just Person roles");
    assert.ok(Number.isFinite(counted) && counted > cardsOnThisPage, `the dock counts the whole catalog (${counted}), not just this page's own ${cardsOnThisPage} cards`);
    assert.deepEqual(consoleErrors, [], "the classes question answers without a console error");
  } finally {
    await context.close();
  }
});

test("the objects page fits a phone viewport without sideways scrolling, even at 130 cards", async () => {
  const { context, page } = await openGroupPage("sprites-objects.html", { viewport: { width: 375, height: 667 } });
  try {
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
