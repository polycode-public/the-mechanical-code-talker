// news.html's structural contract: it loads clean, makes no request of any
// kind before the visitor presses start, renders all seven dashboard tiles,
// and fits a phone viewport. This page has no in-page engine and no seed —
// server/row-service/local.mjs's own double covers the behavioural pins
// (test-e2e/pages-news-feed.test.mjs); this file is markup and layout only,
// so it never starts a row service of its own.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 15_000;
const PHONE_WIDTHS = [375, 320];
const DASH_TILE_IDS = [
  "tileFeedItems", "tileTermsUngrounded", "tileFactsFromNews", "tileGraphSize", "tileSourcesLive",
  "panelTermsRanked", "panelSourcesPerSource",
];

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

/** A fresh context/page with every request recorded and refused — this
 *  file never runs a row service, so a request this page fires would
 *  otherwise 404 against the plain static server rather than telling this
 *  test anything about the page's own behaviour. */
async function openPage({ viewport } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const requestAttempts = [];
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.route("**/api/**", (route) => { requestAttempts.push(route.request().url()); return route.abort(); });
  await page.goto(`${server.origin}/news.html`, { waitUntil: "load" });
  return { context, page, requestAttempts, pageErrors };
}

async function waitFor(page, predicate, { timeoutMs = READY_TIMEOUT_MS, pollMs = 200, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate);
    if (result) return result;
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`${label} never became true within ${timeoutMs}ms`);
}

test("loads with no page errors, fires no /api/ request before start, and renders all seven dashboard tiles/panels", async () => {
  const { context, page, requestAttempts, pageErrors } = await openPage();
  try {
    await waitFor(page, () => (document.getElementById("feedCount").textContent || "").trim().length > 0, { label: "the first paint's own render" });
    assert.deepEqual(pageErrors, [], "no page error on first load");
    assert.deepEqual(requestAttempts, [], "nothing reached /api/ before any press");
    for (const id of DASH_TILE_IDS) {
      assert.equal(await page.locator(`#${id}`).count(), 1, `#${id} renders`);
    }
    assert.equal(await page.locator("#requestLogBody tr").count(), 0, "the request log is empty before consent");
    assert.equal(await page.locator("#newsStart").innerText(), "start polling live sources");
  } finally {
    await context.close();
  }
});

for (const width of PHONE_WIDTHS) {
  test(`news.html has no horizontal overflow at ${width}px`, async () => {
    const { context, page } = await openPage({ viewport: { width, height: 900 } });
    try {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(scrollWidth <= clientWidth, `news.html at ${width}px: document scrolls to ${scrollWidth}px inside a ${clientWidth}px viewport`);
    } finally {
      await context.close();
    }
  });
}

test("the demo eyebrow's about anchor resolves", async () => {
  const { context, page } = await openPage();
  try {
    const eyebrowHrefs = await page.locator(".eyebrow a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    assert.ok(eyebrowHrefs.includes("./news-about.html"), `the eyebrow links the about page: ${JSON.stringify(eyebrowHrefs)}`);
    for (const href of eyebrowHrefs) {
      const res = await page.request.get(`${server.origin}/${href.replace(/^\.\//, "").split("#")[0]}`);
      assert.equal(res.status(), 200, `${href} resolves`);
    }
  } finally {
    await context.close();
  }
});
