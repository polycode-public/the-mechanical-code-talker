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

// One spec per page: how to reach "ready", and a chain of named states, each
// building on the page left by the one before it (idle -> interact -> ...),
// so a single page load covers every state instead of re-booting per shot.
const PAGES = [
  {
    page: "home",
    path: "index.html",
    ready: async () => {},
    states: [{ label: "idle", act: async () => {} }],
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
      {
        label: "conversation",
        act: async (page) => {
          const before = await page.locator("#messages .msg-row.assistant").count();
          await page.fill("#composerInput", "what is a dog");
          await page.press("#composerInput", "Enter");
          await page.waitForFunction(
            (n) => document.querySelectorAll("#messages .msg-row.assistant").length > n,
            before,
            { timeout: READY_TIMEOUT_MS },
          );
          await page.locator("#messages .msg-row.assistant").last().locator(".bubble:not(.pending)").waitFor({ timeout: READY_TIMEOUT_MS });
        },
      },
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
        label: "mid-play",
        act: async (page) => {
          await page.locator("#playBtn").click();
          await page.waitForFunction(() => {
            const m = (document.querySelector("#turnLabel")?.textContent ?? "").match(/turn:\s*(\d+)/);
            return m && Number(m[1]) >= 6;
          }, null, { timeout: READY_TIMEOUT_MS }).catch(() => {});
        },
      },
    ],
  },
  {
    page: "plan",
    path: "plan.html",
    ready: async (page) => {
      await page.locator("#board").waitFor({ state: "visible" });
    },
    states: [
      { label: "idle", act: async () => {} },
      {
        label: "live-resolved",
        act: async (page) => {
          if (await page.locator("#resolveBtn").isDisabled()) return;
          await page.fill("#diskCount", "5");
          await page.locator("#resolveBtn").click();
          // The wink tier loads from the site's own ./vendor/wink.js, so
          // it succeeds even with third-party hosts blocked (see
          // openPage) — this still waits only long enough to capture
          // whichever honest state the live solve settles into, not for a
          // guaranteed one.
          await page.waitForFunction(() => /^live —/.test(document.getElementById("liveStatus")?.textContent ?? ""), null, { timeout: 6000 }).catch(() => {});
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
        label: "edit-mode",
        act: async (page) => {
          await page.locator("#editModeBtn").click();
          await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS }).catch(() => {});
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
    states: [{ label: "idle", act: async () => {} }],
  },
  {
    page: "sprites",
    path: "sprites.html",
    ready: async (page) => {
      await page.locator(".card").first().waitFor({ state: "visible" });
    },
    states: [{ label: "idle", act: async () => {} }],
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
