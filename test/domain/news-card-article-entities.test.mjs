// A card's background draws on the entities its ARTICLE names, not only the
// endpoints of its own facts. The shape under test: a discussion item whose
// single fact is that a site discussed a quoted headline, where the headline
// itself names an entity the graph holds definitions for.
import test from "node:test";
import assert from "node:assert/strict";
import { buildNewsItems } from "../../src/domain/news-feed.mjs";

const NOW = "2026-08-12T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;

const HEADLINE_TERM = "tim king, amigados developer, has died";
const HEADLINE_TEXT = "Tim King, AmigaDOS developer, has died";

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

const research = { provenance: "research:wikidata:amigados", trust: 0.6, sourceTypes: ["reference"] };

/** The two reports the window holds. The second one is what keeps the site
 *  itself from taking the first card's title: a term two stories name is a
 *  publication, and the card stays headed by the quoted headline — the shape
 *  a live Hacker News poll actually produces. */
function reportRows() {
  return [
    row("fact:discuss-1", "hackernews", "mgx:discuss", HEADLINE_TERM),
    row("fact:discuss-2", "hackernews", "mgx:discuss", "a rust compiler rewrite", {
      provenance: "news:hacker-news@item-2",
    }),
  ];
}

function definitionRows() {
  return [
    row("fact:amigados-type", "amigados", "rdf:type", "disk operating system", research),
    row("fact:amigados-sub", "amigados", "rdfs:subClassOf", "operating system", research),
    row("fact:amigados-part", "amigados", "mgx:partOf", "amigaos", research),
  ];
}

const sourcesByFactId = new Map([
  ["fact:discuss-1", {
    title: HEADLINE_TEXT,
    url: "https://news.ycombinator.com/item?id=1",
    name: "Hacker News",
    summary: "",
  }],
  ["fact:discuss-2", {
    title: "A Rust compiler rewrite",
    url: "https://news.ycombinator.com/item?id=2",
    name: "Hacker News",
    summary: "",
  }],
]);

// Stands in for the services layer's own capture (news.mjs's
// articleEntityNames, which reads the same whole names the enrichment ledger
// admits) so the domain test stays free of wink and the lexicon. Keyed on the
// text it is handed, so a card whose sources say something else gets nothing.
const namesInHeadline = (texts) => (texts.some((t) => t.includes("AmigaDOS")) ? ["amigados", "tim king"] : []);

const baseOptions = { now: NOW, windowMs: 6 * HOUR, limit: 12, sourcesByFactId };

const cardFor = (rows, options = {}) => buildNewsItems(rows, { ...baseOptions, ...options })
  .find((item) => item.hub === HEADLINE_TERM);

test("an entity named inside a quoted headline brings its definitions onto the card", () => {
  const rows = [...reportRows(), ...definitionRows()];

  const withoutNames = cardFor(rows);
  assert.equal(withoutNames.backgroundParagraph, "", "the fact's own endpoints reach no definition");

  const card = cardFor(rows, { articleEntityNames: namesInHeadline });
  assert.equal(
    card.backgroundParagraph,
    "amigados is part of amigaos. amigados is a kind of operating system. amigados is a disk operating system.",
  );
  assert.deepEqual(card.factIds, [
    "fact:amigados-part", "fact:amigados-sub", "fact:amigados-type", "fact:discuss-1", "fact:discuss-2",
  ]);
  assert.deepEqual(card.background, ["fact:amigados-part", "fact:amigados-sub", "fact:amigados-type"]);
});

test("the paragraph still leads with the report and follows it with what the article's entity is", () => {
  const card = cardFor([...reportRows(), ...definitionRows()], { articleEntityNames: namesInHeadline });
  assert.equal(
    card.paragraph,
    "hackernews discuss tim king, amigados developer, has died."
    + " amigados is part of amigaos. amigados is a kind of operating system."
    + " Around it: hackernews discuss a rust compiler rewrite.",
  );
});

test("a card whose article names an entity the graph holds nothing about reads exactly as it did before", () => {
  const rows = reportRows();
  const before = cardFor(rows);
  const after = cardFor(rows, { articleEntityNames: namesInHeadline });
  assert.equal(after.backgroundParagraph, "");
  assert.equal(JSON.stringify(after), JSON.stringify(before));
});

test("an article entity never widens what a card reports, only what it says the graph already held", () => {
  // Another story reports something about the same entity. That report belongs
  // to its own card; this one may borrow the definitions and nothing else.
  const rows = [
    ...reportRows(),
    ...definitionRows(),
    row("fact:amigados-report", "amigados", "mgx:power", "the amiga 500", {
      provenance: "news:hacker-news@item-3",
    }),
  ];
  const card = cardFor(rows, { articleEntityNames: namesInHeadline });
  assert.ok(!card.factIds.includes("fact:amigados-report"), "another story's report stays off this card");
  assert.equal(card.sources.length, 1, "the card still cites the one item it reports");
  assert.equal(card.sources[0].title, HEADLINE_TEXT);
});

test("the hub's own background is named before an article entity's", () => {
  const rows = [
    ...reportRows(),
    ...definitionRows(),
    row("fact:site-home", "hackernews", "mgx:atLocation", "san francisco", {
      provenance: "research:wikidata:hackernews", trust: 0.6, sourceTypes: ["reference"],
    }),
  ];
  const card = cardFor(rows, { articleEntityNames: namesInHeadline });
  const sentences = card.backgroundParagraph.split(". ");
  assert.equal(sentences[0], "hackernews is found in san francisco");
  assert.ok(sentences.slice(1).every((s) => s.startsWith("amigados")), card.backgroundParagraph);
});

test("a feed built with article entities comes back byte-identical whichever order the rows arrive in", () => {
  const rows = [...reportRows(), ...definitionRows()];
  const options = { ...baseOptions, articleEntityNames: namesInHeadline };
  const forward = buildNewsItems(rows, options);
  const backward = buildNewsItems([...rows].reverse(), options);
  assert.equal(JSON.stringify(forward), JSON.stringify(backward));
});

test("a background identity line spells one article, not two: a disk operating system, an operating system", () => {
  const rows = [
    ...reportRows(),
    row("fact:amigados-type", "amigados", "rdf:type", "disk operating system", research),
    row("fact:amigados-os", "amigados", "rdf:type", "operating system", research),
  ];
  const card = cardFor(rows, { articleEntityNames: namesInHeadline });
  assert.equal(card.backgroundParagraph, "amigados is a disk operating system and an operating system.");
});
