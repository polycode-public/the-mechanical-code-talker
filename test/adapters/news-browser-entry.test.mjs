// news-browser-entry: createNewsSession as the thin API client over the row
// service's news routes — the consent gate (no session key minted, and no
// request made, before the first press), the trigger verbs, the version-bump
// wait that settles a press once its own cycle materializes, the standing
// feedVersion refresh loop's own backoff-and-reset, and stop & forget's
// purge-and-discard. Runs against the real row service double
// (createLocalRowService) with an in-process news worker driven by fixture
// fetchers, so every request here is real HTTP over real routes, never a
// fake of the client's own making.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalRowService } from "../../server/row-service/local.mjs";
import { createLocalTurnService } from "../../server/turn-service/local.mjs";
import {
  createNewsSession, NEWS_START_PREF_KEY, NEWS_SESSION_PREF_KEY, parseJsonlRows, turnCitationLines,
} from "../../src/surfaces/web/news-browser-entry.mjs";

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
  session.destroy();
});

test("enrich() and ingestText() each mint their own session independently of start()'s consent", async () => {
  const { prefs, map } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const feed = await session.enrich();
  assert.equal(session.consented, false, "enrich alone never records the start preference");
  assert.ok(session.sessionKey, "enrich still needed a session key to reach the trigger route");
  assert.equal(map.get(NEWS_START_PREF_KEY), undefined);
  assert.equal(feed.missing, false);
  session.destroy();
});

test("ingestText() posts free text through the ingest trigger and the taught fact reaches the graph size the next feed reports", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const before = await session.fetchFeed();
  assert.equal(before.stats.graphSize, 0);
  const after = await session.ingestText("A ceasefire is a formal agreement to stop fighting.");
  assert.ok(after.stats.graphSize > before.stats.graphSize, `the ingested text grew the graph: ${JSON.stringify(after.stats)}`);
  session.destroy();
});

test("ingestRows() posts parsed fact rows through the ingest trigger", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const rows = parseJsonlRows('{"subject":"tariff","predicate":"rdf:type","object":"tax"}\n{"subject":"widget","predicate":"rdf:type","object":"gadget"}');
  assert.equal(rows.length, 2);
  const feed = await session.ingestRows(rows);
  assert.ok(feed.stats.graphSize >= 2, `both rows reached the graph: ${JSON.stringify(feed.stats)}`);
  session.destroy();
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
  stale.destroy();
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
  session.destroy();
});

test("a 5xx response also marks the session unavailable", async () => {
  const { prefs } = memoryPrefs();
  const always503 = async () => new Response(JSON.stringify({ error: { message: "down for maintenance" } }), { status: 503 });
  const session = createNewsSession({ prefs, fetchImpl: always503 });
  await assert.rejects(() => session.enrich(), /the news service failed \(status 503\)/);
  assert.equal(session.unavailable, true);
  session.destroy();
});

test("the session's public surface carries every verb the page calls", () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: neverFetch() });
  for (const verb of ["fetchFeed", "fetchFeedVersion", "fetchCycle", "onFeedUpdate", "start", "enrich", "ingestText", "ingestRows", "turn", "revokeConsent", "destroy"]) {
    assert.equal(typeof session[verb], "function", `session.${verb} is a function`);
  }
});

// ---------------------------------------------------------------------------
// turn() — the chat area's one call, against a real turn-service double.
// Self-contained (no shared backend with the row service double above):
// these tests exercise the client wrapper's own request/response handling —
// the citation building, the fuzzy override, the 429 wording, the
// unavailable flag — not the cross-service materialization flow, which the
// news feed's own end-to-end spec covers.

const turnService = await createLocalTurnService({});
after(async () => { await turnService.close(); });

function sessionAgainstTurnService(extra = {}) {
  const { prefs } = memoryPrefs();
  return createNewsSession({ prefs, fetchImpl: fetchAgainst(turnService.url), ...extra });
}

test("turn() posts the text, mints its own session key, and returns the reply, factsTouched and their phrase-layer citations", async () => {
  const session = sessionAgainstTurnService();
  const result = await session.turn("remember that zorblatt is a dog");
  assert.ok(session.sessionKey, "turn() minted a session key, the same implicit-creation rule every trigger follows");
  assert.match(result.reply, /zorblatt/i);
  assert.ok(result.factsTouched.length > 0, "teaching through chat wrote at least one fact row");
  assert.ok(result.citations.some((line) => /zorblatt/.test(line) && /dog/.test(line)), `a citation names the taught fact: ${JSON.stringify(result.citations)}`);
  session.destroy();
});

