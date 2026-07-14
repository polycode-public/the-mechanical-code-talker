// syllogise.mjs — tmct's speculative-inference engine, growing toward
// tier-5 "the Syllogist". Offline, deterministic: forward-chains entailments
// over the OWL-labelled memory graph so a future query-time MISS becomes a
// lookup. `syllogise()` (the materializing pass) only runs as the explicit
// `npx tmct syllogise` batch job; the pure kernels below may also be reused
// for a small, bounded, read-only live check without writing anything.
//
// Five rules:
//   - scm-sco: (a ⊑ b), (b ⊑ c) ⊨ (a ⊑ c) — subClassOf transitivity (`deriveSubClassClosure`).
//   - cax-sco: (x rdf:type C), (C ⊑ … ⊑ D) ⊨ (x rdf:type D) — type propagates across a ⊑ chain (`deriveTypePropagation`).
//   - cax-dw: (x rdf:type C1), (C1 owl:disjointWith C2) ⊨ x is NOT of type C2, checked over C1's full ⊑-ancestor closure — the first rule that proves a "no" (`deriveDisjointViolations`).
//   - cls-svf1: (x P y), (y rdf:type C2), (R owl:onProperty P), (R owl:someValuesFrom C2) ⊨ (x rdf:type R) — someValuesFrom application; stops at restriction membership, doesn't chase the further intersectionOf/cls-int1 step (`deriveSomeValuesFromApplication`).
//   - scm-svf1: two independently declared someValuesFrom restrictions over the same property, with ⊑-related filler classes, entail the restriction nodes are themselves ⊑-related (`deriveSomeValuesFromSubsumption`).
//
// Four safety guards, shared by all five: BUDGET (max new derivations per
// pass, and max fixpoint rounds for scm-sco); FOCUS (an optional touched-
// class footprint scopes a derivation to what's relevant — no focus means
// whole-graph); SCREENS (tautology and dedup against facts already stated or
// entailed); and TRUST (every derived fact writes under a first-class
// `entailed:*` Source, prior 0.3, so it never outranks a stated fact and is
// retractable by provenance).
//
// Two further capabilities below are LIVE-CHASE ONLY, never part of the
// batch pass: cardinality monotonicity (`proveCardinalityAtLeast`) and
// max-cardinality-0 as encoded negation (`proveMaxCardinalityZeroDenial`).

import { loadMemory, appendFacts, readFactRows, normFactTerm, factIdForTriple, removeFacts } from "./memory/core.mjs";

/** scm-sco: the subClassOf-transitivity rule, and the provenance tag its
 *  conclusions carry. */
export const SUBCLASS_PREDICATE = "rdfs:subClassOf";
export const SYLLOGISE_RULE = "subClassOf";
export const ENTAILED_PROVENANCE = `entailed:${SYLLOGISE_RULE}`;

/** cax-sco: the type-propagation rule, and the provenance tag its conclusions
 *  carry. */
export const TYPE_PREDICATE = "rdf:type";
export const CAX_SCO_RULE = "type";
export const ENTAILED_TYPE_PROVENANCE = `entailed:${CAX_SCO_RULE}`;

/** cax-dw: x rdf:type C1, C1 owl:disjointWith C2 |= x is NOT of type C2 — a
 *  provable "no", never a guessed one. */
export const DISJOINT_PREDICATE = "owl:disjointWith";
export const CAX_DW_RULE = "disjointWith";
export const ENTAILED_DISJOINT_PROVENANCE = `entailed:${CAX_DW_RULE}`;
/** Rule-confidence < 1 so a premise-derived conclusion stays strictly below
 *  its weakest premise's trust, never a stated fact's equal. */
export const CAX_DW_RULE_CONFIDENCE = 0.95;

/** cls-svf1: x P y, y rdf:type C2, R owl:onProperty P, R owl:someValuesFrom
 *  C2 |= x rdf:type R (OWL 2 RL Table 8). `owl:onProperty`'s stored value and
 *  a taught property edge's predicate differ in casing (normFactTerm'd vs.
 *  raw vocabulary spelling), so the kernel below normalizes both before
 *  comparing. */
export const ON_PROPERTY_PREDICATE = "owl:onProperty";
export const SOME_VALUES_FROM_PREDICATE = "owl:someValuesFrom";
export const CLS_SVF1_RULE = "someValuesFrom";
export const ENTAILED_SVF1_PROVENANCE = `entailed:${CLS_SVF1_RULE}`;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE, same reason. */
export const CLS_SVF1_RULE_CONFIDENCE = 0.95;

const SEP = "␟"; // an in-key separator no fact term can contain
const isSubClassOf = (p) => String(p || "").trim().toLowerCase() === "rdfs:subclassof";
const isType = (p) => String(p || "").trim().toLowerCase() === "rdf:type";
const isDisjoint = (p) => String(p || "").trim().toLowerCase() === "owl:disjointwith";
const isOnProperty = (p) => String(p || "").trim().toLowerCase() === "owl:onproperty";
const isSomeValuesFrom = (p) => String(p || "").trim().toLowerCase() === "owl:somevaluesfrom";
const isOnClass = (p) => String(p || "").trim().toLowerCase() === "owl:onclass";
/** The four structural OWL predicates cls-svf1 itself consumes/emits, plus
 *  the two subClassOf/type/disjointWith predicates the other three rules
 *  own — excluded from `syllogise()`'s generic "property edge" scan so a
 *  restriction's own scaffolding triples are never mistaken for a taught
 *  object-property assertion (see `syllogise()`'s `propertyEdges` build). */
const RESERVED_PREDICATES = new Set([
  "rdfs:subclassof", "rdf:type", "owl:disjointwith", "owl:onproperty", "owl:somevaluesfrom", "owl:intersectionof",
]);

/** PURE `min(premiseTrusts) × ruleConfidence`, clamped to [0,1] — for a live,
 *  read-only chase with no Fact to hand to appendFacts/computeTrust. Returns
 *  `null` when no numeric premise trust was supplied. */
export function entailedTrustFrom(premiseTrusts, ruleConfidence = 1) {
  const nums = (Array.isArray(premiseTrusts) ? premiseTrusts : []).filter((t) => typeof t === "number");
  if (!nums.length) return null;
  const clamped = Math.max(0, Math.min(1, Math.min(...nums) * ruleConfidence));
  return Number(clamped.toFixed(6));
}

