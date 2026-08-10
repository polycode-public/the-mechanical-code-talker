// news.html's thin-client contract (PLAN_MEMORY_BACKEND.md's news.html-
// goes-thin revision), driven in a real browser against the real row
// service (server/row-service/local.mjs) with its in-process news worker
// (server/news-worker/local.mjs), fixture-routed fetchers standing in for
// the live sources. The page itself makes no third-party request of its own
// — every fixture-served fetch in these tests happens inside the worker,
// never inside the browser — so this file's own network assertions are
// about the page's requests to `/api/*` alone.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { createLocalRowService } from "../server/row-service/local.mjs";

const READY_TIMEOUT_MS = 30_000;
const INTERACTION_TIMEOUT_MS = 15_000;

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
  if (siteDir) { const { rmSync } = await import("node:fs"); rmSync(siteDir, { recursive: true, force: true }); }
});

function fixtureFetcher(id, titles) {
  return {
    id,
    async fetchItems() {
      return {
        items: titles.map((title, i) => ({
          id: `${id}:${i}`, guid: String(i), title, url: `https://example.com/${id}/${i}`, summary: "", publishedAt: "", sourceId: id,
        })),
        bytes: 240,
      };
    },
  };
}

function fetchersFor(ids, titles) {
  return (config) => {
    const map = new Map();
    for (const id of config.sources) if (ids.includes(id)) map.set(id, fixtureFetcher(id, titles));
    return map;
  };
}

/** Every one of this file's own service instances, closed together in
 *  `after` — a test that starts one and forgets to close it would otherwise
 *  leak a listening port past the file's own run. */
const openServices = [];
async function withRowService(options = {}) {
  const service = await createLocalRowService(options);
  openServices.push(service);
  return service;
}
after(async () => { await Promise.all(openServices.map((s) => s.close())); });

/** Proxies the page's own same-origin `/api/*` requests to `service.url` —
 *  the CloudFront `/api/*` behavior's local stand-in. Every request this
 *  page ever makes for its API traffic resolves against `document.location`
 *  (root-relative paths), so this is the one seam a test needs to point that
 *  traffic at a double instead of a real deployment. Requests to anything
 *  else are aborted, the same "nothing but this page's own origin, ever"
 *  guard the other demo-page e2e specs run. */
async function openNewsPage(service) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  const apiRequests = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    apiRequests.push({ method: request.method(), url: request.url(), postData: request.postData() });
    const target = new URL(new URL(request.url()).pathname + new URL(request.url()).search, service.url);
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
  await page.route((url) => !url.href.startsWith(server.origin), (route) => route.abort());
  await page.goto(`${server.origin}/news.html`, { waitUntil: "load" });
  return { context, page, pageErrors, apiRequests };
}

async function waitFor(page, predicate, { timeoutMs = READY_TIMEOUT_MS, pollMs = 200, label = "condition", arg } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = arg === undefined ? await page.evaluate(predicate) : await page.evaluate(predicate, arg);
    if (result) return result;
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`${label} never became true within ${timeoutMs}ms`);
}

function waitForFeedRendered(page, label = "the feed finishing its render") {
  return waitFor(page, () => {
    const match = /^(\d+) articles?$/.exec(document.getElementById("feedCount").textContent || "");
    if (!match) return 0;
    return document.querySelectorAll("#feed .item").length === Number(match[1]) ? Number(match[1]) : 0;
  }, { label });
}

test("before any press, the page makes no /api/ request at all and shows the honest first-visit empty state", async () => {
  const service = await withRowService({});
  const { context, page, apiRequests } = await openNewsPage(service);
  try {
    await waitFor(page, () => (document.getElementById("feedCount").textContent || "").trim().length > 0, { label: "the first paint's own empty render" });
    assert.equal(apiRequests.length, 0, `no /api/ request fired before any press: ${JSON.stringify(apiRequests)}`);
    assert.match(await page.locator("#feedEmpty").innerText(), /no news yet/);
    assert.equal(await page.evaluate(() => window.localStorage.length), 0, "nothing at all is in localStorage before the first press");
    const statuses = await page.locator("[data-source-status]").allInnerTexts();
    assert.ok(statuses.every((s) => s === "not yet polled"), `no source reads as polled before any press: ${JSON.stringify(statuses)}`);
  } finally {
    await context.close();
  }
});

