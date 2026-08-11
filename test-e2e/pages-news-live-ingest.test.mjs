// news.html's real news cycle, driven in a real browser exactly as a
// visitor would run it: open the page, press "start polling live sources",
// and wait for the worker's own cycle to reach the page through its
// standing refresh loop. The rest of the deployed matrix proves the row
// round trip, the turn endpoint and the page's own markup — none of it ever
// presses this button, so a worker that fails on every real invoke can sit
// behind a fully green pipeline. This file is the one probe that presses it.
//
// Against the deployed origin (TMCT_E2E_BASE_URL) the button reaches the
// real news worker, which polls the real external feeds — a cycle can take
// a couple of minutes, so the wait below is generous and reads the page's
// own tiles, source panel and request log rather than any fixed timeout.
// With no deployed origin set, this composes the same row-service-plus-
// news-worker double test-e2e/pages-news-feed.test.mjs runs against, with
// fixture fetchers standing in for the live sources, so the wait-and-assert
// flow itself stays provable without a network.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { createLocalRowService } from "../server/row-service/local.mjs";

const DEPLOYED = Boolean(process.env.TMCT_E2E_BASE_URL);

// The button's own client-side settle-wait gives up after 20s
// (news-browser-entry.mjs's DEFAULT_CYCLE_WAIT_TIMEOUT_MS) and hands
// whatever the feed holds at that moment to the page; the standing
// feedVersion loop carries the render on from there once the worker's real
// cycle actually finishes. This budget is for that loop noticing a
// finished cycle, not for the button.
const DEPLOYED_INGEST_TIMEOUT_MS = 170_000;
const LOCAL_INGEST_TIMEOUT_MS = 15_000;
const INGEST_TIMEOUT_MS = DEPLOYED ? DEPLOYED_INGEST_TIMEOUT_MS : LOCAL_INGEST_TIMEOUT_MS;
const INGEST_POLL_MS = DEPLOYED ? 3_000 : 200;
const INTERACTION_TIMEOUT_MS = 30_000;

// The five feeds "start" actually polls by default; the three reference
// works never appear here (§9.2, kind: "kb") — a lookup, not a poll target.
const CONTEMPORARY_SOURCE_IDS = ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"];

let siteDir;
let server;
let browser;
let localService;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
  if (!DEPLOYED) {
    localService = await createLocalRowService({
      newsWorker: {
        fetchersFor: (config) => {
          const map = new Map();
          for (const id of config.sources) {
            map.set(id, {
              id,
              async fetchItems() {
                return {
                  items: [{
                    id: `${id}:0`, guid: "0", title: "A quokka has a population of 12000.",
                    url: `https://example.com/${id}/0`, summary: "", publishedAt: "", sourceId: id,
                  }],
                  bytes: 240,
                };
              },
            });
          }
          return map;
        },
      },
    });
  }
});

after(async () => {
  await browser?.close();
  await server?.close();
  await localService?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

/** Deployed: nothing but the real origin, so the button's own fetches reach
 *  the real row service through the real CloudFront `/api/*` behavior.
 *  Local self-test: the same `/api/*` proxy pattern pages-news-feed.test.mjs
 *  uses, redirecting to the composed double instead. Either way, a request
 *  to anything but this page's own origin is refused — the product's own
 *  promise that the browser never talks to a third-party host directly;
 *  only the worker, server-side, ever does. */
async function openNewsPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  if (localService) {
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const target = new URL(pathname + new URL(request.url()).search, localService.url);
      const headers = await request.allHeaders();
      delete headers.host;
      try {
        const response = await fetch(target, {
          method: request.method(),
          headers,
          body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postData(),
        });
        const body = Buffer.from(await response.arrayBuffer());
        const responseHeaders = {};
        response.headers.forEach((value, key) => { responseHeaders[key] = value; });
        await route.fulfill({ status: response.status, headers: responseHeaders, body });
      } catch {
        await route.abort("connectionfailed");
      }
    });
  }
  await page.route((url) => !url.href.startsWith(server.origin), (route) => route.abort());
  await page.goto(`${server.origin}/news.html`, { waitUntil: "load" });
  return { context, page, pageErrors };
}

