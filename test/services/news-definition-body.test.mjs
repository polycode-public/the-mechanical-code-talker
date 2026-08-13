// What the enrichment cycle is allowed to read out of a definition body.
// A KB answers in two very different shapes under the same `summary` field: a
// reference article's opening prose ("AmigaDOS is the disk operating system of
// the AmigaOS") and an entity description, which is a bare noun phrase naming
// the class ("disk operating system of the AmigaOS"). Read as a sentence, the
// second one states a fact about a word inside itself. Every lookup here is a
// stub — no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { clampNewsConfig, createNewsState, enrichTopTerms } from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { createTermLedger, bumpTerms, ledgerPayload } from "../../src/domain/term-ledger.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";

const FIXED_NOW = "2026-08-12T00:00:00.000Z";

async function ctxAwaiting(term, { kbSources = ["wikidata"] } = {}) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([[term, 2]]), "item-1", FIXED_NOW, new Map());
  return {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config: clampNewsConfig({ kbSources, enrichTermsPerCycle: 1 }),
    state: { ...createNewsState(), ledger: ledgerPayload(ledger) },
    providers: {},
    now: () => FIXED_NOW,
    notify: null,
  };
}

/** A KB answering for one term. `facts` is what the structured seam licenses;
 *  `summary` is the body, in whichever of the two shapes the case is about. */
function kbAnswering(term, { summary, isa = "", facts = null, title = term }) {
  return ({ source }) => ({
    name: source,
    origin: "https://example.org",
    provenanceTag: (t) => `research:${source}:${t}`,
    async lookup(asked) {
      if (asked !== term) return null;
      const article = { term, title, text: summary, summary, url: `https://example.org/${term}`, revid: 1 };
      if (isa) article.isa = isa;
      if (facts) {
        article.facts = facts.map(([predicate, object]) => ({
          subject: term, predicate, object, provenance: `research:${source}:${term}`,
        }));
      }
      return article;
    },
  });
}

const triple = (r) => `${r.subject} | ${r.predicate} | ${r.object}`;

test("an entity description names the class rather than stating anything, so nothing is read out of it as a sentence", async () => {
  const ctx = await ctxAwaiting("amigados");
  ctx.providers.getResearchProvider = kbAnswering("amigados", {
    summary: "disk operating system of the AmigaOS",
    facts: [["rdf:type", "disk operating system"], ["mgx:partOf", "amigaos"]],
  });

  const result = await enrichTopTerms(ctx);
  assert.deepEqual(result.enriched, ["amigados"], "the lookup still hits");

  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple).sort();
  assert.deepEqual(
    rows,
    ["amigados | mgx:partOf | amigaos", "amigados | rdf:type | disk operating system"],
    "only what the source itself stated — no fact about a word inside the phrase",
  );
  assert.equal(
    rows.some((r) => r.startsWith("disk | ")),
    false,
    "'disk operating system of the AmigaOS' is never read as 'disk operates a system of the amigaos'",
  );
});

