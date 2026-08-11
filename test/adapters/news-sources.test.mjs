// The news source registry and its fetch adapters: every fixture-driven
// format the shipped ten records use (rss, atom, jsonfeed, wikimedia-feed,
// hn, usgs, mediawiki), the registry helpers add-by-URL and config both
// lean on, and the add-by-URL preflight. Every test injects a fetchImpl stub
// reading the committed fixtures — zero live network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NEWS_SOURCE_RECORDS,
  DEFAULT_NEWS_SOURCE_IDS,
  DEFAULT_NEWS_KB_IDS,
  registerNewsSource,
  newsSourceRecords,
  normalizeNewsSourceIds,
  createNewsFetcher,
  preflightNewsUrl,
} from "../../src/adapters/corpus/news-sources.mjs";
import { DEFAULT_MIN_INTERVAL_MS } from "../../src/adapters/corpus/courtesy.mjs";

const FIXTURES = path.resolve(fileURLToPath(import.meta.url), "..", "..", "fixtures", "news");
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const readJson = (name) => JSON.parse(read(name));

const NOW = "2026-08-08T12:00:00.000Z";
const recordFor = (id) => NEWS_SOURCE_RECORDS.find((r) => r.id === id);

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function textResponse(text, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => text,
  };
}

// ---- the registry ----------------------------------------------------------

test("the shipped registry carries ten records: every news feed polls by default, and the kb defaults are the three lookup sources", () => {
  assert.equal(NEWS_SOURCE_RECORDS.length, 10);
  assert.deepEqual(
    [...DEFAULT_NEWS_SOURCE_IDS],
    ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"],
  );
  assert.deepEqual(
    NEWS_SOURCE_RECORDS.filter((r) => r.kind === "contemporary").map((r) => r.id),
    [...DEFAULT_NEWS_SOURCE_IDS],
    "the poll roster is every contemporary record the registry ships, none held back",
  );
  assert.deepEqual([...DEFAULT_NEWS_KB_IDS], ["simple-wikipedia", "wikidata", "wiktionary"]);
  for (const id of DEFAULT_NEWS_SOURCE_IDS) assert.equal(recordFor(id).enabledByDefault, true, id);
  for (const id of DEFAULT_NEWS_KB_IDS) assert.equal(recordFor(id).enabledByDefault, true, id);
  for (const record of NEWS_SOURCE_RECORDS) assert.ok(record.url.startsWith("https://"), `${record.id} is not https`);
});

test("no reference work is a poll target: every kb record stays out of the poll roster", () => {
  for (const record of NEWS_SOURCE_RECORDS.filter((r) => r.kind === "kb")) {
    assert.ok(!DEFAULT_NEWS_SOURCE_IDS.includes(record.id), `${record.id} is polled`);
  }
});

test("every non-Hacker-News record keeps the shared 2s courtesy floor; Hacker News alone runs lower", () => {
  assert.equal(recordFor("hacker-news").minIntervalMs, 250);
  assert.ok(recordFor("hacker-news").minIntervalMs < DEFAULT_MIN_INTERVAL_MS);
  for (const record of NEWS_SOURCE_RECORDS) {
    if (record.id === "hacker-news") continue;
    assert.equal(record.minIntervalMs, DEFAULT_MIN_INTERVAL_MS, record.id);
  }
});

test("registerNewsSource adds a record, and re-registering the same id replaces it", () => {
  const before = newsSourceRecords().length;
  registerNewsSource({ id: "test-added-source", name: "Test Source", kind: "contemporary", format: "rss", url: "https://example.com/feed.xml", enabledByDefault: false, minIntervalMs: 2000 });
  assert.equal(newsSourceRecords().length, before + 1);
  registerNewsSource({ id: "test-added-source", name: "Test Source Renamed", kind: "contemporary", format: "rss", url: "https://example.com/feed.xml", enabledByDefault: false, minIntervalMs: 2000 });
  assert.equal(newsSourceRecords().length, before + 1, "replacing an id does not grow the registry");
  assert.equal(newsSourceRecords().find((r) => r.id === "test-added-source").name, "Test Source Renamed");
});

test("registerNewsSource refuses a record with no string id", () => {
  assert.throws(() => registerNewsSource({ name: "no id" }));
  assert.throws(() => registerNewsSource(null));
});

