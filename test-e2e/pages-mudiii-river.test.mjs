// mudiii.html's river-crossing scenario, in a real browser: the fourth
// dropdown entry opens paused (a puzzle solves by search, it does not play
// itself), names its four passengers on the follow control, and its actor
// card and outlook panel show the crossing plan a bounded search found over
// the world's own drive facts. Editing the fox's own appetite for the goat
// live-redraws that plan with no turn spent: retracting it widens the
// search, restoring it and adding a second appetite exhausts every legal
// opening, and undoing both returns the original crossing byte-identically.
//
// The playing screen itself is the other half: the same 3D stage the chase
// squares use draws two banks, the water between them, a boat and one
// labelled figure per passenger, and play walks the crossing the planner
// found one move at a time. Pause holds where it stopped, step takes a single
// crossing, reset puts everyone back, and the panel under the chat shows
// whichever passenger is followed — its beliefs, the plan, and the drive
// sentences it inherits from its class. A link can open the page straight on
// the scenario (mudiii.html?scenario=river) with no dropdown touched.
// Mirrors pages-mudiii.test.mjs's own fixture setup and assertion style.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

// Generous because a deployed-origin boot pays CDN latency on top of the
// seed's own indexing, and has been measured crossing 30s.
const READY_TIMEOUT_MS = 60_000;
const SYNC_TIMEOUT_MS = 20_000;
const PHONE_WIDTHS = [375, 320];

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  // Recent Chromium refuses software WebGL outright unless explicitly told
  // it is allowed — without this flag the canvas stays a silent black
  // square rather than failing loudly, which is a much harder thing to
  // debug than a launch flag.
  browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"] });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

/** Open mudiii.html and wait for its opening (chase) board to finish
 *  booting, the same signal pages-mudiii.test.mjs's own openMudiiiPage
 *  waits on. Third-party hosts are blocked and same-origin console
 *  errors/failed requests are tracked for the whole session, river switch
 *  included. */
async function watchedPage() {
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
  return { context, page, consoleErrors, failedRequests };
}

/** Open mudiii.html on a URL of its own and wait for whichever scenario that
 *  URL asks for to finish booting. A puzzle scenario opens paused by design,
 *  so the ready signal is bootPuzzle's own last act: naming itself in the
 *  scene status. */
async function openRiverPageDirectly(query) {
  const opened = await watchedPage();
  await opened.page.goto(`${server.origin}/mudiii.html${query}`, { waitUntil: "networkidle" });
  await readUntil(
    opened.page,
    (p) => p.evaluate(() => /puzzle/i.test(document.querySelector("#sceneStatus")?.textContent || "")),
    (ready) => ready === true,
    { timeout: READY_TIMEOUT_MS },
  );
  return opened;
}

async function openMudiiiPage() {
  const opened = await watchedPage();
  const { page } = opened;

  await page.goto(`${server.origin}/mudiii.html`, { waitUntil: "networkidle" });
  // Sleep-then-read rather than waitForFunction: boot indexing can starve
  // the rAF ticks waitForFunction polls on, reporting a timeout on a page
  // that is merely busy (readUntil's own comment has the full account).
  await readUntil(
    page,
    (p) => p.evaluate(() => {
      const input = document.querySelector("#chatInput");
      return Boolean(input && !input.disabled);
    }),
    (ready) => ready === true,
    { timeout: READY_TIMEOUT_MS },
  );
  await readUntil(
    page,
    (p) => p.evaluate(() => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true"),
    (ready) => ready === true,
    { timeout: READY_TIMEOUT_MS },
  );
  return opened;
}

/** Stop the board and wait until it is actually still — pauseBoard's own
 *  shape from pages-mudiii.test.mjs. Checked before clicking rather than
 *  clicked blindly: a blind click toggles a paused board back to playing
 *  just as readily as it stops a playing one, which is exactly the mistake
 *  gen-screenshots.mjs's own mudiii ready check had to learn to avoid. */
async function pauseBoard(page) {
  if (await page.locator("#autoToggle").getAttribute("aria-pressed") === "true") {
    await page.locator("#autoToggle").click();
  }
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "false",
    null,
    { timeout: SYNC_TIMEOUT_MS },
  );
}

/** Switch the deck to the river-crossing scenario and wait for its own
 *  puzzle boot to finish. A puzzle scenario opens paused by design — nothing
 *  moves on its own — so waiting for the play control to read "true" the
 *  way pages-mudiii.test.mjs's switchScenario does for a chase square would
 *  hang forever. bootPuzzle's own last act is naming itself in the scene
 *  status, so that is the ready signal here instead. */
