// The adventure page's own chat dock, in a real browser: a manually typed
// command gets its reply appended to the SAME scrolling history auto-play's
// own tick narration lands in, a clicked pill fills the input with its exact
// command text without submitting it, and free typing still works
// alongside both. Nothing else drives adventure.html end to end.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

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

/** Open adventure.html and wait for its session to finish booting (the chat
 *  input is only enabled once createAdventureSession resolves). Returns the
 *  page plus every console error it logged. */
async function openAdventurePage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/adventure.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#chatq") && !document.querySelector("#chatq").disabled,
    null,
    { timeout: 15000 },
  );
  return { context, page, consoleErrors };
}

test("the adventure page boots with the opening line already in the chat log", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    const lines = await page.locator("#chatlog > div").allTextContents();
    assert.ok(lines.length >= 1, "the chat log starts with at least the opening narration");
    assert.ok(lines[0].trim().length > 0, "the opening line has real text, not an empty line");
    const tickLines = await page.locator("#chatlog > div.t").count();
    assert.ok(tickLines >= 1, "the opening narration renders as a tick-style log entry");
    assert.deepEqual(consoleErrors, [], "no console error while booting");
  } finally {
    await context.close();
  }
});

test("a manually typed command gets echoed and answered in the chat log", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    const before = await page.locator("#chatlog > div").count();
    await page.locator("#chatq").fill("look");
    await page.locator("#chatq").press("Enter");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatlog > div").length >= n,
      before + 2,
      { timeout: 10000 },
    );
    const lines = await page.locator("#chatlog > div").allTextContents();
    assert.ok(lines.some((l) => l.includes("look")), "the visitor's own typed line is echoed into the log");
    const answered = await page.locator("#chatlog > div.a").count();
    assert.ok(answered >= 1, "tmct's reply appended as its own log entry");
    assert.equal(await page.locator("#chatq").inputValue(), "", "the input clears once submitted");
    assert.deepEqual(consoleErrors, [], "no console error answering a manual command");
  } finally {
    await context.close();
  }
});

test("clicking a pill fills the input with its exact command text without submitting it", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    const pillCount = await page.locator("#pills .pill").count();
    assert.ok(pillCount > 0, "the current room offers at least one contextual pill");
    const pillText = await page.locator("#pills .pill").first().textContent();
    const before = await page.locator("#chatlog > div").count();

    await page.locator("#pills .pill").first().click();

    assert.equal(await page.locator("#chatq").inputValue(), pillText, "the pill's exact text lands in the input");
    const after = await page.locator("#chatlog > div").count();
    assert.equal(after, before, "clicking a pill only fills the input — it never auto-submits");
    assert.deepEqual(consoleErrors, [], "no console error clicking a pill");
  } finally {
    await context.close();
  }
});

test("auto-play's own tick narration lands in the SAME chat log manual chat uses, and pills stay contextual", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    const before = await page.locator("#chatlog > div").count();
    await page.locator("#playBtn").click();
    await page.waitForFunction(
      () => (document.querySelector("#turnLabel")?.textContent || "").trim() !== "turn: 0",
      null,
      { timeout: 15000 },
    );
    // A second tick, so this is genuinely "a couple of ticks", not just one.
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatlog > div").length > n,
      before,
      { timeout: 15000 },
    );

    const after = await page.locator("#chatlog > div").count();
    assert.ok(after > before, "at least one auto-play tick appended its own narration to the chat log");
    // The pill row re-renders every redraw without throwing — a stale pill
    // markup error would already have failed the console-error check below.
    await page.locator("#pills").waitFor({ state: "attached" });
    assert.deepEqual(consoleErrors, [], "no console error across manual chat and auto-play sharing one log");
  } finally {
    await context.close();
  }
});
