// Whole names have to survive from the article's own prose to the enrichment
// queue. A queue holding "gilman" without "robert", or "united" without
// "states", asks a reference lookup half a question and gets a miss back for a
// term the article named in full.
import test from "node:test";
import assert from "node:assert/strict";

import { ingestText, ungroundedTermOccurrences } from "../../src/services/extract-facts.mjs";
import { createTermLedger, bumpTerms, rankedTerms } from "../../src/domain/term-ledger.mjs";
import { createWikipediaLiveProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";

const GILMAN_HEADLINE = "Ex-Marine Robert Gilman, Freed by Russia After 4 Years in Prison, Arrives in the U.S.";
const GILMAN_DESCRIPTION = "Russia released Robert Gilman on a humanitarian basis, President Trump said. "
  + "Mr. Gilman’s family had said he was in dire physical condition.";

/** The two texts a news item ingests as: headline and description reach the
 *  ingest as separate paragraphs, exactly as the news service joins them. */
const asArticle = (title, description) => `${title}\n\n${description}`;

test("a name run in a headline reaches the queue as the whole name, never as its words", async () => {
  const result = await ingestText(GILMAN_HEADLINE, { optimistic: true });
  const terms = [...result.ungroundedCounts.keys()];
  assert.ok(terms.includes("robert gilman"), `the whole name is queued (got ${terms.join(", ")})`);
  assert.equal(terms.includes("gilman"), false, "the surname never queues beside the name");
  assert.equal(terms.includes("robert"), false, "the given name never queues beside the name");
});

test("a leading role word only Title Case lifted to a name is trimmed off the run", async () => {
  const result = await ingestText(GILMAN_HEADLINE, { optimistic: true });
  for (const term of result.ungroundedCounts.keys()) {
    assert.equal(term.startsWith("ex-marine"), false, `"${term}" carries the headline's compound modifier`);
  }
});

test("a name standing alone in its own sentence still queues on its own terms", async () => {
  const result = await ingestText(GILMAN_HEADLINE, { optimistic: true });
  assert.equal(result.ungroundedCounts.get("russia"), 1, "russia is nobody's fragment here");
});

test("a bare later mention of a captured name counts toward the whole name", () => {
  const sentences = [
    "Russia released Robert Gilman on a humanitarian basis, President Trump said.",
    "Mr. Gilman’s family had said he was in dire physical condition.",
  ];
  const counts = ungroundedTermOccurrences(sentences, []);
  assert.equal(counts.get("robert gilman"), 2, "the honorific mention folds onto the full name");
  assert.equal(counts.has("gilman"), false);
  assert.equal(counts.has("mr. gilman"), false, "an honorific is trimmed off the front of a run");
});

test("the whole Gilman article leaves no bare surname anywhere in the queue", async () => {
  const result = await ingestText(asArticle(GILMAN_HEADLINE, GILMAN_DESCRIPTION), { optimistic: true });
  assert.equal(result.ungroundedCounts.has("gilman"), false);
  assert.equal(result.ungroundedCounts.has("robert"), false);
  const facts = [...result.extracted, ...result.optimistic];
  assert.ok(
    facts.some((fact) => fact.subject === "robert gilman" || fact.object === "robert gilman"),
    "the whole name is what the article's own fact carries, which is why it needs no enrichment",
  );
});

test("a two-word place name enters the queue as one term", () => {
  const counts = ungroundedTermOccurrences(["The United States said it would act."], []);
  assert.deepEqual([...counts.keys()], ["united states"]);
});

test("a name run keeps its head word unlemmatized, so the term reads as the name does", () => {
  const counts = ungroundedTermOccurrences(["The United States said it would act."], []);
  assert.equal(counts.has("united state"), false, "a proper name is never folded to a singular lemma");
});

test("a common noun that opens a two-word name stays inside it", () => {
  const counts = ungroundedTermOccurrences(["Zimbabwe plans to cull elephants near Lake Kariba."], []);
  assert.ok(counts.has("lake kariba"), "the run is not trimmed down to one token");
  assert.equal(counts.has("kariba"), false);
});

test("a title stacked in front of a full name is trimmed back to the name", () => {
  const counts = ungroundedTermOccurrences(["The delegation met Prime Minister Keir Starmer."], []);
  assert.ok(counts.has("keir starmer"), `expected the name alone, got ${[...counts.keys()].join(", ")}`);
});

test("a fact already grounding a name takes that name's fragments out of the queue with it", () => {
  const rows = [{ subject: "russia", predicate: "tmct:releases", object: "robert gilman" }];
  const counts = ungroundedTermOccurrences(["Russia released Robert Gilman.", "Mr. Gilman flew home."], rows);
  assert.equal(counts.has("robert gilman"), false);
  assert.equal(counts.has("gilman"), false);
});

test("the lexical fallback reads name runs off capitalization when it has no tags", () => {
  const counts = ungroundedTermOccurrences(
    ["Russia released Robert Gilman on a humanitarian basis, President Trump said."],
    [],
    { nlp: null },
  );
  assert.equal(counts.get("robert gilman"), 1);
  assert.equal(counts.has("gilman"), false);
});

test("the lexical fallback reads no name runs out of a Title Case headline, where a capital says nothing", () => {
  const counts = ungroundedTermOccurrences([GILMAN_HEADLINE], [], { nlp: null });
  assert.equal(counts.has("ex-marine robert gilman"), false);
  assert.equal(counts.has("freed by russia"), false);
});

test("a two-word name travels from the article's prose through the ledger to a reference lookup intact", async () => {
  const counts = ungroundedTermOccurrences([GILMAN_HEADLINE], []);
  const ledger = createTermLedger();
  bumpTerms(ledger, counts, "news-item:gilman", "2026-08-12T09:00:00Z");
  const [top] = rankedTerms(ledger).filter((entry) => entry.term.includes(" "));
  assert.equal(top.term, "robert gilman");

  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    const body = String(url).includes("action=opensearch")
      ? ["robert gilman", ["Robert Gilman"], [""], [""]]
      : {
        title: "Robert Gilman",
        extract: "Robert Gilman is an American former Marine. He was imprisoned in Russia.",
        revision: "99",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Robert_Gilman" } },
      };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  const provider = createWikipediaLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup(top.term);

  assert.ok(row, "the whole name resolves where half of it would have missed");
  assert.equal(row.term, "robert gilman");
  assert.equal(row.title, "Robert Gilman");
  assert.ok(asked[0].includes("search=robert%20gilman"), `the space is percent-encoded (got ${asked[0]})`);
  assert.equal(asked[1], "https://en.wikipedia.org/api/rest_v1/page/summary/Robert_Gilman");
});

test("a version string in a headline leaves nothing behind in the ledger but its name", async () => {
  const result = await ingestText("Qwen3.8-2.4T", { optimistic: true });
  const ledger = createTermLedger();
  bumpTerms(ledger, result.ungroundedCounts, "news-item:qwen", "2026-08-12T09:00:00Z");
  assert.deepEqual(rankedTerms(ledger).map((entry) => entry.term), ["qwen3"]);
});
