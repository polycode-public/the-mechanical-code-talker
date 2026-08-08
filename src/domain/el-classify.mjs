// el-classify.mjs — the EL saturation classifier: ELK-style normal forms plus
// the seven completion rules from Baader, Brandt and Lutz, "Pushing the EL
// Envelope" (IJCAI 2005). Offline, deterministic, polynomial: normalizes the
// stored TBox to four normal forms, then forward-chains the completion rules
// to a fixpoint. Same operational shape as syllogise.mjs's own materialising
// pass — a batch job off the hot path, budget and round caps, focus scoping,
// conclusions written under entailed:el-* provenance, retractable because a
// purely-entailed fact is deleted and re-verified rather than trusted by
// citation alone.
//
// Reads five stored shapes into normal form (normalizeElTBox), saturates them
// (saturateEl), mints the goal axioms that let a query reach a class
// expression the graph never declared as a node (elGoalAxioms/elGoalFor),
// and materialises the result (classifyEl). classifyEl runs saturateEl twice:
// once over the plain TBox to learn each concept's real subsumer set, once
// more with goal axioms minted from that first pass added in, so a query like
// "does a heart have a flap" can be answered from a batch pass alone.

import { normFactTerm } from "./hash.mjs";
import {
  SUBCLASS_PREDICATE, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE, TYPE_PREDICATE,
  DEFAULT_MAX_ENVIRONMENTS, buildCardinalityRestrictions,
} from "./syllogise.mjs";

const SEP = "␟"; // an in-key separator no fact term can contain — same convention as syllogise.mjs's own SEP

/** The two reserved concept names every EL derivation is built from. Neither
 *  can collide with a stored term: normFactTerm never produces them from a
 *  class noun, and normalizeElTBox drops any row that literally names one. */
export const TOP = "top";
export const BOT = "bot";

function requireStore(store, needed, caller) {
  for (const name of needed) {
    if (typeof store?.[name] !== "function") {
      throw new TypeError(`${caller} needs a store option carrying { ${needed.join(", ")} } (memory/core.mjs's read/write functions) — missing ${name}`);
    }
  }
  return store;
}

/** Normalize a focus hint (Set|array of terms) into the same normalized-term
 *  space stored facts live in, or null for "no focus → whole graph". Local
 *  copy of syllogise.mjs's own private normalizeFocus — not exported there. */
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

const lower = (p) => String(p || "").trim().toLowerCase();
const isSubClassOf = (p) => lower(p) === "rdfs:subclassof";
const isType = (p) => lower(p) === "rdf:type";
const isDisjoint = (p) => lower(p) === "owl:disjointwith";
const isOnProperty = (p) => lower(p) === "owl:onproperty";
const isSomeValuesFrom = (p) => lower(p) === "owl:somevaluesfrom";
const isOnClass = (p) => lower(p) === "owl:onclass";
const isIntersectionOf = (p) => lower(p) === "owl:intersectionof";
const isSubPropertyOf = (p) => lower(p) === "rdfs:subpropertyof";
const CARDINALITY_PREDICATES = new Set(["owl:cardinality", "owl:mincardinality", "owl:maxcardinality"]);
const isCardinalityPredicate = (p) => CARDINALITY_PREDICATES.has(lower(p));

/**
 * Fold stored fact rows into normalized EL axioms. Pure, no I/O.
 * Returns { axioms, roleAxioms, concepts, roles, restrictionOf, truncated }.
 *
 * `concepts`/`roles` are the REAL names the graph already declares — every
 * subject/object a row actually carries, minus the synthetic intermediate
 * names an intersection fold mints (`${m1}-and-${m2}`) and minus "top"/"bot".
 * A synthetic fold name is scaffolding for the completion rules, never a
 * concept to seed CR0 with or to write back as a stored class.
 */
