// digest/store-stats.mjs — the store-relative statistics the selector needs,
// derived in one pass over the fact rows a caller already holds. Pure and
// deterministic; imports only its sibling sense-split helpers, so it links into
// a browser bundle the same way the rest of the digest layer does (the pages
// digest client-side from an embedded structure table).
//
// selectFacts() scores an isa row partly by how many subjects across the store
// share its object as a class: a class nearly everything is cut as
// uninformative. That count, the total isa-subject population, and the
// subClassOf/disjointWith edges the sense clustering walks are all one scan of
// the rows away — this module is that scan, kept out of the pure selector so
// the selector stays a function of its inputs.

import { subClassParents, ancestryChain, STOP_SET } from "../sense-split.mjs";

// The predicates the digest groups under the isa family (kept in step with
// select.mjs's FAMILY_OF): a subclass edge and a type edge both name a class
// the subject belongs to.
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

/**
 * The store-relative statistics selectFacts() reads, from one pass over `rows`:
 *   - classSubjectCounts: { class -> distinct subjects that are isa it }
 *   - totalSubjects:      distinct subjects that carry any isa fact
 *   - subClassEdges:      [[child, parent], …] for the sense clustering
 *   - disjointEdges:      [[a, b], …] stored owl:disjointWith pairs
 */
export function digestStoreStats(rows) {
  const classSubjects = new Map(); // class -> Set(subject)
  const isaSubjects = new Set();
  const subClassEdges = [];
  const disjointEdges = [];
  for (const r of rows || []) {
    if (!r || !r.predicate) continue;
    if (ISA_PREDICATES.has(r.predicate)) {
      isaSubjects.add(r.subject);
      if (!classSubjects.has(r.object)) classSubjects.set(r.object, new Set());
      classSubjects.get(r.object).add(r.subject);
      subClassEdges.push([r.subject, r.object]);
    } else if (r.predicate === "owl:disjointWith") {
      disjointEdges.push([r.subject, r.object]);
    }
  }
  const classSubjectCounts = {};
  for (const [cls, subs] of classSubjects) classSubjectCounts[cls] = subs.size;
  return { classSubjectCounts, totalSubjects: isaSubjects.size, subClassEdges, disjointEdges };
}

/**
 * Ancestry chains for a set of isa objects, keyed object -> [object, parent, …],
 * so a lone isa fact can render as "a mammal, and so an animal". Built from the
 * store's subClassOf edges; an object with no recorded parent is omitted.
 */
export function chainsForObjects(subClassEdges, objects, cap = 6) {
  const parents = subClassParents(subClassEdges || []);
  const chains = {};
  for (const obj of objects || []) {
    if (obj in chains) continue;
    const chain = ancestryChain(obj, parents, { cap, stopAt: STOP_SET });
    if (chain.length > 1) chains[obj] = chain;
  }
  return chains;
}

/** The isa objects among a term's rows, first-seen order — the set worth an
 *  ancestry chain. */
export function isaObjectsOf(rows) {
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || !ISA_PREDICATES.has(r.predicate)) continue;
    if (seen.has(r.object)) continue;
    seen.add(r.object);
    out.push(r.object);
  }
  return out;
}
