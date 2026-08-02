// mudiii.html's own town square, in a real browser: the board opens already
// playing (and stays still for a visitor who asked for reduced motion), the
// follow control is closed while it plays and open once it is paused, pausing
// and pressing play again moves at least one agent to a new cell and advances
// the shared turn counter, a click on a blocked cell writes nothing and leaves
// the food pill armed, and a typed "put food at cell-3-4" and the same click
// both land the same kind of fact set. Mirrors pages-mud.test.mjs's own
// fixture setup and assertion style.
//
// Every model-dependent assertion is gated on `public/models/` actually
// being on disk — a sibling wave-2 track copies it in from
// data/mudiii-assets.json's own manifest, and until it lands this file still
// proves the simulation itself runs (cells change, the counter advances, the
// map panel's own dots move) without needing a single GLB. The core
// three-scripts contract this page depends on — src/services/mudiii-viz.mjs
// (the page shell), src/services/mudiii-scene.mjs (this track, see its own
// header), scripts/build-three-vendor.mjs (public/vendor/three.js) — also
// has to be present on whichever tree runs this file; see the coordinator's
// own report on when each lands.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const TICK_TIMEOUT_MS = 20_000;

let siteDir;
let server;
let browser;
let modelsPresent;

before(async () => {
  // public/models is not checked out in every worktree yet (see this file's
  // own header) — buildDemoSiteSnapshot's own TRACKED_SITE_FILES already
  // names it, so a missing directory throws ENOENT on the copy step rather
  // than merely 404ing per file. Recorded once here so every test below can
  // gate its model-dependent assertions without re-deriving it.
  modelsPresent = existsSync(path.join(repoRoot, "public", "models"));
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

/** Open mudiii.html and wait for its own session to finish booting — the deck's
 *  play control turns itself on as the last thing boot() does, which is the
 *  signal that the opening board has actually been drawn. Third-party hosts
 *  are blocked and same-origin console errors/failed requests are tracked.
 *
 *  `reducedMotion: "reduce"` opens the page as a visitor who asked for less
 *  movement, and that visitor's board never starts on its own, so the play
 *  control never flips. The chat input is no use as a stand-in: boot() enables
 *  it several steps before it reads the opening board back and renders it,
 *  which measured 0.7s to 3.2s of open window against the deployed site. The
 *  chat rail is drawn by the same renderAll() pass that draws the HUD row and
 *  the map panel, and it is a different surface from either, so a pill on it is
 *  this visitor's own "the opening board is up" signal without standing in for
 *  what the test asserts. */
async function openMudiiiPage({ reducedMotion = null } = {}) {
  const context = await browser.newContext(reducedMotion ? { reducedMotion } : {});
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

  await page.goto(`${server.origin}/mudiii.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#chatInput") && !document.querySelector("#chatInput").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  await page.waitForFunction(
    (stillBoard) => (stillBoard
      ? document.querySelectorAll("#chatPills .pill").length > 0
      : document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true"),
    Boolean(reducedMotion),
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors, failedRequests };
}

const turnCountOf = async (page) =>
  Number(((await page.locator("#globalTurnCount").textContent()).match(/\d+/) ?? ["0"])[0]);

/** Stop the board and wait until it is actually still. Pausing ends the loop,
 *  but the tick already in flight still lands, so every assertion that compares
 *  two reads of the world has to wait for the counter to settle rather than
 *  trusting the play control's own flag alone. */
async function pauseBoard(page) {
  if (await page.locator("#autoToggle").getAttribute("aria-pressed") === "true") {
    await page.locator("#autoToggle").click();
  }
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "false",
    null,
    { timeout: TICK_TIMEOUT_MS },
  );
  await page.waitForFunction(() => {
    const read = () => document.querySelector("#globalTurnCount")?.textContent ?? "";
    const first = read();
    return new Promise((resolve) => { setTimeout(() => resolve(read() === first), 700); });
  }, null, { timeout: TICK_TIMEOUT_MS });
}

/** Wait for a reboot (a slider change, a scenario switch, Reset) to finish.
 *  boot() turns the play control on as its very last act, so that flipping back
 *  to "true" is the one signal that the new cast is drawn and running. */
const waitForReboot = (page) => page.waitForFunction(
  () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
  null,
  { timeout: READY_TIMEOUT_MS },
);

/** Wait for a Reset to finish. Reset hands the board back STOPPED, so it
 *  cannot use waitForReboot's own signal: it names itself in the scene status
 *  instead, and the play control going quiet is the second half of the same
 *  answer. */
const waitForRecast = (page) => page.waitForFunction(
  () => /re-cast and stopped/.test(document.querySelector("#sceneStatus")?.textContent ?? "")
    && document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "false",
  null,
  { timeout: READY_TIMEOUT_MS },
);

/** Every agent the HUD row currently draws, id -> its authoritative stored
 *  cell, read through `window.mudiiiScene.cellOf` — a JS handle rather than
 *  a pixel position, so this survives a software renderer and even a
 *  scene-load failure (a HUD card still carries `data-agent` with no 3D
 *  scene behind it). */
const agentCellsOf = (page) => page.evaluate(() => {
  const out = {};
  for (const card of document.querySelectorAll("#hudRow .hud-card[data-agent]")) {
    const id = card.getAttribute("data-agent");
    if (!id) continue;
    out[id] = window.mudiiiScene && typeof window.mudiiiScene.cellOf === "function" ? window.mudiiiScene.cellOf(id) : null;
  }
  return out;
});

test("the page opens playing, and no console error along the way", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "true", "the deck's play control starts on");
    assert.match(await page.locator("#autoToggle").textContent(), /pause/i, "and it offers the pause it is now the opposite of");
    assert.ok(await page.locator("#hudRow .hud-card").count() > 0, "the opening cast is drawn before the board starts moving it");
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "false", "the food pill starts unarmed");

    await page.waitForFunction(() => {
      const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return m && Number(m[0]) >= 1;
    }, null, { timeout: TICK_TIMEOUT_MS });
    await pauseBoard(page);
    assert.ok(await turnCountOf(page) >= 1, "turns run without the visitor pressing anything");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error opening the town square already playing");
  } finally {
    await context.close();
  }
});

test("a visitor who asked for reduced motion gets the opening board drawn and left still", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage({ reducedMotion: "reduce" });
  try {
    assert.ok(await page.locator("#hudRow .hud-card").count() > 0, "the opening cast is still drawn");
    assert.ok(await page.locator("#mapPanelBoard .map-dot").count() > 0, "and the map panel still shows where it stands");
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "nothing started on its own");
    assert.equal(await turnCountOf(page), 0, "no turn ran unasked");
    assert.equal(await page.locator("#agentSelect").isDisabled(), false, "the follow control is open, because nothing is playing");

    // The play control is right there — this is a default, not a lockout.
    await page.locator("#autoToggle").click();
    await page.waitForFunction(() => {
      const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return m && Number(m[0]) >= 1;
    }, null, { timeout: TICK_TIMEOUT_MS });
    await pauseBoard(page);

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error holding the board still");
  } finally {
    await context.close();
  }
});

test("the follow control closes while the board plays, opens when it is paused, and keeps the pick", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    assert.equal(
      await page.locator("#agentSelect").getAttribute("aria-describedby"),
      "agentSelectHint",
      "the hint is associated with the control it describes, not floating loose beside it",
    );
    assert.equal(await page.locator("#agentSelect").isDisabled(), true, "a playing board closes the follow control");
    assert.ok(await page.locator("#agentSelectHint").isVisible(), "and the hint says what to do about it");
    assert.match(await page.locator("#agentSelectHint").textContent(), /pause/i);

    await pauseBoard(page);
    assert.equal(await page.locator("#agentSelect").isDisabled(), false, "a still board opens it again");
    assert.equal(await page.locator("#agentSelectHint").isVisible(), false, "and the hint has nothing left to say");

    const ids = await page.$$eval("#agentSelect option", (options) => options.map((o) => o.value));
    const goblin = ids.find((id) => id.startsWith("goblin-"));
    assert.ok(goblin, "the cast has a goblin to swap to");
    await page.selectOption("#agentSelect", goblin);
    assert.equal(await page.locator("#agentSelect").inputValue(), goblin, "the pick sticks while the board is still");
    assert.equal(
      await page.locator('#cameraMode button[data-mode="follow"]').getAttribute("aria-pressed"),
      "true",
      "picking someone leaves the camera following, never sitting in overhead",
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error swapping who the camera follows");
  } finally {
    await context.close();
  }
});

test("step advances the shared counter by exactly one, and closes while the board plays itself", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    assert.equal(await page.locator("#stepBtn").isDisabled(), true, "a playing board closes the step control");
    assert.ok(await page.locator("#stepHint").isVisible(), "and the hint says what to do about it");
    assert.match(await page.locator("#stepHint").textContent(), /pause/i);

    await pauseBoard(page);
    assert.equal(await page.locator("#stepBtn").isDisabled(), false, "a still board opens it again");
    assert.equal(await page.locator("#stepHint").isVisible(), false, "and the hint has nothing left to say");

    for (let press = 1; press <= 3; press += 1) {
      const before = await turnCountOf(page);
      await page.locator("#stepBtn").click();
      await page.waitForFunction((n) => {
        const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
        return m && Number(m[0]) !== n;
      }, before, { timeout: TICK_TIMEOUT_MS });
      await page.waitForTimeout(500);
      const after = await turnCountOf(page);
      assert.equal(after, before + 1, `press ${press} advanced the counter by exactly one whole turn`);
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error stepping three turns by hand");
  } finally {
    await context.close();
  }
});

test("a reset hands the board back stopped, following a goblin again", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    assert.match(await page.locator("#agentSelect").inputValue(), /^goblin-/,
      "the page opens riding the prey, so the opening run is a chase seen from the hunted side");
    assert.equal(await page.locator('#cameraMode button[data-mode="follow"]').getAttribute("aria-pressed"), "true");

    await page.locator("#resetBtn").click();
    await waitForRecast(page);
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false",
      "a reset leaves the square standing still — opening the page is the one time it starts itself");
    assert.equal(await page.locator("#stepBtn").isDisabled(), false, "and the step control comes back with it");
    assert.equal(await page.locator("#agentSelect").isDisabled(), false);
    assert.match(await page.locator("#agentSelect").inputValue(), /^goblin-/, "and the fresh cast is ridden from the prey side too");

    const settled = await turnCountOf(page);
    await page.waitForTimeout(2500);
    assert.equal(await turnCountOf(page), settled, "nothing takes a turn until the visitor presses play");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error resetting the square");
  } finally {
    await context.close();
  }
});

test("dragging the canvas turns the view without walking whoever the camera follows", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await pauseBoard(page);
    const cellsBefore = await agentCellsOf(page);
    const turnBefore = await turnCountOf(page);
    const box = await page.locator("#sceneCanvas").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(cx + i * 15, cy - i * 3);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);

    assert.deepEqual(await agentCellsOf(page), cellsBefore,
      "a look-around is not a move order — before this the press alone walked the followed agent");
    assert.equal(await turnCountOf(page), turnBefore, "and no turn is spent turning the camera");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error dragging to look around");
  } finally {
    await context.close();
  }
});

test("pausing and pressing play again moves at least one agent and advances the shared counter", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await pauseBoard(page);
    const startedAt = await turnCountOf(page);
    const before = await agentCellsOf(page);

    await page.locator("#autoToggle").click();
    await page.waitForFunction((n) => {
      const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return m && Number(m[0]) >= n;
    }, startedAt + 5, { timeout: TICK_TIMEOUT_MS });
    await pauseBoard(page);

    assert.ok(await turnCountOf(page) >= startedAt + 5, "the shared turn counter advanced across five more ticks");

    const after = await agentCellsOf(page);
    const moved = Object.keys(before).filter((id) => before[id] !== after[id] && after[id] != null);
    assert.ok(moved.length > 0, "at least one live agent's own stored cell changed across the run");

    const mapDots = await page.locator("#mapPanelBoard .map-dot").count();
    assert.ok(mapDots > 0, "the map panel draws a dot for the live cast, independent of whether the 3D scene loaded");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error running five ticks");
  } finally {
    await context.close();
  }
});

test("every pill on the chat rail submits a line the town square can actually read", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await pauseBoard(page);

    const commands = await page.$$eval(
      "#chatPills .pill",
      (pills) => pills.map((p) => p.getAttribute("data-command")).filter(Boolean),
    );
    assert.ok(commands.length >= 4, "the rail offers the square's own verbs alongside its claim pills");
    assert.ok(commands.includes("tick"), "the one verb that advances the world is on the rail");

    // Address pills carry no command — they move the rail's own addressee —
    // so they are clicked for their own sake rather than for an answer.
    const addressCount = await page.locator('#chatPills [data-role="dyn-addr"]').count();
    assert.ok(addressCount > 0, "the rail says who a claim is addressed to");
    for (let i = 0; i < addressCount; i += 1) {
      await page.locator('#chatPills [data-role="dyn-addr"]').nth(i).click();
      assert.equal(
        await page.locator("#chatInput").inputValue(),
        "",
        "an address pill switches the addressee and types nothing",
      );
    }

    for (const command of commands) {
      await page.fill("#chatInput", "");
      const answered = await page.locator("#chatLog .a").count();
      const pill = page.locator(`#chatPills [data-command="${command}"]`);
      // The rail redraws after every submitted line, so a claim about a cell
      // an agent has since left is gone by the time its turn comes round —
      // typed instead, because the point is whether the LINE reads, not
      // whether that one button survived.
      if (await pill.count()) await pill.first().dblclick();
      else {
        await page.fill("#chatInput", command);
        await page.locator("#chatInput").press("Enter");
      }
      await page.waitForFunction(
        (n) => document.querySelectorAll("#chatLog .a").length > n,
        answered,
        { timeout: TICK_TIMEOUT_MS },
      );
      const answer = await page.locator("#chatLog .a").last().textContent();
      assert.doesNotMatch(answer, /couldn't read a position/i, `the rail offers "${command}", which the lane cannot read`);
      assert.doesNotMatch(answer, /^I'm tmct\b/, `the rail offers "${command}", which falls through to the generic decline`);
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error working the whole pill rail");
  } finally {
    await context.close();
  }
});

test("a single pill click appends to what is already typed, so two clicks compose one line", async () => {
  const { context, page, consoleErrors } = await openMudiiiPage();
  try {
    await pauseBoard(page);
    await page.fill("#chatInput", "");
    const first = page.locator("#chatPills [data-command]").first();
    const firstText = await first.getAttribute("data-command");
    await first.click();
    assert.equal(await page.locator("#chatInput").inputValue(), firstText, "the first click fills an empty field");

    const second = page.locator("#chatPills [data-command]").nth(1);
    const secondText = await second.getAttribute("data-command");
    await second.click();
    assert.equal(
      await page.locator("#chatInput").inputValue(),
      `${firstText} ${secondText}`,
      "the second click appends after a separating space rather than replacing",
    );

    assert.deepEqual(consoleErrors, [], "no console error composing a line from two pills");
  } finally {
    await context.close();
  }
});

test("an expanded belief panel stays with its own agent across two ticks, not with the card slot", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    // A belief only exists once someone has seen something, so the board runs
    // until at least one card has a toggle to press.
    await page.waitForFunction(
      () => [...document.querySelectorAll("#hudRow .hud-belief-toggle")].some((b) => !b.hidden),
      null,
      { timeout: TICK_TIMEOUT_MS },
    );
    await pauseBoard(page);

    const expandedId = await page.evaluate(() => {
      const toggle = [...document.querySelectorAll("#hudRow .hud-belief-toggle")].find((b) => !b.hidden);
      const card = toggle.closest(".hud-card");
      toggle.click();
      return card.getAttribute("data-agent");
    });
    assert.ok(expandedId, "a card with a belief was opened");

    const detailOf = (id) => page.evaluate((agent) => {
      const card = document.querySelector(`#hudRow .hud-card[data-agent="${agent}"]`);
      if (!card) return null;
      return {
        expanded: card.querySelector(".hud-belief-toggle").getAttribute("aria-expanded"),
        detailHidden: card.querySelector(".hud-detail").hidden,
        lines: card.querySelectorAll(".hud-detail-line").length,
      };
    }, id);

    const opened = await detailOf(expandedId);
    assert.equal(opened.expanded, "true", "the toggle reports itself open");
    assert.equal(opened.detailHidden, false, "and the panel under it is showing");
    assert.ok(opened.lines > 0, "with one sentence per thing that agent believes");

    const startedAt = await turnCountOf(page);
    await page.locator("#autoToggle").click();
    await page.waitForFunction(
      (n) => {
        const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
        return m && Number(m[0]) >= n;
      },
      startedAt + 2,
      { timeout: TICK_TIMEOUT_MS },
    );
    await pauseBoard(page);

    const after = await detailOf(expandedId);
    if (after) {
      assert.equal(after.expanded, "true", "two ticks later the same agent's panel is still open");
      assert.equal(after.detailHidden, false);
    }
    const openedElsewhere = await page.evaluate((agent) => [...document.querySelectorAll("#hudRow .hud-card")]
      .filter((c) => c.getAttribute("data-agent") !== agent)
      .filter((c) => c.querySelector(".hud-belief-toggle").getAttribute("aria-expanded") === "true")
      .map((c) => c.getAttribute("data-agent")), expandedId);
    assert.deepEqual(openedElsewhere, [], "and no other agent inherited the open state through its card slot");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error expanding a belief panel");
  } finally {
    await context.close();
  }
});

test("a ring press walks the followed agent and spends a whole-world turn", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await pauseBoard(page);
    // Picked deliberately rather than taken from the default. The page opens
    // riding a goblin, and a goblin the fox caught while the board was still
    // playing leaves nobody followed and the ring hidden.
    const [firstAgent] = await page.$$eval("#agentSelect option", (options) => options.map((o) => o.value));
    assert.ok(firstAgent, "the cast has someone to follow");
    await page.selectOption("#agentSelect", firstAgent);
    const followed = await page.locator("#agentSelect").inputValue();
    assert.equal(followed, firstAgent, "and the camera is on them");

    const before = await turnCountOf(page);
    const cellsBefore = await agentCellsOf(page);
    // Press every point on the ring in turn: some are refused by the board,
    // and a refusal must still cost a turn rather than doing nothing at all.
    const points = await page.$$eval("#driveRing [data-drive]", (btns) => btns.map((b) => b.dataset.drive));
    assert.deepEqual(
      points,
      ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"],
      "the ring names all eight compass points, clockwise from north",
    );

    await page.locator('#driveRing [data-drive="north"]').click();
    await page.waitForFunction(
      (n) => {
        const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
        return m && Number(m[0]) > n;
      },
      before,
      { timeout: TICK_TIMEOUT_MS },
    );
    assert.ok(await turnCountOf(page) > before, "the press spent a turn");
    assert.match(
      await page.locator("#sceneStatus").textContent(),
      /the whole square moved with it|the turn was spent anyway/,
      "and the status says so, so the ring never reads as a free nudge",
    );

    const cellsAfter = await agentCellsOf(page);
    const anyoneMoved = Object.keys(cellsBefore).some((id) => cellsBefore[id] !== cellsAfter[id]);
    assert.ok(anyoneMoved, "the rest of the board decided and moved on that same turn");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error driving an agent by hand");
  } finally {
    await context.close();
  }
});

