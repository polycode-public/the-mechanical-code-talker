// ingest-facts.mjs — the projection from an ingest session's stored fact rows
// to the `{individuals, objectProperties}` payload parseEntities consumes, so
// the ingest page can hand `ask()` a real graph of what a visitor just pasted
// instead of an empty one. The ingest counterpart to ask.mjs's
// worldRelationGraphPayload and sprite-facts.mjs's spriteFactGraphPayload.
//
// It is shaped differently from both, because the domain is different.
//
// A world knows its own predicates ahead of time (ask-vocab.mjs's
// WORLD_PREDICATES) and a sprite catalog knows its own subjects ahead of time
// (one per template class), so each of those projections carries a curated
// predicate or class table. Ingest knows neither: the vocabulary is whatever
// the visitor's own prose grounded. So nothing here is curated by predicate
// name at all — every row travels as an edge under its own predicate, and the
// only rule with a table behind it is which predicates carry a CLASS.
//
// The class rule is what makes the graph answerable. `ask()`'s own
// dynamicClassQuery ("how many dogs are there", "list dogs") resolves a class
// noun straight against `individual.class`, with no vocabulary-table entry
// needed, and that is the one lane an open-vocabulary graph can reach. So a
// term's class is the object of its own taxonomy row: "a beagle is a kind of
// dog" stores `beagle rdfs:subClassOf dog`, which classes the individual
// `beagle` as a `dog`, which is what makes "list dogs" answer with the real
// beagles on record. A term with no taxonomy row of its own still becomes an
// individual (so a relation edge has both its ends) but carries no class, and
// no class is ever minted for it — a listing it cannot ground lands on the
// honest miss wall, the same standard every other projection holds.
//
// The class is the DIRECT taxonomy parent, not a closure over it: with
// `fido -> beagle` and `beagle -> dog` on record, "list dogs" answers `beagle`
// and "list beagles" answers `fido`. That is what the store actually says.
//
// Which rows to project is a separate decision from how to project them, and
// the session makes it: `ingestedFactRows` keeps the facts a session brought
// in itself (taught, operator-asserted, extracted, or the low-trust optimistic
// tier) and drops the seeded corpus bands, which run to tens of thousands of
// rows the visitor never typed. Both functions are pure.
import { provenanceTagToSource } from "./memory/trust.mjs";

/** The Source kinds that mean "this session brought this fact in", as opposed
 *  to the corpus bands it booted with. Read off the same
 *  `provenanceTagToSource` tags memory-stats.mjs's own taught/band split uses,
 *  so the ask route and the stats panel can never disagree about which facts
 *  are the visitor's own. */
export const INGESTED_SOURCE_KINDS = Object.freeze(["teach", "operator", "extracted", "optimisticExtract"]);

const INGESTED_KINDS = new Set(INGESTED_SOURCE_KINDS);

/** True where this row's provenance names a source kind the visitor's own
 *  session produced. A row whose provenance parses to nothing is not claimed. */
export function isIngestedFactRow(row) {
  for (const tag of String(row?.provenance || "").split(" | ")) {
    if (!tag) continue;
    const source = provenanceTagToSource(tag);
    if (source && INGESTED_KINDS.has(source.kind)) return true;
  }
  return false;
}

/** The subset of `rows` (readFactRows' shape) this session grounded itself. */
export function ingestedFactRows(rows) {
  return (rows || []).filter(isIngestedFactRow);
}

/** The predicates whose object names the subject's CLASS. `rdfs:subClassOf` is
 *  what the teach lane canonicalizes both "a beagle is a kind of dog" and
 *  "Fido is a beagle" to; `rdf:type` is what a loaded world and an imported
 *  pack write instead, and either can reach this store. */
export const CLASSING_PREDICATES = Object.freeze(["rdfs:subClassOf", "rdf:type"]);

const CLASSING = new Set(CLASSING_PREDICATES);

/**
 * Project plain ingest fact rows (`{subject, predicate, object}`, the shape
 * memory/core.mjs's readFactRows returns) into the `{individuals,
 * objectProperties}` payload parseEntities consumes.
 *
 * Every term that appears as a subject or an object becomes an individual, so
 * an edge always has both its ends in `byId`. A term with a taxonomy row of
 * its own is classed by that row's object — the FIRST such row in reading
 * order, so a term taught two parents keeps the one the visitor stated first
 * rather than a silently reordered pick. Every row, taxonomy rows included,
 * also travels as an edge under its own predicate, deduplicated.
 *
 * Deterministic for identical input: individuals come out in first-seen order,
 * predicate groups in first-seen predicate order. Pure.
 */
export function ingestFactGraphPayload(rows) {
  const classByTerm = new Map();
  for (const row of rows || []) {
    if (!row?.subject || !row.object || !CLASSING.has(row.predicate)) continue;
    const subject = String(row.subject);
    if (!classByTerm.has(subject)) classByTerm.set(subject, String(row.object));
  }

  const individuals = new Map();
  const noteTerm = (id) => {
    if (individuals.has(id)) return;
    const cls = classByTerm.get(id);
    individuals.set(id, cls ? { id, label: id, class: cls } : { id, label: id });
  };

  const groups = new Map();
  const seenEdges = new Set();
  for (const row of rows || []) {
    if (!row?.subject || !row.predicate || !row.object) continue;
    const subject = String(row.subject);
    const predicate = String(row.predicate);
    const object = String(row.object);
    noteTerm(subject);
    noteTerm(object);
    const edgeKey = `${predicate} ${subject} ${object}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    if (!groups.has(predicate)) groups.set(predicate, { prop: predicate, predicate, examples: [] });
    groups.get(predicate).examples.push({ subject, object });
  }

  return { individuals: [...individuals.values()], objectProperties: [...groups.values()] };
}
