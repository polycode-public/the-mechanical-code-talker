// scripts/claims/claim-offline.mjs — measures that chat.html answers
// entirely offline. The engine boots once from its own bundle and seed
// (same-origin asset loads, allowed), then a scripted run of ten questions
// mixing grounded lookups, teach/recall pairs, and honest misses drives the
// composer while a request recorder watches for any network attempt at all,
// same-origin or third-party. The live-Wikipedia supplement ships off by
// default and this rig never touches its toggle.
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "../../test-e2e/helpers/demo-site.mjs";
import { serveDirectory } from "../../test-e2e/helpers/static-server.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;

const QUESTIONS = [
  "what is a dog",
  "what is a zorblatt",
  "every zorbnug is a dog",
  "what is a zorbnug",
  "what is a zorblax",
  "zorbles are a kind of animal",
  "what is a zorble",
  "what is a quasar",
  "every flumph is a dog",
  "what is a flumph",
];

async function ask(page, question) {
  const rows = page.locator("#messages .msg-row.assistant");
  const seen = await rows.count();
  await page.fill("#composerInput", question);
  await page.press("#composerInput", "Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#messages .msg-row.assistant").length > n,
    seen,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const row = rows.last();
  await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
  return row;
}

async function measure() {
  const siteDir = buildDemoSiteSnapshot();
  const server = await serveDirectory(siteDir);
  const browser = await chromium.launch();
  const requestsWhileAnswering = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(server.origin)) return route.continue();
      return route.abort();
    });

    await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    // boot() fires one same-origin fetch off its own tail without awaiting
    // it (the P2P share-rail asset, "off the boot path on purpose" per its
    // own comment in chat-page-viz.mjs), so it can still be in flight the
    // instant tmctChatReady settles. The waiter is armed before that await
    // so it cannot miss a request that starts around the same moment; a
    // page that never needs the asset just times out here harmlessly.
    const p2pAssetSettled = page
      .waitForResponse((res) => res.url().endsWith("/vendor/p2p.js"), { timeout: 5_000 })
      .catch(() => {});
    await page.evaluate(() => window.tmctChatReady);
    await p2pAssetSettled;

    // Everything above is the allowed initial load; the recorder attaches
    // only once the composer is live, so it sees just the answering turns.
    page.on("request", (req) => requestsWhileAnswering.push(req.url()));

    for (const question of QUESTIONS) {
      await ask(page, question);
    }

    await context.close();
  } finally {
    await browser.close();
    await server.close();
    if (siteDir) rmSync(siteDir, { recursive: true, force: true });
  }
  return requestsWhileAnswering;
}

async function main() {
  const requestsWhileAnswering = await measure();

  try {
    const record = writeClaim("offline", {
      hardware: defaultHardware(),
      pack: "shipped",
      unit: "requests",
      threshold: { direction: "max", value: 0 },
      value: requestsWhileAnswering.length,
      sources: [
        "scripts/claims/claim-offline.mjs",
        "test-e2e/helpers/demo-site.mjs",
        "test-e2e/helpers/static-server.mjs",
      ],
      detail: { cases: QUESTIONS, requests: requestsWhileAnswering },
    });
    console.log(`claim:offline: ${record.value} request(s) observed answering ${QUESTIONS.length} questions (threshold ${record.threshold.direction} ${record.threshold.value})`);
  } finally {
    if (requestsWhileAnswering.length > 0) {
      console.error("claim:offline: network requests fired while answering:");
      for (const url of requestsWhileAnswering) console.error(`  - ${url}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
