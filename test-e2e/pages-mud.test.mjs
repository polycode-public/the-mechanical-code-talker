// mud.html's own shared-world dock, in a real browser: the page boots two
// panes over one world with nothing playing until a control is clicked, the
// npcs slider adds animals that act without one, a
// manually typed command in one pane updates only THAT pane's own chat log
// with a real (not honest-miss) answer, a pane's own play control advances
// that character's own turn count and nobody else's, the deck's play control
// starts both, and the compass ring only ever offers a way the world allows —
// clicking a dig opens a new room on the omniscient burrow survey, and a dig
// typed for a direction the ring never offered is refused in the world's own
// terms rather than silently done. The players slider recasts the world at
// one and at four, and the panes only that count ever draws answer like the
// default pair. Which animals are cast is drawn live, so every assertion here
// reads the pane's own data-character rather than assuming a roster order.
// Mirrors pages-adventure.test.mjs's/pages-spider-fly.test.mjs's own fixture
// setup and assertion style.
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

/** Move the players slider to one of its detents and wait for the redraw the
 *  change fires — the stage is rebuilt and a fresh shared world opened, so
 *  "done" is the new panes' own chat inputs coming back enabled. */
async function setPlayerCount(page, count) {
  const detent = { 1: "0", 2: "1", 4: "2" }[count];
  await page.locator("#playerCountSlider").fill(detent);
  await page.waitForFunction(
    (n) => {
      const stage = document.getElementById("mudStage");
      const inputs = [...document.querySelectorAll(".mud-window input[type=text]")];
      return stage.getAttribute("data-panes") === String(n) && inputs.length === n && inputs.every((i) => !i.disabled);
    },
    count,
    { timeout: READY_TIMEOUT_MS },
  );
}

/** Move the npcs slider and wait for the fresh world the change opens. Its
 *  value is the count itself, so there is no detent table to look through. */
async function setNpcCount(page, count) {
  await page.locator("#npcCountSlider").fill(String(count));
  await page.locator("#npcCountSlider").dispatchEvent("change");
  await page.waitForFunction(
    (n) => {
      const inputs = [...document.querySelectorAll(".mud-window input[type=text]")];
      return document.getElementById("npcCountValue").textContent === String(n)
        && inputs.length > 0 && inputs.every((i) => !i.disabled)
        && document.querySelectorAll("#worldMapBoard .occupant").length > 0;
    },
    count,
    { timeout: READY_TIMEOUT_MS },
  );
}

/** Every character the omniscient survey draws, mapped to the room it stands
 *  in — read off the board itself, so it covers the animals with no pane to
 *  ask. */
const whereEveryoneStands = async (page) => page.evaluate(() => {
  const standing = {};
  for (const room of document.querySelectorAll("#worldMapBoard .room")) {
    const name = room.querySelector("text").textContent;
    for (const who of room.querySelectorAll(".occupant title")) standing[who.textContent] = name;
  }
  return standing;
});

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

test("a talking character's own speech bubble carries the engine's real narration, never a fixed line", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await page.locator("#autoToggle").click();
    const selfBubble = await page.waitForFunction(
      () => {
        for (const slot of ["a", "b"]) {
          const bubble = document.querySelector(`#window-${slot}-bubbles .bubble.from-self`);
          if (bubble && bubble.textContent) return { slot, text: bubble.textContent };
        }
        return null;
      },
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    ).then((handle) => handle.jsonValue());
    await page.locator("#autoToggle").click();

    assert.notEqual(
      selfBubble.text, "what food do you know about?",
      "the asker's own bubble is never the old fixed placeholder line",
    );
    assert.match(
      selfBubble.text, /\bthe \S+ (asks|greets) the \S+\b/,
      "the asker's own bubble is the engine's real narration of the exchange, matching the teller's own",
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error rendering a talking character's own speech bubble");
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
    // already has one — so walk down first when this pane's ring offers no dig
    // at all. One pane throughout, so the dig and the reply belong together.
    if (await page.locator("#window-a-dirs .dir-pill.dig").count() === 0) {
      await page.locator('#window-a-dirs .dir-pill[aria-label="go down"]').first().click();
      await page.waitForFunction(
        () => document.querySelectorAll("#window-a-dirs .dir-pill.dig").length > 0,
        null,
        { timeout: ANSWER_TIMEOUT_MS },
      );
    }

    const roomsBefore = await page.locator("#worldMapBoard .room").count();
    await page.locator("#window-a-dirs .dir-pill.dig").first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll("#worldMapBoard .room").length > n,
      roomsBefore,
      { timeout: ANSWER_TIMEOUT_MS },
    );

    const replies = await page.locator("#window-a-chatlog .a").allTextContents();
    const dug = replies[replies.length - 1];
    assert.doesNotMatch(dug, /don't know the word|couldn't|unrecognized/i, "a dig the ring offered is never refused");
    // Most digs open a bare new room; roughly one in five instead breaks into a
    // den (a resident mouse, a real food store) — both are a successful dig,
    // confirmed either way by the survey's own room count growing, above.
    assert.match(dug, /new room|den somebody hollowed out/, "the reply confirms a new room or den opened");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error digging a new room open");
  } finally {
    await context.close();
  }
});

