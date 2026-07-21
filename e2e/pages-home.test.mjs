// The deployed home page, in a real browser: it loads clean, it shows the
// fully-expanded sections, every hero and explore-card is a screenshot plus
// a link rather than a live embed, and it survives a phone-sized viewport.
// Nothing else drives index.html end to end (the chat.html/plan.html/
// adventure.html/ledger.html/sprites.html/spider-fly.html pages' own content
// is each page's own test file's job — this file only checks index.html
// links to them and shows what it says it shows).
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

test("the chat hero shows a screenshot of chat.html and links to it, in both the caption and the image", async () => {
  const { context, page } = await openHomePage();
  try {
    const hero = page.locator(".hero-shot").first();
    await hero.waitFor({ state: "visible" });
    const captionHref = await hero.locator(".hero-row a").getAttribute("href");
    assert.equal(captionHref, "./chat.html");
    const img = hero.locator("img");
    await assert.doesNotReject(img.waitFor({ state: "visible" }), "the screenshot renders");
    assert.match(await img.getAttribute("src"), /screenshots\/chat\.png$/);
    const imgLinkHref = await hero.locator("a").last().getAttribute("href");
    assert.equal(imgLinkHref, "./chat.html", "the screenshot itself is also a link to the full page");
  } finally {
    await context.close();
  }
});

test("the spider-and-fly hero shows a screenshot of spider-fly.html and links to it", async () => {
  const { context, page } = await openHomePage();
  try {
    const hero = page.locator(".hero-shot").nth(1);
    await hero.waitFor({ state: "visible" });
    const captionHref = await hero.locator(".hero-row a").getAttribute("href");
    assert.equal(captionHref, "./spider-fly.html");
    const img = hero.locator("img");
    await assert.doesNotReject(img.waitFor({ state: "visible" }), "the screenshot renders");
    assert.match(await img.getAttribute("src"), /screenshots\/spider-fly\.png$/);
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
    assert.match(body, /ELIZA\/PARRY lineage/, "the lineage prose survives the reorg");
    assert.doesNotMatch(body, /What an answer looks like/, "the removed transcript section is gone");
  } finally {
    await context.close();
  }
});

test("the explore band's four link cards each lead to a real, working page", async () => {
  const { context, page } = await openHomePage();
  try {
    await page.locator(".explore-grid").waitFor({ state: "visible" });
    const cards = page.locator(".explore-card");
    assert.equal(await cards.count(), 4, "exactly four link cards");
    const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.deepEqual(hrefs, ["./plan.html", "./adventure.html", "./ledger.html", "./sprites.html"]);
  } finally {
    await context.close();
  }
});

test("the plan and ledger cards each show a screenshot of their own page", async () => {
  const { context, page } = await openHomePage();
  try {
    const planShot = page.locator('.explore-card[href="./plan.html"] img.explore-shot');
    const ledgerShot = page.locator('.explore-card[href="./ledger.html"] img.explore-shot');
    await assert.doesNotReject(planShot.waitFor({ state: "visible" }));
    await assert.doesNotReject(ledgerShot.waitFor({ state: "visible" }));
    assert.match(await planShot.getAttribute("src"), /screenshots\/plan\.png$/);
    assert.match(await ledgerShot.getAttribute("src"), /screenshots\/ledger\.png$/);
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

test("the adventure link card leads to a real room scene", async () => {
  const { context, page } = await openPage("adventure.html");
  try {
    await page.locator("#roomFrame").waitFor({ state: "visible" });
  } finally {
    await context.close();
  }
});

test("the ledger link card leads to a real taught fact store", async () => {
  const { context, page } = await openPage("ledger.html");
  try {
    await page.locator("#chatform").waitFor({ state: "visible" });
    const facts = await page.locator(".ledger .row").count();
    assert.ok(facts > 0, "the ledger page renders real fact rows");
  } finally {
    await context.close();
  }
});

test("the sprites link card leads to a real sprite catalog", async () => {
  const { context, page } = await openPage("sprites.html");
  try {
    const cards = await page.locator(".card").count();
    assert.ok(cards > 0, "the sprite catalog renders real class cards");
  } finally {
    await context.close();
  }
});

test("the sprite-library card's own teaser shows real sprite icons and real ancestor-chain text, not a placeholder", async () => {
  const { context, page } = await openHomePage();
  try {
    const teaser = page.locator('.explore-card[href="./sprites.html"] .sprite-teaser');
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

test("the version the page documents is the version the package ships", async () => {
  const { context, page } = await openHomePage();
  try {
    const shown = (await page.locator("#pkg-version").textContent())?.trim();
    const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    // post-deploy-smoke.mjs reads this element off the deployed page and checks
    // it against the published package, so a stale stamp reports a bad deploy.
    assert.equal(shown, version, "the page's version stamp tracks package.json");
  } finally {
    await context.close();
  }
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
    await assert.doesNotReject(page.locator(".explore-grid").waitFor({ state: "visible" }));
  } finally {
    await context.close();
  }
});
