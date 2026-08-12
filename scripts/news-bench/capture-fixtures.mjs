#!/usr/bin/env node
// scripts/news-bench/capture-fixtures.mjs — the ONLY file in this bench that
// touches the network. Runs each of the five contemporary sources' own real
// fetcher (createNewsFetcher, the exact adapter the product polls with)
// against a real fetchImpl, records every wire call it made, trims each call
// to the fields that source's own fetcher actually reads, and writes the
// result to test/fixtures/news-feeds/<source>/<yyyy-mm-dd>.json.
//
// A re-run on the same UTC date overwrites that date's file only; every
// earlier date stays on disk, so the fixture set is append-only across days.
// The bench itself (run.mjs) never imports this file and never runs it —
// it only reads what this script already wrote.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NEWS_SOURCE_RECORDS, createNewsFetcher } from "../../src/adapters/corpus/news-sources.mjs";
import { FIXTURES_DIR, FIXTURE_SOURCE_IDS, sourceDir } from "./fixtures.mjs";

const recordFor = (id) => NEWS_SOURCE_RECORDS.find((r) => r.id === id);

/** Wraps the real global fetch and remembers every {url, status, bodyText}
 *  it saw, in call order — the raw material every per-source trim function
 *  below narrows to what its fetcher actually reads. */
function createRecordingFetch() {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const res = await globalThis.fetch(url, opts);
    let bodyText = "";
    try { bodyText = await res.text(); } catch { bodyText = ""; }
    calls.push({ url: String(url), status: res.status, bodyText });
    return {
      ok: res.ok, status: res.status,
      headers: { get: (name) => res.headers.get(name) },
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    };
  };
  return { fetchImpl, calls };
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------------------------------------------------------------------------
// per-source trims — one function per format, each narrowing a raw {url,
// status, bodyText} to exactly the fields news-sources.mjs's own fetcher for
// that format reads (its module comment cites the read site for every one).
// ---------------------------------------------------------------------------

function trimPassthroughFailure(call) {
  return { url: call.url, status: call.status, kind: "json", body: null };
}

/** hacker-news: topstories.json (an id array, narrowed to the ids the
 *  fetcher actually went on to request — fetchHackerNews's own
 *  `ids.slice(0, HACKER_NEWS_ITEM_CAP)`), then one item/<id>.json per id,
 *  each narrowed to {id, title, url, time} (fetchHackerNews reads exactly
 *  those four). */
function trimHackerNews(calls) {
  const topCall = calls.find((c) => c.url.endsWith("/topstories.json"));
  const itemCalls = calls.filter((c) => /\/item\/\d+\.json$/.test(c.url));
  const requestedIds = new Set(itemCalls.map((c) => Number(c.url.match(/\/item\/(\d+)\.json$/)[1])));

  const trimmed = [];
  if (topCall) {
    const ids = topCall.status >= 200 && topCall.status < 300 ? safeJsonParse(topCall.bodyText) : null;
    const kept = Array.isArray(ids) ? ids.filter((id) => requestedIds.has(id)) : [];
    trimmed.push({ url: topCall.url, status: topCall.status, kind: "json", body: kept });
  }
  for (const call of itemCalls) {
    if (call.status < 200 || call.status >= 300) { trimmed.push(trimPassthroughFailure(call)); continue; }
    const item = safeJsonParse(call.bodyText);
    const body = item ? { id: item.id, title: item.title, url: item.url, time: item.time } : null;
    trimmed.push({ url: call.url, status: call.status, kind: "json", body });
  }
  return trimmed;
}

/** usgs-quakes: the GeoJSON FeatureCollection, each feature narrowed to
 *  {id, properties: {detail, url, title, place, time}} (fetchUsgs's own read
 *  site) — geometry and every other property dropped. */
