// sprites.html in a real browser: the LANDING page over the whole sprite
// catalog — one example card per section (CATALOG_GROUPS' unclustered
// groups, plus each ancestor cluster within Person roles/Physical objects —
// see sprite-catalog-viz.mjs's own catalogSections), each linking out to its
// own class's card on the group page that actually holds the full gallery.
// This page holds one ontology tree per section, drawn above that section
// as a real hierarchy diagram — connector lines from parent box to child
// box — and its ancestry pills anchor to those trees in-page (each group
// page draws its own sections' trees the same way).
// The composer (the "there is a" lead-in) and the chat dock both still
// answer over the WHOLE catalog from this page, even though only one class
// per section has a card here — see test-e2e/pages-sprites-groups.test.mjs
// for the four full-gallery pages this page links out to.
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
import { loadSpriteOntologyFactRows, loadAdventureSceneRoomClasses, renderSpriteCatalogLandingHtml } from "../src/services/sprite-catalog-viz.mjs";

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
  writeFileSync(path.join(siteDir, "sprites.html"), renderSpriteCatalogLandingHtml({
    iconTemplates: readSpriteTemplateFiles(),
    largeTemplates: readSpriteLargeTemplateFiles(),
    factRows: await loadSpriteOntologyFactRows(),
    spritesBundleAvailable: true,
    adventureRoomClasses: await loadAdventureSceneRoomClasses(),
  }));
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

async function openSpritesPage({ viewport, reducedMotion } = {}) {
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

test("the landing page shows exactly one example card per section — the operator's own curated favourites, not the whole catalog", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const total = await page.locator(".card").count();
    assert.equal(total, 23, "one card per section: the whole adventure and emoji groups plus every person/object ancestor cluster");
    for (const cls of ["adventurer", "engineer", "king", "family", "spider", "frog", "autumn"]) {
      assert.equal(await page.locator(`.card[data-cls="${cls}"]`).count(), 1, `${cls} is one of the curated landing examples`);
    }
    assert.equal(await page.locator('.card[data-cls="doctor"]').count(), 0, "a class that isn't a curated example has no card here");
    assert.equal(await page.locator('.card[data-cls="cabinet"]').count(), 0);
  } finally {
    await context.close();
  }
});

test("every 'view all' link points to that example's own card on its group's full-gallery page", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const links = await page.locator(".viewall").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.equal(links.length, 23);
    assert.ok(links.includes("./sprites-person-roles.html#card-king"), "the person 'man' cluster's own favourite links to its own card");
    assert.ok(links.includes("./sprites-objects.html#card-frog"), "the object group's trailing 'everything else' cluster links to its own favourite's card");
    assert.ok(links.includes("./sprites-adventure-props.html#card-adventurer"));
    assert.ok(links.includes("./sprites-emotions.html#card-autumn"));
  } finally {
    await context.close();
  }
});

test("every section carries its own ontology tree, drawn above that section's example card", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    assert.equal(await page.locator(".ontology").count(), 23, "one tree per section");
    const order = await page.locator(".landing-section").evaluateAll((els) => els.map((el) => {
      const kids = Array.from(el.children).map((k) => k.className.split(" ")[0]);
      return { tree: kids.indexOf("ontology"), cards: kids.indexOf("cards") };
    }));
    assert.equal(order.length, 23);
    for (const { tree, cards } of order) {
      assert.ok(tree >= 0, "the section has a tree");
      assert.ok(tree < cards, "the tree is drawn above the card, not below it");
    }
    assert.deepEqual(consoleErrors, [], "drawing the trees logs no console error");
  } finally {
    await context.close();
  }
});

test("an ancestry pill is a real link to that term's own node in its section's tree", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const card = page.locator('.card[data-cls="driver"]');
    await card.scrollIntoViewIfNeeded();
    const hrefs = await card.locator("a.chain-link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(hrefs, [
      "#tree-person-worker-driver", "#tree-person-worker-worker", "#tree-person-worker-doer",
      "#tree-person-worker-person", "#tree-person-worker-organism",
    ]);

    await card.locator('a.chain-link[href="#tree-person-worker-person"]').click();
    await page.waitForFunction(() => window.location.hash === "#tree-person-worker-person");
    const node = page.locator("#tree-person-worker-person");
    assert.equal(await node.locator(".tree-term").textContent(), "person");
    assert.equal(await node.locator(".tree-img svg").count(), 1, "a term with a template shows its own real sprite");
    assert.equal(await node.getAttribute("data-level"), "1", "person sits one level under organism here");
  } finally {
    await context.close();
  }
});

