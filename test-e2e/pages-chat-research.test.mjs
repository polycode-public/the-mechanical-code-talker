// The research affordance on public/chat.html, driven in a real browser
// against fixture-served simple.wikipedia.org endpoints (no test touches the
// real site). Typing "research owls, limit 2" — or using the research row's
// own topic entry — grounds the depth-0 article as a cited turn, then the
// auto-play ticker submits "research next" turns one by one, each rendering
// exactly like a typed question with its own settled bubble (progressive
// turns, never one giant answer). Pause stops the ticking; play resumes it.
// With the network blocked the explicit request still TRIES (the research
// ask is its own consent, independent of the wiki radios) and the failure
// reads as a plain miss with nothing stored.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;
// A full limit-2 run is depth 0 plus two auto-played steps, each paced by
// the adapter's polite 2s interval and the page's 2.4s tick.
const RUN_TIMEOUT_MS = 45_000;

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
  const row = rows.nth(seen);
  await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
  return row;
}

const SUMMARIES = {
  Owl: { title: "Owl", extract: "An owl is a bird. Owls hunt at night.", revision: "101", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Owl" } } },
  Bird: { title: "Bird", extract: "A bird is an animal. Birds have feathers.", revision: "102", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Bird" } } },
  Night: { title: "Night", extract: "Night is the dark part of the day.", revision: "103", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Night" } } },
};

/** Answer opensearch, the lead-section links parse, and the per-title REST
 *  summaries from fixtures, with the CORS header a cross-origin fetch needs.
 *  `delayMs` (default 0) holds each response for that long before fulfilling
 *  — the pause/resume test passes one, since the auto-play ticker's own
 *  pacing runs entirely on these responses landing, and stretching them out
 *  is what actually buys this driver process room to observe "still
 *  playing" against a queue small enough to finish in a few seconds flat. */
async function routeSimpleWikipedia(page, { delayMs = 0 } = {}) {
  await page.route("https://simple.wikipedia.org/**", async (route) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const url = route.request().url();
    let body;
    if (url.includes("action=opensearch")) {
      body = JSON.stringify(["owl", ["Owl"], [""], [""]]);
    } else if (url.includes("action=parse")) {
      body = JSON.stringify({ parse: { links: [
        { ns: 0, exists: true, title: "Bird" },
        { ns: 0, exists: true, title: "Night" },
        { ns: 0, exists: true, title: "Feather" },
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

const userBubbleTexts = (page) => page.evaluate(
  () => Array.from(document.querySelectorAll("#messages .msg-row.user .bubble")).map((b) => b.textContent),
);

test("a typed research request grounds the topic cited, then auto-plays the queue as separate turns until complete, and the facts answer afterwards", async () => {
  const { context, page } = await openChatPage();
  try {
    await routeSimpleWikipedia(page);
    const startRow = await ask(page, "research owls, limit 2");
    const startText = await startRow.locator(".bubble").innerText();
    assert.match(startText, /^owl — An owl is a bird\./);
    assert.match(startText, /\(source: research article "Owl", Simple English Wikipedia, CC BY-SA 4\.0/);
    assert.match(startText, /queued 2 linked topics: Bird, Night/);

    // The ticker's very first auto-played step fires the instant the
    // grounding turn above settles — the 2.4s pacing gap only runs BETWEEN
    // completed steps, never before the first one — so nothing protects a
    // "1 done · 2 queued" read from racing ahead to a later count, or even
    // straight to "complete", once the queue starts moving under load.
    // Wait for the status line to hold ANY valid state first (it can equally
    // race the other way, read before noteResearchResult's own update lands)
    // and then accept whatever point in the 3-topic run it caught, rather
    // than pinning the immediate-post-grounding snapshot.
    await page.waitForFunction(
      () => {
        const text = document.getElementById("researchQueueStatus").textContent;
        return /research "owls": \d+ done · \d+ queued/.test(text) || /research "owls" complete/.test(text);
      },
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const statusAfterStart = await page.locator("#researchQueueStatus").innerText();
    const progress = statusAfterStart.match(/research "owls": (\d+) done · (\d+) queued/);
    if (progress) {
      const [, doneStr, queuedStr] = progress;
      assert.ok(Number(doneStr) >= 1, `at least the depth-0 topic is marked done: ${statusAfterStart}`);
      assert.equal(Number(doneStr) + Number(queuedStr), 3, `done + queued always sums to the 3-topic run: ${statusAfterStart}`);
    } else {
      assert.match(statusAfterStart, /research "owls" complete/, `status is either mid-run progress or already complete: ${statusAfterStart}`);
    }

    // The ticker submits each step as its own turn — the transcript grows
    // user-bubble "research next" lines the visitor never typed, and the
    // completion line lands in the LAST step's own bubble.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#messages .msg-row.assistant .bubble"))
        .some((b) => /research on "owls" is complete/.test(b.textContent)),
      null,
      { timeout: RUN_TIMEOUT_MS },
    );
    const userTexts = await userBubbleTexts(page);
    assert.equal(userTexts.filter((t) => t.includes("research next")).length, 2, "each queued topic was asked as its own turn");
    const bubbles = await page.evaluate(
      () => Array.from(document.querySelectorAll("#messages .msg-row.assistant .bubble")).map((b) => b.textContent),
    );
    assert.ok(bubbles.some((t) => /^bird — A bird is an animal\./.test(t)), "the first queued topic reported as its own settled turn");
    assert.match(await page.locator("#researchQueueStatus").innerText(), /research "owls" complete — 3 topics grounded/);
    assert.equal(await page.locator("#researchPlay").isHidden(), true, "a completed run offers nothing to play");

    const asked = await ask(page, "what is an owl");
    const askedText = await asked.locator(".bubble").innerText();
    assert.match(askedText, /owl is a kind of bird/, "the researched facts answer from the store");
    assert.match(askedText, /research:owl@0/, "cited under the research provenance");
  } finally {
    await context.close();
  }
});

test("the researched-this-session panel lists each topic's own passage, its source link, and the facts it actually grounded", async () => {
  const { context, page } = await openChatPage();
  try {
    await routeSimpleWikipedia(page);
    await ask(page, "research owls, limit 2");
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#messages .msg-row.assistant .bubble"))
        .some((b) => /research on "owls" is complete/.test(b.textContent)),
      null,
      { timeout: RUN_TIMEOUT_MS },
    );
    await page.waitForFunction(
      () => document.querySelectorAll("#researchedPanel .researched-item").length >= 3,
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const items = await page.locator("#researchedPanel .researched-item").allInnerTexts();
    assert.ok(items.some((t) => t.includes("Owl") && t.includes("An owl is a bird")), "the depth-0 topic's own retrieved passage is listed");
    assert.ok(items.some((t) => t.includes("Bird") && t.includes("A bird is an animal")), "a queued topic's own retrieved passage is listed too");
    const links = await page.locator("#researchedPanel .researched-link").evaluateAll((els) => els.map((el) => el.href));
    assert.ok(links.some((href) => href.includes("simple.wikipedia.org/wiki/Owl")), "each entry links back to the article it actually read");
    const factTexts = await page.locator("#researchedPanel .researched-facts li").allInnerTexts();
    assert.ok(factTexts.some((t) => t.includes("owl") && t.includes("bird")), "the fact that passage grounded is listed alongside it, not just the passage");
  } finally {
    await context.close();
  }
});

/** Wait for #researchPlay to report "playing" (aria-pressed="true") and click
 *  it the instant that's true, entirely inside the browser's own event loop.
 *  A Playwright-level `waitForFunction(...)` followed by a separate
 *  `locator.click()` is two round trips through the driver process, and the
 *  ~2.4s auto-play ticker can advance (even finish the whole queue) in the
 *  gap between them under driver-process load — the queued click then lands
 *  on a button that already went hidden, and Playwright reports that as a
 *  click actionability timeout even though the page itself is healthy. A
 *  MutationObserver watching the button's own attributes lets the "wait for
 *  playing" and the "click" happen back to back in the same synchronous
 *  browser callback, with no driver round trip in between for the ticker to
 *  race. The button also starts out hidden before a run has even begun
 *  (nothing queued yet), so "hidden" only means "the run finished before we
 *  ever caught it" once it has been seen visible at least once — otherwise
 *  this resolves `false` too early, before the run had even started. When it
 *  genuinely does finish first, this resolves `false` instead of clicking,
 *  so the caller can retry on a fresh ticker rather than clicking a dead
 *  button. */
async function clickResearchPlayOncePlaying(page, timeoutMs) {
  return page.evaluate((timeout) => new Promise((resolve, reject) => {
    const button = document.getElementById("researchPlay");
    let everVisible = false;
    const settle = () => {
      if (!button.hidden) everVisible = true;
      if (everVisible && button.hidden) { resolve(false); return true; }
      if (button.getAttribute("aria-pressed") === "true") { button.click(); resolve(true); return true; }
      return false;
    };
    if (settle()) return;
    const observer = new MutationObserver(() => { if (settle()) observer.disconnect(); });
    observer.observe(button, { attributes: true, attributeFilter: ["aria-pressed", "hidden"] });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error("researchPlay reported neither playing nor complete before the wait ran out"));
    }, timeout);
  }), timeoutMs);
}

// Slows each fixture response so the 3-topic run can't finish faster than
// this driver process can realistically observe it mid-play — see
// routeSimpleWikipedia's own comment for why that's the actual lever here.
const PAUSE_TEST_FIXTURE_DELAY_MS = 1500;

/** One attempt at the play/pause flow, on a caller-supplied fresh page. */
async function assertPauseReallyStopsTheTicker(page) {
  await routeSimpleWikipedia(page, { delayMs: PAUSE_TEST_FIXTURE_DELAY_MS });
  await page.fill("#researchTopic", "owls");
  await page.click("#researchGo");
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("#messages .msg-row.user .bubble")).some((b) => b.textContent.includes("research owls")),
    null,
    { timeout: ANSWER_TIMEOUT_MS },
  );

  const caughtItPlaying = await clickResearchPlayOncePlaying(page, ANSWER_TIMEOUT_MS); // pause
  if (!caughtItPlaying) throw new Error("the queue finished before the pause click ever caught it mid-play");

  // Let any in-flight step settle, then prove the transcript stops growing.
  await page.waitForFunction(
    () => document.getElementById("researchPlay").getAttribute("aria-pressed") === "false"
      && !document.querySelector("#messages .bubble.pending"),
    null,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const pausedCount = (await userBubbleTexts(page)).length;
  await page.waitForTimeout(3500);
  assert.equal((await userBubbleTexts(page)).length, pausedCount, "paused means no further step is asked");

  await page.locator("#researchPlay").click(); // resume — paused state is stable, nothing races this
  await page.waitForFunction(
    (n) => document.querySelectorAll("#messages .msg-row.user .bubble").length > n,
    pausedCount,
    { timeout: RUN_TIMEOUT_MS },
  );
}

test("the research row's own entry submits the request, and pause really stops the ticking until play resumes it", async () => {
  // The auto-play ticker's own 2.4s pacing gap runs entirely inside the
  // browser process, independent of this test's driver process; under
  // contention the driver can stall long enough that the whole queue (here,
  // 3 topics) finishes before this test ever manages to catch the button
  // mid-play. clickResearchPlayOncePlaying reports that as a clean `false`
  // rather than an actionability timeout, but there is still nothing left
  // to pause once it happens — a fresh page gives each attempt its own
  // independent race against that stall.
  const ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { context, page } = await openChatPage();
    try {
      await assertPauseReallyStopsTheTicker(page);
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

test("with third-party requests blocked, the explicit request still tries the network (its own consent) and the failure is a plain miss — nothing stored, nothing to play", async () => {
  const { context, page, thirdPartyAttempts } = await openChatPage();
  try {
    const row = await ask(page, "research owls");
    const text = await row.locator(".bubble").innerText();
    assert.match(text, /couldn't ground "owls" from Simple English Wikipedia/);
    assert.match(text, /Nothing was stored\./);
    assert.equal(await row.locator(".bubble").getAttribute("class"), "bubble assistant miss", "the honest miss keeps its dashed treatment");
    const attempts = thirdPartyAttempts.filter((u) => u.includes("simple.wikipedia.org"));
    assert.ok(attempts.length >= 1, "the explicit research ask consented to (and attempted) the fetch despite the wiki-off default");
    assert.equal(await page.locator("#researchPlay").isHidden(), true, "no queue survives a failed start");
  } finally {
    await context.close();
  }
});
