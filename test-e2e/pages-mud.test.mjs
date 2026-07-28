// mud.html's own shared-world dock, in a real browser: on load only the NW
// window's own character is auto-playing while the other three sit paused, a
// manually typed command in one window updates only THAT window's own chat
// log with a real (not honest-miss) answer, clicking the rail's #autoToggle
// starts every window playing and the shared global turn counter advances,
// and a deterministic "dig south" opens a new room on the omniscient world
// map. Mirrors pages-adventure.test.mjs's/pages-spider-fly.test.mjs's own
// fixture setup and assertion style exactly.
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

/** Open mud.html and wait for its shared session to finish booting — every
 *  window's own chat input starts disabled and flips once boot() resolves,
 *  the same signal every other tmct page's own chat input uses. Third-party
 *  hosts are blocked and same-origin console errors/failed requests are
 *  tracked, exactly as pages-spider-fly.test.mjs's own openSpiderFlyPage
 *  does — the whole engine ships with the page, so nothing here needs the
 *  network. */
async function openMudPage() {
  const context = await browser.newContext();
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

  await page.goto(`${server.origin}/mud.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#window-nw-chatq") && !document.querySelector("#window-nw-chatq").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors, failedRequests };
}

/** Type and submit one command into a given window's own chat dock (Enter
 *  submits the window's <form>, exactly like adventure.html's #chatq), and
 *  wait for both the visitor's own echoed line and tmct's reply to land. */
async function sendMudCommand(page, slot, text) {
  const logSelector = `#window-${slot}-chatlog > div`;
  const before = await page.locator(logSelector).count();
  await page.locator(`#window-${slot}-chatq`).fill(text);
  await page.locator(`#window-${slot}-chatq`).press("Enter");
  await page.waitForFunction(
    ({ sel, n }) => document.querySelectorAll(sel).length >= n,
    { sel: logSelector, n: before + 2 },
    { timeout: ANSWER_TIMEOUT_MS },
  );
}

/** Pause a window's own auto-play (the play button toggles play/pause on
 *  every click, same as clicking it once more mid-play) so a later manual
 *  command's own result reads deterministically, undisturbed by that
 *  window's own concurrent auto-ticks moving its character around. */
async function pauseWindow(page, slot) {
  await page.locator(`#window-${slot}-play`).click();
  await page.waitForFunction(
    (sel) => (document.querySelector(sel)?.textContent ?? "").includes("play"),
    `#window-${slot}-play`,
    { timeout: ANSWER_TIMEOUT_MS },
  );
}

test("the page boots with all four windows visible, and only the NW window's own character auto-playing", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    for (const slot of ["nw", "ne", "sw", "se"]) {
      assert.equal(await page.locator(`#window-${slot}`).isVisible(), true, `window-${slot} is visible on load`);
    }
    assert.deepEqual(
      await Promise.all(["nw", "ne", "sw", "se"].map((slot) => page.locator(`#window-${slot}`).getAttribute("data-character"))),
      ["mole-1", "vole-1", "badger-2", "groundhog-1"],
      "each window carries its own distinct character in NW/NE/SW/SE order",
    );

    assert.match(
      await page.locator("#window-nw-play").textContent(),
      /pause/i,
      "the NW window's own play control reads as active on load",
    );
    for (const slot of ["ne", "sw", "se"]) {
      assert.match(
        await page.locator(`#window-${slot}-play`).textContent(),
        /play/i,
        `the ${slot} window starts paused, per the page's own default`,
      );
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error while booting four independent windows over one shared world");
  } finally {
    await context.close();
  }
});

test("a manually typed command in one window updates only that window's own chat log with a real, sane answer", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await pauseWindow(page, "nw");
    await sendMudCommand(page, "nw", "look");

    const lines = await page.locator("#window-nw-chatlog > div").allTextContents();
    assert.ok(lines.some((l) => l === "look"), "the visitor's own typed line is echoed into NW's own log");
    const reply = lines[lines.length - 1];
    assert.doesNotMatch(reply, /don't know the word|couldn't|unrecognized|honest miss/i, "the reply is not an honest miss");
    assert.match(reply, /You can:/, "the reply is a real grounded room digest, ending in its own affordance list");
    assert.equal(await page.locator("#window-nw-chatq").inputValue(), "", "the input clears once submitted");

    assert.equal(await page.locator("#window-ne-chatlog > div").count(), 0, "a command typed into NW never touches NE's own chat log");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error answering a manual command in one window");
  } finally {
    await context.close();
  }
});

test("clicking #autoToggle starts every window playing, and the shared global turn counter advances over real time", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "auto starts off — only NW plays until this is clicked");

    const before = await page.locator("#globalTurnCount").textContent();
    await page.locator("#autoToggle").click();
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "true", "the rail reports auto as on");

    for (const slot of ["ne", "sw", "se"]) {
      await page.waitForFunction(
        (sel) => (document.querySelector(sel)?.textContent ?? "").includes("pause"),
        `#window-${slot}-play`,
        { timeout: ANSWER_TIMEOUT_MS },
      );
    }

    await page.waitForFunction(
      (prev) => (document.querySelector("#globalTurnCount")?.textContent ?? "") !== prev,
      before,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const after = await page.locator("#globalTurnCount").textContent();
    assert.match(after, /^turns: \d+$/, "the shared turn counter reports its own count");
    assert.notEqual(after, before, "the global turn counter genuinely advanced once every window is playing");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error driving all four windows through auto-play at once");
  } finally {
    await context.close();
  }
});

test("a manual 'dig south' command opens a new room, growing the omniscient world map's own room list", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await pauseWindow(page, "nw");
    const beforeRooms = await page.locator("#worldMapBands .map-room").count();

    await sendMudCommand(page, "nw", "dig south");

    const lines = await page.locator("#window-nw-chatlog > div").allTextContents();
    const reply = lines[lines.length - 1];
    assert.doesNotMatch(reply, /don't know the word|couldn't|unrecognized/i, "digging south is not an honest miss");
    assert.match(reply, /dig south/, "the reply confirms the direction actually dug");
    assert.match(reply, /new room/, "the reply confirms a new room opened");

    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("#worldMapBands .map-room")).some((el) => el.textContent.includes("garden-south")),
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    const afterRooms = await page.locator("#worldMapBands .map-room").count();
    assert.ok(afterRooms > beforeRooms, "the world map's own room list grew by at least the room this dig just opened");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error digging a new room open");
  } finally {
    await context.close();
  }
});

test("the rail's explanatory note frames the demo against MUDII and Colossal Cave Adventure", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    const noteText = await page.locator(".mud-note").textContent();
    assert.match(noteText, /MUDII/, "the note names its own namesake");
    assert.match(noteText, /Colossal Cave Adventure/, "the note names the genre's own origin");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error reading the rail's own note");
  } finally {
    await context.close();
  }
});
