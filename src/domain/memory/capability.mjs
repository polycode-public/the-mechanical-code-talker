// memory/capability.mjs — negative facts, and capability read across
// rdfs:subClassOf with a specificity override. The Tweety problem: birds fly,
// penguins are birds, penguins do not fly.
//
// This is DEFEASIBLE inheritance, and it is deliberately NOT OWL. OWL's
// cls-svf1/scm-svf1 propagate owl:someValuesFrom restrictions; mgx:capableOf is
// a flat property assertion on a punned class, and OWL does not carry that down
// a subclass edge at all. Nothing here should be routed through syllogise.mjs's
// rule engine, because the conclusion is non-monotonic: a later, more specific
// fact retracts it. The chase reads at query time and writes nothing, so an
// override never has to un-say a materialised entailment.
//
// Polarity lives IN the predicate, under its own prefix. It cannot live in a
// separate property: factIdForTriple content-addresses (subject, predicate,
// object), so a positive and a negative sharing one predicate would hash to the
// same id, merge into one Fact, and union their mgx:statedBy edges — the source
// indexing that lets two sources disagree without either being deleted.
//
// Pure and import-free of core.mjs, exactly like trust.mjs beside it.

import { findIsaChain, buildSubClassSuccessors, SUBCLASS_PREDICATE, TYPE_PREDICATE } from "../syllogise.mjs";

/** The negative-polarity CURIE prefix. A separate prefix, never an
 *  "mgx:not-<lemma>" mint: chat.mjs's predicatePhrase reads "mgx:not-fly" as
 *  lemma "not" plus tail "fly" and renders "nots fly", and its preposition fold
 *  is guarded on /^mgx:[a-z]+$/, which a hyphenated mint fails — so
 *  "a penguin cannot rest on water" would strand "on water" inside the object
 *  where no read-back can match it. */
export const NEG_PREDICATE_PREFIX = "mgxneg:";
const POSITIVE_PREDICATE_PREFIX = "mgx:";

/** The negative twin of rdfs:subClassOf ("john is not a man"). The polarity
 *  prefix is tmct's; the term it negates is RDFS's, so this pair cannot be
 *  minted by the prefix swap below and is stated instead.
 *
 *  Why a coined mgxneg: term and not owl:disjointWith: disjointness is a
 *  class-class axiom ("no man is a stone"), and the ask ladder already reads it
 *  that way. "john is not a man" denies ONE membership and says nothing about
 *  any other john, so storing it as disjointness would over-claim. */
export const NEG_SUBCLASS_PREDICATE = "mgxneg:subClassOf";
const EXPLICIT_NEGATIVE_TWINS = new Map([[SUBCLASS_PREDICATE, NEG_SUBCLASS_PREDICATE]]);
const EXPLICIT_POSITIVE_TWINS = new Map([...EXPLICIT_NEGATIVE_TWINS].map(([pos, neg]) => [neg, pos]));

/** Swap a predicate onto its negative twin. Applied AFTER the preposition
 *  fold, so mgx:rest-on becomes mgxneg:rest-on and the object keeps nothing
 *  meaning-bearing inside it. A predicate with no negative twin returns
 *  unchanged. */
export function negatedPredicate(predicate) {
  const p = String(predicate || "");
  const stated = EXPLICIT_NEGATIVE_TWINS.get(p);
  if (stated) return stated;
  if (!p.startsWith(POSITIVE_PREDICATE_PREFIX)) return p;
  return NEG_PREDICATE_PREFIX + p.slice(POSITIVE_PREDICATE_PREFIX.length);
}

/** The inverse: mgxneg:capableOf -> mgx:capableOf, or null for any predicate
 *  that isn't negative at all. The stated twins invert by lookup — a prefix
 *  swap would read mgxneg:subClassOf back as "mgx:subClassOf", a term that
 *  exists nowhere. */
export function positivePredicate(predicate) {
  const p = String(predicate || "");
  const stated = EXPLICIT_POSITIVE_TWINS.get(p);
  if (stated) return stated;
  if (!p.startsWith(NEG_PREDICATE_PREFIX)) return null;
  return POSITIVE_PREDICATE_PREFIX + p.slice(NEG_PREDICATE_PREFIX.length);
}

export const isNegatedPredicate = (predicate) => String(predicate || "").startsWith(NEG_PREDICATE_PREFIX);

export const CAPABLE_OF_PREDICATE = "mgx:capableOf";
export const NEG_CAPABLE_OF_PREDICATE = negatedPredicate(CAPABLE_OF_PREDICATE);

