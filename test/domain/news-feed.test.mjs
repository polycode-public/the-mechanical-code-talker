import test from "node:test";
import assert from "node:assert/strict";
import {
  NEWS_HUB_HOPS,
  newsWindowRows,
  scoreHubs,
  subgraphAround,
  buildNewsItems,
  renderNewsParagraph,
  evictNewsFacts,
} from "../../src/domain/news-feed.mjs";

const NOW = "2026-08-08T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;

function row(id, subject, predicate, object, extra = {}) {
  return {
    id,
    subject,
    predicate,
    object,
    provenance: "news:hacker-news@item-1",
    trust: 0.4,
    sourceTypes: ["web"],
    observedAt: NOW,
    ...extra,
  };
}

test("newsWindowRows keeps only news/research-provenance rows inside [now - windowMs, now]", () => {
  const rows = [
    row("fact:1", "ceasefire", "rdf:type", "event", { observedAt: "2026-08-08T11:00:00.000Z" }),
    row("fact:2", "tariff", "rdf:type", "policy", { observedAt: "2026-08-07T00:00:00.000Z" }), // outside window
    row("fact:3", "quake", "rdf:type", "event", { provenance: "teach:chat:s1@2026-08-08T09:00:00Z" }), // wrong provenance
    row("fact:4", "wildfire", "rdf:type", "event", { provenance: "research:wikipedia:wildfire", observedAt: "2026-08-08T11:30:00.000Z" }),
    row("fact:5", "flood", "rdf:type", "event", { provenance: "news-fixture:usgs@item-9", observedAt: "2026-08-08T11:45:00.000Z" }),
  ];
  const windowRows = newsWindowRows(rows, { now: NOW, windowMs: 6 * HOUR });
  assert.deepEqual(windowRows.map((r) => r.id), ["fact:1", "fact:4", "fact:5"]);
});

test("newsWindowRows is a pure function of its arguments: two now values, two different windows, same rows array untouched", () => {
  const rows = [row("fact:1", "ceasefire", "rdf:type", "event", { observedAt: "2026-08-08T11:00:00.000Z" })];
  const before = JSON.stringify(rows);
  const early = newsWindowRows(rows, { now: "2026-08-08T11:30:00.000Z", windowMs: HOUR });
  const late = newsWindowRows(rows, { now: "2026-08-09T00:00:00.000Z", windowMs: HOUR });
  assert.equal(early.length, 1);
  assert.equal(late.length, 0);
  assert.equal(JSON.stringify(rows), before);
});

test("scoreHubs counts subject and object terms, ties break by term, and STOP_SET terms never hub", () => {
  const windowRows = [
    row("fact:1", "ceasefire", "mgx:causesDesire", "relief"),
    row("fact:2", "tariff", "mgx:causes", "relief"),
    row("fact:3", "ceasefire", "rdf:type", "event"), // "event" is in STOP_SET
  ];
  const hubs = scoreHubs([], windowRows, { limit: 6 });
  assert.deepEqual(hubs, [
    { term: "ceasefire", changed: 2 },
    { term: "relief", changed: 2 },
    { term: "tariff", changed: 1 },
  ]);
  assert.ok(!hubs.some((h) => h.term === "event"));
});

test("scoreHubs caps at the given limit", () => {
  const windowRows = [
    row("fact:1", "a", "rdf:type", "x"),
    row("fact:2", "b", "rdf:type", "x"),
    row("fact:3", "c", "rdf:type", "x"),
  ];
  const hubs = scoreHubs([], windowRows, { limit: 2 });
  assert.equal(hubs.length, 2);
});

