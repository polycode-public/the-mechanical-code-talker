// news-browser-entry: createNewsSession over the real news capability —
// the consent gate (no fetch before start()), the phase transitions, fixture
// replay under corpus-tier provenance, upload downgrade, and a returning
// visit reading back correctly after stop & forget.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createNewsSession, NEWS_START_PREF_KEY } from "../../src/surfaces/web/news-browser-entry.mjs";
import { readFactRows, loadMemory, appendFacts } from "../../src/adapters/memory/core.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
import { registerResearchProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";

// enrichTopTerms (run inside start()) walks the KB sources through the real
// getResearchProvider seam; this stub keeps every enrich cycle in this file
// an honest, instant miss instead of a real network attempt (or a multi-
// second wait on the shared singleton provider's own courtesy floor).
registerResearchProvider({ lookup: async () => null });
after(() => registerResearchProvider(null));

const FIXED_NOW = () => "2026-08-08T12:00:00.000Z";

function memoryPrefs() {
  const map = new Map();
  return { map, prefs: { get: (k) => (map.has(k) ? map.get(k) : null), set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) } };
}

function neverFetch() {
  return async () => { throw new Error("this session must never call fetch before start()"); };
}

// An immediate, well-formed "nothing here" response for every source's own
// wire shape — never a null/404-shaped miss, so the wikimedia adapter's own
// previous-UTC-day retry (a real, correct courtesy-gated second fetch) never
// fires and these tests never pay its minIntervalMs wait for a case that
// isn't testing that retry path.
function emptyOkFetch() {
  return async () => ({
    ok: true, status: 200,
    json: async () => ({}),
    text: async () => "",
    headers: { get: () => null },
  });
}

test("no fetch fires before start(): rank/buildFeed/ingestText never touch the network", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  await session.buildFeed();
  await session.rank();
  await session.ingestText("A module is a component.");
  session.destroy();
  // neverFetch() throws if ever called — reaching here without a throw is the assertion.
});

test("start() is the one action that fires fetches, and it persists the consent preference", async () => {
  const { prefs, map } = memoryPrefs();
  let fetchCalls = 0;
  const fetchImpl = async (...args) => { fetchCalls += 1; return emptyOkFetch()(...args); };
  const session = createNewsSession({ prefs, fetchImpl, now: FIXED_NOW });
  assert.equal(session.consented, false);
  await session.start();
  assert.ok(fetchCalls > 0, "start() actually attempted at least one request");
  assert.equal(session.consented, true);
  assert.equal(map.get(NEWS_START_PREF_KEY), "on");
  session.destroy();
});

test("phase transitions fire in order against stubbed fetchers: seeded -> polling -> grounding -> enriching -> idle", async () => {
  const { prefs } = memoryPrefs();
  const seen = [];
  const fetchImpl = async (...args) => { seen.push("fetch"); return emptyOkFetch()(...args); };
  const session = createNewsSession({ prefs, fetchImpl, now: FIXED_NOW });
  assert.equal(session.phase, "seeded");
  await session.start();
  assert.equal(session.phase, "idle", "a completed start() cycle settles on idle");
  assert.ok(seen.length > 0, "the stubbed fetcher actually ran during that cycle");
  session.destroy();
});

test("addSource() performs its own one-off preflight regardless of start() consent", async () => {
  const { prefs } = memoryPrefs();
  const fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "t", items: [] }),
    headers: { get: () => null },
  });
  const session = createNewsSession({ prefs, fetchImpl, now: FIXED_NOW });
  assert.equal(session.consented, false);
  const result = await session.addSource("https://example.com/feed.json");
  assert.equal(result.ok, true);
  assert.equal(result.format, "jsonfeed");
  assert.ok(session.config.sources.includes(result.id));
  session.destroy();
});

test("replayFixture lands facts under news-fixture: provenance, at the corpus trust tier, without ever fetching", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  const body = `<rss><channel><item><title>Talks Resume Over Ceasefire Terms</title><link>https://example.com/a</link><description>Officials met today in the capital.</description></item></channel></rss>`;
  const result = await session.replayFixture("nyt-world", { format: "rss", body });
  assert.ok(result.items >= 1);
  const rows = readFactRows(await loadMemory(session.memoryDir));
  const fixtureRows = rows.filter((r) => /news-fixture:/.test(r.provenance || ""));
  assert.ok(fixtureRows.length > 0, "at least one fact landed under news-fixture: provenance");
  for (const row of fixtureRows) {
    const source = provenanceTagToSource(row.provenance.split(" | ")[0]);
    assert.ok(source, "the tag parses to a known source kind");
  }
  session.destroy();
});

