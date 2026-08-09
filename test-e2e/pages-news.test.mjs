// news.html's structural contract: it loads clean, makes no third-party
// request before the visitor presses start, degrades honestly when every
// route it does try is blocked, and fits a phone viewport. Every route is
// fulfilled from committed fixtures or aborted outright — this file never
// touches a real third party, following the sibling pages-* specs' own
// (buildDemoSiteSnapshot + serveDirectory) convention.
//
// The page starves requestAnimationFrame and Playwright's injected pollers
// while it streams and indexes the chat seed, so a locator wait or
// waitForFunction times out against provably rendered content — this file
// samples with a sleep-then-evaluate loop throughout, the pattern
// scripts/gen-screenshots.mjs's own news ready check already proved out.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const SEED_READY_TIMEOUT_MS = 180_000;
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
  // The snapshot carries only tracked files (buildDemoSiteSnapshot's own
  // contract); the chat seed is neither, and the page has no first feed item
  // without it.
  cpSync(join(repoRoot, "public", "chat-seed.json"), join(siteDir, "chat-seed.json"));
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

/** A fresh context/page with every third-party request recorded and
 *  refused — same-origin requests (the seed among them) pass straight
 *  through uninstrumented, matching gen-screenshots.mjs's own capture route
 *  so seed streaming is never slowed by request interception. */
async function openPage({ viewport } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const thirdPartyAttempts = [];
  // `pageErrors` is the page's own code throwing — the thing "degrades
  // honestly, never throws" actually means. A blocked/aborted route also
  // logs its own "Failed to load resource" console error, straight from
  // Chromium's network stack rather than the page's own script — real and
  // expected once every route is deliberately blocked, so it is tracked
  // separately and never asserted empty.
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.route((url) => !url.href.startsWith(server.origin), (route) => {
    thirdPartyAttempts.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${server.origin}/news.html`, { waitUntil: "load" });
  return { context, page, thirdPartyAttempts, pageErrors };
}

/** Poll a predicate on a timer rather than a locator/waitForFunction wait —
 *  see the file header. Resolves the predicate's own truthy return value,
 *  or throws once `timeoutMs` elapses with nothing but falsy reads. */
async function waitFor(page, predicate, { timeoutMs = SEED_READY_TIMEOUT_MS, pollMs = 2000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    const result = await page.evaluate(predicate);
    if (result) return result;
  }
  throw new Error(`${label} never became true within ${timeoutMs}ms`);
}

test("loads with no page errors, fires no third-party request before start, renders all seven dashboard tiles/panels, and a synthetic start with every route blocked degrades to failure chips without erroring", async () => {
  const { context, page, thirdPartyAttempts, pageErrors } = await openPage();
  try {
    await waitFor(page, () => window.tmct?.news?.phase && window.tmct.news.phase !== "seeding", { label: "the seed-only phase" });
    assert.deepEqual(pageErrors, [], "no page error while seeding");
    assert.deepEqual(thirdPartyAttempts, [], "nothing fetched from a third party before start");
    for (const id of DASH_TILE_IDS) {
      assert.equal(await page.locator(`#${id}`).count(), 1, `#${id} renders`);
    }
    assert.equal(await page.locator("#requestLogBody tr").count(), 0, "the request log is empty before consent");
    assert.equal(await page.locator("#newsStart").innerText(), "start polling live sources");

    await page.locator("#newsStart").click();
    // start() runs one poll cycle then one enrich cycle before the button's
    // own click handler re-enables it.
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { label: "the button re-enabling once start() settles" });
    assert.deepEqual(pageErrors, [], "a fully-blocked poll+enrich cycle degrades honestly, never throws");
    const statuses = await page.locator("[data-source-status]").allInnerTexts();
    assert.ok(
      statuses.some((s) => s === "failed"),
      `at least one enabled source reads as a failed poll: ${JSON.stringify(statuses)}`,
    );
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
