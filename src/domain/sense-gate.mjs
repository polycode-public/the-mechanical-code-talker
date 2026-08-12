// sense-gate.mjs — the disjointness gate on isa DERIVATION.
//
// WordNet-derived bands flatten every sense of a word onto one label. "region"
// carries a geographic sense (region ⊑ location) and an anatomical one
// (region ⊑ body part), and both rows store the same six characters. Each row
// is true of its own sense, so the corpus is right to hold both. subClassOf
// transitivity then walks straight across the join:
// russia ⊑ country ⊑ geographical area ⊑ region ⊑ body part.
//
// This module refuses that step, and only that step. It answers one question,
// `declines(subject, object)`, for a candidate DERIVED isa edge. An asserted
// row never reaches it: the gate constrains what the closure concludes, never
// what a corpus or a teacher records. A refusal costs the MATERIALISED
// shortcut row and nothing else. The stated chain stays whole, and every
// walker over it (findIsaChain, the ancestor closers) still reaches what it
// reached before.
//
// How a term is placed. Every candidate is resolved to the top classes it
// sits under, by an upward breadth-first walk over the ASSERTED isa edges,
// stopping at the FIRST level where any top appears and returning every top
// found at that level. Nearest-level, not full reachability: the graph these
// bands build is cyclic (place ⊑ passage ⊑ section ⊑ area ⊑ place is one of
// many), so "every top above x" resolves to nearly all of them for nearly
// every x and discriminates nothing. The nearest level is the sense the
// term's own short chain commits to. Russia reaches `place` in two hops and
// `body part` in four.
//
// When it declines. Both ends must resolve, the two top sets must not share a
// member, and EVERY cross pair must be a declared disjoint pair. One
// unresolved end, one shared top, or one pair the table does not separate,
// and the derivation goes through. A term genuinely sitting under two tops
// keeps both branches, so the gate cuts a crossing only when the evidence on
// both sides is unambiguous.
//
// Pure over the fact set. One memo per gate, no clock, no arrival order; the
// walk sorts every frontier by codepoint, so two ingestion orders of the same
// facts return the same verdicts.

import { normFactTerm } from "./hash.mjs";

/**
 * The top classes the gate resolves a term to, each with the labels the
 * committed bands actually spell it. A label is a synonym FOR the top, not a
 * subclass of it: `location` names the same region of the ontology as
 * `place`, so both spellings resolve to one top and never separate.
 *
 * `region` is deliberately absent. It is the sense-mixed node itself — making
 * it a top would place `geographical area` under it and settle nothing.
 */
export const TOP_CLASSES = [
  { top: "place", labels: ["place", "location"] },
  {
    top: "body part",
    labels: ["body part", "organ", "internal organ", "external body part", "body covering", "limb", "blood vessel"],
  },
  { top: "living thing", labels: ["living thing", "organism"] },
  { top: "artifact", labels: ["artifact", "instrumentality"] },
  { top: "substance", labels: ["substance", "matter"] },
  { top: "event", labels: ["event", "happening"] },
  { top: "communication", labels: ["communication", "message"] },
  { top: "time period", labels: ["time period"] },
  { top: "feeling", labels: ["feeling", "emotion"] },
];

/**
 * The pairs of tops that DO overlap, so the disjoint table can be every other
 * pair. Each one names something the ontology really holds both ways: a
 * cathedral is an artifact and a place; a book is an artifact and a
 * communication; concrete is an artifact and a substance; bone is a body part
 * and a substance; timber is a living thing and a substance; a speech is an
 * event and a communication; a cry is a communication and a feeling.
 *
 * Listing the overlaps rather than the exclusions keeps the judgement small:
 * nine tops make thirty-six pairs, and the seven below are the ones that need
 * an argument. The rest follow.
 */
export const OVERLAPPING_TOP_PAIRS = [
  ["artifact", "communication"],
  ["artifact", "place"],
  ["artifact", "substance"],
  ["body part", "substance"],
  ["communication", "event"],
  ["communication", "feeling"],
  ["living thing", "substance"],
];

const pairKey = (a, b) => (a < b ? `${a}␟${b}` : `${b}␟${a}`);

/**
 * Every disjoint pair of tops, as `[a, b]` with `a < b`, sorted — all pairs
 * of `topClasses` except `overlappingPairs`. Derived rather than typed out,
 * so the table is symmetric and duplicate-free by construction.
 */
export function disjointTopPairs(topClasses = TOP_CLASSES, overlappingPairs = OVERLAPPING_TOP_PAIRS) {
  const overlaps = new Set((overlappingPairs || []).map(([a, b]) => pairKey(a, b)));
  const tops = (topClasses || []).map((t) => t.top);
  const pairs = [];
  for (let i = 0; i < tops.length; i += 1) {
    for (let j = i + 1; j < tops.length; j += 1) {
      const [a, b] = tops[i] < tops[j] ? [tops[i], tops[j]] : [tops[j], tops[i]];
      if (overlaps.has(pairKey(a, b))) continue;
      pairs.push([a, b]);
    }
  }
  pairs.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0));
  return pairs;
}

