import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectFeedFormat,
  stripMarkup,
  parseRss,
  parseAtom,
  parseJsonFeed,
  parseFeed,
  feedItemId,
  normalizeFeedItems,
} from "../../src/domain/feed-normalize.mjs";

const FIXTURES = path.resolve(fileURLToPath(import.meta.url), "..", "..", "fixtures", "news");
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

const nytRss = read("nyt-world.rss.xml");
const sampleAtom = read("sample.atom.xml");
const jsonfeedOrg = read("jsonfeed-org.json");
const daringFireball = read("daringfireball-item.json");

test("detectFeedFormat recognizes rss, atom and jsonfeed, and refuses anything else", () => {
  assert.equal(detectFeedFormat(nytRss), "rss");
  assert.equal(detectFeedFormat(sampleAtom), "atom");
  assert.equal(detectFeedFormat(jsonfeedOrg), "jsonfeed");
  assert.equal(detectFeedFormat(daringFireball), "jsonfeed");
  assert.equal(detectFeedFormat("<html><body>not a feed</body></html>"), null);
  assert.equal(detectFeedFormat('{"not":"a feed"}'), null);
  assert.equal(detectFeedFormat(""), null);
});

test("stripMarkup strips tags, decodes CDATA and entities, collapses whitespace", () => {
  assert.equal(stripMarkup("<b>bold</b>   and\n\ttext"), "bold and text");
  assert.equal(stripMarkup("<![CDATA[caged <i>text</i>]]>"), "caged text");
  assert.equal(stripMarkup("Tom &amp; Jerry &lt;3 &quot;friends&quot;"), 'Tom & Jerry <3 "friends"');
  assert.equal(stripMarkup("A&#39;s &#x26; B&#39;s"), "A's & B's");
  assert.equal(stripMarkup(""), "");
  assert.equal(stripMarkup(null), "");
});

test("stripMarkup renders a script-injection string inert", () => {
  const hostile = '<script>alert(document.cookie)</script><img src=x onerror="alert(1)">Officials met';
  const stripped = stripMarkup(hostile);
  assert.ok(!stripped.includes("<script"));
  assert.ok(!stripped.includes("<img"));
  assert.ok(!stripped.includes("onerror="));
  assert.ok(stripped.includes("Officials met"));
});

test("parseRss reads guid, title, link, description and pubDate in document order", () => {
  const items = parseRss(nytRss);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.slice(0, 2).map((i) => i.title),
    ["Talks Resume Over Ceasefire Terms", "Markets React to Tariff Announcement"],
  );
  const [first] = items;
  assert.equal(first.guid, "https://www.nytimes.com/2026/08/08/world/talks-resume.html");
  assert.equal(first.url, "https://www.nytimes.com/2026/08/08/world/talks-resume.html");
  assert.equal(first.summary, 'Negotiators returned to the table & described "cautious optimism" for a deal.');
  assert.equal(first.publishedAt, new Date("2026-08-08T09:15:00Z").toISOString());
});

test("parseRss strips a CDATA-wrapped script-injection title down to inert text", () => {
  const items = parseRss(nytRss);
  const geneva = items.find((i) => i.title.includes("Geneva"));
  assert.ok(geneva);
  assert.ok(!geneva.title.includes("<script"));
  assert.equal(geneva.title, "alert(1) Officials Meet in Geneva");
  assert.ok(!geneva.summary.includes("<img"));
});

test("parseRss leaves guid empty rather than throwing when an item has no guid tag", () => {
  const items = parseRss(nytRss);
  const noGuid = items.find((i) => i.url.endsWith("no-guid.html"));
  assert.ok(noGuid);
  assert.equal(noGuid.guid, "");
  assert.equal(noGuid.publishedAt, "");
});

test("parseRss caps at the given limit without throwing on the rest", () => {
  const items = parseRss(nytRss, { limit: 2 });
  assert.equal(items.length, 2);
});

test("parseRss never throws on a malformed document", () => {
  assert.doesNotThrow(() => parseRss("<rss><channel><item><title>unterminated"));
  assert.deepEqual(parseRss("<rss><channel></channel></rss>"), []);
});

test("parseAtom reads id, title, alternate link and summary/content in document order", () => {
  const entries = parseAtom(sampleAtom);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].guid, "https://example.com/articles/quake-recorded");
  assert.equal(entries[0].url, "https://example.com/articles/quake-recorded");
  assert.equal(entries[0].summary, "A moderate earthquake was recorded offshore, no injuries reported.");
  // <updated> wins over <published> when both are present, matching the
  // <summary>/<content> and pubDate/dc:date "first present wins" reading
  // order this parser applies uniformly across every format.
  assert.equal(entries[0].publishedAt, new Date("2026-08-08T09:00:00Z").toISOString());
});