/** Normalize a focus hint (Set|array of terms) into the same normalized-term
 *  space stored facts live in, or null for "no focus → whole graph". */
function normalizeFocus(focus) {
  if (!focus) return null;
  const arr = focus instanceof Set ? [...focus] : Array.isArray(focus) ? focus : [];
  const out = new Set();
  for (const t of arr) {
    const n = normFactTerm(t);
    if (n) out.add(n);
  }
  return out.size ? out : null;
}

/**
 * PURE forward-chaining transitive closure of subClassOf over an edge list
 * `edges` ([[a,b], …], terms already normalized). Returns ONLY the NEW edges
 * (not already present), each `{ subject, object, via }`, bounded by `budget`
 * and `depth`, focus-filtered, tautology- and dedup-screened, in a deterministic
 * order. No I/O — this is the whole inference kernel, unit-testable in isolation.
 */
export function deriveSubClassClosure(edges, { depth = 32, budget = 50, focus = null } = {}) {
  const present = new Set();      // "a\0b" for every edge already known
  const succ = new Map();         // a -> Set(b): the live successor relation
  for (const [a, b] of edges || []) {
    if (!a || !b || a === b) continue; // a ⊑ a carries nothing
    present.add(`${a}${SEP}${b}`);
    if (!succ.has(a)) succ.set(a, new Set());
    succ.get(a).add(b);
  }
  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (a, b, c) => !focusSet || focusSet.has(a) || focusSet.has(b) || focusSet.has(c);

  const derived = [];
  const derivedKeys = new Set();
  for (let round = 0; round < depth; round += 1) {
    // Collect this round's candidates from a snapshot of the current relation,
    // then commit — a clean fixpoint step (no read-during-mutate).
    const additions = [];
    for (const [a, bs] of succ) {
      for (const b of bs) {
        const cs = succ.get(b);
        if (!cs) continue;
        for (const c of cs) {
          if (a === c) continue;                       // tautology screen (reflexive)
          const key = `${a}${SEP}${c}`;
          if (present.has(key) || derivedKeys.has(key)) continue; // dedup / novelty screen
          if (!inFocus(a, b, c)) continue;             // focus-connection screen
          additions.push([a, b, c, key]);
        }
      }
    }
    if (!additions.length) break; // fixpoint reached
    additions.sort((x, y) => x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]) || x[1].localeCompare(y[1]));
    let progressed = false;
    for (const [a, b, c, key] of additions) {
      if (derivedKeys.has(key)) continue; // an earlier addition this round covered it
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: a, object: c, via: b });
      if (!succ.has(a)) succ.set(a, new Set());
      succ.get(a).add(c);
      progressed = true;
    }
    if (derived.length >= budget || !progressed) break; // budget hit or nothing committed
  }
  return derived;
}

/**
 * Shared closure machinery: given `subClassEdges` ([[a,b], …], already-
 * normalized), returns a memoized `ancestorsOf(c)` that walks the FULL
 * ⊑-ancestor set of `c` (every superclass reachable, transitively — NOT
 * including `c` itself). One `succ` adjacency map + stack-walk built once per
 * call, cached per class so repeated queries against the same edge set never
 * re-walk. Factored out so every rule that needs "the whole taught ⊑-chain a
 * class sits in" (`deriveTypePropagation`'s cax-sco, `deriveDisjointViolations`'s
 * cax-dw ⊑-lift) shares ONE closure walk instead of three near-identical ones.
 * Pure, no I/O.
 */
function buildAncestorCloser(subClassEdges) {
  const succ = new Map(); // class -> Set(direct superclass): the subClassOf relation to close
  for (const [a, b] of subClassEdges || []) {
    if (!a || !b || a === b) continue;
    if (!succ.has(a)) succ.set(a, new Set());
    succ.get(a).add(b);
  }
  const ancestorsCache = new Map();
  return (c) => {
    if (ancestorsCache.has(c)) return ancestorsCache.get(c);
    const seen = new Set();
    const stack = [...(succ.get(c) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const next of succ.get(n) || []) if (!seen.has(next)) stack.push(next);
    }
    ancestorsCache.set(c, seen);
    return seen;
  };
}

/**
 * PURE cax-sco: rdf:type propagation across a subClassOf chain — (x rdf:type
 * C), (C ⊑ … ⊑ D) ⊨ (x rdf:type D). `subClassEdges` is a fixed input (unlike
 * `deriveSubClassClosure`'s own growing relation), so one ancestor walk per
 * class (`buildAncestorCloser`) covers the whole chain — no fixpoint rounds
 * needed. Returns ONLY new `{ subject, object, via }` conclusions, bounded by
 * `budget`, focus-filtered, tautology- and dedup-screened, deterministic order.
 */
export function deriveTypePropagation(typeEdges, subClassEdges, { budget = 50, focus = null } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  const present = new Set(); // "x\0C" for every rdf:type edge already known
  const seenTypeEdge = new Set(); // dedup repeated (x,C) input rows
  for (const [x, c] of typeEdges || []) if (x && c) present.add(`${x}${SEP}${c}`);
  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (x, c, d) => !focusSet || focusSet.has(x) || focusSet.has(c) || focusSet.has(d);

  const candidates = [];
  for (const [x, c] of typeEdges || []) {
    if (!x || !c) continue;
    const tk = `${x}${SEP}${c}`;
    if (seenTypeEdge.has(tk)) continue;
    seenTypeEdge.add(tk);
    for (const d of ancestorsOf(c)) {
      if (d === c || d === x) continue;              // tautology screen
      const key = `${x}${SEP}${d}`;
      if (present.has(key)) continue;                // dedup / novelty screen
      if (!inFocus(x, c, d)) continue;                // focus-connection screen
      candidates.push([x, c, d, key]);
    }
  }
  candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[2].localeCompare(q[2]) || p[1].localeCompare(q[1]));
  const derived = [];
  const derivedKeys = new Set();
  for (const [x, c, d, key] of candidates) {
    if (derivedKeys.has(key)) continue;
    if (derived.length >= budget) break;
    derivedKeys.add(key);
    derived.push({ subject: x, object: d, via: c });
  }
  return derived;
}

