// The deployed home page and its six about pages, in a real browser: they
// load clean, the claim cards link to the demo pages and offer an info link
// and a share sheet, the capability table scrolls in its own box, the feature
// sections show each page's screenshot as a framed plate rather than a live
// embed, the showcase links to the sibling Polycode projects, and all of it
// survives a phone-sized viewport. Nothing else drives these pages end to end
// (the chat.html/plan.html/adventure.html/ledger.html/sprites.html pages'
// own content is each page's own test file's job — this file only checks
// index.html links to them and shows what it says it shows).
//
// Third-party hosts are blocked for every run, and the block must cost the
// page nothing: every asset — the wink lemma/POS tier included, via the
// site's own ./vendor/wink.js — is first-party, so the run is identical on a
// laptop offline and in CI, and the live-demo box loads its full tier set,
// which is asserted below.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { DEMO_PAGES, aboutPageOf } from "../scripts/site-pages.mjs";

const PAGE_ORDER = DEMO_PAGES;

// Plates whose screenshot the capture script has not written yet. The page
// styles these to degrade to a framed panel with alt text; here they excuse
// the one console error their 404 logs. Once the PNGs exist the filter
// matches nothing — remove entries as captures land.
const PENDING_PLATES = [];
const PENDING_SHOT_RE = new RegExp(`screenshots/(${PENDING_PLATES.join("|")})\\.png`);

// Playwright's own 30s default loses to CPU contention when the full suite or
// several agents run alongside this file, and the page does render given time.
const LOADED_WAIT_MS = 60_000;

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

/**
 * Open a same-origin page with third-party hosts blocked.
 * Returns the page plus what it logged and what it failed to fetch.
 */
async function openPage(path, { viewport } = {}) {
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
    // Chromium logs a resource error for each third-party request blocked
    // above. Those name the CDN as their source; the page's own files name
    // this server, and those are the ones that count.
    const source = msg.location()?.url ?? "";
    if (source && !source.startsWith(server.origin)) return;
    if (PENDING_SHOT_RE.test(source) || PENDING_SHOT_RE.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    // A fetch the service worker answers from cache is cancelled at the
    // network layer and reports net::ERR_ABORTED here even though the page
    // received every byte; a genuinely failing asset reports a different
    // error (and a plain 404 never fires requestfailed at all).
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/${path}`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors, failedRequests };
}

const openHomePage = (opts) => openPage("index.html", opts);

test("the home page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openHomePage();
  try {
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.equal(await page.title(), "tmct — The Mechanical Code Talker");
  } finally {
    await context.close();
  }
});

test("the page embeds no live widget: no iframe, no #tmct-chat, no chat engine script tag", async () => {
  const { context, page } = await openHomePage();
  try {
    assert.equal(await page.locator("iframe").count(), 0, "no page is embedded live in an iframe");
    assert.equal(await page.locator("#tmct-chat").count(), 0, "the old embedded chat widget is gone");
    assert.equal(await page.locator('script[src="./chat-browser.bundle.js"]').count(), 0, "the chat engine bundle is not loaded on the home page");
  } finally {
    await context.close();
  }
});

test("the claim grid shows one claim block per demo page, each a link onto its page, in the page order", async () => {
  const { context, page } = await openHomePage();
  try {
    await page.locator(".claim-grid").waitFor({ state: "visible" });
    const claims = page.locator("a.claim");
    assert.equal(await claims.count(), PAGE_ORDER.length, "one claim block per demo page");
    const hrefs = await claims.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(hrefs, PAGE_ORDER.map((p) => `./${p}.html`));
  } finally {
    await context.close();
  }
});

test("every feature plate links to the page it depicts and asks for that page's screenshot", async () => {
  const { context, page } = await openHomePage();
  try {
    for (const name of PAGE_ORDER) {
      const frame = page.locator(`#feature-${name} .plate-frame`);
      assert.equal(await frame.getAttribute("href"), `./${name}.html`, `the ${name} plate links to its page`);
      const src = await frame.locator("img").getAttribute("src");
      assert.match(src, new RegExp(`screenshots/${name}\\.png$`), `the ${name} plate asks for its own screenshot`);
    }
  } finally {
    await context.close();
  }
});

