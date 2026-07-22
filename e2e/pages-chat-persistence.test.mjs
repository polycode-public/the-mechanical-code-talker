// chat.html's device persistence, driven in a real browser: a taught fact
// survives a page reload in the same browser context (IndexedDB), the boot
// line says so, and the forget-everything control genuinely starts over —
// after it, the same question is an honest miss again.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

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

test("export facts downloads the session's triple store as JSONL, and it round-trips back through tmct import --file", async () => {
  const { context, page } = await openChatPage();
  const repo = await mkdtemp(join(tmpdir(), "tmct-chat-export-"));
  try {
    const taughtRow = await ask(page, "zorbles are a kind of animal");
    assert.equal(await taughtRow.locator(".provchip").textContent(), "taught", "the teach landed before the export");

    const downloadPromise = page.waitForEvent("download", { timeout: ANSWER_TIMEOUT_MS });
    await page.click("#exportFacts");
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "tmct-facts.jsonl");
    const jsonl = readFileSync(await download.path(), "utf8");

    const records = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const zorble = records.find((r) => r.subject === "zorble");
    assert.ok(zorble, "the taught fact is present in the exported JSONL");
    assert.equal(zorble.predicate, "rdfs:subClassOf");
    assert.equal(zorble.object, "animal");
    assert.match(zorble.provenance, /teach:chat/, "the exported line carries the teach provenance");

    // The download re-imports through the CLI, then a fresh export off the
    // target proves the taught fact survived the round trip. (The dump carries
    // the whole seed, so we verify the fact in the re-exported file rather than
    // in the import's summary output.)
    const env = { ...process.env, TMCT_NO_SEED: "1" };
    const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", env });
    assert.equal(run("init").status, 0);
    await writeFile(join(repo, "facts.jsonl"), jsonl);
    const imp = run("import", "--file", "facts.jsonl");
    assert.equal(imp.status, 0, imp.stdout + imp.stderr);
    assert.match(imp.stdout, new RegExp(`${records.length} fact\\(s\\) imported, 0 declined`));

    assert.equal(run("memory", "--export", "back.jsonl").status, 0);
    const back = readFileSync(join(repo, "back.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const zorbleBack = back.find((r) => r.subject === "zorble");
    assert.ok(zorbleBack, "the taught fact survived the export → import → export round trip");
    assert.equal(zorbleBack.object, "animal");
    assert.match(zorbleBack.provenance, /teach:chat/);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await context.close();
  }
});
