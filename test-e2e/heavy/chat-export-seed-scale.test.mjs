// chat.html's export dump carries the whole seeded store, not just what was
// taught this session — tens of thousands of facts — so round-tripping it
// through a real `tmct import --file` and back out again is the slow half of
// pages-chat-persistence.test.mjs's own coverage (that file keeps the fast
// reload/forget/reset cases). Same browser fixture, split out so it stops
// costing every per-push run.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "../helpers/demo-site.mjs";
import { serveDirectory } from "../helpers/static-server.mjs";

const BIN = fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));

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
  const context = await browser.newContext({ acceptDownloads: true });
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
