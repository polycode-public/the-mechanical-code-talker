// The enrichment cycle's whole point, end to end: a term an article names is
// looked up, the definition lands, and MORE of that same article's own
// sentences ground than could ground before. Every lookup is a stub — no
// network anywhere here.
//
// The arc under test, in the order the product runs it:
//   1. an article is ingested; one of its sentences grounds only at the
//      optimistic tier, and the pronoun-led sentence after it grounds nothing,
//      because nothing anchors the class the first sentence names;
//   2. that class is queued for enrichment;
//   3. a KB defines it, under the research: provenance a real lookup writes;
//   4. reprocessAfterGrounding re-reads the article;
//   5. the pronoun-led sentence now grounds, as a new fact carrying the news
//      source's own tag and filed on the snapshot — which is what puts it in
//      the card's FACTS LEARNED.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampNewsConfig, createNewsState, ingestNewsSnapshot, enrichTopTerms,
} from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { normalizeFeedItems } from "../../src/domain/feed-normalize.mjs";
import { ledgerFromPayload, rankedTerms } from "../../src/domain/term-ledger.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";

const FIXED_NOW = "2026-08-12T00:00:00.000Z";

// Two sentences the way a report files them: a class claim, then a pronoun-led
// sentence about the same subject. The second one can only ground through the
// pronoun carry, and the carry only has a subject when the first sentence
// reaches the strict recognizer.
const HEADLINE = "Rottnest Island Counts More Quokkas";
const REPORT = "A quokka is a marsupial. It has a pouch.";

async function makeCtx({ config = clampNewsConfig({ kbSources: ["wikidata"], enrichTermsPerCycle: 4 }) } = {}) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  return {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config,
    state: createNewsState(),
    providers: {},
    now: () => FIXED_NOW,
    notify: null,
  };
}

function articleSnapshot() {
  return normalizeFeedItems(
    "nyt-world",
    [{ guid: "1", title: HEADLINE, url: "https://example.com/quokkas", summary: REPORT }],
    { now: FIXED_NOW },
  )[0];
}

/** A KB that knows one word, answering in the shape a real lookup answers:
 *  structured facts plus the article's own prose, under the source's own
 *  research: provenance tag. */
function kbDefining(term, { isa, summary }) {
  return ({ source }) => ({
    name: source,
    origin: "https://example.org",
    provenanceTag: (t) => `research:${source}:${t}`,
    async lookup(asked) {
      if (asked !== term) return null;
      return {
        term, title: term, text: summary, summary, url: `https://example.org/${term}`, revid: 1, isa,
        facts: [{ subject: term, predicate: "rdfs:subClassOf", object: isa, provenance: `research:${source}:${term}` }],
      };
    },
  });
}

const rowsOf = async (ctx) => readFactRows(await loadMemory(ctx.memoryDir));
const triple = (r) => `${r.subject} | ${r.predicate} | ${r.object}`;
const fromThisArticle = (r) => String(r.provenance || "").includes("news:nyt-world");

test("a definition the enrichment cycle fetches lets a sentence ground that could not ground before, and files it on the article", async () => {
  const ctx = await makeCtx();
  const snapshot = articleSnapshot();
  ctx.state.items = [snapshot];

  await ingestNewsSnapshot(ctx, snapshot);
  const afterIngest = await rowsOf(ctx);
  const articleFactsBefore = afterIngest.filter(fromThisArticle).map(triple).sort();
  assert.deepEqual(
    articleFactsBefore,
    ["quokka | rdfs:subClassOf | marsupial"],
    "the class claim is read, at the optimistic tier; the pronoun-led sentence after it grounds nothing",
  );
  assert.equal(
    afterIngest.find((r) => triple(r) === "quokka | rdfs:subClassOf | marsupial").provenance.includes("optimistic-extract:"),
    true,
    "nothing anchors 'marsupial' yet, so the strict recognizer turned the sentence down",
  );
  assert.equal(snapshot.factIds.length, 1, "the article has contributed exactly one fact so far");

  const queued = rankedTerms(ledgerFromPayload(ctx.state.ledger), {
    limit: 20, status: "pending", now: FIXED_NOW, ttlMs: ctx.config.negativeCacheTtlHours * 3600000,
  }).map((e) => e.term);
  assert.ok(queued.includes("marsupial"), `the class the article named is queued for a lookup: ${queued.join(", ")}`);

  ctx.providers.getResearchProvider = kbDefining("marsupial", {
    isa: "mammal", summary: "A marsupial is a mammal.",
  });

  const enriched = await enrichTopTerms(ctx);
  assert.deepEqual(enriched.enriched, ["marsupial"], "the lookup hit");

  const afterEnrich = await rowsOf(ctx);
  const definition = afterEnrich.find((r) => triple(r) === "marsupial | rdfs:subClassOf | mammal");
  assert.ok(definition, "the definition is stored");
  assert.match(
    definition.provenance,
    /research:wikidata:marsupial/,
    "under the lookup's own provenance — anchoring rides that tag, not a corpus or teach one",
  );

  const articleFactsAfter = afterEnrich.filter(fromThisArticle).map(triple).sort();
  assert.deepEqual(
    articleFactsAfter,
    ["quokka | mgx:hasA | pouch", "quokka | rdfs:subClassOf | marsupial"],
    "the pronoun-led sentence grounds now that the class it leans on is defined",
  );

  const pouchRow = afterEnrich.find((r) => triple(r) === "quokka | mgx:hasA | pouch");
  assert.ok(
    snapshot.factIds.includes(pouchRow.id),
    "and it is filed on the article that stated it, which is what puts it in the card's facts learned",
  );
  assert.equal(snapshot.factIds.length, 2, "the article's own contribution grew");
});

test("re-grounding adds nothing when the lookup misses, so a card never gains a fact the article did not state", async () => {
  const ctx = await makeCtx();
  const snapshot = articleSnapshot();
  ctx.state.items = [snapshot];

  await ingestNewsSnapshot(ctx, snapshot);
  const before = (await rowsOf(ctx)).map(triple).sort();

  ctx.providers.getResearchProvider = kbDefining("something-else", { isa: "thing", summary: "" });
  const enriched = await enrichTopTerms(ctx);
  assert.deepEqual(enriched.enriched, [], "every lookup missed");

  const after = (await rowsOf(ctx)).map(triple).sort();
  assert.deepEqual(after, before, "a miss is a miss: no definition, no new grounding");
  assert.equal(snapshot.factIds.length, 1, "the article's own facts are unchanged");
});
