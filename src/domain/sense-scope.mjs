// sense-scope.mjs — the same-sense discipline a READ-TIME walk applies when it
// picks which neighbours of a term to show.
//
// sense-gate.mjs already places a term under its nearest top classes and says
// when two terms are provably in different senses. It uses that to refuse a
// DERIVED isa edge, and it refuses only on proof: both ends placed, every cross
// pair declared disjoint. That burden is right for a derivation, because
// refusing one deletes an entailment the graph would otherwise hold.
//
// Selection carries the opposite burden. Nothing is deleted when a background
// row goes unshown, so a walk may ask for evidence that a neighbour belongs
// before it spends a line on it. This module asks for exactly that: the
// neighbour's top classes must MEET the anchor's, not merely fail to be
// provably disjoint.
//
// The difference is the whole bug. "russia" places under `place`; "passage"
// places under `artifact`. Those two tops overlap by declaration (a cathedral
// is both), so the derivation gate lets them stand and the store holds an
// entailed "russia is a kind of passage". A hop-bounded walk out of russia then
// treats `passage` as a one-hop neighbour and comes back down the anatomy side
// of it: "orifice is a kind of passage", "duct is a kind of passage", on a card
// about a prisoner release. Requiring a shared top stops the walk at `passage`
// while `country`, `district` and `geographical area` — all of which meet
// `place` — carry straight on.
//
// Unplaced is not out of sense. A term the bands never classify (a person's
// name, a coined product name, most of what a headline is actually about) has
// no tops to meet, so it is admitted. So is every neighbour when the anchor
// itself is unplaced: with no sense to keep to, there is nothing to drift from.
//
// Pure over the fact set. The gate underneath sorts every frontier and memoizes
// per term, and an anchor set is a membership test over the tops it pools, so
// two ingestion orders of the same facts admit the same terms.

import { normFactTerm } from "./hash.mjs";
import { buildSenseGate } from "./sense-gate.mjs";

const SUBCLASS_PREDICATE = "rdfs:subClassOf";
const TYPE_PREDICATE = "rdf:type";

/** Whether a row states its isa edge rather than concluding it. An entailment
 *  head, a hypothetical's environment, or a justification chain all mark the
 *  graph's own output; feeding that back to the gate that constrains it is how
 *  a bad shortcut ends up vouching for itself. Read here rather than imported,
 *  so this module stands alone for any reader that wants the same discipline. */
function statesItsIsaEdge(row) {
  const head = String(row?.provenance || "").trim().split(/\s+/)[0] || "";
  if (head.startsWith("entailed:")) return false;
  if (Array.isArray(row?.environments) && row.environments.length) return false;
  if (Array.isArray(row?.justification) && row.justification.length) return false;
  return true;
}

/** Builds the scope over one fact set, reading only the asserted isa rows.
 *
 *  Returns `{ topsOf, sameSenseAs }`. `topsOf(term)` is the gate's own
 *  placement, exposed so a caller can explain a refusal. `sameSenseAs(anchors)`
 *  takes one term or an iterable of them and answers a `(term) => boolean`
 *  predicate: true when the term may stay in the anchors' neighbourhood.
 *  Several anchors pool their tops, so a walk seeded from more than one term
 *  keeps to the senses of all of them. */
export function buildSenseScope(rows) {
  const subClassEdges = [];
  const typeEdges = [];
  for (const row of rows || []) {
    if (!row || !statesItsIsaEdge(row)) continue;
    const child = normFactTerm(row.subject);
    const parent = normFactTerm(row.object);
    if (!child || !parent) continue;
    if (row.predicate === SUBCLASS_PREDICATE) subClassEdges.push([child, parent]);
    else if (row.predicate === TYPE_PREDICATE) typeEdges.push([child, parent]);
  }
  const gate = buildSenseGate({ subClassEdges, typeEdges });

  const topsOf = (term) => gate.topsOf(normFactTerm(term));

  function sameSenseAs(anchors) {
    const list = typeof anchors === "string" ? [anchors] : [...(anchors || [])];
    const anchorTops = new Set();
    for (const anchor of list) for (const top of topsOf(anchor)) anchorTops.add(top);
    if (!anchorTops.size) return () => true;
    const anchorTerms = new Set(list.map((a) => normFactTerm(a)).filter(Boolean));
    return (term) => {
      const norm = normFactTerm(term);
      if (!norm || anchorTerms.has(norm)) return true;
      const tops = topsOf(norm);
      if (!tops.length) return true;
      for (const top of tops) if (anchorTops.has(top)) return true;
      return false;
    };
  }

  return { topsOf, sameSenseAs };
}
