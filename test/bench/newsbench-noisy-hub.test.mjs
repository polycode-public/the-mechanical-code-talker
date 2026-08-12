// Pins metric 5's same-sense test (scripts/news-bench/metrics.mjs) against
// hand-built rows shaped like the real seed content that motivated it: three
// disjoint WordNet senses of "earthquake" the old closed list let through,
// and two genuinely on-topic identity lines the same-sense test must not
// flag as noisy. No live bench run — noisyHubRelationRate is a pure
// function of the feed/rows/state it is handed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { noisyHubRelationRate } from "../../scripts/news-bench/metrics.mjs";

function row(id, subject, predicate, object) {
  return { id, subject, predicate, object };
}

function card(id, hub, factIds) {
  return { id, hub, factIds, background: factIds };
}

function item(id, factIds, title, summary = "") {
  return { id, factIds, title, summary };
}

// Every neighbour term below is a real edge this repo's own corpus carries
// (corpus/wordnet/wordnet-full.jsonl, corpus/conceptnet/slice.jsonl) — the
// same rows a live "xl" seed run actually produces, not invented data.
function buildFixture() {
  const rows = [
    // earthquake's own, correct sense — never asked about directly, but its
    // presence keeps "earthquake"'s one-hop neighbourhood realistic.
    row("eq-tremor", "tremor", "rdfs:subClassOf", "earthquake"),
    row("eq-geo", "earthquake", "rdfs:subClassOf", "geological phenomenon"),

    // the three disjoint WordNet senses PLAN_NEWS_FEED_QUALITY.md names —
    // none of these three rows' objects share a one-hop neighbour with
    // "earthquake" itself or with each other.
    row("eq-elec", "earthquake", "rdfs:subClassOf", "electrical device"),
    row("elec-1", "antenna", "rdfs:subClassOf", "electrical device"),
    row("elec-2", "capacitor", "rdfs:subClassOf", "electrical device"),

    row("eq-health", "earthquake", "rdfs:subClassOf", "good health"),
    row("health-1", "condition", "rdfs:subClassOf", "good health"),
    row("health-2", "haleness", "rdfs:subClassOf", "good health"),

    row("eq-flesh", "earthquake", "rdfs:subClassOf", "flesh"),
    row("flesh-1", "animal tissue", "rdfs:subClassOf", "flesh"),

    // fund: on-topic ("fund is a kind of currency" shares "money" with
    // fund's own one-hop neighbourhood) and off-topic ("fund is a kind of
    // abstraction", the closed list's own worked example) siblings on the
    // same hub.
    row("fund-money", "fund", "rdfs:subClassOf", "money"),
    row("fund-currency", "fund", "rdfs:subClassOf", "currency"),
    row("currency-1", "coinage", "rdfs:subClassOf", "currency"),
    row("currency-2", "money", "rdfs:subClassOf", "currency"),
    row("fund-abstraction", "fund", "rdfs:subClassOf", "abstraction"),

    // france: "country" shares "geographical area" with france's own
    // neighbourhood (both corpus:conceptnet edges in the real seed).
    row("france-geo", "france", "rdfs:subClassOf", "geographical area"),
    row("france-country", "france", "rdfs:subClassOf", "country"),
    row("country-1", "country", "rdfs:subClassOf", "administrative district"),
    row("country-2", "country", "rdfs:subClassOf", "geographical area"),
  ];

  const earthquakeFactIds = ["eq-elec", "eq-health", "eq-flesh"];
  const fundFactIds = ["fund-currency", "fund-abstraction"];
  const franceFactIds = ["france-country"];

  const feed = {
    items: [
      card("card-earthquake", "earthquake", earthquakeFactIds),
      card("card-fund", "fund", fundFactIds),
      card("card-france", "france", franceFactIds),
    ],
  };

  const state = {
    items: [
      item("news-earthquake", earthquakeFactIds, "M 4.6 - 14 km NE of Wana, Pakistan", "A moderate quake struck near Wana."),
      item(
        "news-fund",
        fundFactIds,
        "Public Investment Fund",
        "The Public Investment Fund is the sovereign wealth fund of Saudi Arabia, with total "
          + "estimated assets of US$900 billion, created to invest funds on behalf of the "
          + "government of Saudi Arabia.",
      ),
      item("news-france", franceFactIds, "France bans unsolicited telemarketing calls", "France's regulator acted against telemarketers."),
    ],
  };

  return { feed, rows, state };
}

test("the aggregate rate counts every fixture identity line and carries the closed-list companion field", () => {
  const { feed, rows, state } = buildFixture();
  const result = noisyHubRelationRate(feed, rows, state);
  assert.equal(result.contextLines, 6);
  assert.equal(typeof result.rate, "number");
  assert.equal(typeof result.noisyHubRateClosedList, "number");
});

test("earthquake IsA electrical device / good health / flesh are each noisy", async () => {
  const { rows } = buildFixture();
  const { noisyHubIndex, cardIdentityLineClassifications } = await import("../../scripts/news-bench/metrics.mjs");
  const state = { items: [item("news-earthquake", ["eq-elec", "eq-health", "eq-flesh"], "M 4.6 - 14 km NE of Wana, Pakistan", "A moderate quake struck near Wana.")] };
  const earthquakeCard = card("card-earthquake", "earthquake", ["eq-elec", "eq-health", "eq-flesh"]);
  const index = noisyHubIndex(rows, state);
  const classified = cardIdentityLineClassifications(earthquakeCard, index);
  const byObject = new Map(classified.map((c) => [c.row.object, c.noisy]));
  assert.equal(byObject.get("electrical device"), true);
  assert.equal(byObject.get("good health"), true);
  assert.equal(byObject.get("flesh"), true);
});

test("fund IsA currency is not noisy: it shares fund's own neighbour \"money\" with currency's neighbourhood", async () => {
  const { rows, state } = buildFixture();
  const { noisyHubIndex, cardIdentityLineClassifications } = await import("../../scripts/news-bench/metrics.mjs");
  const fundCard = card("card-fund", "fund", ["fund-currency", "fund-abstraction"]);
  const index = noisyHubIndex(rows, state);
  const classified = cardIdentityLineClassifications(fundCard, index);
  const byObject = new Map(classified.map((c) => [c.row.object, c]));
  assert.equal(byObject.get("currency").noisy, false);
  // "abstraction" stays flagged by the closed-list reading kept alongside.
  assert.equal(byObject.get("abstraction").noisyClosedList, true);
});

test("france IsA country is not noisy: it shares \"geographical area\" with france's own neighbourhood", async () => {
  const { rows, state } = buildFixture();
  const { noisyHubIndex, cardIdentityLineClassifications } = await import("../../scripts/news-bench/metrics.mjs");
  const franceCard = card("card-france", "france", ["france-country"]);
  const index = noisyHubIndex(rows, state);
  const classified = cardIdentityLineClassifications(franceCard, index);
  const byObject = new Map(classified.map((c) => [c.row.object, c]));
  assert.equal(byObject.get("country").noisy, false);
});

test("the closed-list companion reading is kept alongside the same-sense rate", () => {
  const { feed, rows, state } = buildFixture();
  const result = noisyHubRelationRate(feed, rows, state);
  assert.ok(Number.isFinite(result.noisyHubRateClosedList));
  // The closed list only ever catches "abstraction" here (its own worked
  // example, section 1 of the plan) — it cannot see the earthquake senses
  // at all, which is the whole reason this metric was replaced.
  assert.ok(result.noisyHubRateClosedList < result.rate);
});