export function normalizeElTBox(rows, { budget = 500 } = {}) {
  const input = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.subject && r.predicate && r.object !== undefined && r.object !== null);
  const sorted = [...input].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const truncated = sorted.length > budget;
  const used = truncated ? sorted.slice(0, budget) : sorted;

  const concepts = new Set();
  const roles = new Set();
  const addConcept = (t) => { if (t && t !== TOP && t !== BOT) concepts.add(t); };

  // ---- pass 1: categorize every row, tracking the row itself (not just its
  // value) so an axiom's `from` can cite the real stored fact id it rode. ----
  const onPropertyRow = new Map();      // restriction node -> its owl:onProperty row
  const someValuesFromRow = new Map();  // restriction node -> its owl:someValuesFrom row
  const onClassRow = new Map();         // restriction node -> its owl:onClass row
  const cardinalityRow = new Map();     // restriction node -> its owl:{min,max,}cardinality row
  const intersectionRows = new Map();   // intersection node -> ordered [owl:intersectionOf row, …]
  const subClassRows = [];
  const disjointRows = [];
  const transitiveRoleRow = new Map();  // role -> first p rdf:type owl:TransitiveProperty row
  const subPropertyRows = [];

  for (const r of used) {
    if (r.subject === TOP || r.subject === BOT || r.object === TOP || r.object === BOT) continue; // reserved-name collision — drop, never crash
    const p = r.predicate;
    if (isOnProperty(p)) { onPropertyRow.set(r.subject, r); addConcept(r.subject); }
    else if (isSomeValuesFrom(p)) { someValuesFromRow.set(r.subject, r); addConcept(r.subject); addConcept(r.object); }
    else if (isOnClass(p)) { onClassRow.set(r.subject, r); addConcept(r.subject); addConcept(r.object); }
    else if (isCardinalityPredicate(p)) { cardinalityRow.set(r.subject, r); addConcept(r.subject); }
    else if (isIntersectionOf(p)) {
      if (!intersectionRows.has(r.subject)) intersectionRows.set(r.subject, []);
      intersectionRows.get(r.subject).push(r);
      addConcept(r.subject); addConcept(r.object);
    } else if (isSubClassOf(p)) { subClassRows.push(r); addConcept(r.subject); addConcept(r.object); }
    else if (isDisjoint(p)) { disjointRows.push(r); addConcept(r.subject); addConcept(r.object); }
    else if (isType(p) && r.object === "transitiveproperty") {
      if (!transitiveRoleRow.has(r.subject)) transitiveRoleRow.set(r.subject, r);
      roles.add(r.subject);
    } else if (isSubPropertyOf(p)) { subPropertyRows.push(r); roles.add(r.subject); roles.add(r.object); }
  }

  // Someone-values-from restrictions (rule 2) and cardinality-as-existential
  // restrictions (rule 3, n>=1 min/exactly, reusing buildCardinalityRestrictions
  // so the HAS_PROPERTY_KEY gate and cardinality-kind table stay one definition).
  const someValuesFromRestrictions = new Set(
    [...onPropertyRow.keys()].filter((r) => someValuesFromRow.has(r)),
  );
  const restrictionOf = new Map(); // restriction node -> { role, filler }
  for (const r of someValuesFromRestrictions) {
    restrictionOf.set(r, { role: onPropertyRow.get(r).object, filler: someValuesFromRow.get(r).object });
  }
  const cardinalityAsExistential = new Map(); // restriction node -> filler class
  for (const rec of buildCardinalityRestrictions(used)) {
    if (rec.kind !== "min" && rec.kind !== "exactly") continue;
    if (!(rec.n >= 1)) continue;
    if (someValuesFromRestrictions.has(rec.restriction)) continue; // rule 2 already claimed it
    if (!onPropertyRow.has(rec.restriction) || !onClassRow.has(rec.restriction) || !cardinalityRow.has(rec.restriction)) continue;
    cardinalityAsExistential.set(rec.restriction, rec.onClass);
    restrictionOf.set(rec.restriction, { role: "has", filler: rec.onClass });
  }

  const intersectionNodes = new Set(intersectionRows.keys());
  const axioms = [];
  const intersectionTargetRow = new Map(); // intersection node -> its "I rdfsSubClassOf B" row

  for (const r of subClassRows) {
    const A = r.subject;
    const B = r.object;
    if (intersectionNodes.has(A)) {
      if (!intersectionTargetRow.has(A)) intersectionTargetRow.set(A, r); // first-wins, deterministic (sorted input)
      continue;
    }
    if (someValuesFromRestrictions.has(B)) {
      const { role, filler } = restrictionOf.get(B);
      const opRow = onPropertyRow.get(B);
      const svRow = someValuesFromRow.get(B);
      axioms.push({ form: "someRight", sub: A, role, filler, from: [r.id, opRow.id, svRow.id] });
      axioms.push({ form: "someLeft", role, filler, sup: B, from: [opRow.id, svRow.id] });
      continue;
    }
    if (cardinalityAsExistential.has(B)) {
      const filler = cardinalityAsExistential.get(B);
      const opRow = onPropertyRow.get(B);
      const ocRow = onClassRow.get(B);
      const cardRow = cardinalityRow.get(B);
      axioms.push({ form: "someRight", sub: A, role: "has", filler, from: [r.id, opRow.id, ocRow.id, cardRow.id] });
      axioms.push({ form: "someLeft", role: "has", filler, sup: B, from: [opRow.id, ocRow.id, cardRow.id] });
      continue;
    }
    axioms.push({ form: "sub", sub: A, sup: B, from: [r.id] });
  }

  // ---- intersection folds: I ⊓ … ⊑ B → a left-folded chain of binary NF2 axioms ----
  for (const [node, memberRows] of intersectionRows) {
    const targetRow = intersectionTargetRow.get(node);
    if (!targetRow) continue; // no "I rdfsSubClassOf B" row — nothing to derive
    const rowByMember = new Map(); // dedupe: first row per distinct member value
    for (const mr of memberRows) if (!rowByMember.has(mr.object)) rowByMember.set(mr.object, mr);
    const members = [...rowByMember.keys()].sort();
    if (members.length < 2) continue;

    let acc = members[0];
    let accFromIds = [rowByMember.get(members[0]).id];
    for (let i = 1; i < members.length; i += 1) {
      const m = members[i];
      const isLast = i === members.length - 1;
      const sup = isLast ? targetRow.object : `${acc}-and-${m}`;
      const subs = [acc, m].sort();
      const memberFrom = rowByMember.get(m).id;
      const from = isLast ? [...accFromIds, memberFrom, targetRow.id] : [...accFromIds, memberFrom];
      axioms.push({ form: "and", subs, sup, from });
      accFromIds = [...accFromIds, memberFrom];
      acc = sup;
    }
  }

  // ---- disjointness: EL⊥ ----
  for (const r of disjointRows) {
    axioms.push({ form: "and", subs: [r.subject, r.object].sort(), sup: BOT, from: [r.id] });
  }

  const roleAxioms = [];
  for (const role of [...transitiveRoleRow.keys()].sort()) {
    roleAxioms.push({ kind: "transitive", role, from: [transitiveRoleRow.get(role).id] });
  }
  for (const r of [...subPropertyRows].sort((a, b) => `${a.subject}${SEP}${a.object}`.localeCompare(`${b.subject}${SEP}${b.object}`))) {
    roleAxioms.push({ kind: "sub", sub: r.subject, sup: r.object, from: [r.id] });
  }

  return { axioms, roleAxioms, concepts, roles, restrictionOf, truncated };
}

