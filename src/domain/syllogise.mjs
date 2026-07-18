// syllogise.mjs — tmct's speculative-inference engine, growing toward
// tier-5 "the Syllogist". Offline, deterministic: forward-chains entailments
// over the OWL-labelled memory graph so a future query-time MISS becomes a
// lookup. `syllogise()` (the materialising pass) only runs as the explicit
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

import { normFactTerm, factIdForTriple } from "./hash.mjs";

/** The two persisting entry points (syllogise, retractSubClassOf) take the
 *  memory store's read/write functions through a required `store` option —
 *  this module never imports the store. A missing function is a loud
 *  construction error, never a silent no-op pass. */
function requireStore(store, needed, caller) {
  for (const name of needed) {
    if (typeof store?.[name] !== "function") {
      throw new TypeError(`${caller} needs a store option carrying { ${needed.join(", ")} } (memory/core.mjs's read/write functions) — missing ${name}`);
    }
  }
  return store;
}

/** scm-sco: the subClassOf-transitivity rule, and the provenance tag its
 *  conclusions carry. */
export const SUBCLASS_PREDICATE = "rdfs:subClassOf";
const SYLLOGISE_RULE = "subClassOf";
export const ENTAILED_PROVENANCE = `entailed:${SYLLOGISE_RULE}`;

/** cax-sco: the type-propagation rule, and the provenance tag its conclusions
 *  carry. */
export const TYPE_PREDICATE = "rdf:type";
const CAX_SCO_RULE = "type";
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
 *  C2 |= x rdf:type R (OWL 2 RL Table 6). `owl:onProperty`'s stored value and
 *  a taught property edge's predicate differ in casing (normFactTerm'd vs.
 *  raw vocabulary spelling), so the kernel below normalizes both before
 *  comparing. */
export const ON_PROPERTY_PREDICATE = "owl:onProperty";
export const SOME_VALUES_FROM_PREDICATE = "owl:someValuesFrom";
export const CLS_SVF1_RULE = "someValuesFrom";
export const ENTAILED_SVF1_PROVENANCE = `entailed:${CLS_SVF1_RULE}`;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE, same reason. */
export const CLS_SVF1_RULE_CONFIDENCE = 0.95;

/** The environment-set cap: how many independent premise sets one entailed
 *  fact may carry as ' | '-separated mgx:factJustification environments — the
 *  bounded-ATMS knob alongside depth/budget/focus. */
export const DEFAULT_MAX_ENVIRONMENTS = 4;

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
 * PURE semi-naive subClassOf closure: the delta twin of
 * `deriveSubClassClosure`, same contract exactly (only-new `{ subject,
 * object, via }` conclusions, tautology/dedup/focus screens, the same
 * per-round candidate sort, identical `budget`/`depth` semantics). Instead of
 * re-joining the whole relation each round, round one joins only
 * `deltaEdges` against the full relation (Δ∘R and R∘Δ — Δ∘Δ falls out of Δ∘R
 * because `allEdges` contains the delta rows too), and each later round joins
 * only what the previous round committed. When the non-delta part of
 * `allEdges` is already closed (a prior pass ran to fixpoint), the output
 * equals the full kernel's novel output, order included.
 */
export function deriveSubClassClosureDelta(allEdges, deltaEdges, { depth = 32, budget = 50, focus = null } = {}) {
  const present = new Set();      // "a\0b" for every edge already known
  const succ = new Map();         // a -> Set(b): the live successor relation
  const pred = new Map();         // b -> Set(a): its inverse, for the R∘Δ join
  for (const [a, b] of allEdges || []) {
    if (!a || !b || a === b) continue;
    present.add(`${a}${SEP}${b}`);
    if (!succ.has(a)) succ.set(a, new Set());
    succ.get(a).add(b);
    if (!pred.has(b)) pred.set(b, new Set());
    pred.get(b).add(a);
  }
  let delta = [];
  const seenDelta = new Set();
  for (const [a, b] of deltaEdges || []) {
    if (!a || !b || a === b) continue;
    const key = `${a}${SEP}${b}`;
    if (seenDelta.has(key)) continue;
    seenDelta.add(key);
    delta.push([a, b]);
  }
  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (a, b, c) => !focusSet || focusSet.has(a) || focusSet.has(b) || focusSet.has(c);

  const derived = [];
  const derivedKeys = new Set();
  for (let round = 0; round < depth && delta.length; round += 1) {
    const additions = [];
    const consider = (a, b, c) => {
      if (a === c) return;                                    // tautology screen (reflexive)
      const key = `${a}${SEP}${c}`;
      if (present.has(key) || derivedKeys.has(key)) return;   // dedup / novelty screen
      if (!inFocus(a, b, c)) return;                          // focus-connection screen
      additions.push([a, b, c, key]);
    };
    for (const [a, b] of delta) {
      for (const c of succ.get(b) || []) consider(a, b, c);   // Δ∘R
      for (const z of pred.get(a) || []) consider(z, a, b);   // R∘Δ
    }
    if (!additions.length) break; // fixpoint reached
    additions.sort((x, y) => x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]) || x[1].localeCompare(y[1]));
    let progressed = false;
    const nextDelta = [];
    for (const [a, b, c, key] of additions) {
      if (derivedKeys.has(key)) continue; // an earlier addition this round covered it
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: a, object: c, via: b });
      if (!succ.has(a)) succ.set(a, new Set());
      succ.get(a).add(c);
      if (!pred.has(c)) pred.set(c, new Set());
      pred.get(c).add(a);
      nextDelta.push([a, c]);
      progressed = true;
    }
    if (derived.length >= budget || !progressed) break; // budget hit or nothing committed
    delta = nextDelta;
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

/** `buildAncestorCloser` with the edges reversed: a memoized
 *  `descendantsOf(c)` walking every SUBclass reachable below `c`. */
function buildDescendantCloser(subClassEdges) {
  return buildAncestorCloser((subClassEdges || []).map(([a, b]) => [b, a]));
}

/**
 * PURE relevance frontier: the set of terms a change touching `seedTerms`
 * can actually affect, over the fact `rows` given. Seeds (normalized) plus
 * the ⊑-descendant closure of each seed (a new edge above a class affects
 * everything below it), plus every instance carrying a stored type in that
 * affected-class set, plus every declared someValuesFrom restriction node
 * whose target filler class sits in it. Over-approximation is harmless — the
 * kernels' own dedup screens drop anything already known — while a term the
 * frontier misses simply waits for the next full pass. The same structure
 * serves forward relevance (a delta pass's focus) that `retractSubClassOf`'s
 * citedBy index serves backward.
 */
