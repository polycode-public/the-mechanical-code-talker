// news.html's UX contract (PLAN_NEWS_FEED.md section 2), states S1 through
// S5, driven in a real browser against fixture-served api.wikimedia.org and
// simple.wikipedia.org endpoints — no test here touches a real third party.
// Every source but one contemporary and one knowledge-base source is
// unchecked before the start action, so the request surface this file
// fixture-routes stays small and every count in it is exact.
//
// The page starves requestAnimationFrame and Playwright's injected pollers
// while it streams and indexes the chat seed, so a locator wait or
// waitForFunction times out against provably rendered content — this file
// samples window.tmct.session/window.tmct.news on a sleep-then-evaluate
// loop throughout, the pattern scripts/gen-screenshots.mjs's own news ready
// check already proved out, and reads the session's own structured verbs
// (rank(), requestLog, health, metrics) rather than scraping rendered text.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 180_000;
// The bound a click's own effect must land inside once the page is past its
// one-time boot cost (seed fetch, parse and first render) — an order of
// magnitude under READY_TIMEOUT_MS, so a regression that makes a later
// interaction pay the boot cost again fails loudly rather than just fitting
// inside the same generous budget everything else uses.
const INTERACTION_TIMEOUT_MS = 45_000;
// The responsiveness contract: an in-page evaluate round trip must answer
// within this bound even while the seed streams and indexes.
const ROUND_TRIP_BUDGET_MS = 1500;

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  cpSync(join(repoRoot, "public", "chat-seed.json"), join(siteDir, "chat-seed.json"));
  server = await serveDirectory(siteDir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

async function openNewsPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.route((url) => !url.href.startsWith(server.origin), (route) => route.abort());
  await page.goto(`${server.origin}/news.html`, { waitUntil: "load" });
  return { context, page, pageErrors };
}

/** Poll a predicate on a timer rather than a locator/waitForFunction wait —
 *  see the file header. Resolves the predicate's own truthy return value,
 *  or throws once `timeoutMs` elapses with nothing but falsy reads. */
async function waitFor(page, predicate, { timeoutMs = READY_TIMEOUT_MS, pollMs = 2000, label = "condition", arg } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    const result = arg === undefined ? await page.evaluate(predicate) : await page.evaluate(predicate, arg);
    if (result) return result;
  }
  throw new Error(`${label} never became true within ${timeoutMs}ms`);
}

/** Serves one contemporary item from the wikimedia-featured mostread shape
 *  (section 4.1's real wire shape). Its title carries two halves on purpose:
 *  a copular sentence the ingest grammar reads (the poll's own fact, which
 *  fact-grounds quokka on arrival), and a verbless fragment whose two terms
 *  ("rottnest", "sightings") no triple can form from — those two are what
 *  the fact-ungrounded ledger admits, and what enrichment then works. */
async function routeWikimediaFeatured(page) {
  await page.route("https://api.wikimedia.org/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({
      mostread: {
        articles: [{
          normalizedtitle: "A quokka is a marsupial. Rottnest sightings, wetlands, dry-season counts.",
          extract: "",
          wikibase_item: "",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quokka" } },
        }],
      },
    }),
  }));
}

/** Serves Simple English Wikipedia's opensearch + REST summary round trip
 *  for exactly one term, "rottnest" — every other opensearch query gets a
 *  clean empty-suggestions reply, the honest "nothing found" shape a real
 *  miss reads as, so an enrichment attempt against any other pending term
 *  (here, "sightings") resolves to a miss rather than a network error. */
