// syllogise.mjs — tmct's speculative-inference engine (ROADMAP Phase 9 /
// archive/PLAN_SPECULATIVE_INFERENCE.md, growing toward tier-5 "the Syllogist"
// per PLAN_INFERENCE_TESTING.md). Offline, $0, deterministic, HARD-bounded idle
// CPU: forward-chain entailments over the OWL-labelled memory graph so a future
// query-time MISS becomes a lookup. The MATERIALIZING pass (`syllogise()`,
// below) is NEVER on the chat hot path — it only ever runs as the explicit
// `npx tmct syllogise` batch job. The PURE kernels it's built from
// (`deriveSubClassClosure`/`deriveTypePropagation`) are plain, I/O-free
// functions, so a caller may also reuse them for a small, bounded, READ-ONLY
// live check (e.g. chat.mjs's ISA proof chase, PLAN_INFERENCE_TESTING.md
// INF-A2) without that being "the batch pass on the hot path" — nothing is
// written to memory unless `syllogise()` itself is called.
//
// Deliberately narrow (the plan's kill-criterion discipline): FIVE rules —
//   - scm-sco: rdfs:subClassOf transitivity — (a ⊑ b), (b ⊑ c) ⊨ (a ⊑ c).
//     The simplest OWL 2 RL rule, exactly what the ACE grammar's pattern 1
//     emits (`deriveSubClassClosure`).
//   - cax-sco: rdf:type propagation across a subClassOf chain — (x rdf:type
//     C), (C ⊑ … ⊑ D) ⊨ (x rdf:type D). The OWL 2 RL class-axiom rule that
//     completes scm-sco for INSTANCE membership (`deriveTypePropagation`).
//   - cax-dw: disjointness violation — (x rdf:type C1), (C1 owl:disjointWith
//     C2) ⊨ x is NOT of type C2, checked over C1's FULL ⊑-ancestor closure
//     (the ⊑-lift, PLAN_INFERENCE_TESTING.md §1 footnote²) — the first rule on
//     this ladder to produce a PROVABLE "no" rather than only "yes"/"unproven"
//     (`deriveDisjointViolations`, PLAN_INFERENCE_TESTING.md §4 stage 3).
//   - cls-svf1: someValuesFrom application — (x P y), (y rdf:type C2), (R
//     owl:onProperty P), (R owl:someValuesFrom C2) ⊨ (x rdf:type R) — anyone
//     who P's something of type C2 is of type R, the restriction CLASS
//     itself (OWL 2 RL Table 8's cls-svf1, W3C OWL 2 RL profile). Joins over
//     exactly the triple shape the ACE grammar's pattern 4 ("every N1 that
//     VERBs a N2 is a N3") already emits for its restriction node `R` (`R
//     rdf:type owl:Restriction`, `R owl:onProperty P`, `R owl:someValuesFrom
//     N2` — `src/grammar/ace.mjs`'s `parseRestriction`) — no representational
//     gap, this rule was simply never implemented. Deliberately scoped to
//     JUST cls-svf1 (the restriction-membership half): it does NOT chase the
//     further `owl:intersectionOf`/cls-int1 step pattern 4 ALSO emits (`(N1 ⊓
//     R) ⊑ N3`) — concluding the ORIGINAL worked example's "chat.mjs is a
//     suite" needs x typed in BOTH N1 and R, then intersection-membership,
//     then cax-sco across `⊑ N3`, three more rules deep. That composition is
//     a documented follow-up (PLAN_INFERENCE_TESTING.md §4 stage 4's
//     remaining scm-svf row), not attempted here (`deriveSomeValuesFromApplication`).
//   - scm-svf1: someValuesFrom restriction SUBSUMPTION — two INDEPENDENTLY
//     declared restrictions over the SAME property, whose filler classes are
//     ⊑-related, entail the restriction NODES are themselves ⊑-related (W3C
//     OWL 2 RL Table 9's scm-svf1 — confirmed, against the real downloaded
//     spec, a DISTINCT rule from scm-svf2, which needs `rdfs:subPropertyOf`
//     instead; tmct's ACE grammar has no way to teach property subsumption at
//     the batch pass in a follow-up build (this session): originally deferred
//     (INFBENCH's two drive points never touched the batch pass, so nothing
//     was lost by deferring), closed once a positive INFBENCH fixture case
//     (`c1ScmSvfApply`) existed to measure it against
//     (`deriveSomeValuesFromSubsumption`).
//
// The whole safety story is four guards, all mechanical, shared by all five rules:
//   - BUDGET — at most `budget` NEW derivations per pass (default 50), and at
//     most `depth` fixpoint rounds (scm-sco only — cax-sco/cax-dw need no
//     fixpoint, see their own doc comments). The pass stops at whichever bites
//     first, deterministically (candidates are sorted before truncation).
//   - FOCUS — when a focus set is given (the fold hands us the just-touched class
//     footprint), a derivation is admitted only if it touches focus (a, the pivot
//     b, or c ∈ focus — "focus-connected, one step out"). No focus ⇒ whole graph
//     (the explicit `npx tmct syllogise` batch pass).
//   - SCREENS — tautology (a ⊑ a / x:x is never written) and dedup (a derivation
//     that already exists, stated OR previously entailed, is skipped via its
//     content key — the same novelty test appendFact's content-hash id enforces).
//
// Every derived fact is written via appendFacts with `entailed:subClassOf`
// (scm-sco), `entailed:type` (cax-sco), `entailed:disjointWith` (cax-dw),
// `entailed:someValuesFrom` (cls-svf1), or `entailed:someValuesFromSubsumption`
// (scm-svf1) provenance (a first-class entailed Source, trust prior 0.3 in
// memory/trust.mjs) so it is LOW trust, NEVER outranks a stated fact, and is
// fully RETRACTABLE by provenance when the source graph moves. cax-dw's,
// cls-svf1's, and scm-svf1's conclusions additionally ride trust.mjs's
// entailed hook when their OWN premises are resolvable in the pre-pass
// snapshot — premise-derived (`min(premiseTrusts) × ruleConfidence`), still
// always strictly below its weakest premise (see syllogise()'s own doc
// comment) — rather than the bare entailed floor; scm-sco/cax-sco do not
// (yet) engage that hook — see syllogise()'s doc comment for why that
// specific extension is non-trivial.
//
// TWO MORE capabilities live below (PLAN_INFERENCE_TESTING.md §4 stage 4's
// remainder, INF-C1), both LIVE-CHASE ONLY — never added to `syllogise()`'s own
// materializing batch pass (documented as a deliberate design choice at each
// export's own doc comment, not an oversight — see each one for the specific
// reason: neither is an enumerable "derive every new fact of this shape"
// closure the way the five rules above are):
//   - cardinality monotonicity: a class's OWN declared exactly/min cardinality
//     restriction (n) proves "at least m" for any QUERIED m ≤ n. Confirmed
//     OUTSIDE OWL 2 RL's own decidable profile (the spec's own `cls-*` rule
//     table has no rule comparing exactly/min/max cardinalities to each
//     other, and the profile's syntactic restriction limits cardinality
//     expressions to 0 or 1 only) — genuinely LIVE-CHASE ONLY, never a
//     candidate for the batch pass at all, not merely deferred
//     (`proveCardinalityAtLeast`).
//   - cax-maxc0: max-cardinality-0 as encoded negation. Grounded in W3C OWL 2
//     RL's real `cls-maxc1` rule (an ABox contradiction: asserting a specific
//     individual has a value for a max-0-restricted property is
//     inconsistent) via a one-step universal generalization — since ANY
//     witnessed individual would be a contradiction, no true witness can
//     exist, so a general "no" is provable without needing one
//     (`proveMaxCardinalityZeroDenial`).