test("clicking the ground with nothing armed heads the followed agent that way, along a route the board allows", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await page.waitForFunction(
      () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready(),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    await pauseBoard(page);
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "false", "nothing is armed");

    // Both picked deliberately. The page opens riding a goblin, so a goblin
    // caught while the board was still playing would leave nobody to head
    // anywhere; and only from overhead is the whole board under the cursor,
    // where a follow camera aims a ray past its own edge as often as not.
    const [firstAgent] = await page.$$eval("#agentSelect option", (options) => options.map((o) => o.value));
    assert.ok(firstAgent, "the cast has someone to head somewhere");
    await page.selectOption("#agentSelect", firstAgent);
    await page.locator('#cameraMode button[data-mode="overhead"]').click();
    await page.waitForTimeout(600);

    const before = await turnCountOf(page);
    const box = await page.locator("#sceneCanvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.62);

    await page.waitForFunction(
      (n) => {
        const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
        return m && Number(m[0]) > n;
      },
      before,
      { timeout: TICK_TIMEOUT_MS },
    );

    const route = await page.evaluate(() => window.mudiiiScene.routeCellsDrawn());
    const status = await page.locator("#sceneStatus").textContent();
    if (route.length) {
      assert.ok(route.length >= 2, "a drawn route runs from the agent to the cell");
      for (const cell of route) assert.match(cell, /^cell-\d+-\d+$/);
      // Every hop is one orthogonal step, which is what "along the board's own
      // exits" means — a straight segment would jump diagonally through walls.
      for (let i = 1; i < route.length; i += 1) {
        assert.ok(directionOfHop(route[i - 1], route[i]), `${route[i - 1]} to ${route[i]} is a single step the board grants`);
      }
    } else {
      assert.match(status, /no way through to/, "an unreachable cell is declined visibly, never drawn");
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error clicking the ground unarmed");
  } finally {
    await context.close();
  }
});