test("subgraphAround is hop-exact: a fact two hops away is included, three hops away is not", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causesDesire", "relief"),
    row("fact:2", "relief", "rdf:type", "emotion"),
    row("fact:3", "emotion", "rdfs:subClassOf", "mental state"),
  ];
  const twoHop = subgraphAround(rows, "ceasefire", { hops: 2 });
  assert.deepEqual(twoHop.map((r) => r.id).sort(), ["fact:1", "fact:2"]);

  const threeHop = subgraphAround(rows, "ceasefire", { hops: 3 });
  assert.deepEqual(threeHop.map((r) => r.id).sort(), ["fact:1", "fact:2", "fact:3"]);
});

test("subgraphAround is cap-stable: the same capped set comes back regardless of row order", () => {
  const rows = [];
  for (let i = 0; i < 10; i += 1) rows.push(row(`fact:${i}`, "hub", "mgx:relatedTo", `leaf${i}`));
  const forward = subgraphAround(rows, "hub", { hops: 1, cap: 4 });
  const shuffled = [...rows].reverse();
  const backward = subgraphAround(shuffled, "hub", { hops: 1, cap: 4 });
  assert.equal(forward.length, 4);
  assert.deepEqual(forward.map((r) => r.id), backward.map((r) => r.id));
  assert.deepEqual(forward.map((r) => r.id), ["fact:0", "fact:1", "fact:2", "fact:3"]);
});

test("renderNewsParagraph groups identity first, then relations in table order, capped at five sentences", () => {
  const rows = [
    row("fact:1", "ceasefire", "rdf:type", "event"),
    row("fact:2", "ceasefire", "rdfs:subClassOf", "diplomatic process"),
    row("fact:3", "ceasefire", "mgx:causes", "relief"),
    row("fact:4", "ceasefire", "mgx:causes", "criticism"),
    row("fact:5", "ceasefire", "mgx:atLocation", "geneva"),
    row("fact:6", "relief", "mgx:hasProperty", "temporary"), // second hop
  ];
  const paragraph = renderNewsParagraph("ceasefire", rows);
  // Identity objects sort alphabetically ("diplomatic process" before
  // "event"); relation groups render in FACT_PREDICATE_PHRASES table order,
  // where mgx:atLocation precedes mgx:causes.
  assert.equal(
    paragraph,
    "ceasefire is a diplomatic process and event. ceasefire is found in geneva. ceasefire causes criticism and relief. Around it: relief is temporary.",
  );
});

test("renderNewsParagraph caps at five sentences even with many relation groups", () => {
  const rows = [
    row("fact:1", "hub", "rdf:type", "thing"),
    row("fact:2", "hub", "mgx:hasA", "part-a"),
    row("fact:3", "hub", "mgx:usedFor", "task"),
    row("fact:4", "hub", "mgx:capableOf", "act"),
    row("fact:5", "hub", "mgx:atLocation", "place"),
    row("fact:6", "hub", "mgx:causes", "effect"),
    row("fact:7", "hub", "mgx:madeOf", "material"),
  ];
  const paragraph = renderNewsParagraph("hub", rows);
  const sentenceCount = paragraph.split(". ").length;
  assert.equal(sentenceCount, 5);
});

test("renderNewsParagraph omits the closing sentence when there are no second-hop facts", () => {
  const rows = [row("fact:1", "hub", "mgx:hasA", "a part")];
  const paragraph = renderNewsParagraph("hub", rows);
  assert.equal(paragraph, "hub has a part.");
  assert.ok(!paragraph.includes("Around it"));
});

test("buildNewsItems produces byte-identical items regardless of the input rows' order (the CRDT resolver check)", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causesDesire", "relief"),
    row("fact:2", "relief", "rdf:type", "emotion"),
    row("fact:3", "tariff", "mgx:causes", "inflation"),
  ];
  const opts = { now: NOW, windowMs: 6 * HOUR, limit: 6 };
  const forward = buildNewsItems(rows, opts);
  const shuffled = [rows[2], rows[0], rows[1]];
  const backward = buildNewsItems(shuffled, opts);
  assert.equal(JSON.stringify(forward), JSON.stringify(backward));
  assert.ok(forward.length > 0);
});