/**
 * PURE cax-dw: x rdf:type C1, C1 owl:disjointWith C2 |= x is NOT of type C2 —
 * a provable "no", never a guessed one; a pair this rule can't connect is
 * simply not returned. Includes the ⊑-lift: disjointness is checked over
 * `c`'s FULL ⊑-ancestor closure, not merely `x`'s direct stated type.
 * `disjointEdges` is the OWL-symmetric relation as taught (one directed row
 * covers both orderings). Returns ONLY new `{ subject, object, viaType,
 * viaClass }` conclusions, bounded by `budget`, focus-filtered, tautology-
 * and dedup-screened, deterministic order.
 */
export function deriveDisjointViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  // disjointWith is symmetric, so both directions of every pair are indexed.
  // A synthetic individual term never collides with a class-noun term here
  // (CODE_REF individuals always contain one of `. / \ # : @`), so class- and
  // instance-level pairs share one map safely.
  const disjointOf = new Map(); // term -> Set(disjoint partner terms)
  const presentPairs = new Set(); // "a\0b" for every disjointWith row already known (either order)
  for (const [a, b] of disjointEdges || []) {
    if (!a || !b || a === b) continue;
    presentPairs.add(`${a}${SEP}${b}`);
    presentPairs.add(`${b}${SEP}${a}`);
    if (!disjointOf.has(a)) disjointOf.set(a, new Set());
    disjointOf.get(a).add(b);
    if (!disjointOf.has(b)) disjointOf.set(b, new Set());
    disjointOf.get(b).add(a);
  }
  if (!disjointOf.size) return []; // nothing to violate - fast, honest exit

  const seenTypeEdge = new Set(); // dedup repeated (x,C) input rows
  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (x, c, e) => !focusSet || focusSet.has(x) || focusSet.has(c) || focusSet.has(e);

  const candidates = [];
  for (const [x, c] of typeEdges || []) {
    if (!x || !c) continue;
    const tk = `${x}${SEP}${c}`;
    if (seenTypeEdge.has(tk)) continue;
    seenTypeEdge.add(tk);
    // the ⊑-lift: x's own class closure is {c} ∪ ancestorsOf(c) - a direct
    // hit needs no lift (d === c), an inherited one needs one hop or more.
    for (const d of [c, ...ancestorsOf(c)]) {
      const partners = disjointOf.get(d);
      if (!partners) continue;
      for (const e of partners) {
        if (e === x) continue;                          // tautology screen (defensive)
        const key = `${x}${SEP}${e}`;
        if (presentPairs.has(key)) continue;             // dedup / novelty screen
        if (!inFocus(x, c, e)) continue;                 // focus-connection screen
        candidates.push([x, c, d, e, key]);
      }
    }
  }
  candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[3].localeCompare(q[3]) || p[2].localeCompare(q[2]) || p[1].localeCompare(q[1]));
  const derived = [];
  const derivedKeys = new Set();
  for (const [x, c, d, e, key] of candidates) {
    if (derivedKeys.has(key)) continue;
    if (derived.length >= budget) break;
    derivedKeys.add(key);
    derived.push({ subject: x, object: e, viaType: c, viaClass: d });
  }
  return derived;
}

/**
 * PURE cls-svf1: x P y, y rdf:type C2, R owl:onProperty P, R
 * owl:someValuesFrom C2 |= x rdf:type R (OWL 2 RL Table 8). `propertyEdges`
 * is every taught/prior-entailed object-property assertion (raw predicate
 * spelling); `restrictionEdges` is each restriction node's (property, target)
 * declaration. `y`'s type is lifted through its full ⊑-ancestor closure, so
 * "y is a mock" still satisfies a restriction declared over "fixture" when
 * mock⊑fixture is taught. Returns ONLY new `{ subject, object, viaProperty,
 * viaPropertyKey, viaValue, viaType, viaTarget }` conclusions (`object` is
 * the restriction node R), bounded by `budget`, focus-filtered, tautology-
 * and dedup-screened, deterministic order.
 */
export function deriveSomeValuesFromApplication(propertyEdges, typeEdges, subClassEdges, restrictionEdges, { budget = 50, focus = null } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  // restriction index: "propertyKey\0targetClass" -> Set(restriction node) —
  // a restriction is looked up by the (property, target-class) pair its OWN
  // owl:onProperty/owl:someValuesFrom rows declare; more than one restriction
  // MAY declare the same pair (two differently-named restriction nodes over
  // the same property/class), so this is a Set, not a single value.
  const byPropTarget = new Map();
  for (const r of restrictionEdges || []) {
    if (!r || !r.restriction || !r.property || !r.target) continue;
    const key = `${r.property}${SEP}${r.target}`;
    if (!byPropTarget.has(key)) byPropTarget.set(key, new Set());
    byPropTarget.get(key).add(r.restriction);
  }
  if (!byPropTarget.size) return []; // no restriction declared at all - fast, honest exit

  const present = new Set();      // "x\0R" for every rdf:type edge already known
  const typesOf = new Map();      // y -> Set(direct taught types)
  for (const [x, c] of typeEdges || []) {
    if (!x || !c) continue;
    present.add(`${x}${SEP}${c}`);
    if (!typesOf.has(x)) typesOf.set(x, new Set());
    typesOf.get(x).add(c);
  }

  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (x, y, r) => !focusSet || focusSet.has(x) || focusSet.has(y) || focusSet.has(r);

  const seenEdge = new Set(); // dedup repeated (x,predicate,y) input rows
  const candidates = [];
  for (const [x, p, y] of propertyEdges || []) {
    if (!x || !p || !y) continue;
    const pKey = normFactTerm(p);
    const ek = `${x}${SEP}${pKey}${SEP}${y}`;
    if (seenEdge.has(ek)) continue;
    seenEdge.add(ek);
    const yTypes = typesOf.get(y);
    if (!yTypes) continue;
    for (const c of yTypes) {
      // the ⊑-lift: y's own class closure is {c} ∪ ancestorsOf(c) - a direct
      // hit needs no lift (target === c), the fixture/mock-shaped case needs
      // one hop or more (mirrors deriveDisjointViolations' own ⊑-lift).
      for (const target of [c, ...ancestorsOf(c)]) {
        const restrictions = byPropTarget.get(`${pKey}${SEP}${target}`);
        if (!restrictions) continue;
        for (const r of restrictions) {
          if (x === r) continue;                          // tautology screen (defensive)
          const key = `${x}${SEP}${r}`;
          if (present.has(key)) continue;                 // dedup / novelty screen
          if (!inFocus(x, y, r)) continue;                 // focus-connection screen
          candidates.push([x, p, pKey, y, c, target, r, key]);
        }
      }
    }
  }
  candidates.sort((a, b) => a[0].localeCompare(b[0]) || a[6].localeCompare(b[6]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]));
  const derived = [];
  const derivedKeys = new Set();
  for (const [x, p, pKey, y, c, target, r, key] of candidates) {
    if (derivedKeys.has(key)) continue;
    if (derived.length >= budget) break;
    derivedKeys.add(key);
    derived.push({ subject: x, object: r, viaProperty: p, viaPropertyKey: pKey, viaValue: y, viaType: c, viaTarget: target });
  }
  return derived;
}

