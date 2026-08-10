// chat.html's backend slider and the ?backend=aws deep link, driven in a
// real browser against the real row service double (server/row-service/
// local.mjs's local.mjs, the same M5 double the news feed spec runs
// against). Local mode's own persistence is covered in
// pages-chat-persistence.test.mjs and stays untouched here; this file
// covers the AWS-mode copy, the session-key round trip, the purge, the
// slider/URL interaction, and the unreachable-service fallback.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { createLocalRowService } from "../server/row-service/local.mjs";

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

/** Every one of this file's own service instances, closed together in
 *  `after` — a test that starts one and forgets to close it would otherwise
 *  leak a listening port past the file's own run. */
const openServices = [];
async function withRowService() {
  const service = await createLocalRowService({});
  openServices.push(service);
  return service;
}
after(async () => { await Promise.all(openServices.map((s) => s.close())); });

async function awaitChatReady(page) {
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
}

/** Proxies the page's own same-origin `/api/*` requests to `service.url` —
 *  the CloudFront `/api/*` behavior's local stand-in, the same pattern
 *  pages-news-feed.test.mjs uses. Requests to anything else stay
 *  same-origin only. `service` may be omitted for a local-mode open, which
 *  makes zero `/api/*` requests. */
async function openChatPage({ service, path = "/chat.html", waitUntil = "networkidle" } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const apiRequests = [];
  if (service) {
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      apiRequests.push({ method: request.method(), url: request.url() });
      const target = new URL(new URL(request.url()).pathname + new URL(request.url()).search, service.url);
      const headers = await request.allHeaders();
      delete headers.host;
      try {
        const response = await fetch(target, {
          method: request.method(),
          headers,
          body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postData(),
        });
        const body = Buffer.from(await response.arrayBuffer());
        const responseHeaders = {};
        response.headers.forEach((value, key) => { responseHeaders[key] = value; });
        await route.fulfill({ status: response.status, headers: responseHeaders, body });
      } catch {
        await route.abort("connectionfailed");
      }
    });
  }
  // A predicate matcher, not an unconditional "**/*" continue/abort: Playwright
  // runs routes in the REVERSE of registration order, so a same-origin
  // "**/*" handler registered after the "**/api/**" proxy above would win
  // first and swallow every /api/ request into a plain continue() before
  // the proxy ever saw it. Matching false for same-origin leaves those
  // requests (api included) to fall through to the proxy or the network.
  await page.route((url) => !url.href.startsWith(server.origin), (route) => route.abort());
  await page.goto(`${server.origin}${path}`, { waitUntil });
  await awaitChatReady(page);
  return { context, page, apiRequests };
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

const bootLineOf = (page) => page.locator("#messages .msg-row.system").first().innerText();

test("local mode (the default): the slider reads local, and the persist note names IndexedDB, unchanged", async () => {
  const { context, page } = await openChatPage();
  try {
    assert.equal(await page.locator("#backendLocal").isChecked(), true);
    assert.equal(await page.locator("#backendAws").isChecked(), false);
    await ask(page, "a zorble is a kind of animal");
    const note = await page.locator("#statsPanelStats .persist-note").innerText();
    assert.match(note, /kept best-effort on this device \(IndexedDB\), never sent anywhere/);
  } finally {
    await context.close();
  }
});

test("?backend=aws boots the slider set to AWS, mints a session-pointer UUID, and shows the server-side promise with the device wording absent", async () => {
  const service = await withRowService();
  const { context, page } = await openChatPage({ service, path: "/chat.html?backend=aws" });
  try {
    assert.equal(await page.locator("#backendAws").isChecked(), true);
    assert.equal(await page.locator("#backendLocal").isChecked(), false);

    const stored = await page.evaluate(() => window.localStorage.getItem("tmct.chat.sessionKey"));
    assert.match(stored, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "a v4 UUID is minted and stored");

    const bootLine = await bootLineOf(page);
    assert.doesNotMatch(bootLine, /Restored/, "a first visit under a fresh key restores nothing");

    const panel = await page.locator("#statsPanelStats").innerText();
    assert.match(panel, /stored server-side against an anonymous session that expires after seven days/);
    assert.doesNotMatch(panel, /IndexedDB/, "the local-only wording is absent, not amended");
  } finally {
    await context.close();
  }
});

