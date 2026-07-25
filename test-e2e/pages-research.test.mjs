// The research page in a real browser: one in-memory graph grows three ways
// (research a term, teach by telling, ingest documents), the highlights panels
// show what was just learned and the best-connected terms, each source lists
// its own learning history, and the "ask the graph" box is scoped by source —
// a question answered from the whole store abstains honestly once its source is
// unchecked. Drives public/research.html directly, third-party hosts blocked
// (so the research/live-Wikipedia lanes never reach the network here — the
// teach and ingest growth paths and the source-scoped ask need no network),
// the same posture pages-ingest.test.mjs holds.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const GROW_TIMEOUT_MS = 20_000;
// A multi-topic research run is paced by the adapter's polite 2s interval
// between round trips and the page's own 2.4s auto-play tick.
const DEEP_RUN_TIMEOUT_MS = 60_000;

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

async function openResearchPage({ viewport, colorScheme } = {}) {
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ...(colorScheme ? { colorScheme } : {}),
  });
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

  await page.goto(`${server.origin}/research.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.tmctResearchReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctResearchReady);
  return { context, page, consoleErrors, failedRequests };
}

/** Invented terms, never in the seed, so a grown fact is genuinely new (a seed
 *  duplicate would not change any panel). */
const TAUGHT = "a wozzle is a kind of dog";
const DOC = "A florp is a kind of animal. A florp has a tail.";

const sourceKeys = (page) =>
  page.locator('#sourcesList input[type="checkbox"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));

async function teach(page, text) {
  await page.fill("#teachInput", text);
  await page.click("#teachGo");
  await page.waitForFunction(() => /stored/i.test(document.querySelector("#teachNote")?.textContent || ""), null, { timeout: GROW_TIMEOUT_MS });
}

async function ingest(page, text) {
  await page.fill("#ingestText", text);
  await page.click("#ingestGo");
  await page.waitForFunction(() => /grounded/.test(document.querySelector("#ingestNote")?.textContent || ""), null, { timeout: GROW_TIMEOUT_MS });
}

/** Set the source checkbox for exactly `keepKeys` on, every other off, firing
 *  the change events the page's checked-set tracking listens for. */
async function scopeTo(page, keepKeys) {
  await page.evaluate((keys) => {
    for (const cb of document.querySelectorAll('#sourcesList input[type="checkbox"]')) {
      const on = keys.includes(cb.getAttribute("data-key"));
      if (cb.checked !== on) { cb.checked = on; cb.dispatchEvent(new Event("change")); }
    }
  }, keepKeys);
}

async function ask(page, q) {
  await page.fill("#askInput", q);
  await page.click("#askGo");
  await page.waitForFunction(() => !/thinking/.test(document.querySelector("#answer")?.textContent || ""), null, { timeout: GROW_TIMEOUT_MS });
  const answerEl = page.locator("#answer");
  return { text: (await answerEl.textContent()) || "", miss: await answerEl.evaluate((e) => e.classList.contains("miss")) };
}

async function digestTerm(page, term) {
  await page.fill("#digestInput", term);
  await page.click("#digestGo");
  await page.waitForFunction(
    () => Boolean(document.querySelector("#digestOut .dgcard, #digestOut .miss")),
    null,
    { timeout: GROW_TIMEOUT_MS },
  );
  return page.locator("#digestOut");
}

test("the research page serves every asset it asks for and logs no error of its own", async () => {
  const { context, page, consoleErrors, failedRequests } = await openResearchPage();
  try {
    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "the page loads without logging an error");
    assert.match(await page.title(), /research/);
    assert.equal(await page.locator("#askGo").isDisabled(), false, "the ask box is live once the engine boots");
  } finally {
    await context.close();
  }
});

test("a seeded boot lists the seed corpus bands as scopeable sources", async () => {
  const { context, page } = await openResearchPage();
  try {
    const keys = await sourceKeys(page);
    assert.ok(keys.length > 2, `expected several seed sources, got ${keys.length}`);
    assert.ok(keys.every((k) => k.startsWith("seed:")), "a fresh boot has only seed sources, no session-grown ones yet");
    assert.ok(keys.includes("seed:conceptnet"), "the ConceptNet seed band is one of the scopeable sources");
  } finally {
    await context.close();
  }
});

test("teach by telling grows the graph: a taught source appears with the fact in its history and in recently-learned", async () => {
  const { context, page, consoleErrors } = await openResearchPage();
  try {
    await teach(page, TAUGHT);
    const keys = await sourceKeys(page);
    assert.ok(keys.includes("taught"), "a taught source appears once a fact is taught");

    const recent = await page.locator("#recentList .fact .subj").allInnerTexts();
    assert.ok(recent.some((s) => /^wozzles?$/.test(s)), "the taught fact shows in recently-learned");

    // textContent, not innerText: the history sits in a collapsed <details>, so
    // innerText would read empty for the hidden rows even though they are there.
    const taughtHistory = await page.locator("details.source:has(input[data-key='taught']) .srcHistory .subj").evaluateAll((els) => els.map((e) => e.textContent || ""));
    assert.ok(taughtHistory.some((s) => /^wozzles?$/.test(s)), "the taught source lists the fact it added in its own history");
    assert.deepEqual(consoleErrors, [], "teaching logs no error");
  } finally {
    await context.close();
  }
});

test("ingest documents grows the graph and reports the honest skip count", async () => {
  const { context, page } = await openResearchPage();
  try {
    await ingest(page, DOC + " How are you today?");
    assert.match(await page.locator("#ingestNote").innerText(), /3 sentences read, 2 grounded, 1 skipped/, "the question is skipped honestly, the two facts grounded");
    const keys = await sourceKeys(page);
    assert.ok(keys.includes("ingest"), "an ingest source appears once a document grounds a fact");
    const hubs = await page.locator("#hubsList .chip").count();
    assert.ok(hubs > 0, "the best-connected-terms panel fills as the graph grows");
  } finally {
    await context.close();
  }
});

test("the ask is scoped by source: a fact abstains once its own source is unchecked, and answers again with it checked", async () => {
  const { context, page } = await openResearchPage();
  try {
    await teach(page, TAUGHT);
    await ingest(page, DOC);

    // Every source checked -> the taught fact answers.
    const all = await ask(page, "what is a wozzle");
    assert.equal(all.miss, false, "with every source checked the taught fact answers");
    assert.match(all.text, /wozzle/i, "the answer names the taught subject");

    // Scope to the ingested documents only -> the taught fact is out of scope,
    // an honest miss rather than a guess.
    await scopeTo(page, ["ingest"]);
    const scopedOut = await ask(page, "what is a wozzle");
    assert.equal(scopedOut.miss, true, "scoped to ingest only, the taught fact abstains");
    assert.match(scopedOut.text, /abstain|no grounded answer/i, "the miss is worded as an abstention");

    // The ingested fact, in scope, still answers under the same ingest-only scope.
    const inScope = await ask(page, "what is a florp");
    assert.equal(inScope.miss, false, "the ingested fact answers when its own source is the checked one");
    assert.match(inScope.text, /florp/i, "the answer names the ingested subject");
  } finally {
    await context.close();
  }
});

// A two-tier link graph, so a depth-2 run has somewhere deeper to go: Owl's
// lead links reach Bird/Night/Feather, and Bird's own reach Feather/Wing.
const SUMMARIES = {
  Owl: { title: "Owl", extract: "An owl is a bird. Owls hunt at night.", revision: "201", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Owl" } } },
  Bird: { title: "Bird", extract: "A bird is an animal. Birds have feathers.", revision: "202", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Bird" } } },
  Night: { title: "Night", extract: "Night is the dark part of the day.", revision: "203", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Night" } } },
  Feather: { title: "Feather", extract: "A feather is a covering.", revision: "204", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Feather" } } },
  Wing: { title: "Wing", extract: "A wing is a limb.", revision: "205", content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Wing" } } },
};
const LEAD_LINKS = {
  Owl: ["Bird", "Night", "Feather"],
  Bird: ["Feather", "Wing", "Owl"],
};

/** Answer opensearch, the per-page lead-section links parse, and the per-title
 *  REST summaries from fixtures, with the CORS header a cross-origin fetch
 *  needs. Registered after the page's blanket third-party block, so it wins. */
async function routeSimpleWikipedia(page) {
  await page.route("https://simple.wikipedia.org/**", (route) => {
    const url = route.request().url();
    const ok = (body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
    if (url.includes("action=opensearch")) return ok(JSON.stringify(["owl", ["Owl"], [""], [""]]));
    if (url.includes("action=parse")) {
      const from = Object.keys(LEAD_LINKS).find((t) => url.includes("page=" + t));
      const links = (LEAD_LINKS[from] || []).map((title) => ({ ns: 0, exists: true, title }));
      return ok(JSON.stringify({ parse: { links } }));
    }
    const title = decodeURIComponent(url.split("/summary/")[1] || "");
    const summary = SUMMARIES[title];
    if (!summary) return route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    return ok(JSON.stringify(summary));
  });
}

test("the node knobs govern the run: depth 2 with a small node budget grounds exactly the budget and says the budget is why it stopped", async () => {
  const { context, page, consoleErrors } = await openResearchPage();
  try {
    await routeSimpleWikipedia(page);
    await page.fill("#researchNodes", "3");
    await page.fill("#researchDepth", "2");
    await page.fill("#researchTopic", "owl");
    await page.click("#researchGo");

    // The queue auto-plays; it is finished when the note says so.
    await page.waitForFunction(
      () => /complete/.test(document.querySelector("#researchNote")?.textContent || ""),
      null,
      { timeout: DEEP_RUN_TIMEOUT_MS },
    );
    const note = await page.locator("#researchNote").innerText();
    assert.match(note, /research "owl" complete/);
    assert.match(note, /3 topics grounded/, "the run grounded exactly its node budget, not the whole fan-out");
    assert.match(note, /\(depth 2, budget 3\)/, "the page's own knob values ride the run and are visible in its status");
    assert.match(note, /node budget reached/, "the budget, not a lack of links, is named as the reason it stopped");

    const keys = await sourceKeys(page);
    assert.ok(keys.includes("research"), "a research source appears once the run grounds facts");
    assert.deepEqual(consoleErrors, [], "the run logs no error");
  } finally {
    await context.close();
  }
});

test("a depth-2 run reaches a topic no depth-1 run could: a second-tier link is grounded and answers", async () => {
  const { context, page } = await openResearchPage();
  try {
    await routeSimpleWikipedia(page);
    // Budget 4, depth 2, fan-out 1 per tier via the run's own limit token so the
    // queue must go DEEPER rather than wider to spend its budget.
    await page.fill("#researchNodes", "4");
    await page.fill("#researchDepth", "2");
    await page.fill("#researchTopic", "owl, limit 1");
    await page.click("#researchGo");

    await page.waitForFunction(
      () => /complete/.test(document.querySelector("#researchNote")?.textContent || ""),
      null,
      { timeout: DEEP_RUN_TIMEOUT_MS },
    );
    // Owl (depth 0) -> Bird (depth 1) -> Feather (depth 2): a depth-1 run stops
    // at Bird, so Feather in the history is the depth-2 hop actually happening.
    const researchHistory = await page.locator("details.source:has(input[data-key='research']) .srcHistory .subj")
      .evaluateAll((els) => els.map((e) => e.textContent || ""));
    assert.ok(researchHistory.some((s) => /^feathers?$/.test(s)), `expected a depth-2 topic in the research history, got ${JSON.stringify(researchHistory)}`);
  } finally {
    await context.close();
  }
});

test("reset clears the grown graph back to the seed sources", async () => {
  const { context, page } = await openResearchPage();
  try {
    await teach(page, TAUGHT);
    assert.ok((await sourceKeys(page)).includes("taught"), "the taught source is present before reset");
    await page.click("#resetBtn");
    await page.waitForFunction(() => !document.querySelector('#sourcesList input[data-key="taught"]'), null, { timeout: GROW_TIMEOUT_MS });
    const keys = await sourceKeys(page);
    assert.ok(keys.every((k) => k.startsWith("seed:")), "after reset only the seed sources remain");
    assert.equal(await page.locator("#recentList .fact").count(), 0, "recently-learned is empty again");
  } finally {
    await context.close();
  }
});

test("the term digest reads a grown term back as a narrative, names its sources, and holds the full fact list behind 'show the facts'", async () => {
  const { context, page, consoleErrors } = await openResearchPage();
  try {
    // Two facts about one invented term, grounded through ingest, so the digest
    // has a definition to lead with and a second fact for the detail escape.
    await ingest(page, DOC);
    const out = await digestTerm(page, "florp");

    const card = out.locator(".dgcard");
    assert.equal(await card.count(), 1, "a grown term digests to a card, not a miss");
    const paras = await card.locator("p:not(.dgsrc)").allInnerTexts();
    assert.ok(paras.length >= 1, "the digest leads with at least one narrative paragraph");
    assert.ok(paras.join(" ").toLowerCase().includes("florp"), "the narrative names the term");
    assert.match(paras.join(" "), /animal/i, "the narrative states the taught class");

    // Provenance rides through in the "(sources: …)" idiom the chat and CLI use.
    const src = (await card.locator(".dgsrc").innerText()).trim();
    assert.match(src, /^\(sources:.*\)$/, `the sources line matches the idiom, got ${JSON.stringify(src)}`);

    // The full fact list is reachable, but only behind the explicit escape:
    // the rows sit inside a collapsed <details>, so they are present in the DOM
    // yet not shown until the summary is clicked.
    assert.equal(await card.locator(".dgfacts").getAttribute("open"), null, "the fact list starts collapsed");
    assert.equal(await card.locator(".dgfacts .factlist .fact").first().isVisible(), false, "the flat facts are hidden until asked for");
    await card.locator(".dgfacts > summary").click();
    const factSubjects = await card.locator(".dgfacts .factlist .fact .subj").allInnerTexts();
    assert.ok(factSubjects.length >= 2, `show the facts reveals every stored fact, got ${factSubjects.length}`);
    assert.ok(factSubjects.every((s) => /^florps?$/.test(s)), "the revealed facts are all about the term");

    assert.deepEqual(consoleErrors, [], "digesting a term logs no error");
  } finally {
    await context.close();
  }
});

test("the term digest abstains on a term the graph holds nothing about, never guessing", async () => {
  const { context, page } = await openResearchPage();
  try {
    const out = await digestTerm(page, "zzzznonexistentzzz");
    assert.equal(await out.locator(".dgcard").count(), 0, "an unknown term produces no digest card");
    const miss = (await out.locator(".miss").innerText()).toLowerCase();
    assert.match(miss, /abstain|nothing is stored|no grounded/, "the empty digest is worded as an abstention");
  } finally {
    await context.close();
  }
});

test("clicking a best-connected term reads it back through the digest panel", async () => {
  const { context, page } = await openResearchPage();
  try {
    await ingest(page, DOC); // grows the graph so best-connected terms appear
    const chip = page.locator("#hubsList .chip.tapchip").first();
    // The chip's aria-label carries the exact term it digests, so the test does
    // not depend on which term ranks highest in the seeded graph.
    const label = await chip.getAttribute("aria-label");
    const term = String(label || "").replace(/^read a digest of /, "");
    assert.ok(term.length > 0, "the hub chip names the term it will digest");
    await chip.click();
    await page.waitForFunction(
      () => Boolean(document.querySelector("#digestOut .dgcard, #digestOut .miss")),
      null,
      { timeout: GROW_TIMEOUT_MS },
    );
    assert.equal(await page.locator("#digestInput").inputValue(), term, "clicking the chip digests that exact term");
  } finally {
    await context.close();
  }
});

test("the research page fits a phone viewport without sideways scrolling, in both color schemes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await openResearchPage({ viewport: { width: 375, height: 812 }, colorScheme });
    try {
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${colorScheme}: the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`,
      );
    } finally {
      await context.close();
    }
  }
});