// ---- shared cardinality-restriction reconstruction (pattern-5, parseCardinality) ----
// "every N1 has exactly n N2s" stores `{N1, rdfs:subClassOf, r}` plus the
// restriction node r's own scaffolding rows (owl:onProperty/cardinality
// kind/owl:onClass) — reconstructed here the same way
// deriveSomeValuesFromApplication reconstructs someValuesFrom restrictions.
const HAS_PROPERTY_KEY = "has"; // synthetic marker parseCardinality always mints, never a real taught verb
const CARDINALITY_KIND_OF = { "owl:cardinality": "exactly", "owl:mincardinality": "min", "owl:maxcardinality": "max" };
export const ON_CLASS_PREDICATE = "owl:onClass";

/** Reconstructs pattern-5 cardinality restriction records from raw stored
 *  rows touching a restriction node. A restriction is only admitted when its
 *  own `owl:onProperty` row resolves to `HAS_PROPERTY_KEY` — keeps a
 *  someValuesFrom restriction's scaffolding (which also uses `owl:onProperty`,
 *  with a real verb) from being mistaken for a cardinality restriction.
 *  Returns `[{ restriction, kind, n, onClass }, …]`, sorted by restriction id. */
export function buildCardinalityRestrictions(rows) {
  const onPropertyOf = new Map(); // restriction -> owl:onProperty's object
  const kindOf = new Map();       // restriction -> { kind, n }
  const onClassOf = new Map();    // restriction -> owl:onClass's object
  for (const r of rows || []) {
    if (!r || !r.subject || !r.predicate) continue;
    if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
    else if (isOnClass(r.predicate)) onClassOf.set(r.subject, r.object);
    else {
      const kind = CARDINALITY_KIND_OF[String(r.predicate).trim().toLowerCase()];
      if (!kind) continue;
      const n = Number(r.object);
      if (Number.isFinite(n)) kindOf.set(r.subject, { kind, n });
    }
  }
  const restrictions = [];
  for (const [restriction, { kind, n }] of kindOf) {
    if (onPropertyOf.get(restriction) !== HAS_PROPERTY_KEY) continue; // not a cardinality restriction's own onProperty row — skip (the defensive belt, see doc comment)
    const onClass = onClassOf.get(restriction);
    if (!onClass) continue;
    restrictions.push({ restriction, kind, n, onClass });
  }
  restrictions.sort((a, b) => a.restriction.localeCompare(b.restriction));
  return restrictions;
}

// ---- scm-svf1: someValuesFrom restriction subsumption (W3C OWL 2 RL Table 9) ----
export const SCM_SVF_RULE = "someValuesFromSubsumption";
export const ENTAILED_SCM_SVF_PROVENANCE = `entailed:${SCM_SVF_RULE}`;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE, same reason. */
export const SCM_SVF_RULE_CONFIDENCE = 0.95;

/**
 * PURE scm-svf1: c1 someValuesFrom y1, c1 onProperty p, c2 someValuesFrom y2,
 * c2 onProperty p, y1 ⊑ y2 (lifted through y1's full ⊑-ancestor closure) |=
 * c1 ⊑ c2 — a schema-level fact about the restriction NODES themselves,
 * requiring two independently-declared restrictions over the SAME property
 * to compare. Returns ONLY new `{ subject, object, viaY1, viaY2 }`
 * conclusions (the two restriction node ids, and the filler classes whose
 * ⊑-relation licensed it), bounded by `budget`, focus-filtered, tautology-
 * and dedup-screened, deterministic order.
 */
export function deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { budget = 50, focus = null } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  const byProperty = new Map(); // normalized property -> [{ restriction, target }]
  for (const r of restrictionEdges || []) {
    if (!r || !r.restriction || !r.property || !r.target) continue;
    const pKey = normFactTerm(r.property);
    if (!byProperty.has(pKey)) byProperty.set(pKey, []);
    byProperty.get(pKey).push({ restriction: r.restriction, target: r.target });
  }

  const present = new Set(); // "c1\0c2" for a subClassOf edge already known between two restriction nodes (dedup/novelty screen, same discipline as every other rule here)
  for (const [a, b] of subClassEdges || []) if (a && b) present.add(`${a}${SEP}${b}`);

  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (c1, c2) => !focusSet || focusSet.has(c1) || focusSet.has(c2);

  const candidates = [];
  for (const [, group] of byProperty) {
    if (group.length < 2) continue; // need TWO independently-declared restrictions to compare
    for (const r1 of group) {
      for (const r2 of group) {
        if (r1.restriction === r2.restriction) continue;    // tautology screen
        if (r1.target === r2.target) continue;              // same filler, same node by construction — no new fact
        if (!ancestorsOf(r1.target).has(r2.target)) continue; // y1 must be ⊑ y2 (the FULL ⊑-lift)
        const key = `${r1.restriction}${SEP}${r2.restriction}`;
        if (present.has(key)) continue;                      // dedup / novelty screen
        if (!inFocus(r1.restriction, r2.restriction)) continue; // focus-connection screen
        candidates.push([r1.restriction, r2.restriction, r1.target, r2.target, key]);
      }
    }
  }
  candidates.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const derived = [];
  const derivedKeys = new Set();
  for (const [c1, c2, y1, y2, key] of candidates) {
    if (derivedKeys.has(key)) continue;
    if (derived.length >= budget) break;
    derivedKeys.add(key);
    derived.push({ subject: c1, object: c2, viaY1: y1, viaY2: y2 });
  }
  return derived;
}

// ---- shared machinery for cardinality monotonicity / cax-maxc0: both are
// single-premise-sufficient — a class's OWN declared cardinality restriction,
// walked through its FULL ⊑-ancestor closure. ----