test("AWS mode: a taught fact writes through the row service and restores on reload under the same session key", async () => {
  const service = await withRowService();
  const { context, page } = await openChatPage({ service, path: "/chat.html?backend=aws" });
  try {
    const taughtRow = await ask(page, "a zorble is a kind of animal");
    assert.equal(await taughtRow.locator(".provchip").textContent(), "taught");

    await page.reload({ waitUntil: "networkidle" });
    await awaitChatReady(page);

    const bootLine = await bootLineOf(page);
    assert.match(bootLine, /Restored 1 taught fact /);
    assert.match(bootLine, /kept server-side against this anonymous session/);

    const recallRow = await ask(page, "what is a zorble");
    assert.match(await recallRow.locator(".bubble").innerText(), /source: teach:chat/);
    assert.equal(await recallRow.locator(".provchip").textContent(), "taught");
  } finally {
    await context.close();
  }
});

test("AWS mode: forget everything purges the row service under a fresh session key, and the taught term is an honest miss again", async () => {
  const service = await withRowService();
  const { context, page } = await openChatPage({ service, path: "/chat.html?backend=aws" });
  try {
    await ask(page, "a zorble is a kind of animal");
    const keyBefore = await page.evaluate(() => window.localStorage.getItem("tmct.chat.sessionKey"));

    const systemLines = page.locator("#messages .msg-row.system");
    const seenSystem = await systemLines.count();
    await page.click("#forgetEverything");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#messages .msg-row.system").length > n,
      seenSystem,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    assert.match(await systemLines.last().innerText(), /forgot everything taught this session.*new anonymous session/);

    const keyAfter = await page.evaluate(() => window.localStorage.getItem("tmct.chat.sessionKey"));
    assert.notEqual(keyAfter, keyBefore, "forgetting mints a fresh session pointer, the same posture as a local-mode fresh session id");

    const missRow = await ask(page, "what is a zorble");
    assert.match(await missRow.locator(".bubble").innerText(), /I don't know "zorble" yet/);

    // The old key is genuinely purged server-side, not just abandoned client-side.
    await page.reload({ waitUntil: "networkidle" });
    await awaitChatReady(page);
    await page.evaluate((key) => window.localStorage.setItem("tmct.chat.sessionKey", key), keyBefore);
    await page.reload({ waitUntil: "networkidle" });
    await awaitChatReady(page);
    assert.doesNotMatch(await bootLineOf(page), /Restored/, "the discarded key restores nothing — the purge reached the service");
  } finally {
    await context.close();
  }
});

test("the slider rewrites the URL and reloads rather than switching a live session — the URL always wins on the next boot", async () => {
  const service = await withRowService();
  const { context, page } = await openChatPage({ service });
  try {
    assert.equal(await page.locator("#backendLocal").isChecked(), true);
    const reloaded = page.waitForEvent("load");
    await page.click("#backendAws");
    await reloaded;
    await awaitChatReady(page);
    assert.match(page.url(), /backend=aws/);
    assert.equal(await page.locator("#backendAws").isChecked(), true);

    const backToLocal = page.waitForEvent("load");
    await page.click("#backendLocal");
    await backToLocal;
    await awaitChatReady(page);
    assert.doesNotMatch(page.url(), /backend=/, "local is the absence of the param, never a literal ?backend=local");
    assert.equal(await page.locator("#backendLocal").isChecked(), true);
  } finally {
    await context.close();
  }
});

test("AWS mode with an unreachable row service: the page still boots and answers, unpersisted, and says so", async () => {
  const service = await withRowService();
  await service.close();
  const { context, page } = await openChatPage({ service, path: "/chat.html?backend=aws" });
  try {
    const bootLine = await bootLineOf(page);
    assert.match(bootLine, /couldn't reach the row service.*running unpersisted/);

    const row = await ask(page, "what is a dog");
    assert.match(await row.locator(".bubble").innerText(), /dog is a/i, "the in-page engine answers a grounded question without any persistence at all");

    const panel = await page.locator("#statsPanelStats").innerText();
    assert.match(panel, /the row service wasn't reachable this visit/);
  } finally {
    await context.close();
  }
});