test("every recorded parent link in a tree is drawn as a real connector line, and a two-parent node's edges wear the accent", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const tree = page.locator(".ontology-tree", { has: page.locator("#tree-person-worker-driver") });
    await tree.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      document.getElementById("tree-person-worker-driver").closest(".ontology-tree").querySelectorAll(".tree-edges path").length > 0);
    const parentLinks = await tree.locator(".tree-node .tree-up a").count();
    assert.ok(parentLinks > 0, "the tree really records parent links, or this test proves nothing");
    assert.equal(await tree.locator(".tree-edges path").count(), parentLinks, "one drawn line per recorded parent link");
    const d = await tree.locator(".tree-edges path").first().getAttribute("d");
    assert.match(d, /^M-?[\d.]+ -?[\d.]+C/, "each connector is a real drawn curve, never an empty path");

    const queenTree = page.locator(".ontology-tree", { has: page.locator("#tree-person-everything-else-queen") });
    await queenTree.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      document.getElementById("tree-person-everything-else-queen").closest(".ontology-tree").querySelectorAll(".tree-edges path.edge-dual").length >= 2);
    assert.ok(await queenTree.locator(".tree-edges path.edge-dual").count() >= 2,
      "both edges into the two-parent queen node carry the dual accent");
    assert.deepEqual(consoleErrors, [], "drawing the connectors logs no console error");
  } finally {
    await context.close();
  }
});

test("a term the catalog draws no sprite for gets a placeholder slot carrying its own short description", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const node = page.locator("#tree-person-worker-doer");
    await node.scrollIntoViewIfNeeded();
    const placeholder = node.locator(".tree-img-placeholder");
    assert.equal(await placeholder.count(), 1, "the empty image slot is an obvious, styled element");
    assert.equal(await placeholder.textContent(), "a kind of person. No sprite yet.");
    assert.equal(await placeholder.getAttribute("aria-label"), "doer: a kind of person. No sprite yet.");
    assert.equal(await node.locator(".tree-img").count(), 0, "no sprite is faked for it");
  } finally {
    await context.close();
  }
});

test("a class on record with two parents shows both, so the tree tells the truth about the disagreement", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const queen = page.locator("#tree-person-everything-else-queen");
    await queen.scrollIntoViewIfNeeded();
    assert.equal(await queen.getAttribute("data-parents"), "2");
    assert.deepEqual(await queen.locator(".tree-up a").allInnerTexts(), ["insect", "woman"]);
    for (const parent of ["insect", "woman"]) {
      assert.equal(await page.locator(`#tree-person-everything-else-${parent}`).count(), 1, `${parent} has its own node to point at`);
    }
    const fly = page.locator("#tree-object-insect-fly");
    await fly.scrollIntoViewIfNeeded();
    assert.ok(Number(await fly.getAttribute("data-parents")) > 2, "fly's several recorded parents all show");
  } finally {
    await context.close();
  }
});

test("the objects trees show which classes share a sub-graph and which stand apart", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const tree = page.locator(".ontology").filter({ has: page.locator("#tree-object-everything-else-airport") });
    await tree.scrollIntoViewIfNeeded();
    assert.ok(await tree.locator(".tree-branch:not(.tree-apart)").count() > 1, "more than one connected sub-graph");
    assert.equal(await tree.locator(".tree-apart").count(), 1, "the classes joined to nothing else are collected on their own");
    // textContent, not innerText: the section sits inside a content-visibility
    // page and the block itself inside a scrolling box, so it can be real and
    // correct while nothing of it has been laid out yet.
    assert.match(await tree.locator(".tree-apart-head").textContent(), /on their own/i);

    const shared = page.locator(".ontology").filter({ has: page.locator("#tree-object-insect-butterfly") });
    assert.equal(await shared.locator("#tree-object-insect-ant").count(), 1);
    assert.equal(await shared.locator("#tree-object-insect-bee").count(), 1);
    assert.equal(await page.locator("#tree-object-insect-hymenopterous-insect").getAttribute("data-level"), "3",
      "ant and bee really do meet under one shared parent");
  } finally {
    await context.close();
  }
});

test("a tree wider than a phone scrolls inside its own box, never widening the page", async () => {
  const { context, page } = await openSpritesPage({ viewport: { width: 390, height: 844 } });
  try {
    const box = page.locator(".tree-scroll").first();
    await box.scrollIntoViewIfNeeded();
    const measured = await box.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    assert.ok(measured.scrollWidth > measured.clientWidth, "the tree really is wider than a phone, or this test proves nothing");
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
  } finally {
    await context.close();
  }
});

