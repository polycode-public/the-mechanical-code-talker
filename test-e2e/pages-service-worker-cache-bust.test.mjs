// The service worker's cache-busting regression, in a real browser: an old
// build's precache must not survive a redeploy served from the same
// directory. build-demo-site.mjs names the cache `tmct-precache-v<version>-
// <buildHash>`, where buildHash is a content hash of every precached asset —
// so ANY of them changing (a version bump, a rebuilt bundle, a rebuilt seed)
// rolls the name, and the activate step drops every cache entry from the
// build before it. pages-service-worker.test.mjs proves offline boot after
// ONE precache; this file proves the redeploy case that fix actually targets:
// two builds served from the same directory, the second replacing the first
// in place (TMCT_DEMO_VERSION_OVERRIDE, threaded through demo-site.mjs's
// buildDemoSiteSnapshot, drives the version difference without touching the
// repo's own package.json).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;
const CACHE_SETTLE_TIMEOUT_MS = 20_000;

const VERSION_A = "9.9.1";
const VERSION_B = "9.9.2";

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot({ versionOverride: VERSION_A });
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

async function awaitChatBoot(page) {
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
}

/** The names of every precache this origin's caches currently hold. */
function precacheKeys(page) {
  return page.evaluate(() => caches.keys().then((keys) => keys.filter((k) => k.startsWith("tmct-precache-"))));
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
  const row = rows.last();
  await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
  return row;
}

const factPillValue = (page) => page.locator("#factPillValue").innerText().then((t) => Number(t.replace(/[^\d]/g, "")));

test("a redeploy served from the same directory rolls the precache name, the next online load serves the new build, and reset to seed recovers a session taught after the redeploy", async (t) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${server.origin}/chat.html`, { waitUntil: "load" });
    await awaitChatBoot(page);
    const swActive = await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    assert.equal(swActive, true, "the first build's service worker registers and activates");

    const keysA = await precacheKeys(page);
    assert.ok(keysA.some((k) => k.startsWith(`tmct-precache-v${VERSION_A}-`)), `expected a v${VERSION_A} precache, got ${JSON.stringify(keysA)}`);

    await t.test("rebuild the same directory in place under a new version", () => {
      buildDemoSiteSnapshot({ outDir: siteDir, versionOverride: VERSION_B });
    });

    // Still online: reload and let the page's own registration pick up the
    // new worker (skipWaiting + clients.claim, so no second reload needed).
    await page.reload({ waitUntil: "load" });
    await awaitChatBoot(page);

    await page.waitForFunction(
      (versionB) => caches.keys().then((keys) => keys.some((k) => k.startsWith(`tmct-precache-v${versionB}-`))),
      VERSION_B,
      { timeout: CACHE_SETTLE_TIMEOUT_MS },
    );
    await page.waitForFunction(
      (versionA) => caches.keys().then((keys) => !keys.some((k) => k.startsWith(`tmct-precache-v${versionA}-`))),
      VERSION_A,
      { timeout: CACHE_SETTLE_TIMEOUT_MS },
    );
    const keysB = await precacheKeys(page);
    assert.equal(keysB.length, 1, `expected exactly one precache after the redeploy settles, got ${JSON.stringify(keysB)}`);

    const seededRow = await ask(page, "what is a dog");
    assert.match(
      await seededRow.locator(".bubble").innerText(),
      /dog is a kind of animal/,
      "the reloaded page still boots and answers correctly under the new build",
    );

    // "reset to seed" recovers a session taught AFTER the redeploy: teach one
    // fact, confirm the pill counts it, then reinitStore must drop it and
    // reboot to exactly the fresh seed's own total.
    const preTeachCount = await factPillValue(page);
    await ask(page, "Rover is a dog.");
    const postTeachCount = await factPillValue(page);
    assert.equal(postTeachCount, preTeachCount + 1, "the taught fact under the new build is reflected in the fact pill");

    const reloaded = page.waitForEvent("load");
    await page.click("#reinitStore");
    await reloaded;
    await awaitChatBoot(page);

    const postResetCount = await factPillValue(page);
    assert.equal(postResetCount, preTeachCount, "reset to seed drops the taught fact and reboots to the fresh seed's own total, not a stuck stale count");
  } finally {
    await context.close();
  }
});
