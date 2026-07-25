// researchbench/grade.mjs — the deterministic grading core for RESEARCHBENCH
// (SKILL_BENCHMARK_RESEARCH.md). No LLM, no judge, no network: every metric is
// a pure function over the frozen fixture graph and the recorded walk.
//
// RESEARCHBENCH grades the TRAVERSAL — which links get followed, in what
// order, when the run stops — never the per-article facts (that is
// SKILL_BENCHMARK_INGEST.md's job). RES-0..RES-8 is its own ladder, drawn from
// focused crawling, distinct from CEFR/TOOL-*/INF-*.

import { normFactTerm } from "../../src/domain/hash.mjs";
import { parseJsonlRows, rollupBy, ladderGateBy } from "../benchlib/bench.mjs";

export const RUNGS = Object.freeze([
  "RES-0", "RES-1", "RES-2", "RES-3", "RES-4", "RES-5", "RES-6", "RES-7", "RES-8",
]);

export const RECALL_FLOOR = 0.5;
export const HUB_FLOOR = 0.8;
export const ORDER_FLOOR = 0.8;

// Which floors a rung's gate actually applies — recall always applies
// (SKILL_BENCHMARK_RESEARCH.md §1); hub-avoidance and ordering apply only
// where the rung's own "what it tests" column names them. RES-7/RES-8 are
// ceiling markers (see run.mjs) and never reach the gate at all.
const RUNG_CHECKS = Object.freeze({
  "RES-0": { hub: false, order: false },
  "RES-1": { hub: false, order: false },
  "RES-2": { hub: false, order: true },
  "RES-3": { hub: true, order: false },
  "RES-4": { hub: false, order: false },
  "RES-5": { hub: false, order: false },
  "RES-6": { hub: false, order: false },
});

// ---- the hub-signal treatment (deterministic, closed, two signals) --------

/** A fixture title clears the DEGREE proxy when at least this many OTHER
 *  fixture articles' leadLinks name it — the frozen stand-in for Kleinberg's
 *  hub notion. Committed here, never computed from a live degree count. */
export const HUB_DEGREE_FLOOR = 2;

const YEAR_RE = /^\d{1,4}$/;
const CENTURY_RE = /^\d{1,2}(st|nd|rd|th) century$/i;
const IDENTIFIER_RE = /^(ISBN|DOI)[\s:-]/i;

function isGenericByPattern(title) {
  return YEAR_RE.test(title) || CENTURY_RE.test(title) || IDENTIFIER_RE.test(title);
}

/** In-degree of every fixture title: how many OTHER articles' leadLinks name
 *  it. Pure function over the committed graph. */
export function inDegrees(graph) {
  const degree = new Map();
  for (const [from, entry] of Object.entries(graph.articles)) {
    for (const to of entry.leadLinks || []) {
      if (normFactTerm(to) === normFactTerm(from)) continue;
      degree.set(to, (degree.get(to) || 0) + 1);
    }
  }
  return degree;
}

/** The full hub-set: every title flagged by EITHER signal — the degree proxy
 *  or the committed generic-term list / identifier-and-date patterns. Two
 *  graders reading the same graph.json always agree byte-for-byte. */
export function computeHubSet(graph) {
  const degree = inDegrees(graph);
  const hubs = new Set();
  for (const [title, n] of degree) if (n >= HUB_DEGREE_FLOOR) hubs.add(title);
  for (const title of graph.genericTerms || []) hubs.add(title);
  for (const from of Object.keys(graph.articles)) {
    for (const to of graph.articles[from].leadLinks || []) if (isGenericByPattern(to)) hubs.add(to);
  }
  return hubs;
}

// ---- reachability closure (the automatic-fail check: no invented walk) ----

/** Every title reachable from `seed` within `maxDepth` hops over the fixture's
 *  own leadLinks, INCLUDING dead titles (a dead title is still a real edge the
 *  fixture holds — attempting it and getting a clean miss is honest; grounding
 *  one that was never linked at all would not be). */
