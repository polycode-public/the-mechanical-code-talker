// digest/select.mjs — stage 1 of the digest layer: score the candidate fact
// rows for one term and cut them to a budget. Pure and deterministic over the
// rows and a store-relative statistics bundle the caller supplies; imports only
// its sibling domain modules (the trust priors and the sense-split machinery),
// never the filesystem or the store adapter.
//
// The scoring signals, all already present on a readFactRows() row or cheaply
// derivable from a store scan:
//   - provenance tier: a researched or taught fact outranks an entailed one,
//     read from the row's source-type priors (memory/trust.mjs).
//   - chain depth: a stated fact outranks one the closure derived (a row with a
//     non-empty premise environment is entailed, and demoted).
//   - informativeness: a class nearly every subject in the store shares carries
//     almost no information about THIS term. A store-relative frequency share
//     over a committed threshold CUTS the row — this is what removes "a kind of
//     entity" without a hand-maintained stoplist.
//   - relation coverage: the cut prefers breadth — one good isa, one partOf and
//     one capableOf beat four isa chains — by filling families round-robin.
//   - sense agreement: an isa object whose sense cluster disagrees with the
//     term's dominant sense is demoted (the "medium"/"software" branch the
//     specimen shows), scored through sense-split.mjs's own clustering.
//
// Nothing is destroyed. Every row the budget or a cut removes is returned in
// `cut` with a reason, so "show the facts" downstream reaches the full list and
// the ranking stays auditable.

import { SOURCE_PRIOR } from "../memory/trust.mjs";
import { clusterSenses } from "../sense-split.mjs";
import DEFAULT_CONFIG from "./config.json" with { type: "json" };

// A relation predicate -> the sentence-family key the digest groups it under.
// Deliberately small: the families stage 2 authors structures for today. A
// predicate with no entry lands in "other" — still selectable, still carried
// into the detail, but never leading the narrative.
// Each family is VERB-COHERENT: the predicates inside it share one sentence
// frame, so stage 2 can author one structure per family without the object
// preposition guessing which verb it belongs to. A predicate with no entry
// lands in "other" — still selectable, still carried into the detail, but never
// leading the narrative.
export const FAMILY_OF = Object.freeze({
  "rdfs:subClassOf": "isa",
  "rdf:type": "isa",
  "mgx:atLocation": "location",
  "mgx:locatedNear": "location",
  "mgx:partOf": "partOf",
  "mgx:memberOf": "partOf",
  "mgx:capableOf": "capableOf",
  "mgx:usedFor": "usedFor",
});

// The order families lead the digest in: the definition (isa) first, then where
// it sits, what it belongs to, what it can do, what it is used for, then
// anything else. The round-robin cut pulls from families in this order, so a tie
// in score never makes the ordering non-deterministic.
export const FAMILY_PRIORITY = Object.freeze(["isa", "location", "partOf", "capableOf", "usedFor", "other"]);

const familyOf = (predicate) => FAMILY_OF[predicate] || "other";
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** The provenance component of a row's score: the strongest source-type prior
 *  the row carries (a taught fact's 0.95 beats an entailed fact's 0.3), falling
 *  back to the row's materialised trust, then to the entailed floor. */
function provenanceScore(row) {
  const priors = (row.sourceTypes || []).map((t) => SOURCE_PRIOR[t] ?? 0);
  if (priors.length) return Math.max(...priors);
  if (typeof row.trust === "number" && row.trust > 0) return row.trust;
  return SOURCE_PRIOR.entailed;
}

/** A row the closure derived rather than a source stated: it carries a premise
 *  environment, or an entailed source type. */
function isEntailed(row) {
  if (Array.isArray(row.environments) && row.environments.length) return true;
  return (row.sourceTypes || []).includes("entailed");
}

/** The store-relative share of subjects that carry this class as an isa target.
 *  Above the committed threshold (in a store large enough for the share to
 *  mean anything) the class is uninformative and its row is cut. */
function classShare(object, store) {
  const total = Number(store?.totalSubjects) || 0;
  if (total <= 0) return 0;
  const count = Number(store?.classSubjectCounts?.[object]) || 0;
  return count / total;
}

/**
 * Select the digest-worthy facts for `term` from its candidate `rows`.
 *
 * `store` supplies the store-relative signals the scoring needs, all derivable
 * from one pass over the graph the caller already holds:
 *   - classSubjectCounts: { class -> number of distinct subjects that are isa it }
 *   - totalSubjects:      number of distinct isa subjects in the store
 *   - subClassEdges:      [[child, parent], …] for the sense clustering
 *   - disjointEdges:      [[a, b], …] stored owl:disjointWith pairs (optional)
 *
 * `opts`: { budget (default config.budget.chatReply), config (threshold data) }.
 *
 * Returns { term, selected, cut, senses }:
 *   - selected: up to `budget` items { row, family, score, reasons }, ranked,
 *     breadth-first across families. Each carries its fact row, so every
 *     downstream sentence traces back to stored provenance.
 *   - cut: every other row { row, reason } — nothing is discarded silently.
 *   - senses: the sense-split verdict over the term's isa objects.
 */
