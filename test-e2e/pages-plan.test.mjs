// The standalone plan page (public/plan.html), driven in a real browser: the
// baked-in 3-disk replay steps forward/back/reset through its own movelist,
// the live re-solve controls genuinely re-plan (4 disks means 15 moves, a
// fourth board piece, and a re-derived PDDL artifact — never the baked
// 3-disk text relabeled), and the chat-assert dock answers a legal-moves
// question through the real engine. pages-home.test.mjs only checks the page
// loads and names its pieces; this file drives the controls.
//
// Third-party hosts are blocked for every run, exactly as in the sibling
// page files: the engine, its bundle, and the wink vendor asset all ship
// with the site.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
// A live 4-disk re-solve loads the wink vendor asset (bounded at 8s) before
// it ever starts searching, so its wait gets the same slack chat boots get.
const SOLVE_TIMEOUT_MS = 30_000;

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

async function openPlanPage({ viewport } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
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
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/plan.html`, { waitUntil: "networkidle" });
  await page.locator("#board .block").first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
  return { context, page, consoleErrors, failedRequests };
}

const moveItems = (page) => page.locator("#movelist li:not(.phasehead)");

// A forward step animates the moving piece before it settles; the label only
// reads the new step number once the animation lands, so it is the settled
// signal on its own.
async function waitForStep(page, step) {
  await page.waitForFunction(
    (want) => (document.querySelector("#stepLabel")?.textContent ?? "").startsWith("step " + want + " /"),
    step,
    { timeout: READY_TIMEOUT_MS },
  );
}

test("the baked-in replay opens at step 0 of its 7 moves, with exactly the 3-disk pieces on the board", async () => {
  const { context, page, consoleErrors, failedRequests } = await openPlanPage();
  try {
    assert.match(await page.locator("#stepLabel").innerText(), /^step 0 \/ 7/, "a 3-disk tower solves in 2^3-1 moves");
    assert.equal(await moveItems(page).count(), 7, "the movelist carries one entry per move");
    const pieces = await page.locator("#board .block").allInnerTexts();
    assert.deepEqual(new Set(pieces), new Set(["disk-1", "disk-2", "disk-3"]), "the board draws the three disks and nothing else");
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
  } finally {
    await context.close();
  }
});

test("step forward marks the movelist, step back unmarks it, and reset returns to the opening board", async () => {
  const { context, page, consoleErrors } = await openPlanPage();
  try {
    await page.locator("#next").click();
    await waitForStep(page, 1);
    assert.equal(await moveItems(page).nth(0).getAttribute("class"), "done", "the played move reads as done");
    assert.match((await moveItems(page).nth(1).getAttribute("class")) ?? "", /current/, "the next move is the current one");

    await page.locator("#next").click();
    await waitForStep(page, 2);
    assert.equal(await page.locator("#movelist li.done").count(), 2);

    await page.locator("#back").click();
    await waitForStep(page, 1);
    assert.equal(await page.locator("#movelist li.done").count(), 1, "stepping back returns the later move to not-done");

    await page.locator("#reset").click();
    await waitForStep(page, 0);
    assert.equal(await page.locator("#movelist li.done").count(), 0, "reset clears every done mark");
    assert.match(await page.locator("#stepLabel").innerText(), /^step 0 \/ 7/);
    assert.deepEqual(consoleErrors, [], "replay controls log no console error");
  } finally {
    await context.close();
  }
});

test("reset clicked mid-move while playing still lands paused at step 0, not mid-animation", async () => {
  const { context, page } = await openPlanPage();
  try {
    // Click play, then reset again and again in quick succession — some of
    // these clicks are certain to land while a move is still animating
    // (each move's own CSS transitions run for several hundred ms). Reset
    // used to decline outright while animating, which left play()'s own
    // loop free to keep running past it.
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.locator("#play").click();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(20 + i * 15);
      // eslint-disable-next-line no-await-in-loop
      await page.locator("#reset").click();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(30);
    }
    // Give any move genuinely still in flight time to settle, then confirm
    // the board is paused at the seeded step and stays there.
    await page.waitForTimeout(1500);
    assert.match(await page.locator("#stepLabel").innerText(), /^step 0 \/ 7/, "reset actually rewound the board");
    assert.match(await page.locator("#play").innerText(), /play/, "the play button reads play, not pause — the board is not still running");
    await page.waitForTimeout(1500);
    assert.match(
      await page.locator("#stepLabel").innerText(), /^step 0 \/ 7/,
      "the board stayed at step 0 rather than resuming on its own after the reset",
    );
  } finally {
    await context.close();
  }
});

test("a live re-solve at 4 disks grows the plan to 15 moves, adds the fourth piece, and re-derives the PDDL panel", async () => {
  const { context, page, consoleErrors } = await openPlanPage();
  try {
    assert.equal(await page.locator("#resolveBtn").isDisabled(), false, "the demo site ships the live plan bundle");
    const pddlBefore = await page.locator("#pddlOut").innerText();
    assert.doesNotMatch(pddlBefore, /disk-4/, "the baked 3-disk artifact never names a fourth disk");

    await page.fill("#diskCount", "4");
    await page.locator("#resolveBtn").click();
    await page.waitForFunction(
      () => /^live — 4 disks/.test(document.getElementById("liveStatus")?.textContent ?? ""),
      null,
      { timeout: SOLVE_TIMEOUT_MS },
    );

    assert.match(await page.locator("#stepLabel").innerText(), /^step 0 \/ 15/, "a 4-disk tower solves in 2^4-1 moves");
    assert.equal(await moveItems(page).count(), 15, "the movelist re-mounts with the fresh plan's own moves");
    const pieces = await page.locator("#board .block").allInnerTexts();
    assert.deepEqual(new Set(pieces), new Set(["disk-1", "disk-2", "disk-3", "disk-4"]), "the board now draws all four disks");
    const pddlAfter = await page.locator("#pddlOut").innerText();
    assert.match(pddlAfter, /disk-4/, "the PDDL objects include the fresh puzzle's fourth disk");
    assert.match(pddlAfter, /\(:action /, "the re-derived artifact is still a full domain, actions included");
    assert.deepEqual(consoleErrors, [], "the live re-solve logs no console error");
  } finally {
    await context.close();
  }
});

test("the dock's pill fills the input without submitting, and the submitted question gets a real answer about legal moves", async () => {
  const { context, page, consoleErrors } = await openPlanPage();
  try {
    const pill = page.locator('#chatpills .pill[data-fill="what moves are legal now?"]');
    await pill.click();
    assert.equal(await page.locator("#chatq").inputValue(), "what moves are legal now?", "the pill's exact phrase lands in the input");
    assert.equal(await page.locator("#chatlog > div").count(), 0, "clicking a pill never submits on its own");

    await page.locator("#chatq").press("Enter");
    await page.waitForFunction(
      () => document.querySelectorAll("#chatlog > div.a").length >= 1,
      null,
      { timeout: SOLVE_TIMEOUT_MS },
    );
    const answer = await page.locator("#chatlog > div.a").last().innerText();
    assert.match(answer, /disk-1/, "the answer names a real piece — the smallest disk is always movable");
    assert.deepEqual(consoleErrors, [], "a dock turn logs no console error");
  } finally {
    await context.close();
  }
});

test("the plan page fits a phone viewport without sideways scrolling — the board scrolls inside its own frame", async () => {
  const { context, page } = await openPlanPage({ viewport: { width: 375, height: 812 } });
  try {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
    );
  } finally {
    await context.close();
  }
});
