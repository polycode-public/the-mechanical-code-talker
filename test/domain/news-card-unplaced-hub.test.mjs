// A card headed by a phrase the sense bands never place — a coined name, a
// province the graph has never heard of, most of what a headline is about. The
// hub has no tops to keep to, so a scope anchored on it refuses nothing and the
// walk fills the card with whatever the graph happens to touch. The names the
// article itself uses carry the card's sense instead.
import test from "node:test";
import assert from "node:assert/strict";
import { buildNewsItems } from "../../src/domain/news-feed.mjs";

const NOW = "2026-08-12T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const UNPLACED_HUB = "syrian holdout province";
const PLACED_HUB = "russia";

function newsRow(id, subject, predicate, object, extra = {}) {
  return {
    id,
    subject,
    predicate,
    object,
    provenance: "news:nyt-world@item-1",
    trust: 0.4,
    sourceTypes: ["web"],
    observedAt: NOW,
    ...extra,
  };
}

function corpusRow(id, subject, predicate, object) {
  return {
    id,
    subject,
    predicate,
    object,
    provenance: "corpus:wordnet-xl",
    trust: 0.6,
    sourceTypes: ["corpus"],
    observedAt: NOW,
  };
}

// The two reports the window holds. The second keeps the first's hub from
// reading as a publication term.
const reports = () => [
  newsRow("fact:fears", UNPLACED_HUB, "tmct:fears", "government takeover"),
  newsRow("fact:release", PLACED_HUB, "tmct:releases", "robert gilman", {
    provenance: "news:nyt-world@item-2",
  }),
];

// What the report's own object drags in: "government takeover" reads as a
// matter, matter is a substance, and the substance side of the graph has
// nothing to do with a province.
const substanceSide = () => [
  corpusRow("fact:takeover-matter", "government takeover", "rdfs:subClassOf", "matter"),
  corpusRow("fact:say-matter", "say", "rdfs:subClassOf", "matter"),
  corpusRow("fact:pronounce-say", "pronounce", "mgx:synonym", "say"),
];

// The geography the article's own names reach.
const placeSide = () => [
  corpusRow("fact:sweida-province", "sweida", "rdfs:subClassOf", "province"),
  corpusRow("fact:province-area", "province", "rdfs:subClassOf", "geographical area"),
  corpusRow("fact:area-place", "geographical area", "rdfs:subClassOf", "place"),
  corpusRow("fact:russia-country", PLACED_HUB, "rdfs:subClassOf", "country"),
  corpusRow("fact:country-place", "country", "rdfs:subClassOf", "place"),
];

const allRows = () => [...reports(), ...substanceSide(), ...placeSide()];

const sourcesByFactId = new Map([
  ["fact:fears", {
    title: "A Syrian Holdout Province, Sweida, Fears a Government Takeover",
    url: "https://example.org/sweida",
    name: "NYT World News",
    summary: "In Sweida Province, many say it is just a matter of time.",
  }],
  ["fact:release", {
    title: "Russia Frees Robert Gilman",
    url: "https://example.org/gilman",
    name: "NYT World News",
    summary: "Russia released Robert Gilman.",
  }],
]);

// Stands in for the services layer's own capture, keyed on the text it is
// handed so each card gets the names of its own article.
const namesSweida = (texts) => (texts.some((t) => t.includes("Sweida")) ? ["sweida"] : ["robert gilman"]);
const namesNobodyThePlaceKnows = (texts) => (texts.some((t) => t.includes("Sweida")) ? ["druse minority"] : ["robert gilman"]);

const baseOptions = { now: NOW, windowMs: 6 * HOUR, limit: 12, sourcesByFactId };

const cardFor = (hub, options = {}) => buildNewsItems(allRows(), { ...baseOptions, ...options })
  .find((item) => item.hub === hub);

test("an unplaced hub keeps to the sense of the entities its own article names", () => {
  const card = cardFor(UNPLACED_HUB, { articleEntityNames: namesSweida });
  assert.ok(card, "the province heads a card");
  assert.deepEqual(card.factIds, ["fact:fears", "fact:sweida-province"]);
  assert.ok(!card.backgroundParagraph.includes("matter"), card.backgroundParagraph);
});

test("a card whose article names nothing the bands place goes sparse rather than filling with strays", () => {
  const card = cardFor(UNPLACED_HUB, { articleEntityNames: namesNobodyThePlaceKnows });
  assert.deepEqual(card.factIds, ["fact:fears"]);
  assert.equal(card.backgroundParagraph, "");
});

test("a placed hub reads exactly as it did, whatever its article names", () => {
  const withNames = cardFor(PLACED_HUB, { articleEntityNames: namesSweida });
  const withoutNames = cardFor(PLACED_HUB, { articleEntityNames: null });
  assert.deepEqual(withNames.factIds, withoutNames.factIds);
  assert.equal(withNames.paragraph, withoutNames.paragraph);
  assert.ok(withNames.factIds.includes("fact:russia-country"), "its own geography stays");
  assert.ok(!withNames.factIds.includes("fact:say-matter"), "the substance side stays out");
});

test("the same facts in two orders build the same feed", () => {
  const options = { ...baseOptions, articleEntityNames: namesSweida };
  const forward = buildNewsItems(allRows(), options);
  const backward = buildNewsItems(allRows().reverse(), options);
  assert.equal(JSON.stringify(forward), JSON.stringify(backward));
});