async function waitFor(page, predicate, { timeoutMs = INTERACTION_TIMEOUT_MS, pollMs = 200, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate);
    if (result) return result;
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`${label} never became true within ${timeoutMs}ms`);
}

/** Polls the page's own rendered state until a real cycle has visibly
 *  landed: a fact or a card, at least one source read back as polled, and a
 *  non-empty request log — the honest ingestion signal, not a card count.
 *  A cycle where every source the worker reached errored out has nothing
 *  left to wait for, so that case stops early with every source's own
 *  status named, rather than running out the clock on a mystery timeout. */
async function waitForNewsIngestion(page, { timeoutMs, pollMs }) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await page.evaluate((ids) => {
      const factsFromNews = Number(document.querySelector("#tileFactsFromNews [data-value]")?.textContent) || 0;
      const cardCount = document.querySelectorAll("#feed .item").length;
      const requestLogRows = document.querySelectorAll("#requestLogBody tr").length;
      const sourceStatuses = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-source-id="${id}"] [data-source-status]`);
        sourceStatuses[id] = el ? el.textContent : null;
      }
      return { factsFromNews, cardCount, requestLogRows, sourceStatuses };
    }, CONTEMPORARY_SOURCE_IDS);

    const polled = Object.values(snapshot.sourceStatuses).filter((status) => status && status !== "not yet polled");
    const ingested = (snapshot.factsFromNews > 0 || snapshot.cardCount > 0) && polled.length > 0 && snapshot.requestLogRows > 0;
    if (ingested) return snapshot;

    const everyContemporarySourceReported = Object.values(snapshot.sourceStatuses).every((status) => status && status !== "not yet polled");
    const everyContemporarySourceFailed = everyContemporarySourceReported && Object.values(snapshot.sourceStatuses).every((status) => status === "failed");
    if (everyContemporarySourceFailed) {
      throw new Error(`every source errored this cycle, so no ingestion could have happened: ${JSON.stringify(snapshot.sourceStatuses)}`);
    }
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`no materialized ingestion within ${timeoutMs}ms — last read: ${JSON.stringify(snapshot)}`);
}

test("pressing start reaches a real news cycle, and stop & forget returns the page to the empty state", async () => {
  const { context, page, pageErrors } = await openNewsPage();
  try {
    await waitFor(page, () => (document.getElementById("feedCount").textContent || "").trim().length > 0, { label: "the first paint's own render" });
    assert.equal(await page.locator("#newsStart").innerText(), "start polling live sources");

    await page.locator("#newsStart").click();

    const snapshot = await waitForNewsIngestion(page, { timeoutMs: INGEST_TIMEOUT_MS, pollMs: INGEST_POLL_MS });
    assert.ok(
      snapshot.factsFromNews > 0 || snapshot.cardCount > 0,
      `no ingestion signal in either the facts-from-news tile or a rendered card: ${JSON.stringify(snapshot)}`,
    );
    assert.ok(
      Object.values(snapshot.sourceStatuses).some((status) => status && status !== "not yet polled"),
      `no source ever reported back a status: ${JSON.stringify(snapshot.sourceStatuses)}`,
    );
    assert.ok(snapshot.requestLogRows > 0, `the request log stayed empty: ${JSON.stringify(snapshot)}`);
    assert.deepEqual(pageErrors, [], "a real cycle never throws in-page");

    await page.locator("#stopForget").click();
    await waitFor(page, () => document.getElementById("stopForget").disabled === false, { label: "stop & forget settling" });

    assert.equal(await page.locator("#feed .item").count(), 0, "no card survives stop & forget");
    assert.equal(await page.locator("#newsStart").innerText(), "start polling live sources", "the page reverts to the pre-consent button label");
    assert.match(await page.locator("#feedEmpty").innerText(), /articles are gone|no news yet/);
    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.sessionKey")), null, "the session pointer is discarded, so this probe leaves nothing behind");
    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.started")), null);
  } finally {
    await context.close();
  }
});