import { loadMemory, appendFacts, readFactRows, normFactTerm, factIdForTriple, removeFacts } from "./memory/core.mjs";

/** scm-sco: the subClassOf-transitivity rule, and the provenance tag its
 *  conclusions carry. */
export const SUBCLASS_PREDICATE = "rdfs:subClassOf";
export const SYLLOGISE_RULE = "subClassOf";
export const ENTAILED_PROVENANCE = `entailed:${SYLLOGISE_RULE}`;

/** cax-sco: the type-propagation rule, and the provenance tag its conclusions
 *  carry (PLAN_INFERENCE_TESTING.md §4 stage 1). */
export const TYPE_PREDICATE = "rdf:type";
export const CAX_SCO_RULE = "type";
export const ENTAILED_TYPE_PROVENANCE = `entailed:${CAX_SCO_RULE}`;

/** cax-dw: x rdf:type C1, C1 owl:disjointWith C2 |= x is NOT of type C2 - a
 *  provable "no", never a guessed one (PLAN_INFERENCE_TESTING.md S4 stage 3,
 *  INF-B1). The conclusion is materialized on the SAME owl:disjointWith
 *  predicate the ACE grammar's pattern 6 ("no N1 is a N2") already emits
 *  class-to-class - chat.mjs's FACT_PREDICATE_PHRASES already renders it "is
 *  not a" for either shape, so an instance-level disjointWith fact reads
 *  correctly ("redis.mjs is not a queue") with no new phrase table entry
 *  needed. */
export const DISJOINT_PREDICATE = "owl:disjointWith";
export const CAX_DW_RULE = "disjointWith";
export const ENTAILED_DISJOINT_PROVENANCE = `entailed:${CAX_DW_RULE}`;
/** trust.mjs's entailed hook's rule-confidence for cax-dw, deliberately < 1
 *  (see syllogise()'s toWrite mapping): keeps a premise-derived conclusion
 *  STRICTLY below its weakest premise's trust, every time, honouring this
 *  module's "never outranks a stated fact" invariant while still riding well
 *  above the bare entailed prior (memory/trust.mjs SOURCE_PRIOR.entailed). */
export const CAX_DW_RULE_CONFIDENCE = 0.95;

/** cls-svf1: x P y, y rdf:type C2, R owl:onProperty P, R owl:someValuesFrom
 *  C2 |= x rdf:type R — anyone who P's something of type C2 is of type R,
 *  the restriction CLASS itself (OWL 2 RL Table 8's cls-svf1, PLAN_INFERENCE
 *  _TESTING.md S1 INF-B2, S4 stage 4). Joins over the SAME `owl:Restriction`/
 *  `owl:onProperty`/`owl:someValuesFrom` triple shape the ACE grammar's
 *  pattern 4 already emits for "every N1 that VERBs a N2 is a N3"
 *  (`src/grammar/ace.mjs`'s `parseRestriction`) - no new representational
 *  work, this rule simply consumes triples the grammar was already writing.
 *  `owl:onProperty`'s object and a taught property edge's PREDICATE are
 *  stored in two different casings today (a stored fact's predicate keeps
 *  its raw vocabulary spelling, e.g. "tmct:imports"; a triple's OBJECT slot -
 *  which is what `owl:onProperty`'s value occupies - is normFactTerm'd down
 *  to "imports" at write time, `memory/core.mjs` `appendFact`) - the pure
 *  kernel below normFactTerm's the raw predicate itself before comparing, so
 *  both sides converge on the same spelling without a special case. */
export const ON_PROPERTY_PREDICATE = "owl:onProperty";
export const SOME_VALUES_FROM_PREDICATE = "owl:someValuesFrom";
export const CLS_SVF1_RULE = "someValuesFrom";
export const ENTAILED_SVF1_PROVENANCE = `entailed:${CLS_SVF1_RULE}`;
/** trust.mjs's entailed hook's rule-confidence for cls-svf1 - the same
 *  sub-1 discount cax-dw uses and for the identical reason (see
 *  CAX_DW_RULE_CONFIDENCE's own comment): keeps a premise-derived conclusion
 *  STRICTLY below its weakest premise's trust, every time. */
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

