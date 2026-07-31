// mud.html's scenario dropdown, in a real browser: the page ships three
// burrows of different sizes, opens on mud garden, and picking another one
// recasts the shared world over that burrow's own rooms and its own animals.
// A live shared room re-binds to the new burrow's own store rather than
// dropping the link, exactly the way reset and the two cast sliders already
// do — p2p-room.mjs's rebind() is what makes this possible. Edit mode then
// reads the burrow that is loaded rather than the one the page shipped with.
// Mirrors pages-mud.test.mjs's own helper shape.
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

async function openMudPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];

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
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/mud.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#window-a-chatq") && !document.querySelector("#window-a-chatq").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors };
}

const roomsOnSurvey = async (page) =>
  (await page.locator("#worldMapBoard [data-room]").evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-room")))).sort();

/** Pick a burrow by its option value and wait for the survey to be drawing a
 *  room only that burrow has — the one repaint that only happens once the new
 *  shared world has actually opened. */
async function pickScenario(page, value, tellRoom) {
  await page.locator("#scenarioSelect").selectOption(value);
  await page.waitForFunction(
    (room) => !!document.querySelector(`#worldMapBoard [data-room="${room}"]`),
    tellRoom,
    { timeout: READY_TIMEOUT_MS },
  );
}

async function enterEditMode(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: 5000 });
  await page.waitForFunction(() => (document.getElementById("editorText")?.value || "").length > 0, null, { timeout: 5000 });
}

test("the dropdown offers three burrows of different sizes and opens on mud garden", async () => {
  const { context, page, consoleErrors } = await openMudPage();
  try {
    const labels = await page.locator("#scenarioSelect option").allTextContents();
    assert.deepEqual(labels, [
      "mud garden (4 rooms, 1 fox)",
      "mud hollow (3 rooms, nothing hunting)",
      "mud warren (8 rooms, fox and owl)",
    ]);
    assert.equal(await page.locator("#scenarioSelect").inputValue(), "0", "the page opens on the first burrow");
    const rooms = await roomsOnSurvey(page);
    assert.deepEqual(rooms, ["burrow-1", "fox-den", "garden", "sett-1"], "mud garden's own four rooms");
    assert.deepEqual(consoleErrors, [], "no console error on load");
  } finally {
    await context.close();
  }
});

test("picking a burrow redraws the survey over that burrow's own rooms", async () => {
  const { context, page, consoleErrors } = await openMudPage();
  try {
    await pickScenario(page, "1", "larder");
    assert.deepEqual(await roomsOnSurvey(page), ["hollow", "larder", "tunnel-1"], "the hollow's own three rooms");

    await pickScenario(page, "2", "warren-mouth");
    const warren = await roomsOnSurvey(page);
    assert.deepEqual(
      warren,
      ["clearing", "east-run", "fox-earth", "north-gallery", "south-gallery", "stump", "warren-mouth", "west-run"],
      "the warren's own eight rooms",
    );
    assert.ok(!warren.includes("garden"), "nothing from mud garden is left on the survey");

    await pickScenario(page, "0", "fox-den");
    assert.deepEqual(await roomsOnSurvey(page), ["burrow-1", "fox-den", "garden", "sett-1"], "and back again");
    assert.deepEqual(consoleErrors, [], "no console error switching burrows");
  } finally {
    await context.close();
  }
});

