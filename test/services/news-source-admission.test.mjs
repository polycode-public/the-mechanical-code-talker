// Every poll-capable source, driven end to end the way the worker drives it:
// a stub transport answers with the wire shape that source really returns, the
// registry's own fetcher turns it into snapshots, pollNewsSources grounds them,
// and the feed is built over what landed. What each test pins is admission —
// one realistic item from that source contributes at least one fact under its
// own news: tag — because a source whose items can never become a sentence
// polls "ok" for ever while the feed stays empty.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createNewsFetcher, NEWS_SOURCE_RECORDS } from "../../src/adapters/corpus/news-sources.mjs";
import { clampNewsConfig, createNewsState, pollNewsSources, buildFeed } from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { isNewsProvenance } from "../../src/domain/news-feed.mjs";
import { ledgerFromPayload } from "../../src/domain/term-ledger.mjs";

const NOW = "2026-08-08T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const recordFor = (id) => NEWS_SOURCE_RECORDS.find((r) => r.id === id);

const jsonResponse = (body) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const textResponse = (body) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => JSON.parse(body),
  text: async () => body,
});

// ---- the wire shapes, copied from what each source really answers with ------

const HN_IDS = [41234567];
const HN_ITEM = {
  id: 41234567, type: "story", by: "someone",
  title: "Mojo 1.0", url: "https://example.com/mojo", time: Math.floor(NOW_MS / 1000), score: 240,
};

const USGS_BODY = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    id: "us7000abcd",
    properties: {
      mag: 4.4,
      place: "25 km ENE of Wana, Pakistan",
      time: NOW_MS,
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
      title: "M 4.4 - 25 km ENE of Wana, Pakistan",
    },
    geometry: { type: "Point", coordinates: [70.1, 32.4, 35] },
  }],
};

const WIKIMEDIA_BODY = {
  news: [{
    story: "A cyclone crosses the Queensland coast.",
    links: [{
      title: "Anchorage", normalizedtitle: "Anchorage", displaytitle: "Anchorage",
      wikibase_item: "Q29104",
      extract: "Anchorage is the largest city in the U.S. state of Alaska by population.",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Anchorage" } },
    }],
  }],
};

const NYT_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>NYT &gt; World News</title>
<item>
  <title>Cyclone Batters the Coast of Eastern Australia</title>
  <link>https://www.nytimes.com/2026/08/08/world/australia/cyclone.html</link>
  <guid isPermaLink="true">https://www.nytimes.com/2026/08/08/world/australia/cyclone.html</guid>
  <description>The storm forced thousands of residents to leave their homes as rivers rose across Queensland.</description>
  <pubDate>Sat, 08 Aug 2026 12:00:00 +0000</pubDate>