/**
 * PURE `min(premiseTrusts) × ruleConfidence` — the entailed hook's own core
 * arithmetic (memory/trust.mjs `computeTrust`), exposed here so a caller that
 * has NO Fact/appendFacts call to delegate to (a LIVE, read-only chat proof
 * chase — chat.mjs's scm-svf1/cardinality-monotonicity/cax-maxc0 call sites)
 * can still compute the SAME premise-derived figure `computeTrust` would land
 * on for a materialized fact (recency sits at ~1.0 for a freshly-derived
 * conclusion, so the two agree). `syllogise()`'s own `appendFacts` mapping
 * does NOT call this — it hands `premiseTrusts`/`ruleConfidence` straight to
 * `appendFacts` → `computeTrust`, which ALSO applies the recency nudge; this
 * helper is for the read-only case that has no Fact to nudge. Returns `null`
 * when no numeric premise trust was supplied (nothing to compute from — never
 * a magic default), else clamped to [0,1]. Pure, no I/O.
 */
export function entailedTrustFrom(premiseTrusts, ruleConfidence = 1) {
  const nums = (Array.isArray(premiseTrusts) ? premiseTrusts : []).filter((t) => typeof t === "number");
  if (!nums.length) return null;
  const clamped = Math.max(0, Math.min(1, Math.min(...nums) * ruleConfidence));
  // rounded to 6dp — mirrors memory/trust.mjs's own `round(n, 6)` convention,
  // so a live-chase figure reads identically to what computeTrust would have
  // stored had this conclusion been persisted.
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
 * cax-dw ⊑-lift, PLAN_INFERENCE_TESTING.md §1 footnote²) shares ONE closure
 * walk instead of three near-identical ones. Pure, no I/O.
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
 * C), (C ⊑ … ⊑ D) ⊨ (x rdf:type D). `typeEdges` ([[x,C], …]) and
 * `subClassEdges` ([[a,b], …]) are both already-normalized term pairs —
 * exactly `deriveSubClassClosure`'s edge shape, just filtered by predicate.
 * `subClassEdges` is closed HERE (a full ancestor walk per class, memoized —
 * `buildAncestorCloser`, above), so a single call sees the WHOLE taught
 * ⊑-chain a class sits in, not just its immediate superclass — no fixpoint
 * rounds are needed (unlike `deriveSubClassClosure`, which must re-scan as
 * ITS OWN relation grows; `subClassEdges` here is a fixed input, never
 * mutated by this function).
 * Returns ONLY new `{ subject, object, via }` conclusions (`via` = the
 * subject's directly-taught type), bounded by `budget`, focus-filtered,
 * tautology- and dedup-screened, deterministic order. No I/O.
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
 * PURE cax-dw: x rdf:type C1, C1 owl:disjointWith C2 |= x is NOT of type C2 -
 * a provable "no" (PLAN_INFERENCE_TESTING.md S1 INF-B1, S4 stage 3), never a
 * guessed one: a pair this rule cannot connect through a stated disjointness
 * is simply not returned (never asserted "no" by absence - that "cannot be
 * proven" answer shape is the CALLER's job, chat.mjs, not this kernel's).
 *
 * Includes the S1 footnote2 lift ("B1's hardest cell"): x in mock, mock ⊑
 * fixture, fixture disjointWith test |= x not-in test - disjointness is
 * checked over `c`'s FULL ⊑-ancestor closure (`buildAncestorCloser`, shared
 * with `deriveTypePropagation` - reused, not reimplemented), not merely `x`'s
 * direct stated type. `disjointEdges` ([[c1,c2], …]) is the OWL-symmetric
 * relation as taught ("no cache is a queue" stores one directed [cache,
 * queue] row - disjointness has no preferred direction, so both orderings
 * are treated as the same fact here) and also doubles as this rule's OWN
 * idempotency ledger: a caller that re-feeds a prior pass's own entailed
 * instance-level disjointWith rows back in through `disjointEdges` (exactly
 * how `syllogise()` re-reads `readFactRows` every call) gets them skipped by
 * the same dedup/novelty screen below, with no separate "already derived"
 * bookkeeping needed.
 *
 * Returns ONLY new `{ subject, object, viaType, viaClass }` conclusions -
 * `viaType` is `x`'s directly-taught type, `viaClass` is the specific class
 * in that type's ⊑-closure (itself, for a direct hit, or an ancestor, for the
 * lift) the disjointness was actually asserted against - bounded by `budget`,
 * focus-filtered, tautology- and dedup-screened, deterministic order. No I/O.
 */
