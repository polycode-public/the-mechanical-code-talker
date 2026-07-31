// The standalone code-explorer page in a real browser: the IDE shell loads
// clean and fills the viewport without page scroll, the explorer ledger and
// hint rail render from the demo code graph embedded in the page, clicking a
// hint (or submitting its text through the chat form) reaches a real answer
// over the live browser bundle, and the chat's general-knowledge seed loads
// lazily — answering "what is a dog" beside the graph lanes — or degrades to
// graph-only with a status note when the seed asset is unavailable. The
// embedded-in-the-homepage-card path is pages-home.test.mjs's job; this file
// drives public/code.html directly, mirroring pages-ledger.test.mjs.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 20_000;

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

/** Open code.html with third-party hosts blocked, same posture as every
 *  sibling page test in this suite. `blockSeed` also aborts the same-origin
 *  chat-seed.json fetch, for the graph-only degrade path. Returns the page
 *  plus what it logged and what it failed to fetch. */
async function openCodePage({ blockSeed = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];

  await page.route("**/*", (route) => {
    if (blockSeed && route.request().url().includes("chat-seed.json")) return route.abort();
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

  await page.goto(`${server.origin}/code.html`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors, failedRequests };
}

test("the code-explorer page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openCodePage();
  try {
    await page.locator("#ledger .row").first().waitFor({ state: "visible" });
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.equal(await page.title(), "tmct code explorer");
  } finally {
    await context.close();
  }
});

test("the ledger rows render from the embedded demo code graph, focused on a real symbol", async () => {
  const { context, page } = await openCodePage();
  try {
    await page.locator("#ledger .row").first().waitFor({ state: "visible" });
    const rowCount = await page.locator("#ledger .row").count();
    assert.ok(rowCount > 0, "the demo code graph renders real edge rows");
    const rowClasses = await page.locator("#ledger .row").evaluateAll((els) => els.map((el) => el.className));
    assert.ok(rowClasses.every((cls) => !cls.includes("muted")), "no row falls back to the empty-graph placeholder");

    const focus = await page.locator("#focus-name").innerText();
    assert.ok(focus && focus !== "—", "a real focus symbol from the graph is shown");
    const stats = await page.locator("#stats").innerText();
    assert.match(stats, /\d+ individuals/, "the stats strip reports a real individual count");
    assert.match(stats, /\d+ edges/, "the stats strip reports a real edge count");

    // The general-knowledge seed loads lazily and can land before this check
    // runs, so the pill is the graph's own edges PLUS whatever seed count (if
    // any) the status line already shows — never less than the edges alone.
    const edgeCount = Number((stats.match(/(\d+) edges/) || [])[1]);
    const seedStatus = await page.locator("#seed-status").innerText();
    const seedFactsSoFar = Number((seedStatus.match(/general knowledge: (\d+) facts/) || [])[1]) || 0;
    const factTotal = Number((await page.locator("#fact-total-value").innerText()).replace(/[^\d]/g, ""));
    assert.equal(factTotal, edgeCount + seedFactsSoFar, "the fact-total pill is exactly the graph's edges plus whatever seed count has landed so far");
  } finally {
    await context.close();
  }
});

test("the hint rail suggests real next questions drawn from the graph", async () => {
  const { context, page } = await openCodePage();
  try {
    await page.locator(".hint").first().waitFor({ state: "visible" });
    const hintCount = await page.locator(".hint").count();
    assert.ok(hintCount > 0, "the graph yields at least one suggested question");
    const firstHint = (await page.locator(".hint").first().innerText()).trim();
    assert.ok(firstHint.length > 0, "the hint carries real question text, not a placeholder");
  } finally {
    await context.close();
  }
});

test("clicking a hint reaches a real dock answer over the live bundle", async () => {
  const { context, page } = await openCodePage();
  try {
    await page.locator(".hint").first().waitFor({ state: "visible" });
    const hintText = await page.locator(".hint").first().getAttribute("data-q");
    await page.locator(".hint").first().click();

    await page.locator("#chat-log .turn-tmct").first().waitFor({ timeout: READY_TIMEOUT_MS });
    assert.equal(
      (await page.locator("#chat-log .turn-you").first().innerText()).includes(hintText),
      true,
      "the clicked hint's own text is echoed as the visitor's turn",
    );
    const answer = await page.locator("#chat-log .turn-tmct .said").first().innerText();
    assert.ok(answer.length > 0, "the chat returns a real answer, not a blank turn");
    assert.doesNotMatch(answer, /the live chat is not loaded on this page/, "the live bundle answered, not the static-view fallback");
  } finally {
    await context.close();
  }
});

test("submitting a hint's text through the chat form reaches the same live answer path", async () => {
  const { context, page } = await openCodePage();
  try {
    await page.locator(".hint").first().waitFor({ state: "visible" });
    const question = await page.locator(".hint").first().getAttribute("data-q");

    await page.fill("#chat-input", question);
    await page.press("#chat-input", "Enter");

    await page.locator("#chat-log .turn-tmct").first().waitFor({ timeout: READY_TIMEOUT_MS });
    const answer = await page.locator("#chat-log .turn-tmct .said").first().innerText();
    assert.ok(answer.length > 0, "a manually submitted question also reaches a real answer");
  } finally {
    await context.close();
  }
});

test("the shell fills the viewport: the document itself never scrolls, in either direction", async () => {
  const { context, page } = await openCodePage();
  try {
    await page.locator("#ledger .row").first().waitFor({ state: "visible" });
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
        scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight,
      };
    });
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, "no sideways page scroll");
    assert.ok(overflow.scrollHeight <= overflow.clientHeight + 1, "no vertical page scroll — panels scroll internally");
  } finally {
    await context.close();
  }
});

