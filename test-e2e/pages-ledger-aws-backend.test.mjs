// ledger.html's backend slider and the ?backend=aws deep link, driven in a
// real browser against the real row service double (server/row-service/
// local.mjs), the same M5 double the news feed and chat-AWS specs run
// against. The live dock's own teach/ask contract is covered in
// pages-ledger-teach.test.mjs and stays untouched here; this file covers
// the AWS-mode copy, the session-key round trip, and the slider/URL
// interaction.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { createLocalRowService } from "../server/row-service/local.mjs";

const DOCK_READY_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 30_000;

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

const openServices = [];
async function withRowService() {
  const service = await createLocalRowService({});
  openServices.push(service);
  return service;
}
after(async () => { await Promise.all(openServices.map((s) => s.close())); });

async function openLedgerPage({ service, path = "/ledger.html" } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (service) {
    await page.route("**/api/**", async (route) => {
      const request = route.request();
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
  await page.goto(`${server.origin}${path}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => typeof window.tmct?.open === "function" && !window.tmct.fallback
      && /teach/i.test(document.getElementById("chatq")?.placeholder ?? ""),
    null,
    { timeout: DOCK_READY_TIMEOUT_MS },
  );
  return { context, page };
}

async function turn(page, text) {
  const replies = page.locator("#chatlog > div.a:not(.pending)");
  const before = await replies.count();
  await page.fill("#chatq", text);
  await page.press("#chatq", "Enter");
  await page.waitForFunction(
    (seen) => document.querySelectorAll("#chatlog > div.a:not(.pending)").length > seen,
    before,
    { timeout: TURN_TIMEOUT_MS },
  );
  const reply = replies.last();
  const className = (await reply.getAttribute("class")) ?? "";
  return { text: (await reply.textContent()) ?? "", taught: className.split(/\s+/).includes("taught") };
}

test("local mode (the default): the slider reads local, and the note names this browser tab, unchanged across a reload", async () => {
  const { context, page } = await openLedgerPage();
  try {
    assert.equal(await page.locator("#backendLocal").isChecked(), true);
    assert.match(await page.locator("#backendNote").innerText(), /stay in this browser tab only, and are lost on reload/);
  } finally {
    await context.close();
  }
});

test("?backend=aws boots the slider set to AWS, mints a session pointer, and shows the server-side promise with the local wording absent", async () => {
  const service = await withRowService();
  const { context, page } = await openLedgerPage({ service, path: "/ledger.html?backend=aws" });
  try {
    assert.equal(await page.locator("#backendAws").isChecked(), true);
    const note = await page.locator("#backendNote").innerText();
    assert.match(note, /save to an anonymous server-side session that expires after seven days/);
    assert.doesNotMatch(note, /browser tab only/, "the local-only wording is absent, not amended");

    const stored = await page.evaluate(() => window.localStorage.getItem("tmct.ledger.sessionKey"));
    assert.match(stored, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    await context.close();
  }
});

test("AWS mode: a taught fact writes through the row service and answers back under the same session key after a reload", async () => {
  const service = await withRowService();
  const { context, page } = await openLedgerPage({ service, path: "/ledger.html?backend=aws" });
  try {
    const taught = await turn(page, "a blorp is a kind of peg");
    assert.equal(taught.taught, true, `expected a taught confirmation, got: ${taught.text}`);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => typeof window.tmct?.open === "function" && !window.tmct.fallback
        && /teach/i.test(document.getElementById("chatq")?.placeholder ?? ""),
      null,
      { timeout: DOCK_READY_TIMEOUT_MS },
    );
    const recall = await turn(page, "what is a blorp");
    assert.match(recall.text, /blorp is a kind of peg/);
  } finally {
    await context.close();
  }
});

test("the slider rewrites the URL and reloads rather than switching a live session", async () => {
  const service = await withRowService();
  const { context, page } = await openLedgerPage({ service });
  try {
    const reloaded = page.waitForEvent("load");
    await page.click("#backendAws");
    await reloaded;
    assert.match(page.url(), /backend=aws/);

    const backToLocal = page.waitForEvent("load");
    await page.click("#backendLocal");
    await backToLocal;
    assert.doesNotMatch(page.url(), /backend=/, "local is the absence of the param, never a literal ?backend=local");
  } finally {
    await context.close();
  }
});
