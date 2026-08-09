// tableau.mjs — a SHOIQ description-logic tableau prover: satisfiability,
// individual entailment, and class subsumption, over a KB read from the
// memory graph's stored OWL fragment. Query-time only, never materialised —
// a case-split conclusion depends on every branch of its proof, and batch
// provenance for that shape is a later problem.
//
// The letters, one increment each: ALC's core connectives (top, bottom,
// atomic negation, intersection, union, existential and universal
// restriction); S transitive roles (owl:TransitiveProperty propagates the
// universal rule through a role's own successors, and blocking runs as
// equality blocking throughout so that propagation still terminates); H
// role hierarchies (rdfs:subPropertyOf lets a narrower role's edge satisfy
// a wider one, read through a role closure precomputed once per KB); O
// nominals (owl:oneOf gives a singleton concept, and two nodes labelled the
// same nominal must be the same individual — the nominal-merge rule); Q
// qualified cardinality (owl:minCardinality/maxCardinality/cardinality with
// owl:onClass — the ≥-rule generates n pairwise-distinct successors, the
// ≤-rule merges surplus successors under the same identity side-condition
// the nominal merge uses); I inverse roles (owl:inverseOf lets every rule
// that reads a role edge read it backwards too, and upgrades blocking from
// equality to pairwise, per Horrocks & Sattler's SHOIQ decision procedure).
//
// UNA-lite (PLAN_SYLLOGIST_EL_DL.md section 4): a declared name is distinct
// from every other declared name unless owl:sameAs says otherwise. The
// tableau applies it at exactly two points: the merge rules' identity
// side-condition (the nominal merge, the ≤-rule's own successor merge) and
// ordinary clash detection. Attempting to merge two nodes UNA-lite forbids
// is itself a clash, not a step the search takes silently.
//
// Deterministic throughout: fixed rule-application priority, a fixed branch
// stack (LIFO, no JS-call recursion — a deep existential chain must not
// depend on the interpreter's own stack), sorted candidate lists everywhere
// a Map or Set is iterated, no wall clock. Feeding the same fact rows in two
// different orders yields a byte-identical KB and proof result.
//
// Budgets are part of the semantics, not a tuning knob: exceeding the step,
// branch or node ceiling aborts the WHOLE call with `exhausted`, never a
// partial verdict. A prover that runs out of budget has found nothing —
// abstention, not a guess.

import { normFactTerm } from "./hash.mjs";

// ---- concept-expression AST --------------------------------------------

const atom = (name) => ({ t: "atom", name });
const notE = (c) => ({ t: "not", c });
const andE = (cs) => ({ t: "and", cs });
const orE = (cs) => ({ t: "or", cs });
const someE = (r, c) => ({ t: "some", r, c });
const allE = (r, c) => ({ t: "all", r, c });

/** A stable string key for a concept expression. Sorting, dedup and clash
 *  detection all go through this, so two structurally equal expressions are
 *  one key. Pure. */
export function canonicalKey(expr) {
  if (!expr || typeof expr !== "object" || typeof expr.t !== "string") {
    throw new TypeError("canonicalKey: expr must be a concept-expression object carrying a t tag");
  }
  switch (expr.t) {
    case "top": return "top";
    case "bot": return "bot";
    case "atom": return `atom(${expr.name})`;
    case "nom": return `nom(${expr.ind})`;
    case "not": return `not(${canonicalKey(expr.c)})`;
    case "and": return `and(${expr.cs.map(canonicalKey).sort().join(",")})`;
    case "or": return `or(${expr.cs.map(canonicalKey).sort().join(",")})`;
    case "some": return `some(${expr.r},${canonicalKey(expr.c)})`;
    case "all": return `all(${expr.r},${canonicalKey(expr.c)})`;
    case "atLeast": return `atLeast(${expr.n},${expr.r},${canonicalKey(expr.c)})`;
    case "atMost": return `atMost(${expr.n},${expr.r},${canonicalKey(expr.c)})`;
    default: throw new TypeError(`canonicalKey: unknown expression tag "${expr.t}"`);
  }
}

function pushNegation(expr, negate) {
  if (!expr || typeof expr !== "object" || typeof expr.t !== "string") {
    throw new TypeError("toNNF: expr must be a concept-expression object carrying a t tag");
  }
  switch (expr.t) {
    case "top": return negate ? { t: "bot" } : { t: "top" };
    case "bot": return negate ? { t: "top" } : { t: "bot" };
    case "atom": return negate ? { t: "not", c: { t: "atom", name: expr.name } } : { t: "atom", name: expr.name };
    case "nom": return negate ? { t: "not", c: { t: "nom", ind: expr.ind } } : { t: "nom", ind: expr.ind };
    case "not": return pushNegation(expr.c, !negate);
    case "and":
    case "or": {
      const flip = expr.t === "and" ? "or" : "and";
      const cs = expr.cs.map((c) => pushNegation(c, negate));
      cs.sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b)));
      return { t: negate ? flip : expr.t, cs };
    }
    case "some":
    case "all": {
      const flip = expr.t === "some" ? "all" : "some";
      const c = pushNegation(expr.c, negate);
      return { t: negate ? flip : expr.t, r: expr.r, c };
    }
    case "atLeast":
    case "atMost": {
      // The filler concept keeps its own polarity — only the cardinality
      // connective and its threshold flip: ¬(≥n R.C) ≡ ≤(n−1) R.C,
      // ¬(≤n R.C) ≡ ≥(n+1) R.C.
      const c = pushNegation(expr.c, false);
      if (!negate) return { t: expr.t, n: expr.n, r: expr.r, c };
      return expr.t === "atLeast" ? { t: "atMost", n: expr.n - 1, r: expr.r, c } : { t: "atLeast", n: expr.n + 1, r: expr.r, c };
    }
    default: throw new TypeError(`toNNF: unknown expression tag "${expr.t}"`);
  }
}

/** Negation normal form: push every ¬ inward to the atoms/nominals. Pure. */
export function toNNF(expr) {
  return pushNegation(expr, false);
}

// ---- shared helpers ------------------------------------------------------

function sortedUnique(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter(Boolean));
  return [...set].sort();
}

function clampPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function clampNonNegativeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const CODE_REF_SHAPE = /[./\\#:@]/;

// ---- role hierarchy closure -------------------------------------------

/** A memoized forward walk over `edges` ([[from, to], …]): returns a
 *  function from a node to the full set of nodes reachable by following
 *  `edges`, transitively. One adjacency map built once, cached per query —
 *  the same shape syllogise.mjs's own buildAncestorCloser uses. */
function buildForwardWalk(edges) {
  const succ = new Map();
  for (const [a, b] of edges || []) {
    if (!a || !b || a === b) continue;
    if (!succ.has(a)) succ.set(a, new Set());
    succ.get(a).add(b);
  }
  const cache = new Map();
  return (start) => {
    if (cache.has(start)) return cache.get(start);
    const seen = new Set();
    const stack = [...(succ.get(start) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const next of succ.get(n) || []) if (!seen.has(next)) stack.push(next);
    }
    cache.set(start, seen);
    return seen;
  };
}

/** For every role in `roleNames`, the set of roles (including itself) whose
 *  edges count as that role's own edges under `rdfs:subPropertyOf` —
 *  every role at or below it in the hierarchy. `subPropertyEdges` is
 *  `[[sub, sup], …]`. Precomputed once per KB, so a rule reading "does this
 *  edge satisfy role X" is one Set lookup, not a walk. */
function buildRoleClosure(subPropertyEdges, roleNames) {
  const subRolesOf = buildForwardWalk((subPropertyEdges || []).map(([sub, sup]) => [sup, sub]));
  const closure = new Map();
  for (const role of roleNames) closure.set(role, new Set([role, ...subRolesOf(role)]));
  return closure;
}

/** Does an edge labelled `edgeRole` satisfy a rule asking for `role`? True
 *  when they're the same role, or when `edgeRole` is a declared sub-role of
 *  `role` under the KB's precomputed role closure. With no closure entry for
 *  `role` (it never appeared in a stored `owl:onProperty` or
 *  `rdfs:subPropertyOf` row), only an exact match counts — the same
 *  behaviour every rule had before role hierarchies existed. */
function roleCountsAs(kb, edgeRole, role) {
  if (edgeRole === role) return true;
  const counted = kb && kb.roleClosure ? kb.roleClosure.get(role) : null;
  return counted ? counted.has(edgeRole) : false;
}

/** Every target a role-`role` edge from `nodeId` reaches, reading BOTH the
 *  forward direction (an outgoing edge whose own role counts as `role`) and,
 *  when the KB declares an inverse for an edge's role, the reverse direction
 *  (an INCOMING edge whose role's registered inverse counts as `role`) —
 *  the ∃/∀/≥/≤ rules all read role edges through this one function, so
 *  every one of them is inverse-aware for free. With no inverses declared
 *  this reduces to the plain forward walk every rule had before. */
function roleEdgeTargets(branch, kb, nodeId, role) {
  const targets = [];
  for (const e of branch.edges) {
    if (e.from === nodeId && roleCountsAs(kb, e.r, role)) {
      targets.push({ to: e.to, fromFacts: e.fromFacts });
    } else if (e.to === nodeId) {
      const inv = kb && kb.inverseOf ? kb.inverseOf.get(e.r) : null;
      if (inv && roleCountsAs(kb, inv, role)) targets.push({ to: e.from, fromFacts: e.fromFacts });
    }
  }
  return targets;
}

// Meta-vocabulary objects a `rdf:type` row can carry that describe the
// tableau's OWN scaffolding (a restriction node, a role's transitivity tag,
// a class-expression node's own type tag) rather than an ABox assertion
// about a real individual. Every writer strips the CURIE prefix before
// storage, so these are the post-normalization local names.
const META_TYPE_OBJECTS = new Set(["restriction", "transitiveproperty", "class"]);

// ---- tri-state budgets ----------------------------------------------------

export const DEFAULT_PROVE_STEPS = 5000;
export const DEFAULT_PROVE_BRANCHES = 256;
export const DEFAULT_PROVE_NODES = 512;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE in syllogise.mjs, same
 *  reason: a case-split conclusion never outranks its weakest premise. Not
 *  used inside this module — trust computation needs premise trusts this
 *  module never sees, so the caller pairs this with entailedTrustFrom. */
export const TABLEAU_RULE_CONFIDENCE = 0.95;
export const DEFAULT_MODULE_HOPS = 4;
/** Caps how many asserted ABox role edges one KB admits — a data-structure
 *  size bound for termination, applied after sorting so truncation is
 *  deterministic rather than arrival-ordered. */
export const MAX_ROLE_ASSERTIONS = 256;

// ---- identity: the UNA-lite merge machinery --------------------------------
//
// One general-purpose merge, built here for the ≤-rule's surplus-successor
// merge and reused as-is once the nominal-merge rule lands. The identity
// side-condition is the same wherever a merge is attempted: never merge two
// nodes that carry distinct declared individual names, and never merge two
// nodes an inequality already separates — attempting either is itself a
// clash (section 8.3), not a step the search takes silently.

// A synthetic successor id always ends in ".<positive integer>" (the ∃/≥
// rules mint `${parent.id}.${count}`) — the one shape a real declared name
// never takes in this corpus (a code-ref name ends in an extension or a
// symbol, never a bare digit run).
const SYNTHETIC_SUCCESSOR_SUFFIX = /\.\d+$/;

/** Is `id` a name UNA-lite treats as a distinct declared individual? A
 *  subsumption proof's own fresh individual ("fresh-0", and anything it
 *  generates) is explicitly excluded — it is an arbitrary hypothetical
 *  instance, never a declared name. */
function isNamedForUnaLite(kb, id) {
  if (id === "fresh-0") return false;
  if (kb && kb.namedIndividuals && kb.namedIndividuals.has(id)) return true;
  return !SYNTHETIC_SUCCESSOR_SUFFIX.test(id);
}

function pairKey(a, b) {
  return a < b ? `${a}␟${b}` : `${b}␟${a}`;
}

function markDistinct(branch, a, b, from) {
  if (a === b) return;
  const key = pairKey(a, b);
  const existing = branch.inequalityFrom.get(key);
  branch.inequalityFrom.set(key, existing ? sortedUnique([...existing, ...from]) : sortedUnique(from));
}

/** May `a` and `b` never be merged? Either both are UNA-lite-distinct
 *  declared names, or the branch already carries an explicit inequality
 *  between them (from a stored owl:differentFrom row, or from the ≥-rule's
 *  own pairwise-distinct successor bookkeeping). */
function isMergeBlocked(branch, kb, a, b) {
  if (a === b) return false;
  if (isNamedForUnaLite(kb, a) && isNamedForUnaLite(kb, b)) return true;
  return branch.inequalityFrom.has(pairKey(a, b));
}

/** The stored reason `a` and `b` are inequal, if any — empty when the block
 *  came purely from both being distinct declared names (a UNA-lite policy
 *  fact, not a stored one). */
function mergeBlockPremises(branch, a, b) {
  const stored = branch.inequalityFrom.get(pairKey(a, b));
  return stored ? stored.slice() : [];
}

function pickMergeSurvivor(kb, aId, bId) {
  const aNamed = isNamedForUnaLite(kb, aId);
  const bNamed = isNamedForUnaLite(kb, bId);
  if (aNamed && !bNamed) return [aId, bId];
  if (bNamed && !aNamed) return [bId, aId];
  return aId < bId ? [aId, bId] : [bId, aId];
}

/** Merge two nodes in place: the survivor (a named individual if either
 *  side is one, else the lexicographically first id) absorbs the other's
 *  labels, edges redirect and de-dup, any inequality pair naming the
 *  removed node remaps onto the survivor, and any other node's parent
 *  pointer follows too. Returns the surviving node's id. Never called on a
 *  blocked pair — the caller checks isMergeBlocked first. */
function mergeNodes(branch, kb, aId, bId) {
  if (aId === bId) return aId;
  const [keepId, removeId] = pickMergeSurvivor(kb, aId, bId);
  const keep = branch.nodes.get(keepId);
  const remove = branch.nodes.get(removeId);
  if (!keep || !remove) return keepId;

  for (const [key, { expr, from }] of remove.labels) {
    const existing = keep.labels.get(key);
    keep.labels.set(key, { expr, from: existing ? sortedUnique([...existing.from, ...from]) : from.slice() });
  }

  const redirected = [];
  const seenEdges = new Map();
  for (const e of branch.edges) {
    const from = e.from === removeId ? keepId : e.from;
    const to = e.to === removeId ? keepId : e.to;
    const dedupeKey = `${from}␟${e.r}␟${to}`;
    const already = seenEdges.get(dedupeKey);
    if (already) already.fromFacts = sortedUnique([...already.fromFacts, ...e.fromFacts]);
    else {
      const merged = { from, r: e.r, to, fromFacts: e.fromFacts.slice() };
      seenEdges.set(dedupeKey, merged);
      redirected.push(merged);
    }
  }
  branch.edges = redirected;

  for (const node of branch.nodes.values()) {
    if (node.parent === removeId) node.parent = keepId;
  }

  const remapped = new Map();
  for (const [rawKey, from] of branch.inequalityFrom) {
    const [x, y] = rawKey.split("␟");
    const nx = x === removeId ? keepId : x;
    const ny = y === removeId ? keepId : y;
    if (nx === ny) continue;
    const newKey = pairKey(nx, ny);
    const already = remapped.get(newKey);
    remapped.set(newKey, already ? sortedUnique([...already, ...from]) : from);
  }
  branch.inequalityFrom = remapped;

  branch.nodes.delete(removeId);
  return keepId;
}

// ---- nodes, edges, branches ------------------------------------------------

function makeNode(id, parent) {
  return {
    id,
    labels: new Map(),        // canonicalKey -> { expr, from: string[] }
    parent: parent ?? null,
    branchedOn: new Set(),    // or-label keys already resolved in this branch
    appliedAxioms: new Set(), // TBox axiom indices already internalized on this node
    successorCount: 0,
  };
}

function addLabel(node, expr, from) {
  const key = canonicalKey(expr);
  if (node.labels.has(key)) return false;
  node.labels.set(key, { expr, from: sortedUnique(from) });
  return true;
}

function sortedLabelEntries(node) {
  return [...node.labels.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** A node clashes when its label set holds bottom, or holds both an
 *  expression and that expression's NNF negation. Returns the first clash
 *  found in sorted-key order (deterministic), or null. */
function detectClash(node) {
  if (node.labels.has("bot")) {
    return { nodeId: node.id, keyA: "bot", keyB: "bot", premises: node.labels.get("bot").from.slice() };
  }
  const keys = [...node.labels.keys()].sort();
  for (const key of keys) {
    const { expr, from } = node.labels.get(key);
    const compKey = canonicalKey(toNNF(notE(expr)));
    if (compKey <= key) continue; // each unordered pair is reported once, from its smaller key
    const other = node.labels.get(compKey);
    if (other) return { nodeId: node.id, keyA: key, keyB: compKey, premises: sortedUnique([...from, ...other.from]) };
  }
  return null;
}

/** The set of role labels on edges INTO `nodeId` — what pairwise blocking
 *  (below) compares between a candidate and its ancestor once inverse roles
 *  exist. */
function predecessorRoleLabels(branch, nodeId) {
  const set = new Set();
  for (const e of branch.edges) if (e.to === nodeId) set.add(e.r);
  return set;
}

// Equality blocking: a node is blocked only by an ancestor whose label set is
// exactly the same, not merely a superset. Subset blocking is sound and
// complete for plain ALC, but a transitive role's ∀-rule copies a universal
// label onto every successor down the transitive chain (below), and subset
// blocking can stop that copy one step early, before the copied universal
// has actually produced the same consequences the blocking ancestor already
// carries. Equality blocking is the standard SHIQ-family fix, adopted here
// once transitive roles exist rather than only when a KB happens to declare
// one, so the same blocking rule runs every time.
//
// Pairwise blocking (Horrocks & Sattler): once inverse roles let a rule read
// an edge backwards, a candidate and its blocking ancestor must also match
// on the ROLE LABELS of their own incoming edges, not just their concept
// labels — otherwise a node whose real predecessor differs from its
// ancestor's could silently inherit the wrong incoming-edge behaviour. Only
// checked when the KB actually declares an inverse; with none declared this
// is byte-identical to plain equality blocking.
function isBlocked(node, branch, kb) {
  const keys = [...node.labels.keys()];
  const pairwise = !!(kb && kb.inverseOf && kb.inverseOf.size > 0);
  const nodePred = pairwise ? predecessorRoleLabels(branch, node.id) : null;
  let ancestorId = node.parent;
  while (ancestorId) {
    const ancestor = branch.nodes.get(ancestorId);
    if (!ancestor) break;
    if (keys.length === ancestor.labels.size && keys.every((k) => ancestor.labels.has(k))) {
      if (!pairwise) return true;
      const ancestorPred = predecessorRoleLabels(branch, ancestor.id);
      if (nodePred.size === ancestorPred.size && [...nodePred].every((r) => ancestorPred.has(r))) return true;
    }
    ancestorId = ancestor.parent;
  }
  return false;
}

function cloneBranch(branch) {
  const nodes = new Map();
  for (const [id, node] of branch.nodes) {
    nodes.set(id, {
      id: node.id,
      labels: new Map(node.labels),
      parent: node.parent,
      branchedOn: new Set(node.branchedOn),
      appliedAxioms: new Set(node.appliedAxioms),
      successorCount: node.successorCount,
    });
  }
  return { nodes, edges: branch.edges.slice(), closed: false, clash: null, inequalityFrom: new Map(branch.inequalityFrom) };
}

// ---- the expansion rules, fixed priority -----------------------------

function applyAndRule(branch) {
  for (const node of branch.nodes.values()) {
    for (const [, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "and") continue;
      let changed = false;
      for (const c of expr.cs) if (addLabel(node, c, from)) changed = true;
      if (changed) return { applied: true, touched: [node.id] };
    }
  }
  return { applied: false, touched: [] };
}

/** Two nodes labelled with the SAME nominal must be the same individual —
 *  there is no alternative to branch over, so this is a deterministic
 *  action, unlike the ≤-rule's choice of which pair to merge. Picks the
 *  first (sorted) nominal key that has 2+ carriers and the first (sorted)
 *  pair among them, so the result is the same regardless of iteration
 *  order. */
function applyNominalMergeRule(branch, kb) {
  const byNom = new Map();
  for (const node of branch.nodes.values()) {
    for (const key of node.labels.keys()) {
      if (!key.startsWith("nom(")) continue;
      if (!byNom.has(key)) byNom.set(key, []);
      byNom.get(key).push(node.id);
    }
  }
  const keys = [...byNom.keys()].sort();
  for (const key of keys) {
    const ids = [...new Set(byNom.get(key))].sort();
    if (ids.length < 2) continue;
    const [a, b] = ids;
    if (isMergeBlocked(branch, kb, a, b)) {
      const fromA = branch.nodes.get(a).labels.get(key)?.from || [];
      const fromB = branch.nodes.get(b).labels.get(key)?.from || [];
      return {
        kind: "clash",
        clash: { nodeId: a, keyA: key, keyB: `merge(${a},${b})`, premises: sortedUnique([...fromA, ...fromB, ...mergeBlockPremises(branch, a, b)]) },
      };
    }
    return { kind: "merge", a, b };
  }
  return { kind: "none" };
}

/** The universal rule. For a transitive role, an r-successor also receives
 *  the universal label itself, not just its filler — that is what lets
 *  ∀r.C reach an r-successor's own r-successor with no separate rule: the
 *  copied label fires this same rule again, one hop further, the next time
 *  the search loop revisits it. Reads role edges through roleEdgeTargets,
 *  so a declared inverse lets an incoming edge satisfy the universal too. */
function applyAllRule(branch, kb) {
  const transitiveRoles = kb && kb.transitiveRoles instanceof Set ? kb.transitiveRoles : null;
  for (const node of branch.nodes.values()) {
    for (const [, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "all") continue;
      const touched = [];
      for (const { to, fromFacts } of roleEdgeTargets(branch, kb, node.id, expr.r)) {
        const succ = branch.nodes.get(to);
        if (!succ) continue;
        const succFrom = [...from, ...fromFacts];
        if (addLabel(succ, expr.c, succFrom)) touched.push(succ.id);
        if (transitiveRoles && transitiveRoles.has(expr.r) && addLabel(succ, expr, succFrom)) touched.push(succ.id);
      }
      if (touched.length) return { applied: true, touched };
    }
  }
  return { applied: false, touched: [] };
}

function applyTboxRule(branch, kb) {
  for (const node of branch.nodes.values()) {
    for (let i = 0; i < kb.axioms.length; i += 1) {
      if (node.appliedAxioms.has(i)) continue;
      const axiom = kb.axioms[i];
      node.appliedAxioms.add(i);
      if (addLabel(node, axiom.disjunction, axiom.from)) return { applied: true, touched: [node.id] };
    }
  }
  return { applied: false, touched: [] };
}

/** null when `expr` would NOT immediately clash on `node`; otherwise the
 *  `from` provenance of whatever already-present label makes it clash — the
 *  reason a disjunct got eliminated, which the survivor(s) it leaves behind
 *  must carry forward as part of their own justification. */
function wouldClashFrom(node, expr) {
  if (canonicalKey(expr) === "bot") return [];
  const compKey = canonicalKey(toNNF(notE(expr)));
  const other = node.labels.get(compKey);
  return other ? other.from : null;
}

/** The disjunctive rule. Non-branching shortcuts first (a disjunct already
 *  present needs no branch; only one live disjunct needs no branch; zero
 *  live disjuncts closes the branch outright) — each is sound, since the
 *  branching case below always explores every disjunct anyway, these just
 *  skip branches whose outcome is already decided. An eliminated disjunct's
 *  own clash provenance carries forward into whatever survives it, so a
 *  proof's premise set names the fact that ruled the alternative out, not
 *  just the axiom that offered it. */
function applyOrRule(branch) {
  for (const node of branch.nodes.values()) {
    for (const [key, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "or") continue;
      if (node.branchedOn.has(key)) continue;
      const cs = [...expr.cs].sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b)));
      if (cs.some((c) => node.labels.has(canonicalKey(c)))) {
        node.branchedOn.add(key);
        continue;
      }
      const evaluated = cs.map((c) => ({ c, clashFrom: wouldClashFrom(node, c) }));
      const survivors = evaluated.filter((e) => e.clashFrom === null).map((e) => e.c);
      const eliminatedFrom = evaluated.filter((e) => e.clashFrom !== null).flatMap((e) => e.clashFrom);
      if (survivors.length === 0) {
        return {
          kind: "clash",
          clash: { nodeId: node.id, keyA: canonicalKey(cs[0]), keyB: canonicalKey(toNNF(notE(cs[0]))), premises: sortedUnique([...from, ...eliminatedFrom]) },
        };
      }
      if (survivors.length === 1) {
        node.branchedOn.add(key);
        addLabel(node, survivors[0], [...from, ...eliminatedFrom]);
        return { kind: "applied", touched: [node.id] };
      }
      node.branchedOn.add(key);
      return { kind: "split", node, from, disjuncts: survivors };
    }
  }
  return { kind: "none" };
}