// The two window shapes the overhead rig has to serve at once: a desktop
// canvas several times wider than it is tall, and a phone one that is barely
// wider than it is tall. Whichever axis runs out first is the one the board has
// to fit inside.
const FRAMING_WINDOWS = [
  { label: "wide", width: 1440, height: 780 },
  { label: "narrow", width: 380, height: 900 },
];

test("overhead frames the whole board and fills the axis that runs out first, in a wide window and a narrow one", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors } = await openMudiiiPage();
  try {
    await page.waitForFunction(
      () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready(),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    await pauseBoard(page);
    await page.locator('#cameraMode button[data-mode="overhead"]').click();

    // The largest board is the hardest to frame, so it is the one worth
    // measuring alongside the square the page opens on.
    for (const scenario of [null, /chapel/]) {
      if (scenario) await switchScenario(page, scenario);
      await page.locator('#cameraMode button[data-mode="overhead"]').click();
      for (const shape of FRAMING_WINDOWS) {
        await page.setViewportSize({ width: shape.width, height: shape.height });
        await page.waitForTimeout(600);
        const frame = await page.evaluate(() => window.mudiiiScene.boardFrameFraction());
        const where = `${scenario ? "the chapel yard" : "the opening square"} in a ${shape.label} window`;
        assert.ok(frame.width <= 1, `${where} runs off the canvas sideways, at ${frame.width} of its width`);
        assert.ok(frame.height <= 1, `${where} runs off the canvas vertically, at ${frame.height} of its height`);
        assert.ok(
          Math.max(frame.width, frame.height) > 0.8,
          `${where} sits small in frame, filling only ${Math.max(frame.width, frame.height)} of its tighter axis`,
        );
      }
    }

    assert.deepEqual(consoleErrors, [], "no console error re-rigging the camera for a new window shape");
  } finally {
    await context.close();
  }
});

