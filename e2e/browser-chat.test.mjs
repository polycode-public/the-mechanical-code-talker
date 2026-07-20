// The in-page chat dock, driven in a real browser. The ledger page always
// embeds the committed ask bundle (tmctMemoryAsk, the same query engine the
// CLI runs), but on the Pages DEMO SITE this file builds and serves, the
// live teach-and-ask bundle (tmctLedger) also loads and takes over the
// dock's submit handler — the live-teach round trip itself is
// e2e/pages-ledger-teach.test.mjs's job; this file's grounded-answer
// assertions still hold either way (factAnswer/factReadBack's own phrasing
// is shared code, not duplicated per engine), but an honest MISS routes
// through runTurn's own richer cascade here, not tmctMemoryAsk's narrower
// canned miss text.
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

test("a term the graph has never seen is a miss, never a fabricated definition", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const reply = await ask(page, "what is a quokka");
    assert.equal(reply.isMiss, true, "an unknown term is reported as a miss");
    // runTurn's own honest-miss cascade, not tmctMemoryAsk's canned text —
    // see this file's own header for why the live dock answers here.
    assert.match(reply.text, /don't know "quokka" yet/, "the dock says it cannot answer");
    // The miss's own teach hint literally contains "quokka is a <thing>" as a
    // fill-in-the-blank template — a real word after "is a" would be an
    // actual fabricated claim; the placeholder is not one.
    assert.doesNotMatch(reply.text, /quokka is a [a-z]/i, "the miss invents no definition");
    assert.match(reply.text, /teach me directly/i, "the miss offers a way to teach it instead");
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
