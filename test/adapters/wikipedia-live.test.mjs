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
  WIKIPEDIA_LIVE_ORIGIN,
} from "../../src/adapters/corpus/wikipedia-live.mjs";
import { isReferenceArticleRow } from "../../src/domain/reference-pack.mjs";

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