test("buildNewsItems item id changes when and only when the fact set changes", () => {
  const rows = [row("fact:1", "ceasefire", "mgx:causesDesire", "relief")];
  const opts = { now: NOW, windowMs: 6 * HOUR, limit: 6 };
  const first = buildNewsItems(rows, opts);
  const same = buildNewsItems(rows, opts);
  assert.equal(first[0].id, same[0].id);

  const grown = [...rows, row("fact:2", "ceasefire", "mgx:atLocation", "geneva")];
  const changed = buildNewsItems(grown, opts);
  assert.notEqual(first[0].id, changed[0].id);
});

test("buildNewsItems' tier chip picks the strongest prior kind among the item's own facts", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causesDesire", "relief", { trust: 0.4, sourceTypes: ["web"] }),
    row("fact:2", "ceasefire", "mgx:atLocation", "geneva", { trust: 0.95, sourceTypes: ["teach"] }),
  ];
  const [item] = buildNewsItems(rows, { now: NOW, windowMs: 6 * HOUR, limit: 6 });
  assert.equal(item.tier, "teach");
});

test("buildNewsItems attaches sources from sourcesByFactId, deduped by url", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causesDesire", "relief"),
    row("fact:2", "ceasefire", "mgx:atLocation", "geneva"),
  ];
  const sourcesByFactId = new Map([
    ["fact:1", { title: "Talks Resume", url: "https://example.com/a", name: "Example News" }],
    ["fact:2", { title: "Talks Resume (again)", url: "https://example.com/a", name: "Example News" }],
  ]);
  const [item] = buildNewsItems(rows, { now: NOW, windowMs: 6 * HOUR, limit: 6, sourcesByFactId });
  assert.deepEqual(item.sources, [{ title: "Talks Resume", url: "https://example.com/a", name: "Example News" }]);
});

test("NEWS_HUB_HOPS is fixed at 2", () => {
  assert.equal(NEWS_HUB_HOPS, 2);
});

test("evictNewsFacts never selects a non-news row", () => {
  const rows = [
    row("fact:1", "a", "rdf:type", "x", { provenance: "news:hacker-news@i1", observedAt: "2026-08-01T00:00:00Z" }),
    row("fact:2", "b", "rdf:type", "x", { provenance: "teach:chat:s1@2026-08-01T00:00:00Z", observedAt: "2026-08-01T00:00:00Z" }),
    row("fact:3", "c", "rdf:type", "x", { provenance: "news-fixture:usgs@i2", observedAt: "2026-08-01T00:00:00Z" }),
    row("fact:4", "d", "rdf:type", "x", { provenance: "research:wikipedia:d", observedAt: "2026-08-01T00:00:00Z" }),
  ];
  const evicted = evictNewsFacts(rows, { cap: 0 });
  assert.deepEqual(evicted, ["fact:1"]);
});

test("evictNewsFacts orders oldest observedAt first, ties by id, and stops once at cap", () => {
  const rows = [
    row("fact:c", "a", "rdf:type", "x", { provenance: "news:src@i1", observedAt: "2026-08-03T00:00:00Z" }),
    row("fact:a", "b", "rdf:type", "x", { provenance: "news:src@i2", observedAt: "2026-08-01T00:00:00Z" }),
    row("fact:b", "c", "rdf:type", "x", { provenance: "news:src@i3", observedAt: "2026-08-01T00:00:00Z" }),
    row("fact:d", "d", "rdf:type", "x", { provenance: "news:src@i4", observedAt: "2026-08-04T00:00:00Z" }),
  ];
  assert.deepEqual(evictNewsFacts(rows, { cap: 4 }), []);
  assert.deepEqual(evictNewsFacts(rows, { cap: 2 }), ["fact:a", "fact:b"]);
  assert.deepEqual(evictNewsFacts(rows, { cap: 3 }), ["fact:a"]);
});