export function reachableFromSeed(graph, seed, maxDepth) {
  const seedTitle = Object.keys(graph.articles).find((t) => normFactTerm(t) === normFactTerm(seed));
  const reachable = new Set(seedTitle ? [seedTitle] : []);
  let frontier = seedTitle ? [seedTitle] : [];
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const title of frontier) {
      const entry = graph.articles[title];
      for (const linked of entry?.leadLinks || []) {
        if (reachable.has(linked)) continue;
        reachable.add(linked);
        next.push(linked);
      }
    }
    frontier = next;
  }
  return reachable;
}

// ---- the metric trio (pure functions over the fixture graph + the walk) --

/** Ordering score over the (usefulTerm, hub) pairs BOTH of which appear in
 *  `queueOrder` (the depth-1 fan-out, document order) — pairs spanning a
 *  title never queued at all are excluded (nothing to order). `1 −
 *  inversions/pairs`; `null` when there is nothing to pair (fine below RES-2). */
export function orderingScore(queueOrder, goldFollow, goldHubs) {
  const pos = new Map(queueOrder.map((t, i) => [t, i]));
  let pairs = 0;
  let inversions = 0;
  for (const useful of goldFollow) {
    if (!pos.has(useful)) continue;
    for (const hub of goldHubs) {
      if (!pos.has(hub)) continue;
      pairs += 1;
      if (pos.get(useful) > pos.get(hub)) inversions += 1;
    }
  }
  return pairs === 0 ? null : 1 - inversions / pairs;
}

/** Hub-avoidance: of the case's gold hub-set, the fraction the run did NOT
 *  spend a round trip on (fetched OR skipped both count as "fetched" — a dead
 *  hub the run wasted a request on is exactly as undesirable as a live one).
 *  `1` (vacuous) when the case declares no hubs. */
export function hubAvoidanceRate(attemptedTitles, goldHubs) {
  if (!goldHubs.length) return 1;
  const attempted = new Set(attemptedTitles);
  const hubsFetched = goldHubs.filter((h) => attempted.has(h)).length;
  return 1 - hubsFetched / goldHubs.length;
}

/** Recall@budget: of the case's gold follow-set, the fraction actually
 *  GROUNDED (not merely attempted) within the fetch budget. `1` (vacuous)
 *  when the case declares no follow-set (RES-0). */
export function recallAtBudget(groundedTitles, goldFollow) {
  if (!goldFollow.length) return 1;
  const grounded = new Set(groundedTitles);
  const reached = goldFollow.filter((t) => grounded.has(t)).length;
  return reached / goldFollow.length;
}

/** Grade one case's recorded walk against its gold. `afterStart`/`final` are
 *  researchSnapshot() shapes (run.mjs's driveCase); `graph` is the fixture.
 *  Returns {ordering, hubAvoidance, recall, invented, groundedTitles,
 *  attemptedTitles, queueOrder}. `invented` (the automatic-fail line) is true
 *  iff any grounded or skipped title is NOT within the fixture's own
 *  reachability closure from the seed — an edge the queue could not really
 *  have walked. */
export function gradeWalk(caseDef, { afterStart, final, graph }) {
  const queueOrder = [...(afterStart.pending || [])];
  const groundedTitles = final.done.slice(1).map((d) => d.title); // exclude the depth-0 seed
  const attemptedTitles = [...groundedTitles, ...(final.skipped || [])];
  const maxDepth = Math.max(1, caseDef.k ?? 1);
  const reachable = reachableFromSeed(graph, caseDef.seed, maxDepth);
  const invented = attemptedTitles.some((t) => !reachable.has(t));

  return {
    ordering: orderingScore(queueOrder, caseDef.goldFollow || [], caseDef.goldHubs || []),
    hubAvoidance: hubAvoidanceRate(attemptedTitles, caseDef.goldHubs || []),
    recall: recallAtBudget(groundedTitles, caseDef.goldFollow || []),
    invented, groundedTitles, attemptedTitles, queueOrder,
  };
}

// ---- case lint ---------------------------------------------------------------