test("the 3D scene canvas boots without a console error, when the model catalogue is present", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await page.waitForFunction(
      () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready(),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    assert.deepEqual(failedRequests, [], "every model request the scene makes resolves — this is what catches a missing model");
    assert.deepEqual(consoleErrors, [], "no console error loading the scene's own assets");
  } finally {
    await context.close();
  }
});

// The world direction each facing word means, mirrored from cameraRigFor's
// own FACING_VECTOR table (mudiii-viz.mjs) — the convention yawForFacing's
// own header says a rotated mesh has to match.
const FACING_VECTOR = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/** One whole board reading: the turn the page is on, and every HUD-drawn
 *  agent's own stored cell and applied Y rotation at that same instant, as
 *  `{ turn, agents: { id: { cell, yaw } } }`. All three come out of a single
 *  page.evaluate so the turn number can never describe a different moment
 *  from the cells and yaws beside it. */
const boardReadingOf = (page) => page.evaluate(() => {
  const agents = {};
  for (const card of document.querySelectorAll("#hudRow .hud-card[data-agent]")) {
    const id = card.getAttribute("data-agent");
    if (!id || !window.mudiiiScene) continue;
    agents[id] = { cell: window.mudiiiScene.cellOf(id), yaw: window.mudiiiScene.yawOf(id) };
  }
  const turn = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
  return { turn: turn ? Number(turn[0]) : null, agents };
});