test("a dig typed for a direction the ring never offered is refused in the world's own terms, never silently done", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    // One pane's OWN ring, never both at once: the two panes are cast from a
    // live draw and can stand in different rooms, so the union of their rings
    // covers every direction whenever one of them starts underground — and the
    // refusal under test belongs to the room the command is typed into.
    const offeredDirections = await page
      .locator("#window-a-dirs .dir-pill")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")?.split(" ")[1]).filter(Boolean));
    const allDirections = ["north", "south", "east", "west", "up", "down"];
    const refusedDirection = allDirections.find((d) => !offeredDirections.includes(d));
    assert.ok(refusedDirection, "at least one direction is never offered by this pane's own ring");

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

test("the players slider recasts the world at one, and again at four, with every pane playable", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await setPlayerCount(page, 1);
    assert.equal(await page.locator(".mud-window").count(), 1, "one player draws one pane, and no empty siblings");
    assert.equal(await page.locator("#playerCountValue").textContent(), "1", "the deck reports the count it drew");
    assert.equal(await page.locator("#window-a-play").isEnabled(), true, "the lone pane can still be played");
    assert.equal(await page.locator("#worldMapKey .key-actor").count(), 1, "the survey keys the one animal in play");

    await setPlayerCount(page, 4);
    const castIds = await page.locator(".mud-window").evaluateAll((els) => els.map((e) => e.getAttribute("data-character")));
    assert.equal(castIds.length, 4, "four players draw four panes");
    assert.equal(new Set(castIds).size, 4, "no animal is cast into two panes at once");
    assert.equal(await turnCountOf(page, "#globalTurnCount"), 0, "recasting starts the shared world over");

    // The pane the default two-up layout never has, driven end to end: the
    // renderer is the same call for every count, so the third pane's own dock
    // has to answer exactly like the first.
    await sendMudCommand(page, "c", "look");
    const lines = await page.locator("#window-c-chatlog > div").allTextContents();
    assert.match(lines[lines.length - 1], /You can:/, "the third pane answers with its own grounded room digest");
    assert.equal(await page.locator("#window-d-chatlog > div").count(), 0, "and only its own log carries it");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error recasting the world at one and at four");
  } finally {
    await context.close();
  }
});