function applySomeRule(branch, kb) {
  for (const node of branch.nodes.values()) {
    if (isBlocked(node, branch, kb)) continue; // generating rule — blocked nodes create no successors
    for (const [, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "some") continue;
      const cKey = canonicalKey(expr.c);
      const hasWitness = roleEdgeTargets(branch, kb, node.id, expr.r).some((t) => branch.nodes.get(t.to)?.labels.has(cKey));
      if (hasWitness) continue;
      node.successorCount += 1;
      const child = makeNode(`${node.id}.${node.successorCount}`, node.id);
      addLabel(child, expr.c, from);
      branch.nodes.set(child.id, child);
      branch.edges.push({ from: node.id, r: expr.r, to: child.id, fromFacts: from.slice() });
      return { applied: true, touched: [child.id] };
    }
  }
  return { applied: false, touched: [] };
}

/** The ≤-rule. When a node's r/C-witnesses (read inverse-aware, through
 *  roleEdgeTargets) outnumber the cardinality's threshold, some pair must
 *  merge. A surplus with fewer than 2 witnesses to pair (n=0 with exactly
 *  one witness) can never be brought down by merging at all — an
 *  unconditional clash, citing the witness's own filler-label premises too,
 *  so it names both restrictions. Otherwise, every pair blocked by the
 *  UNA-lite identity side-condition is a direct clash (both the
 *  cardinality's own premises and the blocking inequality's — the E5
 *  shape); with at least one mergeable pair, branches over each, in a fixed
 *  pair order, exactly like the ⊔-rule's own disjunct branching. */
