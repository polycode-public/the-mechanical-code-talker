import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewsItems,
  newsStoryKey,
  placeAndPersonTerms,
  reportedVerbWords,
  readsAsClauseTerm,
  hubTitleTerm,
  storyCoverage,
} from "../../src/domain/news-feed.mjs";

const NOW = "2026-08-12T18:00:00.000Z";
const WINDOW = 6 * 60 * 60 * 1000;

function row(id, subject, predicate, object, provenance) {
  return {
    id,
    subject,
    predicate,
    object,
    provenance,
    trust: 0.4,
    sourceTypes: ["web"],
    observedAt: NOW,
  };
}

const reportRow = (id, subject, predicate, object, item) => row(id, subject, predicate, object, `news:${item}`);
const priorRow = (id, subject, predicate, object) => row(id, subject, predicate, object, "corpus:conceptnet");

const feed = (rows) => buildNewsItems(rows, { now: NOW, windowMs: WINDOW, limit: 12 });
const hubsOf = (rows) => feed(rows).map((item) => item.hub);

// ---------------------------------------------------------------------------
// A publication carries only the stories no other card tells.
// ---------------------------------------------------------------------------

const HACKER_NEWS_ROWS = [
  reportRow("fact:hn-deepseek", "hackernews", "mgx:discuss", "deepseek v4 pro", "hacker-news@item-deepseek"),
  reportRow("fact:hn-glaciers", "hackernews", "mgx:discuss", "climate dashboard glaciers", "hacker-news@item-glaciers"),
];

test("a publication whose every story already has its own card mints nothing", () => {
  assert.deepEqual(hubsOf(HACKER_NEWS_ROWS), ["climate dashboard glaciers", "deepseek v4 pro"]);
});

test("a publication whose stories are partly covered carries only the ones nothing else tells", () => {
  const rows = [
    ...HACKER_NEWS_ROWS,
    reportRow("fact:hn-compiler", "hackernews", "mgx:discuss", "compiler", "hacker-news@item-compiler"),
    priorRow("fact:compiler-kind", "compiler", "rdf:type", "tool"),
  ];
  const publication = feed(rows).find((item) => item.hub === "hackernews");

  assert.ok(publication, "the story no other card covers still needs telling");
  assert.match(publication.paragraph, /^hackernews discuss compiler\./);
  assert.ok(!publication.paragraph.includes("deepseek"), "the covered story belongs to its own card");
  assert.ok(!publication.paragraph.includes("glaciers"), "the covered story belongs to its own card");
  assert.ok(!publication.factIds.includes("fact:hn-deepseek"));
  assert.ok(!publication.factIds.includes("fact:hn-glaciers"));
});

test("a report whose provenance names no story is never claimed, so both its hubs still mint", () => {
  const rows = [row("fact:storm", "storm alba", "mgx:hit", "the hebrides", "news:")];
  assert.deepEqual(hubsOf(rows).sort(), ["hebrides", "storm alba"]);
});

// ---------------------------------------------------------------------------
// One story mints one card, and the entity wins it.
// ---------------------------------------------------------------------------

const AIR_WAR_ROWS = [
  reportRow("fact:war-reach", "air war", "mgx:reach", "ukraine", "nyt-world@item-war"),
  reportRow("fact:war-grid", "ukraine", "mgx:reach", "kyiv power grid", "nyt-world@item-war"),
  priorRow("fact:ukraine-kind", "ukraine", "rdf:type", "country"),
];

test("one story mints one card, and the place the graph already types takes it", () => {
  assert.deepEqual(hubsOf(AIR_WAR_ROWS), ["ukraine"]);
});

test("a place the report names beats the clause the same report threw off", () => {
  const rows = [
    reportRow("fact:bali", "bali", "mgx:draw", "sacred glow", "nyt-world@item-bali"),
    priorRow("fact:bali-kind", "bali", "rdf:type", "place"),
  ];
  assert.deepEqual(hubsOf(rows), ["bali"]);
});