export function deriveDisjointViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
  const ancestorsOf = buildAncestorCloser(subClassEdges);

  // disjointWith is symmetric (OWL semantics: C1 disjointWith C2 |= C2
  // disjointWith C1), so both directions of every taught/prior-entailed pair
  // are indexed. `presentPairs` doubles as the dedup/novelty screen (see
  // above) - it is deliberately NOT split by "class-class taught" vs
  // "instance-class entailed": the predicate is the same either way, and a
  // synthetic individual term never collides with a class-noun term in this
  // domain (CODE_REF individuals always contain one of `. / \ # : @`).
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
    // hit needs no lift (d === c), the S1 footnote2 case needs one hop or more.
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
 * owl:someValuesFrom C2 |= x rdf:type R (OWL 2 RL Table 8's cls-svf1,
 * PLAN_INFERENCE_TESTING.md S1 INF-B2, S4 stage 4) - see this module's
 * header comment for the deliberate scope line (stops at restriction
 * membership, does not chase the further owl:intersectionOf/cls-int1 step
 * pattern 4 also emits).
 *
 * `propertyEdges` ([[x, predicate, y], …], `predicate` the RAW, un-normalized
 * vocabulary spelling exactly as a stored Fact's predicate reads, e.g.
 * "tmct:imports") is every taught/prior-entailed object-property assertion —
 * `syllogise()` builds this from every stored row whose predicate is NOT one
 * of the other three rules' reserved predicates (RESERVED_PREDICATES, above),
 * so ANY declared object property is a candidate, not just one hard-coded
 * verb. `typeEdges`/`subClassEdges` are the same shape `deriveTypePropagation`/
 * `deriveDisjointViolations` take (already-normalized [x,C] / [a,b] pairs);
 * `y`'s type is lifted through its FULL ⊑-ancestor closure (`buildAncestorCloser`,
 * shared machinery, same ⊑-lift discipline as cax-dw's own footnote2 case) so
 * "y is a mock" still satisfies a restriction declared over "fixture" when
 * mock⊑fixture is taught. `restrictionEdges` ([{ restriction, property,
 * target }, …], `property`/`target` already normFactTerm-normalized — the
 * spelling `owl:onProperty`/`owl:someValuesFrom` rows store their OBJECT in)
 * is every restriction node's (P, C2) declaration, reconstructed by joining
 * a restriction's `owl:onProperty` row with its `owl:someValuesFrom` row on
 * the restriction's own subject — exactly `syllogise()`'s own join, exposed
 * here as a plain parameter so the pure kernel stays I/O-free and unit-
 * testable without a memory store.
 *
 * Returns ONLY new `{ subject, object, viaProperty, viaPropertyKey, viaValue,
 * viaType, viaTarget }` conclusions — `object` is the restriction node R
 * itself (the newly-entailed rdf:type value), `viaProperty` the RAW predicate
 * matched, `viaPropertyKey` its normalized form (R's own `owl:onProperty`
 * value), `viaValue` the property's object `y`, `viaType` the specific class
 * `y` was directly taught as, `viaTarget` the class in that type's
 * ⊑-closure the restriction was actually declared against (itself, for a
 * direct hit, or an ancestor, for the lift) — bounded by `budget`,
 * focus-filtered, tautology- and dedup-screened, deterministic order. No I/O.
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
// "every N1 has exactly n N2s" already stores `{N1, rdfs:subClassOf, r}` as a
// plain row (`r = tmct:exactly-N-n2`) plus the restriction node r's own
// scaffolding: `r owl:onProperty tmct:has`, `r <kind> "n"` (kind one of
// owl:cardinality/owl:minCardinality/owl:maxCardinality), `r owl:onClass N2`
// (`src/grammar/ace.mjs`'s `parseCardinality`, ~lines 234-257) — the SAME
// per-fact storage discipline `deriveSomeValuesFromApplication`'s
// `restrictionEdges` already reconstructs for someValuesFrom restrictions,
// applied to pattern 5's shape instead.
const HAS_PROPERTY_KEY = "has"; // the fixed synthetic marker property parseCardinality always mints (ace.mjs ~line 252) — never a real taught verb, so it doubles as this reconstruction's own defensive filter (see buildCardinalityRestrictions below): a someValuesFrom restriction's onProperty is always a REAL taught verb, never this literal marker.
const CARDINALITY_KIND_OF = { "owl:cardinality": "exactly", "owl:mincardinality": "min", "owl:maxcardinality": "max" };
export const ON_CLASS_PREDICATE = "owl:onClass";

/** Reconstructs pattern-5 cardinality restriction records from raw stored
 *  rows touching a restriction node — same reconstruction discipline
 *  `deriveSomeValuesFromApplication` already uses for someValuesFrom
 *  restrictions, applied to pattern 5's shape instead. `rows` is the same
 *  `[{subject,predicate,object}, …]` shape `readFactRows`/`syllogise()`'s own
 *  `rows` param takes (raw predicate casing, already-normalized subject/
 *  object) — a caller may hand it EVERY stored row (this function ignores
 *  anything that isn't one of the four predicates it cares about) or a
 *  pre-filtered subset. A restriction is only admitted when its OWN
 *  `owl:onProperty` row resolves to `HAS_PROPERTY_KEY` — the defensive belt
 *  that keeps a someValuesFrom restriction's scaffolding (which ALSO uses
 *  `owl:onProperty`, just with a real verb) from ever being mistaken for a
 *  cardinality restriction when both kinds' rows are scanned together (e.g.
 *  chat.mjs's live wiring, which reads the whole taught-fact set at once).
 *  Returns `[{ restriction, kind, n, onClass }, …]`, deterministic order
 *  (sorted by restriction id). Pure, no I/O. */
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

// ---- scm-svf1: someValuesFrom restriction subsumption (W3C OWL 2 RL Table 9,
// scm-svf1 — confirmed distinct from scm-svf2, which needs property
// subsumption tmct can't teach yet, see this file's header comment) ----
export const SCM_SVF_RULE = "someValuesFromSubsumption";
export const ENTAILED_SCM_SVF_PROVENANCE = `entailed:${SCM_SVF_RULE}`;
/** trust.mjs's entailed hook's rule-confidence for scm-svf1 — the same sub-1
 *  discount cax-dw/cls-svf1 use and for the identical reason (see
 *  CAX_DW_RULE_CONFIDENCE's own comment): keeps a premise-derived conclusion
 *  STRICTLY below its weakest premise's trust, every time. Wired into
 *  `syllogise()`'s own materializing pass (below) — scm-svf1 joined the batch
 *  pass in a follow-up build, see this file's header comment. */
export const SCM_SVF_RULE_CONFIDENCE = 0.95;

