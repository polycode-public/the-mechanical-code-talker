// mud.html's own shared-world dock, in a real browser: the page boots two
// panes over one world with nothing playing until a control is clicked, a
// manually typed command in one pane updates only THAT pane's own chat log
// with a real (not honest-miss) answer, a pane's own play control advances
// that character's own turn count and nobody else's, the deck's play control
// starts both, and the compass ring only ever offers a way the world allows —
// clicking a dig opens a new room on the omniscient burrow survey, and a dig
// typed for a direction the ring never offered is refused in the world's own
// terms rather than silently done. Which two animals are cast is drawn live,
// so every assertion here reads the pane's own data-character rather than
// assuming a roster order. Mirrors pages-adventure.test.mjs's/
// pages-spider-fly.test.mjs's own fixture setup and assertion style.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;
const SLOTS = ["a", "b"];

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
 *  pane's own chat input starts disabled and flips once boot() resolves, the
 *  same signal every other tmct page's own chat input uses. Third-party hosts
 *  are blocked and same-origin console errors/failed requests are tracked,
 *  exactly as pages-spider-fly.test.mjs's own openSpiderFlyPage does — the
 *  whole engine ships with the page, so nothing here needs the network. */
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
    () => document.querySelector("#window-a-chatq") && !document.querySelector("#window-a-chatq").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors, failedRequests };
}

/** Type and submit one command into a given pane's own chat dock (Enter
 *  submits the pane's <form>, exactly like adventure.html's #chatq), and wait
 *  for both the visitor's own echoed line and tmct's reply to land. */
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

const turnCountOf = async (page, selector) =>
  Number(((await page.locator(selector).textContent()).match(/\d+/) ?? ["0"])[0]);

test("the page boots two panes over one world, with nothing playing until it is asked to", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    for (const slot of SLOTS) {
      assert.equal(await page.locator(`#window-${slot}`).isVisible(), true, `window-${slot} is visible on load`);
    }
    const castIds = await Promise.all(SLOTS.map((slot) => page.locator(`#window-${slot}`).getAttribute("data-character")));
    assert.ok(castIds.every((id) => id && id.length), "both panes are cast with a real character");
    assert.equal(new Set(castIds).size, 2, "the two panes never draw the same animal twice");

    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "the deck's play control starts off");
    for (const slot of SLOTS) {
      assert.match(
        await page.locator(`#window-${slot}-play`).textContent(),
        /play/i,
        `the ${slot} pane starts paused — nothing runs until a control is clicked`,
      );
      assert.equal(await turnCountOf(page, `#window-${slot}-turn`), 0, `the ${slot} pane has taken no turn on load`);
    }
    assert.equal(await turnCountOf(page, "#globalTurnCount"), 0, "no turn has run at all");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error while booting two panes over one shared world");
  } finally {
    await context.close();
  }
});

test("a manually typed command in one pane updates only that pane's own chat log with a real, sane answer", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await sendMudCommand(page, "a", "look");

    const lines = await page.locator("#window-a-chatlog > div").allTextContents();
    assert.ok(lines.some((l) => l === "look"), "the visitor's own typed line is echoed into the first pane's own log");
    const reply = lines[lines.length - 1];
    assert.doesNotMatch(reply, /don't know the word|couldn't|unrecognized|honest miss/i, "the reply is not an honest miss");
    assert.match(reply, /You can:/, "the reply is a real grounded room digest, ending in its own affordance list");
    assert.equal(await page.locator("#window-a-chatq").inputValue(), "", "the input clears once submitted");

    assert.equal(await page.locator("#window-b-chatlog > div").count(), 0, "a command typed into one pane never touches the other's log");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error answering a manual command in one pane");
  } finally {
    await context.close();
  }
});

test("a pane's own play control advances that character's own turn count, and nobody else's", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await page.locator("#window-a-play").click();
    await page.waitForFunction(
      () => Number((document.querySelector("#window-a-turn")?.textContent.match(/\d+/) ?? ["0"])[0]) > 0,
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    await page.locator("#window-a-play").click();

    assert.ok(await turnCountOf(page, "#window-a-turn") > 0, "the playing character counts its own turns");
    assert.equal(await turnCountOf(page, "#window-b-turn"), 0, "the paused character's own count stays where it was");
    assert.ok(
      await turnCountOf(page, "#globalTurnCount") > 0,
      "the shared world counter advances too, and is reported separately from either character's own",
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error playing one pane on its own");
  } finally {
    await context.close();
  }
});