test("a burrow is cast from its own animals, never the burrow the page shipped with", async () => {
  const { context, page, consoleErrors } = await openMudPage();
  try {
    await pickScenario(page, "1", "larder");
    const hollowCast = await page.locator("#mudStage .mud-window").evaluateAll((panes) =>
      panes.map((p) => p.getAttribute("data-character")));
    for (const character of hollowCast) {
      assert.match(character, /^(mole|vole)-\d+$/, `the hollow authors only moles and voles, got ${character}`);
    }

    // The warren is the only burrow that authors a meerkat, so casting its
    // whole roster is the check that the roster came from the burrow.
    await pickScenario(page, "2", "warren-mouth");
    await page.locator("#playerCountSlider").fill("2");
    await page.locator("#playerCountSlider").dispatchEvent("change");
    await page.waitForFunction(
      () => document.querySelectorAll("#mudStage .mud-window").length === 4,
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    const everyone = await page.locator("#worldMapBoard .occupant title").allTextContents();
    assert.ok(
      everyone.some((name) => name.includes("meerkat")),
      `the warren's own meerkat is in the world, got ${JSON.stringify(everyone)}`,
    );
    assert.deepEqual(consoleErrors, [], "no console error recasting");
  } finally {
    await context.close();
  }
});

test("picking a burrow while a room is shared re-binds the link to the new burrow, the same way reset does", async () => {
  const { context, page, consoleErrors } = await openMudPage();
  try {
    await page.click("#shareBtn");
    await page.waitForFunction(
      () => document.getElementById("shareLink").value.length > 0,
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    assert.notEqual(await page.locator("#statePillWord").textContent(), "not shared", "a room is live before the switch");
    const linkBefore = await page.inputValue("#shareLink");

    // The scenario picker sits in the deck, under the sharing overlay the
    // share click opened — lights back up before reaching for it.
    await page.keyboard.press("Escape");
    await pickScenario(page, "2", "warren-mouth");

    assert.notEqual(await page.locator("#statePillWord").textContent(), "not shared", "the link survives the recast, re-bound to the new burrow");
    assert.equal(await page.inputValue("#shareLink"), linkBefore, "the same invite still works — no peer has to re-join");
    const note = await page.locator("#wireStateNote").textContent();
    assert.match(note, /a different burrow opened/, `the page says what changed, got ${note}`);
    assert.match(note, /still linked/, "and that the link survived it");
    assert.deepEqual(consoleErrors, [], "no console error recasting a shared room");
  } finally {
    await context.close();
  }
});

test("edit mode on a picked burrow seeds from that burrow's own facts and writes back into it", async () => {
  const { context, page, consoleErrors } = await openMudPage();
  try {
    await pickScenario(page, "2", "warren-mouth");
    await enterEditMode(page);

    const text = await page.locator("#editorText").inputValue();
    assert.match(text, /Warren-mouth has an exit north to the north-gallery\./, "the warren's own map is in the ledger");
    assert.doesNotMatch(text, /sett-1/, "nothing from mud garden leaked in");

    assert.match(text, /Tomato lies in the east-run\./, "the warren's tomato starts in its east run");
    await page.locator("#editorText").fill(text.replace("Tomato lies in the east-run.", "Tomato lies in the west-run."));
    await page.waitForFunction(
      () => /synced/.test(document.getElementById("editorStatus")?.textContent || ""),
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );

    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
    await enterEditMode(page);
    const reread = await page.locator("#editorText").inputValue();
    assert.match(reread, /Tomato lies in the west-run\./, "the move landed in the warren's own world");
    assert.deepEqual(consoleErrors, [], "no console error editing the picked burrow");
  } finally {
    await context.close();
  }
});

test("an edit made in one burrow is not carried into another by the dropdown", async () => {
  const { context, page, consoleErrors } = await openMudPage();
  try {
    await pickScenario(page, "1", "larder");
    await enterEditMode(page);
    const hollowText = await page.locator("#editorText").inputValue();
    assert.match(hollowText, /Lettuce lies in the larder\./, "the hollow's lettuce starts in its larder");
    await page.locator("#editorText").fill(hollowText.replace("Lettuce lies in the larder.", "Lettuce lies in the hollow."));
    await page.waitForFunction(
      () => /synced/.test(document.getElementById("editorStatus")?.textContent || ""),
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });

    await pickScenario(page, "2", "warren-mouth");
    await enterEditMode(page);
    const warrenText = await page.locator("#editorText").inputValue();
    assert.doesNotMatch(warrenText, /Lettuce lies in the hollow\./, "the hollow's edit stayed in the hollow");
    assert.match(warrenText, /Lettuce lies in the south-gallery\./, "the warren is still its own burrow");
    assert.deepEqual(consoleErrors, [], "no console error crossing burrows");
  } finally {
    await context.close();
  }
});
