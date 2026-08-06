// The contract every research source adapter meets, run once per registered
// source. A source names itself and its origin, resolves a term it can ground
// into an article row, licenses facts that all carry its own provenance tag,
// answers a term it cannot ground with nothing at all, and never throws — not
// on a dead transport, not on a garbage body, not on an empty term.
//
// Every source is driven through a stub transport, so the suite runs offline.
// Each adapter's own module owns the live endpoint; here the fetch layer is
// canned at exactly the seam the adapter's own tests already stub.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isResearchSource,
  isResearchSourceRow,
  isResearchFact,
  researchFacts,
  researchSources,
  RESEARCH_SOURCE_RELATIONS,
} from "../../src/adapters/corpus/research-source.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";

// Importing an adapter module registers it, so this is also what decides which
// sources the contract runs against.
import "../../src/adapters/corpus/wikipedia-live.mjs";
import "../../src/adapters/corpus/wikidata-live.mjs";

const GROUNDED_TERM = "quasar";
const UNGROUNDED_TERM = "zorblattian";

const QUASAR_EXTRACT = "A quasar is a very bright object in space. It is powered by a black hole.";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** Simple English Wikipedia: opensearch, then the REST page summary. */
function wikipediaTransport() {
  return async (url) => {
    const u = String(url);
    if (u.includes("action=opensearch")) {
      const hit = u.includes(`search=${GROUNDED_TERM}`);
      return jsonResponse(hit ? ["q", ["Quasar"], [""], [""]] : ["q", [], [], []]);
    }
    if (u.includes("action=parse")) return jsonResponse({ parse: { links: [] } });
    return jsonResponse({
      title: "Quasar",
      extract: QUASAR_EXTRACT,
      revision: "1234567",
      content_urls: { desktop: { page: "https://simple.wikipedia.org/wiki/Quasar" } },
    });
  };
}

/** Wikidata: wbsearchentities, the item read, then the batched object labels. */
function wikidataTransport() {
  const labels = {
    Q17444909: "astronomical object type",
    Q46587: "active galactic nucleus",
    Q318: "galaxy",
  };
  return async (url) => {
    const u = String(url);
    if (u.includes("action=wbsearchentities")) {
      const hit = u.includes(`search=${GROUNDED_TERM}`);
      return jsonResponse({ search: hit ? [{ id: "Q83373", label: "quasar" }] : [] });
    }
    if (u.includes("ids=Q83373")) {
      return jsonResponse({
        entities: {
          Q83373: {
            id: "Q83373",
            lastrevid: 2523169218,
            labels: { en: { value: "quasar" } },
            descriptions: { en: { value: "extremely luminous active galactic nuclei" } },
            claims: {
              P31: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q17444909" } } } }],
              P279: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q46587" } } } }],
              P361: [{ mainsnak: { snaktype: "value", datavalue: { value: { id: "Q318" } } } }],
              P1082: [{ mainsnak: { snaktype: "value", datavalue: { value: 42 } } }],
            },
          },
        },
      });
    }
    const entities = {};
    for (const id of Object.keys(labels)) {
      if (u.includes(id)) entities[id] = { labels: { en: { value: labels[id] } } };
    }
    return jsonResponse({ entities });
  };
}

const TRANSPORT_BY_SOURCE = {
  "simple-wikipedia": wikipediaTransport,
  wikidata: wikidataTransport,
};

const build = (entry, fetchImpl) => entry.create({ fetchImpl, minIntervalMs: 0 });

test("every registered research source has a stub transport, so none skips the contract", () => {
  const registered = researchSources().map((entry) => entry.name);
  assert.ok(registered.length >= 2, `expected at least two registered sources, got ${registered.length}`);
  for (const name of registered) {
    assert.ok(TRANSPORT_BY_SOURCE[name], `no stub transport for registered source "${name}"`);
  }
});

