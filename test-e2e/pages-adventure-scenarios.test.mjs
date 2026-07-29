// adventure.html's scenario dropdown, in a real browser: the page ships three
// worlds of different sizes, opens on Ashcombe Hall, and picking another one
// replaces the world the player is standing in — its opening line, its rooms,
// its objects. Edit mode then reads the world that is loaded rather than the
// one the page shipped with, so editing a room in the museum writes into the
// museum's own facts and leaves Ashcombe alone. Mirrors
// pages-adventure-edit.test.mjs's own helper shape.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 20_000;

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
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors };
}

/** Pick a world by its option value and wait for the page note to become that
 *  world's own opening line — the one repaint that only happens once the new
 *  session has actually booted. */
async function pickScenario(page, value, openingFragment) {
  await page.locator("#scenarioSelect").selectOption(value);
  await page.waitForFunction(
    (fragment) => (document.getElementById("pageNote")?.textContent || "").includes(fragment),
    openingFragment,
    { timeout: READY_TIMEOUT_MS },
  );
}

async function enterEditMode(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: 5000 });
  await page.waitForFunction(() => (document.getElementById("editorText")?.value || "").length > 0, null, { timeout: 5000 });
}

test("the dropdown offers three worlds of different sizes and opens on Ashcombe Hall", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    const labels = await page.locator("#scenarioSelect option").allTextContents();
    assert.deepEqual(labels, [
      "ashcombe hall (6 rooms, 1 lock)",
      "lantern cottage (3 rooms, no locks)",
      "greyvale museum (9 rooms, 3 locks)",
    ]);
    assert.equal(await page.locator("#scenarioSelect").inputValue(), "0", "the page opens on the first world");
    assert.match(await page.locator("#pageNote").textContent(), /study of Ashcombe Hall/);
    assert.deepEqual(consoleErrors, [], "no console error on load");
  } finally {
    await context.close();
  }
});

test("picking a different world replaces the rooms and objects the player can actually see", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await pickScenario(page, "1", "parlour of Lantern Cottage");
    const cottageCaption = await page.locator("#caption").textContent();
    assert.match(cottageCaption, /parlour/i, "the room view stands in the cottage's own starting room");
    const cottageChat = await page.locator("#chatlog").textContent();
    assert.match(cottageChat, /Lantern Cottage/, "the chat log opens with the cottage's own opening line");
    assert.doesNotMatch(cottageChat, /Ashcombe/, "the log was cleared, not appended to");

    await pickScenario(page, "2", "foyer of the Greyvale Museum");
    const museumCaption = await page.locator("#caption").textContent();
    assert.match(museumCaption, /foyer/i, "the room view moved again, to the museum's own starting room");

    await pickScenario(page, "0", "study of Ashcombe Hall");
    const backCaption = await page.locator("#caption").textContent();
    assert.match(backCaption, /study/i, "picking the first world again puts the player back in the study");
    assert.deepEqual(consoleErrors, [], "no console error switching worlds");
  } finally {
    await context.close();
  }
});

test("the map redraws to the picked world's own rooms, not the world the page shipped with", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await pickScenario(page, "2", "foyer of the Greyvale Museum");
    await enterEditMode(page);
    const rooms = await page.locator("#editMapWrap .room-node text").allTextContents();
    const named = rooms.map((r) => r.trim());
    for (const room of ["foyer", "gallery", "vault", "office"]) {
      assert.ok(named.includes(room), `the museum's ${room} is on the map, got ${JSON.stringify(named)}`);
    }
    assert.ok(!named.includes("drawing-room"), "no room from Ashcombe Hall is left on the map");
    assert.deepEqual(consoleErrors, [], "no console error drawing the picked world's map");
  } finally {
    await context.close();
  }
});

test("edit mode on a picked world seeds from that world's own facts and writes back into it", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await pickScenario(page, "2", "foyer of the Greyvale Museum");
    await enterEditMode(page);

    const text = await page.locator("#editorText").inputValue();
    assert.match(text, /Cabinet stands locked in the vault\./, "the museum's own locked cabinet is in the ledger");
    assert.match(text, /Gold is the objective\./, "the museum's own objective, not Ashcombe's letter");
    assert.doesNotMatch(text, /Letter is hidden in the cabinet\./, "nothing from Ashcombe Hall leaked in");

    // A move only this world could make, written through the editor and read
    // back out of the running world's own graph.
    assert.match(text, /Letter is in the library\./, "the museum's letter starts in its library");
    await page.locator("#editorText").fill(text.replace("Letter is in the library.", "Letter is in the vault."));
    await page.waitForFunction(
      () => /synced/.test(document.getElementById("editorStatus")?.textContent || ""),
      null,
      { timeout: 10_000 },
    );
    const status = await page.locator("#editorStatus").textContent();
    assert.match(status, /synced/, `the edit reached the museum's world, got ${status}`);

    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: 5000 });
    await enterEditMode(page);
    const reread = await page.locator("#editorText").inputValue();
    assert.match(reread, /Letter is in the vault\./, "the written fact is in the museum's own world on the way back in");
    assert.deepEqual(consoleErrors, [], "no console error editing the picked world");
  } finally {
    await context.close();
  }
});

test("an edit made in one world is not carried into another world by the dropdown", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await pickScenario(page, "1", "parlour of Lantern Cottage");
    await enterEditMode(page);
    const cottageText = await page.locator("#editorText").inputValue();
    assert.match(cottageText, /Flower is in the garden\./, "the cottage's flower starts in its garden");
    await page.locator("#editorText").fill(cottageText.replace("Flower is in the garden.", "Flower is in the bedroom."));
    await page.waitForFunction(
      () => /synced/.test(document.getElementById("editorStatus")?.textContent || ""),
      null,
      { timeout: 10_000 },
    );
    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: 5000 });

    await pickScenario(page, "2", "foyer of the Greyvale Museum");
    await enterEditMode(page);
    const museumText = await page.locator("#editorText").inputValue();
    assert.doesNotMatch(museumText, /Flower is in the bedroom\./, "the cottage's edit stayed in the cottage");
    assert.match(museumText, /Gold is the objective\./, "the museum is still its own world");
    assert.deepEqual(consoleErrors, [], "no console error crossing worlds");
  } finally {
    await context.close();
  }
});