export function buildRelevanceFrontier(rows, seedTerms) {
  const subClassEdges = [];
  const typeEdges = [];
  const onPropertyOf = new Map();      // restriction -> owl:onProperty's object
  const someValuesFromOf = new Map();  // restriction -> owl:someValuesFrom's object
  for (const r of rows || []) {
    if (!r || !r.subject || !r.predicate || !r.object) continue;
    if (isSubClassOf(r.predicate)) subClassEdges.push([r.subject, r.object]);
    else if (isType(r.predicate)) typeEdges.push([r.subject, r.object]);
    else if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
    else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
  }
  const descendantsOf = buildDescendantCloser(subClassEdges);
  const affectedClasses = new Set();
  for (const t of seedTerms || []) {
    const n = normFactTerm(t);
    if (!n) continue;
    affectedClasses.add(n);
    for (const d of descendantsOf(n)) affectedClasses.add(d);
  }
  const frontier = new Set(affectedClasses);
  for (const [x, c] of typeEdges) if (affectedClasses.has(c)) frontier.add(x);
  for (const [restriction, target] of someValuesFromOf) {
    if (onPropertyOf.has(restriction) && affectedClasses.has(target)) frontier.add(restriction);
  }
  return frontier;
}

/**
 * PURE cax-sco: rdf:type propagation across a subClassOf chain — (x rdf:type
 * C), (C ⊑ … ⊑ D) ⊨ (x rdf:type D). `subClassEdges` is a fixed input (unlike
 * `deriveSubClassClosure`'s own growing relation), so one ancestor walk per
 * class (`buildAncestorCloser`) covers the whole chain — no fixpoint rounds
 * needed. Returns ONLY new `{ subject, object, via }` conclusions, bounded by
 * `budget`, focus-filtered, tautology- and dedup-screened, deterministic order.
 *
 * `presentTypeEdges` (defaults to `typeEdges`) feeds ONLY the novelty screen:
 * a delta caller that pre-filters `typeEdges` to the relevant slice passes the
 * FULL list here, so an already-stored conclusion outside the slice is still
 * recognized as known rather than re-derived.
 */
