// The ledger page's LIVE chat dock, driven in a real browser: unlike
// e2e/browser-chat.test.mjs (which drives the query-only tmctMemoryAsk
// engine every ledger.html carries, CLI output included), this file exists
// because the Pages demo site's own ledger.html links a SECOND, sibling
// bundle (public/ledger-browser.bundle.js, built by
// scripts/build-ledger-bundle.mjs) that runs the FULL runTurn engine — teach
// AND ask, over the exact same PAYLOAD the page already renders. A teach
// turn has to do two things at once: answer in the chat log, AND re-render
// the page's own fact table/stat tiles/term-index minigraph to include what
// it just learned. This file is the only place either half is exercised in
// a real browser.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const TURN_TIMEOUT_MS = 20_000;

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

/** Open ledger.html with every third-party host blocked — the live dock's
 *  own tryLoadWink() loads the wink tier from the site's first-party
 *  ./vendor/wink.js, so a real load attempt genuinely succeeds same-origin,
 *  exactly as for a real visitor. Returns the page plus what it logged and
 *  what it failed to fetch. */
async function openLedgerPage({ viewport, colorScheme } = {}) {
  const context = await browser.newContext({ ...(viewport ? { viewport } : {}), ...(colorScheme ? { colorScheme } : {}) });
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
    // A fetch the service worker answers from cache is cancelled at the
    // network layer and reports net::ERR_ABORTED here even though the page
    // received every byte; a genuinely failing asset reports a different
    // error (and a plain 404 never fires requestfailed at all).
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/ledger.html`, { waitUntil: "networkidle" });
  await page.locator("#chatform").waitFor({ state: "visible" });
  return { context, page, consoleErrors, failedRequests };
}

/** Type a turn into the dock and wait for its reply — the SAME wait-for-a-
 *  new-answer-line idiom e2e/browser-chat.test.mjs's own ask() uses. */
async function turn(page, text) {
  const replies = page.locator("#chatlog > div.a");
  const before = await replies.count();
  await page.fill("#chatq", text);
  await page.press("#chatq", "Enter");
  await page.waitForFunction(
    (seen) => document.querySelectorAll("#chatlog > div.a").length > seen,
    before,
    { timeout: TURN_TIMEOUT_MS },
  );
  const reply = replies.last();
  const className = (await reply.getAttribute("class")) ?? "";
  return {
    text: (await reply.textContent()) ?? "",
    taught: className.split(/\s+/).includes("taught"),
    miss: className.split(/\s+/).includes("miss"),
  };
}

test("the live dock is offered on the demo site: window.tmctLedger loaded and the placeholder announces teaching", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const hasLedgerSession = await page.evaluate(() => typeof window.tmctLedger?.createLedgerSession === "function");
    assert.equal(hasLedgerSession, true, "the sibling ledger-browser.bundle.js loaded and exposed createLedgerSession");
    const placeholder = await page.locator("#chatq").getAttribute("placeholder");
    assert.match(placeholder, /teach/i, "the placeholder acknowledges the dock can teach, not just answer");
  } finally {
    await context.close();
  }
});

test("teaching a genuinely new fact updates the chat log AND the fact table/stat tiles/term list live, with no reload", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const totalBefore = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    const hadBlueBefore = await page.evaluate(() => LEDGER.terms.some((t) => t.term === "blue"));
    assert.equal(hadBlueBefore, false, "the demo graph never taught \"blue\" before this test");

    const reply = await turn(page, "blue is a peg");
    assert.equal(reply.taught, true, `expected a taught confirmation, got: ${reply.text}`);
    assert.match(reply.text, /remembered/i);

    // The dashboard's own facts.total tile is a real DOM re-render (dashboardHtml
    // called again over the fresh derivation), not the chat log alone.
    const totalAfter = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    assert.equal(totalAfter, totalBefore + 1, "the dashboard's own fact count grew by exactly the one new fact");

    // The ledger view itself refocused onto the newly taught term (the
    // default focus-resolution rule: no explicit term -> newest taught
    // subject) and its fact table/term list now carry it.
    assert.equal(await page.locator(".focuscard .term").innerText(), "blue");
    const rowsMentionBlue = await page.locator(".rows .row", { hasText: "blue" }).count();
    assert.ok(rowsMentionBlue > 0, "the fact table shows a row for the newly taught term");
    const hasBlueAfter = await page.evaluate(() => LEDGER.terms.some((t) => t.term === "blue"));
    assert.equal(hasBlueAfter, true, "the term index (the two-hop minigraph's own data) now carries the new term");

    // A follow-up query answers from the SAME session/graph the teach just
    // extended — the round trip is teach-then-ask, not two disconnected engines.
    const askReply = await turn(page, "what is a blue");
    assert.equal(askReply.miss, false);
    assert.match(askReply.text, /blue is a kind of peg/);
  } finally {
    await context.close();
  }
});

test("an honest miss still reads as a miss, never fabricated, and never refocuses the view", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const focusBefore = await page.locator(".focuscard .term").innerText();
    const reply = await turn(page, "what is a quokka");
    assert.equal(reply.miss, true);
    // The miss's own teach hint literally contains "quokka is a <thing>" as a
    // fill-in-the-blank template — a real word after "is a" would be an
    // actual fabricated claim; the placeholder is not one.
    assert.doesNotMatch(reply.text, /quokka is a [a-z]/i, "the miss invents no definition");
    // The miss cascade's own boilerplate ("Run `tmct init`…") can contain a
    // real term as an ordinary English word (this demo graph happens to
    // teach "run") — a miss must never let that fool the dock into
    // refocusing onto it.
    assert.equal(await page.locator(".focuscard .term").innerText(), focusBefore, "a miss leaves the ledger's own focus untouched");
    assert.equal(await page.locator(".crumbs .crumb").count(), 1, "a miss adds no breadcrumb");
  } finally {
    await context.close();
  }
});

test("after a live teach, the you-taught facet selects exactly the taught row, and the fresh term is searchable by name", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const reply = await turn(page, "blue is a peg");
    assert.equal(reply.taught, true, `expected a taught confirmation, got: ${reply.text}`);
    assert.equal(await page.locator(".focuscard .term").innerText(), "blue", "the teach refocused the view onto the new term");

    await page.locator("#segProv .seg", { hasText: "you taught" }).click();
    assert.equal(
      await page.locator("#segProv .seg", { hasText: "you taught" }).getAttribute("aria-pressed"),
      "true",
      "the facet reads as selected",
    );
    const rowClasses = await page.locator("#ledger .rows .row").evaluateAll((els) => els.map((el) => el.className));
    assert.ok(rowClasses.length >= 1, "the taught tier holds at least the fact just taught");
    for (const cls of rowClasses) assert.match(cls, /\bp-taught\b/, "every row on show is a taught-tier row");
    assert.ok(
      (await page.locator("#ledger .rows .row", { hasText: "blue" }).count()) >= 1,
      "the just-taught fact itself is among them",
    );
    await page.locator("#segProv .seg", { hasText: "you taught" }).click();

    // The search index was rebuilt from the fresh derivation, not the
    // page-load snapshot — the brand-new term resolves by name.
    const focusTarget = await page.evaluate(() => LEDGER.rows.find((r) => r.s === "blue")?.o);
    assert.ok(focusTarget, "the taught row's own object is on record");
    await page.fill("#q", "blue");
    await page.press("#q", "Enter");
    assert.equal(await page.locator("#qmiss").innerText(), "", "the fresh term is no search miss");
    assert.equal(await page.locator(".focuscard .term").innerText(), "blue");
  } finally {
    await context.close();
  }
});

test("reloading after a live teach shows the ORIGINAL static content again — no persistence, same posture as chat.html", async () => {
  const { context, page } = await openLedgerPage();
  try {
    const totalBefore = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    const reply = await turn(page, "purple is a peg");
    assert.equal(reply.taught, true, `expected a taught confirmation, got: ${reply.text}`);

    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#chatform").waitFor({ state: "visible" });
    const totalReloaded = Number(await page.locator(".dash .tile", { hasText: "facts.total" }).locator(".tile-value").innerText());
    assert.equal(totalReloaded, totalBefore, "the reloaded page is back to the build-time snapshot, not the in-memory teach");
    const hasPurpleAfterReload = await page.evaluate(() => LEDGER.terms.some((t) => t.term === "purple"));
    assert.equal(hasPurpleAfterReload, false, "the taught fact lived only in the tab's own in-memory session");
  } finally {
    await context.close();
  }
});

test("the live-taught state fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await openLedgerPage({ viewport: { width: 375, height: 812 }, colorScheme });
    try {
      await turn(page, "orange is a peg");
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${colorScheme}, post-teach: the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
      );
    } finally {
      await context.close();
    }
  }
});

test("a live teach turn logs no console error and fails no same-origin request", async () => {
  const { context, page, consoleErrors, failedRequests } = await openLedgerPage();
  try {
    await turn(page, "yellow is a peg");
    await turn(page, "what is a yellow");
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "teaching and asking through the live dock logs no error of its own");
  } finally {
    await context.close();
  }
});
