// scripts/claims/claim-research-sources.mjs — how many research sources are
// registered AND actually meet the contract against their live endpoints.
//
// The contract test proves the shape offline with stubbed transports. This rig
// proves the same adapters still work against the real APIs: it probes each
// registered source with a couple of terms it should ground and one word that
// exists nowhere, then reports the facts each one gained and the provenance tag
// those facts carry.
//
// It never invents a number. A source that grounds nothing is reported as a
// failure, and when NO source grounds anything (the offline case, where a real
// miss and an unreachable network look the same) the rig exits nonzero and
// leaves the committed claim alone rather than overwriting it with a zero.
import {
  isResearchFact,
  isResearchSource,
  isResearchSourceRow,
  researchFacts,
  researchSources,
} from "../../src/adapters/corpus/research-source.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

// Importing an adapter registers it, so these two imports are what decides
// which sources the rig probes.
import "../../src/adapters/corpus/wikipedia-live.mjs";
import "../../src/adapters/corpus/wikidata-live.mjs";

// Kept deliberately small: every lookup takes a polite slot, so this is
// seconds of real waiting, and the point is that the adapters still answer,
// not how much they can fetch.
const PROBE_TERMS = ["quasar", "volcano"];
// A word no encyclopedia and no knowledge base has an entry for. It must come
// back empty from every source: the honest miss is part of the contract.
const UNGROUNDABLE_TERM = "zorblattian";

async function probe(entry) {
  const failures = [];
  const source = entry.create();
  if (!isResearchSource(source)) failures.push("does not satisfy the source interface");

  const tag = source.provenanceTag(PROBE_TERMS[0]);
  if (!provenanceTagToSource(tag)) failures.push(`provenance tag "${tag}" does not read back as a Source`);

  const grounded = [];
  const relations = {};
  let factsGained = 0;
  for (const term of PROBE_TERMS) {
    const row = await source.lookup(term);
    if (!row) continue;
    if (!isResearchSourceRow(row)) {
      failures.push(`"${term}" resolved to a row that fails the shape validator`);
      continue;
    }
    grounded.push(term);
    const termTag = source.provenanceTag(term);
    for (const fact of researchFacts(source, term, row)) {
      if (!isResearchFact(fact)) failures.push(`"${term}" licensed an invalid fact: ${JSON.stringify(fact)}`);
      else if (fact.provenance !== termTag) failures.push(`"${term}" licensed a fact tagged "${fact.provenance}", not "${termTag}"`);
      relations[fact.predicate] = (relations[fact.predicate] ?? 0) + 1;
      factsGained += 1;
    }
  }

  const missRow = await source.lookup(UNGROUNDABLE_TERM);
  if (missRow) failures.push(`"${UNGROUNDABLE_TERM}" resolved to a row instead of an honest miss`);

  if (grounded.length === 0) failures.push(`grounded none of: ${PROBE_TERMS.join(", ")}`);
  if (factsGained === 0) failures.push("gained no facts from any probe term");

  return {
    name: entry.name,
    origin: source.origin,
    provenanceTag: tag,
    grounded,
    factsGained,
    relations,
    failures,
  };
}

async function main() {
  const entries = researchSources();
  if (entries.length === 0) {
    console.error("claim:research-sources: no research source is registered");
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const entry of entries) results.push(await probe(entry));

  const reachedSomething = results.some((r) => r.grounded.length > 0);
  if (!reachedSomething) {
    console.error("claim:research-sources: no source grounded any probe term, so the endpoints are unreachable or every adapter is broken.");
    console.error("Nothing was written — a run that cannot reach the network has no number to report.");
    for (const r of results) console.error(`  - ${r.name} (${r.origin}): ${r.failures.join("; ")}`);
    process.exitCode = 1;
    return;
  }

  const passing = results.filter((r) => r.failures.length === 0);
  for (const r of results) {
    const status = r.failures.length === 0 ? "ok" : `FAILED: ${r.failures.join("; ")}`;
    console.log(`  ${r.name} (${r.origin}) — ${r.grounded.length}/${PROBE_TERMS.length} grounded, ${r.factsGained} facts, tag "${r.provenanceTag}" — ${status}`);
  }

  const record = writeClaim("research-sources", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "sources",
    threshold: { direction: "min", value: 2 },
    value: passing.length,
    sources: [
      "src/adapters/corpus/research-source.mjs",
      "src/adapters/corpus/wikipedia-live.mjs",
      "src/adapters/corpus/wikidata-live.mjs",
      "test/adapters/research-source-contract.test.mjs",
      "scripts/claims/claim-research-sources.mjs",
    ],
    detail: {
      probeTerms: PROBE_TERMS,
      ungroundableTerm: UNGROUNDABLE_TERM,
      registered: results.map((r) => r.name),
      perSource: Object.fromEntries(results.map((r) => [r.name, {
        origin: r.origin,
        provenanceTag: r.provenanceTag,
        grounded: r.grounded,
        factsGained: r.factsGained,
        relations: r.relations,
        failures: r.failures,
      }])),
    },
  });
  console.log(`claim:research-sources: ${record.value} of ${results.length} registered source(s) meet the contract live (threshold ${record.threshold.direction} ${record.threshold.value})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