export function selectFacts(term, rows, store = {}, opts = {}) {
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const budget = Number.isInteger(opts.budget) ? opts.budget : config.budget.chatReply;
  const candidates = (rows || []).filter((r) => r && r.object && r.object !== term);
  const cut = [];

  // The uninformative-class cut runs FIRST, before sense clustering. A class
  // nearly every subject shares carries no information about this term — and,
  // just as important, a bare uninformative class with no recorded ancestry
  // would act as a union bridge in the clustering below, collapsing genuinely
  // distinct senses into one. Removing it first keeps the sense signal clean.
  const bigEnough = (Number(store?.totalSubjects) || 0) >= config.uninformativeClassMinSubjects;
  const informative = [];
  for (const row of candidates) {
    if (familyOf(row.predicate) === "isa") {
      const share = classShare(row.object, store);
      if (bigEnough && share > config.uninformativeClassMaxShare) {
        cut.push({ row, family: "isa", reason: "uninformative-class", share });
        continue;
      }
    }
    informative.push(row);
  }

  // Sense clustering over the SURVIVING isa objects — the dominant sense is the
  // cluster whose objects carry the most provenance weight; objects outside it
  // are the demoted branch (the specimen's "medium"/"software" fan-out).
  const isaObjects = informative.filter((r) => familyOf(r.predicate) === "isa").map((r) => r.object);
  const senses = clusterSenses(isaObjects, {
    subClassEdges: store.subClassEdges || [],
    disjointEdges: store.disjointEdges || [],
  });
  const clusterWeight = new Map(); // label -> summed provenance of its objects
  const labelOfObject = new Map(); // object -> its cluster label
  for (const cluster of senses.clusters) {
    let weight = 0;
    for (const obj of cluster.objects) {
      labelOfObject.set(obj, cluster.label);
      const row = informative.find((r) => r.object === obj && familyOf(r.predicate) === "isa");
      weight += row ? provenanceScore(row) : 0;
    }
    clusterWeight.set(cluster.label, weight);
  }
  let dominantLabel = null;
  let bestWeight = -1;
  for (const [label, weight] of [...clusterWeight].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (weight > bestWeight) { bestWeight = weight; dominantLabel = label; }
  }

  const scored = [];
  for (const row of informative) {
    const family = familyOf(row.predicate);
    let score = provenanceScore(row);
    const reasons = { provenance: score };
    if (isEntailed(row)) { score -= config.entailedDepthPenalty; reasons.entailed = true; }
    if (family === "isa") {
      const share = classShare(row.object, store);
      // A bounded weight in [0.6, 1.0]: a rarer class says more about the term
      // and ranks higher, but a common one is only demoted, never zeroed — the
      // hard removal of a truly uninformative class is the cut above, not this.
      const informativeness = 0.6 + 0.4 * (1 - share);
      score *= informativeness;
      reasons.informativeness = informativeness;
      const label = labelOfObject.get(row.object);
      if (dominantLabel && label && label !== dominantLabel) {
        score -= config.minoritySensePenalty;
        reasons.minoritySense = label;
      }
    }
    score = clamp01(score);
    scored.push({ row, family, score, reasons });
  }

  // A row scored below the floor (a demoted minority sense, a weak entailed
  // chain) is cut, not held for backfill — the budget stays unfilled rather than
  // padding the narrative with a fact that barely earned a place. Nothing is
  // lost: it is still returned in `cut`, still reachable through the escape.
  const eligible = [];
  for (const item of scored) {
    if (item.score < config.minScore) cut.push({ row: item.row, family: item.family, reason: "below-floor", score: item.score });
    else eligible.push(item);
  }

  // Breadth-first cut to budget: each family sorted by score (tie broken by
  // object label for determinism), then pulled round-robin in family priority
  // order so the digest covers relations before it repeats one.
  const byFamily = new Map();
  for (const item of eligible) {
    if (!byFamily.has(item.family)) byFamily.set(item.family, []);
    byFamily.get(item.family).push(item);
  }
  for (const list of byFamily.values()) {
    list.sort((a, b) => b.score - a.score || a.row.object.localeCompare(b.row.object));
  }
  const orderedFamilies = FAMILY_PRIORITY.filter((f) => byFamily.has(f))
    .concat([...byFamily.keys()].filter((f) => !FAMILY_PRIORITY.includes(f)).sort());
  const selected = [];
  let drained = false;
  while (selected.length < budget && !drained) {
    drained = true;
    for (const family of orderedFamilies) {
      const list = byFamily.get(family);
      if (list && list.length) {
        selected.push(list.shift());
        drained = false;
        if (selected.length >= budget) break;
      }
    }
  }
  // Whatever the round-robin left over is ranked detail, not noise — returned
  // as budget-cut, still carrying its score, so the escape reaches it in order.
  for (const family of orderedFamilies) {
    for (const item of byFamily.get(family) || []) {
      cut.push({ row: item.row, family: item.family, reason: "over-budget", score: item.score });
    }
  }
  selected.sort((a, b) => {
    const fa = FAMILY_PRIORITY.indexOf(a.family);
    const fb = FAMILY_PRIORITY.indexOf(b.family);
    return (fa - fb) || (b.score - a.score) || a.row.object.localeCompare(b.row.object);
  });

  return {
    term,
    selected,
    cut,
    senses: { split: senses.split, clusters: senses.clusters, dominantLabel },
  };
}
