// chat.html's boot budget, measured in a real browser: from navigation start
// to (a) the composer enabling — the engine finished booting from its seed —
// and (b) the first grounded answer settling with its corpus provenance chip.
// The seed is the page's biggest asset by far, so this is the test that stops
// a seed which buys knowledge from silently spending the page's
// responsiveness. The measured times always print; the budget comes from
// TMCT_BOOT_BUDGET_MS (default 20000).
//
// Third-party hosts are blocked, exactly as in pages-chat-fullscreen: the
// measurement covers what the page itself ships, not a CDN's day.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const BOOT_BUDGET_MS = Number(process.env.TMCT_BOOT_BUDGET_MS ?? 20_000);
// Waits get slack past the budget so a slow boot still gets MEASURED and
// printed before the assertion names the real number.
const WAIT_TIMEOUT_MS = BOOT_BUDGET_MS * 2;

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

test("chat.html boots and grounds its first answer inside the boot budget", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });

  let composerReadyMs = null;
  let groundedAnswerMs = null;
  const t0 = performance.now();
  try {
    await page.goto(`${server.origin}/chat.html`, { timeout: WAIT_TIMEOUT_MS });
    await page.waitForFunction(() => {
      const input = document.querySelector("#composerInput");
      return input && !input.disabled;
    }, null, { timeout: WAIT_TIMEOUT_MS });
    composerReadyMs = Math.round(performance.now() - t0);

    await page.fill("#composerInput", "what is a dog");
    await page.press("#composerInput", "Enter");
    const row = page.locator("#messages .msg-row.assistant").last();
    await row.locator(".bubble:not(.pending)").waitFor({ timeout: WAIT_TIMEOUT_MS });
    await row.locator(".provchip").waitFor({ timeout: WAIT_TIMEOUT_MS });
    groundedAnswerMs = Math.round(performance.now() - t0);

    assert.equal(await row.locator(".provchip").textContent(), "corpus", "the first answer grounds against the seed's corpus band");
  } finally {
    console.log(
      `chat.html boot: composer enabled at ${composerReadyMs ?? "TIMEOUT"} ms, `
      + `first grounded answer at ${groundedAnswerMs ?? "TIMEOUT"} ms (budget ${BOOT_BUDGET_MS} ms)`,
    );
    await context.close();
  }

  assert.ok(
    groundedAnswerMs !== null && groundedAnswerMs <= BOOT_BUDGET_MS,
    `boot-to-grounded-answer took ${groundedAnswerMs} ms against the ${BOOT_BUDGET_MS} ms budget`,
  );
});