function cellToXY(cell) {
  const m = /^cell-(\d+)-(\d+)$/.exec(cell || "");
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** The cardinal word a one-cell move from `a` to `b` travelled, or null for
 *  anything that is not exactly one orthogonal step (a multi-cell jump, a
 *  diagonal, or holding still). */
function directionOfHop(a, b) {
  const from = cellToXY(a), to = cellToXY(b);
  if (!from || !to) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "east";
  if (dx === -1 && dy === 0) return "west";
  if (dx === 0 && dy === 1) return "south";
  if (dx === 0 && dy === -1) return "north";
  return null;
}

/** The one-cell steps two board readings witnessed, as `{ id, direction,
 *  yaw }` — one per agent that ended `after` exactly one orthogonal cell from
 *  where `before` left it.
 *
 *  Empty unless the two readings sit exactly one turn apart. Only then is the
 *  gap between two cells a single step. The board keeps playing while the
 *  driver round-trips, so a slow read can land several turns on, and three
 *  steps (east, south, north) end one cell east of where they started with the
 *  walker facing north. A wider pair calls that a step east and blames the yaw. */
function facingSamplesBetween(before, after) {
  const out = [];
  if (before.turn == null || after.turn == null || after.turn !== before.turn + 1) return out;
  for (const id of Object.keys(after.agents)) {
    const from = before.agents[id];
    const to = after.agents[id];
    if (!from || !to || !from.cell || !to.cell) continue;
    const direction = directionOfHop(from.cell, to.cell);
    if (!direction) continue;
    out.push({ id, direction, yaw: to.yaw });
  }
  return out;
}

const NORTH_YAW = Math.PI;

test("a board reading pair several turns apart witnesses no single step, however close the two cells sit", () => {
  // Three cardinal steps can end one cell east of where they started (east,
  // south, north), and the walker faces north at the end of them. Only a pair
  // of readings one turn apart can say which way one step went: a wider pair
  // reads that net displacement as a step it never took.
  const before = { turn: 8, agents: { "fox-2": { cell: "cell-5-5", yaw: NORTH_YAW } } };
  const after = { turn: 11, agents: { "fox-2": { cell: "cell-6-5", yaw: NORTH_YAW } } };
  assert.deepEqual(facingSamplesBetween(before, after), []);
});

test("a board reading pair one turn apart witnesses the step it saw taken", () => {
  const before = { turn: 8, agents: { "fox-2": { cell: "cell-5-5", yaw: 0 } } };
  const after = { turn: 9, agents: { "fox-2": { cell: "cell-6-5", yaw: Math.PI / 2 } } };
  assert.deepEqual(facingSamplesBetween(before, after), [{ id: "fox-2", direction: "east", yaw: Math.PI / 2 }]);
});

test("every agent that takes a one-cell step renders facing the way it actually travelled, when the model catalogue is present", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await page.waitForFunction(
      () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready(),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    await pauseBoard(page);
    // Slower than the deck's own default, so a read almost always lands on the
    // very next turn and counts. facingSamplesBetween drops a pair that
    // straddles more than one turn, and at the default 220ms a loaded runner
    // straddles often enough to leave this run with nothing to assert on.
    await page.locator("#delaySlider").fill("600");
    let reading = await boardReadingOf(page);
    const samples = [];
    await page.locator("#autoToggle").click();
    // A generous tick budget: the samples this test cares about are whatever
    // single-cell hops actually happen along the way, not a forced direction
    // (the engine's own movement choices are a sibling track's, not driven
    // here), so this runs long enough to almost certainly see every cardinal
    // at least once across the live roster.
    for (let tick = 1; tick <= 16; tick += 1) {
      await page.waitForFunction((n) => {
        const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
        return m && Number(m[0]) > n;
      }, reading.turn, { timeout: TICK_TIMEOUT_MS });
      const next = await boardReadingOf(page);
      samples.push(...facingSamplesBetween(reading, next));
      reading = next;
    }
    await pauseBoard(page);

    assert.ok(samples.length > 0, "at least one live agent took a one-cell step across the run");
    for (const sample of samples) {
      const modelForward = { x: Math.sin(sample.yaw), z: Math.cos(sample.yaw) };
      const wanted = FACING_VECTOR[sample.direction];
      const dot = modelForward.x * wanted.x + modelForward.z * wanted.z;
      assert.ok(
        dot > 0.9,
        `${sample.id} stepped ${sample.direction} but its applied yaw (${sample.yaw}) faces a different way (dot ${dot})`,
      );
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error stepping the cast around the square");
  } finally {
    await context.close();
  }
});

/** Every HUD-drawn agent id's own mesh reading, id -> { height, minY,
 *  targetHeight } | null, read through window.mudiiiScene.meshHeightOf —
 *  the live group's own measured world-space box, not a second, locally
 *  invented number. */
const meshHeightsOf = (page) => page.evaluate(() => {
  const out = {};
  for (const card of document.querySelectorAll("#hudRow .hud-card[data-agent]")) {
    const id = card.getAttribute("data-agent");
    if (!id) continue;
    out[id] = window.mudiiiScene && typeof window.mudiiiScene.meshHeightOf === "function"
      ? window.mudiiiScene.meshHeightOf(id)
      : null;
  }
  return out;
});

/** Waits until every HUD-drawn agent has a real, positive mesh height —
 *  each agent's own model load is asynchronous, so a bare read right after
 *  a slider reboot, a tick or a Reset can still catch one mid-load. */
async function waitForEveryMeshHeight(page, timeout) {
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll("#hudRow .hud-card[data-agent]");
    if (!cards.length) return false;
    for (const card of cards) {
      const id = card.getAttribute("data-agent");
      const reading = window.mudiiiScene && typeof window.mudiiiScene.meshHeightOf === "function"
        ? window.mudiiiScene.meshHeightOf(id)
        : null;
      if (!reading || !reading.height) return false;
    }
    return true;
  }, null, { timeout });
}

