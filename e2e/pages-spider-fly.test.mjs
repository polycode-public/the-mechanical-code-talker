// spider-fly.html's own chat dock, driven directly (not through the home
// page's preview iframe) in a real browser: the addressee/direction pills
// fill #chatq without ever submitting on their own, free typing keeps
// working alongside them, and the phrase a pill composes is one the
// addressed teach-frame grammar genuinely accepts once the visitor presses
// Enter — never an honest miss.
//
// Third-party hosts are blocked for every run, exactly as in pages-home/
// pages-chat-fullscreen: the whole engine ships with the page, so nothing
// here needs the network.
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

async function openSpiderFlyPage({ viewport } = {}) {
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

  await page.goto(`${server.origin}/spider-fly.html`, { waitUntil: "networkidle" });
  // #chatq starts disabled and flips once the live session finishes booting —
  // the same signal the page's own boot() function uses.
  await page.waitForFunction(() => !document.querySelector("#chatq")?.disabled, null, { timeout: READY_TIMEOUT_MS });
  return { context, page, consoleErrors, failedRequests };
}

test("the @spider pill then the east direction pill compose a phrase the grammar accepts, and submitting it runs a real turn", async () => {
  const { context, page, consoleErrors, failedRequests } = await openSpiderFlyPage();
  try {
    await page.locator('#chatpills button[data-addressee="spider"]').click();
    assert.equal(await page.locator("#chatq").inputValue(), "@spider ", "the addressee pill sets the prefix, nothing else");

    await page.locator('#chatpills button[data-direction="east"]').click();
    assert.equal(await page.locator("#chatq").inputValue(), "@spider the fly is east", "the direction pill appends the composed phrase");

    const answersBefore = await page.locator("#chatlog .a").count();
    await page.locator("#chatq").press("Enter");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatlog .a").length > n,
      answersBefore,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const reply = await page.locator("#chatlog .a").last().innerText();
    assert.doesNotMatch(reply, /couldn't read a position from that/i, "the submitted phrase is not an honest miss");
    assert.match(reply, /Turn \d+/, "a real tick ran and reported a turn");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page logs no error of its own");
  } finally {
    await context.close();
  }
});

test("the @fly pill retexts the direction pills so the spider is the subject, and a click composes that phrase", async () => {
  const { context, page } = await openSpiderFlyPage();
  try {
    await page.locator('#chatpills button[data-addressee="fly"]').click();
    assert.equal(await page.locator('#chatpills button[data-direction="south"]').innerText(), "the spider is south");

    await page.locator('#chatpills button[data-direction="south"]').click();
    assert.equal(await page.locator("#chatq").inputValue(), "@fly the spider is south");
  } finally {
    await context.close();
  }
});

test("free typing in #chatq still works unchanged alongside the pills — the bare tick command runs a real turn", async () => {
  const { context, page } = await openSpiderFlyPage();
  try {
    await page.fill("#chatq", "tick");
    assert.equal(await page.locator("#chatq").inputValue(), "tick");

    const answersBefore = await page.locator("#chatlog .a").count();
    await page.locator("#chatq").press("Enter");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatlog .a").length > n,
      answersBefore,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const reply = await page.locator("#chatlog .a").last().innerText();
    assert.match(reply, /Turn \d+/, "typing still reaches the engine untouched by the pills");
  } finally {
    await context.close();
  }
});

test("no pill click ever submits the form on its own", async () => {
  const { context, page } = await openSpiderFlyPage();
  try {
    await page.locator('#chatpills button[data-addressee="spider"]').click();
    await page.locator('#chatpills button[data-direction="north"]').click();
    assert.equal(await page.locator("#chatlog .u").count(), 0, "no user turn line appears — the pill clicks only filled #chatq, they never submitted it");
  } finally {
    await context.close();
  }
});

test("the wide layout puts tuning left and chat right in the top row, chat above the agents HUD, and the board full-width below", async () => {
  const { context, page } = await openSpiderFlyPage({ viewport: { width: 1280, height: 900 } });
  try {
    const boxes = await page.evaluate(() => {
      const rect = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
      };
      return { tuning: rect(".tuning"), chat: rect(".chat"), hud: rect(".hud"), board: rect(".board-frame") };
    });
    assert.ok(boxes.tuning.right < boxes.chat.left, "the tuning console sits left of the chat column");
    assert.ok(boxes.tuning.width > boxes.chat.width * 2, "the tuning console takes the wide share of the top row");
    assert.ok(boxes.chat.bottom <= boxes.hud.top + 1, "the chat dock sits above the agents HUD");
    assert.ok(boxes.board.top >= boxes.tuning.bottom - 1, "the board sits below the tuning console");
    assert.ok(boxes.board.top >= boxes.chat.bottom - 1, "the board sits below the chat dock");
  } finally {
    await context.close();
  }
});

test("a phone-width viewport stacks the columns without horizontal overflow", async () => {
  const { context, page } = await openSpiderFlyPage({ viewport: { width: 375, height: 667 } });
  try {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    assert.equal(overflows, false, "no horizontal scroll at 375px");
    const stacked = await page.evaluate(() => {
      const tuning = document.querySelector(".tuning").getBoundingClientRect();
      const side = document.querySelector(".side").getBoundingClientRect();
      return tuning.bottom <= side.top + 1;
    });
    assert.equal(stacked, true, "the top row's two columns stack at phone width");
  } finally {
    await context.close();
  }
});

test("the chat pills are absent from the preview-mode render the home page's hero iframe embeds", async () => {
  const { context, page } = await openSpiderFlyPage();
  try {
    await page.goto(`${server.origin}/spider-fly.html?preview=1`, { waitUntil: "networkidle" });
    await page.waitForSelector("#board", { state: "visible" });
    assert.equal(await page.locator("#chatpills").isVisible(), false, "body.preview hides the whole chat dock, pills included");
  } finally {
    await context.close();
  }
});
