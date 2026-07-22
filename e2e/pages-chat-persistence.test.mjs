// chat.html's device persistence, driven in a real browser: a taught fact
// survives a page reload in the same browser context (IndexedDB), the boot
// line says so, and the forget-everything control genuinely starts over —
// after it, the same question is an honest miss again. The export/import
// round trip over the full seeded store is a separate, much slower case —
// see e2e/heavy/chat-export-seed-scale.test.mjs.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;
const SAVE_TIMEOUT_MS = 20_000;

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

async function awaitChatReady(page) {
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
}

async function openChatPage() {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
  await awaitChatReady(page);
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

const waitForSave = (page) =>
  page.waitForFunction(() => window.tmctChatLastSave, null, { timeout: SAVE_TIMEOUT_MS });

const bootLineOf = (page) => page.locator("#messages .msg-row.system").first().innerText();

test("a taught fact survives a reload in the same context: the boot line reports the restore and the recall still cites the teach", async () => {
  const { context, page } = await openChatPage();
  try {
    const taughtRow = await ask(page, "zorbles are a kind of animal");
    assert.equal(await taughtRow.locator(".provchip").textContent(), "taught", "the teach landed before the reload");

    await waitForSave(page);
    const save = await page.evaluate(() => window.tmctChatLastSave);
    console.log(`chat persistence: full-seed payload snapshot saved in ${save.ms}ms`);

    await page.reload({ waitUntil: "networkidle" });
    await awaitChatReady(page);

    const bootLine = await bootLineOf(page);
    assert.match(bootLine, /Restored 1 taught fact /, "the boot line names the restored fact count");
    assert.match(bootLine, /state kept best-effort on this device/);

    const recallRow = await ask(page, "what is a zorble");
    const recallText = await recallRow.locator(".bubble").innerText();
    assert.match(recallText, /source: teach:chat/, "the restored fact still carries its teach provenance");
    assert.equal(await recallRow.locator(".provchip").textContent(), "taught");
  } finally {
    await context.close();
  }
});

test("forget everything clears the device store: after a reload nothing restores and the taught term is an honest miss again", async () => {
  const { context, page } = await openChatPage();
  try {
    await ask(page, "zorbles are a kind of animal");
    await waitForSave(page);

    const systemLines = page.locator("#messages .msg-row.system");
    const seenSystem = await systemLines.count();
    await page.click("#forgetEverything");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#messages .msg-row.system").length > n,
      seenSystem,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    assert.match(await systemLines.last().innerText(), /forgot everything taught on this device/);

    await page.reload({ waitUntil: "networkidle" });
    await awaitChatReady(page);

    const bootLine = await bootLineOf(page);
    assert.doesNotMatch(bootLine, /Restored/, "nothing restores after the store was cleared");

    const missRow = await ask(page, "what is a zorble");
    assert.match(await missRow.locator(".bubble").innerText(), /I don't know "zorble" yet/, "the engine refuses again rather than remembering the forgotten fact");
    assert.equal(await missRow.locator(".bubble").getAttribute("class"), "bubble assistant miss");
    assert.equal(await missRow.locator(".provchip").count(), 0);
  } finally {
    await context.close();
  }
});

test("reset to seed is a full re-initialisation: it drops the persisted store, reloads, and the taught fact is gone and stays gone", async () => {
  const { context, page } = await openChatPage();
  try {
    await ask(page, "zorbles are a kind of animal");
    await waitForSave(page);

    // The full re-init reloads the page, so wait for the fresh document.
    const reloaded = page.waitForEvent("load");
    await page.click("#reinitStore");
    await reloaded;
    await awaitChatReady(page);

    const bootLine = await bootLineOf(page);
    assert.doesNotMatch(bootLine, /Restored/, "the reset dropped the saved payload — nothing restores on the reload it triggers");

    const missRow = await ask(page, "what is a zorble");
    assert.match(await missRow.locator(".bubble").innerText(), /I don't know "zorble" yet/, "the taught fact is gone after the full re-init");

    // Gone for good: a further manual reload still finds a clean, unrestored store.
    await page.reload({ waitUntil: "networkidle" });
    await awaitChatReady(page);
    assert.doesNotMatch(await bootLineOf(page), /Restored/, "the store stays empty across a later reload");
  } finally {
    await context.close();
  }
});
