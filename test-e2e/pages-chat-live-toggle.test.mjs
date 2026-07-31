// The "ask wikipedia" radio group on public/chat.html (off / when I don't
// know / always), driven in a real browser. Off is the default and means
// what it says: a clean miss makes zero request attempts toward
// wikipedia.org. Miss mode is the previous toggle's own behavior: a miss
// question round-trips the two Wikipedia endpoints (fulfilled here from
// fixtures — no test ever touches the real site) and answers cited, while a
// failing endpoint leaves the honest miss standing. Always widens that to a
// grounded ask the store already answers — the answer still leads, with a
// cited Wikipedia read-out appended. Picking a radio persists in
// localStorage across a reload; a legacy "liveWikipedia=on" preference from
// before the radio group existed migrates to miss on first boot.
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
 *  recorder is how a test proves the off default never even tries the
 *  network. A test that wants Wikipedia answered registers its own more
 *  specific route AFTER this catch-all (Playwright matches the newest route
 *  first), so the abort here stays the fallback. `localStorageSeed` (optional)
 *  runs before the page's own boot script, so a test can drive a legacy or
 *  pre-set preference without first clicking a radio through a fresh boot. */
async function openChatPage({ localStorageSeed } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const thirdPartyAttempts = [];

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(server.origin)) return route.continue();
    thirdPartyAttempts.push(url);
    return route.abort();
  });

  if (localStorageSeed) await page.addInitScript((seed) => {
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  }, localStorageSeed);

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

const checkedWikiMode = (page) => page.evaluate(() => {
  const checked = Array.from(document.querySelectorAll('input[name="wikiMode"]')).find((r) => r.checked);
  return checked ? checked.value : null;
});

test("off is the default, and a miss question makes zero wikipedia.org request attempts", async () => {
  const { context, page, thirdPartyAttempts } = await openChatPage();
  try {
    assert.equal(await checkedWikiMode(page), "off", "off is checked by default");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: off/);

    const row = await ask(page, "what is a quasar");
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "the honest miss stands");
    const wikipediaAttempts = thirdPartyAttempts.filter((u) => u.includes("wikipedia.org"));
    assert.deepEqual(wikipediaAttempts, [], "no request toward wikipedia.org was even attempted");
  } finally {
    await context.close();
  }
});

test("picking a radio persists in localStorage and survives a reload", async () => {
  const { context, page } = await openChatPage();
  try {
    await page.click("#wikiMiss");
    assert.equal(await checkedWikiMode(page), "miss");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("tmct.chat.wikiMode")),
      "miss",
      "the mode persists under its own key",
    );
    assert.match(await page.locator("#status").innerText(), /live wikipedia: on/);

    await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => window.tmctChatReady);
    assert.equal(await checkedWikiMode(page), "miss", "the reloaded page restores the stored mode");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: on/);
  } finally {
    await context.close();
  }
});

test("a legacy liveWikipedia=on preference migrates to the miss mode on first boot, and the legacy key is dropped", async () => {
  const { context, page } = await openChatPage({ localStorageSeed: { "tmct.chat.liveWikipedia": "on" } });
  try {
    assert.equal(await checkedWikiMode(page), "miss", "the legacy \"on\" preference reads as the miss mode");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("tmct.chat.wikiMode")),
      "miss",
      "boot writes the migrated mode under the new key",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("tmct.chat.liveWikipedia")),
      null,
      "the legacy key is cleared once migrated",
    );
  } finally {
    await context.close();
  }
});

test("a typed /wiki turn drives the same state as the radios: the checked value, the statusline, and the stored preference all flip", async () => {
  const { context, page } = await openChatPage();
  try {
    const onReply = await ask(page, "/wiki on");
    assert.match(await onReply.locator(".bubble").innerText(), /\bon\b/i, "the command turn acknowledges the new state");
    assert.equal(await checkedWikiMode(page), "miss", "the radios mirror the session state the command flipped");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: on/);
    assert.equal(await page.evaluate(() => localStorage.getItem("tmct.chat.wikiMode")), "miss");

    await ask(page, "/wiki off");
    assert.equal(await checkedWikiMode(page), "off", "the command flips it back off");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: off/);
    assert.equal(await page.evaluate(() => localStorage.getItem("tmct.chat.wikiMode")), "off");

    await ask(page, "/wiki always");
    assert.equal(await checkedWikiMode(page), "always");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: always/);
    assert.equal(await page.evaluate(() => localStorage.getItem("tmct.chat.wikiMode")), "always");
  } finally {
    await context.close();
  }
});

test("/wiki supplement clears every radio — it has none of its own — and the statusline names it truthfully", async () => {
  const { context, page } = await openChatPage();
  try {
    await ask(page, "/wiki supplement");
    assert.equal(await checkedWikiMode(page), null, "no radio claims a mode /wiki supplement doesn't represent");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: supplement/);
  } finally {
    await context.close();
  }
});