// ---- the seven completion rules ----

const EMPTY_SET = new Set();

/**
 * Saturate the normalized TBox to a fixpoint. Pure, no I/O.
 * Returns { subsumers, roleEdges, unsatisfiable, derivationOf, rounds, truncated }.
 */
export function saturateEl(normalized, { budget = 2000, rounds = 64, focus = null } = {}) {
  const axioms = normalized?.axioms || [];
  const roleAxioms = normalized?.roleAxioms || [];
  const concepts = [...(normalized?.concepts || [])].sort();
  const focusSet = focus instanceof Set ? (focus.size ? focus : null) : normalizeFocus(focus);
  const inFocus = (...terms) => !focusSet || terms.some((t) => focusSet.has(t));

  const nf1BySub = new Map();        // sub -> [{ sup, from }]
  const nf2ByOperand = new Map();    // one operand -> [{ other, sup, from }] (both directions indexed)
  const nf3BySub = new Map();        // sub -> [{ role, filler, from }]
  const nf4ByRoleFiller = new Map(); // "role␟filler" -> [{ sup, from }]
  for (const ax of axioms) {
    if (ax.form === "sub") {
      if (!nf1BySub.has(ax.sub)) nf1BySub.set(ax.sub, []);
      nf1BySub.get(ax.sub).push({ sup: ax.sup, from: ax.from });
    } else if (ax.form === "and") {
      const [x1, x2] = ax.subs;
      for (const [self, other] of [[x1, x2], [x2, x1]]) {
        if (!nf2ByOperand.has(self)) nf2ByOperand.set(self, []);
        nf2ByOperand.get(self).push({ other, sup: ax.sup, from: ax.from });
      }
    } else if (ax.form === "someRight") {
      if (!nf3BySub.has(ax.sub)) nf3BySub.set(ax.sub, []);
      nf3BySub.get(ax.sub).push({ role: ax.role, filler: ax.filler, from: ax.from });
    } else if (ax.form === "someLeft") {
      const key = `${ax.role}${SEP}${ax.filler}`;
      if (!nf4ByRoleFiller.has(key)) nf4ByRoleFiller.set(key, []);
      nf4ByRoleFiller.get(key).push({ sup: ax.sup, from: ax.from });
    }
  }
  const roleSubRoles = new Map(); // role -> [{ sup, from }] (r ⊑ s)
  const transitiveRoles = new Set();
  const transitiveFrom = new Map();
  for (const ra of roleAxioms) {
    if (ra.kind === "sub") {
      if (!roleSubRoles.has(ra.sub)) roleSubRoles.set(ra.sub, []);
      roleSubRoles.get(ra.sub).push({ sup: ra.sup, from: ra.from });
    } else if (ra.kind === "transitive") {
      transitiveRoles.add(ra.role);
      if (!transitiveFrom.has(ra.role)) transitiveFrom.set(ra.role, ra.from);
    }
  }

  // CR0: every concept name gets itself and top — the worklist's seed, in
  // sorted concept order.
  const subsumers = new Map();
  for (const A of concepts) subsumers.set(A, new Set([A, TOP]));
  const roleEdges = new Map();      // role -> Set("A␟B")
  const subsumerProv = new Map();   // "A␟X" -> from[] (derivationOf, once genuinely derived)
  const roleEdgeProv = new Map();   // "role␟A␟B" -> from[]

  const subProv = (a, x) => (a === x ? [] : subsumerProv.get(`${a}${SEP}${x}`) || []);
  const roleProv = (role, edgeKey) => roleEdgeProv.get(`${role}${SEP}${edgeKey}`) || [];
  const dedupConcat = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const id of list || []) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };

  let committed = 0;
  let reachedFixpoint = false;
  let roundsRun = 0;
  for (let round = 0; round < rounds; round += 1) {
    roundsRun += 1;
    const additions = [];

    // CR1: A' ∈ S(A), NF1 A' ⊑ B ⊨ B ∈ S(A)
    for (const [A, xs] of subsumers) {
      for (const Xp of xs) {
        for (const { sup, from } of nf1BySub.get(Xp) || []) {
          if (xs.has(sup)) continue;
          if (!inFocus(A, Xp, sup)) continue;
          additions.push({ kind: "sub", A, X: sup, from: dedupConcat(subProv(A, Xp), from), sortKey: `1${SEP}${A}${SEP}${sup}${SEP}${Xp}` });
        }
      }
    }
    // CR2: A1,A2 ∈ S(A), NF2 A1⊓A2⊑B ⊨ B ∈ S(A)
    for (const [A, xs] of subsumers) {
      for (const X1 of xs) {
        for (const { other, sup, from } of nf2ByOperand.get(X1) || []) {
          if (!xs.has(other)) continue;
          if (xs.has(sup)) continue;
          if (!inFocus(A, X1, other, sup)) continue;
          additions.push({ kind: "sub", A, X: sup, from: dedupConcat(subProv(A, X1), subProv(A, other), from), sortKey: `2${SEP}${A}${SEP}${sup}${SEP}${[X1, other].sort().join(SEP)}` });
        }
      }
    }
    // CR3: A' ∈ S(A), NF3 A'⊑∃r.B ⊨ (A,B) ∈ R(r)
    for (const [A, xs] of subsumers) {
      for (const Xp of xs) {
        for (const { role, filler, from } of nf3BySub.get(Xp) || []) {
          const edgeKey = `${A}${SEP}${filler}`;
          if ((roleEdges.get(role) || EMPTY_SET).has(edgeKey)) continue;
          if (!inFocus(A, Xp, filler)) continue;
          additions.push({ kind: "role", role, A, B: filler, from: dedupConcat(subProv(A, Xp), from), sortKey: `3${SEP}${role}${SEP}${A}${SEP}${filler}${SEP}${Xp}` });
        }
      }
    }
    // CR4: (A,B) ∈ R(r), B' ∈ S(B), NF4 ∃r.B'⊑C ⊨ C ∈ S(A)
    for (const [role, edges] of roleEdges) {
      for (const edgeKey of edges) {
        const [A, B] = edgeKey.split(SEP);
        const bSubsumers = subsumers.get(B) || EMPTY_SET;
        for (const Bp of bSubsumers) {
          for (const { sup, from } of nf4ByRoleFiller.get(`${role}${SEP}${Bp}`) || []) {
            const aSet = subsumers.get(A);
            if (!aSet || aSet.has(sup)) continue;
            if (!inFocus(A, B, Bp, sup)) continue;
            additions.push({ kind: "sub", A, X: sup, from: dedupConcat(roleProv(role, edgeKey), subProv(B, Bp), from), sortKey: `4${SEP}${A}${SEP}${sup}${SEP}${role}${SEP}${B}${SEP}${Bp}` });
          }
        }
      }
    }
    // CR5: (A,B) ∈ R(r), bot ∈ S(B) ⊨ bot ∈ S(A)
    for (const [role, edges] of roleEdges) {
      for (const edgeKey of edges) {
        const [A, B] = edgeKey.split(SEP);
        if (!(subsumers.get(B) || EMPTY_SET).has(BOT)) continue;
        const aSet = subsumers.get(A);
        if (!aSet || aSet.has(BOT)) continue;
        if (!inFocus(A, B)) continue;
        additions.push({ kind: "sub", A, X: BOT, from: dedupConcat(roleProv(role, edgeKey), subProv(B, BOT)), sortKey: `5${SEP}${A}${SEP}${role}${SEP}${B}` });
      }
    }
    // CR6: (A,B) ∈ R(r), r⊑s ⊨ (A,B) ∈ R(s)
    for (const [role, edges] of roleEdges) {
      for (const { sup, from } of roleSubRoles.get(role) || []) {
        for (const edgeKey of edges) {
          if ((roleEdges.get(sup) || EMPTY_SET).has(edgeKey)) continue;
          const [A, B] = edgeKey.split(SEP);
          if (!inFocus(A, B)) continue;
          additions.push({ kind: "role", role: sup, A, B, from: dedupConcat(roleProv(role, edgeKey), from), sortKey: `6${SEP}${sup}${SEP}${A}${SEP}${B}${SEP}${role}` });
        }
      }
    }
    // CR7: (A,B),(B,C) ∈ R(r), r transitive ⊨ (A,C) ∈ R(r)
    for (const role of [...transitiveRoles].sort()) {
      const edges = roleEdges.get(role);
      if (!edges) continue;
      for (const edgeKey1 of edges) {
        const [A, B] = edgeKey1.split(SEP);
        for (const edgeKey2 of edges) {
          const [B2, C] = edgeKey2.split(SEP);
          if (B2 !== B) continue;
          const outKey = `${A}${SEP}${C}`;
          if (edges.has(outKey)) continue;
          if (!inFocus(A, B, C)) continue;
          additions.push({ kind: "role", role, A, B: C, from: dedupConcat(roleProv(role, edgeKey1), roleProv(role, edgeKey2), transitiveFrom.get(role)), sortKey: `7${SEP}${role}${SEP}${A}${SEP}${C}${SEP}${B}` });
        }
      }
    }

    if (!additions.length) { reachedFixpoint = true; break; }
    additions.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

    let progressed = false;
    for (const add of additions) {
      if (committed >= budget) break;
      if (add.kind === "sub") {
        const set = subsumers.get(add.A);
        if (!set || set.has(add.X)) continue;
        set.add(add.X);
        subsumerProv.set(`${add.A}${SEP}${add.X}`, add.from);
        committed += 1; progressed = true;
      } else {
        if (!roleEdges.has(add.role)) roleEdges.set(add.role, new Set());
        const set = roleEdges.get(add.role);
        const key = `${add.A}${SEP}${add.B}`;
        if (set.has(key)) continue;
        set.add(key);
        roleEdgeProv.set(`${add.role}${SEP}${key}`, add.from);
        committed += 1; progressed = true;
      }
    }
    if (committed >= budget) break;
    if (!progressed) { reachedFixpoint = true; break; }
  }

  const unsatisfiable = [...subsumers.entries()].filter(([, xs]) => xs.has(BOT)).map(([a]) => a).sort();

  return {
    subsumers, roleEdges, unsatisfiable, derivationOf: subsumerProv,
    rounds: roundsRun, truncated: !reachedFixpoint,
  };
}