for (const entry of researchSources()) {
  const transport = () => TRANSPORT_BY_SOURCE[entry.name]();

  test(`${entry.name}: names itself and the origin it fetches from`, () => {
    const source = build(entry, transport());
    assert.ok(isResearchSource(source), "the adapter satisfies the source interface");
    assert.equal(source.name, entry.name, "the instance name matches the registered name");
  });

  test(`${entry.name}: its provenance tag reads back as a live-reference Source`, () => {
    const source = build(entry, transport());
    const tag = source.provenanceTag(GROUNDED_TERM);
    assert.equal(typeof tag, "string");
    assert.ok(tag.length > 0, "the tag is not empty");
    const parsed = provenanceTagToSource(tag);
    assert.ok(parsed, `the trust reader parses "${tag}"`);
    assert.equal(parsed.kind, "referenceLive", "a live-fetched fact scores below every curated pack");
  });

  test(`${entry.name}: a term it can ground resolves to a valid article row`, async () => {
    const source = build(entry, transport());
    const row = await source.lookup(GROUNDED_TERM);
    assert.ok(row, "the lookup resolves");
    assert.ok(isResearchSourceRow(row), "the row passes the shared shape validator");
    assert.equal(row.term, GROUNDED_TERM, "the row keys on the looked-up term");
  });

  test(`${entry.name}: every fact it licenses carries its own provenance tag and a mapped relation`, async () => {
    const source = build(entry, transport());
    const row = await source.lookup(GROUNDED_TERM);
    const facts = researchFacts(source, GROUNDED_TERM, row);
    assert.ok(facts.length > 0, "a grounded term licenses at least one fact");
    const tag = source.provenanceTag(GROUNDED_TERM);
    for (const fact of facts) {
      assert.ok(isResearchFact(fact), `not a valid research fact: ${JSON.stringify(fact)}`);
      assert.equal(fact.provenance, tag, "the fact carries this source's tag");
      assert.ok(RESEARCH_SOURCE_RELATIONS.includes(fact.predicate), `unmapped relation "${fact.predicate}"`);
    }
  });

  test(`${entry.name}: a term it cannot ground returns nothing, and licenses nothing`, async () => {
    const source = build(entry, transport());
    const row = await source.lookup(UNGROUNDED_TERM);
    assert.equal(row, null, "a missing term is a miss, never a guess");
    assert.deepEqual(researchFacts(source, UNGROUNDED_TERM, row), [], "a miss licenses no facts");
  });

  test(`${entry.name}: an empty, null or undefined term returns nothing without a round trip`, async () => {
    const calls = [];
    const counted = async (url) => {
      calls.push(String(url));
      return transport()(url);
    };
    const source = build(entry, counted);
    for (const term of ["", null, undefined]) {
      assert.equal(await source.lookup(term), null, `"${term}" is a miss`);
    }
    assert.equal(calls.length, 0, "an empty term never reaches the network");
  });

  test(`${entry.name}: a whitespace-only term is a miss`, async () => {
    const source = build(entry, transport());
    assert.equal(await source.lookup("   "), null);
  });

  test(`${entry.name}: a dead transport reads as a miss rather than throwing`, async () => {
    const source = build(entry, async () => { throw new Error("network down"); });
    assert.equal(await source.lookup(GROUNDED_TERM), null);
  });

  test(`${entry.name}: a garbage response body reads as a miss rather than throwing`, async () => {
    const source = build(entry, async () => jsonResponse({ nothing: "the adapter expects" }));
    assert.equal(await source.lookup(GROUNDED_TERM), null);
  });

  test(`${entry.name}: an unparseable response body reads as a miss rather than throwing`, async () => {
    const source = build(entry, async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => { throw new SyntaxError("not JSON"); },
    }));
    assert.equal(await source.lookup(GROUNDED_TERM), null);
  });
}

test("the wikidata source maps its structured claims onto seed-ontology relations at its own boundary", async () => {
  const entry = researchSources().find((e) => e.name === "wikidata");
  const source = entry.create({ fetchImpl: wikidataTransport(), minIntervalMs: 0 });
  const row = await source.lookup(GROUNDED_TERM);
  const triples = researchFacts(source, GROUNDED_TERM, row).map((f) => [f.predicate, f.object]);
  assert.deepEqual(triples, [
    ["rdf:type", "astronomical object type"],
    ["rdfs:subClassOf", "active galactic nucleus"],
    ["mgx:partOf", "galaxy"],
  ], "instance-of, subclass-of and part-of map through; a quantity-valued claim has no object term and drops");
  assert.equal(row.source, "Wikidata");
  assert.equal(row.licence, "CC0 1.0");
});

test("the simple-wikipedia source licenses the lead sentence's category as a subclass edge", async () => {
  const entry = researchSources().find((e) => e.name === "simple-wikipedia");
  const source = entry.create({ fetchImpl: wikipediaTransport(), minIntervalMs: 0 });
  const row = await source.lookup(GROUNDED_TERM);
  assert.equal(row.facts, undefined, "a prose source carries no pre-mapped claims");
  assert.deepEqual(researchFacts(source, GROUNDED_TERM, row), [{
    subject: "quasar",
    predicate: "rdfs:subClassOf",
    object: row.isa,
    provenance: "research:simple-wikipedia:quasar",
  }]);
});
