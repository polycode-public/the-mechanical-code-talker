// Read-only consumers of the conversational-memory graph (corpus facts, separate from
// the code-map graph.json). The fall-through the concept-shaped tools use: when the
// code-map resolves nothing for a concept query, answer from the reified isa-family
// facts instead, always citing provenance.

import { dirname } from "node:path";
import { loadMemory, openConfiguredMemoryBackend, readFactRows, normFactTerm } from "../adapters/memory/core.mjs";

// The reified isa-family predicates a memory Fact carries ("<subject> rdfs:subClassOf
// <object>" / "rdf:type"): subject IS-A object. Subclasses of X = facts whose OBJECT is X;
// superclasses of X = facts whose SUBJECT is X. (Matches chat.mjs's ISA_PREDICATES.)
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);
const MEMORY_LIST_CAP = 40;

/** Load the conversational-memory Facts as trust-bearing rows, failure-tolerant (no memory
 *  store / unreadable → [], so the tool still returns its honest code-map miss). repoRoot is
 *  the dir that CONTAINS .tmct/ (graphFile = <repo>/.tmct/graph.json). The read goes through
 *  the repo's CONFIGURED memory backend — the same store chat's taught facts land in — opened
 *  fresh per call and closed before returning, never the retired flat-file store off a raw
 *  repo path. */
export async function memoryFactRows(config) {
  try {
    const { dir, close } = await openConfiguredMemoryBackend(dirname(dirname(config.graphFile)));
    try {
      return readFactRows(await loadMemory(dir));
    } finally {
      await close();
    }
  } catch {
    return [];
  }
}

/** A short provenance receipt for a set of memory rows — distinct source strings, capped. */
function memoryProvenance(rows) {
  const provs = [...new Set(rows.map((r) => r.provenance).filter(Boolean))];
  if (!provs.length) return "provenance: memory/corpus facts";
  const shown = provs.slice(0, 2).join("; ");
  return `provenance: ${shown}${provs.length > 2 ? `, +${provs.length - 2} more source(s)` : ""}`;
}

/** Subclasses of a concept from the reified isa-family facts (subjects of
 *  "<subj> subClassOf <term>"). Null when the term names no such facts, so the caller can
 *  keep the honest code-map miss. Provenance is always cited. */
export function renderMemorySubclasses(rows, term) {
  const t = normFactTerm(term);
  const hits = rows.filter((r) => ISA_PREDICATES.has(r.predicate) && r.object === t);
  if (!hits.length) return null;
  const labels = [...new Set(hits.map((r) => r.subject))].sort();
  const shown = labels.slice(0, MEMORY_LIST_CAP);
  const tail = labels.length > MEMORY_LIST_CAP ? `\n  …+${labels.length - MEMORY_LIST_CAP} more` : "";
  return `"${term}" is not a code-map entity — answering from memory/corpus facts. ` +
    `${labels.length} known subclass(es):\n  ${shown.join("\n  ")}${tail}\n(${memoryProvenance(hits)})`;
}

/** A concept's DEFINITION from the isa-family facts — its superclasses ("is a …") plus a
 *  count/sample of its known subclasses. Null when the term names no facts. */
export function renderMemoryDefinition(rows, term) {
  const t = normFactTerm(term);
  const isa = rows.filter((r) => ISA_PREDICATES.has(r.predicate) && (r.subject === t || r.object === t));
  if (!isa.length) return null;
  const supers = [...new Set(isa.filter((r) => r.subject === t).map((r) => r.object))];
  const subs = [...new Set(isa.filter((r) => r.object === t).map((r) => r.subject))].sort();
  const lines = [`"${term}" is not a code-map entity — answering from memory/corpus facts.`];
  if (supers.length) lines.push(`is a: ${supers.slice(0, MEMORY_LIST_CAP).join(", ")}`);
  if (subs.length) {
    const tail = subs.length > MEMORY_LIST_CAP ? `, +${subs.length - MEMORY_LIST_CAP} more` : "";
    lines.push(`known subclasses (${subs.length}): ${subs.slice(0, MEMORY_LIST_CAP).join(", ")}${tail}`);
  }
  lines.push(`(${memoryProvenance(isa)})`);
  return lines.join("\n");
}