test("normalizeNewsSourceIds drops unknown ids, dedupes, and preserves order", () => {
  assert.deepEqual(
    normalizeNewsSourceIds(["hacker-news", "not-a-real-source", "usgs-quakes", "hacker-news"]),
    ["hacker-news", "usgs-quakes"],
  );
  assert.deepEqual(normalizeNewsSourceIds([]), []);
  assert.deepEqual(normalizeNewsSourceIds(null), []);
  assert.deepEqual(normalizeNewsSourceIds("hacker-news"), [], "a non-array input is not iterated as characters");
});

// ---- rss / atom / jsonfeed --------------------------------------------------

test("rss: the nyt-world fixture parses into snapshots, an injected <script> stripped inert, bytes recorded", async () => {
  const nytRss = read("nyt-world.rss.xml");
  const fetchImpl = async (url) => {
    assert.equal(url, recordFor("nyt-world").url);
    return textResponse(nytRss);
  };
  const fetcher = createNewsFetcher(recordFor("nyt-world"), { fetchImpl, minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.ok(result);
  assert.equal(result.bytes, Buffer.byteLength(nytRss, "utf8"));
  assert.ok(result.items.length >= 3);
  const geneva = result.items.find((it) => it.url.includes("geneva-meeting"));
  assert.ok(geneva);
  assert.ok(!geneva.title.includes("<script>"), "the injection probe title is stripped inert");
  assert.equal(geneva.sourceId, "nyt-world");
  assert.equal(geneva.fetchedAt, NOW);
});

test("atom: a synthetic atom record parses the sample fixture, preferring the alternate link", async () => {
  const sampleAtom = read("sample.atom.xml");
  const record = { id: "test-atom", format: "atom", url: "https://example.com/feed.atom", minIntervalMs: 0 };
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => textResponse(sampleAtom), minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items.length, 3);
  const third = result.items.find((it) => it.url.includes("third-entry"));
  assert.equal(third.url, "https://example.com/articles/third-entry", "the alternate link wins over the self link listed first");
});

test("jsonfeed: the jsonfeed.org fixture parses both content_html and content_text items", async () => {
  const jsonfeedOrg = read("jsonfeed-org.json");
  const record = { id: "test-jsonfeed", format: "jsonfeed", url: "https://www.jsonfeed.org/feed.json", minIntervalMs: 0 };
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => textResponse(jsonfeedOrg), minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items.length, 2);
  assert.ok(result.items.some((it) => it.title === "Announcing JSON Feed 1.1"));
});

// ---- wikimedia-feed ---------------------------------------------------------

test("wikimedia-feed: the date is computed in UTC, mostread articles map to items, wikibaseItem carried for the Wikidata short-circuit", async () => {
  const body = readJson("wikimedia-featured.json");
  const record = recordFor("wikimedia-featured");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse(body);
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `${record.url}/2026/08/08`, "the request URL is the UTC calendar date, not a local one");
  assert.equal(result.items.length, 2);
  const ceasefire = result.items.find((it) => it.title === "Ceasefire negotiations");
  assert.ok(ceasefire);
  assert.equal(ceasefire.wikibaseItem, "Q1230635");
  assert.equal(ceasefire.summary, "Ceasefire negotiations are talks aimed at halting armed conflict between parties.");
});