/** Every HUD-drawn agent's mesh sits within +-20% of its own manifest
 *  targetHeight and within 0.05 of the ground. Agents past the first of their
 *  kind once shared one parsed model, so each was measured through another
 *  agent's group mid-flourish and came out a different wrong size. */
function assertEveryMeshWithinTolerance(heights, label) {
  const ids = Object.keys(heights);
  assert.ok(ids.length > 0, `${label}: at least one HUD-drawn agent to check`);
  for (const id of ids) {
    const reading = heights[id];
    assert.ok(reading, `${label}: ${id} has a mesh height reading`);
    assert.ok(reading.targetHeight, `${label}: ${id} has a manifest targetHeight to compare against`);
    const ratio = reading.height / reading.targetHeight;
    assert.ok(
      ratio > 0.8 && ratio < 1.2,
      `${label}: ${id} mesh height ${reading.height} is within +-20% of target ${reading.targetHeight} (ratio ${ratio.toFixed(3)})`,
    );
    assert.ok(
      Math.abs(reading.minY) < 0.05,
      `${label}: ${id} mesh's lowest point sits within 0.05 of the ground (minY ${reading.minY})`,
    );
  }
}

test("every HUD agent's mesh is correctly sized and seated at the largest cast, on load, after ticks and after Reset", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    // Drive both sliders to their own max before rebooting — the largest
    // cast is where the shared-cache bug compounds the hardest, and it is
    // also where a slider that could not reach its own stated range showed
    // up, so the count asked for has to be the count actually cast. The page
    // updates aria-valuetext from `input` and reboots from `change` — a real
    // drag fires both, so this dispatches both on each slider rather than
    // only the one event that happens to trigger a reboot.
    await pauseBoard(page);
    await page.evaluate(() => {
      const fox = document.getElementById("playerCountSlider");
      const npc = document.getElementById("npcCountSlider");
      fox.value = fox.max;
      npc.value = npc.max;
      fox.dispatchEvent(new Event("input", { bubbles: true }));
      npc.dispatchEvent(new Event("input", { bubbles: true }));
      fox.dispatchEvent(new Event("change", { bubbles: true }));
      npc.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForReboot(page);
    await pauseBoard(page);
    // Every predator the slider asked for is on the board. Four foxes is the
    // proof the deck reaches its own stated range: this square's layout only
    // ever built one, so a cast sliced from the opening list could never get
    // here. The count is read as ids, not a total — four foxes eat goblins
    // within the first few turns and fresh prey wander in from the perimeter,
    // so the live cast is never 14 by the time anything can read it.
    await page.waitForFunction(() => {
      const fox = document.getElementById("playerCountSlider");
      const npc = document.getElementById("npcCountSlider");
      const foxCount = Number((fox.getAttribute("aria-valuetext") || "").match(/\d+/)?.[0] || 0);
      const npcCount = Number((npc.getAttribute("aria-valuetext") || "").match(/\d+/)?.[0] || 0);
      const ids = [...document.querySelectorAll("#hudRow .hud-card[data-agent]")]
        .map((card) => card.getAttribute("data-agent"));
      const everyFox = ["fox-1", "fox-2", "fox-3", "fox-4"].every((id) => ids.includes(id));
      return foxCount === 4 && npcCount === 10 && everyFox && ids.length >= 6;
    }, null, { timeout: READY_TIMEOUT_MS });
    await waitForEveryMeshHeight(page, READY_TIMEOUT_MS);
    assertEveryMeshWithinTolerance(await meshHeightsOf(page), "on load, largest cast");

    const startedAt = await turnCountOf(page);
    await page.locator("#autoToggle").click();
    await page.waitForFunction((n) => {
      const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return m && Number(m[0]) >= n;
    }, startedAt + 4, { timeout: TICK_TIMEOUT_MS });
    await pauseBoard(page);
    await waitForEveryMeshHeight(page, READY_TIMEOUT_MS);
    assertEveryMeshWithinTolerance(await meshHeightsOf(page), "after four ticks");

    // The Reset path is where the warm loader cache bites hardest: every
    // agent re-requests the very same URL a second time, this time into an
    // already-warm cache.
    await page.locator("#resetBtn").click();
    await waitForRecast(page);
    await page.waitForFunction(
      () => document.querySelectorAll("#hudRow .hud-card[data-agent]").length > 0,
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    await waitForEveryMeshHeight(page, READY_TIMEOUT_MS);
    assertEveryMeshWithinTolerance(await meshHeightsOf(page), "after Reset");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error sizing and seating the largest cast across load, ticks and Reset");
  } finally {
    await context.close();
  }
});

test("a click on a blocked cell writes nothing and leaves the food pill armed", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await pauseBoard(page);
    await page.locator("#foodPill").click();
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "true", "the pill reports itself armed");

    const chatLinesBefore = await page.locator("#chatLog > *").count();

    // A prop's own cell is always blocked (propPlacementsFrom/blockedCellReason,
    // mudiii-viz.mjs) — house-1 sits at cell-8-1 in every scenario's own
    // opening layout, per data/mudiii-assets.json's committed props table.
    await page.evaluate(() => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick("cell-8-1"));
    await page.waitForFunction(
      () => (document.getElementById("sceneStatus")?.textContent ?? "").length > 0,
      null,
      { timeout: TICK_TIMEOUT_MS },
    );
    assert.match(await page.locator("#sceneStatus").textContent(), /blocked/, "the refusal names the cell as blocked");
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "true", "a refused click never disarms the pill");
    assert.equal(await page.locator("#chatLog > *").count(), chatLinesBefore, "a refused click writes no chat line and no fact");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error refusing a click on a blocked cell");
  } finally {
    await context.close();
  }
});

