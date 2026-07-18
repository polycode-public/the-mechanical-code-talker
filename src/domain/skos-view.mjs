// A derived SKOS concept-identity view over the store's bare-string terms.
//
// The corpus stores its term relations as reified facts whose subject/object are
// bare, normalised strings ("module", not "tmct:module") — normFactTerm strips
// the CURIE prefix at write time. SKOS S19/S20 fix the domain and range of
// skos:related to skos:Concept, so the relations cannot map onto SKOS while the
// terms are plain strings with no concept identity.
//
// buildSkosConceptView mints that identity WITHOUT touching storage: it reads the
// fact rows a store already returns, mints one skos:Concept per normalised term
// (or per synonym-merged group), and re-expresses mgx:synonym and mgx:relatedTo
// as SKOS. Nothing is written; the same store, read twice, yields the same view.
// The minted concepts ARE skos:Concepts by construction, so skos:related between
// them satisfies S19/S20. skos:prefLabel/altLabel carry no domain (S10/S11), so
// labelling the minted concepts is well-formed SKOS.

import { normFactTerm } from "./hash.mjs";

export const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";

// mgx:antonym is deliberately absent: SKOS has no opposition relation, and
// asserting skos:related for an antonym would claim the association the corpus
// denies. It stays mgx: and reads as a bare string — the honest miss.
export const DEFAULT_RELATION_MAP = {
  synonym: ["mgx:synonym"],
  related: ["mgx:relatedTo", "mgx:similarTo"],
};

export function buildSkosConceptView(rows, { conceptBase = "concept:", relationMap = DEFAULT_RELATION_MAP } = {}) {
  const synonymPreds = new Set(relationMap.synonym || []);
  const relatedPreds = new Set(relationMap.related || []);

  const parent = new Map();
  const ensure = (t) => { if (!parent.has(t)) parent.set(t, t); };
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const next = parent.get(x); parent.set(x, r); x = next; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb); // smaller string wins — deterministic
  };

  const relatedRaw = [];
  for (const r of rows) {
    const p = r.predicate;
    if (!synonymPreds.has(p) && !relatedPreds.has(p)) continue;
    const s = normFactTerm(r.subject), o = normFactTerm(r.object);
    if (!s || !o) continue;
    ensure(s); ensure(o);
    if (synonymPreds.has(p)) union(s, o); else relatedRaw.push({ s, o });
  }

  const iriFor = (rep) => conceptBase + rep.replace(/ /g, "_");
  const componentTerms = new Map();
  for (const t of parent.keys()) {
    const rep = find(t);
    if (!componentTerms.has(rep)) componentTerms.set(rep, new Set());
    componentTerms.get(rep).add(t);
  }

  const concepts = [];
  for (const [rep, terms] of componentTerms) {
    const sorted = [...terms].sort();
    concepts.push({ id: iriFor(rep), prefLabel: rep, altLabels: sorted.filter((t) => t !== rep) });
  }
  concepts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const seen = new Set();
  const related = [];
  for (const { s, o } of relatedRaw) {
    const cs = iriFor(find(s)), co = iriFor(find(o));
    if (cs === co) continue; // a synonym merge collapsed both terms into one concept
    // NUL-delimited pair key, same idiom as the store's fact ids — spelled as an
    // escape so this file stays plain text (a literal NUL reads as binary to git)
    const key = cs < co ? `${cs}\u0000${co}` : `${co}\u0000${cs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    related.push({ subject: cs, object: co });
  }
  related.sort((a, b) => (`${a.subject}${a.object}` < `${b.subject}${b.object}` ? -1 : 1));

  const conceptIdForTerm = (term) => {
    const t = normFactTerm(term);
    return parent.has(t) ? iriFor(find(t)) : null;
  };
  return { concepts, related, conceptIdForTerm, namespace: SKOS_NS };
}

/** One term's SKOS neighbourhood out of a store's fact rows: its concept, the
 *  synonym group read as labels, and the skos:related neighbour concepts.
 *  `synonyms` is the group minus the queried term — the caller-facing "another
 *  word for X" answer. Null when the term mints no concept (unknown, or no
 *  synonym/related facts), so the caller keeps its honest miss. */
export function relatedForTerm(rows, term, options = {}) {
  const view = buildSkosConceptView(rows, options);
  const conceptId = view.conceptIdForTerm(term);
  if (!conceptId) return null;
  const byId = new Map(view.concepts.map((c) => [c.id, c]));
  const concept = byId.get(conceptId);
  const queried = normFactTerm(term);
  const synonyms = [concept.prefLabel, ...concept.altLabels].filter((label) => label !== queried);
  const related = view.related
    .filter((r) => r.subject === conceptId || r.object === conceptId)
    .map((r) => byId.get(r.subject === conceptId ? r.object : r.subject))
    .filter(Boolean);
  return { conceptId, prefLabel: concept.prefLabel, altLabels: concept.altLabels, synonyms, related };
}
