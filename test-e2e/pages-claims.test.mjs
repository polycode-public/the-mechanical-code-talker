// The claims page (public/claims.html), driven in a real browser: the "run
// it on this device" button re-solves the same taught Hanoi instance C7's
// own committed figure came from, through the identical browser bundle the
// button ships. pages-home.test.mjs only checks the teaser card that links
// here; this file drives the button itself.
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
// A run loads the wink vendor asset (bounded at 8s) before it ever starts
// solving, so its wait gets the same slack the plan page's live re-solve gets.
const RUN_TIMEOUT_MS = 30_000;

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

async function openClaimsPage() {
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
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/claims.html`, { waitUntil: "networkidle" });
  await page.locator("#claims-bench-run").waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
  return { context, page, consoleErrors, failedRequests };
}

test("the benchmark button opens showing the committed figure, before any click", async () => {
  const { context, page, consoleErrors, failedRequests } = await openClaimsPage();
  try {
    const resultText = await page.locator("#claims-bench-result").innerText();
    assert.match(resultText, /^Committed: [\d.]+ ms on /, "the committed line names a measured time and the hardware it ran on");
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
  } finally {
    await context.close();
  }
});

test("clicking run it on this device replaces the result with a measured time from the real solve", async () => {
  const { context, page, consoleErrors } = await openClaimsPage();
  try {
    await page.locator("#claims-bench-run").click();
    assert.equal(await page.locator("#claims-bench-run").isDisabled(), true, "the button disables itself while solving");

    await page.waitForFunction(
      () => (document.getElementById("claims-bench-result")?.textContent ?? "") !== "solving...",
      null,
      { timeout: RUN_TIMEOUT_MS },
    );

    const resultText = await page.locator("#claims-bench-result").innerText();
    assert.match(
      resultText, /^Your device: [\d.]+ ms\. Committed: [\d.]+ ms on /,
      `the run produced a measured time rather than a failure line — got "${resultText}"`,
    );
    assert.equal(await page.locator("#claims-bench-run").isDisabled(), false, "the button re-enables once the run settles");
    assert.deepEqual(consoleErrors, [], "the run logs no console error");
  } finally {
    await context.close();
  }
});