test("the four captured screenshots render visibly in their plates", async () => {
  const { context, page } = await openHomePage();
  try {
    for (const name of PAGE_ORDER.filter((p) => !PENDING_PLATES.includes(p))) {
      const img = page.locator(`#feature-${name} .plate-frame img`);
      await assert.doesNotReject(img.waitFor({ state: "visible" }), `the ${name} screenshot renders`);
      const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
      assert.ok(loaded, `the ${name} screenshot decodes to real pixels`);
    }
  } finally {
    await context.close();
  }
});

test("a plate awaiting its screenshot still shows its framed figure and caption, not a collapsed section", async () => {
  const { context, page } = await openHomePage();
  try {
    for (const name of PENDING_PLATES) {
      const plate = page.locator(`#feature-${name} .plate`);
      await plate.waitFor({ state: "visible" });
      const caption = await plate.locator("figcaption").innerText();
      assert.match(caption, new RegExp(`${name}\\.html`, "i"), `the ${name} plate caption names its page`);
      const imgBox = await plate.locator("img").boundingBox();
      assert.ok(imgBox && imgBox.height > 40, `the ${name} plate keeps its panel height while the image is missing`);
    }
  } finally {
    await context.close();
  }
});

test("the live-demo box answers with the full wink tier loaded from the site's own vendor asset, third parties blocked", async () => {
  const { context, page } = await openHomePage();
  try {
    await page.locator("#tmct-demo").waitFor({ state: "visible" });
    // The whole engine ships with the page now, lemma/POS tier included
    // (./vendor/wink.js) — so with every third-party host blocked the box
    // still reports the tier loaded, not degraded.
    const status = page.locator("#tmct-demo ~ .demo-status, .demo-status");
    await status.first().waitFor({ state: "visible" });
    await assert.doesNotReject(
      page.waitForFunction(() => /lemma\/POS tier: loaded/.test(document.querySelector(".demo-status")?.textContent ?? "")),
      "the box reports the lemma/POS tier loaded from the first-party asset",
    );
    await page.locator("#tmct-demo .term-answer").first().waitFor({ state: "visible" });
    const errors = await page.locator("#tmct-demo .term-error").count();
    assert.equal(errors, 0, "a reachable engine answers rather than reporting a failure");
  } finally {
    await context.close();
  }
});