/** Shared bounded proof search: walks `subject`'s own ⊑-ancestor closure
 *  looking for a class with a directly declared cardinality restriction
 *  satisfying `matches(record)`. Returns the first `{ viaClass,
 *  viaRestriction, record }` found (deterministic) or null. `budget` bounds
 *  how many candidate classes are examined. */
function findOwnCardinalityRestriction(subClassEdges, cardinalityRestrictionEdges, subject, matches, { budget = 20, focus = null } = {}) {
  if (!subject) return null;
  const ancestorsOf = buildAncestorCloser(subClassEdges);
  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (c) => !focusSet || focusSet.has(subject) || focusSet.has(c);
  const classToRestrictions = new Map(); // class -> Set(restriction ids DIRECTLY declared class ⊑ restriction)
  for (const [a, b] of subClassEdges || []) {
    if (!a || !b) continue;
    if (!classToRestrictions.has(a)) classToRestrictions.set(a, new Set());
    classToRestrictions.get(a).add(b);
  }
  const restrictionsByRid = new Map((cardinalityRestrictionEdges || []).map((r) => [r.restriction, r]));
  let checked = 0;
  for (const c of [subject, ...ancestorsOf(subject)]) {
    if (checked >= budget) break;
    checked += 1;
    if (!inFocus(c)) continue;
    for (const rid of classToRestrictions.get(c) || []) {
      const rec = restrictionsByRid.get(rid);
      if (rec && matches(rec)) return { viaClass: c, viaRestriction: rid, record: rec };
    }
  }
  return null;
}

// ---- cardinality monotonicity (outside OWL 2 RL's own decidable profile) ----
export const SCM_CARD_RULE = "cardinalityMonotonicity";
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE. No `syllogise()` call site
 *  (this rule is query-rooted, never an enumerable Fact) — defined anyway so
 *  chat.mjs's live proof chase can attach an auditable confidence figure
 *  (`entailedTrustFrom`, below) to its own answer. */
export const CARDINALITY_RULE_CONFIDENCE = 0.95;

/**
 * PURE: given one class `subject`'s OWN declared cardinality restriction
 * (kind ∈ {exactly,min}, n, onClass — lifted through its full ⊑-ancestor
 * closure) and a QUERIED (`onClass`, `m`), proves "`subject` has at least `m`
 * `onClass`" whenever `onClass` matches and `n ≥ m`. Query-rooted, not a
 * batch derivation — `m` is query-specific.
 *
 * Returns the witnessing `{ subject, object: onClass, m, n, kind, viaClass,
 * viaRestriction }` or null.
 */
export function proveCardinalityAtLeast(subClassEdges, cardinalityRestrictionEdges, subject, onClass, m, opts = {}) {
  if (!onClass || !Number.isFinite(m)) return null;
  const found = findOwnCardinalityRestriction(
    subClassEdges, cardinalityRestrictionEdges, subject,
    (rec) => rec.onClass === onClass && (rec.kind === "exactly" || rec.kind === "min") && rec.n >= m,
    opts,
  );
  return found ? { subject, object: onClass, m, n: found.record.n, kind: found.record.kind, viaClass: found.viaClass, viaRestriction: found.viaRestriction } : null;
}

// ---- cax-maxc0: max-cardinality-0 as encoded negation (grounded in the real
// W3C OWL 2 RL `cls-maxc1` ABox contradiction rule via a one-step universal
// generalization — see this file's header comment; `cax-` prefix per this
// ladder's "produces a provable no" naming convention, same epistemic status
// as cax-dw) ----
export const CAX_MAXC0_RULE = "maxCardinalityZero";
/** Same sub-1 discount and query-rooted caveat as CARDINALITY_RULE_CONFIDENCE. */
export const CAX_MAXC0_RULE_CONFIDENCE = 0.95;

/**
 * PURE: `subject` ⊑ r (lifted through its full ⊑-ancestor closure), r a
 * maxCardinality-0 restriction (property `has`, onClass `onClass`) |= "no
 * `subject` has a `onClass`" — a universal-generalization bridge from
 * `cls-maxc1`'s per-individual ABox contradiction to a class-level provable
 * negative: since no witness can exist without contradiction, the general
 * "no" is sound. Never infers "no" from absence — no declared restriction
 * simply returns null.
 *
 * Returns `{ subject, object: onClass, viaClass, viaRestriction }` or null.
 */
export function proveMaxCardinalityZeroDenial(subClassEdges, cardinalityRestrictionEdges, subject, onClass, opts = {}) {
  if (!onClass) return null;
  const found = findOwnCardinalityRestriction(
    subClassEdges, cardinalityRestrictionEdges, subject,
    (rec) => rec.onClass === onClass && rec.kind === "max" && rec.n === 0,
    opts,
  );
  return found ? { subject, object: onClass, viaClass: found.viaClass, viaRestriction: found.viaRestriction } : null;
}

/**
 * PURE consistency checker: detects when a SINGLE subject's own already-
 * asserted types contradict each other — x rdf:type C1, x rdf:type C2, C1
 * owl:disjointWith C2 (checked over both types' full ⊑-ancestor closures) —
 * a refuse-worthy clash, not a "no" to derive and move on from: unlike cax-dw
 * (deriving a no for an unasserted type), every stored belief about a
 * contradictory subject is suspect, so the caller should refuse to answer
 * from that subject's memory at all.
 *
 * Returns ONLY the clashes found — `{ subject, classA, classB, viaA, viaB }`
 * — bounded by `budget`, focus-filtered, deduped so a subject with N
 * mutually-clashing types reports each unordered pair once.
 */