export function deriveTypePropagation(typeEdges, subClassEdges, { budget = 50, focus = null, presentTypeEdges = typeEdges } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  const present = new Set(); // "x\0C" for every rdf:type edge already known
  const seenTypeEdge = new Set(); // dedup repeated (x,C) input rows
  for (const [x, c] of presentTypeEdges || []) if (x && c) present.add(`${x}${SEP}${c}`);
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
 * owl:someValuesFrom C2 |= x rdf:type R (OWL 2 RL Table 6). `propertyEdges`
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
const ON_CLASS_PREDICATE = "owl:onClass";

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
const SCM_CARD_RULE = "cardinalityMonotonicity";
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
const CAX_MAXC0_RULE = "maxCardinalityZero";
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
 * same pass, and materialises each new conclusion via `appendFacts` with its
 * `entailed:*` provenance. Trust rides the entailed hook
 * (`min(premiseTrusts) x ruleConfidence`) when premises are resolvable in the
 * pre-pass snapshot, else falls back to the bare entailed prior.
 *
 * After the kernels, an ALTERNATE-DISCOVERY step (bounded by the same budget
 * number, spent separately) enumerates additional premise environments for
 * this pass's conclusions and for stored purely-entailed facts still under
 * the `maxEnvironments` cap, so a fact's justification accretes every
 * independent derivation route retraction can later check by set membership.
 *
 * SEMI-NAIVE DELTA MODE: when the store carries a watermark from the last
 * complete pass (the optional `loadSyllogiseState`/`saveSyllogiseState` store
 * members), no caller focus is given, no fact was removed since, and `full`
 * was not forced, the pass runs delta evaluation — scm-sco joins only the
 * since-watermark rows (`deriveSubClassClosureDelta`), and the four later
 * kernels are scoped by a relevance frontier built from the delta
 * (`buildRelevanceFrontier`) plus per-kernel input pre-filters. Conclusions
 * are identical to a full pass (the dedup screens make over-approximation
 * harmless); what shrinks is candidate generation and the joins — the pass
 * still pays the store snapshot read. The watermark advances ONLY after an
 * unfocused pass that ends at a natural fixpoint.
 *
 * opts: `depth` (max fixpoint rounds, default 32), `budget` (max new
 * derivations this pass, shared across all five rules, default 50), `focus`
 * (Set|array of class terms scoping derivations to what touches it — omit
 * for a whole-graph pass), `maxEnvironments` (per-fact environment cap,
 * default DEFAULT_MAX_ENVIRONMENTS), `full` (force full evaluation even with
 * a valid watermark), `store` (REQUIRED — the memory store's
 * { loadMemory, readFactRows, appendFacts } read/write functions, injected so
 * this inference module never imports the store itself; optional
 * loadSyllogiseState/saveSyllogiseState enable delta mode).
 *
 * Returns { derived: [{ id, subject, object, via, rule }], count, budget,
 * depth, truncated, mode, deltaSize, environmentsAdded, alternatesTruncated }.
 */
export async function syllogise(repoDir, {
  depth = 32, budget = 50, focus = null, maxEnvironments = DEFAULT_MAX_ENVIRONMENTS, full = false, store,
} = {}) {
  const { loadMemory, readFactRows, appendFacts } = requireStore(store, ["loadMemory", "readFactRows", "appendFacts"], "syllogise");
  const stateFnsPresent = typeof store?.loadSyllogiseState === "function" && typeof store?.saveSyllogiseState === "function";
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

  // Mode: delta only with a valid watermark (state present, nothing removed
  // since — an id-set diff catches retractions, snapshots and hand-edits),
  // no caller focus, and no forced full. Anything else is a full pass.
  const state = normalizedFocus === null && stateFnsPresent ? await store.loadSyllogiseState(repoDir) : null;
  const currentIdSet = new Set(rows.map((r) => r.id));
  const removedSinceLast = Array.isArray(state?.factIds) ? state.factIds.filter((id) => !currentIdSet.has(id)) : [];
  const mode = state && Array.isArray(state.factIds) && !removedSinceLast.length && !full ? "delta" : "full";
  const watermark = mode === "delta" ? new Set(state.factIds) : null;
  const deltaRows = mode === "delta" ? rows.filter((r) => !watermark.has(r.id)) : rows;
  const deltaSize = deltaRows.length;

  // Pre-pass trust snapshot for the entailed hook's premiseTrusts lookup,
  // wired for cax-dw/cls-svf1/scm-svf1 only: with ruleConfidence defaulting
  // to 1, min(premiseTrusts) x 1 can EQUAL a stated premise's trust (e.g. two
  // 1.0 premises), tying or outranking the very premise it derived from —
  // scm-sco/cax-sco stay on the bare entailed prior until they get the same
  // sub-1 discount cax-dw uses below.
  const trustByTriple = new Map();
  for (const r of rows) trustByTriple.set(`${r.subject}${SEP}${r.predicate}${SEP}${r.object}`, r.trust);
  const premiseTrust = (s, p, o) => trustByTriple.get(`${s}${SEP}${p}${SEP}${o}`);
  const hasTriple = (s, p, o) => trustByTriple.has(`${s}${SEP}${p}${SEP}${o}`);
  const numericOnly = (arr) => arr.filter((t) => typeof t === "number");

  // An empty delta derives nothing by construction — and an empty frontier
  // must never be handed to the kernels as focus, because an empty focus Set
  // means "whole graph" to normalizeFocus. Skipping the kernels outright is
  // both the honest and the cheap reading.
  const deltaEmpty = mode === "delta" && !deltaRows.length;
  const deltaSubEdges = mode === "delta"
    ? deltaRows.filter((r) => isSubClassOf(r.predicate)).map((r) => [r.subject, r.object])
    : [];
  const scmDerived = mode === "delta"
    ? (deltaSubEdges.length ? deriveSubClassClosureDelta(subClassEdges, deltaSubEdges, { depth, budget, focus: normalizedFocus }) : [])
    : deriveSubClassClosure(subClassEdges, { depth, budget, focus: normalizedFocus });
  // cax-sco sees the ENLARGED subClassOf edge set (stated ∪ this pass's own
  // scm-sco conclusions) so both rules complete in one `tmct syllogise` call.
  const enlargedSubClassEdges = subClassEdges.concat(scmDerived.map((d) => [d.subject, d.object]));

  // Delta mode scopes the four later kernels by the relevance frontier: built
  // AFTER scm-sco over the enlarged edge set, seeded by every term of every
  // delta row, then applied as their focus plus per-kernel input pre-filters.
  let kernelFocus = normalizedFocus;
  let frontier = null;
  if (mode === "delta" && !deltaEmpty) {
    const frontierRows = rows.concat(scmDerived.map((d) => ({ subject: d.subject, predicate: SUBCLASS_PREDICATE, object: d.object })));
    const seeds = [];
    for (const r of deltaRows) seeds.push(r.subject, r.object);
    frontier = buildRelevanceFrontier(frontierRows, seeds);
    kernelFocus = frontier;
  }
  const inFrontier = (t) => !frontier || frontier.has(t);
  // cax-sco's inputs narrow to the frontier's type edges, but its NOVELTY set
  // must still see every stored type edge (presentTypeEdges) — otherwise the
  // filtered call re-derives stored conclusions and idempotency breaks.
  const caxTypeEdges = frontier ? typeEdges.filter(([x, c]) => inFrontier(x) || inFrontier(c)) : typeEdges;
  // cax-dw additionally keeps any type whose ⊑-ancestry reaches an endpoint
  // of a delta disjointWith row — a new disjointness above an old type is
  // invisible to the frontier's descendant walk.
  const deltaDwEndpoints = new Set();
  if (frontier) {
    for (const r of deltaRows) {
      if (isDisjoint(r.predicate)) { deltaDwEndpoints.add(r.subject); deltaDwEndpoints.add(r.object); }
    }
  }
  const dwAncestorsOf = frontier && deltaDwEndpoints.size ? buildAncestorCloser(enlargedSubClassEdges) : null;
  const dwTypeEdges = frontier
    ? typeEdges.filter(([x, c]) => inFrontier(x) || inFrontier(c)
      || (dwAncestorsOf && [...dwAncestorsOf(c)].some((a) => deltaDwEndpoints.has(a))))
    : typeEdges;
  // cls-svf1's property edges narrow to the frontier — plus every edge over a
  // property whose restriction declaration is itself in the delta, so a new
  // restriction reaches old edges; its type edges stay FULL (they feed the
  // novelty screen and the filler-type join).
  const deltaRestrictionProperties = new Set();
  if (frontier) {
    for (const r of deltaRows) {
      if (isOnProperty(r.predicate) || isSomeValuesFrom(r.predicate)) {
        const property = onPropertyOf.get(r.subject);
        if (property) deltaRestrictionProperties.add(normFactTerm(property));
      }
    }
  }
  const svf1PropertyEdges = frontier
    ? propertyEdges.filter(([x, p, y]) => inFrontier(x) || inFrontier(y) || deltaRestrictionProperties.has(normFactTerm(p)))
    : propertyEdges;

  const remainingBudget = Math.max(0, budget - scmDerived.length);
  const caxDerived = remainingBudget > 0 && !deltaEmpty
    ? deriveTypePropagation(caxTypeEdges, enlargedSubClassEdges, { budget: remainingBudget, focus: kernelFocus, presentTypeEdges: typeEdges })
    : [];
  // cax-dw sees the SAME enlarged subClassOf set (so its own ⊑-lift reaches a
  // chain scm-sco just grew this pass) — it doesn't need the enlarged TYPE
  // edge set too, since it walks each direct type's own ⊑-ancestor closure.
  const remainingBudgetDw = Math.max(0, budget - scmDerived.length - caxDerived.length);
  const dwDerived = remainingBudgetDw > 0 && !deltaEmpty
    ? deriveDisjointViolations(dwTypeEdges, enlargedSubClassEdges, disjointEdges, { budget: remainingBudgetDw, focus: kernelFocus })
    : [];
  // cls-svf1 sees the SAME enlarged subClassOf set (its own ⊑-lift) but NOT
  // the enlarged type edge set, so a same-pass cax-sco conclusion on `y`
  // can't be consumed before a human can audit it.
  const remainingBudgetSvf1 = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length);
  const svf1Derived = remainingBudgetSvf1 > 0 && restrictionEdges.length && !deltaEmpty
    ? deriveSomeValuesFromApplication(svf1PropertyEdges, typeEdges, enlargedSubClassEdges, restrictionEdges, { budget: remainingBudgetSvf1, focus: kernelFocus })
    : [];
  // scm-svf1 reuses the SAME restrictionEdges built for cls-svf1 above —
  // needs at least two restrictions over one property to compare. In delta
  // mode the frontier scopes it as focus only, no input pre-filter.
  const remainingBudgetScmSvf = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length - svf1Derived.length);
  const scmSvfDerived = remainingBudgetScmSvf > 0 && restrictionEdges.length > 1 && !deltaEmpty
    ? deriveSomeValuesFromSubsumption(restrictionEdges, enlargedSubClassEdges, { budget: remainingBudgetScmSvf, focus: kernelFocus })
    : [];
  const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));

  // Batched write: ONE mutateMemory pass for all five rules' conclusions via
  // appendFacts, not one appendFact per derived fact.
  const toWrite = [
    ...scmDerived.map((d) => ({
      subject: d.subject, predicate: SUBCLASS_PREDICATE, object: d.object,
      provenance: ENTAILED_PROVENANCE,
      // Persisted justification: one environment per independent derivation,
      // each an ordered premise fact-id list — this first one is the premise
      // set the conclusion rode (a⊑b, b⊑c); the alternate-discovery step
      // below may append more. Content-addressed ids work even when a premise
      // is itself an entailment this same pass just derived. Read back by
      // retractSubClassOf (below) to find every entailment a retracted
      // premise could have supported. All five rules persist one, each
      // citing its own premise shape.
      justification: [[
        factIdForTriple(d.subject, SUBCLASS_PREDICATE, d.via),
        factIdForTriple(d.via, SUBCLASS_PREDICATE, d.object),
      ]],
    })),
    ...caxDerived.map((d) => ({
      subject: d.subject, predicate: TYPE_PREDICATE, object: d.object,
      provenance: ENTAILED_TYPE_PROVENANCE,
      // The ⊑ premise is cited as the DIRECT via⊑object edge even when the
      // taught chain is multi-hop: scm-sco materialises that edge (this same
      // pass or an earlier one), and retraction re-VERIFIES every candidate
      // anyway, so a citation left dangling by budget truncation is inert.
      justification: [[
        factIdForTriple(d.subject, TYPE_PREDICATE, d.via),
        factIdForTriple(d.via, SUBCLASS_PREDICATE, d.object),
      ]],
    })),
    ...dwDerived.map((d) => {
      // disjointWith is symmetric, taught as ONE direction — the premise row
      // could be stored either (viaClass, disjointWith, object) or its
      // mirror; resolve which, so the justification cites a real stored id.
      const dwStoredForward = hasTriple(d.viaClass, DISJOINT_PREDICATE, d.object);
      const [dwS, dwO] = dwStoredForward ? [d.viaClass, d.object] : [d.object, d.viaClass];
      const premiseTrusts = numericOnly([
        premiseTrust(d.subject, TYPE_PREDICATE, d.viaType),
        premiseTrust(dwS, DISJOINT_PREDICATE, dwO),
        // the ⊑-lift premise only exists when this IS a lift (viaClass !==
        // viaType) — a direct hit has no extra subClassOf premise to price in.
        ...(d.viaClass !== d.viaType ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaClass)] : []),
      ]);
      return {
        subject: d.subject, predicate: DISJOINT_PREDICATE, object: d.object,
        provenance: ENTAILED_DISJOINT_PROVENANCE,
        justification: [[
          factIdForTriple(d.subject, TYPE_PREDICATE, d.viaType),
          factIdForTriple(dwS, DISJOINT_PREDICATE, dwO),
          ...(d.viaClass !== d.viaType ? [factIdForTriple(d.viaType, SUBCLASS_PREDICATE, d.viaClass)] : []),
        ]],
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
        justification: [[
          factIdForTriple(d.subject, d.viaProperty, d.viaValue),
          factIdForTriple(d.viaValue, TYPE_PREDICATE, d.viaType),
          factIdForTriple(d.object, ON_PROPERTY_PREDICATE, d.viaPropertyKey),
          factIdForTriple(d.object, SOME_VALUES_FROM_PREDICATE, d.viaTarget),
          ...(d.viaType !== d.viaTarget ? [factIdForTriple(d.viaType, SUBCLASS_PREDICATE, d.viaTarget)] : []),
        ]],
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
        justification: [[
          ...(r1 ? [factIdForTriple(d.subject, ON_PROPERTY_PREDICATE, r1.property)] : []),
          factIdForTriple(d.subject, SOME_VALUES_FROM_PREDICATE, d.viaY1),
          ...(r2 ? [factIdForTriple(d.object, ON_PROPERTY_PREDICATE, r2.property)] : []),
          factIdForTriple(d.object, SOME_VALUES_FROM_PREDICATE, d.viaY2),
          factIdForTriple(d.viaY1, SUBCLASS_PREDICATE, d.viaY2),
        ]],
        // same sub-1 discount as cax-dw/cls-svf1, same reason (see CAX_DW_RULE_CONFIDENCE).
        ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: SCM_SVF_RULE_CONFIDENCE } : {}),
      };
    }),
  ];

  // ---- alternate-environment discovery ----
  // Enumerate additional premise environments for this pass's conclusions and
  // for stored purely-entailed facts still under the cap, so retraction can
  // later keep a multiply-derived fact by set membership instead of a
  // re-derivation. The examination spends its own copy of the budget number —
  // it never competes with the derivation budget above.
  const conclusionCandidates = toWrite.map((w) => ({
    id: factIdForTriple(w.subject, w.predicate, w.object),
    subject: w.subject, predicate: w.predicate, object: w.object,
    environments: w.justification,
    write: w,
  }));
  const enumerateSupport = buildSupportEnumerator(rows.concat(conclusionCandidates.map((c) => ({
    id: c.id, subject: c.subject, predicate: c.predicate, object: c.object,
  }))));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const ownedPredicate = (p) => isSubClassOf(p) || isType(p) || isDisjoint(p);
  // Delta mode examines only stored facts the frontier touches; an alternate
  // enabled solely by a change outside it (e.g. a new filler type for
  // cls-svf1) waits for the next full pass — retraction stays correct either
  // way through its enumerate/boolean fallbacks.
  const storedCandidateInScope = (r) => mode !== "delta"
    || (frontier !== null && (frontier.has(r.subject) || frontier.has(r.object)));
  const storedCandidates = rows
    .filter((r) => ownedPredicate(r.predicate) && isPurelyEntailed(r.provenance)
      && environmentsOf(r).length < maxEnvironments && storedCandidateInScope(r))
    .map((r) => ({
      id: r.id, subject: r.subject, predicate: r.predicate, object: r.object,
      environments: environmentsOf(r), provenance: r.provenance,
    }));
  const alternateCandidates = [...conclusionCandidates, ...storedCandidates]
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.predicate.localeCompare(b.predicate) || a.object.localeCompare(b.object));
  let environmentsAdded = 0;
  let alternatesTruncated = false;
  let examined = 0;
  for (const cand of alternateCandidates) {
    if (examined >= budget) { alternatesTruncated = true; break; }
    examined += 1;
    // Enumerate one PAST the cap so a distinct environment falling to the cap
    // is visible to the merge below and honestly reported as truncation.
    const discovered = enumerateSupport(cand, { maxEnvironments: maxEnvironments + 1 });
    const { kept, truncated: mergeTruncated } = capMergeEnvironments(cand.environments, discovered, maxEnvironments);
    if (mergeTruncated) alternatesTruncated = true;
    if (kept.length <= cand.environments.length) continue; // nothing new to record
    environmentsAdded += kept.length - cand.environments.length;
    if (cand.write) { cand.write.justification = kept; continue; }
    // A stored fact gains its newly discovered environments via a minimal
    // upsert row: provenance omitted (first-write-wins keeps the union), and
    // the three premise-discounted rules re-state their best environment's
    // trusts so the entailed hook stays engaged through the trust recompute.
    toWrite.push({
      subject: cand.subject, predicate: cand.predicate, object: cand.object,
      justification: kept,
      ...(bestEnvironmentTrustOpts(cand.provenance, kept, (pid) => rowById.get(pid)?.trust) || {}),
    });
  }

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
  const truncated = written.length >= budget;

  // The watermark advances ONLY after an unfocused pass whose derivations
  // ended at a natural fixpoint — a truncated or focused pass has not seen
  // everything, so its id set must not masquerade as a completed frontier.
  // alternatesTruncated does not block: alternates change justifications,
  // never which conclusions exist.
  if (normalizedFocus === null && stateFnsPresent && !truncated) {
    const factIds = new Set(currentIdSet);
    for (const id of ids) factIds.add(id);
    await store.saveSyllogiseState(repoDir, {
      version: 1, factIds: [...factIds].sort(), completedAt: new Date().toISOString(),
    });
  }
  return {
    derived: written, count: written.length, budget, depth, truncated,
    mode, deltaSize, environmentsAdded, alternatesTruncated,
  };
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