test("turn() answers an honest miss with no citations when nothing was taught", async () => {
  const session = sessionAgainstTurnService();
  const result = await session.turn("what is a zorptronic");
  assert.match(result.reply, /don't know "zorptronic"/);
  assert.deepEqual(result.factsTouched, []);
  assert.deepEqual(result.citations, []);
  session.destroy();
});

test("turn()'s fuzzy option rides the body as retrieval.fuzzy, and is omitted entirely when not supplied", async () => {
  const bodies = [];
  const spyFetch = async (path, init) => {
    if (String(path).includes("/turn")) bodies.push(JSON.parse(init.body));
    return fetchAgainst(turnService.url)(path, init);
  };
  const session = createNewsSession({ prefs: memoryPrefs().prefs, fetchImpl: spyFetch });
  await session.turn("hello", { fuzzy: true });
  await session.turn("hello", { fuzzy: false });
  await session.turn("hello");
  assert.deepEqual(bodies, [
    { text: "hello", retrieval: { fuzzy: true } },
    { text: "hello", retrieval: { fuzzy: false } },
    { text: "hello" },
  ]);
  session.destroy();
});

test("turn() rejects a 429 with a rate-limit message distinct from the generic unavailable wording, and never marks the session unavailable", async () => {
  const limited = await createLocalTurnService({ turnRateLimit: 1 });
  try {
    const session = createNewsSession({ prefs: memoryPrefs().prefs, fetchImpl: fetchAgainst(limited.url) });
    await session.turn("hello");
    await assert.rejects(() => session.turn("hello again"), /sent a lot of chat messages/);
    assert.equal(session.unavailable, false, "a turn-rate cap is not the service being down");
    session.destroy();
  } finally {
    await limited.close();
  }
});

test("turn() marks the session unavailable on a network failure, matching every other request", async () => {
  const brokenFetch = async () => { throw new Error("connection refused"); };
  const session = createNewsSession({ prefs: memoryPrefs().prefs, fetchImpl: brokenFetch });
  await assert.rejects(() => session.turn("hello"), /could not reach the news service/);
  assert.equal(session.unavailable, true);
  session.destroy();
});

test("turnCitationLines renders factsTouched through the phrase layer, appending an extraction caveat when the row carries one", () => {
  const lines = turnCitationLines([
    { subject: "zorblatt", predicate: "rdfs:subClassOf", object: "dog" },
    { subject: "tariff", predicate: "rdf:type", object: "tax", extraction: ["clause-fallback"] },
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /zorblatt.*dog/);
  assert.match(lines[1], /tariff.*tax.*\(read from a clause fragment\)/);
});

test("turnCitationLines answers an empty list for no rows, never throwing on null or undefined", () => {
  assert.deepEqual(turnCitationLines([]), []);
  assert.deepEqual(turnCitationLines(null), []);
  assert.deepEqual(turnCitationLines(undefined), []);
});

test("fetchCycle answers null before any cycle has run, then the finished marker once one has", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  assert.equal(await session.fetchCycle(), null, "no marker exists before any trigger has fired for this session");
  await session.enrich();
  const cycle = await session.fetchCycle();
  assert.equal(cycle.kind, "enrich");
  assert.match(cycle.state, /^done/);
  session.destroy();
});

test("a trigger's own onCycle callback is reported the cycle marker while its settle-wait runs", async () => {
  const { prefs } = memoryPrefs();
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), ...FAST_POLL });
  const markers = [];
  await session.ingestText("A ceasefire is a formal agreement to stop fighting.", { onCycle: (marker) => markers.push(marker) });
  assert.ok(markers.length > 0, "onCycle fired at least once during the wait");
  assert.ok(markers.every((m) => m === null || m.kind === "ingest"), `every reported marker belongs to this cycle: ${JSON.stringify(markers)}`);
  session.destroy();
});

test("enrich's fuzzy option rides the trigger body as an explicit 0 or 1, and is omitted entirely when not supplied", async () => {
  const { prefs } = memoryPrefs();
  const bodies = [];
  const spyFetch = async (path, init) => {
    if (String(path).includes("/enrich") && init?.method === "POST") bodies.push(JSON.parse(init.body));
    return fetchAgainst(service.url)(path, init);
  };
  const session = createNewsSession({ prefs, fetchImpl: spyFetch, ...FAST_POLL });
  await session.enrich({ fuzzy: true });
  await session.enrich({ fuzzy: false });
  await session.enrich();
  assert.deepEqual(bodies, [{ fuzzy: 1 }, { fuzzy: 0 }, {}]);
  session.destroy();
});

