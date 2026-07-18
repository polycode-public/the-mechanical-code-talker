// The home page's embedded chat, driven in a real browser: the full engine
// boots from the built bundle + seed, free chat answers with provenance and
// misses honestly, and the syllogist demo replays scripted turns into a live
// session that stays usable afterwards.
//
// Third-party hosts are blocked for every run, exactly as in pages-home: the
// wink lemma/POS tier degrades and the chat must still answer — the engine
// and its memory ship with the page.
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

async function openChatPage({ viewport } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];

  await page.route("**/*", (route) => {
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
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return { context, page, consoleErrors, failedRequests };
}

/** Type a question into the live input and return the reply line it prints. */
async function ask(page, question) {
  const replies = page.locator("#tmct-chat .chat-log > div.chat-answer, #tmct-chat .chat-log > div.chat-miss");
  const seen = await replies.count();
  await page.fill("#tmct-chat .chat-input", question);
  await page.press("#tmct-chat .chat-input", "Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#tmct-chat .chat-log > div.chat-answer, #tmct-chat .chat-log > div.chat-miss").length > n,
    seen,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  return replies.last().innerText();
}

test("free chat: a seeded vocabulary question answers with its corpus source, wink degraded or not", async () => {
  const { context, page } = await openChatPage();
  try {
    const reply = await ask(page, "what is a dog");
    assert.match(reply, /dog is a kind of animal \(source: corpus:/, "the answer is grounded and names its source");
  } finally {
    await context.close();
  }
});

test("free chat: an unknown term gets the honest miss", async () => {
  const { context, page } = await openChatPage();
  try {
    const reply = await ask(page, "what is a zorblatt");
    assert.match(reply, /I don't know "zorblatt" yet/, "the engine refuses rather than guessing");
  } finally {
    await context.close();
  }
});

test("the syllogist demo runs scripted turns through a live session and proves the inference; the input works afterwards", async () => {
  const { context, page } = await openChatPage();
  try {
    const started = await page.evaluate(() => window.tmctRunDemo("syllogist"));
    await page.waitForSelector('#tmct-chat[data-demo-state="done"]', { timeout: ANSWER_TIMEOUT_MS });
    assert.equal(started, true, "the demo driver accepted the run");

    const answers = page.locator("#tmct-chat .chat-log > div.chat-answer");
    const finalAnswer = await answers.last().innerText();
    assert.match(finalAnswer, /^yes — /, "the syllogism resolves to yes");
    assert.match(finalAnswer, /rex is a kind of dog \(source: teach:chat/, "the proof cites the taught premise");
    assert.match(finalAnswer, /so rex is a mammal/, "the proof states the conclusion");

    assert.equal(await page.locator("#tmct-chat .chat-input").isDisabled(), false, "the input re-enables after the demo");
    const followUp = await ask(page, "is rex a dog");
    assert.match(followUp, /^yes — /, "the demo's session stays live for follow-up questions");
  } finally {
    await context.close();
  }
});

test("the demo rail lists the coming demos as disabled and only runnable ones as enabled", async () => {
  const { context, page } = await openChatPage();
  try {
    assert.equal(await page.locator('#tmct-chat .chat-demo-rail button[data-demo-id="syllogist"]').isDisabled(), false);
    for (const id of ["guess-number", "learn-on-miss"]) {
      assert.equal(await page.locator(`#tmct-chat .chat-demo-rail button[data-demo-id="${id}"]`).isDisabled(), true, `${id} stays disabled until its capability ships`);
    }
    const refused = await page.evaluate(() => window.tmctRunDemo("guess-number"));
    assert.equal(refused, false, "the driver refuses a demo that isn't ready");
  } finally {
    await context.close();
  }
});

test("the chat page serves every same-origin asset and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openChatPage();
  try {
    await ask(page, "what is a dog");
    assert.deepEqual(failedRequests, [], "every same-origin request resolves");
    assert.deepEqual(consoleErrors, [], "the page and the chat log no errors of their own");
  } finally {
    await context.close();
  }
});

test("the chat fits a phone viewport without sideways scrolling", async () => {
  const { context, page } = await openChatPage({ viewport: { width: 375, height: 667 } });
  try {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
    await page.locator("#tmct-chat").waitFor({ state: "visible" });
  } finally {
    await context.close();
  }
});