</item>
</channel></rss>`;

const WIKINEWS_BODY = {
  batchcomplete: true,
  query: {
    recentchanges: [
      { type: "new", ns: 0, title: "Cyclone hits eastern Australia", pageid: 4823901, timestamp: NOW },
    ],
  },
};

function transportFor(sourceId) {
  return async (url) => {
    const u = String(url);
    if (sourceId === "hacker-news") {
      if (u.endsWith("/topstories.json")) return jsonResponse(HN_IDS);
      return jsonResponse(HN_ITEM);
    }
    if (sourceId === "usgs-quakes") return jsonResponse(USGS_BODY);
    if (sourceId === "wikimedia-featured") return jsonResponse(WIKIMEDIA_BODY);
    if (sourceId === "nyt-world") return textResponse(NYT_RSS);
    if (sourceId === "wikinews-published") return jsonResponse(WIKINEWS_BODY);
    throw new Error(`no stub transport for ${sourceId}`);
  };
}

/** One poll cycle over `sourceIds` against a fresh in-process store: real
 *  fetchers, real grounding, real feed build, zero network and zero disk. */
async function pollWith(sourceIds) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  const ctx = {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config: clampNewsConfig({ sources: sourceIds }),
    state: createNewsState(),
    providers: {
      newsFetchers: new Map(sourceIds.map((id) => [
        id,
        createNewsFetcher(recordFor(id), { fetchImpl: transportFor(id), minIntervalMs: 0, now: NOW }),
      ])),
    },
    now: () => NOW,
    notify: null,
  };
  const result = await pollNewsSources(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir));
  const feed = await buildFeed(ctx);
  await backend.close();
  return { ctx, result, rows, feed };
}

/** The same cycle as pollWith, run twice against one store — the re-poll every
 *  source gets when its feed has not moved on. */
async function pollTwiceWith(sourceIds) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  const ctx = {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config: clampNewsConfig({ sources: sourceIds }),
    state: createNewsState(),
    providers: {
      newsFetchers: new Map(sourceIds.map((id) => [
        id,
        createNewsFetcher(recordFor(id), { fetchImpl: transportFor(id), minIntervalMs: 0, now: NOW }),
      ])),
    },
    now: () => NOW,
    notify: null,
  };
  const reading = async () => {
    const rows = readFactRows(await loadMemory(ctx.memoryDir));
    const feed = await buildFeed(ctx);
    return {
      newsFactIds: rows.filter((row) => isNewsProvenance(row.provenance)).map((row) => row.id).sort(),
      cardIds: feed.items.map((item) => item.id).sort(),
    };
  };
  const first = await pollNewsSources(ctx);
  const afterFirst = await reading();
  const second = await pollNewsSources(ctx);
  const afterSecond = await reading();
  await backend.close();
  return { first, second, afterFirst, afterSecond };
}

const newsRowsFrom = (rows, sourceId) => rows.filter(
  (row) => isNewsProvenance(row.provenance) && String(row.provenance).includes(`news:${sourceId}@`),
);

// ---- one test per poll-capable source ---------------------------------------

test("a Hacker News headline admits a fact: the site's own sentence names the story", async () => {
  const { rows } = await pollWith(["hacker-news"]);
  const admitted = newsRowsFrom(rows, "hacker-news");
  assert.ok(admitted.length >= 1, "a story with no summary field still grounds through the site's own sentence");
  assert.deepEqual(
    admitted.map((r) => `${r.subject} ${r.predicate} ${r.object}`),
    ['hackernews mgx:discuss "mojo 1.0"'],
  );
});

test("a USGS quake admits a fact naming the place it struck, never the bearing", async () => {
  const { rows } = await pollWith(["usgs-quakes"]);
  const admitted = newsRowsFrom(rows, "usgs-quakes");
  assert.deepEqual(
    admitted.map((r) => `${r.subject} ${r.predicate} ${r.object}`),
    ["earthquake mgx:strike-near wana, pakistan"],
  );
});

test("a Wikimedia featured article admits a fact from its own lead sentence", async () => {
  const { rows } = await pollWith(["wikimedia-featured"]);
  const admitted = newsRowsFrom(rows, "wikimedia-featured");
  assert.ok(admitted.length >= 1);
  assert.ok(admitted.some((r) => r.subject === "anchorage"), "the article's subject reaches the graph");
});

test("an NYT world item admits a fact from its headline", async () => {
  const { rows } = await pollWith(["nyt-world"]);
  const admitted = newsRowsFrom(rows, "nyt-world");
  assert.ok(admitted.length >= 1);
  assert.ok(admitted.some((r) => r.subject === "cyclone"));
});

test("a Wikinews headline admits a fact on its own — the headline is already a sentence", async () => {
  const { rows } = await pollWith(["wikinews-published"]);
  const admitted = newsRowsFrom(rows, "wikinews-published");
  assert.deepEqual(
    admitted.map((r) => `${r.subject} ${r.predicate} ${r.object}`),
    ["cyclone mgx:hit eastern australia"],
  );
});

// ---- what the cycle as a whole produces -------------------------------------

test("one cycle over every poll-capable source ends with a fact from each and a card that speaks", async () => {
  const sourceIds = ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"];
  const { result, rows, feed } = await pollWith(sourceIds);

  assert.equal(result.failures, 0);
  for (const sourceId of sourceIds) {
    assert.ok(newsRowsFrom(rows, sourceId).length >= 1, `${sourceId} contributed no fact`);
  }
  assert.ok(result.facts >= sourceIds.length, `expected a fact per source, got ${result.facts}`);

  const quakePlace = feed.items.find((item) => item.hub === "wana, pakistan");
  assert.ok(quakePlace, "the place a quake struck heads a card");
  assert.equal(quakePlace.paragraph, "earthquake strikes near wana, pakistan.");
  for (const item of feed.items) {
    assert.ok(item.paragraph, `the card for ${item.hub} rendered nothing`);
  }
});

test("every source's own identifier survives a re-poll: the same feed twice mints nothing the second time", async () => {
  const sourceIds = ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"];
  for (const sourceId of sourceIds) {
    const { first, second, afterFirst, afterSecond } = await pollTwiceWith([sourceId]);
    assert.ok(first.newItems >= 1, `${sourceId} admitted nothing on the first poll`);
    assert.equal(second.newItems, 0, `${sourceId} read its own item as new a second time`);
    assert.equal(second.facts, 0, `${sourceId} admitted a fact twice`);
    assert.deepEqual(afterSecond.newsFactIds, afterFirst.newsFactIds, `${sourceId} duplicated a news fact`);
    assert.deepEqual(afterSecond.cardIds, afterFirst.cardIds, `${sourceId} duplicated a card`);
  }
});

test("no function word reaches the ledger, however often a polled item says one", async () => {
  const { ctx } = await pollWith(["wikimedia-featured", "nyt-world", "usgs-quakes"]);
  const ledger = ledgerFromPayload(ctx.state.ledger);
  for (const term of ["of", "in", "the", "and", "by", "near", "with", "to", "as", "from"]) {
    assert.ok(!ledger.terms.has(term), `"${term}" scaffolds a sentence; it never names what one is about`);
  }
  assert.ok(ledger.terms.size > 0, "the ledger still admits the real terms an item leaves ungrounded");
});