/** Builds the per-round VERIFY oracle for retraction: given ONLY the
 *  surviving fact rows, returns `stillDerivable(row)` — true when the row's
 *  (s,p,o) conclusion is re-derivable from survivors by the rule family that
 *  owns its predicate (scm-sco/scm-svf1 for subClassOf, cax-sco/cls-svf1 for
 *  rdf:type, cax-dw for disjointWith). One shared ancestor closure plus small
 *  indexes per round, joining exactly what each derive kernel joins. Pure,
 *  no I/O. */
function buildSurvivorDerivabilityCheck(rows) {
  const subClassEdges = [];
  const typesOf = new Map();          // x -> Set(surviving direct type classes)
  const disjointOf = new Map();       // term -> Set(disjoint partners), symmetric
  const onPropertyOf = new Map();     // restriction -> owl:onProperty's object
  const someValuesFromOf = new Map(); // restriction -> owl:someValuesFrom's object
  const propertyEdgesOf = new Map();  // x -> [[normalized predicate, y], …]
  for (const r of rows) {
    const pLower = String(r.predicate || "").trim().toLowerCase();
    if (isSubClassOf(r.predicate)) subClassEdges.push([r.subject, r.object]);
    else if (isType(r.predicate)) {
      if (!typesOf.has(r.subject)) typesOf.set(r.subject, new Set());
      typesOf.get(r.subject).add(r.object);
    } else if (isDisjoint(r.predicate)) {
      if (!disjointOf.has(r.subject)) disjointOf.set(r.subject, new Set());
      disjointOf.get(r.subject).add(r.object);
      if (!disjointOf.has(r.object)) disjointOf.set(r.object, new Set());
      disjointOf.get(r.object).add(r.subject);
    } else if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
    else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
    else if (!RESERVED_PREDICATES.has(pLower)) {
      if (!propertyEdgesOf.has(r.subject)) propertyEdgesOf.set(r.subject, []);
      propertyEdgesOf.get(r.subject).push([normFactTerm(r.predicate), r.object]);
    }
  }
  const ancestorsOf = buildAncestorCloser(subClassEdges);
  const reaches = (a, b) => a !== b && ancestorsOf(a).has(b);
  const restrictionOf = (node) => {
    const property = onPropertyOf.get(node);
    const target = someValuesFromOf.get(node);
    return property && target ? { property: normFactTerm(property), target } : null;
  };

  return (row) => {
    if (isSubClassOf(row.predicate)) {
      // scm-sco: some surviving ⊑-path still connects subject to object.
      if (reaches(row.subject, row.object)) return true;
      // scm-svf1: both ends still declared restrictions over the SAME
      // property, with strictly ⊑-related fillers (kernel-faithful).
      const r1 = restrictionOf(row.subject);
      const r2 = restrictionOf(row.object);
      return Boolean(r1 && r2 && r1.property === r2.property && reaches(r1.target, r2.target));
    }
    if (isType(row.predicate)) {
      // cax-sco: a surviving direct type whose ⊑-closure reaches the class.
      for (const c of typesOf.get(row.subject) || []) {
        if (reaches(c, row.object)) return true;
      }
      // cls-svf1: the class is a still-declared restriction node — a
      // surviving property edge whose value's type (⊑-lifted) satisfies it.
      const rec = restrictionOf(row.object);
      if (rec) {
        for (const [pKey, y] of propertyEdgesOf.get(row.subject) || []) {
          if (pKey !== rec.property) continue;
          for (const c of typesOf.get(y) || []) {
            if (c === rec.target || reaches(c, rec.target)) return true;
          }
        }
      }
      return false;
    }
    if (isDisjoint(row.predicate)) {
      // cax-dw: a surviving type whose ⊑-closure meets a surviving
      // disjointWith partner equal to the conclusion's object.
      for (const c of typesOf.get(row.subject) || []) {
        for (const d of [c, ...ancestorsOf(c)]) {
          if (disjointOf.get(d)?.has(row.object)) return true;
        }
      }
      return false;
    }
    // An entailed predicate no rule family here owns: nothing can re-check
    // it, so it is never removed on a stale citation alone.
    return true;
  };
}