/** The world's own facts as plain sentences, via edit mode's textarea — the
 *  same round-trip mud.html's own editor exposes, used here purely as a
 *  read: opening it, reading the buffer, then leaving without changing
 *  anything. */
async function readWorldSentences(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(
    () => document.body.classList.contains("editing") && (document.getElementById("editorText")?.value ?? "").length > 0,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  const text = await page.locator("#editorText").inputValue();
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
  return text;
}

/** Run `act` and wait for the chat to carry the whole exchange it starts —
 *  the echoed command line and the answer under it, two entries. The baseline
 *  is counted BEFORE anything is sent, because the echo lands the instant the
 *  command is submitted: counted afterwards, it already includes the line it
 *  is supposed to be waiting for, and the wait can only ever time out.
 *  `prepare` runs first without being counted, for filling the input. */
async function sendAndSettle(page, act, { prepare = null } = {}) {
  if (prepare) await prepare();
  const before = await page.locator("#chatLog > *").count();
  await act();
  await page.waitForFunction(
    (n) => document.querySelectorAll("#chatLog > *").length >= n,
    before + 2,
    { timeout: TICK_TIMEOUT_MS },
  );
}

test("a typed 'put food at cell-3-4' and a click on the same cell both place a morsel there", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    // Paused first: this compares three reads of the world's own sentences, and
    // an agent stepping between two of them adds lines to the diff that have
    // nothing to do with the food being placed.
    await pauseBoard(page);
    const before = await readWorldSentences(page);
    await sendAndSettle(page, () => page.locator("#chatInput").press("Enter"), {
      prepare: () => page.locator("#chatInput").fill("put food at cell-3-4"),
    });
    const afterTyped = await readWorldSentences(page);
    const typedAdded = afterTyped.split("\n").filter((line) => !before.includes(line) && line.trim());
    // The subject id (morsel-N) is sequential and therefore never the same
    // between the two paths — every OTHER clause (type, class chain,
    // location, provenance) is compared with the id normalized away. The match
    // is case-insensitive because a sentence capitalizes its own subject
    // ("Morsel-1 stands in the cell-3-4."), and an id left un-normalized makes
    // the two sides differ for the one reason this comparison exists to ignore.
    const normalized = (lines) => lines.map((l) => l.replace(/\bmorsel-\d+\b/gi, "morsel-X")).sort();
    assert.ok(typedAdded.some((l) => /is a morsel/i.test(l)), "the typed verb places a morsel, not a bare food row");
    assert.ok(typedAdded.some((l) => /cell-3-4/.test(l)), "the typed verb's morsel lands on the named cell");

    await page.locator("#foodPill").click();
    await sendAndSettle(page, () =>
      page.evaluate(() => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick("cell-3-5")));
    const afterClicked = await readWorldSentences(page);
    const clickAdded = afterClicked.split("\n").filter((line) => !afterTyped.includes(line) && line.trim());
    assert.ok(clickAdded.some((l) => /is a morsel/i.test(l)), "the click places the same KIND of fact — a morsel — as the typed verb");
    assert.deepEqual(
      normalized(typedAdded.filter((l) => !/cell-3-4/.test(l))),
      normalized(clickAdded.filter((l) => !/cell-3-5/.test(l))),
      "with cell and subject id normalized away, the typed verb and the click add the same shape of fact set",
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error placing food by chat and by click");
  } finally {
    await context.close();
  }
});

/** Switch the deck's scenario dropdown to the square whose label matches
 *  `pattern`, wait for the new square to finish booting, and stop it there.
 *  Returns the picked scenario's embedded board size. The wait is on the play
 *  control turning itself back on, which boot() does as its very last act —
 *  every square now casts the same slider-driven ids, so no agent id tells the
 *  new square apart from the one being left behind. The board is left paused,
 *  because every caller then compares two reads of where things stand. */
async function switchScenario(page, pattern) {
  await pauseBoard(page);
  const gridSize = await page.evaluate((source) => {
    const index = MUDIII_PAGE_DATA.scenarios.findIndex((s) => new RegExp(source, "i").test(s.label || ""));
    if (index < 0) return null;
    const select = document.getElementById("scenarioSelect");
    select.value = String(index);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return MUDIII_PAGE_DATA.scenarios[index].gridSize;
  }, pattern.source);
  await waitForReboot(page);
  await pauseBoard(page);
  return gridSize;
}

/** Every map-panel dot's own left/top percentage, back-solved into the cell
 *  coordinate `size` would have produced. mapDotsFor draws a cell at
 *  `((n - 0.5) / size) * 100`%, so a board drawn at the wrong size back-solves
 *  to a fraction rather than a whole cell. */
const mapDotCellsUnder = (page, size) => page.evaluate((gridSize) => {
  const cellFrom = (pct) => Number(pct.replace("%", "")) * gridSize / 100 + 0.5;
  return [...document.querySelectorAll("#mapPanelBoard .map-dot")].map((dot) => ({
    id: dot.getAttribute("title"),
    x: cellFrom(dot.style.left),
    y: cellFrom(dot.style.top),
  }));
}, size);

/** A cell past column/row `edge` on a `size`-square board that nothing stands
 *  on, or null when the board leaves none. Read off the map panel, which draws
 *  a dot per agent and item (`(n - 0.5) / size`) and a block per prop
 *  (`(n - 1) / size`), so this needs neither the 3D scene nor the store. Items
 *  do not actually block a cell; counting them as taken only narrows the
 *  choice, which costs nothing on a board this size. */
