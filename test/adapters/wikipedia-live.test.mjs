// The live Wikipedia lookup adapter: two GET round trips (opensearch title
// match, then the REST page summary) mapped into the shipped reference pack's
// own article-row shape — with courtesy built in structurally. Every network
// or shape failure reads as null; the cache keeps hits AND settled misses so
// a term never costs a second round trip; the throttle and the 429 cool-off
// keep the client polite without any caller cooperation.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createWikipediaLiveProvider,
  registerLiveReferenceProvider,
  getLiveReferenceProvider,
  registerResearchProvider,
  getResearchProvider,
  createSimpleWikipediaResearchSource,
  WIKIPEDIA_LIVE_ORIGIN,
  SIMPLE_WIKIPEDIA_ORIGIN,
  WIKIMEDIA_USER_AGENT,
  WIKIPEDIA_SOURCE_LABEL,
  SIMPLE_WIKIPEDIA_SOURCE_LABEL,
} from "../../src/adapters/corpus/wikipedia-live.mjs";
import { isReferenceArticleRow } from "../../src/domain/reference-pack.mjs";
// Side-effect import: registers the "wikidata" research source so
// getResearchProvider({ source: "wikidata" }) has an entry to build.
import "../../src/adapters/corpus/wikidata-live.mjs";

const QUASAR_EXTRACT = "A quasar is a very bright object in space. It is powered by a black hole. "
  + "Quasars are among the most distant objects known.";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** A canned two-round-trip Wikipedia: opensearch then summary, recording every
 *  URL it is asked for. */
function cannedWikipedia({ titles = ["Quasar"], summary } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("action=opensearch")) {
      return jsonResponse(["quasar", titles, titles.map(() => ""), titles.map(() => "")]);
    }
    return jsonResponse(summary ?? {
      title: "Quasar",
      extract: QUASAR_EXTRACT,
      revision: "1234567",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quasar" } },
    });
  };
  return { calls, fetchImpl };
}

test("a matching title maps both round trips into a valid article row, cors-tagged and title-encoded", async () => {
  const { calls, fetchImpl } = cannedWikipedia({ titles: ["Quasar"] });
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("quasar");

  assert.ok(row, "the lookup resolves to a row");
  assert.ok(isReferenceArticleRow(row), "the row passes the shared shape validator");
  assert.equal(row.term, "quasar");
  assert.equal(row.title, "Quasar");
  assert.equal(row.revid, 1234567);
  assert.equal(row.url, "https://en.wikipedia.org/wiki/Quasar");
  assert.equal(row.summary, "A quasar is a very bright object in space. It is powered by a black hole. Quasars are among the most distant objects known.");
  assert.equal(calls.length, 2, "exactly two round trips");
  assert.ok(calls[0].startsWith(`${WIKIPEDIA_LIVE_ORIGIN}/w/api.php?action=opensearch`), "round trip 1 is the opensearch");
  assert.ok(calls[0].includes("origin=*"), "the opensearch carries the CORS origin=* parameter");
  assert.ok(calls[0].includes("search=quasar"), "the opensearch searches the key");
  assert.equal(calls[1], `${WIKIPEDIA_LIVE_ORIGIN}/api/rest_v1/page/summary/Quasar`, "round trip 2 is the REST summary for the matched title");
});

test("a spaced title is underscore-joined and percent-encoded in the summary URL", async () => {
  const { calls, fetchImpl } = cannedWikipedia({
    titles: ["Polar bear"],
    summary: {
      title: "Polar bear",
      extract: "The polar bear is a large bear. It lives in the Arctic.",
      revision: "42",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Polar_bear" } },
    },
  });
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("polar bear");
  assert.ok(row);
  assert.equal(calls[1], `${WIKIPEDIA_LIVE_ORIGIN}/api/rest_v1/page/summary/Polar_bear`);
});

test("the drift guard rejects a first suggestion about something else, without spending the summary round trip", async () => {
  const { calls, fetchImpl } = cannedWikipedia({ titles: ["Banana split", "Banana bread"] });
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  assert.equal(await provider.lookup("quasar"), null);
  assert.equal(calls.length, 1, "no summary fetch after the title mismatch");
});

test("a 404 summary reads as null, and the null is cached — the second ask costs zero fetches", async () => {
  const calls = [];
  const notFound = async (url) => {
    calls.push(String(url));
    if (String(url).includes("action=opensearch")) return jsonResponse(["quasar", ["Quasar"], [""], [""]]);
    return jsonResponse({}, { status: 404 });
  };
  const provider = createWikipediaLiveProvider({ fetchImpl: notFound, minIntervalMs: 0 });
  assert.equal(await provider.lookup("quasar"), null);
  const spent = calls.length;
  assert.equal(await provider.lookup("quasar"), null);
  assert.equal(calls.length, spent, "the cached null answers without another round trip");
});

