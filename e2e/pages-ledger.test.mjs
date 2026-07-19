// The standalone ledger page in a real browser: it loads clean, the
// telemetry-strip dashboard added atop the existing 3-column layout shows
// real numbers that agree with the page's own embedded LEDGER data (never a
// placeholder), and the page survives a phone-sized viewport. The embedded-
// in-the-homepage-iframe path is pages-home.test.mjs's job; this file drives
// public/ledger.html directly.
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

/** Open ledger.html with third-party hosts blocked (this page makes none,
 *  but every sibling page test in this file holds the same posture). Returns
 *  the page plus what it logged and what it failed to fetch. */
async function openLedgerPage({ viewport, colorScheme } = {}) {
  const context = await browser.newContext({ ...(viewport ? { viewport } : {}), ...(colorScheme ? { colorScheme } : {}) });
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

  await page.goto(`${server.origin}/ledger.html`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors, failedRequests };
}

test("the ledger page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openLedgerPage();
  try {
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.match(await page.title(), /^tmct ledger — \d+ facts?/);
  } finally {
    await context.close();
  }
});

test("the dashboard strip renders real tiles whose numbers agree with the page's own embedded fact count", async () => {
  const { context, page } = await openLedgerPage();
  try {
    await page.locator(".dash").waitFor({ state: "visible" });
    const tileCount = await page.locator(".dash .tile").count();
    assert.equal(tileCount, 6, "facts.total, facts.by-tier, graph.avg-degree, data.quality, corpus.bundles, predicate.top");

    // LEDGER is a top-level `const` in a classic (non-module) inline script —
    // reachable as a bare identifier in the page's global scope, but never a
    // window property, so `window.LEDGER` itself would be undefined.
    const ledgerMeta = await page.evaluate(() => LEDGER.meta);
    const totalTileValue = await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText();
    assert.equal(Number(totalTileValue), ledgerMeta.total, "facts.total reads the same total the page's own LEDGER.meta carries");
    assert.ok(Number(totalTileValue) > 0, "a real demo graph never renders a zero-fact tile");

    const tierText = await page.locator(".tierlegend").innerText();
    const tierCounts = [...tierText.matchAll(/(\d+)\s+(taught|corpus|entailed)/g)].map((m) => Number(m[1]));
    assert.equal(tierCounts.length, 3, "taught, corpus, and entailed each render a real count");
    assert.equal(tierCounts.reduce((a, b) => a + b, 0), ledgerMeta.total, "the tier split accounts for every fact");

    const bundleRows = await page.locator(".dash .tile", { hasText: "corpus.bundles" }).locator(".bbar").count();
    assert.ok(bundleRows > 0, "at least one real corpus bundle is named");
    const predicateRows = await page.locator(".dash .tile", { hasText: "predicate.top" }).locator(".bbar").count();
    assert.ok(predicateRows > 0, "at least one real predicate is named");
  } finally {
    await context.close();
  }
});

test("the ingestion sparkline in the aside renders a real polyline over the same fact set", async () => {
  const { context, page } = await openLedgerPage();
  try {
    await page.locator(".sparkwrap svg.spark").waitFor({ state: "visible" });
    const d = await page.locator(".sparkwrap svg.spark .line").getAttribute("d");
    assert.ok(d && /^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+)+$/.test(d), `the sparkline path is a real multi-point polyline: ${d}`);
  } finally {
    await context.close();
  }
});

test("the ledger page fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await openLedgerPage({ viewport: { width: 375, height: 812 }, colorScheme });
    try {
      await page.locator(".dash").waitFor({ state: "visible" });
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${colorScheme}: the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
      );
    } finally {
      await context.close();
    }
  }
});