test("wikimedia-feed: a 'news' key, when present, is read instead of mostread", async () => {
  const body = {
    news: [{ story: "A story", links: [
      { title: "Story_article", normalizedtitle: "Story article", extract: "A newsworthy extract.", wikibase_item: "Q42", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Story_article" } } },
    ] }],
    mostread: { articles: [{ title: "Should_not_appear", normalizedtitle: "Should not appear", extract: "x", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/x" } } }] },
  };
  const record = recordFor("wikimedia-featured");
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => jsonResponse(body), minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Story article");
});

test("wikimedia-feed: a 404 for today retries once against the previous UTC day before giving up", async () => {
  const body = readJson("wikimedia-featured.json");
  const record = recordFor("wikimedia-featured");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/2026/08/08")) return jsonResponse({}, { status: 404 });
    return jsonResponse(body);
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(calls.length, 2);
  assert.equal(calls[1], `${record.url}/2026/08/07`);
  assert.equal(result.items.length, 2, "the retry's body still yields items");
});

test("wikimedia-feed: both days failing reads as null", async () => {
  const record = recordFor("wikimedia-featured");
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => jsonResponse({}, { status: 404 }), minIntervalMs: 0, now: NOW });
  assert.equal(await fetcher.fetchItems(), null);
});

// ---- hn ---------------------------------------------------------------------

test("hn: topstories then item fetches map to snapshots, title only, url from the item, summary empty", async () => {
  const ids = readJson("hn-topstories.json");
  const items = readJson("hn-items.json");
  const record = recordFor("hacker-news");
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/topstories.json")) return jsonResponse(ids);
    const id = Number(u.match(/\/item\/(\d+)\.json$/)[1]);
    return jsonResponse(items.find((it) => it.id === id));
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items.length, 3);
  const showHn = result.items.find((it) => it.title.startsWith("Show HN"));
  assert.equal(showHn.summary, "");
  assert.equal(showHn.url, "https://example.com/show-hn-deterministic-parser");
});

test("hn: an item with no url falls back to the HN discussion link", async () => {
  const ids = [999];
  const record = recordFor("hacker-news");
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/topstories.json")) return jsonResponse(ids);
    return jsonResponse({ id: 999, title: "Ask HN: no url here", time: 1754640000 });
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items[0].url, "https://news.ycombinator.com/item?id=999");
});

test("hn: caps at 10 item fetches even when topstories lists more", async () => {
  const ids = Array.from({ length: 15 }, (_, i) => 41230000 + i);
  const record = recordFor("hacker-news");
  const itemCalls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/topstories.json")) return jsonResponse(ids);
    const id = Number(u.match(/\/item\/(\d+)\.json$/)[1]);
    itemCalls.push(id);
    return jsonResponse({ id, title: `Story ${id}`, url: `https://example.com/${id}` });
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(itemCalls.length, 10);
  assert.equal(result.items.length, 10);
  assert.deepEqual(itemCalls, ids.slice(0, 10));
});

test("hn: without overriding minIntervalMs, the record's own lower floor paces the sequential item fetches", async () => {
  const ids = readJson("hn-topstories.json");
  const items = readJson("hn-items.json");
  const record = recordFor("hacker-news");
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/topstories.json")) return jsonResponse(ids);
    const id = Number(u.match(/\/item\/(\d+)\.json$/)[1]);
    return jsonResponse(items.find((it) => it.id === id));
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, now: NOW }); // no minIntervalMs override
  const started = Date.now();
  const result = await fetcher.fetchItems();
  const elapsed = Date.now() - started;
  assert.equal(result.items.length, 3);
  // Three items, three slots (one shared with topstories.json's own slot
  // plus two more), so at least two gaps at the record's own 250ms floor.
  assert.ok(elapsed >= 2 * 250 - 30, `expected the record's 250ms floor to pace the item fetches, elapsed ${elapsed}ms`);
});

// ---- usgs ---------------------------------------------------------------------

test("usgs: a geojson feature becomes a sentence naming the place, its distance descriptor dropped and an injected place stripped inert", async () => {
  const body = readJson("usgs-quakes.geojson");
  body.features[0].properties.place = "68km SSW of <script>alert(1)</script> Kodiak, Alaska";
  const record = recordFor("usgs-quakes");
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => jsonResponse(body), minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items.length, 2);
  const first = result.items[0];
  assert.match(first.summary, /^An earthquake struck near /, "the summary carries a verb, so the recognizer has a sentence to read");
  assert.ok(!/68km SSW of/.test(first.summary), "the bearing and distance are a measurement, not the place's name");
  assert.ok(!first.summary.includes("<script>"));
  assert.equal(result.items[1].summary, "An earthquake struck near Ridgecrest, CA.");
  assert.equal(first.url, "https://earthquake.usgs.gov/earthquakes/eventpage/ak02abc123");
});

// ---- mediawiki (wikinews) ---------------------------------------------------

test("mediawiki: wikinews recentchanges map to snapshots with a built wiki URL", async () => {
  const body = readJson("wikinews-published.json");
  const record = recordFor("wikinews-published");
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => jsonResponse(body), minIntervalMs: 0, now: NOW });
  const result = await fetcher.fetchItems();
  assert.equal(result.items.length, 2);
  const ceasefire = result.items.find((it) => it.title.startsWith("Ceasefire talks"));
  assert.equal(ceasefire.url, "https://en.wikinews.org/wiki/Ceasefire_talks_resume_after_week-long_pause");
  assert.equal(ceasefire.publishedAt, "2026-08-08T06:40:00.000Z");
});