/** A row's persisted environments, upgrading a store whose readFactRows
 *  predates the environment field: a bare justification list reads as one
 *  environment. */
const environmentsOf = (row) => row.environments
  || (Array.isArray(row.justification) && row.justification.length ? [row.justification] : []);

/** Builds the environment ENUMERATOR: given ONLY the fact rows in `rows`,
 *  returns `(row, { maxEnvironments }) => string[][]` — every premise-id set
 *  (up to the cap) that independently derives the row's (s,p,o) conclusion
 *  under the rule families that own its predicate, in a fixed deterministic
 *  order, each environment citing ids in the same order the write path
 *  cites them. An environment counts only when EVERY cited id resolves to a
 *  row in `rows` and none is the row's own id — stricter than
 *  buildSurvivorDerivabilityCheck's closure walk (a multi-hop ⊑ premise with
 *  no materialised direct edge enumerates nothing), which is why that boolean
 *  check stays the final authority in retraction. Pure, no I/O. */
function buildSupportEnumerator(rows) {
  const storedIds = new Set();
  const subClassEdges = [];
  const succ = new Map();             // a -> Set(direct stored superclass)
  const typesOf = new Map();          // x -> Set(direct stored types)
  const disjointForward = new Set();  // "a␟b" per stored disjointWith row, as-stored orientation
  const disjointOf = new Map();       // term -> Set(partners), symmetric
  const onPropertyOf = new Map();     // restriction -> owl:onProperty's object
  const someValuesFromOf = new Map(); // restriction -> owl:someValuesFrom's object
  const propertyEdgesOf = new Map();  // x -> [[rawPredicate, y], …]
  for (const r of rows) {
    if (!r || !r.subject || !r.predicate || !r.object) continue;
    if (r.id) storedIds.add(r.id);
    const pLower = String(r.predicate || "").trim().toLowerCase();
    if (isSubClassOf(r.predicate)) {
      subClassEdges.push([r.subject, r.object]);
      if (!succ.has(r.subject)) succ.set(r.subject, new Set());
      succ.get(r.subject).add(r.object);
    } else if (isType(r.predicate)) {
      if (!typesOf.has(r.subject)) typesOf.set(r.subject, new Set());
      typesOf.get(r.subject).add(r.object);
    } else if (isDisjoint(r.predicate)) {
      disjointForward.add(`${r.subject}${SEP}${r.object}`);
      if (!disjointOf.has(r.subject)) disjointOf.set(r.subject, new Set());
      disjointOf.get(r.subject).add(r.object);
      if (!disjointOf.has(r.object)) disjointOf.set(r.object, new Set());
      disjointOf.get(r.object).add(r.subject);
    } else if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
    else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
    else if (!RESERVED_PREDICATES.has(pLower)) {
      if (!propertyEdgesOf.has(r.subject)) propertyEdgesOf.set(r.subject, []);
      propertyEdgesOf.get(r.subject).push([r.predicate, r.object]);
    }
  }
  const ancestorsOf = buildAncestorCloser(subClassEdges);
  const succOf = (a) => succ.get(a) || new Set();
  const restrictionOf = (node) => {
    const property = onPropertyOf.get(node);
    const target = someValuesFromOf.get(node);
    return property && target ? { property, propertyKey: normFactTerm(property), target } : null;
  };

  return (row, { maxEnvironments = DEFAULT_MAX_ENVIRONMENTS } = {}) => {
    const out = [];
    const seen = new Set();
    const admit = (env) => {
      if (out.length >= maxEnvironments) return;
      if (row.id && env.includes(row.id)) return; // self-support is no support
      if (!env.every((id) => storedIds.has(id))) return; // a dangling citation makes the whole set inert
      const key = [...env].sort().join(" ");
      if (seen.has(key)) return;
      seen.add(key);
      out.push(env);
    };

    if (isSubClassOf(row.predicate)) {
      // scm-sco: each pivot m with stored direct s⊑m and m⊑o edges.
      for (const m of [...succOf(row.subject)].sort()) {
        if (out.length >= maxEnvironments) break;
        if (m === row.subject || m === row.object) continue;
        if (!succOf(m).has(row.object)) continue;
        admit([
          factIdForTriple(row.subject, SUBCLASS_PREDICATE, m),
          factIdForTriple(m, SUBCLASS_PREDICATE, row.object),
        ]);
      }
      // scm-svf1: both ends declared restrictions over the SAME property with
      // a stored direct filler ⊑.
      if (out.length < maxEnvironments) {
        const r1 = restrictionOf(row.subject);
        const r2 = restrictionOf(row.object);
        if (r1 && r2 && r1.propertyKey === r2.propertyKey && r1.target !== r2.target
          && succOf(r1.target).has(r2.target)) {
          admit([
            factIdForTriple(row.subject, ON_PROPERTY_PREDICATE, r1.property),
            factIdForTriple(row.subject, SOME_VALUES_FROM_PREDICATE, r1.target),
            factIdForTriple(row.object, ON_PROPERTY_PREDICATE, r2.property),
            factIdForTriple(row.object, SOME_VALUES_FROM_PREDICATE, r2.target),
            factIdForTriple(r1.target, SUBCLASS_PREDICATE, r2.target),
          ]);
        }
      }
      return out;
    }
    if (isType(row.predicate)) {
      // cax-sco: each stored type c with a stored direct c⊑D edge.
      for (const c of [...(typesOf.get(row.subject) || [])].sort()) {
        if (out.length >= maxEnvironments) break;
        if (c === row.object) continue;
        if (!succOf(c).has(row.object)) continue;
        admit([
          factIdForTriple(row.subject, TYPE_PREDICATE, c),
          factIdForTriple(c, SUBCLASS_PREDICATE, row.object),
        ]);
      }
      // cls-svf1: D a declared restriction, each stored property edge over its
      // property whose value's type hits the target directly or by one stored
      // direct ⊑ edge.
      const rec = restrictionOf(row.object);
      if (rec) {
        const edges = [...(propertyEdgesOf.get(row.subject) || [])]
          .filter(([p]) => normFactTerm(p) === rec.propertyKey)
          .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
        for (const [p, y] of edges) {
          if (out.length >= maxEnvironments) break;
          for (const c of [...(typesOf.get(y) || [])].sort()) {
            if (out.length >= maxEnvironments) break;
            if (c !== rec.target && !succOf(c).has(rec.target)) continue;
            admit([
              factIdForTriple(row.subject, p, y),
              factIdForTriple(y, TYPE_PREDICATE, c),
              factIdForTriple(row.object, ON_PROPERTY_PREDICATE, rec.propertyKey),
              factIdForTriple(row.object, SOME_VALUES_FROM_PREDICATE, rec.target),
              ...(c !== rec.target ? [factIdForTriple(c, SUBCLASS_PREDICATE, rec.target)] : []),
            ]);
          }
        }
      }
      return out;
    }
    if (isDisjoint(row.predicate)) {
      // cax-dw: each stored type c and lift class d whose stored disjoint row
      // reaches the conclusion's object (orientation as stored).
      const pairs = [];
      for (const c of typesOf.get(row.subject) || []) {
        for (const d of [c, ...ancestorsOf(c)]) {
          if ((disjointOf.get(d) || new Set()).has(row.object)) pairs.push([c, d]);
        }
      }
      pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      for (const [c, d] of pairs) {
        if (out.length >= maxEnvironments) break;
        const dwStoredForward = disjointForward.has(`${d}${SEP}${row.object}`);
        const [dwS, dwO] = dwStoredForward ? [d, row.object] : [row.object, d];
        admit([
          factIdForTriple(row.subject, TYPE_PREDICATE, c),
          factIdForTriple(dwS, DISJOINT_PREDICATE, dwO),
          ...(d !== c ? [factIdForTriple(c, SUBCLASS_PREDICATE, d)] : []),
        ]);
      }
      return out;
    }
    return out; // a predicate no rule family owns enumerates nothing
  };
}