test("a hub the report puts on the object side gives its card up to the subject when it reads as a clause", () => {
  const rows = [
    reportRow("fact:boats", "ecuadorean fleet", "mgx:hit", "boats hit by mystery attackers", "nyt-world@item-boats"),
  ];
  assert.deepEqual(hubsOf(rows), ["ecuadorean fleet"]);
});

test("a story name that reads as a clause heads no card of its own, so the publication carries that story", () => {
  const rows = [
    reportRow("fact:g", "hackernews", "mgx:discuss", "glaciers on the climate dashboard", "hacker-news@item-g"),
    reportRow("fact:d", "hackernews", "mgx:discuss", "deepseek pro", "hacker-news@item-d"),
  ];
  assert.deepEqual(hubsOf(rows), ["deepseek pro", "hackernews"]);
});

test("a place the source spelled as settlement and region takes the card from the class of event that struck it", () => {
  const rows = [
    reportRow("fact:quake", "earthquake", "mgx:strike-near", "wana, pakistan", "usgs-quakes@item-quake"),
  ];
  assert.deepEqual(hubsOf(rows), ["wana, pakistan"]);
});

test("the report's subject takes the card when neither term names a place", () => {
  const rows = [reportRow("fact:law", "france", "mgx:ban", "cold calls", "nyt-world@item-law")];
  assert.deepEqual(hubsOf(rows), ["france"]);
});

test("a hub the graph already types as a place keeps its own name", () => {
  const rows = [
    reportRow("fact:quake", "ancash, peru", "mgx:feel", "a tremor", "usgs-quakes@item-quake"),
    priorRow("fact:peru-kind", "ancash, peru", "rdfs:subClassOf", "region"),
  ];
  assert.deepEqual(hubsOf(rows), ["ancash, peru"]);
});

// ---------------------------------------------------------------------------
// Order independence, both rules at once.
// ---------------------------------------------------------------------------

test("the same fact set in two orders builds the same feed, publications and retitled hubs included", () => {
  const rows = [
    ...HACKER_NEWS_ROWS,
    ...AIR_WAR_ROWS,
    reportRow("fact:boats", "ecuadorean fleet", "mgx:hit", "boats hit by mystery attackers", "nyt-world@item-boats"),
  ];
  const forward = feed(rows);
  const backward = feed([...rows].reverse());

  assert.equal(JSON.stringify(forward), JSON.stringify(backward));
  assert.deepEqual(forward.map((item) => item.hub).sort(), [
    "climate dashboard glaciers", "deepseek v4 pro", "ecuadorean fleet", "ukraine",
  ]);
});

test("storyCoverage answers the same whichever order the hubs are handed to it", () => {
  const hubs = [
    { term: "hackernews", changed: 2, groundedEntity: false, clauseShaped: false, reportSubject: true },
    { term: "deepseek v4 pro", changed: 1, groundedEntity: false, clauseShaped: false, reportSubject: false },
    { term: "climate dashboard glaciers", changed: 1, groundedEntity: false, clauseShaped: false, reportSubject: false },
  ];
  const rowsByTerm = new Map([
    ["hackernews", HACKER_NEWS_ROWS],
    ["deepseek v4 pro", [HACKER_NEWS_ROWS[0]]],
    ["climate dashboard glaciers", [HACKER_NEWS_ROWS[1]]],
  ]);
  const read = (order) => [...storyCoverage(order, rowsByTerm)]
    .map(([term, { mints }]) => `${term}:${mints}`)
    .sort();

  assert.deepEqual(read(hubs), read([...hubs].reverse()));
  assert.deepEqual(read(hubs), [
    "climate dashboard glaciers:true", "deepseek v4 pro:true", "hackernews:false",
  ]);
});

// ---------------------------------------------------------------------------
// The readings the two rules are built on.
// ---------------------------------------------------------------------------