// ---- courtesy behaviour shared across every format --------------------------

test("a 429 opens a cool-off — the fetch reads as null", async () => {
  const record = recordFor("nyt-world");
  const fetcher = createNewsFetcher(record, {
    fetchImpl: async () => textResponse("", { status: 429, headers: { "retry-after": "60" } }),
    minIntervalMs: 0,
    now: NOW,
  });
  assert.equal(await fetcher.fetchItems(), null);
});

test("a dead transport reads as null, never a throw", async () => {
  const record = recordFor("usgs-quakes");
  const fetcher = createNewsFetcher(record, { fetchImpl: async () => { throw new Error("network down"); }, minIntervalMs: 0, now: NOW });
  assert.equal(await fetcher.fetchItems(), null);
});

test("an unrecognised record format reads as null", async () => {
  const fetcher = createNewsFetcher({ id: "test-unknown", format: "carrier-pigeon", url: "https://example.com/" }, { fetchImpl: async () => textResponse(""), minIntervalMs: 0, now: NOW });
  assert.equal(await fetcher.fetchItems(), null);
});

test("with a validators map, a stub 304 comes back notModified with the remembered validator headers sent, and never answers stale on a later real poll", async () => {
  const nytRss = read("nyt-world.rss.xml");
  const record = recordFor("nyt-world");
  const validators = new Map();
  const seenHeaders = [];
  let call = 0;
  const fetchImpl = async (url, opts = {}) => {
    seenHeaders.push(opts.headers);
    call += 1;
    if (call === 1) return textResponse(nytRss, { headers: { etag: '"v1"', "last-modified": "Sat, 08 Aug 2026 09:00:00 GMT" } });
    return textResponse("", { status: 304 });
  };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW, validators });

  const first = await fetcher.fetchItems();
  assert.ok(first.items.length > 0);

  const second = await fetcher.fetchItems();
  assert.deepEqual(second, { items: [], bytes: 0, notModified: true });
  assert.equal(seenHeaders[1]["If-None-Match"], '"v1"');
  assert.equal(seenHeaders[1]["If-Modified-Since"], "Sat, 08 Aug 2026 09:00:00 GMT");
});

test("a repeated poll on the same fetcher always re-fetches — the cache never answers a live source stale", async () => {
  const record = recordFor("usgs-quakes");
  const body = readJson("usgs-quakes.geojson");
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(body); };
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: 0, now: NOW });
  await fetcher.fetchItems();
  await fetcher.fetchItems();
  assert.equal(calls, 2, "the second poll re-fetched instead of answering from a cached body");
});

// ---- preflightNewsUrl --------------------------------------------------------

test("preflightNewsUrl refuses a non-https URL without a fetch", async () => {
  let called = false;
  const result = await preflightNewsUrl("http://example.com/feed.xml", { fetchImpl: async () => { called = true; return textResponse(""); } });
  assert.deepEqual(result, { ok: false, reason: "not-https" });
  assert.equal(called, false);
});

test("preflightNewsUrl classifies a thrown fetch as browser-blocked", async () => {
  const result = await preflightNewsUrl("https://example.com/feed.xml", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(result, { ok: false, reason: "browser-blocked" });
});

test("preflightNewsUrl classifies a non-feed 2xx response as no-feed", async () => {
  const result = await preflightNewsUrl("https://example.com/index.html", { fetchImpl: async () => textResponse("<html><body>not a feed</body></html>") });
  assert.deepEqual(result, { ok: false, reason: "no-feed" });
});

test("preflightNewsUrl classifies a non-ok response as no-feed", async () => {
  const result = await preflightNewsUrl("https://example.com/missing.xml", { fetchImpl: async () => textResponse("", { status: 404 }) });
  assert.deepEqual(result, { ok: false, reason: "no-feed" });
});

test("preflightNewsUrl detects a genuine feed and reports its format", async () => {
  const jsonfeedOrg = read("jsonfeed-org.json");
  const result = await preflightNewsUrl("https://www.jsonfeed.org/feed.json", { fetchImpl: async () => textResponse(jsonfeedOrg) });
  assert.deepEqual(result, { ok: true, format: "jsonfeed" });
});