/** How far up the gate will look for a top before giving the term up as
 *  unplaced, and how many classes one term's walk may visit. Both bound the
 *  cost of a single `topsOf` on a graph whose upper levels fan out hard; a
 *  term whose nearest top sits past either bound is simply unplaced, and an
 *  unplaced term never blocks anything. */
export const DEFAULT_MAX_HOPS = 6;
export const DEFAULT_MAX_VISITED = 3000;

/** Codepoint order. Deliberately not localeCompare — the walk below must
 *  return the same set on any machine and any ICU version. */
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Builds the gate over one fact set. `subClassEdges` and `typeEdges` are
 * `[[child, parent], …]` lists of ASSERTED isa rows only (a caller holding
 * entailed rows must filter them out first — feeding the closure's own output
 * back in is what the gate exists to stop). Type edges act as a first hop, so
 * an individual with a taught `rdf:type` places the same way a class does.
 *
 * Returns `{ declines, topsOf, tops, disjointPairs }`. `declines(subject,
 * object)` is the whole contract; `topsOf(term)` is exposed for tests and for
 * a caller that wants to explain a refusal.
 */
export function buildSenseGate({
  subClassEdges = [], typeEdges = [], maxHops = DEFAULT_MAX_HOPS,
  maxVisited = DEFAULT_MAX_VISITED, topClasses = TOP_CLASSES,
  overlappingPairs = OVERLAPPING_TOP_PAIRS,
} = {}) {
  const topOfLabel = new Map(); // normalized label -> its top's canonical name
  for (const entry of topClasses || []) {
    for (const label of entry.labels || []) {
      const n = normFactTerm(label);
      if (n) topOfLabel.set(n, entry.top);
    }
  }
  const allTops = (topClasses || []).map((t) => t.top);
  const pairs = disjointTopPairs(topClasses, overlappingPairs);
  const disjoint = new Set(pairs.map(([a, b]) => pairKey(a, b)));

  const parentSets = new Map(); // child -> Set(direct asserted superclass)
  const addEdge = (child, parent) => {
    if (!child || !parent || child === parent) return;
    if (!parentSets.has(child)) parentSets.set(child, new Set());
    parentSets.get(child).add(parent);
  };
  for (const [child, parent] of subClassEdges || []) addEdge(child, parent);
  for (const [instance, cls] of typeEdges || []) addEdge(instance, cls);
  // Sorted once, read many: `maxVisited` can truncate a level part-way, and
  // truncating a Set in arrival order would make the verdict depend on which
  // order the facts were ingested in.
  const parents = new Map();
  for (const [child, set] of parentSets) parents.set(child, [...set].sort(compareStrings));

  const memo = new Map(); // term -> sorted array of top names at its nearest level
  function topsOf(term) {
    if (!term) return [];
    if (memo.has(term)) return memo.get(term);
    let found = [];
    const own = topOfLabel.get(term);
    if (own) {
      found = [own];
    } else {
      const seen = new Set([term]);
      let frontier = [term];
      for (let hop = 1; hop <= maxHops && frontier.length && seen.size < maxVisited; hop += 1) {
        const next = [];
        for (const node of frontier) {
          for (const parent of parents.get(node) || []) {
            if (seen.has(parent)) continue;
            seen.add(parent);
            next.push(parent);
            if (seen.size >= maxVisited) break;
          }
          if (seen.size >= maxVisited) break;
        }
        next.sort(compareStrings);
        const hits = new Set();
        for (const node of next) {
          const top = topOfLabel.get(node);
          if (top) hits.add(top);
        }
        if (hits.size) { found = [...hits].sort(compareStrings); break; }
        frontier = next;
      }
    }
    memo.set(term, found);
    return found;
  }

  /** True when EVERY cross pair of the two top sets is a declared disjoint
   *  pair — one shared top or one undeclared pair and the answer is false. */
  function separated(subjectTops, objectTops) {
    for (const a of subjectTops) {
      for (const b of objectTops) {
        if (a === b) return false;
        if (!disjoint.has(pairKey(a, b))) return false;
      }
    }
    return true;
  }

  function declines(subject, object) {
    if (!subject || !object || subject === object) return false;
    const subjectTops = topsOf(subject);
    if (!subjectTops.length) return false;
    const objectTops = topsOf(object);
    if (!objectTops.length) return false;
    return separated(subjectTops, objectTops);
  }

  return { declines, topsOf, tops: allTops, disjointPairs: pairs };
}
