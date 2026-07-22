// A layout-review screenshot sweep: the home page and every full-screen page,
// at a handful of real interaction states, in both portrait and landscape
// viewports, in a real browser. This exists to feed a HUMAN/agent visual
// review for exactly the class of bug this project has already found and
// fixed by eye more than once (adventure's map container, spider-fly's HUD
// panel): a panel pinned to a div that grows/shrinks with its own content
// instead of staying fixed, large unused gaps between panels, and a column
// pushing its own content off the bottom of the viewport while leaving space
// unused elsewhere. The images are the deliverable; the assertions below
// only guard the sweep itself (no console error, no page-breaking overflow)
// so a broken page fails loudly instead of silently shipping a blank shot.
//
// Screenshots land in .screenshots/layout-sweep/ (gitignored, not a build
// artifact) as <page>-<state>-<orientation>.png, overwritten fresh on every
// run — nothing here is compared pixel-to-pixel, this is for a reviewer's
// own eyes, not a golden-image regression gate.
//
// Third-party hosts are blocked for every run, matching every other e2e
// file: the whole engine ships with each page, nothing here needs the
// network.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const OUT_DIR = join(repoRoot, ".screenshots", "layout-sweep");

// A tablet-scale pair, swapped: wide enough at 1024 to show the two-column
// layouts (chat+HUD side rails, board+movelist) these pages actually ship,
// narrow enough at 768 to cross every page's own `max-width: 780px` stacking
// breakpoint — so the sweep exercises both layout shapes, not just one.
const PORTRAIT = { width: 768, height: 1024 };
const LANDSCAPE = { width: 1024, height: 768 };

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

async function openPage(path, viewport) {
  const context = await browser.newContext({ viewport });
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

  await page.goto(`${server.origin}/${path}`, { waitUntil: "networkidle" });
  return { context, page, consoleErrors };
}

async function overflowsHorizontally(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

async function shoot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });
}

/** Submit one chat.html composer turn and wait for the answer to settle. */
async function chatTurn(page, question) {
  const before = await page.locator("#messages .msg-row.assistant").count();
  await page.fill("#composerInput", question);
  await page.press("#composerInput", "Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#messages .msg-row.assistant").length > n,
    before,
    { timeout: READY_TIMEOUT_MS },
  );
  await page.locator("#messages .msg-row.assistant").last().locator(".bubble:not(.pending)").waitFor({ timeout: READY_TIMEOUT_MS });
}

/** Submit one command through a #chatq/#chatlog dock (adventure, ledger)
 *  and wait for the visitor's echo plus the reply to land. */
async function dockTurn(page, text) {
  const before = await page.locator("#chatlog > div").count();
  await page.fill("#chatq", text);
  await page.press("#chatq", "Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#chatlog > div").length >= n,
    before + 2,
    { timeout: READY_TIMEOUT_MS },
  );
}

