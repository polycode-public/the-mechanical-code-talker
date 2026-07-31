// memory/resolution.mjs — how sibling facts sharing one (subject, predicate)
// but disagreeing on the OBJECT resolve. A fact is stored one record per
// asserting source, so two kinds of plurality exist: records inside one triple
// group (corroboration — same claim, different mouths, handled by the group
// fold in core.mjs) and different objects across groups. Only the second one
// needs a decision, and which decision it needs is a property of the PREDICATE.
//
// The table below is a closed enum keyed by predicate, matching this codebase's
// standing preference for closed vocabularies over general rules — SOURCE_PRIOR
// and the ISA set are the same shape. Four strategies:
//
//   merge                   many objects at once are all true; a second object
//                           is a second fact, never a disagreement
//   latest-observation-wins the object is a current state; successive objects
//                           are successive states, newest observation renders
//   first-claim-wins        objects race for a registration; the oldest claim
//                           takes it
//   contradiction           the default: a real disagreement, both kept, both
//                           reported, never silently resolved
//
// Pure and import-free of core.mjs, exactly like trust.mjs and capability.mjs
// beside it.

import { negatedPredicate } from "./capability.mjs";
import { AGENT_SOURCE_TYPES } from "./trust.mjs";

export const RESOLUTION_MERGE = "merge";
export const RESOLUTION_LATEST_OBSERVATION_WINS = "latest-observation-wins";
export const RESOLUTION_FIRST_CLAIM_WINS = "first-claim-wins";
export const RESOLUTION_CONTRADICTION = "contradiction";

/** Predicates whose real-world semantics allow many objects at once — a wheel
 *  is part of a car AND of a bike, a dog is a mammal AND a pet, you are LIKELY
 *  to find a dog in a kennel AND in a park. The ConceptNet surface templates
 *  say "typically", not "uniquely", so the associative and lexical relations
 *  all sit here. Each entry's negative twin joins it: "cannot fly" and "cannot
 *  sing" are two claims, not a self-contradiction. */
const MERGE_PREDICATE_STEMS = [
  "mgx:hasA", "mgx:capableOf",
  "rdfs:subClassOf", "rdf:type", "owl:disjointWith", "mgx:partOf",
  "mgx:usedFor", "mgx:receivesAction", "mgx:causes", "mgx:causesDesire",
  "mgx:hasSubevent", "mgx:hasPrerequisite", "mgx:motivatedByGoal", "mgx:obstructedBy",
  "mgx:desires", "mgx:hasProperty", "mgx:madeOf", "mgx:atLocation", "mgx:locatedNear",
  "mgx:createdBy",
  "mgx:mannerOf", "mgx:relatedTo", "mgx:synonym", "mgx:antonym", "mgx:similarTo", "mgx:symbolOf",
  "mgx:knows-about",
];

export const MERGE_PREDICATES = new Set(
  MERGE_PREDICATE_STEMS.flatMap((p) => [p, negatedPredicate(p)]),
);

/** Predicates whose object is the CURRENT state of something: a placement, a
 *  position, a mutable property, a name. Two different objects are two moments,
 *  not two opinions, so the newest observation renders and no contradiction is
 *  reported — unless observation time cannot order them at all (see
 *  resolveSiblingGroups). */
const LATEST_OBSERVATION_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:stands-locked-in", "mgx:hidden-in",
  "mgx:on-top-of", "mgx:on-plane", "mgx:under",
  "mgx:is-open", "mgx:hasMass", "mgx:feels", "mgx:faces", "mgx:pose",
  "mgx:display-name", "mgx:nodeName", "mgx:worldName",
]);

/** The `mgx:has-exit-<direction>` family, which digging rewires: one more
 *  state predicate, generated per direction rather than enumerated. */
const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;

/** Registrations: different objects race for one slot and the OLDEST claim
 *  takes it. `mgx:playedBy` already ships this semantic ("first claim wins by
 *  timestamp"); the table is where the rule lives now, instead of per-caller
 *  lore. */
const FIRST_CLAIM_PREDICATES = new Set(["mgx:playedBy"]);

/** How sibling objects on `predicate` resolve. `contradiction` is the default,
 *  so a predicate nobody has classified keeps the full keep-both contract. */
