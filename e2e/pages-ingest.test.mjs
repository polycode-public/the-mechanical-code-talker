// The ingest page in a real browser: it loads clean, pasted text is ground
// into canonical facts live in the right pane, the honest skip count is
// reported, the canonical facts download as JSONL, and the page survives a
// phone-sized viewport in both color schemes. Drives public/ingest.html
// directly, third-party hosts blocked, the same posture pages-ledger.test.mjs
// holds.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;

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

/** Open ingest.html with third-party hosts blocked. Returns the page plus what
 *  it logged and what it failed to fetch, and waits for the engine to boot. */
async function openIngestPage({ viewport, colorScheme } = {}) {
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
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/ingest.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.tmctIngestReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctIngestReady);
  return { context, page, consoleErrors, failedRequests };
}

const SAMPLE = "A beagle is a kind of dog. How are you today? A dog is a kind of animal.";

test("the ingest page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openIngestPage();
  try {
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.match(await page.title(), /ingest/);
    assert.equal(await page.locator("#ingestBtn").isDisabled(), true, "ingest stays disabled until there is text");
  } finally {
    await context.close();
  }
});

test("pasted text grounds into canonical facts live, and the honest skip count is reported", async () => {
  const { context, page, consoleErrors } = await openIngestPage();
  try {
    await page.fill("#source", SAMPLE);
    assert.equal(await page.locator("#ingestBtn").isDisabled(), false, "text enables the ingest button");

    await page.locator("#ingestBtn").click();
    await page.waitForFunction(() => document.querySelectorAll("#facts .fact").length >= 2, null, { timeout: READY_TIMEOUT_MS });

    const rows = await page.locator("#facts .fact").evaluateAll((els) => els.map((el) => ({
      subject: el.querySelector(".subj")?.textContent ?? "",
      predicate: el.querySelector(".pred")?.textContent ?? "",
      object: el.querySelector(".obj")?.textContent ?? "",
    })));
    assert.equal(rows.length, 2, "two of the three sentences ground; the question is skipped");
    assert.ok(rows.some((r) => r.subject === "beagle" && r.object === "dog"), "beagle is a kind of dog is grounded");
    assert.ok(rows.some((r) => r.subject === "dog" && r.object === "animal"), "dog is a kind of animal is grounded");
    for (const r of rows) assert.equal(r.predicate, "rdfs:subClassOf", "each row renders its canonical predicate");

    assert.match(await page.locator("#factCount").innerText(), /2 facts/, "the pane counts the grounded facts");
    assert.match(
      await page.locator("#status").innerText(),
      /3 sentences read, 2 grounded, 1 skipped/,
      "the skip is reported honestly, never hidden or guessed at",
    );
    assert.deepEqual(consoleErrors, [], "grounding logs no error");
  } finally {
    await context.close();
  }
});

test("the canonical facts download as JSONL in the extract shape", async () => {
  const { context, page } = await openIngestPage();
  try {
    await page.fill("#source", SAMPLE);
    await page.locator("#ingestBtn").click();
    await page.waitForFunction(() => document.querySelectorAll("#facts .fact").length >= 2, null, { timeout: READY_TIMEOUT_MS });
    assert.equal(await page.locator("#downloadBtn").isDisabled(), false, "grounded facts enable the download");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#downloadBtn").click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");

    const lines = body.split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "one JSONL line per grounded fact");
    const records = lines.map((l) => JSON.parse(l));
    for (const rec of records) {
      assert.ok(rec.subject && rec.predicate && rec.object, "each line carries a full triple");
      assert.equal(typeof rec.provenance, "string", "each line names its provenance");
    }
    assert.ok(records.some((r) => r.subject === "beagle" && r.object === "dog"), "the download carries the grounded triple");
  } finally {
    await context.close();
  }
});

test("clear empties the input and the facts pane", async () => {
  const { context, page } = await openIngestPage();
  try {
    await page.fill("#source", SAMPLE);
    await page.locator("#ingestBtn").click();
    await page.waitForFunction(() => document.querySelectorAll("#facts .fact").length >= 2, null, { timeout: READY_TIMEOUT_MS });

    await page.locator("#clearBtn").click();
    assert.equal(await page.locator("#source").inputValue(), "", "the input clears");
    assert.equal(await page.locator("#facts .fact").count(), 0, "the facts pane clears");
    assert.equal(await page.locator("#facts .empty").count(), 1, "the empty note returns");
    assert.equal(await page.locator("#downloadBtn").isDisabled(), true, "download disables again");
  } finally {
    await context.close();
  }
});

test("the mode pills switch between Text and Document, and Document reveals the browse control", async () => {
  const { context, page } = await openIngestPage();
  try {
    assert.equal(await page.locator("#modeText").getAttribute("aria-pressed"), "true", "Text is the default mode");
    await page.locator("#modeDoc").click();
    assert.equal(await page.locator("#modeDoc").getAttribute("aria-pressed"), "true", "Document becomes active");
    assert.equal(await page.locator("#browseBtn").isVisible(), true, "Document mode shows the browse control");
  } finally {
    await context.close();
  }
});

test("the ingest page fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await openIngestPage({ viewport: { width: 375, height: 812 }, colorScheme });
    try {
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
