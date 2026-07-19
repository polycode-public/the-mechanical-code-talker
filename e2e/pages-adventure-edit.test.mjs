// The adventure page's world editor (PLAN_GAMES_UPLIFT_V3.md Part C.4 item
// 4's operator addendum): entering edit mode seeds a textarea with the
// live world's own facts as plain sentences, the whole map renders every
// room the world defines (not just visited ones), clicking a room shows its
// real contents, editing a line flows back into the running world and the
// clicked room's own panel re-renders live, cursor-driven pills suggest
// ontologically related terms, and a typo never silently destroys an
// unrelated fact. Mirrors e2e/pages-adventure.test.mjs's own helper shape.
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

async function enterEditMode(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: 5000 });
  await page.waitForFunction(() => (document.getElementById("editorText")?.value || "").length > 0, null, { timeout: 5000 });
}

async function clickRoom(page, roomId) {
  await page.locator(`#editMapWrap .room-node[data-room="${roomId}"]`).click();
  await page.waitForFunction(
    (id) => document.getElementById("roomDetailTitle")?.textContent === id,
    roomId,
    { timeout: 5000 },
  );
}

async function waitForSyncStatus(page) {
  await page.waitForFunction(
    () => (document.getElementById("editorStatus")?.textContent || "").length > 0,
    null,
    { timeout: 5000 },
  );
}

test("entering edit mode seeds the textarea with the world's own facts as plain sentences, and leaves play mode's controls hidden", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    const text = await page.locator("#editorText").inputValue();
    assert.match(text, /Cabinet stands locked in the study\./);
    assert.match(text, /Desk is fixed in the study\./);
    assert.match(text, /Lamp is in the study\./);
    assert.match(text, /Letter is hidden in the cabinet\./);
    assert.match(text, /Letter is the objective\./);
    assert.match(text, /Study has an exit north to the library\./);
    assert.equal(await page.locator("#playStage").isVisible(), false, "play mode's stage is hidden while editing");
    assert.equal(await page.locator("#playControls").isVisible(), false, "play mode's controls are hidden while editing");
    assert.equal(await page.locator("#editModeBtn").textContent(), "back to playing");
    assert.deepEqual(consoleErrors, [], "no console error entering edit mode");
  } finally {
    await context.close();
  }
});

test("the whole-map panel draws every room the world defines, not just the ones visited so far", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    const labels = await page.locator("#editMapWrap .room-node text").allTextContents();
    assert.deepEqual(new Set(labels), new Set(["study", "library", "drawing-room", "kitchen", "garden", "cellar"]),
      "every room Ashcombe Hall defines shows up, though only the study has actually been visited this session");
    assert.deepEqual(consoleErrors, [], "no console error rendering the whole-map panel");
  } finally {
    await context.close();
  }
});

test("clicking a room shows its real contents, parameterized by the clicked room rather than the player's own current one", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    await clickRoom(page, "drawing-room");
    const labels = await page.locator("#roomDetailSprites .sprite-label").allTextContents();
    assert.deepEqual(new Set(labels), new Set(["butler", "portrait"]), "the drawing-room's own cast/furniture, not the study's (the player never left the study)");
    const caption = await page.locator("#roomDetailCaption").textContent();
    assert.match(caption, /Portrait is fixed in the drawing-room/);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});

test("editing a line flows back into the running world, and the currently-inspected room re-renders live — a real two-way sync", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    await clickRoom(page, "study");
    let labels = await page.locator("#roomDetailSprites .sprite-label").allTextContents();
    assert.ok(labels.includes("cabinet"), "the cabinet starts out in the study");

    const originalText = await page.locator("#editorText").inputValue();
    const editedText = originalText.replace("Cabinet stands locked in the study.", "Cabinet stands locked in the library.");
    await page.locator("#editorText").fill(editedText);
    await waitForSyncStatus(page);
    await page.waitForFunction(
      () => (document.getElementById("editorStatus")?.textContent || "").includes("synced"),
      null,
      { timeout: 5000 },
    );

    // The study panel (still the one being inspected) must lose the cabinet
    // without a re-click — the whole point of "re-renders live".
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll("#roomDetailSprites .sprite-label")).some((el) => el.textContent === "cabinet"),
      null,
      { timeout: 5000 },
    );

    await clickRoom(page, "library");
    labels = await page.locator("#roomDetailSprites .sprite-label").allTextContents();
    assert.ok(labels.includes("cabinet"), "the cabinet now shows up in the library instead");

    // Leaving edit mode and asking the live game confirms the edit is real,
    // not a preview-only artifact.
    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: 5000 });
    const before = await page.locator("#chatlog > div").count();
    await page.locator("#chatq").fill("where is the cabinet");
    await page.locator("#chatq").press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll("#chatlog > div").length >= n, before + 2, { timeout: 10000 });
    const answer = await page.locator("#chatlog > div.a").last().textContent();
    assert.match(answer, /the cabinet is in the library/);

    assert.deepEqual(consoleErrors, [], "no console error across the whole edit-then-verify round trip");
  } finally {
    await context.close();
  }
});