function applyAtMostRule(branch, kb) {
  for (const node of branch.nodes.values()) {
    for (const [key, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "atMost") continue;
      const cKey = canonicalKey(expr.c);
      const witnesses = [...new Set(roleEdgeTargets(branch, kb, node.id, expr.r).map((t) => t.to))]
        .filter((id) => branch.nodes.get(id)?.labels.has(cKey))
        .sort();
      if (witnesses.length <= expr.n) continue;
      const pairs = [];
      for (let i = 0; i < witnesses.length; i += 1) {
        for (let j = i + 1; j < witnesses.length; j += 1) pairs.push([witnesses[i], witnesses[j]]);
      }
      if (pairs.length === 0) {
        const witnessFrom = branch.nodes.get(witnesses[0])?.labels.get(cKey)?.from || [];
        return {
          kind: "clash",
          clash: { nodeId: node.id, keyA: key, keyB: `witness(${witnesses[0]})`, premises: sortedUnique([...from, ...witnessFrom]) },
        };
      }
      const mergeable = pairs.filter(([a, b]) => !isMergeBlocked(branch, kb, a, b));
      if (mergeable.length === 0) {
        const [a, b] = pairs[0];
        return {
          kind: "clash",
          clash: { nodeId: node.id, keyA: key, keyB: `merge(${a},${b})`, premises: sortedUnique([...from, ...mergeBlockPremises(branch, a, b)]) },
        };
      }
      return { kind: "split-merge", pairs: mergeable };
    }
  }
  return { kind: "none" };
}

/** The ≥-rule. A generating rule — never fires on a blocked node, and
 *  (like the ∃-rule) creates exactly ONE fresh successor per invocation, so
 *  the step budget scales with n rather than a whole restriction landing in
 *  a single step. The search loop re-invokes it until the node's r/C-
 *  witnesses (read inverse-aware, through roleEdgeTargets) reach the
 *  threshold. Each fresh successor is marked pairwise-distinct from every
 *  witness that already existed when it was created — that is what a ≥n
 *  restriction actually means (n DISTINCT fillers), and
 *  it is the bookkeeping the ≤-rule's identity side-condition later reads. */
function applyAtLeastRule(branch, kb) {
  for (const node of branch.nodes.values()) {
    if (isBlocked(node, branch, kb)) continue;
    for (const [, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "atLeast") continue;
      const cKey = canonicalKey(expr.c);
      const existing = [...new Set(roleEdgeTargets(branch, kb, node.id, expr.r).map((t) => t.to))]
        .filter((id) => branch.nodes.get(id)?.labels.has(cKey))
        .sort();
      if (existing.length >= expr.n) continue;
      node.successorCount += 1;
      const child = makeNode(`${node.id}.${node.successorCount}`, node.id);
      addLabel(child, expr.c, from);
      branch.nodes.set(child.id, child);
      branch.edges.push({ from: node.id, r: expr.r, to: child.id, fromFacts: from.slice() });
      for (const otherId of existing) markDistinct(branch, child.id, otherId, from);
      return { applied: true, touched: [child.id] };
    }
  }
  return { applied: false, touched: [] };
}

function checkTouched(branch, touched) {
  for (const id of touched) {
    const node = branch.nodes.get(id);
    const clash = node && detectClash(node);
    if (clash) return clash;
  }
  return null;
}

function afterTouch(branch, touched) {
  const clash = checkTouched(branch, touched);
  return clash ? { kind: "clash", clash } : { kind: "applied" };
}