test("a class the lookup already stated is never re-guessed off the same body's opening words", async () => {
  const ctx = await ctxAwaiting("amigados");
  ctx.providers.getResearchProvider = kbAnswering("amigados", {
    summary: "AmigaDOS is the disk operating system of the AmigaOS.",
    facts: [["rdf:type", "disk operating system"]],
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.ok(rows.includes("amigados | rdf:type | disk operating system"), "the source's own class claim stands");
  assert.equal(
    rows.includes("amigados | rdf:type | disk"),
    false,
    `a truncated second class is not minted beside it: ${JSON.stringify(rows)}`,
  );
});

test("a body that states relations still gives them up, even where the lookup already stated the class", async () => {
  const ctx = await ctxAwaiting("rottnest", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("rottnest", {
    summary: "A rottnest is an island. Rottnest has a lighthouse.",
    isa: "island",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).filter((r) => r.subject === "rottnest");
  assert.ok(rows.some((r) => r.object === "island"), "the class the source licensed is stored");
  assert.ok(
    rows.some((r) => r.predicate === "mgx:hasA" && r.object.includes("lighthouse")),
    `and the relation the body states is read: ${JSON.stringify(rows.map(triple))}`,
  );
});

test("a claim about another term the body only mentions in passing is not written", async () => {
  const ctx = await ctxAwaiting("solar eclipse", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("solar eclipse", {
    summary: "As seen from earth, a solar eclipse happens when the moon is directly between the earth and the sun. "
      + "Every year there are about two solar eclipses.",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.deepEqual(rows, [], `a year is not a kind of eclipse: ${JSON.stringify(rows)}`);
});

test("the strict tier's own reading is held to the term as well", async () => {
  const ctx = await ctxAwaiting("earthquake", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("earthquake", {
    summary: "An earthquake shakes the ground. Strong earthquakes damage buildings.",
    isa: "tremor",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.ok(rows.includes("earthquake | rdfs:subClassOf | tremor"), `the licensed class stands: ${JSON.stringify(rows)}`);
  assert.equal(
    rows.some((r) => r.startsWith("strong | ")),
    false,
    `"Strong earthquakes damage buildings" says nothing about a thing called strong: ${JSON.stringify(rows)}`,
  );
});

test("a class the body denies is never minted as one it states", async () => {
  const ctx = await ctxAwaiting("puerto rico", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("puerto rico", {
    summary: "Puerto Rico is not an independent country, but like all populated U.S. territories, "
      + "it has more autonomy than U.S. states.",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.equal(
    rows.some((r) => r.endsWith("| country")),
    false,
    `the sentence denies the class it would be read from: ${JSON.stringify(rows)}`,
  );
});

test("a class read out of the clause a copula opens is not the class the body states", async () => {
  const ctx = await ctxAwaiting("earthquake", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("earthquake", {
    summary: "An earthquake is when Earth's tectonic plates shake and move Earth's surface.",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.equal(
    rows.includes("earthquake | rdfs:subClassOf | earth"),
    false,
    `"is when tectonic plates shake" states no class: ${JSON.stringify(rows)}`,
  );
});

test("a class stated behind its own modifiers still lands", async () => {
  const ctx = await ctxAwaiting("tsunami", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("tsunami", {
    summary: "A tsunami is a natural disaster, a series of fast-moving waves in the ocean.",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.ok(
    rows.includes("tsunami | rdfs:subClassOf | disaster"),
    `"is a natural disaster" states the class it is read as: ${JSON.stringify(rows)}`,
  );
});

test("the body may name the term by the title the source answered with, or in the plural", async () => {
  const byTitle = await ctxAwaiting("rottnest", { kbSources: ["simple-wikipedia"] });
  byTitle.providers.getResearchProvider = kbAnswering("rottnest", {
    title: "Rottnest Island",
    summary: "A rottnest island is an island.",
  });
  await enrichTopTerms(byTitle);
  const titleRows = readFactRows(await loadMemory(byTitle.memoryDir)).map(triple);
  assert.ok(
    titleRows.includes("rottnest island | rdfs:subClassOf | island"),
    `the title is the same thing the term is: ${JSON.stringify(titleRows)}`,
  );

  const inPlural = await ctxAwaiting("quokka", { kbSources: ["simple-wikipedia"] });
  inPlural.providers.getResearchProvider = kbAnswering("quokka", {
    summary: "A quokka is a marsupial. Quokkas have a tail.",
    isa: "marsupial",
  });
  await enrichTopTerms(inPlural);
  const pluralRows = readFactRows(await loadMemory(inPlural.memoryDir)).map(triple);
  assert.ok(
    pluralRows.includes("quokkas | mgx:hasA | tail"),
    `a body says "quokkas" for the same animal: ${JSON.stringify(pluralRows)}`,
  );
});

test("a source that licenses no class at all still gets its body read for one", async () => {
  const ctx = await ctxAwaiting("quokka", { kbSources: ["simple-wikipedia"] });
  ctx.providers.getResearchProvider = kbAnswering("quokka", {
    summary: "A quokka is a marsupial.",
  });

  await enrichTopTerms(ctx);
  const rows = readFactRows(await loadMemory(ctx.memoryDir)).map(triple);
  assert.ok(
    rows.includes("quokka | rdfs:subClassOf | marsupial"),
    `the body is the only thing saying what a quokka is, so it is read: ${JSON.stringify(rows)}`,
  );
});
