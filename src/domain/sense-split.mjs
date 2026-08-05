// sense-split.mjs — word-sense discrimination over a taught/stored class
// hierarchy. When one label carries two is-a facts ("rover is a kind of dog",
// "rover is a kind of scout"), their superclass ancestries decide whether the
// two end classes name the same concept or two different ones. The verdict is
// an implicit owl:differentFrom between the senses; the mechanism is pure and
// deterministic over the stored subClassOf closure and any stored
// owl:disjointWith pairs — never a model.
//
// The distinctness test, in order:
//   1. one class subsumes the other  -> same lineage, not distinct.
//   2. any ancestor pair is disjoint -> distinct (the cax-dw ⊑-lift, read-only).
//   3. ancestries never meet below ⊤ -> distinct (wholly non-intersecting).
//   4. the least common subsumer is a root, or scores below threshold on a
//      Wu-Palmer depth ratio (or a supplied Resnik information-content map)
//                                    -> distinct.
//   5. otherwise                     -> not distinct.

import { SUBCLASS_PREDICATE } from "./syllogise.mjs";
import { STOP_SET } from "./hub-terms.mjs";

export { STOP_SET };

/** child term -> Set of its direct superclasses, from `[child, parent]` edges.
 *  Self-loops and blank endpoints are dropped. */
export function subClassParents(subClassEdges) {
  const parents = new Map();
  for (const [child, parent] of subClassEdges || []) {
    if (!child || !parent || child === parent) continue;
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  }
  return parents;
}

/** The single rendering chain above `term` — `[term, parent, grandparent, …]`
 *  — following one deterministic (lowest-sorted) parent per hop, capped at
 *  `cap` nodes, cycle-safe. A branch point still yields one readable line;
 *  the full-ancestor-set comparisons below never rely on this single path.
 *
 *  `stopAt` (e.g. hub-terms.mjs's STOP_SET) names ancestors too abstract for
 *  a plain-English chain to climb into — "letter → character → property →
 *  concept" reads fine, "…→ cognition" doesn't. The walk halts BEFORE
 *  appending a later hub ancestor, so a hub never shows up mid-chain with
 *  more abstraction stacked past it. The direct first parent is the one
 *  exception: it is always shown even when it is itself a hub, so a term
 *  whose only real parent is a hub still renders that one direct parent
 *  (matching the plain "term is a kind of parent" sentence already stated)
 *  rather than an empty chain — the walk then still stops right there. */
export function ancestryChain(term, parents, { cap = 6, stopAt = null } = {}) {
  const chain = [term];
  const seen = new Set([term]);
  let node = term;
  while (chain.length < cap) {
    const ups = [...(parents.get(node) || [])].filter((p) => !seen.has(p)).sort();
    if (!ups.length) break;
    node = ups[0];
    const isHub = stopAt && stopAt.has(node);
    if (isHub && chain.length > 1) break;
    seen.add(node);
    chain.push(node);
    if (isHub) break;
  }
  return chain;
}

/** Every ancestor of `term`, including `term` itself, as a Set. Cycle-safe,
 *  bounded by the reachable set. */
