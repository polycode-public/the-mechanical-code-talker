// corpus/news-sources.mjs — the news source registry and fetch adapters
// (PLAN_NEWS_FEED.md section 9.2): the ten browser-verified sources from the
// probe rounds (section 4), one fetcher per wire format, each behind its own
// courtesy gate. Every URL is https; every fetch failure of any kind reads as
// null, never a throw; every fetched string passes stripMarkup before it
// leaves this module — the second half of the two-layer sanitisation rule
// (escapeHtml at render time) is the caller's job.
//
// A poll cycle must see a FRESH feed every time it asks, never a cached one —
// unlike a term lookup, where the same answer forever is exactly right. So
// every network call here goes through `gate.cachedFetch(url, work, {
// remember: false })`: still slot-gated (the courtesy pacing a repeated or
// multi-step fetch needs — Hacker News's ten sequential item fetches are the
// reason this matters, section 4's "10 × 250ms" arithmetic only holds if each
// one really waits for its own slot) but never cached, so a second poll
// always re-fetches.
//
// No node builtins — this module ships in the browser bundle unchanged; the
// only I/O is fetch.

import { detectFeedFormat, parseFeed, normalizeFeedItems, feedItemId, stripMarkup } from "../../domain/feed-normalize.mjs";
import { createCourtesyGate, DEFAULT_TIMEOUT_MS, DEFAULT_MIN_INTERVAL_MS } from "./courtesy.mjs";

export const NEWS_USER_AGENT = "the-mechanical-code-talker (+https://tmct.polycode.co.uk/)";

// Hacker News's Firebase-backed API tolerates a much faster anonymous poll
// than an RSS host does (PLAN_NEWS_FEED.md section 4); every other source
// keeps the shared DEFAULT_MIN_INTERVAL_MS floor.
const HACKER_NEWS_MIN_INTERVAL_MS = 250;
const HACKER_NEWS_ITEM_CAP = 10;

/** The ten browser-verified sources from the probe rounds (section 4.1 and
 *  4.2): five contemporary news feeds, every one of them polled by default
 *  (Wikimedia featured, Hacker News, USGS quakes, NYT World, Wikinews); three
 *  knowledge-base defaults (Simple English Wikipedia, Wikidata, Wiktionary),
 *  two knowledge-base selectables (DBpedia Lookup, English Wikipedia). The
 *  `kind: "kb"` records describe the knowledge-base sources for the
 *  registry/config/health surfaces; their actual lookups run through the
 *  existing research-source seam (getResearchProvider in wikipedia-live.mjs),
 *  not through createNewsFetcher below — a knowledge-base source is a
 *  targeted term lookup, not a feed to poll, so an enabled kb record arms
 *  enrichment and never adds a poll target. */
