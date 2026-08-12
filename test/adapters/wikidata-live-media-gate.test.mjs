// A Wikidata title match can land on a paper, an album or a film that merely
// SHARES a term's name rather than answering it — Wikidata's own search
// ranks by string closeness, not by whether the hit is the everyday concept
// the term names. This file proves the closed media/document class gate: a
// candidate whose instance-of/subclass-of is one of those classes is skipped
// for the next title match, and a term with no non-media match left is an
// honest miss, never a wrong identity. It also proves a multi-word term
// searches and stores whole, and that its provenance tag stays a single
// whitespace-free token.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createWikidataLiveProvider } from "../../src/adapters/corpus/wikidata-live.mjs";
import { researchFacts, isResearchSourceRow } from "../../src/adapters/corpus/research-source.mjs";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

function idsParam(url) {
  return new URL(url).searchParams.get("ids") ?? "";
}

/** A stubbed Action API: `search` is the raw wbsearchentities hit list (id +
 *  label), `entities` maps every id this scenario's claims can name — its own
 *  item AND every object id its claims point at — to { label, claims }. Every
 *  wbgetentities request, whether for one candidate item or a batch of claim
 *  object ids, is answered out of the same map. */
function wikidataTransport({ search, entities }) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("action=wbsearchentities")) return jsonResponse({ search });
    const requested = idsParam(u).split("|").filter(Boolean);
    const out = {};
    for (const id of requested) {
      const row = entities[id];
      if (!row) continue;
      out[id] = {
        id,
        lastrevid: 1,
        labels: { en: { value: row.label } },
        descriptions: { en: { value: row.description ?? `${row.label} description.` } },
        claims: row.claims ?? {},
      };
    }
    return jsonResponse({ entities: out });
  };
  return { calls, fetchImpl };
}

const claim = (id) => ({ mainsnak: { snaktype: "value", datavalue: { value: { id } } } });

function build(fetchImpl) {
  return createWikidataLiveProvider({ fetchImpl, minIntervalMs: 0 });
}

test("a scholarly-article title match is a miss, not a definition", async () => {
  const { fetchImpl } = wikidataTransport({
    search: [{ id: "Q1", label: "Canadian companies" }],
    entities: {
      Q1: { label: "Canadian companies", claims: { P31: [claim("Q2")] } },
      Q2: { label: "scholarly article" },
    },
  });
  const source = build(fetchImpl);
  const row = await source.lookup("canadian companies");
  assert.equal(row, null, "a paper sharing the term's name is a miss");
  assert.deepEqual(researchFacts(source, "canadian companies", row), []);
});

test("an album title match is a miss, not a definition", async () => {
  const { fetchImpl } = wikidataTransport({
    search: [{ id: "Q1", label: "Continents" }],
    entities: {
      Q1: { label: "Continents", claims: { P31: [claim("Q2")] } },
      Q2: { label: "album" },
    },
  });
  const source = build(fetchImpl);
  const row = await source.lookup("continents");
  assert.equal(row, null, "an album sharing the term's name is a miss");
});

test("a media-class candidate is skipped for the next title match, which grounds normally", async () => {
  const { fetchImpl } = wikidataTransport({
    search: [
      { id: "Q1", label: "Canadian companies" },
      { id: "Q2", label: "Canadian companies Ltd" },
    ],
    entities: {
      Q1: { label: "Canadian companies", claims: { P31: [claim("Q10")] } },
      Q10: { label: "scholarly article" },
      Q2: { label: "Canadian companies Ltd", claims: { P279: [claim("Q20")] } },
      Q20: { label: "company" },
    },
  });
  const source = build(fetchImpl);
  const row = await source.lookup("canadian companies");
  assert.ok(row, "the second candidate grounds the term");
  assert.equal(row.term, "canadian companies", "the whole multi-word term is kept, not truncated");
  assert.equal(row.isa, "company");
  const facts = researchFacts(source, "canadian companies", row);
  assert.deepEqual(facts.map((f) => [f.subject, f.predicate, f.object]), [
    ["canadian companies", "rdfs:subClassOf", "company"],
  ]);
});

test("an operating system title match still grounds — the gate is a closed list, not a blanket refusal", async () => {
  const { fetchImpl } = wikidataTransport({
    search: [{ id: "Q1", label: "AmigaDOS" }],
    entities: {
      Q1: { label: "AmigaDOS", claims: { P31: [claim("Q2")] } },
      Q2: { label: "disk operating system" },
    },
  });
  const source = build(fetchImpl);
  const row = await source.lookup("amigados");
  assert.ok(row, "an operating system is not a media/document class");
  assert.equal(row.isa, "disk operating system");
  assert.ok(isResearchSourceRow(row));
});

test("a capital-city subclass-of match still grounds", async () => {
  const { fetchImpl } = wikidataTransport({
    search: [{ id: "Q1", label: "Cali" }],
    entities: {
      Q1: { label: "Cali", claims: { P279: [claim("Q2")] } },
      Q2: { label: "capital" },
    },
  });
  const source = build(fetchImpl);
  const row = await source.lookup("cali");
  assert.ok(row);
  assert.equal(row.isa, "capital");
});

test("a multi-word term is searched whole, not on its first word only", async () => {
  const { calls, fetchImpl } = wikidataTransport({
    search: [{ id: "Q1", label: "Canadian companies Ltd" }],
    entities: {
      Q1: { label: "Canadian companies Ltd", claims: { P279: [claim("Q2")] } },
      Q2: { label: "company" },
    },
  });
  const source = build(fetchImpl);
  await source.lookup("canadian companies");
  const searchCall = calls.find((u) => u.includes("action=wbsearchentities"));
  assert.ok(searchCall, "a search round trip happened");
  const searchParam = new URL(searchCall).searchParams.get("search");
  assert.equal(searchParam, "canadian companies", "the whole term is sent, not just its first word");
});

test("a multi-word term's provenance tag stays one whitespace-free token", async () => {
  const { fetchImpl } = wikidataTransport({
    search: [{ id: "Q1", label: "Canadian companies Ltd" }],
    entities: {
      Q1: { label: "Canadian companies Ltd", claims: { P279: [claim("Q2")] } },
      Q2: { label: "company" },
    },
  });
  const source = build(fetchImpl);
  const tag = source.provenanceTag("canadian companies");
  assert.equal(tag, "research:wikidata:canadian_companies");
  assert.equal(tag.split(/\s+/).length, 1, "no whitespace-naive reader can drop part of this tag");
  const row = await source.lookup("canadian companies");
  const facts = researchFacts(source, "canadian companies", row);
  assert.ok(facts.length > 0);
  for (const fact of facts) assert.equal(fact.provenance, tag);
});