/** One attempt at the supplement flow, on a caller-supplied fresh page —
 *  throws on either assertion so the retry below can tell a genuine miss
 *  from a stray Playwright error. */
async function assertSupplementedQuasarAnswer(page) {
  await routeWikipedia(page);
  await ask(page, "/wiki supplement");
  await ask(page, "every quasar is a star");
  const row = await ask(page, "what is a quasar");
  const bubbleText = await row.locator(".bubble").innerText();
  assert.match(bubbleText, /quasar is a kind of star/, "the local answer still leads");
  assert.match(bubbleText, /Wikipedia adds: quasar — A quasar is a very bright object/, "the cited supplement follows the grounded answer");
}

test("/wiki supplement adds a cited Wikipedia read-out under a grounded answer the store already gave", async () => {
  // The live lookup carries its own abort timeout (wikipedia-live.mjs's
  // 4s fetchJson budget), racing against the mocked fetch's real round trip
  // through THIS test's own Node process (browser fetch -> CDP -> the
  // page.route callback below -> CDP response). Under full-suite contention
  // that process can be starved long enough for the abort to win the race,
  // which reads as a clean miss — not a hang, so no timeout ever fires, the
  // supplement is just silently absent. A lost race is then cached as a
  // settled miss for the rest of that page's life (cachedFetch caches
  // failures too, on purpose, so a real miss is never refetched), so
  // retrying the SAME page can never recover — only a fresh page, with a
  // fresh in-page provider cache, gets a genuine second attempt.
  const ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { context, page } = await openChatPage();
    try {
      await assertSupplementedQuasarAnswer(page);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    } finally {
      await context.close();
    }
  }
  if (lastError) throw lastError;
});

test("off means off: switching back to off after use makes the very next miss attempt zero wikipedia requests", async () => {
  const { context, page, thirdPartyAttempts } = await openChatPage();
  try {
    await page.click("#wikiMiss");
    assert.equal(await checkedWikiMode(page), "miss");
    await page.click("#wikiOff");
    assert.equal(await checkedWikiMode(page), "off", "the radios flip straight back to off");
    assert.match(await page.locator("#status").innerText(), /live wikipedia: off/);

    const row = await ask(page, "what is a quasar");
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "the honest miss stands");
    const wikipediaAttempts = thirdPartyAttempts.filter((u) => u.includes("wikipedia.org"));
    assert.deepEqual(wikipediaAttempts, [], "off means off — no request toward wikipedia.org after the round trip");
  } finally {
    await context.close();
  }
});

test("miss mode: a miss question answers from the (fixture-served) live article, cited", async () => {
  const { context, page } = await openChatPage();
  try {
    await routeWikipedia(page);
    await page.click("#wikiMiss");

    const row = await ask(page, "what is a quasar");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.match(bubbleText, /^quasar — A quasar is a very bright object in space\./);
    assert.match(bubbleText, /\(source: live Wikipedia article "Quasar", English Wikipedia, CC BY-SA 4\.0 — https:\/\/en\.wikipedia\.org\/wiki\/Quasar\?oldid=1234567\)/);
    assert.notEqual(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "a cited live answer is not a miss");
  } finally {
    await context.close();
  }
});

test("miss mode with Wikipedia failing, the honest miss stands — dashed bubble, no chip, no citation", async () => {
  const { context, page } = await openChatPage();
  try {
    await routeWikipedia(page, { status: 500 });
    await page.click("#wikiMiss");

    const row = await ask(page, "what is a quasar");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.doesNotMatch(bubbleText, /live Wikipedia article/, "no citation is fabricated from a failed lookup");
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "the miss keeps its dashed treatment");
    assert.equal(await row.locator(".provchip").count(), 0, "no provenance chip on a miss");
  } finally {
    await context.close();
  }
});

test("always mode fetches even on an ask local facts already answer, and the grounded answer still leads", async () => {
  const { context, page } = await openChatPage();
  try {
    // routeWikipedia's own fixture route is registered AFTER (and so takes
    // priority over) openChatPage's catch-all recorder — the fixture-cited
    // text landing in the answer is itself the proof always reached the
    // network; the recorder never sees a request the fixture route absorbed.
    await routeWikipedia(page);
    await ask(page, "every quasar is a star");
    await page.click("#wikiAlways");
    assert.equal(await checkedWikiMode(page), "always");

    const row = await ask(page, "what is a quasar");
    const bubbleText = await row.locator(".bubble").innerText();
    assert.match(bubbleText, /quasar is a kind of star/, "the grounded answer still leads");
    assert.match(bubbleText, /Wikipedia adds: quasar — A quasar is a very bright object/, "always widens the supplement to an ordinary grounded ask, cited from the live fixture");
  } finally {
    await context.close();
  }
});
