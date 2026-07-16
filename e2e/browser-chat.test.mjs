// The in-page chat dock, driven in a real browser. The ledger page embeds the
// committed ask bundle, so a visitor's question runs the same query engine the
// CLI runs, against the same taught payload. This is the only test that proves
// the browser surface answers rather than merely loading.
//
// The page carries its own engine and payload, so third-party hosts are blocked:
// the run is the same offline, and nothing here waits on a CDN.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const ANSWER_TIMEOUT_MS = 15_000;

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

async function openLedgerPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  await page.goto(`${server.origin}/ledger.html`, { waitUntil: "networkidle" });
  await page.locator("#chatform").waitFor({ state: "visible" });
  return { context, page };
}

/**
 * Type a question into the dock and wait for the reply it prints.
 * The goal line is a separate entry, so it is excluded here.
 */
async function ask(page, question) {
  const replies = page.locator("#chatlog > div.a:not(.goal)");
  const before = await replies.count();
  await page.fill("#chatq", question);
  await page.press("#chatq", "Enter");
  await page.waitForFunction(
    (seen) => document.querySelectorAll("#chatlog > div.a:not(.goal)").length > seen,
    before,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const reply = replies.last();
  const className = (await reply.getAttribute("class")) ?? "";
  return { text: (await reply.textContent()) ?? "", isMiss: className.split(/\s+/).includes("miss") };
}

test("a question about a term in the graph comes back grounded, with its source", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const reply = await ask(page, "what is a dog");
    assert.equal(reply.isMiss, false, "a term the graph holds is answered, not missed");
    assert.match(reply.text, /dog is a kind of animal/, "the answer reads back the taught fact");
    assert.match(reply.text, /source: corpus:human/, "the answer carries the provenance behind it");
  } finally {
    await context.close();
  }
});

test("a relation question chases the taught fact and names the subject", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const reply = await ask(page, "who is the father of ishmael");
    assert.equal(reply.isMiss, false, "a taught relation is answered, not missed");
    assert.match(reply.text, /john/i, "the chase reaches john");
    assert.match(reply.text, /you told me: john fathers ishmael/, "the answer reads back the fact it used");
  } finally {
    await context.close();
  }
});

test("a term the graph has never seen is a miss, and the miss suggests terms it does hold", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const reply = await ask(page, "what is a quokka");
    assert.equal(reply.isMiss, true, "an unknown term is reported as a miss");
    assert.match(reply.text, /can't ground that in this graph/, "the dock says it cannot answer");
    assert.doesNotMatch(reply.text, /quokka is/i, "the miss invents no definition");
    assert.match(reply.text, /try: "what is/, "the miss points at terms the graph holds");
  } finally {
    await context.close();
  }
});

test("the dock answers a second question in the same session", async () => {
  const { context, page } = await openLedgerPage();
  try {
    await ask(page, "what is a dog");
    const second = await ask(page, "what is disk-1");
    assert.equal(second.isMiss, false, "the dock keeps answering after its first reply");
    assert.match(second.text, /disk-1 is a kind of disk/, "the second answer reads back its own fact");
  } finally {
    await context.close();
  }
});