test("a cached hit answers without another round trip too", async () => {
  const { calls, fetchImpl } = cannedWikipedia({});
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const first = await provider.lookup("quasar");
  assert.ok(first);
  assert.equal(calls.length, 2);
  const second = await provider.lookup("quasar");
  assert.equal(second, first);
  assert.equal(calls.length, 2, "the cache served the repeat");
});

test("a malformed opensearch body reads as null", async () => {
  const provider = createWikipediaLiveProvider({
    fetchImpl: async () => jsonResponse({ not: "an opensearch tuple" }),
    minIntervalMs: 0,
  });
  assert.equal(await provider.lookup("quasar"), null);
});

test("a summary missing its revision fails the row validator and reads as null", async () => {
  const { fetchImpl } = cannedWikipedia({
    summary: { title: "Quasar", extract: QUASAR_EXTRACT, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quasar" } } },
  });
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  assert.equal(await provider.lookup("quasar"), null);
});

test("a fetch that never settles is aborted by the timeout and reads as null", async () => {
  const provider = createWikipediaLiveProvider({
    fetchImpl: (url, { signal } = {}) => new Promise((resolve, reject) => {
      if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    timeoutMs: 20,
    minIntervalMs: 0,
  });
  assert.equal(await provider.lookup("quasar"), null);
});

test("the throttle answers null for a second key inside the minimum interval, spending zero fetches on it", async () => {
  const { calls, fetchImpl } = cannedWikipedia({});
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 60_000 });
  assert.ok(await provider.lookup("quasar"), "the first lookup goes through");
  const spent = calls.length;
  assert.equal(await provider.lookup("pulsar"), null, "the second key is throttled");
  assert.equal(calls.length, spent, "the throttled lookup never touched the network");
});

test("a 429 opens a cool-off honouring Retry-After, and later lookups stay null with zero fetches until it passes", async () => {
  const calls = [];
  const rateLimited = async (url) => {
    calls.push(String(url));
    return jsonResponse({}, { status: 429, headers: { "retry-after": "120" } });
  };
  const provider = createWikipediaLiveProvider({ fetchImpl: rateLimited, minIntervalMs: 0 });
  assert.equal(await provider.lookup("quasar"), null);
  assert.equal(calls.length, 1);
  assert.equal(await provider.lookup("pulsar"), null, "the cool-off holds for a different key");
  assert.equal(calls.length, 1, "no fetch during the cool-off");
});

test("every request identifies the client: Api-User-Agent always, User-Agent too outside a browser", async () => {
  const seenHeaders = [];
  const fetchImpl = async (url, opts = {}) => {
    seenHeaders.push(opts.headers || {});
    if (String(url).includes("action=opensearch")) return jsonResponse(["quasar", ["Quasar"], [""], [""]]);
    return jsonResponse({ title: "Quasar", extract: QUASAR_EXTRACT, revision: "1", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quasar" } } });
  };
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  await provider.lookup("quasar");
  assert.equal(seenHeaders.length, 2);
  for (const headers of seenHeaders) {
    assert.equal(headers["Api-User-Agent"], WIKIMEDIA_USER_AGENT);
    assert.equal(headers["User-Agent"], WIKIMEDIA_USER_AGENT, "Node sends the real header too");
  }
  assert.match(WIKIMEDIA_USER_AGENT, /https:\/\//, "the string carries a public contact URL");
});

test("the opensearch round trip carries maxlag, and a maxlag error body opens a cool-off like a 429", async () => {
  const calls = [];
  const lagged = async (url) => {
    calls.push(String(url));
    return jsonResponse({ error: { code: "maxlag", info: "Waiting for a database server" } }, {
      headers: { "retry-after": "7" },
    });
  };
  const provider = createWikipediaLiveProvider({ fetchImpl: lagged, minIntervalMs: 0 });
  assert.equal(await provider.lookup("quasar"), null);
  assert.match(calls[0], /maxlag=5/, "the action-API request asks to be rejected under replica lag");
  assert.equal(await provider.lookup("pulsar"), null, "the cool-off holds for a different key");
  assert.equal(calls.length, 1, "no fetch during the maxlag cool-off");
});

test("pageByTitle fetches an exact title's summary in ONE round trip, and caches it", async () => {
  const { calls, fetchImpl } = cannedWikipedia({});
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.pageByTitle("Quasar");
  assert.ok(isReferenceArticleRow(row));
  assert.equal(row.term, "quasar", "the row keys on the folded title");
  assert.equal(calls.length, 1, "no opensearch for an exact title");
  assert.equal(calls[0], `${WIKIPEDIA_LIVE_ORIGIN}/api/rest_v1/page/summary/Quasar`);
  await provider.pageByTitle("Quasar");
  assert.equal(calls.length, 1, "the cache served the repeat");
});

test("linkedTitles lists the lead section's namespace-0 links in document order, deduplicated and capped", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      parse: {
        links: [
          { ns: 0, exists: true, title: "Black hole" },
          { ns: 10, exists: true, title: "Template:Astronomy" },
          { ns: 0, exists: false, title: "Red page" },
          { ns: 0, exists: true, title: "Galaxy" },
          { ns: 0, exists: true, title: "black hole" },
          { ns: 0, exists: true, title: "Light" },
        ],
      },
    });
  };
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const titles = await provider.linkedTitles("Quasar", { limit: 2 });
  assert.deepEqual(titles, ["Black hole", "Galaxy"], "namespace 0, existing, deduplicated, document order, capped");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /action=parse/);
  assert.match(calls[0], /section=0/, "lead section only — the smallest relevance-ordered payload");
  assert.match(calls[0], /maxlag=5/);
  const again = await provider.linkedTitles("Quasar", { limit: 4 });
  assert.equal(calls.length, 1, "the full link list is cached; a wider cap re-slices it");
  assert.deepEqual(again, ["Black hole", "Galaxy", "Light"]);
});