export const NEWS_SOURCE_RECORDS = Object.freeze([
  {
    id: "wikimedia-featured",
    name: "Wikimedia featured feed",
    kind: "contemporary",
    format: "wikimedia-feed",
    url: "https://api.wikimedia.org/feed/v1/wikipedia/en/featured",
    homepage: "https://www.wikipedia.org/",
    licence: "CC BY-SA 4.0",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    kind: "contemporary",
    format: "hn",
    url: "https://hacker-news.firebaseio.com/v0",
    homepage: "https://news.ycombinator.com/",
    licence: "user-submitted, discussion linked",
    browserVerified: "2026-08-08",
    minIntervalMs: HACKER_NEWS_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "usgs-quakes",
    name: "USGS earthquakes",
    kind: "contemporary",
    format: "usgs",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    homepage: "https://earthquake.usgs.gov/",
    licence: "US public domain",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "nyt-world",
    name: "NYT World News",
    kind: "contemporary",
    format: "rss",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    homepage: "https://www.nytimes.com/section/world",
    licence: "personal use with attribution",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "wikinews-published",
    name: "Wikinews",
    kind: "contemporary",
    format: "mediawiki",
    url: "https://en.wikinews.org/w/api.php",
    homepage: "https://en.wikinews.org/",
    licence: "CC BY 2.5",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    // Wikinews' own lead story announces the Wikimedia Foundation closing
    // it; its health row is what tells users the day it goes.
    enabledByDefault: true,
  },
  {
    id: "simple-wikipedia",
    name: "Simple English Wikipedia",
    kind: "kb",
    format: "wikipedia-summary",
    url: "https://simple.wikipedia.org",
    homepage: "https://simple.wikipedia.org/",
    licence: "CC BY-SA 4.0",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "wikidata",
    name: "Wikidata",
    kind: "kb",
    format: "wikidata",
    url: "https://www.wikidata.org",
    homepage: "https://www.wikidata.org/",
    licence: "CC0 1.0",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "wiktionary",
    name: "Wiktionary",
    kind: "kb",
    format: "wiktionary",
    url: "https://en.wiktionary.org",
    homepage: "https://en.wiktionary.org/",
    licence: "CC BY-SA 3.0",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: true,
  },
  {
    id: "dbpedia-lookup",
    name: "DBpedia Lookup",
    kind: "kb",
    format: "dbpedia-lookup",
    url: "https://lookup.dbpedia.org",
    homepage: "https://www.dbpedia.org/",
    licence: "CC BY-SA 3.0",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: false,
  },
  {
    id: "english-wikipedia",
    name: "English Wikipedia",
    kind: "kb",
    format: "wikipedia-summary",
    url: "https://en.wikipedia.org",
    homepage: "https://en.wikipedia.org/",
    licence: "CC BY-SA 4.0",
    browserVerified: "2026-08-08",
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    enabledByDefault: false,
  },
]);

/** The poll roster a fresh session starts with: news feeds only. */
export const DEFAULT_NEWS_SOURCE_IDS = Object.freeze([
  "wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published",
]);
/** The lookup roster enrichment walks when a term will not ground. These are
 *  reference works, never polled for news. */
export const DEFAULT_NEWS_KB_IDS = Object.freeze(["simple-wikipedia", "wikidata", "wiktionary"]);

const registry = new Map(NEWS_SOURCE_RECORDS.map((record) => [record.id, record]));

/** Register (or replace) a source record: add-by-URL and tests extend the
 *  registry this way, the same idiom registerResearchSource uses. */
export function registerNewsSource(record) {
  if (!record || typeof record.id !== "string" || !record.id) {
    throw new Error("registerNewsSource: expected a record with a non-empty string id");
  }
  registry.set(record.id, record);
}

/** Every registered source record, insertion order (the shipped ten first,
 *  then whatever registerNewsSource added). */
export function newsSourceRecords() {
  return [...registry.values()];
}

/** `ids` folded onto known registry ids only, order preserved, duplicates
 *  dropped — an unrecognised id is silently absent rather than an error, so a
 *  config written against an older registry degrades instead of failing. */
export function normalizeNewsSourceIds(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    const id = String(raw ?? "");
    if (!id || !registry.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function byteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).length;
}

function jsonByteLength(body) {
  try {
    return byteLength(JSON.stringify(body ?? null));
  } catch {
    return 0;
  }
}

function isNotModified(result) {
  return !!result && typeof result === "object" && result.notModified === true;
}

/** A slot-gated but never-cached GET: paced against the gate's minIntervalMs
 *  like every other courtesy fetch, but a repeated call always re-fetches —
 *  the news poll loop's own requirement (module header). */
function pacedFetchText(gate, url) {
  return gate.cachedFetch(url, () => gate.fetchText(url), { remember: false });
}
function pacedFetchJson(gate, url) {
  return gate.cachedFetch(url, () => gate.fetchJson(url), { remember: false });
}

