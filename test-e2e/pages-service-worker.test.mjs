// The site's service worker, driven in a real browser: one online visit to
// chat.html installs the precache (page shell, chat bundle, wink vendor
// asset, seed, reference-pack index); with the network then cut, the same
// context reloads and the page still fully boots — composer enabled, a
// seeded question answered, the wink lemma/POS tier loaded from the cached
// vendor asset. The cache is best-effort by design (storage can be evicted);
// what this file pins is that a cache that IS present makes the page work
// with zero network.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { requireSeedLoaded } from "./helpers/seed-state.mjs";

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

/** Boot the chat page and require its starter memory to be in. Boot alone
 *  resolves either way — a seed that never arrived boots a page that answers
 *  every seeded question with a miss, and the miss is honest but it is not what
 *  this file is testing. */
async function awaitChatBoot(page) {
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return requireSeedLoaded(page);
}

test("after one online visit, chat.html boots and answers fully offline from the service worker's precache", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${server.origin}/chat.html`, { waitUntil: "load" });
    await awaitChatBoot(page);
    // `ready` resolves once the worker is active, and activation only runs
    // after the install step's precache settles — so from here the cache
    // holds whatever boot assets the server could serve.
    const swActive = await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    assert.equal(swActive, true, "the service worker registered and activated");

    await context.setOffline(true);
    await page.reload({ waitUntil: "load" });
    const offlineSeed = await awaitChatBoot(page);
    assert.ok(offlineSeed.facts > 100, `the precached seed came back whole offline, got ${offlineSeed.facts} facts`);

    assert.equal(await page.locator("#composerInput").isDisabled(), false, "the composer enables with the network cut");

    await page.fill("#composerInput", "what is a dog");
    await page.press("#composerInput", "Enter");
    await page.waitForFunction(
      () => document.querySelectorAll("#messages .msg-row.assistant").length > 0,
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const row = page.locator("#messages .msg-row.assistant").last();
    await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
    assert.match(
      await row.locator(".bubble").innerText(),
      /dog is a kind of animal/,
      "a seeded question still answers offline — the seed came from the cache",
    );

    assert.match(
      await page.locator("#status").innerText(),
      /wink-nlp lemma\/POS tier: loaded/,
      "the lemma tier loads offline from the precached vendor asset",
    );
  } finally {
    await context.close();
  }
});