export function ancestorSet(term, parents, { cap = 64 } = {}) {
  const seen = new Set([term]);
  const queue = [term];
  while (queue.length && seen.size < cap) {
    const node = queue.shift();
    for (const p of parents.get(node) || []) {
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
  }
  return seen;
}

/** Depth from a root, measured as the LONGEST upward chain length: a root
 *  (no parents) is depth 1, its children depth 2, and so on. Deterministic and
 *  cycle-safe; used for the Wu-Palmer ratio and to pick the deepest common
 *  subsumer as the least common subsumer. */
function depthFrom(term, parents, memo, stack) {
  if (memo.has(term)) return memo.get(term);
  if (stack.has(term)) return 1; // cycle guard — treat the re-entry as a root
  stack.add(term);
  const ups = parents.get(term);
  let depth = 1;
  if (ups && ups.size) {
    let deepest = 0;
    for (const p of ups) deepest = Math.max(deepest, depthFrom(p, parents, memo, stack));
    depth = deepest + 1;
  }
  stack.delete(term);
  memo.set(term, depth);
  return depth;
}

/** A symmetric lookup "is A disjoint with B" over stored owl:disjointWith
 *  pairs. Both directions of every pair are indexed. */
function disjointIndex(disjointEdges) {
  const of = new Map();
  for (const [a, b] of disjointEdges || []) {
    if (!a || !b) continue;
    if (!of.has(a)) of.set(a, new Set());
    of.get(a).add(b);
    if (!of.has(b)) of.set(b, new Set());
    of.get(b).add(a);
  }
  return of;
}

/** Decide whether classes `a` and `b` name distinct concepts, given the parent
 *  index, the disjointness index, a depth memo, and the scoring options.
 *  Returns `{ distinct, reason, lcs }`. */
function pairVerdict(a, b, parents, disjointOf, depthMemo, { threshold, rootDepth, icByTerm }) {
  const ancA = ancestorSet(a, parents);
  const ancB = ancestorSet(b, parents);
  if (ancA.has(b) || ancB.has(a)) return { distinct: false, reason: "subsumes", lcs: ancA.has(b) ? b : a };

  if (disjointOf.size) {
    for (const x of ancA) {
      const partners = disjointOf.get(x);
      if (!partners) continue;
      for (const y of ancB) if (partners.has(y)) return { distinct: true, reason: "disjoint", lcs: null };
    }
  }

  const common = [...ancA].filter((x) => ancB.has(x));
  if (!common.length) {
    // Non-intersection only means "distinct" when both sides carry real
    // ancestry evidence. A bare class with no recorded superclass tells us
    // nothing about its sense — a sparse taxonomy that simply never linked
    // two storage classes must not read as two concepts. Inconclusive keeps
    // the flat list.
    if (ancA.size < 2 || ancB.size < 2) return { distinct: false, reason: "inconclusive", lcs: null };
    return { distinct: true, reason: "non-intersecting", lcs: null };
  }

  const depth = (t) => depthFrom(t, parents, depthMemo, new Set());
  let lcs = common[0];
  let lcsDepth = depth(lcs);
  for (const c of common) {
    const d = depth(c);
    if (d > lcsDepth || (d === lcsDepth && c < lcs)) { lcs = c; lcsDepth = d; }
  }

  if (lcsDepth <= rootDepth) return { distinct: true, reason: "root-subsumer", lcs };

  if (icByTerm) {
    const ic = icByTerm.get(lcs);
    if (typeof ic === "number" && ic < threshold) return { distinct: true, reason: "low-ic", lcs };
    return { distinct: false, reason: "shared-lineage", lcs };
  }

  const wuPalmer = (2 * lcsDepth) / (depth(a) + depth(b));
  if (wuPalmer < threshold) return { distinct: true, reason: "shallow-subsumer", lcs };
  return { distinct: false, reason: "shared-lineage", lcs };
}

/** Cluster same-predicate end classes into senses. Two classes join the same
 *  sense when they are NOT distinct (union-find over the pairwise verdicts);
 *  the answer splits when more than one cluster survives.
 *
 *  Options:
 *   - subClassEdges / parents: the taxonomy (`parents` wins if both given).
 *   - disjointEdges: stored owl:disjointWith pairs.
 *   - threshold: Wu-Palmer ratio (or Resnik IC) below which a shared subsumer
 *     still reads as two senses. Default 0.5.
 *   - rootDepth: a subsumer at or above this shallow depth is treated as ⊤.
 *     Default 1 (only the very root).
 *   - icByTerm: an optional term->information-content map; when supplied the
 *     LCS is scored by Resnik IC instead of the Wu-Palmer depth ratio.
 *
 *  Returns `{ split, clusters, pairs }`. Each cluster is
 *  `{ objects, label }` where `label` is the cluster's most specific class.
 *  `pairs` records every pairwise verdict for inspection/tests. */
export function clusterSenses(objects, {
  subClassEdges = [], parents: parentsIn = null, disjointEdges = [],
  threshold = 0.5, rootDepth = 1, icByTerm = null,
} = {}) {
  const unique = [...new Set((objects || []).filter(Boolean))];
  const parents = parentsIn || subClassParents(subClassEdges);
  const disjointOf = disjointIndex(disjointEdges);
  const depthMemo = new Map();

  const parent = new Map(unique.map((o) => [o, o]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };

  const pairs = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const v = pairVerdict(unique[i], unique[j], parents, disjointOf, depthMemo, { threshold, rootDepth, icByTerm });
      pairs.push({ a: unique[i], b: unique[j], ...v });
      if (!v.distinct) union(unique[i], unique[j]);
    }
  }

  const byRoot = new Map();
  for (const o of unique) {
    const r = find(o);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(o);
  }
  const depth = (t) => depthFrom(t, parents, depthMemo, new Set());
  const clusters = [...byRoot.values()].map((members) => {
    const sorted = [...members].sort();
    let label = sorted[0];
    let best = depth(label);
    for (const m of sorted) { const d = depth(m); if (d > best) { best = d; label = m; } }
    return { objects: sorted, label };
  }).sort((x, y) => x.label.localeCompare(y.label));

  return { split: clusters.length > 1, clusters, pairs };
}

export { SUBCLASS_PREDICATE };