test("the deck's play control starts both panes, and the shared turn counter advances over real time", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    const before = await turnCountOf(page, "#globalTurnCount");
    await page.locator("#autoToggle").click();
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "true", "the deck reports play as on");

    for (const slot of SLOTS) {
      await page.waitForFunction(
        (sel) => (document.querySelector(sel)?.textContent ?? "").includes("pause"),
        `#window-${slot}-play`,
        { timeout: ANSWER_TIMEOUT_MS },
      );
    }
    await page.waitForFunction(
      (prev) => Number((document.querySelector("#globalTurnCount")?.textContent.match(/\d+/) ?? ["0"])[0]) > prev,
      before,
      { timeout: ANSWER_TIMEOUT_MS },
    );

    assert.match(await page.locator("#globalTurnCount").textContent(), /^turns: \d+$/, "the shared counter reports its own count");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error driving both panes through play at once");
  } finally {
    await context.close();
  }
});

test("the compass ring offers only ways the world allows, and a dig opens a new room on the survey", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    const pills = await page.locator(".dir-pill").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    assert.ok(pills.length > 0, "a room with a way out of it offers at least one");
    for (const command of pills) {
      assert.match(command, /^(?:go|dig) (?:north|south|east|west|up|down)$/, "every pill is a whole, submittable command");
    }

    // A character standing above ground can only sink a shaft, and the garden
    // already has one — so walk down first when the ring offers no dig at all.
    if (await page.locator(".dir-pill.dig").count() === 0) {
      await page.locator('.dir-pill[aria-label="go down"]').first().click();
      await page.waitForFunction(() => document.querySelectorAll(".dir-pill.dig").length > 0, null, { timeout: ANSWER_TIMEOUT_MS });
    }

    const roomsBefore = await page.locator("#worldMapBoard .room").count();
    await page.locator(".dir-pill.dig").first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("#worldMapBoard .room").length > n,
      roomsBefore,
      { timeout: ANSWER_TIMEOUT_MS },
    );

    const replies = await page.locator(".chatlog .a").allTextContents();
    const dug = replies[replies.length - 1];
    assert.doesNotMatch(dug, /don't know the word|couldn't|unrecognized/i, "a dig the ring offered is never refused");
    assert.match(dug, /new room/, "the reply confirms a new room opened");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error digging a new room open");
  } finally {
    await context.close();
  }
});

test("a dig typed for a direction the ring never offered is refused in the world's own terms, never silently done", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    const offeredDirections = await page
      .locator(".dir-pill")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")?.split(" ")[1]).filter(Boolean));
    const allDirections = ["north", "south", "east", "west", "up", "down"];
    const refusedDirection = allDirections.find((d) => !offeredDirections.includes(d));
    assert.ok(refusedDirection, "at least one direction is never offered by the ring in the starting room");

    const roomsBefore = await page.locator("#worldMapBoard .room").count();
    await sendMudCommand(page, "a", `dig ${refusedDirection}`);

    const lines = await page.locator("#window-a-chatlog > div").allTextContents();
    const reply = lines[lines.length - 1];
    assert.doesNotMatch(reply, /new room/, "a dig the ring never offered opens nothing");
    assert.equal(await page.locator("#worldMapBoard .room").count(), roomsBefore, "the survey gains no room from a refused dig");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error refusing a dig the ring never offered");
  } finally {
    await context.close();
  }
});

test("the deck's explanatory note frames the demo against MUDII and Colossal Cave Adventure", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    const noteText = await page.locator(".mud-note").textContent();
    assert.match(noteText, /MUDII/, "the note names its own namesake");
    assert.match(noteText, /Colossal Cave Adventure/, "the note names the genre's own origin");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error reading the deck's own note");
  } finally {
    await context.close();
  }
});