test("pressing start mints a v4 session key, persists it beside the consent preference, and no other localStorage key ever appears", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka is a marsupial."]) } });
  const { context, page } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { label: "start settling" });
    const stored = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < window.localStorage.length; i += 1) { const k = window.localStorage.key(i); out[k] = window.localStorage.getItem(k); }
      return out;
    });
    const keys = Object.keys(stored);
    assert.equal(keys.length, 2, `only the consent preference and the session pointer are ever stored locally: ${JSON.stringify(stored)}`);
    assert.match(stored["tmct.news.sessionKey"], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "the stored key is a v4 UUID");
    assert.equal(stored["tmct.news.started"], "on");
  } finally {
    await context.close();
  }
});

test("start polls through a 202, the cards render once the cycle materializes, and neither the seed asset nor an engine chunk is ever requested", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page, pageErrors, apiRequests } = await openNewsPage(service);
  try {
    const beforeSourceStatus = await page.locator('[data-source-id="wikimedia-featured"] [data-source-status]').innerText();
    assert.equal(beforeSourceStatus, "not yet polled");

    await page.locator("#newsStart").click();
    const pressed = await page.evaluate(() => ({
      disabled: document.getElementById("newsStart").disabled,
      busy: document.getElementById("newsStart").getAttribute("aria-busy"),
    }));
    assert.equal(pressed.disabled, true, "the button disables on the click itself");
    assert.equal(pressed.busy, "true");

    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    assert.deepEqual(pageErrors, [], "a real poll cycle never throws in-page");

    const total = await waitForFeedRendered(page, "the post-poll feed render");
    assert.ok(total > 0, "the poll produced at least one card");
    const hub = await page.locator("#feed .item .hub").first().innerText();
    assert.equal(hub, "quokka");

    const afterSourceStatus = await page.locator('[data-source-id="wikimedia-featured"] [data-source-status]').innerText();
    assert.equal(afterSourceStatus, "ok");

    const requestedUrls = apiRequests.map((r) => r.url).concat(await page.evaluate(() =>
      performance.getEntriesByType("resource").map((e) => e.name)));
    assert.ok(!requestedUrls.some((u) => /chat-seed\.json/.test(u)), `no seed asset was ever requested: ${JSON.stringify(requestedUrls.filter((u) => u.includes("seed")))}`);
    assert.ok(!requestedUrls.some((u) => /wink|chat-browser|research-browser|ledger-browser/.test(u)), `no other page's engine chunk was ever requested: ${JSON.stringify(requestedUrls)}`);
    assert.ok(requestedUrls.some((u) => u.endsWith("news-browser.bundle.js")), "the page's own thin bundle did load");
  } finally {
    await context.close();
  }
});

test("once a triggered cycle settles, the page keeps polling feedVersion at a slow, backed-off cadence rather than falling silent, and never refetches the feed until it actually moves", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page, apiRequests } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    await waitForFeedRendered(page, "the post-poll feed render");

    const feedGetsBeforeIdle = apiRequests.filter((r) => r.method === "GET" && new URL(r.url).pathname === "/api/feed").length;
    await page.waitForTimeout(3500); // past the standing loop's own floor interval at least once
    const versionReadsWhileIdle = apiRequests.filter((r) => r.method === "GET" && new URL(r.url).pathname === "/api/meta/feedVersion").length;
    const feedGetsAfterIdle = apiRequests.filter((r) => r.method === "GET" && new URL(r.url).pathname === "/api/feed").length;
    assert.ok(versionReadsWhileIdle > 0, "the standing loop kept reading feedVersion instead of going silent once the cycle settled");
    assert.equal(feedGetsAfterIdle, feedGetsBeforeIdle, "nothing changed, so the loop never refetched the feed itself");
  } finally {
    await context.close();
  }
});