/** Merge already-stored environments with newly discovered ones under the
 *  cap: stored first (their order preserved), then discoveries in enumeration
 *  order, deduped by canonical key, truncated at `cap`. Returns
 *  { kept, truncated } — truncated true when a distinct environment was
 *  dropped for the cap. */
function capMergeEnvironments(storedEnvs, discoveredEnvs, cap) {
  const kept = [];
  const seen = new Set();
  let truncated = false;
  for (const env of [...(storedEnvs || []), ...(discoveredEnvs || [])]) {
    if (!Array.isArray(env) || !env.length) continue;
    const key = [...env].sort().join(" ");
    if (seen.has(key)) continue;
    if (kept.length >= cap) { truncated = true; continue; }
    seen.add(key);
    kept.push(env);
  }
  return { kept, truncated };
}

const ENTAILED_RULE_CONFIDENCE_BY_TAG = new Map([
  [ENTAILED_DISJOINT_PROVENANCE, CAX_DW_RULE_CONFIDENCE],
  [ENTAILED_SVF1_PROVENANCE, CLS_SVF1_RULE_CONFIDENCE],
  [ENTAILED_SCM_SVF_PROVENANCE, SCM_SVF_RULE_CONFIDENCE],
]);

/** The entailed-hook opts for re-stating a conclusion of one of the three
 *  premise-discounted rules: the BEST environment's premise trusts (max over
 *  environments of min(premise trusts); tie → the earlier environment) plus
 *  the rule's confidence — without this, recomputeFactTrust would silently
 *  reset a discounted conclusion to the bare entailed prior. Null for
 *  scm-sco/cax-sco conclusions (which ride the bare prior by design) and when
 *  no environment's premises all resolve to a numeric trust. */