export function findConsistencyViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  const disjointOf = new Map(); // term -> Set(disjoint partner terms) — symmetric, same as deriveDisjointViolations
  for (const [a, b] of disjointEdges || []) {
    if (!a || !b || a === b) continue;
    if (!disjointOf.has(a)) disjointOf.set(a, new Set());
    disjointOf.get(a).add(b);
    if (!disjointOf.has(b)) disjointOf.set(b, new Set());
    disjointOf.get(b).add(a);
  }
  if (!disjointOf.size) return []; // nothing can clash — fast, honest exit

  const typesBySubject = new Map(); // x -> Set(directly-taught/entailed types)
  for (const [x, c] of typeEdges || []) {
    if (!x || !c) continue;
    if (!typesBySubject.has(x)) typesBySubject.set(x, new Set());
    typesBySubject.get(x).add(c);
  }

  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (x) => !focusSet || focusSet.has(x);

  const candidates = [];
  const seenPair = new Set(); // "x\0classA\0classB" (classA<classB lexically) — dedup per subject+pair
  for (const [x, types] of typesBySubject) {
    if (!inFocus(x)) continue;
    const typeList = [...types].sort();
    for (let i = 0; i < typeList.length; i += 1) {
      for (let j = i + 1; j < typeList.length; j += 1) {
        const [ta, tb] = [typeList[i], typeList[j]];
        // check ta's closure against tb's closure for ANY disjoint-linked pair
        const closureA = [ta, ...ancestorsOf(ta)];
        const closureB = [tb, ...ancestorsOf(tb)];
        let hit = null;
        for (const da of closureA) {
          const partners = disjointOf.get(da);
          if (!partners) continue;
          for (const db of closureB) {
            if (partners.has(db)) { hit = [da, db]; break; }
          }
          if (hit) break;
        }
        if (!hit) continue;
        const pairKey = `${x}${SEP}${ta}${SEP}${tb}`;
        if (seenPair.has(pairKey)) continue;
        seenPair.add(pairKey);
        candidates.push([x, ta, tb, hit[0], hit[1]]);
      }
    }
  }
  candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[1].localeCompare(q[1]) || p[2].localeCompare(q[2]));
  const derived = [];
  for (const [x, ta, tb, viaA, viaB] of candidates) {
    if (derived.length >= budget) break;
    derived.push({ subject: x, classA: ta, classB: tb, viaA, viaB });
  }
  return derived;
}

/**
 * Run one bounded speculative pass over the memory graph under `repoDir`.
 * Forward-chains the five rules in order — scm-sco, cax-sco, cax-dw,
 * cls-svf1, scm-svf1 — each seeing the prior rules' conclusions from this
 * same pass, and materializes each new conclusion via `appendFacts` with its
 * `entailed:*` provenance. Trust rides the entailed hook
 * (`min(premiseTrusts) x ruleConfidence`) when premises are resolvable in the
 * pre-pass snapshot, else falls back to the bare entailed prior.
 *
 * opts: `depth` (max fixpoint rounds, default 32), `budget` (max new
 * derivations this pass, shared across all five rules, default 50), `focus`
 * (Set|array of class terms scoping derivations to what touches it — omit
 * for a whole-graph pass).
 *
 * Returns { derived: [{ id, subject, object, via, rule }], count, budget,
 * depth, truncated }.
 */