test("the topbar nav links to the four real group pages, not in-page anchors", async () => {
  const { context, page } = await openSpritesPage();
  try {
    const hrefs = await page.locator(".jump").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(hrefs.sort(), [
      "./sprites-adventure-props.html", "./sprites-emotions.html", "./sprites-objects.html", "./sprites-person-roles.html",
    ].sort());
    for (const href of hrefs) assert.doesNotMatch(href, /^#/, "no jump is an in-page anchor any more");
  } finally {
    await context.close();
  }
});

test("clicking a topbar nav link really opens that group's own full-gallery page", async () => {
  const { context, page } = await openSpritesPage();
  try {
    await page.locator('.jump[href="./sprites-person-roles.html"]').click();
    await page.waitForURL(/sprites-person-roles\.html$/);
    const heading = await page.locator(".group h2").first().innerText();
    assert.match(heading, /person roles/i);
    assert.match(heading, /57/);
    assert.ok(await page.locator('.card[data-cls="doctor"]').count() > 0, "the full person-roles gallery really is on that page");
  } finally {
    await context.close();
  }
});

test("the composer resolves classes with no card on this page at all — 'a doctor with a hat, and a cabinet' composes from all three groups", async () => {
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
  // "bookcase" is not one of this catalog's own real classes (checked
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

test("a named room takes the whole scene wall, with the entities standing in front of it", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    await page.fill("#composeq", "a doctor in the library");
    await page.waitForFunction(() => document.getElementById("sceneFrame")?.classList.contains("has-backdrop"));
    assert.equal(await page.locator("#sceneBackdrop svg").count(), 1, "the room's own sprite fills the backdrop layer");
    assert.equal(await page.locator("#sceneBackdrop .scene-room-name").textContent(), "library");
    assert.deepEqual(await page.locator("#sceneRow .scene-label").allInnerTexts(), ["doctor"], "the room is the wall, never a standing tile");
    const widths = await page.evaluate(() => ({
      frame: document.getElementById("sceneFrame").getBoundingClientRect().width,
      backdrop: document.getElementById("sceneBackdrop").getBoundingClientRect().width,
    }));
    assert.ok(widths.backdrop >= widths.frame - 1, "the backdrop spans the frame edge to edge");
    assert.deepEqual(consoleErrors, [], "a room scene renders without a console error");
  } finally {
    await context.close();
  }
});

test("a 'moving' entity walks: its sprite alternates frames and oscillates while the scene stays put", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    await page.fill("#composeq", "a moving cat and a hat");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 2);
    assert.deepEqual(await page.locator("#sceneRow .scene-label").allInnerTexts(), ["moving cat", "hat"]);
    assert.equal(await page.locator("#sceneRow .scene-walker").count(), 1, "only the moving entity walks");
    const sample = async () => page.locator(".scene-walker .scene-sprite").evaluate((el) => ({ t: el.style.transform, svg: el.innerHTML }));
    const seenTransforms = new Set();
    const seenFrames = new Set();
    for (let i = 0; i < 5; i += 1) {
      const s = await sample();
      seenTransforms.add(s.t);
      seenFrames.add(s.svg);
      await page.waitForTimeout(850);
    }
    assert.ok(seenTransforms.size >= 2, `the walker really moves, saw ${seenTransforms.size} position(s)`);
    assert.ok(seenFrames.size >= 2, `the walker really changes drawings, saw ${seenFrames.size} frame(s)`);
    assert.deepEqual(consoleErrors, [], "the walk logs no console error");
  } finally {
    await context.close();
  }
});

test("the random-scene button writes a sentence into the composer and runs it through the same pipeline as typed input", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    await page.click("#composeRandom");
    const sentence = await page.locator("#composeq").inputValue();
    assert.ok(sentence.length > 0, "the button really writes a sentence");
    assert.match(sentence, /in the /, "the sentence names one of the adventure worlds' own rooms");
    await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 1);
    assert.equal(await page.evaluate(() => document.getElementById("sceneFrame").classList.contains("has-backdrop")), true,
      "the named room really renders as the wall");

    // The typed pipeline is the same one: retyping the exact sentence
    // composes the exact same scene.
    const randomLabels = await page.locator("#sceneRow .scene-label").allInnerTexts();
    await page.fill("#composeq", "");
    await page.fill("#composeq", sentence);
    await page.waitForFunction((n) => document.querySelectorAll("#sceneRow .scene-card").length === n, randomLabels.length);
    assert.deepEqual(await page.locator("#sceneRow .scene-label").allInnerTexts(), randomLabels);
    assert.deepEqual(consoleErrors, [], "a random scene composes without a console error");
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