test("the general-knowledge seed loads with a visible status, and one session answers a seeded question beside a graph question", async () => {
  const { context, page } = await openCodePage();
  try {
    await page.locator("#ledger .row").first().waitFor({ state: "visible" });
    const stats = await page.locator("#stats").innerText();
    const edgeCount = Number((stats.match(/(\d+) edges/) || [])[1]);

    await page.waitForFunction(
      () => /general knowledge: \d+ facts/.test(document.getElementById("seed-status")?.textContent || ""),
      null,
      { timeout: 60_000 },
    );
    const seedStatus = await page.locator("#seed-status").innerText();
    const seedFacts = Number((seedStatus.match(/general knowledge: (\d+) facts/) || [])[1]);
    const factTotal = Number((await page.locator("#fact-total-value").innerText()).replace(/[^\d]/g, ""));
    assert.equal(factTotal, edgeCount + seedFacts, "once the seed lands, the fact-total pill adds the seed's own count to the graph's edges");

    await page.fill("#chat-input", "what is a dog");
    await page.press("#chat-input", "Enter");
    await page.locator("#chat-log .turn-tmct").first().waitFor({ timeout: 60_000 });
    const seededAnswer = await page.locator("#chat-log .turn-tmct .said").first().innerText();
    assert.match(seededAnswer, /dog is a kind of animal/, "a question the code graph cannot ground answers from the seed");

    const hintText = await page.locator(".hint").first().getAttribute("data-q");
    await page.locator(".hint").first().click();
    await page.waitForFunction(
      () => document.querySelectorAll("#chat-log .turn-tmct").length >= 2,
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    const graphAnswer = await page.locator("#chat-log .turn-tmct .said").nth(1).innerText();
    assert.ok(graphAnswer.length > 0, `the same session still answers the graph question "${hintText}"`);
    assert.doesNotMatch(graphAnswer, /this repo has no code graph/, "the code graph stayed registered beside the seed");
  } finally {
    await context.close();
  }
});

test("a missing seed degrades to graph-only chat with a status note, never a broken page", async () => {
  const { context, page } = await openCodePage({ blockSeed: true });
  try {
    await page.waitForFunction(
      () => /graph-only/.test(document.getElementById("seed-status")?.textContent || ""),
      null,
      { timeout: READY_TIMEOUT_MS },
    );

    await page.locator(".hint").first().waitFor({ state: "visible" });
    await page.locator(".hint").first().click();
    await page.locator("#chat-log .turn-tmct").first().waitFor({ timeout: READY_TIMEOUT_MS });
    const answer = await page.locator("#chat-log .turn-tmct .said").first().innerText();
    assert.ok(answer.length > 0, "graph questions still answer without the seed");
  } finally {
    await context.close();
  }
});

test("the page links to the desktop app's README section", async () => {
  const { context, page } = await openCodePage();
  try {
    const link = page.locator('a[href="https://gitlab.com/polycode-projects/the-mechanical-code-talker#the-code-explorer-desktop"]');
    await assert.doesNotReject(link.waitFor({ state: "visible" }));
    assert.match(await link.innerText(), /desktop app/);
  } finally {
    await context.close();
  }
});

test("the code-explorer page fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme });
    const page = await context.newPage();
    try {
      await page.route("**/*", (route) => {
        if (route.request().url().startsWith(server.origin)) return route.continue();
        return route.abort();
      });
      await page.goto(`${server.origin}/code.html`, { waitUntil: "networkidle" });
      await page.locator("#ledger .row").first().waitFor({ state: "visible" });
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