/** Open the world editor and wait for its textarea to hold the seeded world. */
async function openEditor(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(
    () => document.body.classList.contains("editing")
      && (document.getElementById("editorText")?.value ?? "").length > 0,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
}

/** Replace the whole editor buffer and wait for the debounced sync to report. */
async function syncEditorText(page, text) {
  await page.locator("#editorText").fill(text);
  await page.waitForFunction(
    () => (document.getElementById("editorStatus")?.textContent ?? "").length > 0
      && !(document.getElementById("editorStatus")?.textContent ?? "").includes("reading the burrow"),
    null,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  return page.locator("#editorStatus").textContent();
}

test("edit mode shows the whole burrow as sentences, and a typed room round-trips into play", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await openEditor(page);
    assert.equal(await page.locator("#mudEditStage").isVisible(), true, "the editor takes the stage");
    assert.equal(await page.locator("#mudStage").isVisible(), false, "and the panes step aside for it");
    assert.equal(await page.locator("#autoToggle").isDisabled(), true, "nothing can take a turn mid-edit");

    const seeded = await page.locator("#editorText").inputValue();
    assert.match(seeded, /Garden has an exit down to the burrow-1\./, "the world's own exits read as sentences");
    assert.match(seeded, /The burrow digs \d+ rooms out from the garden\./, "and so do the knobs that tune the dig");

    // A clicked room reports what the edit buffer says stands in it.
    await page.locator('#editMapBoard [data-room="sett-1"]').click();
    assert.equal(await page.locator("#roomDetailTitle").textContent(), "sett-1");
    assert.match(await page.locator("#roomDetailCaption").textContent(), /underground room/);
    assert.ok(await page.locator("#roomDetailCast .sprite-card").count() > 0, "and draws what is placed there");

    // A room this world never had, a way in and out of it, something to find
    // there, and the pane's own animal moved into it — which animal that is was
    // drawn live, so the line is written for whoever the pane actually holds.
    const character = await page.locator("#window-a").getAttribute("data-character");
    const added = [
      "Larder is a room.",
      "Larder is an underground-space.",
      "Sett-1 has an exit east to the larder.",
      "Larder has an exit west to the sett-1.",
      "Turnip-9 is a turnip.",
      "Turnip-9 lies in the larder.",
      `${character} stands in the larder.`,
    ].join("\n");
    const status = await syncEditorText(page, `${seeded}\n${added}\n`);
    assert.match(status, /synced/, "a document that parses cleanly writes");
    assert.ok(
      (await page.locator("#editMapBoard .room text").allTextContents()).includes("larder"),
      "the survey redraws from what was typed",
    );

    await page.locator("#editModeBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
    assert.ok(
      (await page.locator("#worldMapBoard .room text").allTextContents()).includes("larder"),
      "and the room reaches the live world, not just the editor's own picture of it",
    );

    // The real proof: the engine plays the world the edit describes.
    await sendMudCommand(page, "a", "look");
    const replies = await page.locator("#window-a-chatlog .a").allTextContents();
    const arrived = replies[replies.length - 1];
    assert.match(arrived, /Larder is a room/, "a room that did not exist before the edit is the one it plays in");
    assert.match(arrived, /take turnip-9/, "what was typed into it is a real thing the room offers");
    assert.match(arrived, /go west/, "and the exit typed alongside it is a way the engine will take");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error editing the world and playing the result");
  } finally {
    await context.close();
  }
});

test("a line edit mode cannot read is reported and retracts nothing", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    await openEditor(page);
    const seeded = await page.locator("#editorText").inputValue();

    const status = await syncEditorText(page, `${seeded}\nthe larder smells faintly of onions\n`);
    assert.match(status, /not understood yet/, "the unreadable line is named, never silently dropped");
    assert.match(status, /nothing is retracted/, "and a typo is never read as 'this fact is gone'");

    // The world is untouched: every room the page opened with is still there.
    const rooms = await page.locator("#editMapBoard .room text").allTextContents();
    for (const room of ["garden", "burrow-1", "sett-1", "fox-den"]) {
      assert.ok(rooms.includes(room), `the ${room} survives a document that does not parse`);
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error holding an unparseable document");
  } finally {
    await context.close();
  }
});

test("the npcs slider adds animals to the world without adding a pane, and they take their own turns", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudPage();
  try {
    const dotsInSurvey = () => page.locator("#worldMapBoard .occupant").count();
    assert.equal(await dotsInSurvey(), 4, "two panes and the two default npcs all stand somewhere");

    await setNpcCount(page, 10);
    assert.equal(await page.locator(".mud-window").count(), 2, "an npc never takes a pane of its own");
    assert.equal(await dotsInSurvey(), 12, "ten npcs join the two cast animals in the one world");
    assert.match(await page.locator("#worldMapKey .key-npcs").textContent(), /10 npcs/, "the survey keys them as one entry");
    assert.equal(await page.locator("#worldMapKey .key-actor").count(), 2, "and keeps a colour key per pane, not per animal");

    // Nothing plays until the deck says so, and then everything does: the npcs
    // have no control of their own that could have started them.
    const paneCharacters = await page.locator(".mud-window").evaluateAll((els) => els.map((e) => e.getAttribute("data-character")));
    const before = await whereEveryoneStands(page);
    await page.locator("#autoToggle").click();
    await page.waitForFunction(
      () => Number((document.querySelector("#globalTurnCount")?.textContent.match(/\d+/) ?? ["0"])[0]) > 24,
      null,
      { timeout: ANSWER_TIMEOUT_MS },
    );
    await page.locator("#autoToggle").click();

    const after = await whereEveryoneStands(page);
    const moved = Object.keys(before).filter((id) => !paneCharacters.includes(id) && before[id] !== after[id]);
    assert.ok(moved.length > 0, "an animal with no pane still walks, digs and forages under the deck's own play");

    await setNpcCount(page, 1);
    assert.equal(await dotsInSurvey(), 3, "recasting draws a fresh, smaller crowd");
    assert.match(await page.locator("#worldMapKey .key-npcs").textContent(), /1 npc digging/, "one reads as one");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error running a dozen animals through one shared world");
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