function trimUsgs(calls) {
  return calls.map((call) => {
    if (call.status < 200 || call.status >= 300) return trimPassthroughFailure(call);
    const body = safeJsonParse(call.bodyText);
    const features = Array.isArray(body?.features) ? body.features : [];
    const trimmedBody = {
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature",
        id: f?.id ?? "",
        properties: {
          detail: f?.properties?.detail ?? "",
          url: f?.properties?.url ?? "",
          title: f?.properties?.title ?? "",
          place: f?.properties?.place ?? "",
          time: f?.properties?.time ?? null,
        },
      })),
    };
    return { url: call.url, status: call.status, kind: "json", body: trimmedBody };
  });
}

function trimWikimediaLink(a) {
  return {
    title: a?.title ?? "",
    normalizedtitle: a?.normalizedtitle ?? "",
    displaytitle: a?.displaytitle ?? "",
    wikibase_item: a?.wikibase_item ?? "",
    extract: a?.extract ?? "",
    content_urls: a?.content_urls?.desktop?.page ? { desktop: { page: a.content_urls.desktop.page } } : undefined,
  };
}

/** wikimedia-featured: the day's featured-feed body, `news[].links[]` and
 *  the `mostread.articles[]` fallback each narrowed to the six fields
 *  fetchWikimediaFeed reads. A 404 (the day's page not yet published) is
 *  kept as a failing call so the replay exercises the real retry-to-
 *  previous-day path the same way the live fetcher does. */
function trimWikimedia(calls) {
  return calls.map((call) => {
    if (call.status < 200 || call.status >= 300) return trimPassthroughFailure(call);
    const body = safeJsonParse(call.bodyText);
    const trimmedBody = {};
    if (Array.isArray(body?.news)) {
      trimmedBody.news = body.news.map((story) => ({ links: (story?.links ?? []).map(trimWikimediaLink) }));
    }
    if (Array.isArray(body?.mostread?.articles)) {
      trimmedBody.mostread = { articles: body.mostread.articles.map(trimWikimediaLink) };
    }
    return { url: call.url, status: call.status, kind: "json", body: trimmedBody };
  });
}

/** wikinews-published: the recentchanges body, narrowed to the three fields
 *  fetchWikinews reads off each entry (`type`/`ns` kept too — they are how
 *  the query itself is scoped, cheap to keep and useful to a reader). */
function trimWikinews(calls) {
  return calls.map((call) => {
    if (call.status < 200 || call.status >= 300) return trimPassthroughFailure(call);
    const body = safeJsonParse(call.bodyText);
    const changes = Array.isArray(body?.query?.recentchanges) ? body.query.recentchanges : [];
    const trimmedBody = {
      batchcomplete: true,
      query: {
        recentchanges: changes.map((c) => ({
          type: c?.type ?? "new", ns: c?.ns ?? 0, title: c?.title ?? "", pageid: c?.pageid ?? 0, timestamp: c?.timestamp ?? "",
        })),
      },
    };
    return { url: call.url, status: call.status, kind: "json", body: trimmedBody };
  });
}

const RSS_ITEM_FIELDS = ["title", "link", "guid", "description", "pubDate"];

function firstTagContent(block, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return match ? match[1] : "";
}

/** nyt-world (rss): reconstructs a minimal RSS 2.0 document carrying only
 *  the five fields parseRss itself reads off each `<item>` — no thumbnail,
 *  category or byline markup survives, whatever the live feed adds. */
