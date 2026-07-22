// The ledger page's research row, driven in a real browser against
// fixture-served simple.wikipedia.org endpoints (no test touches the real
// site). Entering a topic runs "research <topic>" through the SAME live dock
// session a typed line uses, the auto-play ticker submits "research next"
// turns one by one (each its own dock line, exactly as if the visitor asked
// each search), and every step that grounds facts re-derives the page's own
// fact table/stat tiles live — the same refresh a successful teach performs.
// With the network blocked the failure reads as a plain dock miss and the
// ledger is left untouched.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const TURN_TIMEOUT_MS = 20_000;
// A default-limit run over the three fixture links is depth 0 plus three
// steps, each paced by the adapter's polite 2s interval and the 2.4s tick.
const RUN_TIMEOUT_MS = 60_000;

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

async function openLedgerPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const thirdPartyAttempts = [];

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(server.origin)) return route.continue();
    thirdPartyAttempts.push(url);
    return route.abort();
  });

  await page.goto(`${server.origin}/ledger.html`, { waitUntil: "networkidle" });
  await page.locator("#chatform").waitFor({ state: "visible" });
  return { context, page, thirdPartyAttempts };
}

const SUMMARIES = {
  Quokka: { title: "Quokka", extract: "A quokka is a small marsupial. Quokkas live in Australia.", revision: "201", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Quokka" } } },
  Marsupial: { title: "Marsupial", extract: "A marsupial is an animal. Marsupials carry their young in a pouch.", revision: "202", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Marsupial" } } },
  Australia: { title: "Australia", extract: "Australia is a country. It is also a continent.", revision: "203", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Australia" } } },
};

async function routeSimpleWikipedia(page) {
  await page.route("https://simple.wikipedia.org/**", (route) => {
    const url = route.request().url();
    let body;
    if (url.includes("action=opensearch")) {
      body = JSON.stringify(["quokka", ["Quokka"], [""], [""]]);
    } else if (url.includes("action=parse")) {
      body = JSON.stringify({ parse: { links: [
        { ns: 0, exists: true, title: "Marsupial" },
        { ns: 0, exists: true, title: "Australia" },
      ] } });
    } else {
      const title = decodeURIComponent(url.split("/summary/")[1] || "");
      const summary = SUMMARIES[title];
      if (!summary) return route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
      body = JSON.stringify(summary);
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
  });
}

test("the research row runs the queue through the dock — cited turns, auto-played steps, and a live ledger re-derivation", async () => {
  const { context, page } = await openLedgerPage();
  try {
    await routeSimpleWikipedia(page);
    const totalBefore = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());

    await page.fill("#researchTopic", "quokka");
    await page.click("#researchGo");

    // The depth-0 turn lands as its own dock exchange: the "research quokka"
    // user line the row submitted, then the cited reply.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#chatlog > div.u")).some((d) => d.textContent.includes("research quokka")),
      null,
      { timeout: TURN_TIMEOUT_MS },
    );
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#chatlog > div.a")).some((d) => /research article "Quokka", Simple English Wikipedia/.test(d.textContent)),
      null,
      { timeout: TURN_TIMEOUT_MS },
    );

    // Auto-play walks the two linked topics as separate turns and reports
    // completion in the LAST step's own line.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#chatlog > div.a")).some((d) => /research on "quokka" is complete/.test(d.textContent)),
      null,
      { timeout: RUN_TIMEOUT_MS },
    );
    const nextLines = await page.evaluate(
      () => Array.from(document.querySelectorAll("#chatlog > div.u")).filter((d) => d.textContent.includes("research next")).length,
    );
    assert.equal(nextLines, 2, "each queued topic was asked as its own dock turn");
    assert.match(await page.locator("#researchStatus").innerText(), /research "quokka" complete/);

    // The page's own dashboard re-derived from the grown store — the same
    // live refresh a successful teach performs.
    const totalAfter = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    assert.ok(totalAfter > totalBefore, `the fact count grew (${totalBefore} -> ${totalAfter})`);
    const hasQuokka = await page.evaluate(() => LEDGER.terms.some((t) => t.term === "quokka"));
    assert.equal(hasQuokka, true, "the term index now carries the researched topic");

    // And the dock answers from what it just researched.
    const replies = page.locator("#chatlog > div.a");
    const seen = await replies.count();
    await page.fill("#chatq", "what is a quokka");
    await page.press("#chatq", "Enter");
    await page.waitForFunction((n) => document.querySelectorAll("#chatlog > div.a").length > n, seen, { timeout: TURN_TIMEOUT_MS });
    assert.match(await replies.last().textContent(), /quokka is a kind of marsupial/);
  } finally {
    await context.close();
  }
});

test("with the network blocked the research row reports a plain dock miss and leaves the ledger untouched", async () => {
  const { context, page, thirdPartyAttempts } = await openLedgerPage();
  try {
    const totalBefore = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    await page.fill("#researchTopic", "quokka");
    await page.click("#researchGo");
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#chatlog > div.a")).some((d) => /couldn't ground "quokka" from Simple English Wikipedia/.test(d.textContent)),
      null,
      { timeout: TURN_TIMEOUT_MS },
    );
    const missClassed = await page.evaluate(
      () => Array.from(document.querySelectorAll("#chatlog > div.a.miss")).some((d) => /couldn't ground/.test(d.textContent)),
    );
    assert.equal(missClassed, true, "the failure carries the dock's own miss treatment");
    assert.ok(thirdPartyAttempts.some((u) => u.includes("simple.wikipedia.org")), "the explicit request did try the network");
    assert.equal(await page.locator("#researchPlay").isHidden(), true, "no queue survives a failed start");
    const totalAfter = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    assert.equal(totalAfter, totalBefore, "nothing was stored");
  } finally {
    await context.close();
  }
});