const freeCellPast = (page, edge, size) => page.evaluate(([lastInnerColumn, gridSize]) => {
  const board = document.getElementById("mapPanelBoard");
  const percentOf = (value) => Number(String(value).replace("%", ""));
  const taken = new Set();
  for (const dot of board.querySelectorAll(".map-dot")) {
    taken.add(`cell-${Math.round(percentOf(dot.style.left) * gridSize / 100 + 0.5)}`
      + `-${Math.round(percentOf(dot.style.top) * gridSize / 100 + 0.5)}`);
  }
  for (const block of board.querySelectorAll(".map-block")) {
    taken.add(`cell-${Math.round(percentOf(block.style.left) * gridSize / 100 + 1)}`
      + `-${Math.round(percentOf(block.style.top) * gridSize / 100 + 1)}`);
  }
  for (let x = gridSize; x > lastInnerColumn; x -= 1) {
    for (let y = gridSize; y >= 1; y -= 1) {
      if (!taken.has(`cell-${x}-${y}`)) return `cell-${x}-${y}`;
    }
  }
  return null;
}, [edge, size]);

test("switching to the 14x14 chapel yard redraws the board at its own size and places food outside a 12-cell square", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    const gridSize = await switchScenario(page, /chapel/);
    assert.equal(gridSize, 14, "the chapel yard's own board size travels with its scenario");

    const dots = await mapDotCellsUnder(page, 14);
    assert.ok(dots.length > 0, "the map panel draws the chapel yard's opening cast");
    const onACell = (n) => Math.abs(n - Math.round(n)) < 0.001;
    for (const dot of dots) {
      assert.ok(
        onACell(dot.x) && onACell(dot.y),
        `${dot.id} sits on a whole cell of the 14-square board, not a fraction of a 12-square one (${dot.x}, ${dot.y})`,
      );
      // Round before bounding: the browser serializes the inline percentage
      // with fewer digits than it was written with, so a dot on the last cell
      // back-solves to 14.000004 and fails a bare <= 14.
      const cell = { x: Math.round(dot.x), y: Math.round(dot.y) };
      assert.ok(
        cell.x >= 1 && cell.x <= 14 && cell.y >= 1 && cell.y <= 14,
        `${dot.id} is on the board (cell-${cell.x}-${cell.y})`,
      );
    }
    assert.ok(
      dots.some((d) => Math.round(d.x) > 12 || Math.round(d.y) > 12),
      "at least one of the chapel yard's own opening cast stands past the 12-square board's edge",
    );

    // A column past 12 exists on the chapel yard alone, and the cell has to be
    // EMPTY as well as far out: a click on an occupied cell is refused, and a
    // refusal writes no chat line at all, so sendAndSettle would sit out its
    // whole timeout waiting for an exchange that is never coming. The chapel's
    // own goblins open on cell-14-14 and cross the far corner within the first
    // few turns, so which cells are taken depends on how many turns ran before
    // the board stopped — the target is read off the stopped board rather than
    // named in advance.
    const target = await freeCellPast(page, 12, gridSize);
    assert.ok(target, "the stopped chapel board leaves a free cell past the 12-square edge to drop food on");
    const before = await readWorldSentences(page);
    await page.locator("#foodPill").click();
    await sendAndSettle(page, () =>
      page.evaluate((cell) => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick(cell), target));
    const added = (await readWorldSentences(page)).split("\n").filter((line) => !before.includes(line) && line.trim());
    assert.ok(added.some((l) => /is a morsel/i.test(l)), "the click places a morsel");
    assert.ok(added.some((l) => l.includes(target)), `the morsel lands on ${target}, the cell clicked, never clamped back onto a 12-square board`);

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error switching squares and placing food on the far corner");
  } finally {
    await context.close();
  }
});

test("an addressed teach-frame moves the board and the page redraws it, on a paused board", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    // Paused first, so the one turn this frame spends is the only turn between
    // the two reads below — the whole assertion is that a chat turn reaches the
    // renderer, and a board still ticking underneath it proves nothing.
    await pauseBoard(page);
    const turnsBefore = await turnCountOf(page);
    const ids = await page.$$eval(
      "#hudRow .hud-card[data-agent]",
      (cards) => cards.map((card) => card.getAttribute("data-agent")),
    );
    const fox = ids.find((id) => id.startsWith("fox-"));
    const goblin = ids.find((id) => id.startsWith("goblin-"));
    assert.ok(fox && goblin, "the opening cast has both a fox and a goblin to address");

    // A teach-frame is the frame where watching a lie land is the point, and
    // it runs a real turn. cell-5-5 is on every square this page casts, so the
    // line is never declined for falling off the board.
    await sendAndSettle(page, () => page.locator("#chatInput").press("Enter"), {
      prepare: () => page.locator("#chatInput").fill(`@${fox} the ${goblin} is at cell-5-5`),
    });

    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "the deck stayed paused throughout");
    const turnsAfter = await turnCountOf(page);
    assert.equal(turnsAfter, turnsBefore + 1, "the teach-frame's own turn is counted like a deck-driven one");
    assert.match(await page.locator("#mapPanelTurn").textContent(), new RegExp(`turn ${turnsAfter}\\b`), "the map panel agrees with the deck's counter");

    // The page's own dots against the store's own sentences. This is the read
    // that catches a chat turn whose result never reached the renderer.
    const stored = {};
    for (const line of (await readWorldSentences(page)).split("\n")) {
      const match = /^(\S+) stands in the (cell-\d+-\d+)/i.exec(line.trim());
      if (match) stored[match[1].toLowerCase()] = match[2];
    }
    const gridSize = await page.evaluate(
      () => MUDIII_PAGE_DATA.scenarios[Number(document.getElementById("scenarioSelect").value) || 0].gridSize,
    );
    const dots = await mapDotCellsUnder(page, gridSize);
    assert.ok(dots.length > 0, "the map panel draws the live cast");
    let checked = 0;
    for (const dot of dots) {
      const cell = stored[(dot.id || "").toLowerCase()];
      if (!cell) continue;
      checked += 1;
      assert.equal(
        `cell-${Math.round(dot.x)}-${Math.round(dot.y)}`,
        cell,
        `${dot.id} is drawn where the store says it now stands, not where it stood before the chat turn`,
      );
    }
    assert.ok(checked > 0, "at least one drawn dot was matched against its stored cell");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error running a teach-frame turn from the chat dock");
  } finally {
    await context.close();
  }
});
