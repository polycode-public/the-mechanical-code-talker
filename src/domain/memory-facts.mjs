// memory-facts.mjs — the projection from a session's own memory fact rows
// (`{subject, predicate, object}`, the shape memory/core.mjs's readFactRows
// returns) to the `{individuals, objectProperties}` payload parseEntities
// consumes, so a page whose only store is taught facts can hand `ask()` a real
// graph of them instead of an empty one.
//
// sprite-facts.mjs does the same job for a CLOSED catalog. It knows every
// predicate ahead of time, so it can name a class per predicate tail. A chat or
// ledger session has no catalog: its vocabulary is whatever a visitor taught,
// pasted or researched this session. So this projection reads the classes OFF
// the rows rather than off a table.
//
//   - a class-membership row (`rdf:type` / `rdfs:subClassOf`) classes its
//     subject by its object, which is what makes "list pegs" and "how many pegs
//     are there" answer for a class no vocabulary table has ever heard of —
//     ask()'s dynamicClassQuery resolves a class noun straight against
//     `individual.class`;
//   - every term the store mentions is also an individual of class `term`, so a
//     term carrying no type of its own is still resolvable and still counted by
//     "how many terms are there".
//
// Nothing here is entailed. A term taught as a peg is listed under `peg`, and
// under `toy` only if someone taught it that too — following the chain would
// mean "list toys" reaching a term nobody called a toy. That is sound OWL, and
// it is also how this projection stops being bounded by the store: a taxonomy
// 200 classes deep turns 6,000 stored rows into a quarter of a million
// individuals, which every later resolveObject scan then pays for on a page
// that has to stay responsive. Chasing a subclass chain is the syllogism
// engine's job, and it already does it through a chat turn; a projection that
// wants entailed classes should read them from there rather than re-deriving a
// partial copy per ask.
//
// One individual shape stays OUT: a row itself, classed `Fact` and labelled
// with its own triple. It reads well ("list facts" prints the stored rows), but
// a label like "ann rdf:type person" contains its own terms, so resolveObject's
// containment tier matches it whenever someone asks about "person" — and a term
// that matches two individuals resolves as AMBIGUOUS rather than as a miss.
// ask() runs its class-count and world-relation fallbacks only after an honest
// miss, so those triple labels quietly switch off the very lanes this
// projection exists to reach. The turn engine already counts and reads back the
// stored rows on its own.
//
// A term's own entries are ordered `term` first, then the classes it was
// taught, in the order those rows were stored. The tail of that list is what
// parseEntities' `byId` keeps, so a subject resolves through the most recent
// class someone actually taught it rather than through `term`.
//
// The taught predicate travels in `prop`, and `predicate` is deliberately left
// empty. codegraph.mjs's relationKind falls back to matching `predicate`
// against code relation-kind regexes, and a taught predicate hits one by
// accident easily: "the fabric changes colour" stores `mgx:change`, which the
// `/(touch|chang|modif)/` rule reads as a `touches` edge, and "what does fabric
// touch" would then answer "colour". A taught fact is not a code relation, so
// the code lanes keep the same honest miss they give on a page with no code
// graph. The world-relation lane still reaches these edges, because it matches
// `prop` as well as `predicate`.
//
// Pure, and deterministic for identical row order.

/** The class every term in the store carries, on top of whatever it was
 *  taught — the ledger's own word for a node of this graph. */
export const MEMORY_TERM_CLASS = "term";

const CLASS_MEMBERSHIP_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf"]);

/** Terms and predicates are arbitrary user text, so a dedup key can't join them
 *  on any separator a term might itself carry. */
const dedupKey = (...parts) => JSON.stringify(parts);

function usableRows(rows) {
  return (rows || []).filter((row) => {
    if (!row || !row.subject || !row.predicate) return false;
    return row.object !== undefined && row.object !== null && String(row.object) !== "";
  });
}

/** subject -> the classes it was directly taught, in stored order. */
function directClasses(rows) {
  const direct = new Map();
  for (const row of rows) {
    if (!CLASS_MEMBERSHIP_PREDICATES.has(row.predicate)) continue;
    const subject = String(row.subject);
    const object = String(row.object);
    if (subject === object) continue;
    const taught = direct.get(subject) || [];
    if (!taught.includes(object)) taught.push(object);
    direct.set(subject, taught);
  }
  return direct;
}

/**
 * Project memory fact rows into the graph payload parseEntities consumes.
 * Every individual and every edge traces back to a row that is actually stored.
 */
export function memoryFactGraphPayload(rows) {
  const kept = usableRows(rows);
  const direct = directClasses(kept);

  const terms = [];
  const seenTerm = new Set();
  const noteTerm = (term) => {
    if (!term || seenTerm.has(term)) return;
    seenTerm.add(term);
    terms.push(term);
  };
  for (const row of kept) {
    noteTerm(String(row.subject));
    noteTerm(String(row.object));
  }

  const individuals = [];
  const seenIndividual = new Set();
  const addIndividual = (id, label, cls) => {
    const key = dedupKey(id, cls);
    if (seenIndividual.has(key)) return;
    seenIndividual.add(key);
    individuals.push({ id, label, class: cls });
  };

  for (const term of terms) {
    addIndividual(term, term, MEMORY_TERM_CLASS);
    for (const cls of direct.get(term) || []) addIndividual(term, term, cls);
  }

  const groups = new Map();
  const seenEdge = new Set();
  for (const row of kept) {
    const subject = String(row.subject);
    const object = String(row.object);
    const key = dedupKey(row.predicate, subject, object);
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    if (!groups.has(row.predicate)) groups.set(row.predicate, { prop: row.predicate, predicate: "", examples: [] });
    groups.get(row.predicate).examples.push({ subject, object });
  }

  return { individuals, objectProperties: [...groups.values()] };
}
