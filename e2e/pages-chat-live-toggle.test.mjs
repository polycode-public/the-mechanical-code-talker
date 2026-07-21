// The "ask Wikipedia when I don't know" switch on public/chat.html, driven in
// a real browser. OFF is the default and means what it says: a clean miss
// makes zero request attempts toward wikipedia.org. Flipping the switch
// persists in localStorage across a reload. ON, a miss question round-trips
// the two Wikipedia endpoints (fulfilled here from fixtures — no test ever
// touches the real site) and answers cited; a failing endpoint leaves the
// honest miss standing, dashed bubble and all.
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

/** Open chat.html with third-party requests blocked AND recorded — the
 *  recorder is how a test proves the OFF default never even tries the
 *  network. A test that wants Wikipedia answered registers its own more
 *  specific route AFTER this catch-all (Playwright matches the newest route
 *  first), so the abort here stays the fallback. */
async function openChatPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const thirdPartyAttempts = [];

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(server.origin)) return route.continue();
    thirdPartyAttempts.push(url);
    return route.abort();
  });

  await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return { context, page, thirdPartyAttempts };
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

const OPENSEARCH_FIXTURE = JSON.stringify(["quasar", ["Quasar"], [""], ["https://en.wikipedia.org/wiki/Quasar"]]);
const SUMMARY_FIXTURE = JSON.stringify({
  title: "Quasar",
  extract: "A quasar is a very bright object in space. It is powered by a black hole.",
  revision: "1234567",
  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quasar" } },
});

/** Answer both Wikipedia endpoints from fixtures, with the CORS header a
 *  cross-origin page fetch needs. */
async function routeWikipedia(page, { status = 200 } = {}) {
  await page.route("https://en.wikipedia.org/**", (route) => {
    if (status !== 200) return route.fulfill({ status, contentType: "text/plain", body: "unavailable" });
    const url = route.request().url();
    const body = url.includes("action=opensearch") ? OPENSEARCH_FIXTURE : SUMMARY_FIXTURE;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body,
    });
  });
}

test("the switch ships off, and a miss question makes zero wikipedia.org request attempts", async () => {
  const { context, page, thirdPartyAttempts } = await openChatPage();
  try {
    assert.equal(await page.locator("#liveToggle").isChecked(), false, "the switch is off by default");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: off/);

    const row = await ask(page, "what is a quasar");
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "the honest miss stands");
    const wikipediaAttempts = thirdPartyAttempts.filter((u) => u.includes("wikipedia.org"));
    assert.deepEqual(wikipediaAttempts, [], "no request toward wikipedia.org was even attempted");
  } finally {
    await context.close();
  }
});

test("flipping the switch persists in localStorage and survives a reload", async () => {
  const { context, page } = await openChatPage();
  try {
    await page.locator(".liveLabel").click();
    assert.equal(await page.locator("#liveToggle").isChecked(), true);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("tmct.chat.liveWikipedia")),
      "on",
      "the preference lands under its own key",
    );
    assert.match(await page.locator("#status").innerText(), /live wikipedia: on/);

    await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => window.tmctChatReady);
    assert.equal(await page.locator("#liveToggle").isChecked(), true, "the reloaded page restores the stored preference");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: on/);
  } finally {
    await context.close();
  }
});

test("switched on, a miss question answers from the (fixture-served) live article, cited", async () => {
  const { context, page } = await openChatPage();
  try {
    await routeWikipedia(page);
    await page.locator(".liveLabel").click();

    const row = await ask(page, "what is a quasar");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.match(bubbleText, /^quasar — A quasar is a very bright object in space\./);
    assert.match(bubbleText, /\(source: live Wikipedia article "Quasar", English Wikipedia, CC BY-SA 4\.0 — https:\/\/en\.wikipedia\.org\/wiki\/Quasar\?oldid=1234567\)/);
    assert.notEqual(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "a cited live answer is not a miss");
  } finally {
    await context.close();
  }
});

test("switched on with Wikipedia failing, the honest miss stands — dashed bubble, no chip, no citation", async () => {
  const { context, page } = await openChatPage();
  try {
    await routeWikipedia(page, { status: 500 });
    await page.locator(".liveLabel").click();

    const row = await ask(page, "what is a quasar");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.doesNotMatch(bubbleText, /live Wikipedia article/, "no citation is fabricated from a failed lookup");
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "the miss keeps its dashed treatment");
    assert.equal(await row.locator(".provchip").count(), 0, "no provenance chip on a miss");
  } finally {
    await context.close();
  }
});