function trimRssText(xmlText) {
  const channelTitle = firstTagContent(xmlText, "title");
  const itemBlocks = [...xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const items = itemBlocks.map((block) => {
    const fields = RSS_ITEM_FIELDS.map((tag) => `  <${tag}>${firstTagContent(block, tag)}</${tag}>`).join("\n");
    return `<item>\n${fields}\n</item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${channelTitle}</title>\n${items}\n</channel></rss>`;
}

function trimNytWorld(calls) {
  return calls.map((call) => {
    if (call.status < 200 || call.status >= 300) return { url: call.url, status: call.status, kind: "text", body: "" };
    return { url: call.url, status: call.status, kind: "text", body: trimRssText(call.bodyText) };
  });
}

const TRIMMERS = Object.freeze({
  "hacker-news": trimHackerNews,
  "usgs-quakes": trimUsgs,
  "wikimedia-featured": trimWikimedia,
  "wikinews-published": trimWikinews,
  "nyt-world": trimNytWorld,
});

// ---------------------------------------------------------------------------
// one source
// ---------------------------------------------------------------------------

async function captureSource(sourceId, { now }) {
  const record = recordFor(sourceId);
  if (!record) throw new Error(`news-bench: unknown source "${sourceId}"`);
  const trim = TRIMMERS[sourceId];
  if (!trim) throw new Error(`news-bench: no capture trimmer wired for "${sourceId}"`);

  const { fetchImpl, calls } = createRecordingFetch();
  const fetcher = createNewsFetcher(record, { fetchImpl, minIntervalMs: record.minIntervalMs, now });
  const result = await fetcher.fetchItems();

  const trimmedCalls = trim(calls);
  const fixture = {
    sourceId,
    capturedAt: now,
    originUrl: record.url,
    licence: record.licence,
    calls: trimmedCalls,
  };

  const dir = sourceDir(sourceId);
  mkdirSync(dir, { recursive: true });
  const date = now.slice(0, 10);
  const path = join(dir, `${date}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  return {
    sourceId, path, calls: trimmedCalls.length,
    items: result?.items?.length ?? 0,
    bytes: Buffer.byteLength(JSON.stringify(fixture)),
  };
}

const NOTICE_TEXT = `# test/fixtures/news-feeds — captured live source payloads

Every file under a source's own directory here is a dated, trimmed capture
of that source's real wire payload, recorded by
\`scripts/news-bench/capture-fixtures.mjs\` — the only script in this repo
that fetches these URLs over the network. A capture keeps only what that
source's own fetcher in \`src/adapters/corpus/news-sources.mjs\` actually
reads: titles, summaries or extracts, ids, timestamps and the handful of
structural fields each wire format needs to parse at all. No capture ever
stores a full article body.

## Sources

| source | origin | licence |
| --- | --- | --- |
| wikimedia-featured | https://api.wikimedia.org/feed/v1/wikipedia/en/featured | CC BY-SA 4.0 |
| hacker-news | https://hacker-news.firebaseio.com/v0 | user-submitted, discussion linked |
| usgs-quakes | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson | US public domain |
| nyt-world | https://rss.nytimes.com/services/xml/rss/nyt/World.xml | personal use with attribution |
| wikinews-published | https://en.wikinews.org/w/api.php | CC BY 2.5 |

## Layout

\`test/fixtures/news-feeds/<source>/<yyyy-mm-dd>.json\` — one file per source
per UTC capture date. A re-run on the same date overwrites that date's file
only; every earlier date stays on disk, so the set grows append-only across
capture runs. \`scripts/news-bench/run.mjs\` reads these files; nothing here
is ever fetched at bench time.
`;

async function main() {
  const args = process.argv.slice(2);
  const sourcesArg = args.find((a) => a.startsWith("--sources="))?.slice("--sources=".length);
  const nowArg = args.find((a) => a.startsWith("--now="))?.slice("--now=".length);
  const sourceIds = sourcesArg ? sourcesArg.split(",").map((s) => s.trim()).filter(Boolean) : FIXTURE_SOURCE_IDS;
  const now = nowArg || new Date().toISOString();

  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(join(FIXTURES_DIR, "NOTICE.md"), NOTICE_TEXT);

  const results = [];
  for (const sourceId of sourceIds) {
    process.stdout.write(`capturing ${sourceId}...\n`);
    const result = await captureSource(sourceId, { now });
    results.push(result);
    process.stdout.write(`  ${result.items} item(s), ${result.calls} call(s) captured, ${result.bytes} bytes -> ${result.path}\n`);
  }

  process.stdout.write(`\ncaptured ${results.length} source(s) dated ${now.slice(0, 10)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(`news-bench: capture-fixtures failed: ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