test("the dock grounds a parameter question, then its values, each in the template data's own real rows", async () => {
  const { context, page, consoleErrors, failedRequests } = await openSpritesPage();
  try {
    const params = await askDock(page, "what parameters does a person sprite take?");
    const paramsText = await params.innerText();
    assert.match(paramsText, /emotion/, "the answer names the real parameter the person templates declare");
    assert.match(paramsText, /source: corpus:sprites/, "the answer cites the rows it was read from");
    assert.ok(await params.evaluate((el) => el.classList.contains("grounded")), "the reply is marked as read from the embedded facts");

    const values = await askDock(page, "what emotions does a person sprite accept?");
    const valuesText = await values.innerText();
    assert.match(valuesText, /happy/, "asking about that parameter carries its own real value set");
    assert.ok(await values.evaluate((el) => el.classList.contains("grounded")));

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

test("the dock's classes-on-record question grounds in the WHOLE catalog, not just this page's own example cards", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const footerText = await page.locator("footer.page").innerText();
    const wholeCatalogTotal = Number((footerText.match(/^(\d+) classes/) || [])[1]);
    assert.ok(Number.isFinite(wholeCatalogTotal), `the footer names the whole catalog's real total, got: ${footerText}`);
    const cardsOnThisPage = await page.locator(".card").count();
    assert.ok(wholeCatalogTotal > cardsOnThisPage, "the whole catalog is far bigger than this page's one-per-section example cards, or this test proves nothing");

    const reply = await askDock(page, "how many sprite classes are there?");
    const text = await reply.innerText();
    // The count answer carries its own "say list ... to see them" nudge after
    // the count itself, so the count is a prefix match, not the whole line.
    const counted = Number((text.match(/^(\d+) sprite classes\./) || [])[1]);
    assert.ok(Number.isFinite(counted), `the answer is a real count, got: ${text}`);
    assert.equal(counted, wholeCatalogTotal, "the dock counts the whole catalog, never just the cards this landing page happens to show");
    assert.ok(await reply.evaluate((el) => el.classList.contains("grounded")), "the reply is marked as read from the embedded facts");
    assert.deepEqual(consoleErrors, [], "the classes question answers without a console error");
  } finally {
    await context.close();
  }
});

test("the dock enumerates the same classes it counts, straight off the rdf:type rows", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const reply = await askDock(page, "list the sprite classes");
    const text = await reply.innerText();
    assert.match(text, /is a sprite class/, "the listing reads the membership rows themselves");
    assert.match(text, /source: corpus:sprites/, "every listed member carries its source");
    assert.ok(await reply.evaluate((el) => el.classList.contains("grounded")));
    assert.deepEqual(consoleErrors, [], "the listing answers without a console error");
  } finally {
    await context.close();
  }
});

test("a dock pill fills the input with its exact question without submitting it", async () => {
  const { context, page } = await openSpritesPage();
  try {
    await page.locator('#dockPills .pill[data-q="what materials does a cabinet sprite accept?"]').click();
    assert.equal(await page.locator("#dockq").inputValue(), "what materials does a cabinet sprite accept?");
    assert.equal(await page.locator("#dockLog .a").count(), 0, "the pill only fills — the visitor presses Enter");
  } finally {
    await context.close();
  }
});

test("the catalog filter narrows the example cards, hides emptied groups, counts the survivors, and clears back to everything", async () => {
  const { context, page, consoleErrors } = await openSpritesPage();
  try {
    const total = await page.locator(".card").count();
    await page.fill("#q", "person");
    const shown = await page.locator(".card:not([hidden])").count();
    assert.ok(shown > 0 && shown < total, "the needle keeps some cards and drops others");
    for (const cls of await page.locator(".card:not([hidden])").evaluateAll((els) => els.map((el) => el.dataset.cls + " " + el.dataset.group))) {
      assert.match(cls, /person/, "every surviving card matches the needle by class or group");
    }
    assert.equal(await page.locator("#qcount").innerText(), `${shown} / ${total}`, "the counter reads survivors over total");

    await page.fill("#q", "");
    assert.equal(await page.locator(".card:not([hidden])").count(), total, "clearing the filter restores every card");
    assert.equal(await page.locator("#qcount").innerText(), "", "the counter goes quiet when nothing is filtered");
    assert.deepEqual(consoleErrors, [], "filtering logs no console error");
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