async function openRiverScenario(page) {
  await pauseBoard(page);
  await page.evaluate(() => {
    const index = MUDIII_PAGE_DATA.scenarios.findIndex((s) => /river/i.test(s.label || ""));
    const select = document.getElementById("scenarioSelect");
    select.value = String(index);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await readUntil(
    page,
    (p) => p.evaluate(() => /puzzle/i.test(document.querySelector("#sceneStatus")?.textContent || "")),
    (ready) => ready === true,
    { timeout: READY_TIMEOUT_MS },
  );
}

/** Enter edit mode and wait for it to take — the actor card and the outlook
 *  panel are both `body.editing`-gated, the same as the world editor. */
async function enterEditMode(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
}

const OPENING_BANKS = Object.freeze({
  "cabbage-1": "bank-east", "farmer-1": "bank-east", "fox-1": "bank-east", "goat-1": "bank-east",
});

/** Where every passenger is drawn right now, read off the board's own chips:
 *  `{ "goat-1": "bank-west", ... }`, with "boat" for anyone aboard. */
const readBanks = (page) => page.$$eval(
  ".river-chip",
  (chips) => Object.fromEntries(chips.map((chip) => [chip.dataset.passenger, chip.dataset.place])),
);

const readBoard = (page) => page.evaluate(() => ({
  progress: document.querySelector("#riverProgress")?.textContent ?? "",
  move: document.querySelector("#riverMoveText")?.textContent ?? "",
  boat: document.querySelector("#riverBoat")?.getAttribute("data-at") ?? "",
  playing: document.querySelector("#autoToggle")?.getAttribute("aria-pressed") ?? "",
}));

/** Poll `read` until `accepts` takes its answer. A sleep-then-read loop
 *  rather than waitForFunction: the crossing runs its own timers and a
 *  planner re-search can hold the main thread, and this reports the last
 *  reading it saw when it gives up instead of a bare timeout. */
async function readUntil(page, read, accepts, { timeout = SYNC_TIMEOUT_MS, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  for (;;) {
    last = await read(page);
    if (accepts(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`gave up waiting on the crossing; last reading was ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => { setTimeout(resolve, interval); });
  }
}

const movesPlayed = (board) => Number((/move (\d+) of/.exec(board.progress) ?? [0, -1])[1]);

/** What the 3D stage is actually drawing: the two bank names, where the boat
 *  is, and each passenger's own world position, label and mesh count. A
 *  software renderer's pixels say nothing about which bank anyone is on, so
 *  the scene's own state hook is what an assertion reads. */
const readStage = (page) => page.evaluate(() => (window.mudiiiScene?.riverSnapshot?.() ?? null));

const PASSENGERS = ["cabbage-1", "farmer-1", "fox-1", "goat-1"];
// Both banks sit this far either side of the water in the scene's own units.
const BANK_X = 4.6;

test("the river scenario opens paused with zero console or page errors, naming its four passengers on the follow control", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);

    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "a solved-by-search puzzle opens paused, never playing itself");
    assert.equal(await page.locator("#puzzleNote").isHidden(), false, "the puzzle note explains why nothing moves on its own");

    const ids = await page.$$eval("#agentSelect option", (opts) => opts.map((o) => o.value));
    assert.deepEqual(ids, ["cabbage-1", "farmer-1", "fox-1", "goat-1"], "the follow control lists exactly the river's own four passengers");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error opening the river scenario");
  } finally {
    await context.close();
  }
});

test("the crossing plan is the classic seven moves, goat first and goat last, and the belief panel never fabricates a belief table for a world with no vision model", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);
    await enterEditMode(page);
    await page.selectOption("#agentSelect", "farmer-1");

    const planText = await page.locator("#outlookPuzzlePlanText").textContent();
    assert.match(planText, /found 7 moves \(shortest\)/, "the classic optimum");
    const moveLines = planText.split("\n").slice(1).map((l) => l.trim());
    assert.equal(moveLines.length, 7, "seven crossings");
    assert.match(moveLines[0], /^1\. ferry goat-1 onto bank-west$/, "the goat crosses first");
    assert.match(moveLines[6], /^7\. ferry goat-1 onto bank-west$/, "the goat crosses last");

    // farmer-1 has no roster entry to hold a belief map over — the river
    // world has no grid cells or vision radii for a belief to be computed
    // from at all — so the panel states that plainly rather than drawing an
    // empty or invented row.
    const beliefRows = await page.locator("#outlookBeliefBody tr").count();
    assert.equal(beliefRows, 1, "one placeholder row, never a fabricated belief per passenger");
    assert.match(
      await page.locator("#outlookBeliefBody").textContent(),
      /follow an agent above to see what it believes/i,
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error reading the crossing plan and the belief panel");
  } finally {
    await context.close();
  }
});

test("editing the fox's own appetite for the goat live-redraws the crossing plan: shorter without it, an honest miss with a second appetite added, and byte-identical once restored", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);
    await enterEditMode(page);
    await page.selectOption("#agentSelect", "fox-1");
    await page.locator("#actorTabClass").click();

    const originalPlanText = await page.locator("#outlookPuzzlePlanText").textContent();
    const originalClassText = await page.locator("#actorEditorText").inputValue();
    assert.match(originalClassText, /^fox eats goat\.$/m, "the fox's own class carries its appetite for the goat as an editable line");

    // Delete the fox's appetite for the goat: the derived constraint drops,
    // the search widens, and the crossing gets shorter.
    const withoutGoatAppetite = originalClassText
      .split("\n")
      .filter((line) => line.trim() !== "fox eats goat.")
      .join("\n");
    await page.locator("#actorEditorText").fill(withoutGoatAppetite);
    await page.waitForFunction(
      (orig) => {
        const t = document.querySelector("#outlookPuzzlePlanText")?.textContent || "";
        return t.length > 0 && t !== orig;
      },
      originalPlanText,
      { timeout: SYNC_TIMEOUT_MS },
    );
    const shortenedPlanText = await page.locator("#outlookPuzzlePlanText").textContent();
    const shortenedMatch = /found (\d+) moves? \(shortest\)/.exec(shortenedPlanText);
    assert.ok(shortenedMatch, "a crossing plan still exists with one fewer constraint");
    assert.ok(Number(shortenedMatch[1]) < 7, `expected fewer than 7 moves, got ${shortenedMatch[1]}`);

    // Restore the goat appetite and add a second one, for the cabbage: every
    // pair is now mutually exclusive, so the panel reports the honest miss
    // rather than a shortened or invented plan.
    const withBothAppetites = `${originalClassText}\nfox eats cabbage.`;
    await page.locator("#actorEditorText").fill(withBothAppetites);
    await page.waitForFunction(
      () => /no plan found within \d+ moves/.test(document.querySelector("#outlookPuzzlePlanText")?.textContent || ""),
      null,
      { timeout: SYNC_TIMEOUT_MS },
    );
    assert.match(await page.locator("#outlookPuzzlePlanText").textContent(), /^puzzle plan — no plan found within \d+ moves$/);

    // Undo both edits: the world's own unedited rows recompute the original
    // seven-move crossing, byte-identically.
    await page.locator("#actorEditorText").fill(originalClassText);
    await page.waitForFunction(
      (orig) => document.querySelector("#outlookPuzzlePlanText")?.textContent === orig,
      originalPlanText,
      { timeout: SYNC_TIMEOUT_MS },
    );
    assert.equal(await page.locator("#outlookPuzzlePlanText").textContent(), originalPlanText, "restoring the fox's own rows returns the original crossing byte-identically");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error retracting, widening and restoring the fox's own appetite");
  } finally {
    await context.close();
  }
});

test("the crossing opens with all four passengers on the near bank, drawn on the same 3D stage the chase squares use", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);

    assert.equal(await page.locator("#sceneStage").isVisible(), true, "the 3D stage stays put and draws the river instead of a square");
    assert.equal(await page.locator("#riverStage").isVisible(), true, "the crossing's title, progress and last move sit under it");
    assert.equal(await page.locator("#riverBoard").isVisible(), false, "the flat board is the fallback for a stage that could not start, not the default view");
    assert.equal(await page.locator("#mapPanel").isVisible(), false, "the overhead map of a square that does not exist stays away");

    assert.deepEqual(await readBanks(page), OPENING_BANKS, "everyone starts on the east bank");
    const board = await readBoard(page);
    assert.equal(board.progress, "move 0 of 7", "the board names which of the seven moves it is on");
    assert.match(board.move, /nobody has crossed yet/i);
    assert.equal(board.boat, "left", "the boat is moored on the near bank");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error drawing the crossing board");
  } finally {
    await context.close();
  }
});

test("the 3D stage draws the two named banks, a boat and one labelled figure per passenger", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);

    // Every figure is a label sprite plus its own mesh; the fox's is the same
    // GLB the chase squares load for it, so the wait is for that fetch.
    const stage = await readUntil(
      page, readStage,
      (s) => Boolean(s) && PASSENGERS.every((id) => s.passengers[id] && s.passengers[id].parts >= 2),
      { timeout: READY_TIMEOUT_MS },
    );

    assert.deepEqual(stage.banks, ["bank-east", "bank-west"], "the two shores the plan's own positions name, near one first");
    assert.deepEqual(Object.keys(stage.passengers).sort(), PASSENGERS, "one figure per passenger, and nothing else on the water");
    for (const id of PASSENGERS) {
      const passenger = stage.passengers[id];
      // The name over a figure's head is whatever the world's own rows call
      // it (its mgx:display-name), falling back to the id when they say
      // nothing — never a label this stage invents.
      assert.ok(passenger.label && id.startsWith(passenger.label), `${id} carries its own name over its head, not "${passenger.label}"`);
      assert.equal(passenger.visible, true, `${id} is actually drawn, not held back off the board`);
      assert.equal(passenger.aboard, false, "nobody has boarded yet");
      assert.equal(passenger.x, -BANK_X, `${id} stands on the near bank`);
    }
    const labels = PASSENGERS.map((id) => stage.passengers[id].label);
    assert.equal(new Set(labels).size, PASSENGERS.length, `each figure is named apart from the others: ${JSON.stringify(labels)}`);
    // Four figures on one bank stand apart rather than inside each other.
    const lanes = PASSENGERS.map((id) => stage.passengers[id].z);
    assert.equal(new Set(lanes).size, PASSENGERS.length, `each figure has its own lane along the bank: ${JSON.stringify(lanes)}`);
    assert.equal(stage.boat.side, "near", "the boat is moored on the near bank");
    assert.ok(stage.boat.x < 0 && stage.boat.x > -BANK_X, `the boat sits on the water, not on a bank: ${stage.boat.x}`);

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error drawing the crossing in three dimensions");
  } finally {
    await context.close();
  }
});

test("a step ferries its passengers across the 3D stage: they board the boat, ride it over and step off on the far bank", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);
    const opening = await readUntil(page, readStage, (s) => Boolean(s) && Boolean(s.boat));

    // The stage's own drawing contract, driven straight: passengers handed as
    // aboard ride the boat rather than standing on a bank.
    await page.evaluate((banks) => window.mudiiiScene.applyRiver({
      banks,
      position: {
        "cabbage-1": banks[0], "farmer-1": banks[0], "fox-1": banks[0], "goat-1": banks[0],
      },
      aboard: ["farmer-1", "goat-1"],
      boatPlace: banks[1],
      crossingMs: 400,
    }), opening.banks);
    const afloat = await readStage(page);
    assert.equal(afloat.boat.side, "crossing", "a boat with passengers aboard reads as crossing, not moored");
    assert.equal(afloat.passengers["farmer-1"].aboard, true, "the one rowing is aboard");
    assert.equal(afloat.passengers["goat-1"].aboard, true, "and so is the passenger being carried");
    assert.equal(afloat.passengers["fox-1"].aboard, false, "the fox was never on this crossing");
    const carried = await readUntil(
      page, readStage,
      (s) => s.boat.x > 0 && Math.abs(s.passengers["goat-1"].x - s.boat.x) < 0.01,
    );
    assert.ok(
      Math.abs(carried.passengers["farmer-1"].x - carried.boat.x) < 0.01,
      "everyone aboard travels with the hull rather than drifting off it",
    );
    assert.equal(carried.passengers["fox-1"].x, -BANK_X, "and whoever stayed behind has not moved");

    // Then the real thing: one step of the planner's own crossing lands the
    // two travellers on the far bank.
    await page.locator("#stepBtn").click();
    const landed = await readUntil(
      page, readStage,
      (s) => s.passengers["goat-1"].x === BANK_X && s.passengers["farmer-1"].x === BANK_X,
      { timeout: 30_000 },
    );
    assert.equal(landed.passengers["goat-1"].aboard, false, "the goat is off the boat once the move lands");
    assert.equal(landed.passengers["fox-1"].x, -BANK_X, "the fox is still on the near bank");
    assert.equal(landed.passengers["cabbage-1"].x, -BANK_X, "and so is the cabbage");
    assert.equal(landed.boat.side, "far", "the boat is moored on the far side it rowed to");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error ferrying a passenger across the 3D stage");
  } finally {
    await context.close();
  }
});

test("mudiii.html?scenario=river opens on the crossing with no dropdown touched, and an address it does not carry opens the first square", async () => {
  const { context, page, consoleErrors, failedRequests } = await openRiverPageDirectly("?scenario=river");
  try {
    const picked = await page.locator("#scenarioSelect").inputValue();
    const label = await page.$eval("#scenarioSelect", (select) => select.selectedOptions[0].textContent);
    assert.match(label, /river crossing/i, "the dropdown agrees with the scenario the URL opened");
    assert.notEqual(picked, "0", "and it is not the square the page would otherwise have opened on");

    assert.match(await page.locator("#sceneStatus").textContent(), /puzzle/i, "the scene names the puzzle it booted");
    assert.equal(await page.locator("#puzzleNote").isHidden(), false, "the puzzle note explains why nothing moves on its own");
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "a solved-by-search puzzle opens paused");
    const ids = await page.$$eval("#agentSelect option", (opts) => opts.map((o) => o.value));
    assert.deepEqual(ids, PASSENGERS, "the follow control lists the river's own four passengers");
    assert.deepEqual(await readBanks(page), OPENING_BANKS, "everyone starts on the east bank");
    const stage = await readUntil(page, readStage, (s) => Boolean(s) && Boolean(s.boat));
    assert.deepEqual(stage.banks, ["bank-east", "bank-west"], "and the 3D stage is the river, not a town square");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error opening the crossing straight from a link");
  } finally {
    await context.close();
  }

  // An address the page carries no scenario for opens the one it always did,
  // rather than an error or an empty stage.
  const unknown = await watchedPage();
  try {
    await unknown.page.goto(`${server.origin}/mudiii.html?scenario=lagoon`, { waitUntil: "networkidle" });
    await unknown.page.waitForFunction(
      () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    assert.equal(await unknown.page.locator("#scenarioSelect").inputValue(), "0", "an unknown scenario falls back silently to the first");
    assert.equal(await unknown.page.locator("#sceneStage").isVisible(), true, "and the town square plays as it always does");
    assert.deepEqual(unknown.consoleErrors, [], "no console error on a scenario name the page does not carry");
  } finally {
    await unknown.context.close();
  }
});

test("play executes the planner's moves, the passengers cross bank by bank, and pause holds the boat where it stopped", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);

    await page.locator("#autoToggle").click();
    // The first crossing takes the goat over: that is move one of the plan
    // the panel already printed, played rather than re-derived here.
    const afterFirst = await readUntil(page, readBanks, (banks) => banks["goat-1"] === "bank-west");
    assert.equal(afterFirst["farmer-1"], "bank-west", "the farmer rows, so the farmer crosses with the goat");
    assert.equal(afterFirst["fox-1"], "bank-east", "the fox stays put — it was never on this crossing");

    await readUntil(page, readBoard, (board) => movesPlayed(board) >= 3);
    await page.locator("#autoToggle").click();
    const held = await readUntil(
      page, readBoard,
      (board) => board.playing === "false" && board.boat !== "crossing",
    );
    const heldBanks = await readBanks(page);
    assert.ok(movesPlayed(held) >= 3 && movesPlayed(held) < 7, `paused part-way through, at ${held.progress}`);
    // Which passengers are across depends on the move it stopped on — the
    // farmer rows some of them back — so the claim here is only that the
    // crossing really has moved people, not a count the timing decides.
    assert.notDeepEqual(heldBanks, OPENING_BANKS, "the opening arrangement is behind it");
    assert.ok(
      Object.values(heldBanks).some((place) => place === "bank-west"),
      `somebody is across when it stops: ${JSON.stringify(heldBanks)}`,
    );

    // A paused crossing is a still one: nothing lands after the click.
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    assert.deepEqual(await readBoard(page), held, "a paused board holds the move it stopped on");
    assert.deepEqual(await readBanks(page), heldBanks, "and holds everyone exactly where they stood");

    // Play again from where it was held, and it finishes the crossing.
    await page.locator("#autoToggle").click();
    const finished = await readUntil(page, readBoard, (board) => movesPlayed(board) === 7, { timeout: 30_000 });
    assert.match(finished.move, /everyone is across/i);
    assert.deepEqual(await readBanks(page), {
      "cabbage-1": "bank-west", "farmer-1": "bank-west", "fox-1": "bank-west", "goat-1": "bank-west",
    }, "the seventh move lands everybody on the west bank");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error playing, pausing and resuming the crossing");
  } finally {
    await context.close();
  }
});

test("step takes one crossing on its own, and reset puts everyone back on the opening bank", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);

    await page.locator("#stepBtn").click();
    const afterOne = await readUntil(page, readBoard, (board) => movesPlayed(board) === 1 && board.boat !== "crossing");
    assert.match(afterOne.move, /last move: ferry goat-1 onto bank-west/);
    assert.deepEqual(await readBanks(page), {
      "cabbage-1": "bank-east", "farmer-1": "bank-west", "fox-1": "bank-east", "goat-1": "bank-west",
    }, "one step is one crossing, no more");

    await page.locator("#stepBtn").click();
    const afterTwo = await readUntil(page, readBoard, (board) => movesPlayed(board) === 2 && board.boat !== "crossing");
    assert.match(afterTwo.move, /last move: ferry farmer-1 onto bank-east/, "the farmer rows back alone");

    await page.locator("#resetBtn").click();
    await readUntil(page, readBoard, (board) => movesPlayed(board) === 0);
    assert.deepEqual(await readBanks(page), OPENING_BANKS, "reset is the opening arrangement again");
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "and it hands the board back stopped");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error stepping and resetting the crossing");
  } finally {
    await context.close();
  }
});

test("the panel under the chat carries the followed passenger's beliefs, the plan and its inherited drives, and follows a new pick mid-crossing", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);
    assert.equal(await page.locator("#mudiiiFocusPanel").isVisible(), true, "it sits on the playing screen, not behind the edit button");

    await page.selectOption("#agentSelect", "cabbage-1");
    assert.equal(await page.locator("#focusWho").textContent(), "cabbage-1");
    const cabbageDrives = await page.locator("#focusImperatives").textContent();
    assert.match(cabbageDrives, /# inherited from cabbage/, "the class the instance inherits from is named");
    assert.match(cabbageDrives, /# cabbage evades goat\./, "including the drive that makes the puzzle a puzzle");

    const planText = await page.locator("#focusPlanText").textContent();
    assert.match(planText, /1\. ferry goat-1 onto bank-west/, "the crossing the planner found, from its first move");
    assert.match(planText, /7\. ferry goat-1 onto bank-west/, "to its last");

    // The river world has no vision model, so the belief column states that
    // rather than drawing an invented row per passenger.
    assert.match(await page.locator("#focusBeliefs").textContent(), /keeps no belief map/i);

    await page.locator("#stepBtn").click();
    await readUntil(page, readBoard, (board) => movesPlayed(board) === 1 && board.boat !== "crossing");
    assert.match(
      await page.locator("#focusPlanText").textContent(),
      /✓ 1\. ferry goat-1 onto bank-west/,
      "a played move is marked off in the plan the panel shows",
    );

    // Swapping who is followed mid-crossing repopulates the panel from the
    // new passenger's own rows.
    await page.selectOption("#agentSelect", "fox-1");
    assert.equal(await page.locator("#focusWho").textContent(), "fox-1");
    assert.match(await page.locator("#focusImperatives").textContent(), /# fox eats goat\./);

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error reading the followed passenger's own panel");
  } finally {
    await context.close();
  }
});

for (const width of PHONE_WIDTHS) {
  test(`the river scenario's crossing board, actor card and outlook panel have no horizontal overflow at ${width}px`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 812 } });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(server.origin)) return route.continue();
      return route.abort();
    });
    try {
      await page.goto(`${server.origin}/mudiii.html`, { waitUntil: "networkidle" });
      await page.waitForFunction(
        () => document.querySelector("#chatInput") && !document.querySelector("#chatInput").disabled,
        null,
        { timeout: READY_TIMEOUT_MS },
      );
      await page.waitForFunction(
        () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
        null,
        { timeout: READY_TIMEOUT_MS },
      );
      await openRiverScenario(page);
      await page.selectOption("#agentSelect", "farmer-1");

      const measure = () => page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const playing = await measure();
      assert.ok(
        playing.scrollWidth <= playing.clientWidth + 1,
        `the river scenario's playing screen is ${playing.scrollWidth}px wide inside a ${playing.clientWidth}px viewport`,
      );

      await enterEditMode(page);
      const editing = await measure();
      assert.ok(
        editing.scrollWidth <= editing.clientWidth + 1,
        `the river scenario's edit view is ${editing.scrollWidth}px wide inside a ${editing.clientWidth}px viewport`,
      );
    } finally {
      await context.close();
    }
  });
}