/** How many rows a base-rate or extension report lists before it stops, and the
 *  order it lists them in. One constant each, in one place, so the verbosity of
 *  every case-4 answer is tuned by editing two lines. */
export const CAPABILITY_REPORT_CAP = 6;
const byTrustThenName = (a, b) => (b.trust || 0) - (a.trust || 0) || String(a.subject).localeCompare(String(b.subject));

const asSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : [v]));

// The ⊑ adjacency is built here, once per call, rather than inside each chase:
// every caller below chases many subjects over the same edges, and rebuilding
// the index per chase makes one small search cost the whole edge set.
const isaEdgesOf = (facts) => {
  const typeEdges = facts.filter((f) => f.predicate === TYPE_PREDICATE).map((f) => [f.subject, f.object]);
  const subClassEdges = facts.filter((f) => f.predicate === SUBCLASS_PREDICATE).map((f) => [f.subject, f.object]);
  return { typeEdges, subClassSucc: buildSubClassSuccessors(subClassEdges) };
};

/** The shortest isa chain from any spelling of `subjects` up to `target`, or
 *  null. The chase is corpus-INCLUSIVE on purpose, and that is a considered
 *  difference from the is-a ladder's own taught-only chase. The ladder excludes
 *  corpus edges because a coincidental ConceptNet chain answering "is X a Y"
 *  would be fabrication. Here the premise being chased to — "bird can fly" — is
 *  itself corpus data on a fresh install, so a taught-only chase would find
 *  nothing to inherit and the whole feature would never fire. */
function shortestChainTo(subjects, target, typeEdges, subClassSucc, maxHops) {
  let best = null;
  for (const s of subjects) {
    if (s === target) return [];
    const chain = findIsaChain(s, new Set([target]), typeEdges, subClassSucc, { maxHops });
    if (chain && (!best || chain.length < best.length)) best = chain;
  }
  return best;
}

/**
 * Does `subject` have `object` as a capability? Pure over already-fetched Fact
 * rows ({subject, predicate, object, provenance, trust}).
 *
 * Returns { verdict, hops, positive, negative, chain, overrides, baseRate }:
 *   verdict "yes"  — the winning rank is positive only
 *   verdict "no"   — the winning rank is negative only
 *   verdict "both" — the winning rank holds both polarities; report the sources
 *                    and pick NOTHING
 *   verdict "none" — nothing is known; `baseRate` carries the class split
 * `hops` is 0 for a fact directly about the subject, else the chain length.
 * `overrides` names the more general default a direct answer beat, so case 2
 * can say what it is overriding instead of silently winning.
 *
 * SPECIFICITY IS CHAIN LENGTH, AND IT OUTRANKS TRUST UNCONDITIONALLY. The
 * candidates are sorted by hop count first and trust only second, so trust can
 * never reorder across ranks — it only ever breaks a tie inside one. Trust
 * looks like it solves this for free (SOURCE_PRIOR puts entailed 0.3 under
 * teach 0.95, so a taught negative already outranks a derived positive) but
 * that is luck: flip the sources — the corpus says penguins cannot fly, a
 * visitor taught that birds can — and trust alone answers that penguins fly.
 */
export function resolveCapabilityPolarity(subject, object, facts, { maxHops = 3 } = {}) {
  const subjects = asSet(subject);
  const objects = asSet(object);
  const rows = Array.isArray(facts) ? facts : [];
  const { typeEdges, subClassSucc } = isaEdgesOf(rows);

  const carriers = rows.filter(
    (f) => (f.predicate === CAPABLE_OF_PREDICATE || f.predicate === NEG_CAPABLE_OF_PREDICATE) && objects.has(f.object),
  );

  const candidates = [];
  for (const fact of carriers) {
    const polarity = fact.predicate === NEG_CAPABLE_OF_PREDICATE ? "negative" : "positive";
    if (subjects.has(fact.subject)) {
      candidates.push({ fact, polarity, hops: 0, chain: null });
      continue;
    }
    const chain = shortestChainTo(subjects, fact.subject, typeEdges, subClassSucc, maxHops);
    if (chain && chain.length) candidates.push({ fact, polarity, hops: chain.length, chain });
  }

  if (!candidates.length) {
    return {
      verdict: "none", hops: 0, positive: [], negative: [], chain: null, overrides: null,
      baseRate: capabilityBaseRate(subjects, objects, rows, { maxHops }),
    };
  }

  // hop count first, trust only within a rank — the whole point of the design
  candidates.sort((a, b) => a.hops - b.hops || (b.fact.trust || 0) - (a.fact.trust || 0));
  const hops = candidates[0].hops;
  const winning = candidates.filter((c) => c.hops === hops);
  const positive = winning.filter((c) => c.polarity === "positive").map((c) => c.fact);
  const negative = winning.filter((c) => c.polarity === "negative").map((c) => c.fact);

  // the beaten default: the closest OPPOSITE-polarity claim further up the
  // chain, so a direct answer can name what it overrides
  const answered = negative.length && !positive.length ? "negative" : "positive";
  const beaten = candidates.find((c) => c.hops > hops && c.polarity !== answered) || null;

  return {
    verdict: positive.length && negative.length ? "both" : (negative.length ? "no" : "yes"),
    hops,
    positive,
    negative,
    chain: candidates[0].chain,
    overrides: beaten ? { fact: beaten.fact, chain: beaten.chain } : null,
    baseRate: null,
  };
}

