// A source whose wire format carries no body — Hacker News hands over a
// headline and nothing else — can only ever mint a card that says a site
// discussed that headline. These pin what the feed does about it: the card is
// still built, still cited and still counted, and it reads after every card
// with something to say.
import test from "node:test";
import assert from "node:assert/strict";

import { buildNewsItems, cardSubstance } from "../../src/domain/news-feed.mjs";

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

const HEADLINE_ONLY_ROW = row("fact:hn-delta", "hackernews", "mgx:discuss", '"delta"');
// A second headline off the same publication, so the publication itself spans
// two stories and each headline heads its own card, the way a real poll runs.
const SECOND_HEADLINE_ROW = row("fact:hn-echo", "hackernews", "mgx:discuss", '"echo"', {
  provenance: "news:hacker-news@item-2",
});
const REPORT_ROW = row("fact:nyt-ukraine", "ukraine", "mgx:expand", "air war", {
  provenance: "news:nyt-world@item-4",
});
const LOOKUP_HEADLINE_ROW = row("fact:hn-amigados", "hackernews", "mgx:discuss", '"amigados"', {
  provenance: "news:hacker-news@item-3",
});
const LOOKUP_ROWS = [
  row("fact:def-1", "amigados", "rdf:type", "disk operating system", {
    provenance: "research:wikidata:amigados",
  }),
  row("fact:def-2", "amigados", "mgx:partOf", "amigaos", {
    provenance: "research:wikidata:amigados",
  }),
];

const SOURCES = new Map([
  ["fact:hn-delta", { title: "Delta", url: "https://news.ycombinator.com/item?id=1", name: "Hacker News" }],
  ["fact:hn-echo", { title: "Echo", url: "https://news.ycombinator.com/item?id=2", name: "Hacker News" }],
  ["fact:hn-amigados", { title: "AmigaDOS", url: "https://news.ycombinator.com/item?id=3", name: "Hacker News" }],
  ["fact:nyt-ukraine", { title: "Ukraine Expands Its Air War", url: "https://nyt.example/1", name: "NYT World News" }],
]);

const feed = (rows, options = {}) => buildNewsItems(rows, {
  now: NOW, windowMs: 6 * HOUR, sourcesByFactId: SOURCES, ...options,
});

test("a report whose object is the card's own headline counts as a mention, not a claim", () => {
  const substance = cardSubstance('"delta"', [HEADLINE_ONLY_ROW], {
    reportedIds: new Set(["fact:hn-delta"]),
    headlines: ["Delta"],
  });
  assert.deepEqual(substance, { claims: 0, background: 0, headlineMentions: 1, thin: true });
});

test("a report that names a thing counts as a claim, whoever filed it", () => {
  const substance = cardSubstance("ukraine", [REPORT_ROW], {
    reportedIds: new Set(["fact:nyt-ukraine"]),
    headlines: ["Ukraine Expands Its Air War"],
  });
  assert.deepEqual(substance, { claims: 1, background: 0, headlineMentions: 0, thin: false });
});

test("with no headline to compare against, a report counts as a claim rather than a mention", () => {
  const substance = cardSubstance('"delta"', [HEADLINE_ONLY_ROW], {
    reportedIds: new Set(["fact:hn-delta"]),
  });
  assert.equal(substance.claims, 1);
  assert.equal(substance.thin, false);
});

test("cards with nothing but their own headline read after a card that reports something", () => {
  const items = feed([HEADLINE_ONLY_ROW, SECOND_HEADLINE_ROW, REPORT_ROW]);
  assert.deepEqual(items.map((it) => it.hub), ["ukraine", '"delta"', '"echo"']);
  assert.deepEqual(items.map((it) => it.substance.thin), [false, true, true]);
});

test("a thin card stays in the feed, cited, counted and countable", () => {
  const thinCard = feed([HEADLINE_ONLY_ROW, SECOND_HEADLINE_ROW, REPORT_ROW])
    .find((it) => it.hub === '"delta"');
  assert.ok(thinCard.factIds.includes("fact:hn-delta"));
  assert.deepEqual(thinCard.sources.map((s) => s.title), ["Delta"]);
  assert.match(thinCard.paragraph, /delta/);
  assert.deepEqual(thinCard.substance, { claims: 0, background: 0, headlineMentions: 1, thin: true });
});

test("a bodyless source's card stops reading as thin once a lookup grounds a name in its headline", () => {
  const rows = [HEADLINE_ONLY_ROW, SECOND_HEADLINE_ROW, LOOKUP_HEADLINE_ROW, ...LOOKUP_ROWS];
  const items = feed(rows, { articleEntityNames: (texts) => (texts.join(" ").includes("AmigaDOS") ? ["AmigaDOS"] : []) });
  const grounded = items.find((it) => it.hub === '"amigados"');
  const bare = items.find((it) => it.hub === '"delta"');
  assert.equal(grounded.substance.headlineMentions, 1);
  assert.ok(grounded.substance.background > 0, "the looked-up definitions count as background");
  assert.equal(grounded.substance.thin, false);
  assert.equal(bare.substance.thin, true);
  assert.ok(
    items.indexOf(grounded) < items.indexOf(bare),
    "the card a lookup gave something to reads above the card it did not",
  );
});

test("substance and feed order answer to the fact set alone, not the order the rows arrive in", () => {
  const rows = [HEADLINE_ONLY_ROW, SECOND_HEADLINE_ROW, REPORT_ROW, LOOKUP_HEADLINE_ROW, ...LOOKUP_ROWS];
  const options = { articleEntityNames: (texts) => (texts.join(" ").includes("AmigaDOS") ? ["AmigaDOS"] : []) };
  const forward = feed(rows, options);
  const backward = feed([...rows].reverse(), options);
  assert.deepEqual(
    forward.map((it) => [it.hub, it.substance]),
    backward.map((it) => [it.hub, it.substance]),
  );
});
