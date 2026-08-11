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
  classifyNewsRow,
  reportedRows,
  conceptTerms,
  isQuantityTerm,
  hasQuantityMarker,
  newsworthyHubs,
  splitCardRows,
  priorTerms,
  isNovelTerm,
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
    "ceasefire is a diplomatic process and an event. ceasefire is found in geneva. ceasefire causes criticism and relief. Around it: relief is temporary.",
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

test("renderNewsParagraph renders a relation minted from a source's own verb, which no curated table entry covers", () => {
  const rows = [
    row("fact:1", "cyclone", "mgx:hit", "eastern australia"),
    row("fact:2", "cyclone", "mgx:batter", "queensland"),
  ];
  assert.equal(
    renderNewsParagraph("cyclone", rows),
    "cyclone batters queensland. cyclone hits eastern australia.",
  );
});

test("renderNewsParagraph speaks for a hub that only ever appears as an object", () => {
  const rows = [row("fact:1", "earthquake", "mgx:strike-near", "anchorage, alaska")];
  assert.equal(
    renderNewsParagraph("anchorage, alaska", rows),
    "earthquake strikes near anchorage, alaska.",
  );
});

test("renderNewsParagraph counts the tail of a long object list instead of naming every one", () => {
  const places = ["a place", "b place", "c place", "d place", "e place", "f place", "g place", "h place"];
  const rows = places.map((place, i) => row(`fact:${i}`, "earthquake", "mgx:strike-near", place));
  const paragraph = renderNewsParagraph("earthquake", rows);
  assert.equal(paragraph, "earthquake strikes near a place, b place, c place, d place, e place, f place and 2 more.");
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

// ---- the newsworthiness gate (PLAN_NEWS_FEED.md section 17) ----------------

test("classifyNewsRow bands a syllogised row derived, whether by its provenance head or a non-empty justification", () => {
  const entailed = row("fact:1", "module", "rdfs:subClassOf", "part", { provenance: "entailed:rdfs-sco" });
  assert.equal(classifyNewsRow(entailed, { now: NOW, windowMs: 6 * HOUR }), "derived");

  const justified = row("fact:2", "module", "rdfs:subClassOf", "part", {
    provenance: "news:src@i1", justification: [["fact:a", "fact:b"]],
  });
  assert.equal(classifyNewsRow(justified, { now: NOW, windowMs: 6 * HOUR }), "derived");
});

test("classifyNewsRow bands an identity row background under a news: tag, whoever reported it", () => {
  const identity = row("fact:1", "tariff", "rdf:type", "tax", { provenance: "news:wikimedia-featured@1" });
  assert.equal(classifyNewsRow(identity, { now: NOW, windowMs: 6 * HOUR }), "background");
});

test("classifyNewsRow bands a universal-quantifier row background", () => {
  const universal = row("fact:1", "spider", "mgx:hasA", "eight legs", { quantifier: "every" });
  assert.equal(classifyNewsRow(universal, { now: NOW, windowMs: 6 * HOUR }), "background");
});

test("classifyNewsRow bands a research: row background even inside the window — enrichment is a lookup, never a report", () => {
  const looked_up = row("fact:1", "kilometre", "mgx:hasProperty", "one thousand metres", { provenance: "research:simple-wikipedia:kilometre" });
  assert.equal(classifyNewsRow(looked_up, { now: NOW, windowMs: 6 * HOUR }), "background");
});

test("classifyNewsRow bands a news: row background when its stamp is unreadable or outside the window", () => {
  const noStamp = row("fact:1", "ceasefire", "mgx:causes", "relief", { observedAt: "" });
  assert.equal(classifyNewsRow(noStamp, { now: NOW, windowMs: 6 * HOUR }), "background");

  const stale = row("fact:2", "ceasefire", "mgx:causes", "relief", { observedAt: "2020-01-01T00:00:00Z" });
  assert.equal(classifyNewsRow(stale, { now: NOW, windowMs: 6 * HOUR }), "background");
});

test("classifyNewsRow bands a fresh news: relation row reported", () => {
  const fresh = row("fact:1", "ceasefire", "mgx:causes", "relief");
  assert.equal(classifyNewsRow(fresh, { now: NOW, windowMs: 6 * HOUR }), "reported");
});

test("reportedRows keeps only the rows classifyNewsRow bands reported", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causes", "relief"),
    row("fact:2", "tariff", "rdf:type", "tax", { provenance: "news:wikimedia-featured@1" }),
    row("fact:3", "kilometre", "mgx:hasProperty", "unit", { provenance: "research:simple-wikipedia:kilometre" }),
  ];
  assert.deepEqual(reportedRows(rows, { now: NOW, windowMs: 6 * HOUR }).map((r) => r.id), ["fact:1"]);
});