/**
 * Nothing is known about the subject, so report the CLASS it belongs to and how
 * that class's other kinds split — never a yes or a no.
 *
 * The subject is excluded from its own base rate: you do not cite ostrich as
 * evidence about ostrich. The denominator is the subclass count, and the split
 * is three-way (positive, negative, unknown) so it accounts for every kind it
 * counted. Say 5 and split only 4 and the arithmetic lies about what you know.
 *
 * The sample is never generalised to the population. "of the 4 kinds of bird I
 * know" is a count this can prove; "most birds fly" is a claim about birds it
 * has never seen.
 *
 * Returns null when the subject belongs to no known class.
 */
export function capabilityBaseRate(subject, object, facts, { maxHops = 3 } = {}) {
  const subjects = asSet(subject);
  const objects = asSet(object);
  const rows = Array.isArray(facts) ? facts : [];
  const isaRows = rows.filter((f) => f.predicate === SUBCLASS_PREDICATE || f.predicate === TYPE_PREDICATE);

  const parents = isaRows.filter((f) => subjects.has(f.subject)).map((f) => f.object);
  if (!parents.length) return null;
  const klass = parents[0];

  const siblings = [...new Set(
    isaRows.filter((f) => f.object === klass && !subjects.has(f.subject)).map((f) => f.subject),
  )];

  const capabilityOf = (name) => {
    const hit = rows.find(
      (f) => f.subject === name && objects.has(f.object)
        && (f.predicate === CAPABLE_OF_PREDICATE || f.predicate === NEG_CAPABLE_OF_PREDICATE),
    );
    if (!hit) return { name, polarity: "unknown", fact: null };
    return { name, polarity: hit.predicate === NEG_CAPABLE_OF_PREDICATE ? "negative" : "positive", fact: hit };
  };

  const split = siblings.map(capabilityOf);
  const { typeEdges, subClassSucc } = isaEdgesOf(rows);
  return {
    klass,
    kinds: siblings.length,
    positive: split.filter((s) => s.polarity === "positive"),
    negative: split.filter((s) => s.polarity === "negative"),
    unknown: split.filter((s) => s.polarity === "unknown"),
    chain: shortestChainTo(subjects, klass, typeEdges, subClassSucc, maxHops),
  };
}

/**
 * Every subject the memory says CAN do `object` — the predicate's extension.
 * Backs both the "what can fly" listing and the case-4 pivot ("I don't know if
 * a penguin can fly, but I do know 3 things that can fly").
 *
 * A subject only lists if the RESOLVER says yes, not merely if a positive row
 * exists. A subject the store explicitly says cannot do this is not an answer
 * here, even when a corpus row also says it can — otherwise this listing and
 * "can a penguin fly" would contradict each other over the same facts.
 *
 * `exclude` drops the subject and the class already reported on: pivoting to an
 * extension whose only member IS the class being asked about is circular, not
 * informative.
 */
export function capabilityExtension(object, facts, { exclude = [], maxHops = 3 } = {}) {
  const objects = asSet(object);
  const skip = asSet(exclude);
  const rows = Array.isArray(facts) ? facts : [];
  const seen = new Set();
  const out = [];
  for (const f of rows) {
    if (f.predicate !== CAPABLE_OF_PREDICATE || !objects.has(f.object)) continue;
    if (skip.has(f.subject) || seen.has(f.subject)) continue;
    seen.add(f.subject);
    if (resolveCapabilityPolarity(new Set([f.subject]), objects, rows, { maxHops }).verdict !== "yes") continue;
    out.push(f);
  }
  return out.sort(byTrustThenName);
}