/**
 * Mint the bounded goal set for a batch pass, from the already-saturated
 * `subsumers` index a first `saturateEl` pass built — not the raw normalized
 * TBox. Pure. Returns an array of NF4 axioms.
 */
export function elGoalAxioms(normalized, subsumers, { budget = 200 } = {}) {
  const nf3 = (normalized?.axioms || []).filter((ax) => ax.form === "someRight");
  const sorted = [...nf3].sort((a, b) => {
    const ka = `${a.role}${SEP}${a.filler}${SEP}${a.sub}`;
    const kb = `${b.role}${SEP}${b.filler}${SEP}${b.sub}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const goals = [];
  const seen = new Set();
  for (const ax of sorted) {
    const fillerSet = subsumers?.get(ax.filler) || new Set([ax.filler, TOP]);
    const fillerSubsumers = [...fillerSet].filter((c) => c !== TOP && c !== BOT).sort();
    for (const Bp of fillerSubsumers) {
      const name = `some-${ax.role}-${Bp}`;
      if (seen.has(name)) continue;
      seen.add(name);
      goals.push({ form: "someLeft", role: ax.role, filler: Bp, sup: name, from: [] });
      if (goals.length >= budget) return goals;
    }
  }
  return goals;
}

/**
 * Mint the single goal axiom for "does a <sub> <role> a <filler>?". Pure.
 * Returns { axiom, name }.
 */
export function elGoalFor(role, filler) {
  const roleN = normFactTerm(role);
  const fillerN = normFactTerm(filler);
  const name = `some-${roleN}-${fillerN}`;
  return { axiom: { form: "someLeft", role: roleN, filler: fillerN, sup: name, from: [] }, name };
}

/**
 * Bounded query-rooted EL proof. Normalizes, adds the one goal, saturates,
 * and reports whether `sub` acquired the goal name. Pure, no I/O.
 * Returns { proved: true, premises } | { proved: false, exhausted }
 */
export function proveElSubsumption(rows, sub, { role, filler }, { budget = 2000, rounds = 64 } = {}) {
  const subN = normFactTerm(sub);
  const normalized = normalizeElTBox(rows, { budget });
  const { axiom, name } = elGoalFor(role, filler);
  const concepts = new Set(normalized.concepts);
  concepts.add(subN);
  concepts.add(axiom.filler);
  const withGoal = { ...normalized, axioms: [...normalized.axioms, axiom], concepts };
  const sat = saturateEl(withGoal, { budget, rounds });
  const proved = (sat.subsumers.get(subN) || EMPTY_SET).has(name);
  if (proved) return { proved: true, premises: sat.derivationOf.get(`${subN}${SEP}${name}`) || [] };
  return { proved: false, exhausted: sat.truncated };
}

// ---- the materialising pass ----

export const EL_SUBSUMPTION_RULE = "elSubsumption";
export const ENTAILED_EL_PROVENANCE = `entailed:${EL_SUBSUMPTION_RULE}`;
export const EL_RESTRICTION_RULE = "elRestriction";
export const ENTAILED_EL_RESTRICTION_PROVENANCE = `entailed:${EL_RESTRICTION_RULE}`;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE, same reason. */
export const EL_RULE_CONFIDENCE = 0.95;
export const DEFAULT_EL_BUDGET = 2000;
export const DEFAULT_EL_ROUNDS = 64;

/** The two-pass saturation `classifyEl` runs internally (plain TBox first, to
 *  learn each concept's real subsumer set, then goal-seeded re-saturation),
 *  factored out so a read-only caller — the phase-5 consistency check below,
 *  `elUnsatisfiableClasses` — can run the identical computation without
 *  `classifyEl`'s own store write. Pure, no I/O. */
function elSaturateTwoPass(rows, { budget = DEFAULT_EL_BUDGET, rounds = DEFAULT_EL_ROUNDS, focus = null } = {}) {
  const normalized = normalizeElTBox(rows, { budget });
  const firstPass = saturateEl(normalized, { budget, rounds, focus });
  const goals = elGoalAxioms(normalized, firstPass.subsumers);
  const goalInfo = new Map(goals.map((g) => [g.sup, { role: g.role, filler: g.filler }]));
  const withGoals = { ...normalized, axioms: [...normalized.axioms, ...goals] };
  const finalPass = saturateEl(withGoals, { budget, rounds, focus });
  const truncated = normalized.truncated || firstPass.truncated || finalPass.truncated;
  return { normalized, goals, goalInfo, finalPass, truncated };
}

/**
 * The unsatisfiable half of an EL classification pass, with nothing written
 * to the store — `classifyEl`'s own materialising write stays an explicit,
 * separate step (the `/classify` command and `tmct classify`). A consistency
 * report reads this instead: every class whose own subclass/intersection/
 * disjointness structure saturates to `bot`, cited back to the fact ids that
 * derived it. Pure, no I/O.
 *
 * Returns { unsatisfiable, premisesOf, truncated } — `unsatisfiable` is the
 * same sorted array `classifyEl` returns from the same computation;
 * `premisesOf(className)` is the ordered fact-id list its `bot` derivation
 * rests on.
 */
export function elUnsatisfiableClasses(rows, opts = {}) {
  const { finalPass, truncated } = elSaturateTwoPass(rows, opts);
  return {
    unsatisfiable: finalPass.unsatisfiable,
    premisesOf: (className) => finalPass.derivationOf.get(`${className}${SEP}${BOT}`) || [],
    truncated,
  };
}

/**
 * Run one bounded EL classification pass over the memory graph under `repoDir`.
 * Normalizes, saturates once to find real subsumers, mints batch goals from that
 * saturation, saturates again with the goals in place, and materialises each new
 * named subsumption via `appendFacts` under its entailed provenance.
 *
 * opts: `budget`, `rounds`, `focus`, `maxEnvironments`, `store` (REQUIRED —
 * { loadMemory, readFactRows, appendFacts }).
 *
 * Returns { derived, count, budget, rounds, truncated, unsatisfiable, goalCount }.
 */
export async function classifyEl(repoDir, {
  budget = DEFAULT_EL_BUDGET, rounds = DEFAULT_EL_ROUNDS, focus = null,
  // Accepted for API symmetry with syllogise()'s store contract; unused today
  // because an EL conclusion carries exactly one environment (no alternate-
  // environment discovery step yet — see the module doc comment above).
  maxEnvironments = DEFAULT_MAX_ENVIRONMENTS,
  store,
} = {}) {
  const { loadMemory, readFactRows, appendFacts } = requireStore(store, ["loadMemory", "readFactRows", "appendFacts"], "classifyEl");
  void maxEnvironments;
  const memory = await loadMemory(repoDir);
  const rows = readFactRows(memory);
  const { normalized, goals, goalInfo, finalPass, truncated } = elSaturateTwoPass(rows, { budget, rounds, focus });

  const trustByTriple = new Map();
  for (const r of rows) trustByTriple.set(`${r.subject}${SEP}${r.predicate}${SEP}${r.object}`, r.trust);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const premiseTrustsFor = (factIds) => (factIds || [])
    .map((id) => rowById.get(id)?.trust)
    .filter((t) => typeof t === "number");
  const storedSubClassPairs = new Set(rows.filter((r) => isSubClassOf(r.predicate)).map((r) => `${r.subject}${SEP}${r.object}`));

  const toWrite = [];
  const derivedMeta = []; // { toWriteIndex, subject, object, rule }
  const restrictionScaffoldWritten = new Set();

  const subjects = [...finalPass.subsumers.keys()].sort();
  for (const A of subjects) {
    const sSet = finalPass.subsumers.get(A);
    if (sSet.has(BOT)) continue; // an unsatisfiable class is reported, never materialised
    const members = [...sSet].filter((b) => b !== A && b !== TOP && b !== BOT).sort();
    for (const B of members) {
      const pairKey = `${A}${SEP}${B}`;
      if (storedSubClassPairs.has(pairKey)) continue;
      const from = finalPass.derivationOf.get(pairKey) || [];
      const goal = goalInfo.get(B);
      if (goal) {
        if (!restrictionScaffoldWritten.has(B)) {
          restrictionScaffoldWritten.add(B);
          toWrite.push({ subject: B, predicate: TYPE_PREDICATE, object: "owl:Restriction", provenance: ENTAILED_EL_RESTRICTION_PROVENANCE, justification: [from] });
          toWrite.push({ subject: B, predicate: ON_PROPERTY_PREDICATE, object: goal.role, provenance: ENTAILED_EL_RESTRICTION_PROVENANCE, justification: [from] });
          toWrite.push({ subject: B, predicate: SOME_VALUES_FROM_PREDICATE, object: goal.filler, provenance: ENTAILED_EL_RESTRICTION_PROVENANCE, justification: [from] });
        }
        const premiseTrusts = premiseTrustsFor(from);
        const idx = toWrite.length;
        toWrite.push({
          subject: A, predicate: SUBCLASS_PREDICATE, object: B,
          provenance: ENTAILED_EL_RESTRICTION_PROVENANCE, justification: [from],
          ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: EL_RULE_CONFIDENCE } : {}),
        });
        derivedMeta.push({ toWriteIndex: idx, subject: A, object: B, rule: EL_RESTRICTION_RULE });
      } else if (normalized.concepts.has(B)) {
        const premiseTrusts = premiseTrustsFor(from);
        const idx = toWrite.length;
        toWrite.push({
          subject: A, predicate: SUBCLASS_PREDICATE, object: B,
          provenance: ENTAILED_EL_PROVENANCE, justification: [from],
          ...(premiseTrusts.length ? { premiseTrusts, ruleConfidence: EL_RULE_CONFIDENCE } : {}),
        });
        derivedMeta.push({ toWriteIndex: idx, subject: A, object: B, rule: EL_SUBSUMPTION_RULE });
      }
      // else: a synthetic intersection-fold intermediate — never materialised.
    }
  }

  const { ids } = await appendFacts(repoDir, toWrite);
  const derived = derivedMeta.map((d) => ({ id: ids[d.toWriteIndex], subject: d.subject, object: d.object, rule: d.rule }));

  return {
    derived, count: derived.length, budget, rounds, truncated,
    unsatisfiable: finalPass.unsatisfiable, goalCount: goals.length,
  };
}