/** Apply the first rule (in fixed priority order) that has any applicable
 *  instance, and report what happened. Never recurses — each call performs
 *  exactly one rule application (or one branch-point discovery); the caller
 *  loops. Order: deterministic non-generating rules first (⊓, ∀, ⊑), then
 *  the non-deterministic ⊔ and ≤ (each a genuine choice among several sound
 *  continuations), then the two generating rules last (≥, ∃) so a model
 *  grows only once nothing smaller finishes it. */
function stepOnce(branch, kb) {
  const and_ = applyAndRule(branch);
  if (and_.applied) return afterTouch(branch, and_.touched);

  const all_ = applyAllRule(branch, kb);
  if (all_.applied) return afterTouch(branch, all_.touched);

  const nomMerge_ = applyNominalMergeRule(branch, kb);
  if (nomMerge_.kind === "clash") return nomMerge_;
  if (nomMerge_.kind === "merge") {
    const keepId = mergeNodes(branch, kb, nomMerge_.a, nomMerge_.b);
    return afterTouch(branch, [keepId]);
  }

  const tbox_ = applyTboxRule(branch, kb);
  if (tbox_.applied) return afterTouch(branch, tbox_.touched);

  const or_ = applyOrRule(branch);
  if (or_.kind === "clash") return or_;
  if (or_.kind === "applied") return afterTouch(branch, or_.touched);
  if (or_.kind === "split") return or_;

  const atMost_ = applyAtMostRule(branch, kb);
  if (atMost_.kind === "clash") return atMost_;
  if (atMost_.kind === "split-merge") return atMost_;

  const atLeast_ = applyAtLeastRule(branch, kb);
  if (atLeast_.applied) return afterTouch(branch, atLeast_.touched);

  const some_ = applySomeRule(branch, kb);
  if (some_.applied) return afterTouch(branch, some_.touched);

  return { kind: "done" };
}

// ---- the branch-stack search driver ---------------------------------------

function serializeBranch(branch) {
  const nodes = [...branch.nodes.values()]
    .map((node) => ({
      id: node.id,
      parent: node.parent,
      labels: [...node.labels.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, { expr, from }]) => ({ expr, from })),
    }));
  const edges = branch.edges.map(({ from, r, to, fromFacts }) => ({ from, r, to, fromFacts: fromFacts.slice() }));
  return { nodes, edges };
}

/** Runs the explicit branch stack to either exhaustion (every branch
 *  closed — the KB is unsatisfiable), a found model (one branch complete
 *  and clash-free), or a budget breach. No recursion: branching pushes
 *  clones onto `stack`, an ordinary array used as a LIFO. */
function search(initialBranch, kb, opts) {
  const maxSteps = clampPositiveInt(opts.maxSteps, DEFAULT_PROVE_STEPS);
  const maxBranches = clampPositiveInt(opts.maxBranches, DEFAULT_PROVE_BRANCHES);
  const maxNodes = clampPositiveInt(opts.maxNodes, DEFAULT_PROVE_NODES);

  const stack = [initialBranch];
  let steps = 0;
  let branchesOpened = 1;
  const closedClashes = [];

  while (stack.length) {
    const branch = stack.pop();
    if (branch.closed) { closedClashes.push(branch.clash); continue; }
    if (branch.nodes.size > maxNodes) return { status: "exhausted", reason: "nodes", steps, branches: branchesOpened };

    for (;;) {
      const result = stepOnce(branch, kb);
      if (result.kind === "clash") {
        closedClashes.push(result.clash);
        break;
      }
      if (result.kind === "applied") {
        steps += 1;
        if (steps > maxSteps) return { status: "exhausted", reason: "steps", steps, branches: branchesOpened };
        if (branch.nodes.size > maxNodes) return { status: "exhausted", reason: "nodes", steps, branches: branchesOpened };
        continue;
      }
      if (result.kind === "split") {
        steps += 1;
        if (steps > maxSteps) return { status: "exhausted", reason: "steps", steps, branches: branchesOpened };
        const children = result.disjuncts.map((d) => {
          const clone = cloneBranch(branch);
          const cnode = clone.nodes.get(result.node.id);
          addLabel(cnode, d, result.from);
          const clash = detectClash(cnode);
          if (clash) { clone.closed = true; clone.clash = clash; }
          return clone;
        });
        for (let i = children.length - 1; i >= 0; i -= 1) {
          branchesOpened += 1;
          if (branchesOpened > maxBranches) return { status: "exhausted", reason: "branches", steps, branches: branchesOpened };
          stack.push(children[i]);
        }
        break;
      }
      if (result.kind === "split-merge") {
        steps += 1;
        if (steps > maxSteps) return { status: "exhausted", reason: "steps", steps, branches: branchesOpened };
        const children = result.pairs.map(([a, b]) => {
          const clone = cloneBranch(branch);
          const keepId = mergeNodes(clone, kb, a, b);
          const keepNode = clone.nodes.get(keepId);
          const clash = keepNode && detectClash(keepNode);
          if (clash) { clone.closed = true; clone.clash = clash; }
          return clone;
        });
        for (let i = children.length - 1; i >= 0; i -= 1) {
          branchesOpened += 1;
          if (branchesOpened > maxBranches) return { status: "exhausted", reason: "branches", steps, branches: branchesOpened };
          stack.push(children[i]);
        }
        break;
      }
      return { status: "satisfiable", model: serializeBranch(branch), steps, branches: branchesOpened };
    }
    if (branchesOpened > maxBranches) return { status: "exhausted", reason: "branches", steps, branches: branchesOpened };
  }
  return { status: "unsatisfiable", clashes: closedClashes, steps, branches: branchesOpened };
}

function buildInitialBranch(kb, extraAssertions) {
  const nodes = new Map();
  const ensureNode = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id, null));
    return nodes.get(id);
  };
  for (const ind of kb.individuals || []) ensureNode(ind);
  for (const a of kb.assertions || []) addLabel(ensureNode(a.ind), a.expr, a.from);
  for (const extra of extraAssertions || []) {
    if (!extra || !extra.ind || !extra.expr) continue;
    addLabel(ensureNode(extra.ind), toNNF(extra.expr), extra.from || []);
  }
  // Every nominal individual is trivially a member of its own singleton —
  // seed that self-label now, so the nominal-merge rule has something to
  // find the first time another node gets forced into the same nominal.
  for (const [ind, from] of kb.nominalIndividuals || []) {
    addLabel(ensureNode(ind), { t: "nom", ind }, from);
  }

  const inequalityFrom = new Map();
  for (const pair of kb.differentFrom || []) {
    if (!pair || !pair.a || !pair.b || pair.a === pair.b) continue;
    const key = pairKey(pair.a, pair.b);
    const existing = inequalityFrom.get(key);
    inequalityFrom.set(key, existing ? sortedUnique([...existing, ...pair.from]) : sortedUnique(pair.from));
  }

  // An asserted ABox role edge — the only source of a branch edge besides
  // the ∃/≥-rules' own generated successors. Pushed in the KB's own sorted
  // order (buildTableauKb sorts roleAssertions by subject/predicate/object
  // before returning), so the branch is byte-identical whatever order the
  // underlying rows arrived in.
  const edges = [];
  for (const ra of kb.roleAssertions || []) {
    ensureNode(ra.a);
    ensureNode(ra.b);
    edges.push({ from: ra.a, r: ra.r, to: ra.b, fromFacts: ra.from.slice() });
  }

  return { nodes, edges, closed: false, clash: null, inequalityFrom };
}

/** Is the KB plus the given assertions satisfiable? `extraAssertions` is
 *  `[{ ind, expr, from }, …]`; `ind` need not already be a KB individual — a
 *  proof query mints its own node (see proveEntailment/proveSubsumption).
 *  Pure, no I/O. */
