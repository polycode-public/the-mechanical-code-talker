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
    // A fetch the service worker answers from cache is cancelled at the
    // network layer and reports net::ERR_ABORTED here even though the page
    // received every byte; a genuinely failing asset reports a different
    // error (and a plain 404 never fires requestfailed at all).
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
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

test("clicking a provenance facet filters the fact rows to that tier, and clicking it again restores the full view", async () => {
  const { context, page } = await openLedgerPage();
  try {
    await page.locator("#segProv .seg").first().waitFor({ state: "visible" });
    const rowsBefore = await page.locator("#ledger .rows .row").count();
    assert.ok(rowsBefore > 0, "the default focus renders real rows to filter");

    // The segment buttons are rebuilt on every render; read the label and
    // css key of the busiest provenance facet off the live DOM, so the probe
    // follows whatever this build's demo graph actually holds.
    const segs = await page.locator("#segProv .seg").evaluateAll((els) => els.map((el) => ({
      label: el.querySelector("span:not(.dot):not(.n)")?.textContent ?? "",
      count: Number(el.querySelector(".n")?.textContent ?? "0"),
      key: (el.querySelector(".dot")?.className.match(/d-(\w+)/) || [])[1] ?? "",
    })));
    const busiest = segs.reduce((a, b) => (b.count > a.count ? b : a));
    assert.ok(busiest.count > 0 && busiest.key, "at least one provenance facet counts real rows");

    await page.locator("#segProv .seg", { hasText: busiest.label }).click();
    assert.equal(
      await page.locator("#segProv .seg", { hasText: busiest.label }).getAttribute("aria-pressed"),
      "true",
      "the facet reads as selected",
    );
    const rowClasses = await page.locator("#ledger .rows .row").evaluateAll((els) => els.map((el) => el.className));
    assert.ok(rowClasses.length > 0, "the selected facet leaves real rows on show");
    for (const cls of rowClasses) {
      assert.match(cls, new RegExp(`\\bp-${busiest.key}\\b`), "every rendered row belongs to the selected tier");
    }

    await page.locator("#segProv .seg", { hasText: busiest.label }).click();
    assert.equal(
      await page.locator("#segProv .seg", { hasText: busiest.label }).getAttribute("aria-pressed"),
      "false",
      "a second click clears the facet",
    );
    assert.equal(await page.locator("#ledger .rows .row").count(), rowsBefore, "the unfiltered view returns intact");
  } finally {
    await context.close();
  }
});

test("the go-to-term search refocuses onto a real term and grows the trail; an unknown term reports the miss and moves nothing", async () => {
  const { context, page } = await openLedgerPage();
  try {
    await page.locator(".focuscard .term").waitFor({ state: "visible" });
    const focusBefore = await page.locator(".focuscard .term").innerText();
    const target = await page.evaluate(
      (current) => LEDGER.terms.map((t) => t.term).find((t) => t !== current),
      focusBefore,
    );
    assert.ok(target, "the demo graph holds more than one term to jump between");

    await page.fill("#q", target);
    await page.press("#q", "Enter");
    assert.equal(await page.locator(".focuscard .term").innerText(), target, "the view refocuses onto the searched term");
    assert.equal(await page.locator(".crumbs .crumb").count(), 2, "the jump lands on the focus trail");
    assert.equal(await page.locator("#q").inputValue(), "", "a successful jump clears the search box");

    await page.fill("#q", "zzz-not-a-term");
    await page.press("#q", "Enter");
    assert.equal(await page.locator("#qmiss").innerText(), "no such term", "an unknown term is refused, never guessed at");
    assert.equal(await page.locator(".focuscard .term").innerText(), target, "a missed search moves the focus nowhere");
    assert.equal(await page.locator(".crumbs .crumb").count(), 2, "a missed search adds no breadcrumb");
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
