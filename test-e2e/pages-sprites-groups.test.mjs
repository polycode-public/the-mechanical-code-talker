// The four full-gallery sprite pages a real browser reaches from
// sprites.html's own landing cards: sprites-adventure-props.html,
// sprites-person-roles.html, sprites-objects.html, sprites-emotions.html —
// one per src/services/sprite-catalog-viz.mjs's own CATALOG_GROUPS entry.
// Each renders that ONE group's full card gallery: same styling, same
// pose-first hover tiles, and one focused animated cell per card grid
// (turning by default, emotions after a click). The section ontology trees
// are not repeated here — a card's ancestry pills link across to the
// landing page's tree instead, which is what several tests below follow.
// The composer and the ask dock still answer over the WHOLE catalog from
// any one of these pages, never just this group's own classes —
// test-e2e/pages-sprites.test.mjs covers the lighter landing page these
// link out from.
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

test("each card grid keeps exactly one focused cell, and it rotates through its turning positions on its own", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-objects.html");
  try {
    const bear = page.locator('.card[data-cls="bear"]');
    await bear.scrollIntoViewIfNeeded();
    const grid = page.locator(".cards", { has: bear }).first();
    const focused = grid.locator(".swatch.cycle.focused");
    assert.equal(await focused.count(), 1, "one focused sprite per grid");
    assert.equal(await focused.getAttribute("data-mode"), "turning", "position-rotating is the default animation");
    const seen = new Set();
    for (let i = 0; i < 4; i += 1) {
      seen.add(await focused.locator(".swatch-img").innerHTML());
      await page.waitForTimeout(850);
    }
    assert.ok(seen.size >= 3, `the focused cell really rotates, saw ${seen.size} frame(s)`);
    assert.deepEqual(consoleErrors, [], "the rotation logs no console error");
  } finally {
    await context.close();
  }
});

test("clicking the focused cell swaps it to emotion cycling, and the grid keeps that choice when focus moves to another card", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-objects.html", { reducedMotion: "reduce" });
  try {
    const bear = page.locator('.card[data-cls="bear"]');
    await bear.scrollIntoViewIfNeeded();
    const grid = page.locator(".cards", { has: bear }).first();
    const focused = () => grid.locator(".swatch.cycle.focused").first();
    await focused().locator(".swatch-img").click();
    assert.equal(await focused().getAttribute("data-mode"), "emotions", "the click swaps position-rotating for emotion-cycling");

    // Click a different card's cell: focus moves there, the grid's chosen
    // mode rides along.
    const other = grid.locator(".swatch.cycle:not(.focused)").first();
    const otherCard = await other.evaluate((el) => el.closest(".card").dataset.cls);
    await other.locator(".swatch-img").click();
    assert.equal(await grid.locator(".swatch.cycle.focused").count(), 1, "still exactly one focused sprite");
    const nowFocusedCard = await focused().evaluate((el) => el.closest(".card").dataset.cls);
    assert.equal(nowFocusedCard, otherCard, "focus moved to the clicked sprite");
    assert.equal(await focused().getAttribute("data-mode"), "emotions", "the grid remembered its chosen mode");

    await focused().locator(".swatch-img").click();
    assert.equal(await focused().getAttribute("data-mode"), "turning", "clicking the focused cell toggles back");
    assert.deepEqual(consoleErrors, [], "focus clicks log no console error");
  } finally {
    await context.close();
  }
});

test("with reduced motion nothing steps on its own, and hovering never swaps the drawing — only the caption's pose flips", async () => {
  const { context, page } = await openGroupPage("sprites-objects.html", { reducedMotion: "reduce" });
  try {
    const bear = page.locator('.card[data-cls="bear"]');
    await bear.scrollIntoViewIfNeeded();
    const tile = bear.locator('.swatch[data-property="mgx:faces"]').first();
    const before = await tile.locator(".swatch-img").innerHTML();
    await tile.hover();
    await page.waitForTimeout(300);
    assert.equal(await tile.locator(".swatch-pose").textContent(), "moving", "the caption still names the moving form");
    assert.equal(await tile.locator(".swatch-img").innerHTML(), before, "the drawing itself never swaps under reduced motion");

    const grid = page.locator(".cards", { has: bear }).first();
    const focused = grid.locator(".swatch.cycle.focused").first();
    const parked = await focused.locator(".swatch-img").innerHTML();
    await page.waitForTimeout(1800);
    assert.equal(await focused.locator(".swatch-img").innerHTML(), parked, "nothing steps the focused cell on by itself");
  } finally {
    await context.close();
  }
});

test("hovering a resting tile flips its caption to the moving form and flip-books the drawing where a moving frame exists", async () => {
  const { context, page, consoleErrors } = await openGroupPage("sprites-objects.html");
  try {
    const bear = page.locator('.card[data-cls="bear"]');
    await bear.scrollIntoViewIfNeeded();
    assert.equal(await bear.locator('.swatch[data-pose="moving"]:not(.cycle)').count(), 0,
      "the server-rendered moving frames folded into their resting tiles");
    const tile = bear.locator('.swatch[data-property="mgx:faces"]').first();
    const rest = await tile.locator(".swatch-img").innerHTML();
    assert.equal(await tile.locator(".swatch-pose").textContent(), "static");
    await tile.hover();
    const seen = new Set();
    for (let i = 0; i < 5; i += 1) {
      seen.add(await tile.locator(".swatch-img").innerHTML());
      await page.waitForTimeout(450);
    }
    assert.equal(await tile.locator(".swatch-pose").textContent(), "moving", "the caption reads the moving form while hovered");
    assert.ok(seen.size >= 2, "the drawing alternates its static and moving frames");
    assert.ok([...seen].some((svg) => svg !== rest), "one of the frames is the real moving art");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    assert.equal(await tile.locator(".swatch-pose").textContent(), "static", "mouse-out restores the resting caption");
    assert.equal(await tile.locator(".swatch-img").innerHTML(), rest, "mouse-out restores the resting drawing");

    // A tile with no moving frame of its own still flips its caption.
    const mood = bear.locator('.swatch[data-property="mgx:feels"]').first();
    const moodRest = await mood.locator(".swatch-img").innerHTML();
    await mood.hover();
    await page.waitForTimeout(300);
    assert.equal(await mood.locator(".swatch-pose").textContent(), "moving");
    assert.equal(await mood.locator(".swatch-img").innerHTML(), moodRest, "no moving art, no fake flip");
    assert.deepEqual(consoleErrors, [], "hovering logs no console error");
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