test("the standing watcher notices a feed change made outside its own presses and notifies onFeedUpdate with the fresh feed", async () => {
  const { prefs } = memoryPrefs();
  const key = randomUUID();
  prefs.set(NEWS_SESSION_PREF_KEY, key);
  prefs.set("tmct.news.started", "on");
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), versionPollMs: 15, versionPollStepMs: 15, versionPollMaxMs: 60 });

  const updates = [];
  session.onFeedUpdate((feed) => updates.push(feed));

  const response = await fetch(new URL(`/api/sessions/${key}/ingest`, service.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "A ceasefire is a formal agreement to stop fighting." }),
  });
  assert.equal(response.status, 202, "the trigger reached the service directly, never through this session object");
  await service.drainNewsWorkers();

  const deadline = Date.now() + 2000;
  while (!updates.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  session.destroy();

  assert.ok(updates.length > 0, "the standing loop picked up a change this session object never triggered itself");
  assert.ok(updates[0].stats.graphSize > 0, "the notified feed is the fresh one, not the empty starting document");
});

test("onFeedUpdate's own unsubscribe function stops that one listener without stopping the loop for any other", async () => {
  const { prefs } = memoryPrefs();
  const key = randomUUID();
  prefs.set(NEWS_SESSION_PREF_KEY, key);
  const session = createNewsSession({ prefs, fetchImpl: fetchAgainst(service.url), versionPollMs: 15, versionPollStepMs: 15, versionPollMaxMs: 60 });

  let unsubscribedCalls = 0;
  let stillSubscribedCalls = 0;
  const unsubscribe = session.onFeedUpdate(() => { unsubscribedCalls += 1; });
  session.onFeedUpdate(() => { stillSubscribedCalls += 1; });
  unsubscribe();

  await fetch(new URL(`/api/sessions/${key}/ingest`, service.url), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "A tariff is a tax on imported goods." }),
  });
  await service.drainNewsWorkers();

  const deadline = Date.now() + 2000;
  while (!stillSubscribedCalls && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  session.destroy();

  assert.equal(unsubscribedCalls, 0, "the unsubscribed listener never fires again");
  assert.ok(stillSubscribedCalls > 0, "the other listener still does");
});

test("the standing watcher backs off its feedVersion polling while idle and resets toward the floor the moment something changes", async () => {
  const { prefs } = memoryPrefs();
  const key = randomUUID();
  prefs.set(NEWS_SESSION_PREF_KEY, key);
  const versionReadAt = [];
  const spyFetch = async (path, init) => {
    if (String(path).includes("/api/meta/feedVersion")) versionReadAt.push(Date.now());
    return fetchAgainst(service.url)(path, init);
  };
  const session = createNewsSession({ prefs, fetchImpl: spyFetch, versionPollMs: 20, versionPollStepMs: 20, versionPollMaxMs: 100 });

  await new Promise((resolve) => setTimeout(resolve, 320));
  const idleGaps = versionReadAt.slice(1).map((t, i) => t - versionReadAt[i]);
  assert.ok(idleGaps.length >= 3, `enough idle ticks landed to compare gaps: ${JSON.stringify(idleGaps)}`);
  // Bounded between "never backed off" (every 20ms, ~16 reads in 320ms) and
  // "capped instantly" (every 100ms, ~3 reads) — a loop that actually backs
  // off lands somewhere in between, not pinned to either extreme.
  assert.ok(versionReadAt.length > 4 && versionReadAt.length < 12, `idle read count sits between the two extremes: ${versionReadAt.length}`);

  await fetch(new URL(`/api/sessions/${key}/ingest`, service.url), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "A widget is a small mechanical device." }),
  });
  await service.drainNewsWorkers();

  // A tick already pending from the idle backoff above can land anywhere
  // inside its own (backed-off) window before the loop notices the change
  // and resets — so wait for two post-change reads rather than a fixed
  // sleep, which would flake depending on exactly where in that window the
  // change happened to land.
  versionReadAt.length = 0;
  const afterChangeDeadline = Date.now() + 2000;
  while (versionReadAt.length < 2 && Date.now() < afterChangeDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
  session.destroy();
  assert.ok(versionReadAt.length >= 2, `reads continued after the outside change: ${versionReadAt.length}`);
  const gapAfterChange = versionReadAt[1] - versionReadAt[0];
  assert.ok(gapAfterChange < idleGaps[idleGaps.length - 1], `the interval reset toward the floor (${gapAfterChange}ms) rather than staying at its backed-off width (${idleGaps[idleGaps.length - 1]}ms)`);
});

test("destroy stops the standing watcher: no further reads after it's called", async () => {
  const { prefs } = memoryPrefs();
  const key = randomUUID();
  prefs.set(NEWS_SESSION_PREF_KEY, key);
  let reads = 0;
  const spyFetch = async (path, init) => {
    if (String(path).includes("/api/meta/feedVersion")) reads += 1;
    return fetchAgainst(service.url)(path, init);
  };
  const session = createNewsSession({ prefs, fetchImpl: spyFetch, versionPollMs: 15, versionPollStepMs: 15, versionPollMaxMs: 60 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  session.destroy();
  const readsAtDestroy = reads;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(reads, readsAtDestroy, "nothing polled again once destroy() stopped the loop");
});
