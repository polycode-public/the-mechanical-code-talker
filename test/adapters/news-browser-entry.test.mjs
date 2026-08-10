// news-browser-entry: createNewsSession as the thin API client over the row
// service's news routes — the consent gate (no session key minted, and no
// request made, before the first press), the trigger verbs, the version-bump
// wait that settles a press once its own cycle materializes, and stop &
// forget's purge-and-discard. Runs against the real row service double
// (createLocalRowService) with an in-process news worker driven by fixture
// fetchers, so every request here is real HTTP over real routes, never a
// fake of the client's own making.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalRowService } from "../../server/row-service/local.mjs";
import { createNewsSession, NEWS_START_PREF_KEY, NEWS_SESSION_PREF_KEY, parseJsonlRows } from "../../src/surfaces/web/news-browser-entry.mjs";

function memoryPrefs() {
  const map = new Map();
  return { map, prefs: { get: (k) => (map.has(k) ? map.get(k) : null), set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) } };
}

/** A fetchImpl that resolves this module's own root-relative paths
 *  ("/api/…") against a running service's base URL — the same resolution a
 *  browser's ambient fetch does for free against `document.location`. */
function fetchAgainst(baseUrl) {
  return (path, init) => fetch(new URL(path, baseUrl), init);
}

function neverFetch() {
  return async () => { throw new Error("this session must never call the network before a press authorises it"); };
}

const service = await createLocalRowService({
  newsWorker: {
    fetchersFor: () => new Map(),
    now: () => "2026-08-08T12:00:00.000Z",
  },
});
after(async () => { await service.close(); });

const FAST_POLL = { cyclePollMs: 5, cycleWaitTimeoutMs: 5000 };

test("no request fires before any press: fetchFeed answers the empty document without touching the network", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch() });
  const feed = await session.fetchFeed();
  assert.deepEqual(feed.items, []);
  assert.equal(feed.missing, true);
  assert.equal(session.sessionKey, null);
});

test("start() mints the session key, persists consent, and settles once its own poll cycle materializes", async () => {
  const { prefs, map } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  assert.equal(session.consented, false);
  const feed = await session.start();
  assert.equal(session.consented, true);
  assert.ok(session.sessionKey, "start() minted a session key");
  assert.equal(map.get(NEWS_SESSION_PREF_KEY), session.sessionKey, "the key persisted to the pref store");
  assert.equal(map.get(NEWS_START_PREF_KEY), "on");
  assert.equal(feed.missing, false, "the cycle materialized a real feed document before start() resolved");
});

test("enrich() and ingestText() each mint their own session independently of start()'s consent", async () => {
  const { prefs, map } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const feed = await session.enrich();
  assert.equal(session.consented, false, "enrich alone never records the start preference");
  assert.ok(session.sessionKey, "enrich still needed a session key to reach the trigger route");
  assert.equal(map.get(NEWS_START_PREF_KEY), undefined);
  assert.equal(feed.missing, false);
});

test("ingestText() posts free text through the ingest trigger and the taught fact reaches the graph size the next feed reports", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const before = await session.fetchFeed();
  assert.equal(before.stats.graphSize, 0);
  const after = await session.ingestText("A ceasefire is a formal agreement to stop fighting.");
  assert.ok(after.stats.graphSize > before.stats.graphSize, `the ingested text grew the graph: ${JSON.stringify(after.stats)}`);
});

test("ingestRows() posts parsed fact rows through the ingest trigger", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const rows = parseJsonlRows('{"subject":"tariff","predicate":"rdf:type","object":"tax"}\n{"subject":"widget","predicate":"rdf:type","object":"gadget"}');
  assert.equal(rows.length, 2);
  const feed = await session.ingestRows(rows);
  assert.ok(feed.stats.graphSize >= 2, `both rows reached the graph: ${JSON.stringify(feed.stats)}`);
});

test("parseJsonlRows drops an unparseable line rather than throwing, and keeps every well-formed one", () => {
  const rows = parseJsonlRows('{"subject":"a","predicate":"rdf:type","object":"b"}\nnot json\n{"subject":"c","predicate":"rdf:type","object":"d"}\n');
  assert.deepEqual(rows, [
    { subject: "a", predicate: "rdf:type", object: "b" },
    { subject: "c", predicate: "rdf:type", object: "d" },
  ]);
});

test("revokeConsent purges the session server-side and discards the key and consent preference locally, regardless of outcome", async () => {
  const { prefs, map } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  await session.start();
  const key = session.sessionKey;
  assert.ok(key);

  const result = await session.revokeConsent();
  assert.equal(result.ok, true);
  assert.equal(session.sessionKey, null);
  assert.equal(session.consented, false);
  assert.equal(map.get(NEWS_SESSION_PREF_KEY), undefined);
  assert.equal(map.get(NEWS_START_PREF_KEY), undefined);

  // The purge really did reach the server: reading the same key back (a
  // fresh session pointed at it deliberately, standing in for whatever a
  // lingering tab would still hold) sees no feed and no rows.
  const stale = createNewsSession({ prefs: { get: () => key, set: () => {}, remove: () => {} }, fetchImpl: fetchAgainst(service.url) });
  const feed = await stale.fetchFeed();
  assert.equal(feed.missing, true, "no materialized feed survives the purge");
});

test("a fresh session against the same prefs after revokeConsent reads back as first-visit", async () => {
  const { prefs } = memoryPrefs();
  const s1 = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  await s1.start();
  await s1.revokeConsent();

  const s2 = createNewsSession({ prefs, fetchImpl: neverFetch() });
  assert.equal(s2.sessionKey, null);
  assert.equal(s2.consented, false);
  const feed = await s2.fetchFeed();
  assert.equal(feed.missing, true);
});

test("a network failure marks the session unavailable, and a later successful request clears it again", async () => {
  const { prefs } = memoryPrefs();
  let broken = true;
  const flakyFetch = async (path, init) => {
    if (broken) throw new Error("connection refused");
    return fetchAgainst(service.url)(path, init);
  };
  const session = createNewsSession({ prefs, fetchImpl: flakyFetch, ...FAST_POLL });
  await assert.rejects(() => session.start(), /could not reach the news service/);
  assert.equal(session.unavailable, true);

  broken = false;
  const keyMintedDuringTheFailedAttempt = session.sessionKey;
  const feed = await session.start();
  assert.equal(session.unavailable, false, "a later successful request clears the flag");
  assert.equal(session.sessionKey, keyMintedDuringTheFailedAttempt, "start() reuses the key the failed attempt already minted, rather than minting a second one");
  assert.equal(feed.missing, false, "the retried press actually reached the server this time");
});

test("a 5xx response also marks the session unavailable", async () => {
  const { prefs } = memoryPrefs();
  const always503 = async () => new Response(JSON.stringify({ error: { message: "down for maintenance" } }), { status: 503 });
  const session = createNewsSession({ prefs, fetchImpl: always503 });
  await assert.rejects(() => session.enrich(), /the news service failed \(status 503\)/);
  assert.equal(session.unavailable, true);
});

test("the session's public surface carries every verb the page calls", () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch() });
  for (const verb of ["fetchFeed", "fetchFeedVersion", "start", "enrich", "ingestText", "ingestRows", "revokeConsent", "destroy"]) {
    assert.equal(typeof session[verb], "function", `session.${verb} is a function`);
  }
});