function bestEnvironmentTrustOpts(provenance, environments, trustOfId) {
  let ruleConfidence;
  for (const tag of String(provenance || "").split(" | ")) {
    const rc = ENTAILED_RULE_CONFIDENCE_BY_TAG.get(tag);
    if (rc !== undefined) { ruleConfidence = rc; break; }
  }
  if (ruleConfidence === undefined) return null;
  let best = null;
  let bestMin = -1;
  for (const env of environments || []) {
    const trusts = env.map((id) => trustOfId(id)).filter((t) => typeof t === "number");
    if (trusts.length !== env.length) continue; // a premise with no resolvable trust can't price the environment
    const weakest = Math.min(...trusts);
    if (weakest > bestMin) { bestMin = weakest; best = trusts; }
  }
  return best ? { premiseTrusts: best, ruleConfidence } : null;
}

/**
 * A scoped retraction slice: DRed (delete-and-rederive; Gupta, Mumick &
 * Subrahmanian, SIGMOD 1993), NOT JTMS. It recomputes the MATERIALISATION —
 * where a JTMS would recompute belief labels — so a store that moves rows is
 * DRed by construction.
 * Retracting `subject ⊑ object` removes the fact, then cascades to any
 * purely-entailed fact — across all five rules' conclusions — whose persisted
 * justification cites a removed id. Each candidate is VERIFIED (re-derivable
 * from the surviving facts, not just "cited a removed id") before it is
 * actually removed, since a fact can have a second, independent derivation
 * path (a⊑b⊑d AND a⊑c⊑d both license a⊑d) that a bare delete-by-justification
 * walk would wrongly discard. This over-delete-then-re-verify IS DRed's shape. Repeats in rounds — a removed mid-chain link
 * can ripple — bounded by `budget` (max facts examined+removed) and `depth`
 * (max cascade rounds).
 *
 * The entry point stays subClassOf-rooted because chat's recognized
 * retraction phrasings ("X is not a Y", "forget that X is a kind of Y",
 * chat.mjs's teach lane) retract subClassOf facts; the cascade itself follows
 * justifications into every rule's conclusions (transitive ⊑, propagated
 * types, disjointness violations, restriction membership and subsumption).
 *
 * Each candidate is checked in three steps, cheapest first: (1) FAST PATH —
 * any stored environment untouched by the cascade and fully backed by
 * surviving rows keeps the fact by set membership alone; (2) ENUMERATE — a
 * fresh premise environment found among the survivors re-grounds it; (3) the
 * BOOLEAN BACKSTOP — the closure-walking derivability check, which sees
 * multi-hop support the enumerator's stored-direct-edge discipline cannot
 * cite, stays the final authority. A survivor whose environments changed is
 * RE-GROUNDED after the removal (its pruned or fresh environments written
 * back) when the store carries `appendFacts` — an OPTIONAL seam member:
 * without it removal is still correct, the survivor's environments just stay
 * stale until the next syllogise pass.
 *
 * Returns { retracted, count, budget, depth, truncated, found } — `found` is
 * false when `subject ⊑ object` was never a stored fact.
 */