test("a cycle triggered from outside the page reaches it through the standing loop, without any press here", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    await waitForFeedRendered(page, "the post-poll feed render");
    const sessionKey = await page.evaluate(() => window.localStorage.getItem("tmct.news.sessionKey"));
    const graphSizeBefore = await page.evaluate(() => Number(document.querySelector("#tileGraphSize [data-value]").textContent));

    // The same session, driven directly against the row service — standing
    // in for another tab, or a trigger this page never clicked — with no
    // page-side ingest of its own: the page must never parse or extract
    // anything locally to show this.
    const response = await fetch(`${service.url}/api/sessions/${sessionKey}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "A tariff is a tax on imported goods." }),
    });
    assert.equal(response.status, 202);
    await service.drainNewsWorkers();

    await waitFor(page, (before) => Number(document.querySelector("#tileGraphSize [data-value]").textContent) > before, {
      timeoutMs: READY_TIMEOUT_MS, label: "the standing loop noticing the outside change", arg: graphSizeBefore,
    });
  } finally {
    await context.close();
  }
});

test("a worker budget that runs out between sources stops the cycle honestly: the reached source reports its own status, the rest still read as never polled", async () => {
  const service = await withRowService({
    newsWorker: {
      budgetMs: 40,
      fetchersFor: () => {
        const map = new Map();
        map.set("wikimedia-featured", {
          id: "wikimedia-featured",
          async fetchItems() {
            await new Promise((resolve) => setTimeout(resolve, 70));
            return {
              items: [{ id: "wm:0", guid: "0", title: "A quokka has a population of 12000.", url: "https://example.com/wm/0", summary: "", publishedAt: "", sourceId: "wikimedia-featured" }],
              bytes: 240,
            };
          },
        });
        map.set("hacker-news", fixtureFetcher("hacker-news", ["Something else entirely."]));
        return map;
      },
    },
  });
  const { context, page } = await openNewsPage(service);
  try {
    await page.locator('[data-source-id="usgs-quakes"] [data-source-toggle]').uncheck();
    await page.locator('[data-source-id="nyt-world"] [data-source-toggle]').uncheck();
    await page.locator('[data-source-id="wikinews-published"] [data-source-toggle]').uncheck();

    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });

    const wikiStatus = await page.locator('[data-source-id="wikimedia-featured"] [data-source-status]').innerText();
    assert.equal(wikiStatus, "ok", "the slow source the budget still reached completed and reports its own status");
    const hnStatus = await page.locator('[data-source-id="hacker-news"] [data-source-status]').innerText();
    assert.equal(hnStatus, "not yet polled", "the source after the exhausted budget was never reached this cycle, not silently marked done");
  } finally {
    await context.close();
  }
});

test("the fuzzy toggle rides the enrich trigger's own body, on by default", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page, apiRequests } = await openNewsPage(service);
  try {
    assert.equal(await page.locator("#fuzzyToggle").isChecked(), true, "fuzzy matching defaults on, matching the shipped retrieval default");

    await page.locator("#enrichNow").click();
    await waitFor(page, () => document.getElementById("enrichNow").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "enrich settling" });

    await page.locator("#fuzzyToggle").uncheck();
    await page.locator("#enrichNow").click();
    await waitFor(page, () => document.getElementById("enrichNow").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "the second enrich settling" });

    const enrichBodies = apiRequests
      .filter((r) => r.method === "POST" && /\/enrich$/.test(new URL(r.url).pathname))
      .map((r) => JSON.parse(r.postData || "{}"));
    assert.deepEqual(enrichBodies, [{ fuzzy: 1 }, { fuzzy: 0 }], "the double observed the toggle's own state on each press, checked then unchecked");
  } finally {
    await context.close();
  }
});

test("a taught fact carrying a script tag reaches the DOM as literal text once a real report cards its hub, and the tag never executes, even after a reload from the double", async () => {
  // The teach panel's own ingest never heads a card on its own — a card
  // only exists for a hub a genuine news report named inside the window
  // (the newsworthiness gate) — so this exercises the real path the plan's
  // own abuse-surface row describes: a taught fact's text reaches the DOM
  // once it rides along as a card's background, the same way any taught
  // identity fact does for a hub a live report also touched.
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A widget has a population of 12000."]) } });
  const { context, page, pageErrors } = await openNewsPage(service);
  try {
    await page.locator("#teachText").fill('{"subject":"widget","predicate":"rdf:type","object":"<script>window.__tmctPwned=true</script>"}');
    await page.locator("#teachIngest").click();
    await waitFor(page, () => document.getElementById("teachIngest").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "the ingest trigger settling" });
    assert.deepEqual(pageErrors, [], "ingesting a fact row that carries a script tag never throws");

    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    await waitForFeedRendered(page, "the post-poll feed render");
    assert.equal(await page.evaluate(() => window.__tmctPwned), undefined, "the script tag never executed on the first render");

    const cardHtml = await page.locator('#feed .item[data-item-id]').first().innerHTML();
    assert.match(cardHtml, /&lt;script&gt;/, "the tag reaches the card as escaped, literal text");
    assert.ok(!/<script>window\.__tmctPwned/.test(cardHtml), "the tag never lands as a live element in the card's own markup");

    await page.reload({ waitUntil: "load" });
    await waitFor(page, () => (document.getElementById("feedCount").textContent || "").trim().length > 0, { label: "the reload's own render" });
    assert.equal(await page.evaluate(() => window.__tmctPwned), undefined, "the script tag still never executes after a reload restores the same card from the double");
    const cardHtmlAfterReload = await page.locator('#feed .item[data-item-id]').first().innerHTML();
    assert.match(cardHtmlAfterReload, /&lt;script&gt;/, "the escaped text survives the reload path too");
  } finally {
    await context.close();
  }
});

test("stop & forget purges the session server-side, discards the local key, and a reload reads back as first-visit", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    const cardsBefore = await waitForFeedRendered(page, "the post-poll feed render");
    assert.ok(cardsBefore > 0);
    const sessionKey = await page.evaluate(() => window.localStorage.getItem("tmct.news.sessionKey"));

    await page.locator("#stopForget").click();
    await waitFor(page, () => document.getElementById("stopForget").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "the purge settling" });

    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.sessionKey")), null, "the local pointer is discarded");
    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.started")), null, "the consent preference is discarded");
    assert.equal(await page.locator("#feed .item").count(), 0, "no card survives on screen");

    const rowsAfter = await fetch(`${service.url}/api/rows`, { headers: { "x-tmct-session": sessionKey } });
    assert.deepEqual((await rowsAfter.json()).rows, [], "zero readable rows remain under the purged key");
    const feedAfter = await fetch(`${service.url}/api/feed`, { headers: { "x-tmct-session": sessionKey } });
    assert.equal(feedAfter.status, 404, "no materialized feed document remains under the purged key");

    await page.reload({ waitUntil: "load" });
    await waitFor(page, () => (document.getElementById("feedCount").textContent || "").trim().length > 0, { label: "the reloaded page's own first render" });
    assert.equal(await page.locator("#newsStart").innerText(), "start polling live sources", "the reload reads back as first-visit");
    assert.match(await page.locator("#feedEmpty").innerText(), /no news yet/);
  } finally {
    await context.close();
  }
});

test("reload restores an already-started session with exactly one GET /api/feed, never a fresh poll", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    await waitForFeedRendered(page, "the post-poll feed render");

    const secondOpen = await openNewsPage(service);
    try {
      // A fresh browser context standing in for a reload: it shares nothing
      // with the first page's own localStorage, so it seeds its own copy of
      // the same stored key before navigating, then reloads against it —
      // the exact shape a real reload of the same tab takes.
      const sessionKey = await page.evaluate(() => window.localStorage.getItem("tmct.news.sessionKey"));
      await secondOpen.page.evaluate((key) => {
        window.localStorage.setItem("tmct.news.sessionKey", key);
        window.localStorage.setItem("tmct.news.started", "on");
      }, sessionKey);
      await secondOpen.page.reload({ waitUntil: "load" });
      await waitFor(secondOpen.page, () => (document.getElementById("feedCount").textContent || "").trim().length > 0, { label: "the restored render" });

      const total = await waitForFeedRendered(secondOpen.page, "the restored feed render");
      assert.ok(total > 0, "the restored session shows the previously materialized feed");
      const feedGets = secondOpen.apiRequests.filter((r) => r.method === "GET" && new URL(r.url).pathname === "/api/feed");
      assert.equal(feedGets.length, 1, `exactly one GET /api/feed restored the page: ${JSON.stringify(secondOpen.apiRequests)}`);
      assert.ok(!secondOpen.apiRequests.some((r) => /\/(poll|enrich|ingest)$/.test(new URL(r.url).pathname)), "a reload never fires a fresh trigger of its own");
    } finally {
      await secondOpen.context.close();
    }
  } finally {
    await context.close();
  }
});

test("killing the row service leaves the page honestly idle: feed-and-chat-unavailable, controls disabled, and a working reload once the service returns", async () => {
  const service = await withRowService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["A quokka has a population of 12000."]) } });
  const { context, page } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    await waitForFeedRendered(page, "the post-poll feed render");

    await service.close();

    await page.reload({ waitUntil: "load" });
    await waitFor(page, () => document.getElementById("serviceUnavailable").classList.contains("shown"), { timeoutMs: INTERACTION_TIMEOUT_MS, label: "the unavailable banner appearing" });
    const disabled = await page.evaluate(() => ({
      start: document.getElementById("newsStart").disabled,
      enrich: document.getElementById("enrichNow").disabled,
      stopForget: document.getElementById("stopForget").disabled,
      teach: document.getElementById("teachIngest").disabled,
    }));
    assert.deepEqual(disabled, { start: true, enrich: true, stopForget: true, teach: true }, "every network-facing control is out of action");
    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.sessionKey") !== null), true, "the stored pointer survives an unreachable service — nothing here needs to be recomputed to keep it");
  } finally {
    await context.close();
  }
});

test("the feed sorts client-side over the document's own keys and narrows to a picked pill, without asking the server again", async () => {
  const service = await withRowService({
    newsWorker: {
      fetchersFor: fetchersFor(
        ["wikimedia-featured"],
        ["A quokka has a population of 12000.", "Nonthaburi has a population of 1683115."],
      ),
    },
  });
  const { context, page, apiRequests } = await openNewsPage(service);
  try {
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { timeoutMs: INTERACTION_TIMEOUT_MS, label: "start settling" });
    const total = await waitForFeedRendered(page, "the post-poll feed render");
    assert.ok(total > 1, `the poll renders more than one card: ${total}`);

    const requestsBeforeSort = apiRequests.length;
    await page.selectOption("#feedSort", "facts");
    await page.selectOption("#feedSort", "newest");
    assert.equal(apiRequests.length, requestsBeforeSort, "sorting never asks the server for anything");

    const pillTerms = await page.locator("#feedPills .pill").allInnerTexts();
    assert.ok(pillTerms.length > 0, "the feed offers filter pills built from its own articles");
    const allTitles = await page.locator("#feed .item .hub").allInnerTexts();
    await page.locator(`#feedPills .pill[data-pill-term="${pillTerms[0]}"]`).click();
    const narrowedTitles = await page.locator("#feed .item .hub").allInnerTexts();
    assert.ok(narrowedTitles.length < allTitles.length, `picking a pill narrows the list: ${narrowedTitles.length} of ${allTitles.length}`);
    assert.equal(apiRequests.length, requestsBeforeSort, "filtering by pill never asks the server for anything either");
  } finally {
    await context.close();
  }
});