/**
 * PURE scm-svf1: c1 someValuesFrom y1, c1 onProperty p, c2 someValuesFrom y2,
 * c2 onProperty p, y1 ⊑ y2 (lifted through y1's FULL ⊑-ancestor closure, same
 * lift discipline as cax-dw/cls-svf1) |= c1 ⊑ c2 — a schema-level fact about
 * the restriction NODES themselves, TWO independently-declared restrictions
 * being required to compare (unlike cardinality monotonicity/cax-maxc0 below,
 * each sufficient from a SINGLE declared restriction). `restrictionEdges` is
 * the SAME `[{ restriction, property, target }, …]` shape
 * `deriveSomeValuesFromApplication` already takes (`property`/`target`
 * already normFactTerm-normalized); `subClassEdges` is the ordinary
 * `[[a,b], …]` shape every other rule in this file takes, a FIXED input never
 * mutated by this function (so no fixpoint rounds are needed, same reasoning
 * as `deriveTypePropagation`'s own doc comment). Restrictions are grouped by
 * their (normalized) property — only restrictions sharing the SAME property
 * are ever compared, matching the rule's own premise shape (`c1 onProperty p`,
 * `c2 onProperty p`, the SAME p).
 *
 * Deliberately LIVE-CHASE ONLY for this build (see this file's header
 * comment): never added to `syllogise()`'s materializing batch pass.
 *
 * Returns ONLY new `{ subject, object, viaY1, viaY2 }` conclusions (`subject`/
 * `object` are the two restriction node ids, `viaY1`/`viaY2` the specific
 * filler classes whose ⊑-relation licensed it), bounded by `budget`,
 * focus-filtered, tautology- and dedup-screened, deterministic order. No I/O.
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
// single-premise-sufficient (no SECOND independently-taught restriction
// needed, unlike scm-svf1 above) — a class's OWN declared cardinality
// restriction, walked through its FULL ⊑-ancestor closure (same lift
// discipline as every other rule in this file). ----

/** Shared bounded proof search for `proveCardinalityAtLeast`/
 *  `proveMaxCardinalityZeroDenial`: walks `subject`'s OWN ⊑-ancestor closure
 *  (itself first, then ancestors — the FULL lift, same discipline as cax-dw/
 *  cls-svf1) looking for a class with a DIRECTLY declared cardinality
 *  restriction satisfying `matches(record)`. `cardinalityRestrictionEdges` is
 *  `buildCardinalityRestrictions`'s own output shape. Returns the first
 *  `{ viaClass, viaRestriction, record }` found (deterministic — the ancestor
 *  walk's order is fixed for a given edge set) or null. `budget` bounds how
 *  many candidate classes (subject + ancestors) are examined, a QUERY-rooted
 *  proof search in the same spirit as `findIsaChain`'s `maxHops`, not a
 *  batch-derivation cap. Pure, no I/O. */
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

// ---- cardinality monotonicity (confirmed OUTSIDE OWL 2 RL's own decidable
// profile, see this file's header comment) ----
export const SCM_CARD_RULE = "cardinalityMonotonicity";
/** trust.mjs's entailed hook's rule-confidence for cardinality monotonicity —
 *  the same sub-1 discount every other rule on this ladder uses (see
 *  CAX_DW_RULE_CONFIDENCE's own comment). Unlike CAX_DW_RULE_CONFIDENCE/
 *  CLS_SVF1_RULE_CONFIDENCE/SCM_SVF_RULE_CONFIDENCE, this constant has no
 *  `syllogise()`/`appendFacts` call site to feed: `proveCardinalityAtLeast` is
 *  QUERY-rooted (see its own doc comment) and never produces an enumerable
 *  Fact for the entailed hook to score — there is no `mgx:trustScore` for this
 *  rule's answer to carry. Defined here anyway, for the same reason every
 *  other rule-confidence constant is a named export rather than an inline
 *  literal: chat.mjs's LIVE proof chase (the only caller) computes and
 *  attaches a `min(premiseTrusts) × ruleConfidence` figure to its OWN answer
 *  for auditability (`entailedTrustFrom`, below), even though today's answer
 *  plumbing does not yet surface it past that one function's return value. */
export const CARDINALITY_RULE_CONFIDENCE = 0.95;

/**
 * PURE: given one class `subject`'s OWN declared cardinality restriction
 * (kind ∈ {exactly,min}, n, onClass — lifted through `subject`'s FULL
 * ⊑-ancestor closure, so an inherited restriction counts too) and a QUERIED
 * (`onClass`, `m`), proves "`subject` has at least `m` `onClass`" whenever
 * `onClass` matches and `n ≥ m`. A bounded, QUERY-rooted proof (there is no
 * fixed enumerable "new fact" to write — `m` is query-specific, a different
 * shape than every derivation-producing rule above) — genuinely LIVE-CHASE
 * ONLY (see this file's header comment: this is outside OWL 2 RL's own
 * profile, and unlike scm-svf1, this one has no enumerable fact shape to ever
 * join the batch pass — not merely deferred).
 *
 * Returns the witnessing `{ subject, object: onClass, m, n, kind, viaClass,
 * viaRestriction }` or null (`viaClass` is the specific class in `subject`'s
 * ⊑-closure the restriction was actually declared against — itself, for a
 * direct hit, or an ancestor, for the lift). No I/O.
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
/** trust.mjs's entailed hook's rule-confidence for cax-maxc0 — same sub-1
 *  discount, same reason (CAX_DW_RULE_CONFIDENCE's own comment). Same caveat
 *  as CARDINALITY_RULE_CONFIDENCE just above: `proveMaxCardinalityZeroDenial`
 *  is QUERY-rooted and never produces an enumerable Fact either, so there is
 *  no `mgx:trustScore` for this rule to carry — chat.mjs's LIVE proof chase
 *  computes and attaches the `min(premiseTrusts) × ruleConfidence` figure to
 *  its own answer for auditability (`entailedTrustFrom`, below). */
export const CAX_MAXC0_RULE_CONFIDENCE = 0.95;

