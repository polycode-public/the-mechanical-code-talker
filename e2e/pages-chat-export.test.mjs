// chat.html's transcript export and print: the export control downloads a
// Markdown file carrying every turn in order (misses included) with role
// labels and provenance tiers, and print media expands the message column so
// the whole transcript prints, not just the scrolled-into-view slice.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
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

/** Submit a question through the live composer and wait for its answer to settle. */
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

/** Three turns covering the tiers export must label: a corpus answer, a
 *  taught confirmation, and an honest miss. */
async function driveConversation(page) {
  await ask(page, "what is a dog");
  await ask(page, "every zorbnug is a dog");
  await ask(page, "what is a zorblatt");
}

test("export downloads a Markdown transcript with every turn in order, role-labelled, tiers in parentheses, the miss included", async () => {
  const { context, page } = await openChatPage();
  try {
    await driveConversation(page);

    const downloadPromise = page.waitForEvent("download", { timeout: ANSWER_TIMEOUT_MS });
    await page.click("#exportMd");
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "tmct-chat.md");
    const md = readFileSync(await download.path(), "utf8");

    assert.match(md.split("\n")[0], /^# tmct chat — v.+ — \d{4}-\d{2}-\d{2}$/, "the title line carries the site version and the export date");

    // The miss is a multi-line answer (a code-graph decline, then the
    // refusal), so its needle is the refusal sentence itself rather than a
    // role-label prefix; order still pins every turn to its place.
    const turns = [
      ["**you:** what is a dog", null],
      ["**tmct:** dog is a kind of animal", "corpus"],
      ["**you:** every zorbnug is a dog", null],
      ["**tmct:** noted", "taught"],
      ["**you:** what is a zorblatt", null],
      ["**tmct:** ", null],
      ["I don't know \"zorblatt\" yet", null],
    ];
    let cursor = -1;
    for (const [needle, tier] of turns) {
      const at = md.indexOf(needle, cursor + 1);
      assert.ok(at > cursor, `"${needle}" appears, after the previous turn (index ${at})`);
      cursor = at;
      if (tier) {
        const paragraph = md.slice(at, md.indexOf("\n**", at + 1) === -1 ? md.length : md.indexOf("\n**", at + 1));
        assert.match(paragraph, new RegExp(`\\(${tier}\\)`), `the ${tier} tier is named in parentheses on its turn`);
      }
    }
    const lastLine = md.trimEnd().split("\n").at(-1);
    assert.ok(!/\((?:taught|corpus|entailed)\)$/.test(lastLine), "the miss turn carries no tier parenthetical");
  } finally {
    await context.close();
  }
});

test("ingest file teaches every recognized fact into the session, skips the rest, and answers from what it just learned", async () => {
  const { context, page } = await openChatPage();
  try {
    const systemLines = () => page.locator("#messages .msg-row.system .bubble");
    const seen = await systemLines().count();
    await page.setInputFiles("#ingestInput", {
      name: "creatures.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A zorblax is a kind of gribbit. Is this a fact? A gribbit is a kind of creature."),
    });
    await page.waitForFunction(
      (n) => document.querySelectorAll("#messages .msg-row.system .bubble").length > n,
      seen,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const summary = await systemLines().last().innerText();
    assert.match(summary, /ingested creatures\.txt/, "the summary names the file");
    assert.match(summary, /3 sentences read, 2 facts added, 1 skipped/, "only the two fact sentences ground; the question is skipped honestly");

    const answer = await ask(page, "what is a zorblax");
    assert.match(await answer.locator(".bubble").innerText(), /zorblax is a kind of gribbit/, "an ingested fact answers straight away from the session's own memory");
  } finally {
    await context.close();
  }
});

test("print media expands the whole transcript — no fixed-height scroll clip — and hides the composer, statusline, stats panel and legend", async () => {
  const { context, page } = await openChatPage();
  try {
    await driveConversation(page);

    await page.emulateMedia({ media: "print" });
    const layout = await page.evaluate(() => {
      const chatMain = document.querySelector("main.chatMain");
      const visible = (sel) => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node).display !== "none" : null;
      };
      return {
        overflowY: getComputedStyle(chatMain).overflowY,
        clip: chatMain.scrollHeight - chatMain.clientHeight,
        composerVisible: visible("form.composer"),
        statuslineVisible: visible(".statusline"),
        statsPanelVisible: visible(".statsPanel"),
        legendVisible: visible(".legend"),
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    assert.equal(layout.overflowY, "visible", "the message column no longer scrolls in print");
    assert.ok(layout.clip <= 1, `the transcript is fully expanded (clipped by ${layout.clip}px)`);
    assert.equal(layout.composerVisible, false, "the composer does not print");
    assert.equal(layout.statuslineVisible, false, "the statusline does not print");
    assert.equal(layout.statsPanelVisible, false, "the stats panel does not print");
    assert.equal(layout.legendVisible, false, "the topbar legend does not print");
    assert.equal(layout.bodyOverflow, "visible", "the body itself can flow across pages");

    // Every settled turn's text sits in the print layout, first to last —
    // nothing virtualized away or clipped out of the printable flow.
    const transcriptPresent = await page.evaluate(() => {
      const texts = [...document.querySelectorAll("#messages .bubble")].map((b) => b.textContent);
      return texts.length >= 7 && texts.every((t) => t.trim().length > 0);
    });
    assert.ok(transcriptPresent, "every bubble's text is present in the print layout");

    const printCalls = await page.evaluate(() => {
      let calls = 0;
      window.print = () => { calls += 1; };
      document.getElementById("printChat").click();
      return calls;
    });
    assert.equal(printCalls, 1, "the print control invokes the print dialog");
  } finally {
    await context.close();
  }
});