function utcDateParts(now) {
  const d = new Date(now);
  return {
    yyyy: d.getUTCFullYear(),
    mm: String(d.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(d.getUTCDate()).padStart(2, "0"),
  };
}

function wikimediaFeedUrl(base, now) {
  const { yyyy, mm, dd } = utcDateParts(now);
  return `${base}/${yyyy}/${mm}/${dd}`;
}

async function fetchFeedFormat(record, gate, { format, now }) {
  const result = await pacedFetchText(gate, record.url);
  if (result === null) return null;
  if (isNotModified(result)) return { items: [], bytes: 0, notModified: true };
  const raw = parseFeed(result, { format });
  const items = normalizeFeedItems(record.id, raw, { now });
  return { items, bytes: byteLength(result) };
}

/** `body.news` (when present — only some days) links every story listed
 *  under it; otherwise the day's `mostread` articles. Each raw item also
 *  carries `wikibaseItem` when the article names one, past normalizeFeedItems
 *  (which only knows the snapshot's own fixed fields) so the news
 *  enrichment loop can short-circuit straight to the Wikidata KB source with
 *  the Q-id already in hand, no lookup needed.
 *
 *  Neither `news` nor `mostread` carries a per-article timestamp in the raw
 *  payload — the only date this feed exposes is the UTC calendar day the
 *  request itself names (the `/YYYY/MM/DD/` path Wikimedia selected these
 *  articles for), so `publishedAt` is stamped from whichever day's page
 *  actually answered (the primary day, or the prior day on a 404 retry),
 *  never from the fetch's own clock. */
async function fetchWikimediaFeed(record, gate, { now }) {
  let feedDay = now;
  let body = await pacedFetchJson(gate, wikimediaFeedUrl(record.url, feedDay));
  if (body === null) {
    // A 404 means the day's page is not yet published; retry once against
    // the previous UTC day before giving up.
    const prevDay = new Date(now);
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    feedDay = prevDay.toISOString();
    body = await pacedFetchJson(gate, wikimediaFeedUrl(record.url, feedDay));
    if (body === null) return null;
  }
  if (isNotModified(body)) return { items: [], bytes: 0, notModified: true };

  const articles = Array.isArray(body?.news)
    ? body.news.flatMap((story) => (Array.isArray(story?.links) ? story.links : []))
    : Array.isArray(body?.mostread?.articles)
      ? body.mostread.articles
      : [];

  const { yyyy, mm, dd } = utcDateParts(feedDay);
  const feedDayIso = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  const raw = articles.map((a) => ({
    guid: a?.wikibase_item || a?.normalizedtitle || a?.title || "",
    title: stripMarkup(a?.normalizedtitle || a?.displaytitle || a?.title || ""),
    url: a?.content_urls?.desktop?.page || "",
    summary: stripMarkup(a?.extract || ""),
    publishedAt: feedDayIso,
    wikibaseItem: a?.wikibase_item || "",
  }));

  const items = normalizeFeedItems(record.id, raw, { now });
  const wikibaseItemById = new Map(raw.map((r) => [feedItemId(record.id, r.guid || r.url), r.wikibaseItem]));
  for (const item of items) {
    const wikibaseItem = wikibaseItemById.get(item.id);
    if (wikibaseItem) item.wikibaseItem = wikibaseItem;
  }
  return { items, bytes: jsonByteLength(body) };
}

// A Hacker News item is a headline and nothing else — the API carries no
// summary field to fetch — and a headline is rarely a sentence, so nothing in
// the item grounds on its own. The fixed sentence below states what the site
// itself did with the story, and it names the headline IN QUOTES: quoted, the
// headline's own words can never be re-read as a claim of their own, so "Let's
// take apart your phone" stays a story Hacker News discusses instead of
// becoming a fact about Hacker News taking a phone apart.
//
// "Hackernews" is one word here on purpose. A two-word proper name in subject
// position reads as noun + verb ("Hacker" doing "News"), and the fact that
// falls out of that is nonsense.
const HACKER_NEWS_TITLE_PREFIX_RE = /^(?:show|ask|tell)\s+hn:\s*/i;
// Past this many words the stored term is a clause, not a name, and the
// recognizer turns it down — so the sentence is not built at all rather than
// stored half-read.
const HACKER_NEWS_HEADLINE_MAX_WORDS = 6;

function hackerNewsSummary(title) {
  const headline = String(title || "").replace(HACKER_NEWS_TITLE_PREFIX_RE, "").trim();
  if (!headline || headline.includes(":")) return "";
  if (headline.split(/\s+/).length > HACKER_NEWS_HEADLINE_MAX_WORDS) return "";
  return `Hackernews discusses "${headline}".`;
}

/** topstories.json, then item/<id>.json for the first ten ids, through the
 *  same gate — each item fetch takes its own slot, so the ten round trips
 *  are genuinely paced by the gate's minIntervalMs rather than firing back
 *  to back (section 4's "10 × 250ms" latency budget only holds this way). */
async function fetchHackerNews(record, gate, { now }) {
  const ids = await pacedFetchJson(gate, `${record.url}/topstories.json`);
  if (!Array.isArray(ids)) return null;
  const raw = [];
  let bytes = 0;
  for (const id of ids.slice(0, HACKER_NEWS_ITEM_CAP)) {
    const item = await pacedFetchJson(gate, `${record.url}/item/${id}.json`);
    if (!item) continue;
    bytes += jsonByteLength(item);
    const title = stripMarkup(item.title || "");
    raw.push({
      guid: String(item.id ?? id),
      title,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id ?? id}`,
      summary: hackerNewsSummary(title),
      publishedAt: Number.isFinite(item.time) ? new Date(item.time * 1000).toISOString() : "",
    });
  }
  const items = normalizeFeedItems(record.id, raw, { now });
  return { items, bytes };
}

// A USGS place names a point by its distance and bearing from a settlement
// ("25 km ENE of Wana, Pakistan"), or by an offshore bearing ("off the west
// coast of Vancouver Island, Canada"), or outright ("Western Australia"). The
// distance and the bearing are a measurement, not a name, so they come off
// before the place reaches the sentence below: a number-led term can never
// head a feed card, and "near" already covers the few kilometres dropped.
const USGS_DISTANCE_PREFIX_RE = /^\s*\d+(?:\.\d+)?\s*km\s+[NSEW]{1,3}\s+of\s+/i;
const USGS_OFFSHORE_PREFIX_RE = /^\s*off\s+(?:the\s+)?[a-z\s]*?coast\s+of\s+/i;

function usgsPlaceName(place) {
  return String(place || "")
    .replace(USGS_DISTANCE_PREFIX_RE, "")
    .replace(USGS_OFFSHORE_PREFIX_RE, "")
    .trim();
}

// One fixed sentence per quake: a bare-noun subject, the verb the event did,
// and the named place. The magnitude stays where USGS itself put it, in the
// item's title — a stored fact's subject here is the CLASS "earthquake", so
// writing the number into this sentence would say something about earthquakes
// in general rather than about this one.
function usgsSummary(place) {
  const name = usgsPlaceName(place);
  return name ? `An earthquake struck near ${name}.` : "";
}

async function fetchUsgs(record, gate, { now }) {
  const body = await pacedFetchJson(gate, record.url);
  if (body === null) return null;
  if (isNotModified(body)) return { items: [], bytes: 0, notModified: true };
  const features = Array.isArray(body?.features) ? body.features : [];
  const raw = features.map((f) => ({
    guid: String(f?.id ?? f?.properties?.detail ?? f?.properties?.url ?? ""),
    title: stripMarkup(f?.properties?.title || ""),
    url: f?.properties?.url || "",
    summary: stripMarkup(usgsSummary(f?.properties?.place)),
    publishedAt: Number.isFinite(f?.properties?.time) ? new Date(f.properties.time).toISOString() : "",
  }));
  const items = normalizeFeedItems(record.id, raw, { now });
  return { items, bytes: jsonByteLength(body) };
}

function wikinewsArticleOrigin(apiUrl) {
  return String(apiUrl ?? "").replace(/\/w\/api\.php$/, "");
}

/** Wikinews' recently-published mainspace articles via the action API's
 *  recentchanges list — the smallest query that names what is new without a
 *  category to maintain by hand. */
async function fetchWikinews(record, gate, { now }) {
  // `rctype=new` is the action API's own name for "page creations only". An
  // earlier `rcnewonly` is not a parameter the API has: it answers with an
  // "Unrecognized parameter" warning and lists every edit, so a re-edited old
  // article read as a new story.
  const url = `${record.url}?action=query&list=recentchanges&rcnamespace=0&rctype=new&rclimit=20&format=json&formatversion=2&origin=*`;
  const body = await pacedFetchJson(gate, url);
  if (body === null) return null;
  if (isNotModified(body)) return { items: [], bytes: 0, notModified: true };
  const changes = Array.isArray(body?.query?.recentchanges) ? body.query.recentchanges : [];
  const origin = wikinewsArticleOrigin(record.url);
  const raw = changes.map((c) => ({
    guid: String(c?.pageid ?? c?.title ?? ""),
    title: stripMarkup(c?.title || ""),
    url: c?.title ? `${origin}/wiki/${encodeURIComponent(String(c.title).replace(/ /g, "_"))}` : "",
    summary: "",
    publishedAt: Number.isFinite(Date.parse(c?.timestamp)) ? new Date(c.timestamp).toISOString() : "",
  }));
  const items = normalizeFeedItems(record.id, raw, { now });
  return { items, bytes: jsonByteLength(body) };
}

/** One source record's fetcher: `{ id, async fetchItems() -> { items, bytes,
 *  notModified? } | null }`. The gate's minIntervalMs defaults to
 *  `record.minIntervalMs` when the caller doesn't override it, so Hacker
 *  News runs at its own lower floor while every other source keeps the
 *  shared default. `validators`, when given, is the Map the caller keeps
 *  across polls (per source id, not per fetcher instance) for the
 *  conditional-request memory courtesy.mjs implements. */
export function createNewsFetcher(record, { fetchImpl, minIntervalMs, validators = null, now } = {}) {
  const gate = createCourtesyGate({
    fetchImpl,
    minIntervalMs: minIntervalMs ?? record.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    userAgent: NEWS_USER_AGENT,
    waitForSlot: true,
    validators,
  });

  async function fetchItems() {
    const resolvedNow = typeof now === "function" ? now() : (now ?? new Date().toISOString());
    switch (record.format) {
      case "rss":
      case "atom":
      case "jsonfeed":
        return fetchFeedFormat(record, gate, { format: record.format, now: resolvedNow });
      case "wikimedia-feed":
        return fetchWikimediaFeed(record, gate, { now: resolvedNow });
      case "hn":
        return fetchHackerNews(record, gate, { now: resolvedNow });
      case "usgs":
        return fetchUsgs(record, gate, { now: resolvedNow });
      case "mediawiki":
        return fetchWikinews(record, gate, { now: resolvedNow });
      default:
        return null;
    }
  }

  return { id: record.id, fetchItems };
}

/** The add-by-URL preflight: https-only, one fetch, detectFeedFormat on the
 *  body. A thrown fetch (a browser's CORS rejection reads this way — the
 *  rejection carries no response to inspect) reads as "browser-blocked"; a
 *  response that resolves but is not a readable feed reads as "no-feed". A
 *  courtesy-gate slot is deliberately NOT used here: this is one user-
 *  initiated action outside the poll cadence, not a repeated fetch a
 *  throttle needs to pace. */
export async function preflightNewsUrl(url, { fetchImpl } = {}) {
  const target = String(url ?? "").trim();
  if (!target.startsWith("https://")) return { ok: false, reason: "not-https" };

  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;
  let res;
  try {
    const opts = { headers: { "User-Agent": NEWS_USER_AGENT } };
    if (controller) opts.signal = controller.signal;
    res = await doFetch(target, opts);
  } catch {
    return { ok: false, reason: "browser-blocked" };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  if (!res || !res.ok) return { ok: false, reason: "no-feed" };

  let text;
  try {
    text = await res.text();
  } catch {
    return { ok: false, reason: "no-feed" };
  }
  const format = detectFeedFormat(text);
  return format ? { ok: true, format } : { ok: false, reason: "no-feed" };
}