test("parseAtom falls back to content when summary is absent, and to updated when published is absent", () => {
  const entries = parseAtom(sampleAtom);
  const second = entries[1];
  assert.equal(second.summary, "Body text for the second entry, with an embedded link right there.");
  assert.equal(second.publishedAt, new Date("2026-08-08T07:00:00Z").toISOString());
});

test("parseAtom prefers the alternate-rel link over a self link that appears first", () => {
  const entries = parseAtom(sampleAtom);
  const third = entries[2];
  assert.equal(third.url, "https://example.com/articles/third-entry");
});

test("parseAtom caps at the given limit", () => {
  assert.equal(parseAtom(sampleAtom, { limit: 1 }).length, 1);
});

test("parseJsonFeed prefers content_text, then stripped content_html, then summary", () => {
  const items = parseJsonFeed(jsonfeedOrg);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Announcing JSON Feed 1.1");
  assert.equal(items[0].summary, "JSON Feed 1.1 is a minor update to the spec.");
  assert.equal(items[1].summary, "JSON Feed is a pragmatic syndication format for the web.");
});

test("parseJsonFeed reads a linked-list item with no title field", () => {
  const items = parseJsonFeed(daringFireball);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "");
  assert.ok(items[0].summary.includes("A linked-list post with a source link"));
  assert.ok(!items[0].summary.includes("<a href"));
});

test("parseJsonFeed never throws on invalid JSON", () => {
  assert.deepEqual(parseJsonFeed("{not json"), []);
  assert.deepEqual(parseJsonFeed('{"items": "not an array"}'), []);
});

test("parseFeed auto-detects the format and dispatches to the right parser", () => {
  assert.equal(parseFeed(nytRss).length, 4);
  assert.equal(parseFeed(sampleAtom).length, 3);
  assert.equal(parseFeed(jsonfeedOrg).length, 2);
  assert.deepEqual(parseFeed("not a feed at all"), []);
});

test("parseFeed honours an explicit format over auto-detection", () => {
  assert.deepEqual(parseFeed(nytRss, { format: "atom" }), []);
});

test("feedItemId is stable for the same inputs and distinct for different ones", () => {
  const a1 = feedItemId("nyt-world", "https://example.com/a");
  const a2 = feedItemId("nyt-world", "https://example.com/a");
  const b = feedItemId("nyt-world", "https://example.com/b");
  const otherSource = feedItemId("hacker-news", "https://example.com/a");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.notEqual(a1, otherSource);
  assert.match(a1, /^news-item:[0-9a-f]{16}$/);
});

test("normalizeFeedItems dedupes by id, keeps document order and stamps fetchedAt from now", () => {
  const raw = [
    { guid: "g1", title: "One", url: "https://example.com/1", summary: "s1", publishedAt: "" },
    { guid: "g1", title: "One duplicate", url: "https://example.com/1dup", summary: "dup", publishedAt: "" },
    { guid: "g2", title: "Two", url: "https://example.com/2", summary: "s2", publishedAt: "" },
  ];
  const now = "2026-08-08T12:00:00.000Z";
  const items = normalizeFeedItems("nyt-world", raw, { now });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.title), ["One", "Two"]);
  assert.ok(items.every((i) => i.fetchedAt === now));
  assert.deepEqual(
    items.map((i) => i.id),
    [feedItemId("nyt-world", "g1"), feedItemId("nyt-world", "g2")],
  );
});

test("normalizeFeedItems falls back to url when guid is absent, and skips items with neither", () => {
  const raw = [
    { title: "No guid", url: "https://example.com/only-url", summary: "", publishedAt: "" },
    { title: "Neither", url: "", summary: "", publishedAt: "" },
  ];
  const items = normalizeFeedItems("nyt-world", raw, { now: "2026-08-08T12:00:00.000Z" });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, feedItemId("nyt-world", "https://example.com/only-url"));
});

test("normalizeFeedItems caps at the given limit", () => {
  const raw = [
    { guid: "1", title: "1", url: "u1" },
    { guid: "2", title: "2", url: "u2" },
    { guid: "3", title: "3", url: "u3" },
  ];
  const items = normalizeFeedItems("src", raw, { now: "2026-08-08T12:00:00.000Z", limit: 2 });
  assert.equal(items.length, 2);
});