/**
 * PURE: `subject` ⊑ r (lifted through `subject`'s FULL ⊑-ancestor closure), r
 * a maxCardinality-0 restriction (property `has`, onClass `onClass`) |= "no
 * `subject` has a `onClass`" — the universal-generalization bridge from
 * `cls-maxc1`'s per-individual ABox contradiction (asserting a witnessed
 * individual would be inconsistent) to a class-level provable negative: since
 * NO witness can exist without contradiction, the general "no" is sound.
 * Same query-rooted, LIVE-CHASE-ONLY scope as `proveCardinalityAtLeast`
 * (never `syllogise()`'s batch pass). NEVER infers "no" from absence — a
 * subject with no declared max-0 restriction at all simply returns null
 * (matching cax-dw's own discipline, `deriveDisjointViolations`'s doc
 * comment above).
 *
 * Returns `{ subject, object: onClass, viaClass, viaRestriction }` or null
 * (`viaClass` — itself, for a direct hit, or an ancestor, for the lift). No
 * I/O.
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
 * PURE consistency checker (PLAN_INFERENCE_TESTING.md S1 INF-C2, S4 stage 5):
 * detects when a SINGLE subject's own already-asserted types contradict each
 * other — x rdf:type C1, x rdf:type C2, C1 owl:disjointWith C2 (checked over
 * BOTH types' FULL ⊑-ancestor closures, the same lift `deriveDisjointViolations`
 * uses) — a REFUSE-worthy clash, not a "no" to derive and move on from. This is
 * a fundamentally different shape than cax-dw: cax-dw asks "can I derive a NO
 * for an UNASSERTED type"; this asks "do X's OWN taught/entailed types already
 * clash with each other" — every stored belief about a contradictory subject is
 * suspect, not just the one pair being queried, so the caller's job (chat.mjs)
 * is to REFUSE to answer from that subject's memory at all, not to keep
 * answering everything except the one clashing pair.
 *
 * Returns ONLY the clashes found — `{ subject, classA, classB, viaA, viaB }`
 * (`viaA`/`viaB` are the specific taught types whose ⊑-closures actually
 * licensed the clash — itself, for a direct hit, or an ancestor, for the
 * lift) — bounded by `budget`, focus-filtered, deterministic order, DEDUPED
 * so a subject with N mutually-clashing types reports each unordered pair
 * once. No I/O; nothing is written — same read-only discipline as
 * `deriveDisjointViolations`'s own live chat-side use (chat.mjs's INF-B1
 * cax-dw chase).
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
 * Run one bounded speculative pass over the memory graph under `repoDir`
 * (the repo dir whose .tmct/memory/graph.json appendFact/loadMemory manage).
 * Reads the stored subClassOf, rdf:type, owl:disjointWith AND (for cls-svf1/
 * scm-svf1) owl:onProperty/owl:someValuesFrom + every other object-property
 * fact, forward-chains FIVE rules — scm-sco (⊑-transitivity) then cax-sco
 * (type propagation, seeing THIS pass's own scm-sco conclusions too, so a
 * fresh two-hop taught chain and its type propagation both materialize in one
 * call) then cax-dw (disjointness violations, seeing THIS pass's own scm-sco
 * AND cax-sco conclusions too) then cls-svf1 (someValuesFrom restriction
 * membership, also seeing the enlarged subClassOf set for its own ⊑-lift)
 * then scm-svf1 (restriction-to-restriction subsumption, seeing the SAME
 * enlarged subClassOf set — its own ⊑-lift over the two restrictions' filler
 * classes) — and materializes each NEW conclusion via `appendFacts` with
 * `entailed:subClassOf`/`entailed:type`/`entailed:disjointWith`/
 * `entailed:someValuesFrom`/`entailed:someValuesFromSubsumption` provenance +
 * trust (PLAN_INFERENCE_TESTING.md S4 stage 2's entailed hook:
 * `min(premiseTrusts) x ruleConfidence` when the conclusion's OWN premises
 * are resolvable in the pre-pass snapshot, falling back to the bare entailed
 * prior — memory/trust.mjs's SOURCE_PRIOR floor — when they are not, e.g. a
 * premise itself only exists because THIS SAME pass just derived it a round
 * earlier; still low, still never outranks a stated fact, just less
 * precisely premise-derived for that one case).
 *
 * opts:
 *   - depth   max fixpoint rounds (scm-sco chain growth), default 32
 *   - budget  max NEW derivations written this pass, SHARED across all five
 *             rules (scm-sco, then cax-sco, then cax-dw, then cls-svf1, then
 *             scm-svf1), default 50
 *   - focus   Set|array of class terms; when given, only derivations touching
 *             focus (subject, pivot, or object ∈ focus) are admitted. Omit for a
 *             whole-graph batch pass.
 *
 * Returns { derived: [{ id, subject, object, via, rule }], count, budget,
 * depth, truncated } — `truncated` flags that the budget may have capped the
 * pass. Deterministic, offline, side-effects only in .tmct/memory.
 */