export function resolutionStrategyFor(predicate) {
  const p = String(predicate || "");
  if (MERGE_PREDICATES.has(p)) return RESOLUTION_MERGE;
  if (LATEST_OBSERVATION_PREDICATES.has(p) || EXIT_PREDICATE_RE.test(p)) return RESOLUTION_LATEST_OBSERVATION_WINS;
  if (FIRST_CLAIM_PREDICATES.has(p)) return RESOLUTION_FIRST_CLAIM_WINS;
  return RESOLUTION_CONTRADICTION;
}

/**
 * When the asserting party WITNESSED this record's claim — valid time, as
 * against mgx:createdAt's transaction time (when this store recorded it). The
 * split is what makes a stale newspaper read today lose to an eyewitness report
 * from yesterday; ingestion order gets that exactly backwards.
 *
 * The chain, in order:
 *   1. the stored mgx:observedAt, when a caller supplied a parseable one;
 *   2. for AGENT-kind sources only, the record's assertion time (its tag's own
 *      embedded timestamp, else its createdAt) — a live agent asserting now is
 *      witnessing now;
 *   3. otherwise undefined.
 *
 * Document-kind sources (corpus, reference, web, extracted) and activity-kind
 * (entailed) never fall back to createdAt: their createdAt is ingestion time
 * and says nothing about observation. That is what resolves the newspaper case
 * — an undated corpus row scores undefined and loses to any dated witness.
 *
 * Returns the instant as its ISO string, or undefined. Every returned value
 * parses, so a caller may Date.parse it without re-checking.
 */
export function effectiveObservedAt(record) {
  const stored = record?.observedAt;
  if (stored && Number.isFinite(Date.parse(stored))) return String(stored);
  if (!AGENT_SOURCE_TYPES.has(record?.sourceType)) return undefined;
  for (const candidate of [record?.assertedAt, record?.createdAt]) {
    if (candidate && Number.isFinite(Date.parse(candidate))) return String(candidate);
  }
  return undefined;
}

/** The instant that scores a whole object-group: the newest observation any of
 *  its records carries for latest-observation-wins, the oldest for
 *  first-claim-wins. null when no record in the group is dated at all. */
function groupObservationInstant(row, oldest) {
  let best = null;
  for (const assertion of row?.assertions || []) {
    const at = Date.parse(effectiveObservedAt(assertion) ?? "");
    if (!Number.isFinite(at)) continue;
    if (best === null || (oldest ? at < best : at > best)) best = at;
  }
  return best;
}

/**
 * Resolve the object-groups of ONE (subject, predicate) under a time-ordered
 * strategy. `rows` are stage-1 rows (one per triple group, so one per distinct
 * object); `strategy` is latest-observation-wins or first-claim-wins. Returns
 * null for any other strategy, since merge presents everything and
 * contradiction resolves nothing.
 *
 * The ladder, in order:
 *   1. score each group by its own observation instant (above);
 *   2. a dated group beats an undated one, then the wanted extreme wins —
 *      newest for latest-observation-wins, oldest for first-claim-wins;
 *   3. tie (equal instants, or every group undated): higher aggregate trust;
 *   4. still tied: the codepoint-smallest object string — plain `<`, never
 *      localeCompare, so two peers holding the same records read the same
 *      winner whatever locale they run under.
 *
 * `contested` reports whether the WINNER came down to step 3 or 4. Those are
 * the cases time could not order, so they still belong in the contradiction
 * report: the ranking exists so a page always has one deterministic answer to
 * render, never so a disagreement disappears.
 */
export function resolveSiblingGroups(rows, strategy) {
  const oldest = strategy === RESOLUTION_FIRST_CLAIM_WINS;
  if (!oldest && strategy !== RESOLUTION_LATEST_OBSERVATION_WINS) return null;
  const scored = (rows || []).map((row) => ({ row, at: groupObservationInstant(row, oldest) }));
  scored.sort((a, b) => {
    if (a.at !== b.at) {
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return oldest ? a.at - b.at : b.at - a.at;
    }
    const trustGap = (b.row.trust || 0) - (a.row.trust || 0);
    if (trustGap) return trustGap;
    const [x, y] = [String(a.row.object), String(b.row.object)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const ranked = scored.map((s) => s.row);
  return {
    winner: ranked[0] || null,
    ranked,
    contested: scored.length > 1 && scored[0].at === scored[1].at,
  };
}