test("newsworthyHubs: a window holding only research: definitions of a term yields zero hubs", () => {
  const rows = [row("fact:1", "kilometre", "rdfs:subClassOf", "unit", { provenance: "research:simple-wikipedia:kilometre" })];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  assert.deepEqual(reported, []);
  assert.deepEqual(newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR }), []);
});

test("newsworthyHubs: adding one news:-tagged population row yields exactly one hub, the reporting subject, never its own bare number", () => {
  const rows = [
    row("fact:1", "kilometre", "rdfs:subClassOf", "unit", { provenance: "research:simple-wikipedia:kilometre" }),
    row("fact:2", "kumamoto prefecture", "mgx:hasProperty", "1738000", { provenance: "news:wikimedia-featured@kumamoto" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.deepEqual(hubs, [{ term: "kumamoto prefecture", changed: 1 }]);
});

test("newsworthyHubs never hubs a class term, even when a reported row names it", () => {
  const rows = [
    row("fact:1", "mont blanc", "rdf:type", "mountain", { provenance: "corpus:test" }),
    row("fact:2", "avalanche", "mgx:atLocation", "mountain"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  const terms = hubs.map((h) => h.term);
  assert.ok(terms.includes("avalanche"), `avalanche is a plain reported term: ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes("mountain"), `mountain is a class object of an identity row and never hubs: ${JSON.stringify(terms)}`);
});

test("newsworthyHubs never hubs a bare date or a bare amount, even when a reported row names it and it is otherwise anchored", () => {
  const rows = [
    row("fact:1", "q3 2026", "mgx:hasProperty", "record profit"),
    row("fact:2", "acme corp", "mgx:hasProperty", "42000000"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  const terms = hubs.map((h) => h.term);
  assert.ok(!terms.includes("q3 2026"), `a bare quarter never hubs: ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes("42000000"), `a bare number never hubs: ${JSON.stringify(terms)}`);
  assert.ok(terms.includes("record profit"), `the non-quantity side of the same row still hubs: ${JSON.stringify(terms)}`);
  assert.ok(terms.includes("acme corp"), `the non-quantity side of the same row still hubs: ${JSON.stringify(terms)}`);
});

test("newsworthyHubs never anchors a seeded term on a report that attaches nothing new to it", () => {
  const rows = [
    row("seed:1", "london", "rdf:type", "city", { provenance: "corpus:seed", observedAt: "2020-01-01T00:00:00Z" }),
    row("seed:2", "england", "rdf:type", "country", { provenance: "corpus:seed", observedAt: "2020-01-01T00:00:00Z" }),
    row("fact:1", "london", "mgx:atLocation", "england"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(!hubs.some((h) => h.term === "london"), "both sides of the report are prior knowledge — nothing anchors london");
});

test("newsworthyHubs anchors a seeded term once a reported row attaches a digit run to it", () => {
  const rows = [
    row("seed:1", "london", "rdf:type", "city", { provenance: "corpus:seed", observedAt: "2020-01-01T00:00:00Z" }),
    row("fact:1", "london", "mgx:hasProperty", "9 million residents"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "london"), "a digit-run measurement anchors the seeded term");
});

test("newsworthyHubs anchors a seeded term once a reported row joins it to a genuinely window-new term", () => {
  const rows = [
    row("seed:1", "london", "rdf:type", "city", { provenance: "corpus:seed", observedAt: "2020-01-01T00:00:00Z" }),
    row("fact:1", "london", "mgx:atLocation", "olympic stadium"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "london"), "a window-new neighbour anchors the seeded term");
});

test("isQuantityTerm and hasQuantityMarker test different questions: IS a quantity vs CARRIES a digit run", () => {
  for (const t of ["7,409", "2026-08-08", "q3 2026", "1,683,115"]) assert.equal(isQuantityTerm(t), true, t);
  for (const t of ["kumamoto prefecture", "monetary unit", "avalanche"]) assert.equal(isQuantityTerm(t), false, t);
  assert.equal(hasQuantityMarker("9 million residents"), true);
  assert.equal(hasQuantityMarker("magnitude 5.4 earthquake"), true);
  assert.equal(hasQuantityMarker("olympic stadium"), false);
});

test("splitCardRows divides a two-hop sub-graph into its reported rows and everything else", () => {
  const subgraphRows = [
    row("fact:1", "ceasefire", "mgx:causes", "relief"),
    row("fact:2", "relief", "rdf:type", "emotion"),
  ];
  const { reported, background } = splitCardRows(subgraphRows, new Set(["fact:1"]));
  assert.deepEqual(reported.map((r) => r.id), ["fact:1"]);
  assert.deepEqual(background.map((r) => r.id), ["fact:2"]);
});

test("renderNewsParagraph's reportedIds option keeps the identity sentence from any row, but relations and the closing sentence from reported rows only", () => {
  const rows = [
    row("fact:1", "ceasefire", "rdf:type", "event", { provenance: "corpus:test" }),
    row("fact:2", "ceasefire", "mgx:atLocation", "geneva"),
    row("fact:3", "ceasefire", "mgx:causes", "criticism", { provenance: "research:wikipedia:ceasefire" }),
  ];
  const reportedIds = new Set(["fact:2"]); // only the geneva relation was reported
  const paragraph = renderNewsParagraph("ceasefire", rows, { reportedIds });
  assert.equal(paragraph, "ceasefire is an event. ceasefire is found in geneva.");
  assert.ok(!paragraph.includes("criticism"), "a relation from a non-reported row is dropped");
});

test("buildNewsItems' gated builder still returns byte-identical items when derived, background and reported rows arrive in two different orders", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causes", "relief"),
    row("fact:2", "relief", "rdf:type", "emotion", { provenance: "corpus:test" }),
    row("fact:3", "ceasefire", "rdfs:subClassOf", "process", { provenance: "entailed:rdfs-sco" }),
  ];
  const opts = { now: NOW, windowMs: 6 * HOUR, limit: 6 };
  const forward = buildNewsItems(rows, opts);
  const shuffled = [rows[2], rows[0], rows[1]];
  const backward = buildNewsItems(shuffled, opts);
  assert.equal(JSON.stringify(forward), JSON.stringify(backward));
});

test("buildNewsItems' background/backgroundParagraph carry the relation the gate dropped from the card's own paragraph", () => {
  const rows = [
    row("fact:1", "ceasefire", "mgx:causes", "relief"),
    row("fact:2", "ceasefire", "mgx:atLocation", "geneva", { provenance: "research:wikipedia:ceasefire" }),
  ];
  const [item] = buildNewsItems(rows, { now: NOW, windowMs: 6 * HOUR, limit: 6 });
  assert.deepEqual(item.background, ["fact:2"]);
  assert.equal(item.paragraph, "ceasefire causes relief.");
  assert.equal(item.backgroundParagraph, "ceasefire is found in geneva.");
});

test("newsworthyHubs and buildNewsItems take an injected readsAsEntityTerm, so a caller with a stronger (wink-backed) check can reject a candidate the domain-local default would allow", () => {
  const rows = [row("fact:1", "bang", "mgx:bua", "thong shooting")];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });

  const withDefault = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(withDefault.some((h) => h.term === "bang"), "the domain-local lexical check alone admits it");

  const rejectBang = (term) => term !== "bang";
  const withInjected = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR, readsAsEntityTerm: rejectBang });
  assert.ok(!withInjected.some((h) => h.term === "bang"), "the injected check overrides the domain-local default");

  const items = buildNewsItems(rows, { now: NOW, windowMs: 6 * HOUR, limit: 6, readsAsEntityTerm: rejectBang });
  assert.ok(!items.some((it) => it.hub === "bang"), "buildNewsItems threads the same injected check down to the gate");
});

// ---- the gate declines identifier-token and clause-fallback rows ----------

test("a row marked identifier-token never heads a card on its own", () => {
  const rows = [row("fact:1", "normalizefeeditems", "mgx:fallsBackTo", "the link", { extraction: ["identifier-token"] })];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(!hubs.some((h) => h.term === "normalizefeeditems"), "an identifier-token row is declined from heading, not merely from being kept");
});

test("a row marked clause-fallback never anchors a fresh assertion for its subject", () => {
  const rows = [
    row("seed:1", "london", "rdf:type", "city", { provenance: "corpus:seed", observedAt: "2020-01-01T00:00:00Z" }),
    row("fact:1", "london", "mgx:hasProperty", "9 million residents", { extraction: ["clause-fallback"] }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(!hubs.some((h) => h.term === "london"), "a clause-fallback row cannot anchor the fresh-assertion test, unlike the same shape with no finding");
});

test("a pronoun-carry row still heads a card — the subject came from the paragraph's own prose, not a mis-read", () => {
  const rows = [row("fact:1", "sydney green", "mgx:hasA", "new role", { provenance: "news:src@1", extraction: ["pronoun-carry"] })];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "sydney green"), "pronoun-carry is not a declining finding, so it heads exactly as an unmarked row would");
});

test("a term with one clean occurrence still heads even when another row for the same term is declined", () => {
  const rows = [
    row("fact:1", "normalizefeeditems", "mgx:fallsBackTo", "the link", { extraction: ["identifier-token"] }),
    row("fact:2", "normalizefeeditems", "mgx:hasA", "clean definition", { provenance: "news:src@2" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "normalizefeeditems"), "a genuinely clean occurrence still heads, even alongside a declined one for the same term");
});

test("classifyNewsRow bands an mgx:nameFor row background — a definition is never a card head", () => {
  const nameFor = row("fact:1", "latency", "mgx:nameFor", "time period");
  assert.equal(classifyNewsRow(nameFor, { now: NOW, windowMs: 6 * HOUR }), "background");
});

test("newsworthyHubs never hubs a definitional mgx:nameFor row's object, even via a second, unrelated report", () => {
  const rows = [
    row("fact:1", "latency", "mgx:nameFor", "time period", { provenance: "corpus:test" }),
    row("fact:2", "queue", "mgx:causes", "time period"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  const terms = hubs.map((h) => h.term);
  assert.ok(terms.includes("queue"), `queue is a plain reported term: ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes("time period"), `time period is named by a definitional row and never hubs: ${JSON.stringify(terms)}`);
});

test("the domain-local entity check rejects a multi-word term led by a phrasal-verb particle, but a one-word particle term is exempt", () => {
  const rows = [
    row("fact:1", "site", "mgx:fallsBackTo", "back to the link"),
    row("fact:2", "site", "mgx:hasA", "back"),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  const terms = hubs.map((h) => h.term);
  assert.ok(!terms.includes("back to the link"), `a particle-led multi-word term never heads: ${JSON.stringify(terms)}`);
  assert.ok(terms.includes("back"), `a one-word particle term is exempt from the widening: ${JSON.stringify(terms)}`);
});

// ---- priorTerms / isNovelTerm (PLAN_NEWSWORTHINESS.md N0) ------------------

test("priorTerms collects subject and object terms from corpus, corpusWeak, reference and teach rows only", () => {
  const rows = [
    row("fact:1", "mont blanc", "rdf:type", "mountain", { provenance: "corpus:test" }),
    row("fact:2", "avalanche", "mgx:relatedTo", "snow", { provenance: "corpus-weak:conceptnet /r/RelatedTo" }),
    row("fact:3", "polar bear", "rdf:type", "bear", { provenance: "reference:simplewiki:Polar bear@912" }),
    row("fact:4", "sourdough", "rdf:type", "bread", { provenance: "teach:chat:s1@2026-08-08T00:00:00Z" }),
  ];
  const prior = priorTerms(rows);
  for (const term of ["mont blanc", "mountain", "avalanche", "snow", "polar bear", "bear", "sourdough", "bread"]) {
    assert.ok(prior.has(term), `"${term}" is prior knowledge: ${JSON.stringify([...prior])}`);
  }
});

test("priorTerms never admits a news:, news-fixture: or research: row — an enrichment lookup is not prior knowledge", () => {
  const rows = [
    row("fact:1", "kumamoto prefecture", "mgx:hasProperty", "1738000", { provenance: "news:wikimedia-featured@1" }),
    row("fact:2", "ridgecrest quake", "rdf:type", "earthquake", { provenance: "news-fixture:usgs@1" }),
    row("fact:3", "kilometre", "rdfs:subClassOf", "unit", { provenance: "research:simple-wikipedia:kilometre" }),
  ];
  assert.deepEqual(priorTerms(rows), new Set());
});

test("priorTerms is read term-whole: a two-word phrase is one entry, not two", () => {
  const rows = [row("fact:1", "kumamoto prefecture", "rdf:type", "prefecture", { provenance: "corpus:test" })];
  const prior = priorTerms(rows);
  assert.ok(prior.has("kumamoto prefecture"));
  assert.ok(!prior.has("kumamoto"), "the phrase is one entry, never split into its words");
});

test("priorTerms on an empty graph is the empty set", () => {
  assert.deepEqual(priorTerms([]), new Set());
});

test("isNovelTerm answers priorTerms' own absence check, term-whole", () => {
  const prior = new Set(["kumamoto prefecture", "mountain"]);
  assert.equal(isNovelTerm("kumamoto prefecture", prior), false);
  assert.equal(isNovelTerm("kumamoto", prior), true, "the phrase being prior does not make its own word prior");
  assert.equal(isNovelTerm("nonthaburi", prior), true);
});

// ---- the two tests, section 4's borderline cases (PLAN_NEWSWORTHINESS.md) --

test("a new entity mentioned once by one source still heads a card — the feed reports, it does not corroborate", () => {
  const rows = [row("fact:1", "sydney green", "mgx:hasA", "new role", { provenance: "news:src@1" })];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "sydney green"), "one reported row is enough to head a card");
});

test("\"sydney green\" the person heads a card even though both words are lexicon-known — the bigram is absent from prior terms", () => {
  const rows = [
    row("seed:1", "sydney", "rdf:type", "city", { provenance: "corpus:seed" }),
    row("seed:2", "green", "rdf:type", "colour", { provenance: "corpus:seed" }),
    row("fact:1", "sydney green", "mgx:hasA", "new role", { provenance: "news:src@1" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "sydney green"), "the two-word term is its own prior-term entry, absent from the set");
});

test("a named storm heads a card, and the class term it is an instance of never does", () => {
  const rows = [
    row("seed:1", "storm", "rdf:type", "weather event", { provenance: "corpus:seed" }),
    row("fact:1", "hurricane erin", "rdf:type", "storm", { provenance: "news:src@1" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  const terms = hubs.map((h) => h.term);
  assert.ok(!terms.includes("hurricane erin"), "an identity-only report never heads a card on its own");
  assert.ok(!terms.includes("storm"), "a class term never hubs");
});

test("a named storm mentioned in a non-identity reported row heads a card via multi-word prior-term absence", () => {
  const rows = [
    row("seed:1", "storm", "rdf:type", "weather event", { provenance: "corpus:seed" }),
    row("fact:1", "hurricane erin", "mgx:atLocation", "atlantic ocean", { provenance: "news:src@1" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "hurricane erin"), "the storm's own name is absent from prior terms");
});

test("a class object mentioned in a burglary story never heads a card, even as a plain reported row", () => {
  const rows = [
    row("seed:1", "drawer", "rdf:type", "furniture", { provenance: "corpus:seed" }),
    row("fact:1", "burglar", "mgx:capableOf", "drawer", { provenance: "news:src@1" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  const terms = hubs.map((h) => h.term);
  assert.ok(!terms.includes("drawer"), `a class object never hubs, even reported: ${JSON.stringify(terms)}`);
});

test("\"apple\" the business never heads a card while it stays prior knowledge with no anchor, and does once a report anchors it with a digit", () => {
  const seedRows = [
    row("seed:1", "apple", "rdf:type", "fruit", { provenance: "corpus:seed" }),
    row("seed:2", "orchard", "rdf:type", "place", { provenance: "corpus:seed" }),
  ];
  // Both sides of this report are already prior knowledge — "orchard" is not
  // a fresh co-term either, so nothing anchors the fresh-assertion test.
  const noAnchor = [...seedRows, row("fact:1", "apple", "mgx:hasA", "orchard", { provenance: "news:src@1" })];
  const noAnchorReported = reportedRows(noAnchor, { now: NOW, windowMs: 6 * HOUR });
  const noAnchorHubs = newsworthyHubs(noAnchor, noAnchorReported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(!noAnchorHubs.some((h) => h.term === "apple"), "prior knowledge with no anchor never heads a card");

  const anchored = [...seedRows, row("fact:1", "apple", "mgx:hasProperty", "42000000 units sold", { provenance: "news:src@1" })];
  const anchoredReported = reportedRows(anchored, { now: NOW, windowMs: 6 * HOUR });
  const anchoredHubs = newsworthyHubs(anchored, anchoredReported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(anchoredHubs.some((h) => h.term === "apple"), "a digit-anchored report grounds the fresh-assertion test");
});

test("a stubbed Wikidata Q-id row anchors a fresh assertion about a known entity even with no digit run", () => {
  const rows = [
    row("seed:1", "acme corp", "rdf:type", "company", { provenance: "corpus:seed" }),
    row("qid:1", "acme corp", "mgx:hasProperty", "q4242424", { provenance: "research:wikidata:acme corp" }),
    row("fact:1", "acme corp", "mgx:hasA", "new subsidiary", { provenance: "news:src@1" }),
  ];
  const reported = reportedRows(rows, { now: NOW, windowMs: 6 * HOUR });
  const hubs = newsworthyHubs(rows, reported, { now: NOW, windowMs: 6 * HOUR });
  assert.ok(hubs.some((h) => h.term === "acme corp"), "a stubbed enrichment Q-id row anchors the fresh assertion");
});
