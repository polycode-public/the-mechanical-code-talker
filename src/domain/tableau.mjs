// tableau.mjs — an ALC description-logic tableau prover: satisfiability,
// individual entailment, and class subsumption, over a KB read from the
// memory graph's stored OWL fragment. Query-time only, never materialised —
// a case-split conclusion depends on every branch of its proof, and batch
// provenance for that shape is a later problem.
//
// ALC connectives: top, bottom, atomic negation, intersection, union,
// existential and universal restriction. The concept-expression AST also
// carries a nominal tag and qualified-cardinality tags for a future
// role-hierarchy/nominal/cardinality increment to grow into; this module's
// own expansion rules and clash detection only reason over the ALC subset.
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

function isBlocked(node, branch) {
  const keys = [...node.labels.keys()];
  let ancestorId = node.parent;
  while (ancestorId) {
    const ancestor = branch.nodes.get(ancestorId);
    if (!ancestor) break;
    if (keys.every((k) => ancestor.labels.has(k))) return true;
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
  return { nodes, edges: branch.edges.slice(), closed: false, clash: null };
}

// ---- the five expansion rules, fixed priority -----------------------------

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

function applyAllRule(branch) {
  for (const node of branch.nodes.values()) {
    for (const [, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "all") continue;
      const touched = [];
      for (const edge of branch.edges) {
        if (edge.from !== node.id || edge.r !== expr.r) continue;
        const succ = branch.nodes.get(edge.to);
        if (succ && addLabel(succ, expr.c, [...from, ...edge.fromFacts])) touched.push(succ.id);
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

function applySomeRule(branch) {
  for (const node of branch.nodes.values()) {
    if (isBlocked(node, branch)) continue; // generating rule — blocked nodes create no successors
    for (const [, { expr, from }] of sortedLabelEntries(node)) {
      if (expr.t !== "some") continue;
      const cKey = canonicalKey(expr.c);
      const hasWitness = branch.edges.some((e) => e.from === node.id && e.r === expr.r && branch.nodes.get(e.to)?.labels.has(cKey));
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

function checkTouched(branch, touched) {
  for (const id of touched) {
    const node = branch.nodes.get(id);
    const clash = node && detectClash(node);
    if (clash) return clash;
  }
  return null;
}

/** Apply the first rule (in fixed priority order) that has any applicable
 *  instance, and report what happened. Never recurses — each call performs
 *  exactly one rule application (or one branch-point discovery); the caller
 *  loops. */
function stepOnce(branch, kb) {
  const and_ = applyAndRule(branch);
  if (and_.applied) {
    const clash = checkTouched(branch, and_.touched);
    return clash ? { kind: "clash", clash } : { kind: "applied" };
  }
  const all_ = applyAllRule(branch);
  if (all_.applied) {
    const clash = checkTouched(branch, all_.touched);
    return clash ? { kind: "clash", clash } : { kind: "applied" };
  }
  const tbox_ = applyTboxRule(branch, kb);
  if (tbox_.applied) {
    const clash = checkTouched(branch, tbox_.touched);
    return clash ? { kind: "clash", clash } : { kind: "applied" };
  }
  const or_ = applyOrRule(branch);
  if (or_.kind === "clash") return or_;
  if (or_.kind === "applied") {
    const clash = checkTouched(branch, or_.touched);
    return clash ? { kind: "clash", clash } : { kind: "applied" };
  }
  if (or_.kind === "split") return or_;
  const some_ = applySomeRule(branch);
  if (some_.applied) {
    const clash = checkTouched(branch, some_.touched);
    return clash ? { kind: "clash", clash } : { kind: "applied" };
  }
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
  return { nodes, edges: [], closed: false, clash: null };
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

/** Build the tableau knowledge base from a row set — on a real question,
 *  the output of extractTableauModule, never the raw store. Pure. Returns
 *  { axioms, assertions, roles, individuals }. */
export function buildTableauKb(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.subject && r.predicate) : [];

  const onPropertyOf = new Map();   // restriction -> { object, id }
  const someValuesFromOf = new Map();
  const onClassOf = new Map();
  const cardinalityOf = new Map();  // restriction -> { kind, n, id }
  const unionMembersOf = new Map(); // union node -> [row, …]
  const complementOf = new Map();   // complement node -> row
  const subClassRows = [];
  const disjointRows = [];
  const typeRows = [];
  const negTypeRows = [];

  const pushMap = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };

  for (const r of list) {
    const p = String(r.predicate).trim().toLowerCase();
    if (p === "owl:onproperty") onPropertyOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:somevaluesfrom") someValuesFromOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:onclass") onClassOf.set(r.subject, { object: r.object, id: r.id });
    else if (p === "owl:mincardinality") cardinalityOf.set(r.subject, { kind: "min", n: Number(r.object), id: r.id });
    else if (p === "owl:maxcardinality") cardinalityOf.set(r.subject, { kind: "max", n: Number(r.object), id: r.id });
    else if (p === "owl:cardinality") cardinalityOf.set(r.subject, { kind: "exact", n: Number(r.object), id: r.id });
    else if (p === "rdfs:subclassof") subClassRows.push(r);
    else if (p === "owl:disjointwith") disjointRows.push(r);
    else if (p === "rdf:type") typeRows.push(r);
    else if (p === "mgxneg:subclassof") negTypeRows.push(r);
    else if (p === "owl:unionof") pushMap(unionMembersOf, r.subject, r);
    else if (p === "owl:complementof") complementOf.set(r.subject, r);
    // owl:oneOf, owl:differentFrom, owl:TransitiveProperty (as rdf:type
    // object below), rdfs:subPropertyOf, owl:inverseOf: reserved for a
    // future increment, not read here.
  }

  const individualNamesFromType = new Set();
  for (const r of typeRows) {
    const obj = String(r.object || "").toLowerCase();
    if (!META_TYPE_OBJECTS.has(obj)) individualNamesFromType.add(r.subject);
  }
  const isIndividualTerm = (term) => CODE_REF_SHAPE.test(term) || individualNamesFromType.has(term);

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
    const cardRow = cardinalityOf.get(restriction);
    const onClassRow = onClassOf.get(restriction);
    if (cardRow && onClassRow && (cardRow.kind === "min" || cardRow.kind === "exact") && cardRow.n >= 1) {
      axioms.push(mkAxiom(atom(r.subject), someE(propRow.object, atom(onClassRow.object)), [r.id, propRow.id, onClassRow.id, cardRow.id]));
    }
    // A max-cardinality (or an unqualified/zero) restriction isn't
    // representable as an ALC axiom yet — skipped, not guessed at.
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

  const roles = new Set();
  for (const { object } of onPropertyOf.values()) roles.add(object);

  axioms.sort((a, b) =>
    canonicalKey(a.sub).localeCompare(canonicalKey(b.sub)) ||
    canonicalKey(a.sup).localeCompare(canonicalKey(b.sup)) ||
    a.from.join(",").localeCompare(b.from.join(",")));
  assertions.sort((a, b) => a.ind.localeCompare(b.ind) || canonicalKey(a.expr).localeCompare(canonicalKey(b.expr)));

  const individuals = [...new Set(assertions.map((a) => a.ind))].sort();

  return { axioms, assertions, roles: [...roles].sort(), individuals };
}

function restrictKbToIndividual(kb, ind) {
  return { axioms: kb.axioms, assertions: (kb.assertions || []).filter((a) => a.ind === ind), roles: kb.roles, individuals: [ind] };
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
 *  / owl:someValuesFrom / owl:onClass) and owl:unionOf / owl:complementOf /
 *  owl:oneOf membership are hop-bounded structural edges. Reaching a term
 *  through a restriction's filler edge re-seeds that term's own walk at the
 *  full hop budget, so a chain of restrictions extends the module without
 *  an unbounded hop count; a union/complement/oneOf membership edge simply
 *  spends one hop. The returned rows are every row whose subject or object
 *  lands in the resulting signature, plus any role axiom naming a role a
 *  included restriction uses. Pure, no I/O. Returns the restricted row
 *  array, in the input's own row order. */
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

  for (const r of list) {
    const p = String(r.predicate).trim().toLowerCase();
    if (p === "rdfs:subclassof") { addToSetMap(subUp, r.subject, r.object); addToSetMap(subDown, r.object, r.subject); }
    else if (p === "owl:onproperty") onPropertyOf.set(r.subject, r.object);
    else if (p === "owl:somevaluesfrom" || p === "owl:onclass") { fillerOf.set(r.subject, r.object); addToSetMap(fillerBack, r.object, r.subject); }
    else if (p === "owl:unionof") { addToSetMap(unionMembers, r.subject, r.object); addToSetMap(memberUnions, r.object, r.subject); }
    else if (p === "owl:complementof") { complementPair.set(r.subject, r.object); addToSetMap(memberComplements, r.object, r.subject); }
    else if (p === "owl:oneof") { addToSetMap(oneOfMembers, r.subject, r.object); addToSetMap(memberOneOf, r.object, r.subject); }
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
  }

  const rolesUsed = new Set();
  for (const [restriction, role] of onPropertyOf) if (included.has(restriction)) rolesUsed.add(role);

  return list.filter((r) => {
    if (included.has(r.subject) || included.has(r.object)) return true;
    const p = String(r.predicate).trim().toLowerCase();
    if (p === "rdfs:subpropertyof" || p === "owl:inverseof") return rolesUsed.has(r.subject);
    if (p === "rdf:type" && String(r.object).toLowerCase() === "transitiveproperty") return rolesUsed.has(r.subject);
    return false;
  });
}