export function isSatisfiable(kb, extraAssertions = [], opts = {}) {
  const branch = buildInitialBranch(kb, extraAssertions);
  // The base assertions alone (with no rule fired yet) can already clash —
  // e.g. two directly-stated complementary types on one individual — so the
  // initial branch needs the same clash check every rule application gets,
  // not just the ones the search loop discovers along the way.
  for (const node of branch.nodes.values()) {
    const clash = detectClash(node);
    if (clash) { branch.closed = true; branch.clash = clash; break; }
  }
  const result = search(branch, kb, opts);
  if (result.status === "exhausted") {
    return { satisfiable: null, exhausted: result.reason, steps: result.steps, branches: result.branches };
  }
  if (result.status === "satisfiable") {
    return { satisfiable: true, model: result.model, steps: result.steps, branches: result.branches };
  }
  return { satisfiable: false, closedClashes: result.clashes, steps: result.steps, branches: result.branches };
}

function proveByRefutation(kb, extraAssertions, opts) {
  const result = isSatisfiable(kb, extraAssertions, opts);
  if (result.satisfiable === null) return { status: "exhausted", reason: result.exhausted, steps: result.steps, branches: result.branches };
  if (result.satisfiable === false) {
    const premises = sortedUnique(result.closedClashes.flatMap((c) => c?.premises || []));
    return { status: "proved", premises, steps: result.steps, branches: result.branches };
  }
  return { status: "disproved", model: result.model, steps: result.steps, branches: result.branches };
}

/** Entailment by refutation: does the KB entail `subject : concept`,
 *  `subject` a named individual? Asserts NNF(¬concept) on the subject and
 *  checks satisfiability. Every branch closed → proved. An open branch →
 *  disproved, with the branch as a counter-model. Any budget hit →
 *  exhausted, never a verdict. */
export function proveEntailment(kb, subject, concept, opts = {}) {
  return proveByRefutation(kb, [{ ind: subject, expr: toNNF(notE(concept)), from: [] }], opts);
}

/** Class subsumption by refutation: does the KB entail `subClass ⊑
 *  superClass`? Mints one fresh individual, named "fresh-0", that touches
 *  nothing else in the KB — a subsumption proof owns its own namespace,
 *  disjoint from every real successor buildTableauKb or the ∃-rule could
 *  ever name — asserts `subClass ⊓ ¬superClass` on it, and checks
 *  satisfiability exactly as proveEntailment does. Same tri-state result.
 *  The fresh individual never touches kb.individuals and never appears in a
 *  rendered answer. */
export function proveSubsumption(kb, subClass, superClass, opts = {}) {
  const query = toNNF(andE([atom(subClass), notE(atom(superClass))]));
  return proveByRefutation(kb, [{ ind: "fresh-0", expr: query, from: [] }], opts);
}

// ---- reading the store into a KB -------------------------------------------

function describeClashKind(clash) {
  if (!clash) return "unsatisfiable";
  if (clash.keyA === "bot") return "bottom";
  return `complement:${clash.keyA}~${clash.keyB}`;
}

// The closed OWL/RDFS vocabulary buildTableauKb's own predicate dispatch
// recognises (lower-cased, matching the `p` this file always compares
// against). Shared with extractTableauModule so both agree on what counts
// as a role assertion — any row whose predicate is NOT in this set — rather
// than drifting into two separate definitions of "recognised vocabulary".
const RECOGNISED_KB_PREDICATES = new Set([
  "owl:onproperty", "owl:somevaluesfrom", "owl:allvaluesfrom", "owl:onclass",
  "owl:mincardinality", "owl:maxcardinality", "owl:cardinality",
  "rdfs:subclassof", "owl:disjointwith", "rdf:type", "mgxneg:subclassof",
  "owl:unionof", "owl:complementof", "rdfs:subpropertyof", "owl:differentfrom",
  "owl:oneof", "owl:inverseof",
]);

/** Build the tableau knowledge base from a row set — on a real question,
 *  the output of extractTableauModule, never the raw store. Pure. Returns
 *  { axioms, assertions, roles, individuals, transitiveRoles, roleClosure,
 *  namedIndividuals, nominalIndividuals, differentFrom, inverseOf,
 *  roleAssertions }. */
