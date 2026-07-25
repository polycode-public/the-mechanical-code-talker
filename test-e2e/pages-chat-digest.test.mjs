// public/chat.html's digest lead, driven in a real browser: proves the fix to
// the bundle's own optional-adapter stub (scripts/build-chat-bundle.mjs used
// to hard-stub corpus/digest-bank.mjs to return null unconditionally, so the
// in-page answer path could never take the digest branch chat.mjs's own
// termDigestReadBack/DIGEST_READBACK_THRESHOLD already gate) — and, unlike a
// seeded-store check, exercises the exact case that stub made unreachable: a
// term that only exists because a chat SESSION grew it past the threshold,
// not because it shipped in the build-time seed.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 20_000;

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

async function openChatPage() {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });

  await page.goto(`${server.origin}/chat.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return { context, page };
}

/** Type a turn into the composer and wait for its settled reply — the same
 *  wait-for-a-new-bubble idiom e2e/pages-chat-research.test.mjs's own ask()
 *  uses. */
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
  const row = rows.nth(seen);
  await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
  return row;
}

// Nine isa objects for one invented term, taught one at a time over the live
// chat session — never present in the build-time seed. "tool" leads the list
// because it's already grounded in the shipped corpus; the teach grammar
// refuses a fact whose SUBJECT and OBJECT are both brand-new terms at once
// ("flumwick" needs one already-known side to ground the first fact against),
// so an invented subject's very first teach must pair it with a word the
// corpus already knows. Every teach after the first succeeds regardless,
// once "flumwick" itself is grounded.
const DIGEST_TEACH_OBJECTS = ["tool", "gadget", "widget", "device", "machine", "contraption", "mechanism", "sensor", "module"];

test("a term built up entirely by in-session teaching, once past the digest threshold, leads its answer with a composed digest ahead of the flat fact list", async () => {
  const { context, page } = await openChatPage();
  try {
    for (const obj of DIGEST_TEACH_OBJECTS) {
      const reply = await ask(page, `every flumwick is a ${obj}`);
      const text = await reply.locator(".bubble").innerText();
      assert.match(text, /^noted — remembered: flumwick is a kind of /, `expected a teach confirmation for "${obj}", got: ${text}`);
    }

    const answer = await ask(page, "what is a flumwick");
    const text = await answer.locator(".bubble").innerText();
    // termDigestReadBack's own escape ("Say 'show the facts' for all N stored
    // facts.") only appears on the digest path; the flat/chained fallback
    // this bug used to force closes with "…and N more — say 'more' to see
    // them." instead (or, under the cap, no escape line at all) — so this
    // pair is a real structural check that the digest branch fired, not a
    // wording guess.
    assert.match(text, /Say 'show the facts' for all 9 stored facts\./, `expected a digest lead, got: ${text}`);
    assert.doesNotMatch(text, /…and \d+ more — say 'more' to see them\./);
    assert.match(text, /flumwicks are/i, "the isa 'several' template composes a sentence naming the term");
    assert.doesNotMatch(text, /^you told me: flumwick is a kind of tool →/, "the answer is not the flat chained fact-line list");
  } finally {
    await context.close();
  }
});