export function parseCases(text) {
  return parseJsonlRows(text, (c, cases, errors) => {
    if (!RUNGS.includes(c.rung)) { errors.push(`${c.id}: rung must be one of ${RUNGS.join("|")}`); return; }
    if (c.rung !== "RES-7" && c.rung !== "RES-8") {
      if (!c.seed || typeof c.seed !== "string") errors.push(`${c.id}: missing seed`);
      if (!Array.isArray(c.goldFollow)) errors.push(`${c.id}: goldFollow must be an array`);
      if (!Array.isArray(c.goldHubs)) errors.push(`${c.id}: goldHubs must be an array`);
    }
    cases.push(c);
  });
}

// ---- rollup + ladder gate (mirrors idxbench/infbench's own shape) ---------

function tallyRung(rung, rows) {
  const measuredRows = rows.filter((r) => r.measured !== false);
  const unmeasured = rows.length - measuredRows.length;
  const checks = RUNG_CHECKS[rung] || { hub: false, order: false };

  let recallSum = 0;
  let hubSum = 0;
  let orderSum = 0;
  let orderCount = 0;
  let invented = 0;

  for (const r of measuredRows) {
    recallSum += r.recall;
    hubSum += r.hubAvoidance;
    if (r.ordering != null) { orderSum += r.ordering; orderCount += 1; }
    if (r.invented) invented += 1;
  }
  const n = measuredRows.length;
  const recall = n ? recallSum / n : 1;
  const hubAvoidance = n ? hubSum / n : 1;
  const ordering = orderCount ? orderSum / orderCount : null;

  const gatePass = n > 0 && invented === 0
    && recall >= RECALL_FLOOR
    && (!checks.hub || hubAvoidance >= HUB_FLOOR)
    && (!checks.order || ordering == null || ordering >= ORDER_FLOOR);

  return {
    measured: n, unmeasured, invented,
    recall, hubAvoidance, ordering, checks,
    gatePass, ceilingOnly: n === 0 && unmeasured > 0,
    // the "fail rate" ladderGateBy's receipt message reads — the worst-missed
    // floor this rung's own checks actually apply, expressed as a 0..1 gap.
    failRate: invented > 0 ? 1 : Math.max(
      recall < RECALL_FLOOR ? RECALL_FLOOR - recall : 0,
      checks.hub && hubAvoidance < HUB_FLOOR ? HUB_FLOOR - hubAvoidance : 0,
      checks.order && ordering != null && ordering < ORDER_FLOOR ? ORDER_FLOOR - ordering : 0,
    ),
  };
}

export function rollup(rows) {
  const { byTier, overall } = rollupBy(rows, RUNGS, (r) => r.rung, (rs) => tallyRung(rs[0]?.rung, rs));
  return { byRung: byTier, overall };
}

export function ladderGate(rolled) {
  return ladderGateBy(rolled.byRung, {
    tiers: RUNGS.filter((r) => r !== "RES-7" && r !== "RES-8"), // ceiling markers never enter the gate
    tierKey: "rung",
    rateOf: (c) => c.failRate, rateLabel: "gap",
    floor: RECALL_FLOOR,
  });
}

export function renderRollup(rolled) {
  const row = (label, c) => {
    const order = c.ordering == null ? "n/a" : `${(c.ordering * 100).toFixed(0)}%`;
    const gate = c.ceilingOnly ? "n/a (ceiling)" : (c.gatePass ? "PASS" : "----");
    return `${label.padEnd(6)} n=${String(c.measured).padStart(2)}${c.unmeasured ? ` (${c.unmeasured} ceiling)` : ""}`
      + `  recall@budget=${(c.recall * 100).toFixed(0)}%  hub-avoidance=${(c.hubAvoidance * 100).toFixed(0)}%`
      + `  ordering=${order}  invented=${c.invented}  ${gate}`;
  };
  const lines = ["rung    n                    recall@budget  hub-avoidance  ordering  invented  gate"];
  for (const rung of RUNGS) {
    const c = rolled.byRung[rung];
    if (c) lines.push(row(rung, c));
  }
  return lines.join("\n");
}
