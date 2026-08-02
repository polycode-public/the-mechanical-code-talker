// The ingest page in a real browser: it seeds from chat.html's own starter
// memory by default (a docked "this session's memory" panel to prove it),
// pasted text grounds into canonical facts live in the right pane against a
// PERSISTENT session (a second ingest extends the same memory, it never
// starts over), the honest skip count is reported, the canonical facts
// download as JSONL, taught facts survive a reload (IndexedDB), forget
// everything and reset to seed both genuinely start over, the seed toggle's
// off path skips the seed fetch entirely, and the page survives a
// phone-sized viewport in both color schemes. Drives public/ingest.html
// directly, third-party hosts blocked, the same posture pages-ledger.test.mjs
// holds.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { waitForSeedState } from "./helpers/seed-state.mjs";

const READY_TIMEOUT_MS = 30_000;
const GROUND_TIMEOUT_MS = 20_000;
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

/** Open ingest.html with third-party hosts blocked and every request
 *  recorded. `seedPref` (optional) pre-sets the seed-toggle preference in
 *  localStorage before the page's own boot script runs, so a test can drive
 *  the seed-off fast path without first clicking the toggle through a seeded
 *  boot. Waits for the engine to boot either way. */
async function openIngestPage({ viewport, colorScheme, seedPref, acceptDownloads } = {}) {
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ...(colorScheme ? { colorScheme } : {}),
    ...(acceptDownloads ? { acceptDownloads: true } : {}),
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const requestedUrls = [];

  await page.route("**/*", (route) => {
    requestedUrls.push(route.request().url());
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const source = msg.location()?.url ?? "";
    if (source && !source.startsWith(server.origin)) return;
    consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  if (seedPref) await page.addInitScript((pref) => localStorage.setItem("tmct.ingest.seed", pref), seedPref);

  await page.goto(`${server.origin}/ingest.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.tmctIngestReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctIngestReady);
  // Boot resolving does not mean the starter memory is in — it resolves just
  // the same when the seed fetch failed, which is what every test below would
  // otherwise report as an unexplained zero.
  const seed = await waitForSeedState(page);
  return { context, page, consoleErrors, failedRequests, requestedUrls, seed };
}

const SAMPLE = "Zorbles are a kind of animal. How are you today? Zorbles are closely connected with wodgetry.[7]";

const bandRowLabels = (page) => page.locator("#statsPanel .band-row span:first-child").allInnerTexts();
const taughtItemCount = (page) => page.locator("#statsPanel .taught-item").count();
const statsTotal = (page) => page.locator("#statsPanel .band-row").first().locator(".band-count").innerText();

const waitForFacts = (page, n) =>
  page.waitForFunction((count) => document.querySelectorAll("#facts .fact").length >= count, n, { timeout: GROUND_TIMEOUT_MS });
const waitForSave = (page) =>
  page.waitForFunction(() => window.tmctIngestLastSave, null, { timeout: SAVE_TIMEOUT_MS });

test("the ingest page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openIngestPage();
  try {
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.match(await page.title(), /ingest/);
    assert.equal(await page.locator("#ingestBtn").isDisabled(), true, "ingest stays disabled until there is text");
  } finally {
    await context.close();
  }
});

test("seeded boot (the default) shows band rows and a nonzero total in the docked stats panel", async () => {
  const { context, page, seed } = await openIngestPage();
  try {
    assert.equal(await page.locator("#seedToggle").isChecked(), true, "the seed toggle ships checked");
    // The seed's own state first: a zero total means either a load that failed
    // or a store that is empty on purpose, and only this can say which.
    assert.equal(seed.state, "ready", `the starter memory never loaded — state "${seed.state}"${seed.error ? `, reason: ${seed.error}` : ""}`);
    assert.ok(seed.facts > 100, `the loaded seed carries a real fact count, got ${seed.facts}`);
    const total = Number((await statsTotal(page)).replace(/[^\d]/g, ""));
    assert.ok(total > 100, `expected a real starter-memory total, got ${total}`);
    const labels = await bandRowLabels(page);
    assert.ok(labels.length > 2, "more than just the total-facts row renders");

    const pillValue = Number((await page.locator("#factPillValue").innerText()).replace(/[^\d]/g, ""));
    assert.equal(pillValue, total, "the header fact pill tracks the same total the docked stats panel shows");
  } finally {
    await context.close();
  }
});

test("the seed toggle off skips the chat-seed.json fetch entirely and boots an empty store", async () => {
  const { context, page, requestedUrls, seed } = await openIngestPage({ seedPref: "off" });
  try {
    assert.equal(await page.locator("#seedToggle").isChecked(), false, "the stored preference is honored before boot");
    assert.ok(!requestedUrls.some((u) => u.includes("chat-seed.json")), "the seed asset is never requested when the toggle starts off");
    assert.equal(seed.state, "skipped", "an empty store on purpose reports itself as skipped, never as a failed load");
    assert.equal(await statsTotal(page), "0", "an unseeded session starts with zero facts");
  } finally {
    await context.close();
  }
});

test("pasted text grounds into canonical facts live, citation residue is stripped, and the honest skip count is reported", async () => {
  const { context, page, consoleErrors } = await openIngestPage();
  try {
    const pillBefore = Number((await page.locator("#factPillValue").innerText()).replace(/[^\d]/g, ""));

    await page.fill("#source", SAMPLE);
    assert.equal(await page.locator("#ingestBtn").isDisabled(), false, "text enables the ingest button");

    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 2);

    const rows = await page.locator("#facts .fact").evaluateAll((els) => els.map((el) => ({
      subject: el.querySelector(".subj")?.textContent ?? "",
      predicate: el.querySelector(".pred")?.textContent ?? "",
      object: el.querySelector(".obj")?.textContent ?? "",
    })));
    assert.equal(rows.length, 2, "two of the four split sentences ground; the question and the orphan citation marker are skipped");
    assert.ok(rows.some((r) => /^zorbles?$/.test(r.subject) && r.predicate === "rdfs:subClassOf" && r.object === "animal"), "zorbles are a kind of animal is grounded");
    assert.ok(rows.some((r) => /^zorbles?$/.test(r.subject) && r.predicate === "mgx:connected-with" && r.object === "wodgetry"), "the [7] citation marker never blocks the connected-with read");
    assert.ok(!rows.some((r) => /\[|\]|7/.test(r.object) || /\[|\]|7/.test(r.subject)), "no citation residue rides into a stored term");

    assert.match(await page.locator("#factCount").innerText(), /2 facts/, "the pane counts the grounded facts");
    assert.match(
      await page.locator("#status").innerText(),
      /4 sentences read, 2 grounded, 2 skipped/,
      "the skip is reported honestly, never hidden or guessed at",
    );
    const pillAfter = Number((await page.locator("#factPillValue").innerText()).replace(/[^\d]/g, ""));
    assert.equal(pillAfter, pillBefore + 2, "the header fact pill grows by exactly the two newly grounded facts");
    assert.deepEqual(consoleErrors, [], "grounding logs no error");
  } finally {
    await context.close();
  }
});

test("a second ingest extends the same persistent session rather than starting over", async () => {
  const { context, page } = await openIngestPage();
  try {
    await page.fill("#source", "Zorbles are a kind of animal.");
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 1);
    await page.waitForFunction(() => document.querySelectorAll("#statsPanel .taught-item").length >= 1, null, { timeout: GROUND_TIMEOUT_MS });

    await page.fill("#source", "Wodgets are a kind of tool.");
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 1);

    // The right pane shows only THIS run's fact, but the docked panel's
    // taught list (this session's whole memory) carries both.
    const rows = await page.locator("#facts .fact .subj").allInnerTexts();
    assert.deepEqual(rows, ["wodget"], "the facts pane only shows the current ingest's own grounded rows");
    await page.waitForFunction(() => document.querySelectorAll("#statsPanel .taught-item").length >= 2, null, { timeout: GROUND_TIMEOUT_MS });
    const taughtText = await page.locator("#statsPanel").innerText();
    assert.match(taughtText, /zorble/, "the first ingest's fact is still in this session's memory");
    assert.match(taughtText, /wodget/, "the second ingest's fact joined it, not replaced it");
  } finally {
    await context.close();
  }
});

test("the canonical facts download as JSONL in the extract shape", async () => {
  const { context, page } = await openIngestPage({ acceptDownloads: true });
  try {
    await page.fill("#source", SAMPLE);
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 2);
    assert.equal(await page.locator("#downloadBtn").isDisabled(), false, "grounded facts enable the download");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#downloadBtn").click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");

    const records = body.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const rec of records) {
      assert.ok(rec.subject && rec.predicate && rec.object, "each line carries a full triple");
      assert.equal(typeof rec.provenance, "string", "each line names its provenance");
    }
    assert.ok(records.some((r) => /^zorbles?$/.test(r.subject) && r.object === "animal"), "the download carries the grounded triple, drawn from the whole session's store");
  } finally {
    await context.close();
  }
});

test("clear empties the input and the current-run facts pane, but the underlying session's memory is untouched", async () => {
  const { context, page } = await openIngestPage();
  try {
    await page.fill("#source", SAMPLE);
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 2);

    await page.locator("#clearBtn").click();
    assert.equal(await page.locator("#source").inputValue(), "", "the input clears");
    assert.equal(await page.locator("#facts .fact").count(), 0, "the facts pane clears");
    assert.equal(await page.locator("#facts .empty").count(), 1, "the empty note returns");
    assert.equal(await page.locator("#downloadBtn").isDisabled(), false, "download stays enabled — the persistent session still holds what it grounded");

    const taughtText = await page.locator("#statsPanel").innerText();
    assert.match(taughtText, /zorble/, "clear never wipes what the session already grounded");
  } finally {
    await context.close();
  }
});

test("the mode pills switch between Text and Document, and Document reveals the browse control", async () => {
  const { context, page } = await openIngestPage();
  try {
    assert.equal(await page.locator("#modeText").getAttribute("aria-pressed"), "true", "Text is the default mode");
    await page.locator("#modeDoc").click();
    assert.equal(await page.locator("#modeDoc").getAttribute("aria-pressed"), "true", "Document becomes active");
    assert.equal(await page.locator("#browseBtn").isVisible(), true, "Document mode shows the browse control");
  } finally {
    await context.close();
  }
});

test("the fuzzy tier ships off by default, and turning it on grounds a low-trust candidate a strict miss would skip", async () => {
  const { context, page } = await openIngestPage();
  const FUZZY_ONLY_SENTENCE = "A quombat is basically a wodget.";
  try {
    assert.equal(await page.locator("#fuzzyToggle").isChecked(), false, "off by default");

    // A copula flanked by two resolvable nouns, but not one of the strict
    // recognizer's own known shapes — the fuzzy tier's own narrow candidate.
    await page.fill("#source", FUZZY_ONLY_SENTENCE);
    await page.locator("#ingestBtn").click();
    await page.waitForFunction(() => /skipped|grounded/.test(document.querySelector("#status").textContent), null, { timeout: GROUND_TIMEOUT_MS });
    assert.equal(await page.locator("#facts .fact").count(), 0, "the strict recognizer alone skips this shape");

    await page.locator("#fuzzyToggle").click();
    await page.fill("#source", FUZZY_ONLY_SENTENCE);
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 1);
    const rows = await page.locator("#facts .fact").evaluateAll((els) => els.map((el) => ({
      subject: el.querySelector(".subj")?.textContent ?? "",
      object: el.querySelector(".obj")?.textContent ?? "",
      prov: el.querySelector(".prov")?.textContent ?? "",
    })));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "quombat");
    assert.equal(rows[0].object, "wodget");
    assert.match(rows[0].prov, /optimistic-extract/, "a fuzzy-tier row always carries the low-trust tag");
  } finally {
    await context.close();
  }
});

test("forget everything resets the docked panel to the fresh seed without a page reload", async () => {
  const { context, page } = await openIngestPage();
  try {
    const before = Number((await statsTotal(page)).replace(/[^\d]/g, ""));
    await page.fill("#source", "Zorbles are a kind of animal.");
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 1);
    await page.waitForFunction(() => document.querySelectorAll("#statsPanel .taught-item").length >= 1, null, { timeout: GROUND_TIMEOUT_MS });

    const readyBefore = await page.evaluate(() => window.tmctIngestReady);
    await page.click("#forgetEverything");
    await page.waitForFunction(() => document.querySelectorAll("#statsPanel .taught-item").length === 0, null, { timeout: GROUND_TIMEOUT_MS });
    assert.match(await page.locator("#status").innerText(), /forgot everything taught on this device/);

    const after = Number((await statsTotal(page)).replace(/[^\d]/g, ""));
    assert.equal(after, before, "back to exactly the fresh seed's own total, no taught facts riding along");
    const readyAfter = await page.evaluate(() => window.tmctIngestReady);
    assert.equal(readyBefore, readyAfter, "no reload happened — the same boot promise is still the one that resolved");
  } finally {
    await context.close();
  }
});

test("reset to seed is a full re-initialisation: it clears the persisted store and reloads", async () => {
  const { context, page } = await openIngestPage({ acceptDownloads: true });
  try {
    await page.fill("#source", "Zorbles are a kind of animal.");
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 1);
    await waitForSave(page);

    const reloaded = page.waitForEvent("load");
    await page.click("#reinitStore");
    await reloaded;
    await page.waitForFunction(() => window.tmctIngestReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => window.tmctIngestReady);

    assert.doesNotMatch(await page.locator("#status").innerText(), /restored from your last visit/, "the reset dropped the saved payload before the reload it triggers");
    assert.equal(await taughtItemCount(page), 0, "nothing taught survives the reset");
  } finally {
    await context.close();
  }
});

test("a taught fact survives a reload in the same browser context (IndexedDB)", async () => {
  const { context, page } = await openIngestPage();
  try {
    await page.fill("#source", "Zorbles are a kind of animal.");
    await page.locator("#ingestBtn").click();
    await waitForFacts(page, 1);
    await waitForSave(page);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.tmctIngestReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => window.tmctIngestReady);

    assert.match(await page.locator("#status").innerText(), /restored from your last visit/i, "the boot line names the restore");
    const taughtText = await page.locator("#statsPanel").innerText();
    assert.match(taughtText, /zorble/, "the restored fact is still in this session's memory");
  } finally {
    await context.close();
  }
});

test("the ingest page fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await openIngestPage({ viewport: { width: 375, height: 812 }, colorScheme });
    try {
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${colorScheme}: the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
      );
    } finally {
      await context.close();
    }
  }
});
