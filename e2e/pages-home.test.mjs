// The deployed home page, in a real browser: it loads clean, it shows the hero,
// it keeps the steps a reader needs to run tmct, and it survives a phone-sized
// viewport. Nothing else drives index.html end to end.
//
// Third-party hosts are blocked for every run. The page's live-demo box loads
// wink-nlp from a CDN, and a test that reached for it would pass or fail on
// someone else's uptime. Blocked, the run is identical on a laptop offline and
// in CI, and the box drops to its lower tiers, which is asserted below.
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

/**
 * Open the home page with third-party hosts blocked.
 * Returns the page plus what it logged and what it failed to fetch.
 */
async function openHomePage({ viewport } = {}) {
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
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors, failedRequests };
}

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

test("the hero renders the ledger, and its iframe loads the ledger page itself", async () => {
  const { context, page } = await openHomePage();
  try {
    await assert.doesNotReject(page.locator(".ledger-hero").waitFor({ state: "visible" }));
    const frame = page.frameLocator(".ledger-hero iframe");
    await frame.locator("#chatform").waitFor({ state: "visible" });
    const facts = await frame.locator(".ledger .row").count();
    assert.ok(facts > 0, "the embedded ledger renders real fact rows");
  } finally {
    await context.close();
  }
});

test("the live-demo box answers on its lower tiers when the wink CDN is unreachable", async () => {
  const { context, page } = await openHomePage();
  try {
    await page.locator("#tmct-demo").waitFor({ state: "visible" });
    // The engine ships with the page; only the wink lemma/POS tier is remote.
    // Losing it costs accuracy, and the box says so rather than going quiet.
    const status = page.locator("#tmct-demo ~ .demo-status, .demo-status");
    await status.first().waitFor({ state: "visible" });
    await assert.doesNotReject(
      page.waitForFunction(() => /unavailable/.test(document.querySelector(".demo-status")?.textContent ?? "")),
      "the box reports the missing tier",
    );
    await page.locator("#tmct-demo .term-answer").first().waitFor({ state: "visible" });
    const errors = await page.locator("#tmct-demo .term-error").count();
    assert.equal(errors, 0, "a reachable engine answers rather than reporting a failure");
  } finally {
    await context.close();
  }
});

test("the page keeps the steps to run the local chat", async () => {
  const { context, page } = await openHomePage();
  try {
    const body = await page.locator("main").innerText();
    assert.match(body, /npm install -g @polycode-projects\/the-mechanical-code-talker/, "the install step is on the page");
    assert.match(body, /tmct chat --repo/, "the step to point tmct at a repo is on the page");
    assert.match(body, /tmct init/, "the scaffold step is on the page");
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
    await assert.doesNotReject(page.locator(".ledger-hero").waitFor({ state: "visible" }));
  } finally {
    await context.close();
  }
});