async function routeSimpleWikipediaOneHit(page) {
  let openSearchCalls = 0;
  await page.route("https://simple.wikipedia.org/**", (route) => {
    const url = route.request().url();
    let body;
    if (url.includes("action=opensearch")) {
      openSearchCalls += 1;
      const term = decodeURIComponent(new URL(url).searchParams.get("search") || "");
      body = term === "rottnest" ? JSON.stringify(["rottnest", ["Rottnest"], [""], [""]]) : JSON.stringify([term, [], [], []]);
    } else {
      body = JSON.stringify({
        title: "Rottnest",
        extract: "A rottnest is an island.",
        revision: "101",
        content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Rottnest" } },
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
  });
  return { openSearchCallCount: () => openSearchCalls };
}

/** Unchecks every default source but the one named, so the request surface
 *  a test fixture-routes stays exact — `kind` picks the contemporary or
 *  knowledge-base checkbox group. Toggles the on-page checkboxes, letting
 *  the page's own change handler commit config.sources/config.kbSources
 *  exactly the way a visitor's click would. */
async function keepOnlySource(page, kind, keepId) {
  const ids = kind === "kb" ? ["simple-wikipedia", "wikidata", "wiktionary"] : ["wikimedia-featured", "hacker-news", "usgs-quakes"];
  for (const id of ids) {
    const box = page.locator(`[data-source-toggle][value="${id}"]`);
    if (id === keepId) await box.check();
    else await box.uncheck();
  }
}

test("the start button click moves the page through S1-S5: seed items before any route releases, status chips and the request log update from a fixture-fulfilled poll, the ranked list matches fixture arithmetic, a KB hit grounds a term and reprocesses the item it came from, a KB miss enters the negative cache and is not retried, and the interval control re-arms nextPollAt", async () => {
  const { context, page, pageErrors } = await openNewsPage();
  try {
    await waitFor(page, () => window.tmct?.news?.phase && window.tmct.news.phase !== "seeding", { label: "S1 seeded phase" });

    // S1: at least one item exists before any route has been given a
    // chance to release, every one of them from the seed graph.
    const s1 = await page.evaluate(() => window.tmct.session.buildFeed());
    assert.ok(s1.items.length >= 1, "S1: the seed-only feed already has an item");
    assert.ok(s1.seedFallback, "S1: the seed-only feed is flagged as such");
    assert.equal((await page.evaluate(() => window.tmct.session.requestLog)).length, 0, "S1: nothing has been requested yet");
    const statusesBeforeStart = await page.locator("[data-source-status]").allInnerTexts();
    assert.ok(statusesBeforeStart.every((s) => s === "off" || s === "not yet polled"), `S1: no source status chip reads as polled yet: ${JSON.stringify(statusesBeforeStart)}`);

    await keepOnlySource(page, "contemporary", "wikimedia-featured");
    await keepOnlySource(page, "kb", "simple-wikipedia");
    await routeWikimediaFeatured(page);
    const kb = await routeSimpleWikipediaOneHit(page);

    // The button CLICK itself is what this turn asserts — its own effect,
    // not a call into the session bypassing the DOM.
    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { label: "start() (poll + enrich) settling" });
    assert.deepEqual(pageErrors, [], "a real poll+enrich cycle against fulfilled routes never throws");

    // S2: the wikimedia-featured status chip flipped off "not yet polled",
    // and the request log gained a row for the fulfilled route, with a
    // plausible byte count and an "ok" status.
    const wikimediaChip = await page.locator('[data-source-id="wikimedia-featured"] [data-source-status]').innerText();
    assert.equal(wikimediaChip, "ok", `the wikimedia-featured status chip flips to ok after the start click: ${wikimediaChip}`);
    const log = await page.evaluate(() => window.tmct.session.requestLog);
    const wikimediaRows = log.filter((r) => r.url.includes("api.wikimedia.org"));
    assert.equal(wikimediaRows.length, 1, `exactly one wikimedia-featured request logged: ${JSON.stringify(log)}`);
    assert.ok(wikimediaRows[0].bytes > 0, "the logged request carries a plausible byte count");
    assert.equal(wikimediaRows[0].status, "ok", "a fulfilled route reads as a healthy poll");
    assert.equal(await page.locator("#requestLogBody tr").count(), 1, "the request log table itself gained the same one row");

    // S3/S4: quokka fact-grounded on arrival (the poll's own copular fact),
    // so it never enters the ledger; the verbless fragment's two terms did.
    // rottnest (the KB hit) grounds through enrichment; sightings (the KB
    // miss) is missed rather than guessed.
    const ranked = await page.evaluate(() => window.tmct.session.rank({ limit: 20 }));
    const byTerm = new Map(ranked.map((r) => [r.term, r]));
    assert.equal(byTerm.get("quokka"), undefined, `a term the poll itself grounded never enters the ledger: ${JSON.stringify(ranked)}`);
    assert.equal(byTerm.get("rottnest")?.count, 1, `rottnest ranks with count 1: ${JSON.stringify(ranked)}`);
    // Two passes read the fragment: the poll's own ingest, then the
    // reprocess the rottnest grounding triggered — the ledger counts
    // occurrences per processed sentence, so the still-missed term shows 2.
    assert.equal(byTerm.get("sightings")?.count, 2, `sightings ranks with the two processed passes counted: ${JSON.stringify(ranked)}`);

    const health = await page.evaluate(() => window.tmct.session.health);
    assert.equal(health.find((h) => h.sourceId === "wikimedia-featured")?.lastStatus, "ok");

    // The feed now carries an item for each half of the fixture's own work:
    // the poll's copular fact hubs a quokka item, and the KB enrichment's
    // fact hubs a rottnest item of its own.
    const feedAfterEnrich = await page.evaluate(() => window.tmct.session.buildFeed());
    const hubs = feedAfterEnrich.items.map((i) => i.hub);
    // The quokka hub's presence is itself the poll fact's proof: only the
    // windowed news fact can score quokka as a hub, and its two-hop
    // subgraph then fills with the seed's own dense animal taxonomy, so no
    // single row is guaranteed a slot under the item's row cap.
    const quokkaItem = feedAfterEnrich.items.find((it) => it.hub === "quokka");
    assert.ok(quokkaItem, `a quokka item exists from the poll's own fact: ${JSON.stringify(hubs)}`);
    assert.equal(feedAfterEnrich.seedFallback, false, "the windowed news facts drive the feed, not the seed fallback");
    const rottnestItem = feedAfterEnrich.items.find((it) => it.hub === "rottnest");
    assert.ok(rottnestItem, `a rottnest item exists from the KB enrichment: ${JSON.stringify(hubs)}`);
    const rottnestFacts = await page.evaluate((ids) => window.tmct.session.factRows(ids), rottnestItem.factIds);
    assert.ok(rottnestFacts.map((f) => f.object).includes("island"), "the KB article's fact anchors its item");

    // Negative cache: a second enrich attempt does not re-query a term
    // already marked missed within its TTL.
    const callsBeforeSecondEnrich = kb.openSearchCallCount();
    await page.locator("#enrichNow").click();
    // enrichNow's own handler doesn't disable the button — it clears
    // #controlsStatus back to "" once window.tmct.session.enrich() settles,
    // the one DOM signal the click actually leaves behind.
    await waitFor(page, () => document.getElementById("controlsStatus").textContent === "", { timeoutMs: 15000, pollMs: 1000, label: "the second enrich settling" });
    assert.equal(kb.openSearchCallCount(), callsBeforeSecondEnrich, "sightings is not re-queried while its negative-cache TTL holds");

    // S5: the interval control re-arms nextPollAt and clamps below the floor.
    await page.selectOption("#pollInterval", "5");
    const nextPollAt = await page.evaluate(() => window.tmct.session.nextPollAt);
    assert.ok(nextPollAt, "changing the interval arms nextPollAt");
    await page.evaluate(() => window.tmct.session.setInterval(1));
    const clamped = await page.evaluate(() => window.tmct.session.config.pollMinutes);
    assert.equal(clamped, 5, "a sub-floor interval clamps up to the poll floor");
  } finally {
    await context.close();
  }
});

test("both fixture demo buttons replay their own recorded sample as corpus-tier items with the network fully blocked, each a real DOM click asserted by its own distinct effect", async () => {
  const { context, page, pageErrors } = await openNewsPage();
  try {
    await waitFor(page, () => window.tmct?.news?.phase && window.tmct.news.phase !== "seeding", { label: "S1 seeded phase" });

    const before = await page.evaluate(() => window.tmct.session.buildFeed());
    assert.ok(before.seedFallback, "before any replay, the feed is still the whole-graph seed fallback");
    assert.equal(await page.evaluate(() => window.tmct.session.requestLog.length), 0, "neither replay button has fired yet");

    // "replay recorded Wikipedia sample": a real click, asserted by the
    // page's own status text and by a grounded fact the fixture's own
    // "A tariff is a tax..." extract licenses (test/fixtures/news/
    // wikimedia-featured.json), landing under corpus-tier trust.
    await page.locator("#replayWikipedia").click();
    await waitFor(page, () => document.getElementById("controlsStatus").textContent === "replayed wikimedia-featured", { timeoutMs: INTERACTION_TIMEOUT_MS, pollMs: 500, label: "the Wikipedia replay button's own effect" });
    assert.deepEqual(pageErrors, [], "replaying the Wikipedia fixture never throws");

    const afterWikipedia = await page.evaluate(() => window.tmct.session.buildFeed());
    // A real news-fixture-tagged row now sits inside the window, so the feed
    // leaves the seed-only fallback for real windowed hub scoring — the
    // signal that actually distinguishes "the replay landed real facts"
    // from "nothing changed", where the item count would not.
    assert.equal(afterWikipedia.seedFallback, false, "a landed fixture-replay fact takes the feed out of the seed fallback");
    const tariffItem = afterWikipedia.items.find((it) => it.hub === "tariff");
    assert.ok(tariffItem, `the Wikipedia replay grounds a tariff item: ${JSON.stringify(afterWikipedia.items.map((i) => i.hub))}`);
    assert.equal(tariffItem.tier, "corpus", "the replayed item carries corpus-tier trust, never live trust");

    // "replay recorded NYT sample": a second, independent click, whose own
    // effect (test/fixtures/news/nyt-world.rss.xml's own "ceasefire"/
    // "tariff" prose) is distinct from the Wikipedia replay above — this is
    // what proves BOTH buttons wire to their own fixture, not one button's
    // effect read twice.
    const rankBeforeNyt = await page.evaluate(() => window.tmct.session.rank({ limit: 50 }));
    await page.locator("#replayNyt").click();
    await waitFor(page, () => document.getElementById("controlsStatus").textContent === "replayed nyt-world", { timeoutMs: INTERACTION_TIMEOUT_MS, pollMs: 500, label: "the NYT replay button's own effect" });
    assert.deepEqual(pageErrors, [], "replaying the NYT fixture never throws");

    const rankAfterNyt = await page.evaluate(() => window.tmct.session.rank({ limit: 50 }));
    assert.ok(
      rankAfterNyt.some((r) => r.term === "ceasefire") || rankAfterNyt.length > rankBeforeNyt.length,
      `the NYT replay's own fixture prose ("Talks Resume Over Ceasefire Terms") widens the ranked term list: before=${JSON.stringify(rankBeforeNyt)} after=${JSON.stringify(rankAfterNyt)}`,
    );

    // Consent was never given, so start()/poll() have still never run — both
    // fixture replays reached the graph without it.
    assert.equal(await page.evaluate(() => window.tmct.session.consented), false, "neither fixture demo grants poll consent");
    assert.equal((await page.evaluate(() => window.tmct.session.requestLog)).length, 0, "neither fixture replay makes a network request of its own");
  } finally {
    await context.close();
  }
});

test("stop & forget clears the start preference; a reload of the same page reads back as first-visit", async () => {
  const { context, page, pageErrors } = await openNewsPage();
  try {
    await waitFor(page, () => window.tmct?.news?.phase && window.tmct.news.phase !== "seeding", { label: "S1 seeded phase" });

    await page.locator("#newsStart").click();
    await waitFor(page, () => document.getElementById("newsStart").disabled === false, { label: "start() settling" });
    assert.equal(await page.evaluate(() => window.tmct.session.consented), true, "start() records consent");
    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.started")), "on", "consent persists as the page's own preference");

    await page.locator("#stopForget").click();
    assert.equal(await page.evaluate(() => window.tmct.session.consented), false, "stop & forget revokes consent immediately, in this same session");
    assert.equal(await page.evaluate(() => window.localStorage.getItem("tmct.news.started")), null, "stop & forget clears the persisted preference");

    // The reload pays the seed's own boot cost again — there is no
    // persistence layer under news.html (unlike chat.html's IndexedDB
    // snapshot), so this is a second full load, not a cache hit.
    await page.reload({ waitUntil: "load" });
    await waitFor(page, () => window.tmct?.news?.phase && window.tmct.news.phase !== "seeding", { label: "the reloaded page's own seeded phase" });
    assert.deepEqual(pageErrors, [], "the reloaded page never throws");
    assert.equal(await page.evaluate(() => window.tmct.session.consented), false, "the reload reads the cleared preference back as first-visit");
    assert.equal(await page.locator("#newsStart").innerText(), "start polling live sources", "the reloaded page shows the first-visit button label, not \"poll now\"");
    assert.equal(await page.locator("#requestLogBody tr").count(), 0, "the reloaded first-visit page has not polled anything on its own");
  } finally {
    await context.close();
  }
});

test("the page answers an in-page round trip within 1500ms at several points while the seed streams and indexes, and a replay-button click lands without paying the seed's own boot cost again", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.route((url) => !url.href.startsWith(server.origin), (route) => route.abort());
    await page.goto(`${server.origin}/news.html`, { waitUntil: "load" });

    // Sample a trivial evaluate() round trip repeatedly across the page's
    // whole one-time boot cost — fetching and JSON-parsing the seed
    // ("seeding"), then building and rendering the seed-derived feed (the
    // "seeded" phase's own first renderAll(), the heavier of the two: it
    // walks the whole graph to score hubs and cut sub-graphs). The sampling
    // condition matches scripts/gen-screenshots.mjs's own news ready check
    // (a rendered `#feed .item`) rather than the phase flag alone, because
    // the phase flips to "seeded" before that first render starts — a loop
    // gated on the phase flag samples only the smaller fetch/parse window.
    //
    // Each sample's own round trip is asserted the moment it lands, not
    // batched at the end: a CDP evaluate() call cannot return early or
    // report partial progress, so ONE stretch of a busy main thread reads
    // as one large sample rather than several small ones swallowed inside
    // it — asserting inline is what turns that stretch into the exact
    // "over budget" failure it is, instead of a confusing sample-count
    // shortfall. At least 2 samples (one before the boot work starts, one
    // spanning it) is what a first-and-last measurement structurally
    // guarantees; the loop takes more whenever the main thread actually
    // yields in between.
    const roundTripSamples = [];
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const startedAt = Date.now();
      const firstItemReady = await page.evaluate(() => {
        const el = document.querySelector("#feed .item");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const ms = Date.now() - startedAt;
      roundTripSamples.push(ms);
      assert.ok(ms < ROUND_TRIP_BUDGET_MS, `round-trip sample ${roundTripSamples.length - 1} answered in ${ms}ms, over the ${ROUND_TRIP_BUDGET_MS}ms budget: ${JSON.stringify(roundTripSamples)}`);
      if (firstItemReady) break;
      await page.waitForTimeout(1000);
    }
    assert.ok(roundTripSamples.length >= 2, `at least 2 round trips were sampled across boot: got ${roundTripSamples.length}`);

    // Once boot has paid its one-time cost (the loop above only exits once
    // phase has left "seeding"), a replay-button click's own effect must
    // land well inside INTERACTION_TIMEOUT_MS — an order of magnitude under
    // READY_TIMEOUT_MS — never re-paying anything like the seed's own boot
    // cost for a click that only touches a small, bundled fixture.
    const clickedAt = Date.now();
    await page.locator("#replayWikipedia").click();
    await waitFor(page, () => document.getElementById("controlsStatus").textContent === "replayed wikimedia-featured", { timeoutMs: INTERACTION_TIMEOUT_MS, pollMs: 500, label: "the replay click's own effect" });
    const elapsedMs = Date.now() - clickedAt;
    assert.ok(elapsedMs < INTERACTION_TIMEOUT_MS, `the replay click's effect landed in ${elapsedMs}ms, without waiting for the seed-derived feed to rebuild from scratch`);
  } finally {
    await context.close();
  }
});