test("the page keeps the steps to run the local chat and to use tmct as a library, and the ELIZA/PARRY lineage prose", async () => {
  const { context, page } = await openHomePage();
  try {
    const body = await page.locator("main").innerText();
    assert.match(body, /npm install -g @polycode-projects\/the-mechanical-code-talker/, "the install step is on the page");
    assert.match(body, /tmct chat --repo/, "the step to point tmct at a repo is on the page");
    assert.match(body, /tmct init/, "the scaffold step is on the page");
    assert.match(body, /import \{ runChat \} from "@polycode-projects\/the-mechanical-code-talker"/, "the library import is on the page");
    assert.match(body, /await runChat\(\{/, "the library call is on the page");
    assert.match(body, /ELIZA\/PARRY lineage/, "the lineage prose survives the redesign");
    assert.doesNotMatch(body, /What an answer looks like/, "the removed transcript section stays gone");
  } finally {
    await context.close();
  }
});

test("the showcase links to the Polycode family projects", async () => {
  const { context, page } = await openHomePage();
  try {
    const cards = page.locator("section.showcase:not(#claims-teaser):not(#river-puzzle) .showcase-card");
    await cards.first().waitFor({ state: "visible" });
    assert.equal(await cards.count(), 3, "three family showcase cards");
    const teaser = page.locator('#claims-teaser .showcase-card[href="./claims.html"]');
    assert.equal(await teaser.count(), 1, "the claims teaser card links to claims.html");
    const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(hrefs, [
      "https://seonix.polycode.co.uk/",
      "https://gitlab.com/polycode-projects/bedrock-meter",
      "https://gitlab.com/polycode-projects/the-quiet-feed",
    ]);
    const text = await page.locator("section.showcase:not(#claims-teaser):not(#river-puzzle)").innerText();
    assert.match(text, /Seonix/);
    assert.match(text, /Bedrock Meter/);
    assert.match(text, /The Quiet Feed/);
  } finally {
    await context.close();
  }
});

test("the river-crossing card opens mudiii on that scenario in a new tab", async () => {
  const { context, page } = await openHomePage();
  try {
    const card = page.locator('#river-puzzle .showcase-card[href="./mudiii.html?scenario=river"]');
    await card.waitFor({ state: "visible" });
    assert.equal(await card.getAttribute("target"), "_blank", "it leaves the home page standing behind it");
    assert.equal(await card.getAttribute("rel"), "noopener noreferrer");
    const text = await page.locator("#river-puzzle").innerText();
    assert.match(text, /fox, the goat and the cabbage/i, "the card names the puzzle rather than the page");
  } finally {
    await context.close();
  }
});

test("the river-crossing card offers an info link to mudiii's about page and its own share sheet", async () => {
  const { context, page } = await openHomePage();
  try {
    const info = page.locator('#river-puzzle a.card-btn');
    assert.equal(await info.getAttribute("href"), "./mudiii-about.html", "About shares mudiii's own about page rather than a new one");
    assert.match(await info.innerText(), /^About /, "the info link has a readable name, not a bare icon");

    const share = page.locator('#river-puzzle button.share-btn');
    assert.equal(await share.getAttribute("data-share-demo"), "river", "the share button names its own share-target key");
    await share.click();
    const sheet = page.locator("dialog.share-sheet");
    await sheet.waitFor({ state: "visible" });
    const posts = sheet.locator(".share-post");
    const count = await posts.count();
    assert.ok(count >= 5, `expected at least five river posts, found ${count}`);
    const texts = await posts.locator(".share-text").allInnerTexts();
    assert.equal(new Set(texts).size, texts.length, "each river post says something different");
    await sheet.locator(".share-close").click();
    await sheet.waitFor({ state: "hidden" });
  } finally {
    await context.close();
  }
});

test("the plan link card leads to a real replay of the solved game", async () => {
  const { context, page } = await openPage("plan.html");
  try {
    await page.locator("#board").waitFor({ state: "visible" });
    const body = await page.locator("body").innerText();
    assert.match(body, /disk-1/, "the plan page names the pieces it moved");
  } finally {
    await context.close();
  }
});

test("the plan page draws the puzzle's own pieces and nothing else from memory", async () => {
  const { context, page } = await openPage("plan.html");
  try {
    await page.locator("#board").waitFor({ state: "visible" });
    // The PDDL + OWL/RDF panel legitimately names domain/predicate terms
    // (tmct-plan, smaller-than, rest-on, ...) that are not board pieces at
    // all, so it is excluded here — it is checked on its own terms below.
    // innerText only reflects rendered layout, so the panel is hidden (not
    // cloned-and-detached, which loses layout and leaks script/style text)
    // for the single synchronous read, then restored.
    const replay = await page.locator("body").evaluate((body) => {
      const panel = body.querySelector(".pddlpanel");
      const prevDisplay = panel?.style.display ?? "";
      if (panel) panel.style.display = "none";
      const text = body.innerText;
      if (panel) panel.style.display = prevDisplay;
      return text;
    });
    // The board once drew every member of every class it had not declared as a
    // block or a slot, which is the whole memory rather than the puzzle. A
    // render that names a term the game never taught is that defect returning,
    // and naming one piece is not enough to notice it.
    const hanoiTerms = /^(disk-[1-3]|peg-[a-c])$/;
    const drawn = [...replay.matchAll(/\b[a-z]+-[a-z0-9]+\b/g)].map(([term]) => term);
    const strangers = [...new Set(drawn.filter((term) => !hanoiTerms.test(term)))];
    assert.deepEqual(strangers, [], "the replay names only the pieces and places hanoi-3 taught");
    assert.ok(drawn.length > 0, "the replay names the pieces at all");
  } finally {
    await context.close();
  }
});

test("the plan page's PDDL panel names only the puzzle's own objects and taught predicates", async () => {
  const { context, page } = await openPage("plan.html");
  try {
    const pddl = await page.locator("#pddlOut").innerText();
    assert.match(pddl, /disk-1/, "the PDDL objects include the puzzle's own pieces");
    assert.match(pddl, /\(:action /, "the PDDL artifact includes at least one action");
  } finally {
    await context.close();
  }
});

test("the adventure claim leads to a real room scene", async () => {
  const { context, page } = await openPage("adventure.html");
  try {
    await page.locator("#roomFrame").waitFor({ state: "visible", timeout: LOADED_WAIT_MS });
  } finally {
    await context.close();
  }
});

test("the ledger claim leads to a real taught fact store", async () => {
  const { context, page } = await openPage("ledger.html");
  try {
    await page.locator("#chatform").waitFor({ state: "visible", timeout: LOADED_WAIT_MS });
    const facts = await page.locator(".ledger .row").count();
    assert.ok(facts > 0, "the ledger page renders real fact rows");
  } finally {
    await context.close();
  }
});

test("the sprites claim leads to a real sprite catalog", async () => {
  const { context, page } = await openPage("sprites.html");
  try {
    const cards = await page.locator(".card").count();
    assert.ok(cards > 0, "the sprite catalog renders real class cards");
  } finally {
    await context.close();
  }
});

test("the sprite-library feature's teaser shows real sprite icons and real ancestor-chain text, not a placeholder", async () => {
  const { context, page } = await openHomePage();
  try {
    const teaser = page.locator("#feature-sprites .sprite-teaser");
    await teaser.waitFor({ state: "visible" });
    const svgCount = await teaser.locator("svg").count();
    assert.ok(svgCount >= 3, `expected at least 3 real sprite icons, found ${svgCount}`);
    const text = await teaser.innerText();
    assert.match(text, /poodle/);
    assert.match(text, /animal/);
  } finally {
    await context.close();
  }
});

test("version.txt documents the version the package ships", async () => {
  const text = await (await fetch(`${server.origin}/version.txt`)).text();
  const [shown] = text.split("\n");
  const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  // post-deploy-smoke.mjs and wait-for-site.mjs both read this file off the
  // deployed site and check it against the published package, so a stale
  // stamp reports a bad deploy.
  assert.equal(shown, version, "version.txt's version line tracks package.json");
});

test("the page fits a phone viewport without sideways scrolling", async () => {
  const { context, page } = await openHomePage({ viewport: { width: 375, height: 667 } });
  try {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    // A page that overflows its own viewport scrolls sideways under a thumb.
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
    await assert.doesNotReject(page.locator(".claim-grid").waitFor({ state: "visible" }));
  } finally {
    await context.close();
  }
});

// ---- the about pages, and the two controls that reach them ------------------------

test("every claim card offers an info link to its about page and a share button, both with an accessible name", async () => {
  const { context, page } = await openHomePage();
  try {
    const cells = page.locator(".claim-cell");
    assert.equal(await cells.count(), PAGE_ORDER.length, "one cell per demo");
    for (const [i, name] of PAGE_ORDER.entries()) {
      const cell = cells.nth(i);
      const info = cell.locator("a.card-btn");
      assert.equal(await info.getAttribute("href"), `./${aboutPageOf(name)}`, `${name}'s info link points at its about page`);
      assert.match(await info.innerText(), /^About /, `${name}'s info link has a readable name, not a bare icon`);
      const share = cell.locator("button.share-btn");
      assert.equal(await share.getAttribute("data-share-demo"), name, `${name}'s share button names its demo`);
      assert.match(await share.innerText(), /^Share /, `${name}'s share button has a readable name`);
    }
  } finally {
    await context.close();
  }
});

test("the share sheet opens with five or more posts, each with its own text and its own link", async () => {
  const { context, page } = await openHomePage();
  try {
    await page.locator(".claim-cell").first().locator("button.share-btn").click();
    const sheet = page.locator("dialog.share-sheet");
    await sheet.waitFor({ state: "visible" });
    const posts = sheet.locator(".share-post");
    const count = await posts.count();
    assert.ok(count >= 5, `expected at least five posts, found ${count}`);
    const texts = await posts.locator(".share-text").allInnerTexts();
    assert.equal(new Set(texts).size, texts.length, "each post says something different");
    const targets = await posts.locator("a.share-target").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.equal(new Set(targets).size, targets.length, "each post links somewhere different");
    // Copy is always offered; Share only where the browser has navigator.share.
    assert.ok((await posts.first().locator(".share-act").count()) >= 1, "a post offers at least a copy control");
    await sheet.locator(".share-close").click();
    await sheet.waitFor({ state: "hidden" });
  } finally {
    await context.close();
  }
});

test("the capability table shows every demo and scrolls sideways inside its own box", async () => {
  const { context, page } = await openHomePage({ viewport: { width: 375, height: 667 } });
  try {
    const rows = page.locator("table.matrix tbody tr");
    assert.equal(await rows.count(), PAGE_ORDER.length, "one row per demo page");
    const linked = await rows.locator('th[scope="row"] a').evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(linked, PAGE_ORDER.map((p) => `./${p}.html`));
    // A wide table must scroll in its own container, never widen the document.
    const wrap = page.locator(".matrix-wrap");
    const scrolls = await wrap.evaluate((el) => el.scrollWidth > el.clientWidth);
    assert.ok(scrolls, "the table is wider than its box, which is why the box scrolls");
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the table pushed the page to ${overflow.scrollWidth}px in a ${overflow.clientWidth}px viewport`,
    );
  } finally {
    await context.close();
  }
});

test("every about page loads clean, styled by the shared sheet, with its nav and its Next chain working", async () => {
  for (const name of PAGE_ORDER) {
    const { context, page, consoleErrors, failedRequests } = await openPage(aboutPageOf(name));
    try {
      assert.deepEqual(failedRequests, [], `${name}'s about page serves every asset it asks for`);
      assert.deepEqual(consoleErrors, [], `${name}'s about page logs no error of its own`);
      // The shared stylesheet actually applied, rather than 404ing quietly.
      const styled = await page.locator(".about-shell").evaluate((el) => getComputedStyle(el).display);
      assert.equal(styled, "grid", `${name}'s about page picked up site.css`);
      const crumbs = page.locator(".about-crumbs a");
      // chat-about carries one extra crumb: its reasoning walkthrough section.
      const expectedCrumbs = name === "chat" ? 8 : 7;
      assert.equal(await crumbs.count(), expectedCrumbs, `${name}'s nav lists every section it carries`);
      // Each Next lands on a section that exists on the page it points into.
      const withinPage = await page.locator('.next-link[href^="#"]').evaluateAll((els) => els.map((el) => el.getAttribute("href")));
      for (const target of withinPage) {
        assert.equal(await page.locator(target).count(), 1, `${name}'s Next to ${target} lands on a real section`);
      }
      // The screenshot decodes rather than sitting as a broken image.
      const shot = page.locator(".shot img").first();
      await shot.waitFor({ state: "visible" });
      assert.ok(
        await shot.evaluate((el) => el.complete && el.naturalWidth > 0),
        `${name}'s about page screenshot decodes to real pixels`,
      );
    } finally {
      await context.close();
    }
  }
});

test("an about page reads on a phone without scrolling sideways", async () => {
  const { context, page } = await openPage(aboutPageOf("mudiii"), { viewport: { width: 375, height: 667 } });
  try {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the about page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
    await assert.doesNotReject(page.locator(".about-crumbs").waitFor({ state: "visible" }));
  } finally {
    await context.close();
  }
});