export function buildTableauKb(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.subject && r.predicate) : [];

  const onPropertyOf = new Map();   // restriction -> { object, id }
  const someValuesFromOf = new Map();
  const allValuesFromOf = new Map();
  const onClassOf = new Map();
  const cardinalityOf = new Map();  // restriction -> { kind, n, id }
  const unionMembersOf = new Map(); // union node -> [row, …]
  const complementOf = new Map();   // complement node -> row
  const oneOfMembersOf = new Map(); // enumerated class -> [row, …]
  const subClassRows = [];
  const disjointRows = [];
  const typeRows = [];
  const negTypeRows = [];
  const transitiveRoles = new Set();
  const subPropertyRows = [];
  const differentFromRows = [];
  const inverseOfRows = [];
  const roleAssertionCandidates = [];

  const pushMap = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };

  for (const r of list) {
    const p = String(r.predicate).trim().toLowerCase();
    if (p === "owl:onproperty") onPropertyOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:somevaluesfrom") someValuesFromOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:allvaluesfrom") allValuesFromOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:onclass") onClassOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:mincardinality") cardinalityOf.set(r.subject, { kind: "min", n: Number(r.object), id: r.id });
    else if (p === "owl:maxcardinality") cardinalityOf.set(r.subject, { kind: "max", n: Number(r.object), id: r.id });
    else if (p === "owl:cardinality") cardinalityOf.set(r.subject, { kind: "exact", n: Number(r.object), id: r.id });
    else if (p === "rdfs:subclassof") subClassRows.push(r);
    else if (p === "owl:disjointwith") disjointRows.push(r);
    else if (p === "rdf:type") {
      typeRows.push(r);
      if (String(r.object || "").toLowerCase() === "transitiveproperty") transitiveRoles.add(r.subject);
    }
    else if (p === "mgxneg:subclassof") negTypeRows.push(r);
    else if (p === "owl:unionof") pushMap(unionMembersOf, r.subject, r);
    else if (p === "owl:complementof") complementOf.set(r.subject, r);
    else if (p === "rdfs:subpropertyof") subPropertyRows.push(r);
    else if (p === "owl:differentfrom") differentFromRows.push(r);
    else if (p === "owl:oneof") pushMap(oneOfMembersOf, r.subject, r);
    else if (p === "owl:inverseof") inverseOfRows.push(r);
    else roleAssertionCandidates.push(r);
  }

  const individualNamesFromType = new Set();
  for (const r of typeRows) {
    const obj = String(r.object || "").toLowerCase();
    if (!META_TYPE_OBJECTS.has(obj)) individualNamesFromType.add(r.subject);
  }
  const isIndividualTerm = (term) => CODE_REF_SHAPE.test(term) || individualNamesFromType.has(term);

  // An asserted role edge between two named individuals: any predicate
  // outside the recognised OWL/RDFS vocabulary, both of whose terms resolve
  // as individuals — a class-level relation ("human mgx:capableOf think")
  // is not read as an ABox edge. Classification waits for
  // individualNamesFromType above to exist, so candidates are collected in
  // the predicate-dispatch pass and filtered here, in a second pass. Sorted
  // by subject, then predicate, then object, and capped AFTER sorting so
  // truncation is deterministic rather than arrival-ordered.
  const roleAssertions = roleAssertionCandidates
    .filter((r) => isIndividualTerm(r.subject) && isIndividualTerm(r.object))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.predicate.localeCompare(b.predicate) || a.object.localeCompare(b.object))
    .slice(0, MAX_ROLE_ASSERTIONS)
    .map((r) => ({ a: r.subject, r: r.predicate, b: r.object, from: [r.id] }));

  const mkAxiom = (sub, sup, from) => ({ sub, sup, from: sortedUnique(from), disjunction: toNNF(orE([notE(sub), sup])) });

  const axioms = [];
  const assertions = [];

  for (const r of subClassRows) {
    const restriction = r.object;
    if (!onPropertyOf.has(restriction)) {
      axioms.push(mkAxiom(atom(r.subject), atom(restriction), [r.id]));
      continue;
    }
    const propRow = onPropertyOf.get(restriction);
    const svfRow = someValuesFromOf.get(restriction);
    if (svfRow) {
      axioms.push(mkAxiom(atom(r.subject), someE(propRow.object, atom(svfRow.object)), [r.id, propRow.id, svfRow.id]));
      continue;
    }
    const avfRow = allValuesFromOf.get(restriction);
    if (avfRow) {
      axioms.push(mkAxiom(atom(r.subject), allE(propRow.object, atom(avfRow.object)), [r.id, propRow.id, avfRow.id]));
      continue;
    }
    const cardRow = cardinalityOf.get(restriction);
    const onClassRow = onClassOf.get(restriction);
    if (cardRow && onClassRow) {
      const cardIds = [r.id, propRow.id, onClassRow.id, cardRow.id];
      if (cardRow.kind === "min") {
        axioms.push(mkAxiom(atom(r.subject), { t: "atLeast", n: cardRow.n, r: propRow.object, c: atom(onClassRow.object) }, cardIds));
      } else if (cardRow.kind === "max") {
        axioms.push(mkAxiom(atom(r.subject), { t: "atMost", n: cardRow.n, r: propRow.object, c: atom(onClassRow.object) }, cardIds));
      } else if (cardRow.kind === "exact") {
        axioms.push(mkAxiom(atom(r.subject), { t: "atLeast", n: cardRow.n, r: propRow.object, c: atom(onClassRow.object) }, cardIds));
        axioms.push(mkAxiom(atom(r.subject), { t: "atMost", n: cardRow.n, r: propRow.object, c: atom(onClassRow.object) }, cardIds));
      }
    }
    // An unqualified restriction (no owl:onClass) isn't representable as a
    // qualified-cardinality axiom yet — skipped, not guessed at.
  }

  for (const r of disjointRows) {
    if (isIndividualTerm(r.subject)) assertions.push({ ind: r.subject, expr: toNNF(notE(atom(r.object))), from: [r.id] });
    else axioms.push(mkAxiom(atom(r.subject), toNNF(notE(atom(r.object))), [r.id]));
  }

  for (const r of typeRows) {
    if (META_TYPE_OBJECTS.has(String(r.object || "").toLowerCase())) continue; // scaffolding, not an ABox fact
    assertions.push({ ind: r.subject, expr: atom(r.object), from: [r.id] });
  }

  for (const r of negTypeRows) assertions.push({ ind: r.subject, expr: toNNF(notE(atom(r.object))), from: [r.id] });

  for (const [unionId, memberRows] of unionMembersOf) {
    const sorted = [...memberRows].sort((a, b) => String(a.object).localeCompare(String(b.object)));
    const cs = sorted.map((mr) => atom(mr.object));
    const ids = sorted.map((mr) => mr.id);
    const orExpr = toNNF(orE(cs));
    axioms.push(mkAxiom(atom(unionId), orExpr, ids));
    axioms.push(mkAxiom(orExpr, atom(unionId), ids));
  }

  for (const [complementId, r] of complementOf) {
    const notAtom = toNNF(notE(atom(r.object)));
    axioms.push(mkAxiom(atom(complementId), notAtom, [r.id]));
    axioms.push(mkAxiom(notAtom, atom(complementId), [r.id]));
  }

  // owl:oneOf: the enumerated class is subsumed by the union of its members'
  // singleton (nominal) concepts, and each member's singleton is in turn
  // subsumed by the enumerated class — a closed class, per section 8.6.
  // Every member also gets its own self-label ({ind} ⊑ {ind}, trivially
  // true) seeded at branch-init time (buildInitialBranch), so the nominal-
  // merge rule has a real carrier of the nominal to merge an outsider into.
  const nominalIndividuals = new Map(); // ind -> fact ids that declared it
  for (const [classId, memberRows] of oneOfMembersOf) {
    const sorted = [...memberRows].sort((a, b) => String(a.object).localeCompare(String(b.object)));
    const nomExprs = sorted.map((mr) => ({ t: "nom", ind: mr.object }));
    const ids = sorted.map((mr) => mr.id);
    axioms.push(mkAxiom(atom(classId), toNNF(orE(nomExprs)), ids));
    for (const mr of sorted) {
      axioms.push(mkAxiom({ t: "nom", ind: mr.object }, atom(classId), [mr.id]));
      const existing = nominalIndividuals.get(mr.object);
      nominalIndividuals.set(mr.object, existing ? sortedUnique([...existing, mr.id]) : [mr.id]);
    }
  }

  const differentFrom = differentFromRows
    .map((r) => ({ a: r.subject, b: r.object, from: [r.id] }))
    .sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b));

  // owl:inverseOf is stored symmetrically by the grammar (both directions
  // minted), but this reads either direction alone too, defensively.
  const inverseOf = new Map();
  for (const r of inverseOfRows) {
    inverseOf.set(r.subject, r.object);
    if (!inverseOf.has(r.object)) inverseOf.set(r.object, r.subject);
  }

  const roles = new Set();
  for (const { object } of onPropertyOf.values()) roles.add(object);
  for (const ra of roleAssertions) roles.add(ra.r);

  const subPropertyEdges = subPropertyRows
    .map((r) => [r.subject, r.object])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const roleNames = new Set([...roles, ...subPropertyEdges.flat(), ...inverseOf.keys(), ...inverseOf.values()]);
  const roleClosure = buildRoleClosure(subPropertyEdges, roleNames);

  axioms.sort((a, b) =>
    canonicalKey(a.sub).localeCompare(canonicalKey(b.sub)) ||
    canonicalKey(a.sup).localeCompare(canonicalKey(b.sup)) ||
    a.from.join(",").localeCompare(b.from.join(",")));
  assertions.sort((a, b) => a.ind.localeCompare(b.ind) || canonicalKey(a.expr).localeCompare(canonicalKey(b.expr)));

  const individuals = [...new Set([
    ...assertions.map((a) => a.ind),
    ...roleAssertions.flatMap((ra) => [ra.a, ra.b]),
  ])].sort();
  const namedIndividuals = new Set(individuals);

  return {
    axioms, assertions, roles: [...roles].sort(), individuals, transitiveRoles, roleClosure,
    namedIndividuals, nominalIndividuals, differentFrom, inverseOf, roleAssertions,
  };
}

function restrictKbToIndividual(kb, ind) {
  return {
    axioms: kb.axioms,
    assertions: (kb.assertions || []).filter((a) => a.ind === ind),
    roles: kb.roles,
    individuals: [ind],
    transitiveRoles: kb.transitiveRoles,
    roleAssertions: kb.roleAssertions,
    roleClosure: kb.roleClosure,
    namedIndividuals: kb.namedIndividuals,
    nominalIndividuals: kb.nominalIndividuals,
    differentFrom: kb.differentFrom,
    inverseOf: kb.inverseOf,
  };
}

/** Every clash the KB produces on its own, with both premises named. Pure.
 *  `subjects` defaults to every individual the KB asserts something about.
 *  A subject whose own check exhausts its budget is omitted, never reported
 *  as clean — a partial check must never look like a clean bill. */
