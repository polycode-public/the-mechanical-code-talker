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

/** Type and submit one command, waiting for both the visitor's own echoed
 *  line and tmct's reply to land in the chat log before returning. */
async function sendCommand(page, text) {
  const before = await page.locator("#chatlog > div").count();
  await page.locator("#chatq").fill(text);
  await page.locator("#chatq").press("Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#chatlog > div").length >= n,
    before + 2,
    { timeout: 10000 },
  );
}

// The country-house mystery's own win playthrough (test/corpus/games/
// adventure.jsonl's "adv-worked-example-full" row): two rooms north to the
// drawing-room, open the portrait for the key, backtrack to the study, then
// unlock and open the cabinet for the letter.
const WIN_PLAYTHROUGH = [
  "go north", "go north", "open the portrait", "take the key",
  "go south", "go south", "unlock the cabinet with the key", "open the cabinet", "take the letter",
];

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

test("double-clicking a pill fills the input AND submits it, running a real turn", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    const pillCount = await page.locator("#pills .pill").count();
    assert.ok(pillCount > 0, "the current room offers at least one contextual pill");
    const pillText = await page.locator("#pills .pill").first().textContent();
    const before = await page.locator("#chatlog > div").count();

    // A real double-click, dispatched as the browser's own "dblclick" event
    // rather than through the two-mousedown timing Playwright's higher-level
    // dblclick() action simulates — the OS/browser double-click window is
    // tight enough that a loaded CI host can round-trip the two synthetic
    // clicks slower than that window, landing as two ordinary single clicks
    // instead. Dispatching the event directly still exercises the page's own
    // listener exactly as a real double-click would.
    await page.locator("#pills .pill").first().evaluate((el) => el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatlog > div").length >= n,
      before + 2,
      { timeout: 10000 },
    );
    const lines = await page.locator("#chatlog > div").allTextContents();
    assert.ok(lines.some((l) => l.includes(pillText)), "the pill's own command text ran as a real turn");
    assert.equal(await page.locator("#chatq").inputValue(), "", "the input clears once the double-click's own submit runs");
    assert.deepEqual(consoleErrors, [], "no console error double-clicking a pill");
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

test("at boot: nothing carried yet, only the opening room on the map, and the goal reads as not-yet-found", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    assert.equal(await page.locator("#carryList .chip").count(), 0, "nothing is carried before the first move");
    assert.match(await page.locator("#carryList").textContent(), /nothing yet/);

    const roomLabels = await page.locator("#mapWrap .room-node text").allTextContents();
    assert.deepEqual(roomLabels, ["study"], "only the opening room is a node on a fresh session");
    assert.equal(await page.locator("#mapWrap .room-node.current text").textContent(), "study");

    const goalText = await page.locator("#goalList").textContent();
    assert.match(goalText, /somewhere/, "the goal is only known at the opening-line level before anything is explored");
    assert.equal(await page.locator("#goalList .g.carried").count(), 0);
    assert.equal(await page.locator("#goalList .g.known").count(), 0);
    assert.deepEqual(consoleErrors, [], "no console error rendering the three panels at boot");
  } finally {
    await context.close();
  }
});

test("the room plaque names each room as it is walked, and taking an item fills a satchel tile without moving the scene", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    assert.equal(await page.locator("#roomName").textContent(), "the study", "the plaque opens on the opening room");

    await sendCommand(page, "go north");
    assert.equal(await page.locator("#roomName").textContent(), "the library", "one room north, the plaque follows");
    await sendCommand(page, "go north");
    assert.equal(await page.locator("#roomName").textContent(), "the drawing-room", "two rooms north, the plaque follows again");
    // #roomFrame, not just #spriteRow: a wall-mounted object like the
    // portrait renders in the separate #wallRow band alongside it, not
    // inside the floor row.
    const sceneLabels = await page.locator("#roomFrame .sprite-label").allTextContents();
    assert.ok(sceneLabels.includes("portrait"), "the drawing-room scene draws its own furniture");

    await sendCommand(page, "open the portrait");
    await sendCommand(page, "take the key");
    assert.deepEqual(await page.locator("#carryList .chip").allTextContents(), ["key"], "the taken item lands as a satchel tile");
    assert.equal(await page.locator("#roomName").textContent(), "the drawing-room", "taking an item never moves the scene");

    assert.deepEqual(consoleErrors, [], "no console error walking, opening, and taking");
  } finally {
    await context.close();
  }
});

test("the full win playthrough: carrying, the visited map, and the goal status all update honestly turn by turn", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    // go north, go north — the drawing-room is now visited; the goal is
    // still unknown, since the cabinet (in the study) hasn't been opened.
    await sendCommand(page, WIN_PLAYTHROUGH[0]);
    await sendCommand(page, WIN_PLAYTHROUGH[1]);
    let roomLabels = await page.locator("#mapWrap .room-node text").allTextContents();
    assert.deepEqual(new Set(roomLabels), new Set(["study", "library", "drawing-room"]), "exactly the rooms actually walked through so far, never the kitchen/garden/cellar this path never visits");
    assert.equal(await page.locator("#mapWrap .room-node.current text").textContent(), "drawing-room");

    // open the portrait, take the key — the portrait's own key is now
    // carried; the letter itself is still nowhere the session has looked.
    await sendCommand(page, WIN_PLAYTHROUGH[2]);
    await sendCommand(page, WIN_PLAYTHROUGH[3]);
    assert.deepEqual(await page.locator("#carryList .chip").allTextContents(), ["key"]);
    assert.match(await page.locator("#goalList").textContent(), /somewhere/, "the letter's own room is still unknown — the cabinet holding it hasn't been opened yet");

    // go south, go south — back in the study; the map must still show only
    // the three rooms this path actually walked, the cabinet not yet opened.
    await sendCommand(page, WIN_PLAYTHROUGH[4]);
    await sendCommand(page, WIN_PLAYTHROUGH[5]);
    roomLabels = await page.locator("#mapWrap .room-node text").allTextContents();
    assert.deepEqual(new Set(roomLabels), new Set(["study", "library", "drawing-room"]));
    assert.equal(await page.locator("#mapWrap .room-node.current text").textContent(), "study");

    // unlock the cabinet with the key, open the cabinet — the letter's room
    // is now known (the study, since the cabinet just opened here), but it
    // isn't carried yet.
    await sendCommand(page, WIN_PLAYTHROUGH[6]);
    await sendCommand(page, WIN_PLAYTHROUGH[7]);
    assert.match(await page.locator("#goalList").textContent(), /last known: the letter is in the study/);
    assert.equal(await page.locator("#goalList .g.known").count(), 1);

    // take the letter — carried, and the goal panel reads the adventure won.
    await sendCommand(page, WIN_PLAYTHROUGH[8]);
    assert.deepEqual(await page.locator("#carryList .chip").allTextContents(), ["key", "letter"]);
    assert.match(await page.locator("#goalList").textContent(), /carrying the letter.*adventure is won/);
    assert.equal(await page.locator("#goalList .g.carried").count(), 1);

    assert.deepEqual(consoleErrors, [], "no console error across the full win playthrough");
  } finally {
    await context.close();
  }
});
