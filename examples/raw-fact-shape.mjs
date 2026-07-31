import { createInMemoryStore, appendFact, loadMemory } from "@polycode-projects/the-mechanical-code-talker/memory";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The same two facts already used elsewhere in this repo's docs, so a reader
// who saw one of them in prose can find it here byte-for-byte in its stored
// shape (minus the two timestamps, normalized below so this output is
// reproducible run to run).
export const FACTS = [
  { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" },
  { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA" },
];

const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

function normalizeTimestamps(text) {
  return text.replace(TIMESTAMP_RE, "<timestamp>");
}

/** `mgx:trustInputs` is the one attribute whose value is itself a JSON-
 *  encoded object (every other attribute value here is a plain string) —
 *  parse it back out for display so the printed record shows real nested
 *  JSON instead of a double-escaped string. This is a display-only
 *  transform: the store itself still holds it JSON.stringify'd inside the
 *  flat attribute value. */
function withReadableTrustInputs(fact) {
  return {
    ...fact,
    attributes: fact.attributes.map((attr) =>
      attr.prop === "mgx:trustInputs" ? { ...attr, value: JSON.parse(attr.value) } : attr,
    ),
  };
}

export async function runExample() {
  const dir = createInMemoryStore();
  for (const fact of FACTS) await appendFact(dir, fact);
  const memory = await loadMemory(dir);
  const stored = FACTS.map(({ subject, predicate, object }) =>
    memory.individuals.find(
      (i) => i.class === "Fact"
        && i.attributes.some((a) => a.prop === "rdf:subject" && a.value === subject)
        && i.attributes.some((a) => a.prop === "rdf:predicate" && a.value === predicate)
        && i.attributes.some((a) => a.prop === "rdf:object" && a.value === object),
    ),
  );
  return stored.map((fact) => normalizeTimestamps(JSON.stringify(withReadableTrustInputs(fact), null, 2)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rendered = await runExample();
  console.log(rendered.join("\n\n"));
}