export async function retractSubClassOf(repoDir, subject, object, {
  budget = 50, depth = 32, maxEnvironments = DEFAULT_MAX_ENVIRONMENTS, store,
} = {}) {
  const { loadMemory, readFactRows, removeFacts } = requireStore(store, ["loadMemory", "readFactRows", "removeFacts"], "retractSubClassOf");
  const appendFactsFn = typeof store?.appendFacts === "function" ? store.appendFacts : null;
  const s = normFactTerm(subject);
  const o = normFactTerm(object);
  const targetId = factIdForTriple(s, SUBCLASS_PREDICATE, o);
  const memory = await loadMemory(repoDir);
  const rows = readFactRows(memory);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(targetId)) return { retracted: [], count: 0, budget, depth, truncated: false, found: false };

  // Only a purely-entailed fact ever carries a walkable justification —
  // a fact later independently taught is never a cascade candidate at all.
  const entailedRows = rows.filter((r) => environmentsOf(r).length && isPurelyEntailed(r.provenance));
  // premise id -> the entailed fact ids whose environments cite it. Built
  // ONCE; each round's candidate set reads it for the facts the newest
  // removals could actually touch — backward relevance from the same
  // structure a forward pass reads forward.
  const citedBy = new Map();
  for (const r of entailedRows) {
    for (const env of environmentsOf(r)) {
      for (const premiseId of env) {
        if (!citedBy.has(premiseId)) citedBy.set(premiseId, new Set());
        citedBy.get(premiseId).add(r.id);
      }
    }
  }

  const removed = new Set([targetId]);
  const order = [targetId]; // deterministic report order: target first, then removal order
  const reground = new Map(); // survivor fact id -> the environments to persist for it
  let truncated = false;
  let round = 0;
  let newlyRemoved = [targetId];
  for (; round < depth; round += 1) {
    const candidateIds = new Set();
    for (const id of newlyRemoved) {
      for (const cited of citedBy.get(id) || []) {
        if (!removed.has(cited)) candidateIds.add(cited);
      }
    }
    const candidates = [...candidateIds].map((id) => byId.get(id))
      .sort((a, b) => a.subject.localeCompare(b.subject) || a.predicate.localeCompare(b.predicate) || a.object.localeCompare(b.object));
    if (!candidates.length) break; // fixpoint — nothing cites what just fell

    // The surviving fact set for THIS round excludes every candidate's own
    // row too, not just `removed` — otherwise a candidate could trivially
    // "reach itself" through its own not-yet-deleted edge, or lean on a
    // sibling candidate standing on the same broken premise.
    const survivors = rows.filter((r) => !removed.has(r.id) && !candidateIds.has(r.id));
    const survivorIds = new Set(survivors.map((r) => r.id));
    const enumerateSupport = buildSupportEnumerator(survivors);
    const stillDerivable = buildSurvivorDerivabilityCheck(survivors);

    let progressed = false;
    let hitBudget = false;
    newlyRemoved = [];
    for (const c of candidates) {
      if (removed.size >= budget) { hitBudget = true; break; }
      // FAST PATH: an environment whose every premise still stands keeps the
      // fact — pure set membership, no re-derivation. When some environments
      // broke, queue the pruned set so the next retraction still sees the
      // survivor (the stale-justification fix).
      const environments = environmentsOf(c);
      const intact = environments.filter((env) => env.every((id) => survivorIds.has(id)));
      if (intact.length) {
        if (intact.length !== environments.length) reground.set(c.id, intact);
        continue;
      }
      // ENUMERATE: a fresh premise environment among the survivors re-grounds
      // the fact under new citations.
      const fresh = enumerateSupport(c, { maxEnvironments });
      if (fresh.length) {
        reground.set(c.id, fresh);
        continue;
      }
      // BOOLEAN BACKSTOP: the closure walk is the final authority — it sees
      // multi-hop support with no materialised direct edge to cite, so a
      // still-derivable fact is never removed on a stale citation alone (its
      // environments stay as they were).
      if (stillDerivable(c)) continue;
      removed.add(c.id);
      order.push(c.id);
      newlyRemoved.push(c.id);
      progressed = true;
    }
    if (hitBudget) { truncated = true; break; }
    if (!progressed) break; // every candidate this round survived — fixpoint
  }
  if (!truncated && round >= depth) {
    // depth exhausted, not a natural fixpoint — honestly flag it if a pending
    // candidate (any surviving fact whose environment union still cites a
    // removed id) would have been checked next round.
    truncated = entailedRows.some((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j)));
  }

  const { removed: actuallyRemoved } = await removeFacts(repoDir, order);
  if (appendFactsFn) {
    const regroundWrites = [...reground.entries()]
      .filter(([id]) => !removed.has(id))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, environments]) => {
        const row = byId.get(id);
        return {
          subject: row.subject, predicate: row.predicate, object: row.object,
          // provenance omitted — appendFacts' first-write-wins keeps the union
          justification: environments,
          ...(bestEnvironmentTrustOpts(row.provenance, environments, (pid) => byId.get(pid)?.trust) || {}),
        };
      });
    if (regroundWrites.length) await appendFactsFn(repoDir, regroundWrites);
  }
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