// One spec per page: how to reach "ready", and a chain of named states, each
// building on the page left by the one before it (idle -> interact -> ...),
// so a single page load covers every state instead of re-booting per shot.
const PAGES = [
  {
    page: "home",
    path: "index.html",
    ready: async () => {},
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "demo-answered",
        act: async (page) => {
          await page.waitForFunction(() => /lemma\/POS tier: loaded/.test(document.querySelector(".demo-status")?.textContent ?? ""), null, { timeout: READY_TIMEOUT_MS });
          await page.locator("#tmct-demo .term-answer").first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
        },
      },
    ],
  },
  {
    page: "chat",
    path: "chat.html",
    ready: async (page) => {
      await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
      await page.evaluate(() => window.tmctChatReady);
    },
    states: [
      { label: "idle", act: async () => {} },
      { label: "conversation", act: async (page) => chatTurn(page, "what is a dog") },
      {
        label: "wikipedia-on",
        act: async (page) => {
          await page.locator(".liveLabel").click();
          await page.waitForFunction(() => /live wikipedia: on/.test(document.querySelector("#status")?.textContent ?? ""), null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "taught-panel",
        act: async (page) => {
          await chatTurn(page, "every zorbnug is a dog");
          await page.waitForFunction(() => document.querySelectorAll("#statsPanel .taught-item").length > 0, null, { timeout: READY_TIMEOUT_MS });
        },
      },
      // With the toggle on and every third-party host blocked, the live
      // lookup fails and the dashed honest miss stands — the exact state a
      // visitor on a broken connection sees.
      { label: "live-miss", act: async (page) => chatTurn(page, "what is a quasar") },
    ],
  },
  {
    page: "spider-fly",
    path: "spider-fly.html",
    ready: async (page) => {
      await page.waitForFunction(() => document.querySelector("#chatq") && !document.querySelector("#chatq").disabled, null, { timeout: READY_TIMEOUT_MS });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "pill-addressed",
        act: async (page) => {
          await page.locator('#chatpills button[data-addressee="spider"]').click();
        },
      },
      {
        label: "stepped",
        act: async (page) => {
          await page.locator("#stepBtn").click();
          await page.waitForFunction(() => (document.querySelector("#turnLabel")?.textContent ?? "").trim() === "turn: 1", null, { timeout: READY_TIMEOUT_MS });
          await page.waitForFunction(() => !document.querySelector("#stepBtn")?.disabled, null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "mid-play",
        act: async (page) => {
          await page.locator("#playBtn").click();
          await page.waitForFunction(() => {
            const m = (document.querySelector("#turnLabel")?.textContent ?? "").match(/turn:\s*(\d+)/);
            return m && Number(m[1]) >= 6;
          }, null, { timeout: READY_TIMEOUT_MS }).catch(() => {});
        },
      },
      {
        label: "paused",
        act: async (page) => {
          if (/pause/.test((await page.locator("#playBtn").textContent()) ?? "")) await page.locator("#playBtn").click();
          await page.waitForFunction(() => /play/.test(document.querySelector("#playBtn")?.textContent ?? ""), null, { timeout: READY_TIMEOUT_MS });
          await page.waitForFunction(() => !document.querySelector("#stepBtn")?.disabled, null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "retuned",
        act: async (page) => {
          await page.locator("#ctlSpiderVision").evaluate((input) => {
            input.value = "8";
            input.dispatchEvent(new Event("input"));
          });
        },
      },
    ],
  },
  {
    page: "plan",
    path: "plan.html",
    ready: async (page) => {
      await page.locator("#board .block").first().waitFor({ state: "visible" });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "mid-replay",
        act: async (page) => {
          for (const step of [1, 2]) {
            await page.locator("#next").click();
            await page.waitForFunction(
              (want) => (document.querySelector("#stepLabel")?.textContent ?? "").startsWith("step " + want + " /"),
              step,
              { timeout: READY_TIMEOUT_MS },
            );
          }
        },
      },
      {
        label: "replayed-to-end",
        act: async (page) => {
          await page.locator("#movelist li:not(.phasehead)").last().click();
          await page.waitForFunction(() => /step 7 \/ 7/.test(document.querySelector("#stepLabel")?.textContent ?? ""), null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "dock-answered",
        act: async (page) => {
          await page.locator('#chatpills .pill[data-fill="what moves are legal now?"]').click();
          await page.locator("#chatq").press("Enter");
          await page.waitForFunction(() => document.querySelectorAll("#chatlog > div.a").length >= 1, null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "live-resolved-4-disks",
        act: async (page) => {
          await page.fill("#diskCount", "4");
          await page.locator("#resolveBtn").click();
          await page.waitForFunction(() => /^live — 4 disks/.test(document.getElementById("liveStatus")?.textContent ?? ""), null, { timeout: READY_TIMEOUT_MS });
        },
      },
    ],
  },
  {
    page: "adventure",
    path: "adventure.html",
    ready: async (page) => {
      await page.waitForFunction(() => document.querySelector("#chatq") && !document.querySelector("#chatq").disabled, null, { timeout: READY_TIMEOUT_MS });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "walked-two-rooms",
        act: async (page) => {
          await dockTurn(page, "go north");
          await dockTurn(page, "go north");
        },
      },
      {
        label: "satchel-carrying",
        act: async (page) => {
          await dockTurn(page, "open the portrait");
          await dockTurn(page, "take the key");
          await page.locator("#carryList .chip").first().waitFor({ timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "won",
        act: async (page) => {
          for (const cmd of ["go south", "go south", "unlock the cabinet with the key", "open the cabinet", "take the letter"]) {
            await dockTurn(page, cmd);
          }
          await page.waitForFunction(() => /adventure is won/.test(document.querySelector("#goalList")?.textContent ?? ""), null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "edit-mode",
        act: async (page) => {
          await page.locator("#editModeBtn").click();
          await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS }).catch(() => {});
        },
      },
      {
        label: "edit-room-selected",
        act: async (page) => {
          await page.locator('#editMapWrap .room-node[data-room="kitchen"]').click();
          await page.waitForFunction(() => document.getElementById("roomDetailTitle")?.textContent === "kitchen", null, { timeout: READY_TIMEOUT_MS });
        },
      },
    ],
  },
  {
    page: "ledger",
    path: "ledger.html",
    ready: async (page) => {
      await page.locator(".dash").waitFor({ state: "visible" });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "facet-filtered",
        act: async (page) => {
          await page.locator("#segProv .seg", { hasText: "corpus" }).click();
        },
      },
      {
        label: "searched",
        act: async (page) => {
          await page.locator("#segProv .seg", { hasText: "corpus" }).click();
          const target = await page.evaluate(() => {
            const current = document.querySelector(".focuscard .term")?.textContent;
            return LEDGER.terms.map((t) => t.term).find((t) => t !== current);
          });
          await page.fill("#q", target);
          await page.press("#q", "Enter");
        },
      },
      {
        label: "post-teach",
        act: async (page) => {
          await dockTurn(page, "blue is a peg");
          await page.waitForFunction(() => document.querySelector(".focuscard .term")?.textContent === "blue", null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "taught-facet",
        act: async (page) => {
          await page.locator("#segProv .seg", { hasText: "you taught" }).click();
        },
      },
    ],
  },
  {
    page: "sprites",
    path: "sprites.html",
    ready: async (page) => {
      await page.locator(".card").first().waitFor({ state: "visible" });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "composed-scene",
        act: async (page) => {
          await page.fill("#composeq", "a doctor with a hat, and a cabinet");
          await page.waitForFunction(() => document.querySelectorAll("#sceneRow .scene-card").length >= 3, null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "material-scene",
        act: async (page) => {
          await page.fill("#composeq", "a wood cabinet, and a glass lamp");
          await page.waitForFunction(
            () => [...document.querySelectorAll("#sceneRow .scene-label")].some((el) => el.textContent === "wood cabinet"),
            null,
            { timeout: READY_TIMEOUT_MS },
          );
        },
      },
      {
        label: "filtered",
        act: async (page) => {
          await page.fill("#q", "person");
          await page.waitForFunction(() => (document.querySelector("#qcount")?.textContent ?? "").includes("/"), null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "dock-answered",
        act: async (page) => {
          await page.waitForFunction(() => !document.getElementById("dockq")?.disabled, null, { timeout: READY_TIMEOUT_MS });
          await page.fill("#dockq", "what parameters does a person sprite take?");
          await page.press("#dockq", "Enter");
          await page.waitForFunction(() => document.querySelectorAll("#dockLog .a.grounded").length >= 1, null, { timeout: READY_TIMEOUT_MS });
        },
      },
      {
        label: "dock-miss",
        act: async (page) => {
          await page.fill("#dockq", "who painted the mona lisa?");
          await page.press("#dockq", "Enter");
          await page.waitForFunction(() => document.querySelectorAll("#dockLog .a.miss").length >= 1, null, { timeout: READY_TIMEOUT_MS });
        },
      },
    ],
  },
  {
    page: "code",
    path: "code.html",
    ready: async (page) => {
      await page.locator("#ledger .row").first().waitFor({ state: "visible" });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "focus-changed",
        act: async (page) => {
          await page.locator("#ledger .term").first().click();
        },
      },
      {
        label: "hint-answered",
        act: async (page) => {
          await page.locator(".hint").first().click();
          await page.waitForFunction(() => document.querySelectorAll("#chat-log .turn-tmct").length >= 1, null, { timeout: READY_TIMEOUT_MS });
        },
      },
    ],
  },
  {
    page: "ingest",
    path: "ingest.html",
    ready: async (page) => {
      await page.waitForFunction(() => window.tmctIngestReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
      await page.evaluate(() => window.tmctIngestReady);
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "ingested",
        act: async (page) => {
          await page.fill("#source", "A beagle is a kind of dog. A dog is a kind of animal.");
          await page.locator("#ingestBtn").click();
          await page.waitForFunction(() => document.querySelectorAll("#facts .fact").length >= 2, null, { timeout: READY_TIMEOUT_MS });
        },
      },
    ],
  },
];

for (const spec of PAGES) {
  for (const [orientation, viewport] of [["portrait", PORTRAIT], ["landscape", LANDSCAPE]]) {
    test(`${spec.page} (${orientation}): loads clean and stays within the viewport across its own states`, async () => {
      const { context, page, consoleErrors } = await openPage(spec.path, viewport);
      try {
        await spec.ready(page);
        for (const state of spec.states) {
          await state.act(page);
          assert.equal(await overflowsHorizontally(page), false, `${spec.page}/${state.label}/${orientation} overflows its own viewport width`);
          await shoot(page, `${spec.page}-${state.label}-${orientation}`);
        }
        assert.deepEqual(consoleErrors, [], `${spec.page} logs no console error across its states in ${orientation}`);
      } finally {
        await context.close();
      }
    });
  }
}