export async function syllogise(repoDir, { depth = 32, budget = 50, focus = null } = {}) {
  const memory = await loadMemory(repoDir);
  const rows = readFactRows(memory);
  const subClassEdges = rows.filter((r) => isSubClassOf(r.predicate)).map((r) => [r.subject, r.object]);
  const typeEdges = rows.filter((r) => isType(r.predicate)).map((r) => [r.subject, r.object]);
  const disjointEdges = rows.filter((r) => isDisjoint(r.predicate)).map((r) => [r.subject, r.object]);
  // cls-svf1's join inputs: a restriction's onProperty/someValuesFrom rows,
  // keyed by the restriction's own subject; propertyEdges is every other
  // stored fact, a candidate premise for whichever restriction was declared
  // over its predicate.
  const onPropertyOf = new Map();      // restriction -> owl:onProperty's (normalized) object
  const someValuesFromOf = new Map();  // restriction -> owl:someValuesFrom's (normalized) object
  const propertyEdges = [];            // [[x, rawPredicate, y], …]
  for (const r of rows) {
    const pLower = String(r.predicate || "").trim().toLowerCase();
    if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
    else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
    else if (!RESERVED_PREDICATES.has(pLower)) propertyEdges.push([r.subject, r.predicate, r.object]);
  }
  const restrictionEdges = [];
  for (const [restriction, property] of onPropertyOf) {
    const target = someValuesFromOf.get(restriction);
    if (target) restrictionEdges.push({ restriction, property, target });
  }
  const normalizedFocus = normalizeFocus(focus);

  // Pre-pass trust snapshot for the entailed hook's premiseTrusts lookup,
  // wired for cax-dw/cls-svf1/scm-svf1 only: with ruleConfidence defaulting
  // to 1, min(premiseTrusts) x 1 can EQUAL a stated premise's trust (e.g. two
  // 1.0 premises), tying or outranking the very premise it derived from —
  // scm-sco/cax-sco stay on the bare entailed prior until they get the same
  // sub-1 discount cax-dw uses below.
  const trustByTriple = new Map();
  for (const r of rows) trustByTriple.set(`${r.subject}${SEP}${r.predicate}${SEP}${r.object}`, r.trust);
  const premiseTrust = (s, p, o) => trustByTriple.get(`${s}${SEP}${p}${SEP}${o}`);
  const numericOnly = (arr) => arr.filter((t) => typeof t === "number");

  const scmDerived = deriveSubClassClosure(subClassEdges, { depth, budget, focus: normalizedFocus });
  // cax-sco sees the ENLARGED subClassOf edge set (stated ∪ this pass's own
  // scm-sco conclusions) so both rules complete in one `tmct syllogise` call.
  const enlargedSubClassEdges = subClassEdges.concat(scmDerived.map((d) => [d.subject, d.object]));
  const remainingBudget = Math.max(0, budget - scmDerived.length);
  const caxDerived = remainingBudget > 0
    ? deriveTypePropagation(typeEdges, enlargedSubClassEdges, { budget: remainingBudget, focus: normalizedFocus })
    : [];
  // cax-dw sees the SAME enlarged subClassOf set (so its own ⊑-lift reaches a
  // chain scm-sco just grew this pass) — it doesn't need the enlarged TYPE
  // edge set too, since it walks each direct type's own ⊑-ancestor closure.
  const remainingBudgetDw = Math.max(0, budget - scmDerived.length - caxDerived.length);
  const dwDerived = remainingBudgetDw > 0
    ? deriveDisjointViolations(typeEdges, enlargedSubClassEdges, disjointEdges, { budget: remainingBudgetDw, focus: normalizedFocus })
    : [];
  // cls-svf1 sees the SAME enlarged subClassOf set (its own ⊑-lift) but NOT
  // the enlarged type edge set, so a same-pass cax-sco conclusion on `y`
  // can't be consumed before a human can audit it.
  const remainingBudgetSvf1 = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length);
  const svf1Derived = remainingBudgetSvf1 > 0 && restrictionEdges.length
    ? deriveSomeValuesFromApplication(propertyEdges, typeEdges, enlargedSubClassEdges, restrictionEdges, { budget: remainingBudgetSvf1, focus: normalizedFocus })
    : [];
  // scm-svf1 reuses the SAME restrictionEdges built for cls-svf1 above —
  // needs at least two restrictions over one property to compare.
  const remainingBudgetScmSvf = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length - svf1Derived.length);
  const scmSvfDerived = remainingBudgetScmSvf > 0 && restrictionEdges.length > 1
    ? deriveSomeValuesFromSubsumption(restrictionEdges, enlargedSubClassEdges, { budget: remainingBudgetScmSvf, focus: normalizedFocus })
    : [];
  const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));

  // Batched write: ONE mutateMemory pass for all five rules' conclusions via
  // appendFacts, not one appendFact per derived fact.
  const toWrite = [
    ...scmDerived.map((d) => ({
      subject: d.subject, predicate: SUBCLASS_PREDICATE, object: d.object,
      provenance: ENTAILED_PROVENANCE,
      // Persisted justification, scm-sco only: the two premise fact ids this
      // conclusion rode (a⊑b, b⊑c) — content-addressed ids work even when a
      // premise is itself an entailment this same pass just derived. Read
      // back by retractSubClassOf (below) to find every entailment a
      // retracted premise could have supported.
      justification: [
        factIdForTriple(d.subject, SUBCLASS_PREDICATE, d.via),
        factIdForTriple(d.via, SUBCLASS_PREDICATE, d.object),
      ],
    })),
    ...caxDerived.map((d) => ({
      subject: d.subject, predicate: TYPE_PREDICATE, object: d.object,
      provenance: ENTAILED_TYPE_PROVENANCE,
    })),
    ...dwDerived.map((d) => {
      // disjointWith is symmetric, taught as ONE direction — the premise row
      // could be stored either (viaClass, disjointWith, object) or its mirror.
      const dwTrust = premiseTrust(d.viaClass, DISJOINT_PREDICATE, d.object)
        ?? premiseTrust(d.object, DISJOINT_PREDICATE, d.viaClass);
      const premiseTrusts = numericOnly([
        premiseTrust(d.subject, TYPE_PREDICATE, d.viaType),
        dwTrust,
        // the ⊑-lift premise only exists when this IS a lift (viaClass !==
        // viaType) — a direct hit has no extra subClassOf premise to price in.
        ...(d.viaClass !== d.viaType ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaClass)] : []),
      ]);
      return {
        subject: d.subject, predicate: DISJOINT_PREDICATE, object: d.object,
        provenance: ENTAILED_DISJOINT_PROVENANCE,
        ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: CAX_DW_RULE_CONFIDENCE } : {}),
      };
    }),
    ...svf1Derived.map((d) => {
      const premiseTrusts = numericOnly([
        premiseTrust(d.subject, d.viaProperty, d.viaValue),
        premiseTrust(d.viaValue, TYPE_PREDICATE, d.viaType),
        premiseTrust(d.object, ON_PROPERTY_PREDICATE, d.viaPropertyKey),
        premiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaTarget),
        // the ⊑-lift premise only exists when this IS a lift (viaType !==
        // viaTarget) — a direct hit has no extra subClassOf premise to price in.
        ...(d.viaType !== d.viaTarget ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaTarget)] : []),
      ]);
      return {
        subject: d.subject, predicate: TYPE_PREDICATE, object: d.object,
        provenance: ENTAILED_SVF1_PROVENANCE,
        // same sub-1 discount as cax-dw, same reason (see CAX_DW_RULE_CONFIDENCE).
        ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: CLS_SVF1_RULE_CONFIDENCE } : {}),
      };
    }),
    ...scmSvfDerived.map((d) => {
      const r1 = restrictionByRid.get(d.subject);
      const r2 = restrictionByRid.get(d.object);
      const premiseTrusts = numericOnly([
        r1 && premiseTrust(d.subject, ON_PROPERTY_PREDICATE, r1.property),
        premiseTrust(d.subject, SOME_VALUES_FROM_PREDICATE, d.viaY1),
        r2 && premiseTrust(d.object, ON_PROPERTY_PREDICATE, r2.property),
        premiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaY2),
        premiseTrust(d.viaY1, SUBCLASS_PREDICATE, d.viaY2),
      ]);
      return {
        subject: d.subject, predicate: SUBCLASS_PREDICATE, object: d.object,
        provenance: ENTAILED_SCM_SVF_PROVENANCE,
        // same sub-1 discount as cax-dw/cls-svf1, same reason (see CAX_DW_RULE_CONFIDENCE).
        ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: SCM_SVF_RULE_CONFIDENCE } : {}),
      };
    }),
  ];
  const { ids } = await appendFacts(repoDir, toWrite);
  const written = [];
  let i = 0;
  for (const d of scmDerived) {
    written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.via, rule: SYLLOGISE_RULE });
    i += 1;
  }
  for (const d of caxDerived) {
    written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.via, rule: CAX_SCO_RULE });
    i += 1;
  }
  for (const d of dwDerived) {
    written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaClass, rule: CAX_DW_RULE });
    i += 1;
  }
  for (const d of svf1Derived) {
    written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaValue, rule: CLS_SVF1_RULE });
    i += 1;
  }
  for (const d of scmSvfDerived) {
    written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaY1, rule: SCM_SVF_RULE });
    i += 1;
  }
  return { derived: written, count: written.length, budget, depth, truncated: written.length >= budget };
}

/** True when EVERY provenance tag on a fact's (possibly " | "-joined) union is
 *  an `entailed:*` tag — i.e. the fact has never been independently stated or
 *  taught, only ever derived. A fact first entailed, then LATER also directly
 *  taught (same (s,p,o) → same id → provenance union, appendFact's own upsert
 *  contract), is NOT purely entailed any more — `retractSubClassOf`'s cascade
 *  must never delete it just because its now-stale justification broke; the
 *  taught half is a real, independent reason to keep believing it (must never
 *  touch a higher-trust taught-only derivation). */
function isPurelyEntailed(provenance) {
  const tags = String(provenance || "").split(" | ").filter(Boolean);
  return tags.length > 0 && tags.every((t) => t.startsWith("entailed:"));
}