test("waitForSlot waits out the minimum interval instead of answering null", async () => {
  const { calls, fetchImpl } = cannedWikipedia({});
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 120, waitForSlot: true });
  const started = Date.now();
  assert.ok(await provider.lookup("quasar"), "the first lookup goes straight through");
  const spent = calls.length;
  const second = await provider.pageByTitle("Pulsar");
  assert.ok(Date.now() - started >= 120, "the second call waited for its slot");
  assert.ok(calls.length > spent, "…and then really fetched");
  assert.equal(second === null, false);
});

test("registerResearchProvider swaps the research provider; the default targets simple.wikipedia.org and exposes the fan-out reads", async () => {
  const stub = { lookup: async () => null };
  try {
    registerResearchProvider(stub);
    assert.equal(getResearchProvider(), stub);
  } finally {
    registerResearchProvider(null);
  }
  const restored = getResearchProvider();
  assert.notEqual(restored, stub);
  assert.equal(typeof restored.lookup, "function");
  assert.equal(typeof restored.pageByTitle, "function");
  assert.equal(typeof restored.linkedTitles, "function");
  assert.ok(SIMPLE_WIKIPEDIA_ORIGIN.includes("simple.wikipedia.org"));
});

test("getResearchProvider({source}) picks the config-selected research source, caching one singleton per choice; a registered provider still wins over both", async () => {
  const wikidata = getResearchProvider({ source: "wikidata" });
  assert.equal(wikidata.name, "wikidata");
  assert.equal(wikidata.origin, "https://www.wikidata.org");

  const wikipediaExplicit = getResearchProvider({ source: "wikipedia" });
  const wikipediaDefault = getResearchProvider();
  assert.equal(wikipediaExplicit.name, "simple-wikipedia");
  assert.equal(wikipediaExplicit, wikipediaDefault, "the wikipedia choice and the no-argument call share the same default singleton");

  assert.equal(getResearchProvider({ source: "wikidata" }), wikidata, "the same choice returns the same cached instance");

  const stub = { lookup: async () => null };
  try {
    registerResearchProvider(stub);
    assert.equal(getResearchProvider({ source: "wikidata" }), stub, "a registered provider wins outright, before any source resolution");
  } finally {
    registerResearchProvider(null);
  }
});

test("each source carries the name it goes by in prose, and reports what its fetches cost and hit", async () => {
  const live = createWikipediaLiveProvider({ fetchImpl: async () => { throw new Error("no network in tests"); }, minIntervalMs: 0 });
  assert.equal(live.label, WIKIPEDIA_SOURCE_LABEL);
  assert.equal(createSimpleWikipediaResearchSource({ minIntervalMs: 0 }).label, SIMPLE_WIKIPEDIA_SOURCE_LABEL);

  assert.deepEqual(
    { fetches: live.stats().fetches, systemicFailures: live.stats().systemicFailures },
    { fetches: 0, systemicFailures: 0 },
  );
  assert.equal(await live.lookup("quasar"), null);
  assert.equal(live.stats().systemicFailures, 1, "a dead transport says the source is struggling");
});

test("registerLiveReferenceProvider swaps the active provider, and null restores the default", async () => {
  const stub = { lookup: async () => null };
  try {
    registerLiveReferenceProvider(stub);
    assert.equal(getLiveReferenceProvider(), stub);
  } finally {
    registerLiveReferenceProvider(null);
  }
  const restored = getLiveReferenceProvider();
  assert.notEqual(restored, stub);
  assert.equal(typeof restored.lookup, "function");
});
