// chat.html's transcript export and print: the export control downloads a
// Markdown file in the same shape the CLI/TUI's own .tmct/session-<id>.md
// writes — one heading per turn, the question as a blockquote, the answer in
// a fenced block — and print media expands the message column so the whole
// transcript prints, not just the scrolled-into-view slice.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
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

// The response logging stays: when the seed does fail, its status, length and
// encoding are the whole diagnosis, and they are gone by the time an assertion
// further down reports a missing phrase.
async function openChatPage() {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "warning" || msg.type() === "error") console.log(`[browser console ${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.log(`[browser pageerror] ${err}`));
  page.on("requestfailed", (req) => console.log(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`));
  page.on("response", (res) => {
    if (res.url().includes("chat-seed.json") || !res.ok()) {
      console.log(`[response] ${res.status()} ${res.url()} content-length=${res.headers()["content-length"] ?? "?"}`);
    }
  });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    console.log(`[route abort — off origin] ${route.request().url()}`);
    return route.abort();
  });
  await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  // Every test here drives a conversation whose answers come from the seed. If
  // the seed is not in, they all fail on a phrase that is missing for a reason
  // none of them can name.
  const seed = await requireSeedLoaded(page);
  return { context, page, seed };
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

test("export downloads a Markdown transcript in the shared session-log shape, every turn in order, the miss included", async () => {
  const { context, page } = await openChatPage();
  try {
    await driveConversation(page);

    const downloadPromise = page.waitForEvent("download", { timeout: ANSWER_TIMEOUT_MS });
    await page.click("#exportMd");
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "tmct-chat.md");
    const md = readFileSync(await download.path(), "utf8");

    assert.match(md.split("\n")[0], /^# tmct chat \S+ — session [0-9a-f]{0,8}$/, "the title line carries the site version and a short session id");
    assert.match(md, /### \d{2}:\d{2}:\d{2}\.\d{3} · turn 1\n\n> what is a dog\n\n```text\n/, "turn 1 is a heading, a verbatim blockquote, then a fenced block");

    // Every turn's own needle, in order — the fenced block means a role
    // label no longer prefixes the reply, so each needle is the turn's own
    // content (the question, or a phrase from its answer).
    const turns = ["> what is a dog", "dog is a kind of animal", "> every zorbnug is a dog", "noted", "> what is a zorblatt", "I don't know \"zorblatt\" yet"];
    let cursor = -1;
    for (const needle of turns) {
      const at = md.indexOf(needle, cursor + 1);
      assert.ok(at > cursor, `"${needle}" appears, after the previous turn (index ${at})`);
      cursor = at;
    }
    // No closing session-end marker — the export can happen mid-conversation.
    assert.ok(!/session end/.test(md), "an export carries no session-end line — the session hasn't closed");
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
