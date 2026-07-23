// The research page in a real browser: one in-memory graph grows three ways
// (research a term, teach by telling, ingest documents), the highlights panels
// show what was just learned and the best-connected terms, each source lists
// its own learning history, and the "ask the graph" box is scoped by source —
// a question answered from the whole store abstains honestly once its source is
// unchecked. Drives public/research.html directly, third-party hosts blocked
// (so the research/live-Wikipedia lanes never reach the network here — the
// teach and ingest growth paths and the source-scoped ask need no network),
// the same posture pages-ingest.test.mjs holds.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const GROW_TIMEOUT_MS = 20_000;

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

async function openResearchPage({ viewport, colorScheme } = {}) {
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ...(colorScheme ? { colorScheme } : {}),
  });
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

  await page.goto(`${server.origin}/research.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.tmctResearchReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctResearchReady);
  return { context, page, consoleErrors, failedRequests };
}

/** Invented terms, never in the seed, so a grown fact is genuinely new (a seed
 *  duplicate would not change any panel). */
const TAUGHT = "a wozzle is a kind of dog";
const DOC = "A florp is a kind of animal. A florp has a tail.";

const sourceKeys = (page) =>
  page.locator('#sourcesList input[type="checkbox"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));

async function teach(page, text) {
  await page.fill("#teachInput", text);
  await page.click("#teachGo");
  await page.waitForFunction(() => /stored/i.test(document.querySelector("#teachNote")?.textContent || ""), null, { timeout: GROW_TIMEOUT_MS });
}

async function ingest(page, text) {
  await page.fill("#ingestText", text);
  await page.click("#ingestGo");
  await page.waitForFunction(() => /grounded/.test(document.querySelector("#ingestNote")?.textContent || ""), null, { timeout: GROW_TIMEOUT_MS });
}

/** Set the source checkbox for exactly `keepKeys` on, every other off, firing
 *  the change events the page's checked-set tracking listens for. */
async function scopeTo(page, keepKeys) {
  await page.evaluate((keys) => {
    for (const cb of document.querySelectorAll('#sourcesList input[type="checkbox"]')) {
      const on = keys.includes(cb.getAttribute("data-key"));
      if (cb.checked !== on) { cb.checked = on; cb.dispatchEvent(new Event("change")); }
    }
  }, keepKeys);
}

async function ask(page, q) {
  await page.fill("#askInput", q);
  await page.click("#askGo");
  await page.waitForFunction(() => !/thinking/.test(document.querySelector("#answer")?.textContent || ""), null, { timeout: GROW_TIMEOUT_MS });
  const answerEl = page.locator("#answer");
  return { text: (await answerEl.textContent()) || "", miss: await answerEl.evaluate((e) => e.classList.contains("miss")) };
}

test("the research page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openResearchPage();
  try {
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.match(await page.title(), /research/);
    assert.equal(await page.locator("#askGo").isDisabled(), false, "the ask box is live once the engine boots");
  } finally {
    await context.close();
  }
});

test("a seeded boot lists the seed corpus bands as scopeable sources", async () => {
  const { context, page } = await openResearchPage();
  try {
    const keys = await sourceKeys(page);
    assert.ok(keys.length > 2, `expected several seed sources, got ${keys.length}`);
    assert.ok(keys.every((k) => k.startsWith("seed:")), "a fresh boot has only seed sources, no session-grown ones yet");
    assert.ok(keys.includes("seed:conceptnet"), "the ConceptNet seed band is one of the scopeable sources");
  } finally {
    await context.close();
  }
});

test("teach by telling grows the graph: a taught source appears with the fact in its history and in recently-learned", async () => {
  const { context, page, consoleErrors } = await openResearchPage();
  try {
    await teach(page, TAUGHT);
    const keys = await sourceKeys(page);
    assert.ok(keys.includes("taught"), "a taught source appears once a fact is taught");

    const recent = await page.locator("#recentList .fact .subj").allInnerTexts();
    assert.ok(recent.some((s) => /^wozzles?$/.test(s)), "the taught fact shows in recently-learned");

    // textContent, not innerText: the history sits in a collapsed <details>, so
    // innerText would read empty for the hidden rows even though they are there.
    const taughtHistory = await page.locator("details.source:has(input[data-key='taught']) .srcHistory .subj").evaluateAll((els) => els.map((e) => e.textContent || ""));
    assert.ok(taughtHistory.some((s) => /^wozzles?$/.test(s)), "the taught source lists the fact it added in its own history");
    assert.deepEqual(consoleErrors, [], "teaching logs no error");
  } finally {
    await context.close();
  }
});

test("ingest documents grows the graph and reports the honest skip count", async () => {
  const { context, page } = await openResearchPage();
  try {
    await ingest(page, DOC + " How are you today?");
    assert.match(await page.locator("#ingestNote").innerText(), /3 sentences read, 2 grounded, 1 skipped/, "the question is skipped honestly, the two facts grounded");
    const keys = await sourceKeys(page);
    assert.ok(keys.includes("ingest"), "an ingest source appears once a document grounds a fact");
    const hubs = await page.locator("#hubsList .chip").count();
    assert.ok(hubs > 0, "the best-connected-terms panel fills as the graph grows");
  } finally {
    await context.close();
  }
});

test("the ask is scoped by source: a fact abstains once its own source is unchecked, and answers again with it checked", async () => {
  const { context, page } = await openResearchPage();
  try {
    await teach(page, TAUGHT);
    await ingest(page, DOC);

    // Every source checked -> the taught fact answers.
    const all = await ask(page, "what is a wozzle");
    assert.equal(all.miss, false, "with every source checked the taught fact answers");
    assert.match(all.text, /wozzle/i, "the answer names the taught subject");

    // Scope to the ingested documents only -> the taught fact is out of scope,
    // an honest miss rather than a guess.
    await scopeTo(page, ["ingest"]);
    const scopedOut = await ask(page, "what is a wozzle");
    assert.equal(scopedOut.miss, true, "scoped to ingest only, the taught fact abstains");
    assert.match(scopedOut.text, /abstain|no grounded answer/i, "the miss is worded as an abstention");

    // The ingested fact, in scope, still answers under the same ingest-only scope.
    const inScope = await ask(page, "what is a florp");
    assert.equal(inScope.miss, false, "the ingested fact answers when its own source is the checked one");
    assert.match(inScope.text, /florp/i, "the answer names the ingested subject");
  } finally {
    await context.close();
  }
});

test("reset clears the grown graph back to the seed sources", async () => {
  const { context, page } = await openResearchPage();
  try {
    await teach(page, TAUGHT);
    assert.ok((await sourceKeys(page)).includes("taught"), "the taught source is present before reset");
    await page.click("#resetBtn");
    await page.waitForFunction(() => !document.querySelector('#sourcesList input[data-key="taught"]'), null, { timeout: GROW_TIMEOUT_MS });
    const keys = await sourceKeys(page);
    assert.ok(keys.every((k) => k.startsWith("seed:")), "after reset only the seed sources remain");
    assert.equal(await page.locator("#recentList .fact").count(), 0, "recently-learned is empty again");
  } finally {
    await context.close();
  }
});

test("the research page fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await openResearchPage({ viewport: { width: 375, height: 812 }, colorScheme });
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