export async function syllogise(repoDir, { depth = 32, budget = 50, focus = null } = {}) {
  const memory = await loadMemory(repoDir);
  const rows = readFactRows(memory);
  const subClassEdges = rows.filter((r) => isSubClassOf(r.predicate)).map((r) => [r.subject, r.object]);
  const typeEdges = rows.filter((r) => isType(r.predicate)).map((r) => [r.subject, r.object]);
  const disjointEdges = rows.filter((r) => isDisjoint(r.predicate)).map((r) => [r.subject, r.object]);
  // cls-svf1's own join inputs: a restriction's owl:onProperty and
  // owl:someValuesFrom rows, keyed by the restriction's OWN subject so the
  // two can be paired without a second graph pass; `propertyEdges` is every
  // OTHER stored fact (any predicate not one of the three rules' reserved
  // predicates above) — a taught object-property assertion is a candidate
  // premise for whichever restriction (if any) was declared over its
  // predicate, never hard-coded to one verb.
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

  // Pre-pass trust snapshot, keyed by exact (subject, predicate, object) —
  // the entailed hook's premiseTrusts lookup, wired for cax-dw ONLY (see the
  // dwDerived mapping below). scm-sco/cax-sco deliberately stay on the bare
  // entailed prior here: a spike wiring premiseTrusts through them the same
  // way broke three PINNED tests (test/syllogise.test.mjs's own "entailed
  // trust is low"/"never outranks its stated premise" assertions,
  // test/memory-fold.test.mjs's "entailed facts carry speculative trust") —
  // with `ruleConfidence` defaulting to 1, `min(premiseTrusts) × 1` can EQUAL
  // a stated premise's trust (e.g. two operator-taught 1.0 premises → 1.0),
  // which ties or outranks the very premise it was derived from, violating
  // this module's own "NEVER outranks a stated fact" invariant (its own
  // header comment, and the KILL CRITERION test). Fixing that for scm-sco/
  // cax-sco needs the same sub-1 `ruleConfidence` discount cax-dw uses below
  // (or an equivalent design decision) — real, but a separate, deliberate
  // follow-up, not a trivial addition (PLAN_INFERENCE_TESTING.md §4 stage 2
  // note left for the next pass). cax-dw is new — no pinned floor-trust tests
  // exist for it — so it is designed with the sub-1 discount from the start.
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
  // cax-dw sees the SAME enlarged subClassOf set (so its own ⊑-lift, S1
  // footnote2, reaches a chain scm-sco just grew this pass) — it does not
  // need the enlarged TYPE edge set too: it walks each direct type's full
  // ⊑-ancestor closure itself (deriveDisjointViolations' own doc comment).
  const remainingBudgetDw = Math.max(0, budget - scmDerived.length - caxDerived.length);
  const dwDerived = remainingBudgetDw > 0
    ? deriveDisjointViolations(typeEdges, enlargedSubClassEdges, disjointEdges, { budget: remainingBudgetDw, focus: normalizedFocus })
    : [];
  // cls-svf1 sees the SAME enlarged subClassOf set (its own ⊑-lift, mirroring
  // cax-dw's) — it deliberately does NOT see the enlarged type edge set: a
  // direct taught type on the property's VALUE is the common case (the B2
  // worked example), and enlarging risks a same-pass cax-sco conclusion on
  // `y` being consumed before a human can audit it; a documented scope line,
  // not an oversight (mirrors cax-dw's own "does not need the enlarged TYPE
  // edge set" choice, just for a different reason here).
  const remainingBudgetSvf1 = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length);
  const svf1Derived = remainingBudgetSvf1 > 0 && restrictionEdges.length
    ? deriveSomeValuesFromApplication(propertyEdges, typeEdges, enlargedSubClassEdges, restrictionEdges, { budget: remainingBudgetSvf1, focus: normalizedFocus })
    : [];
  // scm-svf1 sees the SAME enlarged subClassOf set (its own ⊑-lift over the
  // two restrictions' filler classes) and reuses the SAME restrictionEdges
  // just built for cls-svf1 above — needs at least two independently-declared
  // restrictions over one property to have anything to compare (the kernel's
  // own guard, `deriveSomeValuesFromSubsumption`'s doc comment).
  const remainingBudgetScmSvf = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length - svf1Derived.length);
  const scmSvfDerived = remainingBudgetScmSvf > 0 && restrictionEdges.length > 1
    ? deriveSomeValuesFromSubsumption(restrictionEdges, enlargedSubClassEdges, { budget: remainingBudgetScmSvf, focus: normalizedFocus })
    : [];
  // scm-svf1's own two structural premises per restriction (owl:onProperty /
  // owl:someValuesFrom) are looked up by restriction id — restrictionEdges
  // already carries each restriction's (property, target) pair, keyed the
  // same way `deriveSomeValuesFromSubsumption`'s own output does.
  const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));

  // Batched write: ONE mutateMemory pass for the whole pass's conclusions
  // (all five rules), not one appendFact per derived fact — appendFacts (the
  // appendUtterances-precedent batch path, memory/core.mjs) does the same
  // normalize+prose-tokenize+upsert work per fact but a SINGLE read-mutate-
  // write, so a pass with many derivations no longer pays per-fact I/O.
  // subject/object here are already-normalized terms straight off the stored
  // graph (readFactRows/deriveSubClassClosure/deriveTypePropagation/
  // deriveDisjointViolations never hand back an empty term), and predicate is
  // always one of the three fixed constants above, so appendFacts never skips
  // one of these — `ids` comes back exactly one-per-input, in order, safe to
  // zip positionally below.
  const toWrite = [
    ...scmDerived.map((d) => ({
      subject: d.subject, predicate: SUBCLASS_PREDICATE, object: d.object,
      provenance: ENTAILED_PROVENANCE,
      // PLAN_SYLLOGIST.md §3's persisted-justification step, scm-sco only: the
      // two premise fact ids THIS conclusion actually rode (a⊑b, b⊑c) — ids
      // are content-addressed (factIdForTriple/memory/core.mjs), so this works
      // whether the premise is a stated fact or another entailment this SAME
      // pass just derived a round earlier (its id is predictable before it's
      // even written). Read back by retractSubClassOf (below) to find every
      // entailment a retracted premise could have supported, without a
      // whole-graph re-scan.
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
        // ruleConfidence < 1 (CAX_DW_RULE_CONFIDENCE) is deliberate, not a
        // magic number: with the hook's default confidence of 1,
        // min(premiseTrusts) × 1 can EQUAL a premise's own trust (e.g. two
        // operator-taught 1.0 premises), tying/outranking the very premise it
        // came from — this module's invariant is "never outranks a stated
        // fact" (header comment), so cax-dw's conclusion is discounted
        // strictly below its weakest premise, always, while still riding
        // FAR above the bare 0.3 floor for a well-sourced premise pair.
        ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: CAX_DW_RULE_CONFIDENCE } : {}),
      };
    }),
    ...svf1Derived.map((d) => {
      // the restriction's own two structural premises (owl:onProperty /
      // owl:someValuesFrom rows) are stored with the restriction node as
      // SUBJECT and the (already-normalized) property/target as OBJECT —
      // premiseTrust's exact-triple lookup, so no extra normalization here.
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
      // each restriction's own two structural premises (owl:onProperty /
      // owl:someValuesFrom rows), for BOTH restrictions being compared, plus
      // the y1⊑y2 subClassOf premise that licensed the comparison — always
      // present here (unlike cax-dw/cls-svf1's optional lift premise): the
      // kernel's own tautology screen guarantees viaY1 !== viaY2 for every
      // derived scm-svf1 fact (`deriveSomeValuesFromSubsumption`'s doc comment).
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
 *  taught half is a real, independent reason to keep believing it (the trust-
 *  tier concern PLAN_SYLLOGIST.md §3 names: "must never touch a higher-trust
 *  taught-only derivation"). */
function isPurelyEntailed(provenance) {
  const tags = String(provenance || "").split(" | ").filter(Boolean);
  return tags.length > 0 && tags.every((t) => t.startsWith("entailed:"));
}

/**
 * PLAN_SYLLOGIST.md §3's first real, scoped retraction slice: JTMS-style
 * dependency-directed removal, for scm-sco ONLY (subClassOf transitivity —
 * this file's simplest rule, and §3's own worked example: "a premise later
 * disappears, what else must be un-believed?"). Deliberately NOT the fuller
 * ATMS §3 also sketches (tracking every alternate premise-SET per fact, "a
 * further, NOT-currently-planned step") — this tracks exactly ONE
 * justification per entailed fact (the premise pair it actually rode, set at
 * write time — syllogise()'s own toWrite mapping, above): the JTMS-shaped
 * step §3 names as missing today ("a JTMS-shaped single justification per
 * fact in spirit, though not yet a persisted, walkable one").
 *
 * Retracting `subject ⊑ object` (a STATED or a previously-ENTAILED fact —
 * either may be retracted) proceeds in bounded rounds:
 *   1. Remove the named fact.
 *   2. Scan stored entailed scm-sco facts (purely-entailed ones only —
 *      `isPurelyEntailed`, above) for any whose persisted justification cites
 *      an id removed so far — candidates.
 *   3. VERIFY, never assume: a candidate is removed only if `subject ⊑
 *      object` is NO LONGER reachable over the SURVIVING subClassOf edge set
 *      (a full ⊑-ancestor walk, `buildAncestorCloser` — the SAME shared
 *      machinery `deriveTypePropagation`/`deriveDisjointViolations` already
 *      reuse, not reimplemented here). A fact with a SECOND, independent
 *      derivation path survives — a real possibility scm-sco's transitive
 *      closure allows (a⊑b⊑d AND a⊑c⊑d both license a⊑d) — exactly the
 *      failure mode a bare "delete anything citing the retracted id" JTMS
 *      walk gets wrong, and precisely why de Kleer's ATMS exists at all (§3's
 *      own citation). This VERIFY step is this slice's cheap, bounded answer
 *      to that known JTMS over-retraction limitation: one local graph walk
 *      per candidate, never a full alternate-justification enumeration.
 *   4. Repeat: a fact confirmed-removed this round becomes a new cascade
 *      source for the next round (removing a mid-chain link can ripple).
 *
 * Bounded by `budget` (max facts examined+removed, default 50 — the SAME
 * default every other rule in this file uses) and `depth` (max cascade
 * rounds, default 32, mirroring `deriveSubClassClosure`'s own fixpoint cap).
 * `truncated` flags the cascade may have been cut short before reaching a
 * fixpoint (candidates still pending when budget/depth ran out) — the SAME
 * honest-signal discipline `syllogise()`'s own `truncated` flag follows: a
 * caller must not read a truncated cascade's survivors as "provably still
 * consistent," only as "not yet shown inconsistent within budget."
 *
 * Known, DELIBERATE scope limit (not a bug): this only ever touches scm-sco's
 * own entailed subClassOf facts. The other four rules (cax-sco/cax-dw/
 * cls-svf1/scm-svf1) do not yet persist a justification (none call
 * `factIdForTriple`/write `justification` — only `syllogise()`'s scmDerived
 * mapping does, above), so a type/disjointWith/someValuesFrom conclusion that
 * ALSO went stale when this same premise was retracted is not cascaded here.
 * Extending justification-tracking to the other four rules is mechanical
 * (each already computes a `via`/`viaX` pivot) but is a separate follow-up,
 * not attempted in this slice.
 *
 * Returns { retracted, count, budget, depth, truncated, found } — `retracted`
 * is every id actually removed (target first, then cascade order); `found`
 * is false (nothing else meaningful) when `subject ⊑ object` was never a
 * stored fact at all — an honest no-op, matching this module's "never guess"
 * discipline. No I/O beyond the one `removeFacts` call (skipped entirely when
 * `found` is false).
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
  // Only a purely-entailed scm-sco fact ever carries a walkable justification
  // (see syllogise()'s toWrite mapping + isPurelyEntailed, above) — every
  // other row's justification is [] (or the fact is also independently
  // taught, so it is EXCLUDED here even if it happens to carry a stale one),
  // so this candidate pool is naturally, correctly scoped.
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

    // The surviving edge set for THIS round's verify walk — DRed's own
    // "delete a superset, then selectively rederive" discipline (§3's own
    // citation, Gupta/Mumick/Subrahmanian 1993): every candidate's OWN edge
    // is excluded too, alongside every OTHER candidate under suspicion this
    // SAME round, not just `removed` — otherwise a candidate would trivially
    // "reach itself" through its own not-yet-deleted edge (or lean on a
    // sibling candidate that is itself only standing on the same broken
    // premise), understating what actually still needs re-verifying. A
    // candidate that reaches its target through some OTHER, untouched edge
    // (a genuinely independent derivation path this fact's single persisted
    // justification never recorded) correctly survives.
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
 * PROOF SEARCH (not a third rule — a bounded ROOTED chase that composes the
 * two rules above for a single "does `subj` reach one of `targets`?" query,
 * PLAN_INFERENCE_TESTING.md §4 stage 2's proof-chain substrate). Unlike
 * `deriveSubClassClosure`/`deriveTypePropagation` — which each compute a
 * WHOLE-GRAPH closure and then focus/budget-filter the result (so an
 * unrelated derivation that merely TOUCHES the focus term as a pivot or
 * object can still fill the budget before the one the caller actually wants)
 * — this walks OUTWARD from `subj` only, breadth-first, stopping the instant
 * a target is reached. That makes it safe to call live, per query, even over
 * a large (e.g. corpus-seeded) fact store: cost is bounded by `subj`'s own
 * reachable set and `maxHops`, never by how many OTHER classes the store
 * happens to know about.
 *
 * The first hop may be EITHER a taught type edge (cax-sco: `subj rdf:type
 * C`) OR a taught subClassOf edge (scm-sco: `subj ⊑ C`) — `subj` may be an
 * individual or a class. Every hop after the first is subClassOf-only (once
 * "in" a class, propagation continues up the class hierarchy). Returns the
 * shortest chain as an ordered `[{ subject, predicate, object }, …]` premise
 * list (each already a stored fact — the caller cites its provenance), or
 * null when no chain reaches `targets` within `maxHops`. Pure, no I/O,
 * deterministic given the same edge lists.
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
  // one hop beyond it (an earlier version's separate post-loop check did
  // exactly that off-by-one — fixed here, regression-tested below).
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