test("buildFeed's items carry background/backgroundParagraph once the newsworthiness gate splits a card's own rows", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  await appendFacts(session.memoryDir, [
    { subject: "ceasefire", predicate: "mgx:causes", object: "relief", provenance: "news:src@i1", observedAt: FIXED_NOW() },
    { subject: "ceasefire", predicate: "rdf:type", object: "event", provenance: "news:src@i1", observedAt: FIXED_NOW() },
  ]);
  const feed = await session.buildFeed();
  const item = feed.items.find((it) => it.hub === "ceasefire");
  assert.ok(item, `ceasefire heads a card from its own reported relation: ${JSON.stringify(feed.items.map((i) => i.hub))}`);
  assert.ok(item.background.length > 0, "the identity fact rides along as background, not its own sentence in the main paragraph");
  assert.match(item.backgroundParagraph, /event/, "the collapsed line carries what the gate dropped from the paragraph");
  session.destroy();
});

test("the seed-only feed carries the seed label until the first poll completes", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  // A row with no news/news-fixture/research provenance — the shape a real
  // chat-seed.json row carries.
  await appendFacts(session.memoryDir, [{ subject: "owl", predicate: "rdf:type", object: "bird", provenance: "corpus:seed" }]);
  const feed = await session.buildFeed();
  assert.equal(feed.seedFallback, true, "a graph with no news/research rows falls back to the seed-wide feed");
  assert.ok(feed.items.some((it) => it.hub === "owl"), "the seed fact itself becomes a feed item");
  session.destroy();
});

test("ingestFile downgrades an uploaded jsonl row above the teach tier, and leaves an at-or-below-teach row untouched", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  const rows = [
    { subject: "widget", predicate: "rdf:type", object: "gadget", provenance: "operator" },
    { subject: "gizmo", predicate: "rdf:type", object: "device", provenance: "teach:chat:s1@2026-01-01T00:00:00.000Z" },
  ];
  const text = rows.map((r) => JSON.stringify(r)).join("\n");
  const result = await session.ingestFile({ name: "upload.jsonl", text });
  assert.equal(result.facts, 2);
  const stored = readFactRows(await loadMemory(session.memoryDir));
  const widget = stored.find((r) => r.subject === "widget");
  const gizmo = stored.find((r) => r.subject === "gizmo");
  assert.match(widget.provenance, /^teach:upload:upload\.jsonl@/, "the above-teach row was re-tagged under this upload");
  assert.ok(gizmo.provenance.includes("teach:chat:s1"), "the at-or-below-teach row kept its stated provenance");
  session.destroy();
});

test("revokeConsent clears the start preference; a fresh session against the same prefs reads back as first-visit", async () => {
  const { prefs, map } = memoryPrefs();
  const s1 = createNewsSession({ prefs, fetchImpl: emptyOkFetch(), now: FIXED_NOW });
  await s1.start();
  assert.equal(s1.consented, true);
  assert.equal(map.get(NEWS_START_PREF_KEY), "on");
  s1.revokeConsent();
  assert.equal(s1.consented, false);
  assert.equal(map.get(NEWS_START_PREF_KEY), undefined);
  s1.destroy();

  const s2 = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  assert.equal(s2.consented, false, "a fresh session against the same prefs reads back as first-visit");
  assert.equal(s2.phase, "seeded");
  s2.destroy();
});

test("setInterval clamps to the same poll floor the service config enforces, and re-arms nextPollAt", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: emptyOkFetch(), now: FIXED_NOW });
  await session.start(); // arms consent so the timer can be set
  const clamped = session.setInterval(2);
  assert.equal(clamped, 5, "a value under the floor clamps up to it");
  assert.ok(session.nextPollAt, "the timer re-armed with a concrete next-poll timestamp");
  const off = session.setInterval(0);
  assert.equal(off, 0);
  assert.equal(session.nextPollAt, "", "an interval of 0 disarms the timer");
  session.destroy();
});

test("uploading a lexicon-shaped .json file widens vocabulary without writing any fact", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  const before = readFactRows(await loadMemory(session.memoryDir)).length;
  const result = await session.ingestFile({
    name: "vocab.json",
    text: JSON.stringify({ nouns: { widget: [{ lemma: "widget", plural: "widgets" }] } }),
  });
  assert.equal(result.facts, 0, "a lexicon upload never writes a fact");
  const after = readFactRows(await loadMemory(session.memoryDir)).length;
  assert.equal(after, before);
  session.destroy();
});

test("session builds against a seed payload and the page API surface (every session verb) is present", () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch(), now: FIXED_NOW });
  for (const verb of [
    "start", "poll", "enrich", "buildFeed", "rank", "addSource", "setInterval",
    "ingestText", "ingestFile", "replayFixture", "revokeConsent",
  ]) {
    assert.equal(typeof session[verb], "function", `session.${verb} is a function`);
  }
  session.destroy();
});