export function findTableauViolations(kb, subjects = null, opts = {}) {
  const list = [...new Set(Array.isArray(subjects) && subjects.length ? subjects : kb.individuals || [])].sort();
  const violations = [];
  for (const subject of list) {
    const restricted = restrictKbToIndividual(kb, subject);
    if (!restricted.assertions.length) continue;
    const result = isSatisfiable(restricted, [], opts);
    if (result.satisfiable === null || result.satisfiable === true) continue;
    const premises = sortedUnique(result.closedClashes.flatMap((c) => c?.premises || []));
    violations.push({ subject, premises, kind: describeClashKind(result.closedClashes[0]) });
  }
  violations.sort((a, b) => a.subject.localeCompare(b.subject));
  return violations;
}

// ---- KB module extraction ---------------------------------------------------

function addToSetMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

/** Restrict fact rows to the signature-connected module around a set of
 *  seed terms. `rdfs:subClassOf` closes unbounded in both directions (it is
 *  always followed, at no hop cost); a restriction's filler (owl:onProperty
 *  / owl:someValuesFrom / owl:allValuesFrom / owl:onClass) and owl:unionOf /
 *  owl:complementOf / owl:oneOf membership are hop-bounded structural edges.
 *  Reaching a term through a restriction's filler edge re-seeds that term's
 *  own walk at the full hop budget, so a chain of restrictions extends the
 *  module without an unbounded hop count; a union/complement/oneOf
 *  membership edge simply spends one hop. An asserted ABox role edge
 *  (buildTableauKb's own role-assertion reader test: a predicate outside
 *  the recognised OWL/RDFS vocabulary, both terms individuals) reseeds its
 *  far endpoint's own walk the same way a restriction filler does — a chain
 *  of asserted edges extends the module without an unbounded hop count
 *  either. The returned rows are every row whose subject or object lands in
 *  the resulting signature, plus any role axiom naming a role an included
 *  restriction or role assertion uses. Pure, no I/O. Returns the restricted
 *  row array, in the input's own row order. */
export function extractTableauModule(rows, seedTerms, { hops = DEFAULT_MODULE_HOPS } = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.subject && r.predicate) : [];
  const hopBudget = clampNonNegativeInt(hops, DEFAULT_MODULE_HOPS);

  const subUp = new Map();
  const subDown = new Map();
  const onPropertyOf = new Map();      // restriction -> role
  const fillerOf = new Map();          // restriction -> filler term
  const fillerBack = new Map();        // filler term -> Set(restriction)
  const unionMembers = new Map();
  const memberUnions = new Map();
  const complementPair = new Map();
  const memberComplements = new Map();
  const oneOfMembers = new Map();
  const memberOneOf = new Map();
  const roleAssertionRows = [];         // { subject, predicate, object } — same reader test as buildTableauKb
  const roleAssertionEndpoints = new Map(); // term -> Set(other endpoint), both directions

  const individualNamesFromType = new Set();
  for (const r of list) {
    if (String(r.predicate).trim().toLowerCase() !== "rdf:type") continue;
    const obj = String(r.object || "").toLowerCase();
    if (!META_TYPE_OBJECTS.has(obj)) individualNamesFromType.add(r.subject);
  }
  const isIndividualTerm = (term) => CODE_REF_SHAPE.test(term) || individualNamesFromType.has(term);

  for (const r of list) {
    const p = String(r.predicate).trim().toLowerCase();
    if (p === "rdfs:subclassof") { addToSetMap(subUp, r.subject, r.object); addToSetMap(subDown, r.object, r.subject); }
    else if (p === "owl:onproperty") onPropertyOf.set(r.subject, r.object);
    else if (p === "owl:somevaluesfrom" || p === "owl:allvaluesfrom" || p === "owl:onclass") { fillerOf.set(r.subject, r.object); addToSetMap(fillerBack, r.object, r.subject); }
    else if (p === "owl:unionof") { addToSetMap(unionMembers, r.subject, r.object); addToSetMap(memberUnions, r.object, r.subject); }
    else if (p === "owl:complementof") { complementPair.set(r.subject, r.object); addToSetMap(memberComplements, r.object, r.subject); }
    else if (p === "owl:oneof") { addToSetMap(oneOfMembers, r.subject, r.object); addToSetMap(memberOneOf, r.object, r.subject); }
    else if (!RECOGNISED_KB_PREDICATES.has(p) && isIndividualTerm(r.subject) && isIndividualTerm(r.object)) {
      roleAssertionRows.push(r);
      addToSetMap(roleAssertionEndpoints, r.subject, r.object);
      addToSetMap(roleAssertionEndpoints, r.object, r.subject);
    }
  }

  const subClosureCache = new Map();
  function subClosure(term) {
    if (subClosureCache.has(term)) return subClosureCache.get(term);
    const seen = new Set();
    const stack = [...(subUp.get(term) || []), ...(subDown.get(term) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const next of subUp.get(n) || []) if (!seen.has(next)) stack.push(next);
      for (const next of subDown.get(n) || []) if (!seen.has(next)) stack.push(next);
    }
    subClosureCache.set(term, seen);
    return seen;
  }

  const included = new Set();
  const bestHopsLeft = new Map();
  const queue = [];
  function enqueue(term, hopsLeft) {
    if (!term) return;
    const prior = bestHopsLeft.get(term);
    if (prior !== undefined && prior >= hopsLeft) return;
    bestHopsLeft.set(term, hopsLeft);
    queue.push({ term, hopsLeft });
  }

  const seeds = [...new Set((Array.isArray(seedTerms) ? seedTerms : []).map((t) => normFactTerm(t)).filter(Boolean))];
  for (const s of seeds) enqueue(s, hopBudget);

  let cursor = 0;
  while (cursor < queue.length) {
    const { term, hopsLeft } = queue[cursor];
    cursor += 1;
    if (bestHopsLeft.get(term) !== hopsLeft) continue; // a better visit already superseded this one

    included.add(term);
    for (const s of subClosure(term)) {
      included.add(s);
      enqueue(s, hopsLeft); // unbounded — free, no hop cost, no reseed
    }
    if (hopsLeft <= 0) continue;

    if (fillerOf.has(term)) enqueue(fillerOf.get(term), hopBudget); // restriction -> filler, reseeds
    for (const r of fillerBack.get(term) || []) enqueue(r, hopBudget); // filler -> restriction, reseeds

    for (const m of unionMembers.get(term) || []) enqueue(m, hopsLeft - 1);
    for (const u of memberUnions.get(term) || []) enqueue(u, hopsLeft - 1);
    if (complementPair.has(term)) enqueue(complementPair.get(term), hopsLeft - 1);
    for (const c of memberComplements.get(term) || []) enqueue(c, hopsLeft - 1);
    for (const m of oneOfMembers.get(term) || []) enqueue(m, hopsLeft - 1);
    for (const c of memberOneOf.get(term) || []) enqueue(c, hopsLeft - 1);

    // A role-assertion edge reseeds its far endpoint's own walk, the same
    // discipline a restriction chain gets — otherwise a question about one
    // end of an asserted edge extracts a module that does not contain the
    // edge, and the far endpoint's own facts (its type, its restrictions)
    // never enter the module either.
    for (const other of roleAssertionEndpoints.get(term) || []) enqueue(other, hopBudget);
  }

  const rolesUsed = new Set();
  for (const [restriction, role] of onPropertyOf) if (included.has(restriction)) rolesUsed.add(role);
  for (const r of roleAssertionRows) if (included.has(r.subject) || included.has(r.object)) rolesUsed.add(r.predicate);

  return list.filter((r) => {
    if (included.has(r.subject) || included.has(r.object)) return true;
    const p = String(r.predicate).trim().toLowerCase();
    if (p === "rdfs:subpropertyof" || p === "owl:inverseof") return rolesUsed.has(r.subject);
    if (p === "rdf:type" && String(r.object).toLowerCase() === "transitiveproperty") return rolesUsed.has(r.subject);
    return false;
  });
}
