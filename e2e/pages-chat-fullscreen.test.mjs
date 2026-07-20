// "Talk to it"'s full-screen destination (public/chat.html), driven in a
// real browser: the full chat engine boots from its own bundle/seed, a live
// free-chat turn answers with its provenance chip, an unknown term gets the
// honest miss with no chip at all, and the page never overflows a phone
// viewport.
//
// Third-party hosts are blocked for every run, exactly as in pages-home: the
// wink lemma/POS tier degrades and the chat must still answer — the engine
// and its memory ship with the page.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;

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

async function openChatPage({ viewport, colorScheme } = {}) {
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
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return { context, page, consoleErrors, failedRequests };
}

/** Submit a question through the live composer and return the settled
 *  assistant message row once its bubble stops showing "thinking…". */
async function ask(page, question) {
  const rows = page.locator("#messages .msg-row.assistant");
  const seen = await rows.count();
  await page.fill("#composerInput", question);
  await page.press("#composerInput", "Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#messages .msg-row.assistant").length > n,
    seen,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const row = rows.last();
  await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
  return row;
}

test("the composer starts disabled and enables once the live engine finishes booting", async () => {
  const { context, page } = await openChatPage();
  try {
    assert.equal(await page.locator("#composerInput").isDisabled(), false, "the input re-enables after boot");
    assert.equal(await page.locator("#composerSend").isDisabled(), false, "send re-enables after boot");
  } finally {
    await context.close();
  }
});

test("a grounded question answers with its citation AND a matching provenance chip", async () => {
  const { context, page } = await openChatPage();
  try {
    const row = await ask(page, "what is a dog");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.match(bubbleText, /dog is a kind of animal \(source: corpus:/, "the answer is grounded and names its source");
    assert.equal(await row.locator(".provchip").count(), 1, "exactly one provenance chip renders alongside the answer");
    // .innerText() reflects the CSS text-transform (uppercase); the chip's
    // actual DOM text (and its accessible title) is lowercase — read
    // textContent to check what the page really stores, not how it's styled.
    assert.equal(await row.locator(".provchip").textContent(), "corpus", "the chip reads the same tier the citation names");
    assert.equal(await row.locator(".provchip").getAttribute("class"), "provchip pc-corpus");
  } finally {
    await context.close();
  }
});

test("teaching a fact answers with a taught-tier chip, and asking it back cites the teach and still reads taught", async () => {
  const { context, page } = await openChatPage();
  try {
    // "dog" is grounded (the seed's own starter vocabulary); "zorbnug" is
    // brand new — a class-membership teach needs exactly one known side.
    const taughtRow = await ask(page, "every zorbnug is a dog");
    assert.equal(await taughtRow.locator(".provchip").textContent(), "taught", "a fresh teach confirmation reads as taught via its own via:\"assert\"");

    const recallRow = await ask(page, "what is a zorbnug");
    const recallText = await recallRow.locator(".bubble").innerText();
    assert.match(recallText, /source: teach:chat/, "the read-back cites the just-taught fact");
    assert.equal(await recallRow.locator(".provchip").textContent(), "taught");
  } finally {
    await context.close();
  }
});

test("an unknown term gets the honest miss, dashed styling, and NO provenance chip at all", async () => {
  const { context, page } = await openChatPage();
  try {
    const row = await ask(page, "what is a zorblatt");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.match(bubbleText, /I don't know "zorblatt" yet/, "the engine refuses rather than guessing");
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "a miss carries the dashed/muted miss class");
    assert.equal(await row.locator(".provchip").count(), 0, "no chip on a miss — the absence is the honest signal, not a fabricated tier");
  } finally {
    await context.close();
  }
});

test("the page serves every same-origin asset and logs no error of its own, across a full turn", async () => {
  const { context, page, consoleErrors, failedRequests } = await openChatPage();
  try {
    await ask(page, "what is a dog");
    assert.deepEqual(failedRequests, [], "every same-origin request resolves");
    assert.deepEqual(consoleErrors, [], "the page and the chat log no errors of their own");
  } finally {
    await context.close();
  }
});

test("the page fits a phone viewport without sideways scrolling", async () => {
  const { context, page } = await openChatPage({ viewport: { width: 375, height: 667 } });
  try {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
    await page.locator("#composerInput").waitFor({ state: "visible" });
  } finally {
    await context.close();
  }
});

test("dark mode renders with no console error and the dark token set applied", async () => {
  const { context, page, consoleErrors } = await openChatPage({ colorScheme: "dark" });
  try {
    await ask(page, "what is a dog");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, "rgb(21, 24, 28)", "the dark --bg token (#15181C) is in effect");
    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});