test("deleting a puzzle fact through the editor actually changes what the live game will accept", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    const text = await page.locator("#editorText").inputValue();
    const withoutUnlock = text.split("\n").filter((l) => !l.startsWith("Cabinet unlocks with")).join("\n");
    await page.locator("#editorText").fill(withoutUnlock);
    await page.waitForFunction(
      () => (document.getElementById("editorStatus")?.textContent || "").includes("retracted"),
      null,
      { timeout: 5000 },
    );

    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: 5000 });
    await page.locator("#chatq").fill("go north");
    await page.locator("#chatq").press("Enter");
    await page.waitForTimeout(300);
    await page.locator("#chatq").fill("open the portrait");
    await page.locator("#chatq").press("Enter");
    await page.waitForTimeout(300);
    await page.locator("#chatq").fill("take the key");
    await page.locator("#chatq").press("Enter");
    await page.waitForTimeout(300);
    await page.locator("#chatq").fill("go south");
    await page.locator("#chatq").press("Enter");
    await page.waitForTimeout(300);
    const before = await page.locator("#chatlog > div").count();
    await page.locator("#chatq").fill("unlock the cabinet with the key");
    await page.locator("#chatq").press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll("#chatlog > div").length >= n, before + 2, { timeout: 10000 });
    const answer = await page.locator("#chatlog > div.a").last().textContent();
    assert.match(answer, /nothing in this world says what unlocks the cabinet/);

    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});

test("a typo elsewhere in the document is reported and never silently deletes an unrelated fact", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    const text = await page.locator("#editorText").inputValue();
    const typo = text.replace("Cabinet unlocks with the key.", "Cabinet unlokcs with the key")
      .split("\n").filter((l) => !l.startsWith("Housekeeper acts on turn")).join("\n");
    await page.locator("#editorText").fill(typo);
    await page.waitForFunction(
      () => (document.getElementById("editorStatus")?.textContent || "").includes("not understood"),
      null,
      { timeout: 5000 },
    );
    const status = await page.locator("#editorStatus").textContent();
    assert.match(status, /not understood/);

    // Re-fix the typo (restore the original line) and confirm the deletion
    // of the OTHER (unrelated) line finally applies once the document is
    // clean again — proving the gate is a hold, not a permanent drop.
    await page.locator("#editorText").fill(text.split("\n").filter((l) => !l.startsWith("Housekeeper acts on turn")).join("\n"));
    await page.waitForFunction(
      () => (document.getElementById("editorStatus")?.textContent || "").includes("retracted"),
      null,
      { timeout: 5000 },
    );

    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});

test("cursor-driven suggestion pills surface a taught related term, honestly, once one exists", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    // Teach a real related-to fact through ordinary chat first.
    await page.locator("#chatq").fill("cabinet relates to key");
    await page.locator("#chatq").press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("#chatlog > div.a").length >= 1, null, { timeout: 10000 });

    await enterEditMode(page);
    await page.locator("#editorText").click();
    await page.evaluate(() => {
      const ta = document.getElementById("editorText");
      const idx = ta.value.indexOf("Cabinet stands locked");
      const pos = idx + "Cabinet".length;
      ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event("click"));
    });
    await page.waitForFunction(() => document.querySelectorAll("#editorPills .pill").length > 0, null, { timeout: 5000 });
    const pills = await page.locator("#editorPills .pill").allTextContents();
    assert.ok(pills.includes("key"), "the taught cabinet/key relation surfaces as a pill");

    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});

test("the legend lists every class the world actually uses, each with a real icon", async () => {
  const { context, page, consoleErrors } = await openAdventurePage();
  try {
    await enterEditMode(page);
    const labels = await page.locator("#legendList .sprite-label").allTextContents();
    assert.deepEqual(new Set(labels), new Set(["adventurer", "person", "furniture", "container", "portable", "room"]));
    assert.equal(await page.locator("#legendList .sprite-card svg").count(), labels.length, "every legend entry actually renders an svg icon");
    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});