test("newsStoryKey reads the item tag through the ingest wrapper, and answers empty for a row that names none", () => {
  assert.equal(newsStoryKey({ provenance: "news:hacker-news@news-item:f7ad" }), "hacker-news@news-item:f7ad");
  assert.equal(newsStoryKey({ provenance: "optimistic-extract:news:nyt-world@item-9" }), "nyt-world@item-9");
  assert.equal(newsStoryKey({ provenance: "extracted:news-fixture:usgs-quakes@item-2" }), "usgs-quakes@item-2");
  assert.equal(newsStoryKey({ provenance: "corpus:conceptnet" }), "");
  assert.equal(newsStoryKey({}), "");
});

test("placeAndPersonTerms collects what the graph itself types as a place or a person, and nothing else", () => {
  const rows = [
    priorRow("fact:1", "bali", "rdf:type", "place"),
    priorRow("fact:2", "amelia nierenberg", "rdf:type", "person"),
    priorRow("fact:3", "ancash, peru", "rdfs:subClassOf", "region"),
    priorRow("fact:4", "compiler", "rdf:type", "tool"),
    priorRow("fact:5", "bali", "mgx:atLocation", "indonesia"),
  ];
  assert.deepEqual([...placeAndPersonTerms(rows)].sort(), ["amelia nierenberg", "ancash, peru", "bali"]);
});

test("a term reads as a clause when it runs long or carries a verb the window's own reports minted", () => {
  const verbs = reportedVerbWords([
    reportRow("fact:1", "a", "mgx:hit", "b", "s@i"),
    reportRow("fact:2", "c", "mgx:strike-near", "d", "s@i"),
    reportRow("fact:3", "e", "rdfs:subClassOf", "f", "s@i"),
  ]);
  assert.deepEqual([...verbs].sort(), ["hit"]);

  assert.equal(readsAsClauseTerm("boats hit by mystery attackers", verbs), true, "long and verb-carrying");
  assert.equal(readsAsClauseTerm("the wall was hit", verbs), true, "verb-carrying inside a name's length");
  assert.equal(readsAsClauseTerm("glaciers on the climate dashboard", verbs), true, "longer than a name runs");
  assert.equal(readsAsClauseTerm("south sandwich islands region", verbs), false, "a four-word place is a name");
  assert.equal(readsAsClauseTerm("public investments fund", verbs), false);
  assert.equal(readsAsClauseTerm("", verbs), false);
});

test("hubTitleTerm prefers a grounded entity, then the report's subject, then leaves the hub alone", () => {
  const verbWords = new Set(["hit"]);
  const storyCountByTerm = new Map([["hackernews", 2], ["ecuadorean fleet", 1], ["bali", 1]]);

  const grounded = hubTitleTerm("sacred glow", [
    reportRow("fact:bali", "bali", "mgx:draw", "sacred glow", "nyt-world@item-bali"),
  ], { placeOrPerson: new Set(["bali"]), verbWords, storyCountByTerm });
  assert.equal(grounded, "bali");

  const subject = hubTitleTerm("boats hit by mystery attackers", [
    reportRow("fact:boats", "ecuadorean fleet", "mgx:hit", "boats hit by mystery attackers", "nyt-world@item-boats"),
  ], { placeOrPerson: new Set(), verbWords, storyCountByTerm });
  assert.equal(subject, "ecuadorean fleet");

  const publicationSubject = hubTitleTerm("glaciers on the climate dashboard", [
    reportRow("fact:g", "hackernews", "mgx:discuss", "glaciers on the climate dashboard", "hacker-news@item-g"),
  ], { placeOrPerson: new Set(), verbWords, storyCountByTerm });
  assert.equal(publicationSubject, "glaciers on the climate dashboard");

  const alreadyGrounded = hubTitleTerm("bali", [
    reportRow("fact:bali", "bali", "mgx:draw", "sacred glow", "nyt-world@item-bali"),
  ], { placeOrPerson: new Set(["bali", "sacred glow"]), verbWords, storyCountByTerm });
  assert.equal(alreadyGrounded, "bali");
});
