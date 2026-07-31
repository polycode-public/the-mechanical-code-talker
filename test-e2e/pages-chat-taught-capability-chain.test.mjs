// Regression coverage, in a real browser against the real chat.html, for the
// bug report that opened this: teaching "Rover is a dog." then asking "Does
// Rover bark?" must chain the taught fact (rover rdfs:subClassOf dog) through
// the corpus fact (dog mgx:capableOf bark) and answer with both citations.
// examples/rover-infer.mjs carries the same scenario driven in-process (no
// browser); this file proves the identical answer renders through the live
// composer and DOM, not just through runChat directly.
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

async function openChatPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return { context, page };
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

test("teaching \"Rover is a dog.\" then asking \"Does Rover bark?\" renders the chained capability answer in the composer", async () => {
  const { context, page } = await openChatPage();
  try {
    const factPillBefore = Number((await page.locator("#factPillValue").innerText()).replace(/[^\d]/g, ""));
    assert.ok(factPillBefore > 0, `expected a real starter-memory fact count in the pill before teaching, got ${factPillBefore}`);

    const taughtRow = await ask(page, "Rover is a dog.");
    const taughtText = await taughtRow.locator(".bubble").innerText();
    assert.match(taughtText, /^noted — remembered 1 fact: rover rdfs:subClassOf dog \(rover is a type of dog\)/, "the teach turn records the ISA fact");

    const factPillAfter = Number((await page.locator("#factPillValue").innerText()).replace(/[^\d]/g, ""));
    assert.equal(factPillAfter, factPillBefore + 1, "the fact pill counts the newly taught rover-is-a-dog fact");

    const askedRow = await ask(page, "Does Rover bark?");
    const askedText = await askedRow.locator(".bubble").innerText();
    // the session id and timestamp in the taught-fact citation vary per run —
    // match on the stable parts, same discipline examples/rover-infer.mjs's
    // own normalization uses, adapted for a DOM text assertion.
    assert.match(askedText, /^yes — dog can bark \(source: corpus:human \/r\/CapableOf\) — via: rover is a kind of dog \(source: ace:chat:[0-9a-f-]{36}@\d{4}-\d{2}-\d{2}T[\d:.]+Z\)$/);
    assert.notEqual(await askedRow.locator(".bubble").getAttribute("class"), "bubble assistant miss", "a chained capability answer is not a miss");
  } finally {
    await context.close();
  }
});