/**
 * A scoped retraction slice: JTMS-style dependency-directed removal, for
 * scm-sco ONLY. Retracting `subject ⊑ object` removes the fact, then cascades
 * to any purely-entailed scm-sco fact whose persisted justification cites a
 * removed id — but each candidate is VERIFIED (re-derivable over the
 * surviving subClassOf edge set, not just "cited a removed id") before it is
 * actually removed, since a fact can have a second, independent derivation
 * path (a⊑b⊑d AND a⊑c⊑d both license a⊑d) that a bare delete-by-justification
 * walk would wrongly discard. Repeats in rounds — a removed mid-chain link
 * can ripple — bounded by `budget` (max facts examined+removed) and `depth`
 * (max cascade rounds).
 *
 * Scope limit: only scm-sco persists a justification today, so a
 * type/disjointWith/someValuesFrom conclusion that also went stale is not
 * cascaded here (mechanical to extend, not attempted in this slice).
 *
 * Returns { retracted, count, budget, depth, truncated, found } — `found` is
 * false when `subject ⊑ object` was never a stored fact.
 */
export async function retractSubClassOf(repoDir, subject, object, { budget = 50, depth = 32 } = {}) {
  const s = normFactTerm(subject);
  const o = normFactTerm(object);
  const targetId = factIdForTriple(s, SUBCLASS_PREDICATE, o);
  const memory = await loadMemory(repoDir);
  const rows = readFactRows(memory);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(targetId)) return { retracted: [], count: 0, budget, depth, truncated: false, found: false };

  // The FULL current subClassOf edge set (stated + every prior entailment) —
  // the working graph this function's VERIFY step walks each round; a
  // removed id's own edge is excluded from that round's walk onward.
  const scRows = rows.filter((r) => isSubClassOf(r.predicate));
  const edgeOf = new Map(scRows.map((r) => [r.id, [r.subject, r.object]]));
  // Only a purely-entailed scm-sco fact ever carries a walkable justification.
  const entailedScRows = scRows.filter((r) => r.justification.length && isPurelyEntailed(r.provenance));

  const removed = new Set([targetId]);
  const order = [targetId]; // deterministic report order: target first, then removal order
  let truncated = false;
  let round = 0;
  for (; round < depth; round += 1) {
    const candidates = entailedScRows
      .filter((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j)))
      .sort((a, b) => a.subject.localeCompare(b.subject) || a.object.localeCompare(b.object));
    if (!candidates.length) break; // fixpoint — nothing left to (re-)check

    // The surviving edge set for THIS round's verify walk excludes every
    // candidate's own edge too, not just `removed` — otherwise a candidate
    // could trivially "reach itself" through its own not-yet-deleted edge, or
    // lean on a sibling candidate standing on the same broken premise.
    const candidateIds = new Set(candidates.map((c) => c.id));
    const survivingEdges = [...edgeOf.entries()]
      .filter(([id]) => !removed.has(id) && !candidateIds.has(id))
      .map(([, e]) => e);
    const ancestorsOf = buildAncestorCloser(survivingEdges);

    let progressed = false;
    let hitBudget = false;
    for (const c of candidates) {
      if (removed.size >= budget) { hitBudget = true; break; }
      // does subject⊑object still hold WITHOUT the retracted premise, via ANY
      // surviving path (not just the one this fact was originally derived
      // through)? A survivor keeps its (now possibly re-groundable, still
      // TRUE) fact and is never re-examined again this call.
      if (ancestorsOf(c.subject).has(c.object)) continue; // a second, independent path still supports it — keep
      removed.add(c.id);
      order.push(c.id);
      progressed = true;
    }
    if (hitBudget) { truncated = true; break; }
    if (!progressed) break; // every candidate this round survived verification — fixpoint
  }
  if (!truncated && round >= depth) {
    // depth exhausted, not a natural fixpoint — honestly flag it if a
    // pending candidate would still have been checked next round.
    truncated = entailedScRows.some((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j)));
  }

  const { removed: actuallyRemoved } = await removeFacts(repoDir, order);
  return { retracted: actuallyRemoved, count: actuallyRemoved.length, budget, depth, truncated, found: true };
}

/**
 * PROOF SEARCH (not a third rule — a bounded rooted chase for a single "does
 * `subj` reach one of `targets`?" query). Walks OUTWARD from `subj` only,
 * breadth-first, stopping the instant a target is reached — cost is bounded
 * by `subj`'s own reachable set and `maxHops`, not by the whole graph, unlike
 * `deriveSubClassClosure`/`deriveTypePropagation`'s whole-graph closures.
 *
 * The first hop may be a taught type edge (cax-sco) or subClassOf edge
 * (scm-sco); every hop after is subClassOf-only. Returns the shortest chain
 * as an ordered `[{ subject, predicate, object }, …]` premise list, or null
 * when no chain reaches `targets` within `maxHops`.
 */
export function findIsaChain(subj, targets, typeEdges, subClassEdges, { maxHops = 6 } = {}) {
  const targetSet = targets instanceof Set ? targets : new Set(targets || []);
  const subSucc = new Map();
  for (const [a, b] of subClassEdges || []) {
    if (!a || !b || a === b) continue;
    if (!subSucc.has(a)) subSucc.set(a, new Set());
    subSucc.get(a).add(b);
  }

  let frontier = [];
  for (const [x, c] of typeEdges || []) {
    if (x === subj && c) frontier.push({ node: c, path: [{ subject: x, predicate: TYPE_PREDICATE, object: c }] });
  }
  for (const c of subSucc.get(subj) || []) {
    frontier.push({ node: c, path: [{ subject: subj, predicate: SUBCLASS_PREDICATE, object: c }] });
  }

  // hop counts the LENGTH of the paths currently in `frontier` (1 at the
  // first check). Check-then-extend, and never extend past maxHops — the
  // frontier is checked AT every length up to and including maxHops, never
  // one hop beyond it.
  const seen = new Set([subj]);
  for (let hop = 1; hop <= maxHops && frontier.length; hop += 1) {
    for (const { node, path } of frontier) if (targetSet.has(node)) return path;
    if (hop === maxHops) break; // budget exhausted — do not extend further
    const next = [];
    for (const { node, path } of frontier) {
      if (seen.has(node)) continue;
      seen.add(node);
      for (const c of subSucc.get(node) || []) {
        if (seen.has(c)) continue;
        next.push({ node: c, path: [...path, { subject: node, predicate: SUBCLASS_PREDICATE, object: c }] });
      }
    }
    frontier = next;
  }
  return null;
}
