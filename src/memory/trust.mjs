// memory/trust.mjs — deterministic, explainable, auditable trust over a Fact's
// Sources (PLAN_PROVENANCE_TRUST step (c)).
//
// Trust is a COMPUTED attribute of a Fact — never hand-set — a pure function of
// its Source edges, those Sources' types, and its mgx:createdAt. Three inputs
// combine:
//   - a Source-TYPE PRIOR (operator > provider > corpus > web > entailed);
//   - CORROBORATION over the fact's distinct Sources by noisy-OR
//     (1 − Π(1 − wᵢ), capped at 1) — two independent web sources (0.4) reach
//     0.64, a lone operator fact is already 1.0;
//   - a bounded RECENCY nudge in [0.9, 1.0] from createdAt, half-life decayed —
//     the codegraph "capped nudge" philosophy, so recency breaks ties and
//     freshens but never flips a source-type ordering by itself.
//
// For ENTAILED facts (tier-5): trust = min(premise trusts) × rule-confidence — a
// conclusion is only as trustworthy as its weakest premise. Premises may be
// absent for now, so this is a documented HOOK: pass opts.premiseTrusts (and
// opts.ruleConfidence) and it engages; otherwise an entailed fact scores off its
// bare 0.3 prior like any other Source.
//
// This module is PURE and import-free of core.mjs (no cycle): it reads Source
// individuals by their attribute props and returns { score, inputs }. core.mjs
// materialises the score onto the Fact (mgx:trustScore) plus the inputs it was
// computed from (mgx:trustInputs), so every score is reproducible and auditable.

export const TRUST_SCORE_PROP = "mgx:trustScore";
export const TRUST_INPUTS_PROP = "mgx:trustInputs";

/** Source-type priors — the ordering operator > provider-graph > curated-corpus
 *  > web > unverified-entailment. The entailed value is a FLOOR before premise
 *  adjustment (see the entailed hook below). */
export const SOURCE_PRIOR = Object.freeze({
  operator: 1.0,
  provider: 0.9,
  corpus: 0.7,
  web: 0.4,
  entailed: 0.3,
});

export const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENCY_FLOOR = 0.9; // recency multiplier stays within [0.9, 1.0]

const round = (n, p = 6) => Number(n.toFixed(p));
const sourceTypeOf = (s) => (s?.attributes || []).find((a) => a.prop === "mgx:sourceType")?.value || "";

/**
 * Bounded recency multiplier in [RECENCY_FLOOR, 1] from an ISO-8601 createdAt.
 * A half-life decay: freshly written ≈ 1.0, ancient → RECENCY_FLOOR. An unknown
 * or unparseable timestamp yields 1.0 (no penalty) — recency only ever nudges
 * down from a full score, it never invents one.
 */
export function recencyNudge(createdAt, now = Date.now(), halfLifeMs = RECENCY_HALF_LIFE_MS) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 1;
  const ageMs = Math.max(0, now - t);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Pure trust for one Fact. `fact` supplies `{ sourceIds: [...], createdAt }`;
 * the Source individuals are resolved from `sourcesById` (a plain { id: Source }
 * map — exactly what a memory payload's Source individuals key into). Distinct
 * sources are corroborated by noisy-OR over their type priors and nudged by
 * recency. Deterministic given the same inputs and `opts.now`.
 *
 * opts:
 *   - now            (ms) reference time for recency; default Date.now()
 *   - halfLifeMs     recency half-life override
 *   - premiseTrusts  entailed hook: [trusts] of the conclusion's premise Facts
 *   - ruleConfidence entailed hook: the rule's confidence in [0,1] (default 1)
 *
 * Returns { score, inputs } — `inputs` (the source-type multiset, corroboration
 * count, createdAt and the recency multiplier) is stored alongside the score so
 * "why does this rank high?" is answerable from the record.
 */
export function computeTrust(fact, sourcesById = {}, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const ids = Array.isArray(fact?.sourceIds) ? fact.sourceIds : [];

  // distinct sources → their type priors
  const seen = new Set();
  const types = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = sourceTypeOf(sourcesById[id]);
    if (t) types.push(t);
  }

  // corroboration via noisy-OR over distinct-source priors, capped at 1
  let base = 0;
  let complement = 1;
  for (const t of types) complement *= 1 - (SOURCE_PRIOR[t] ?? 0);
  if (types.length) base = Math.min(1, 1 - complement);

  // entailed hook (tier-5): a conclusion is only as trustworthy as its weakest
  // premise × the rule confidence. Engages only when premises are supplied;
  // otherwise an entailed fact rides its bare prior through the noisy-OR above.
  if (types.includes("entailed") && Array.isArray(opts.premiseTrusts) && opts.premiseTrusts.length) {
    const rc = typeof opts.ruleConfidence === "number" ? opts.ruleConfidence : 1;
    base = Math.max(0, Math.min(1, Math.min(...opts.premiseTrusts) * rc));
  }

  const recency = recencyNudge(fact?.createdAt, now, opts.halfLifeMs);
  const score = round(Math.min(1, base * recency));
  const inputs = {
    sourceTypes: types.slice().sort(),
    corroboration: types.length,
    createdAt: fact?.createdAt || "",
    recency: round(recency),
  };
  return { score, inputs };
}
