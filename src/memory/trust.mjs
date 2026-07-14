// memory/trust.mjs — deterministic, explainable, auditable trust over a
// Fact's Sources. Trust = f(source-type prior, noisy-OR corroboration,
// recency decay), nudged by each Source's mgx:sourceReliability (neutral 1.0
// when absent). Entailed facts: min(premise trusts) × rule-confidence when
// premises are supplied, else the bare entailed prior. Pure, import-free of
// core.mjs; core.mjs materialises the result onto the Fact.

export const TRUST_SCORE_PROP = "mgx:trustScore";
export const TRUST_INPUTS_PROP = "mgx:trustInputs";

/** Source-type priors — computed from the Source's type only, never hand-set
 *  on a Fact directly. */
export const SOURCE_PRIOR = Object.freeze({
  operator: 1.0,
  teach: 0.95,
  provider: 0.9,
  corpus: 0.7,
  corpusWeak: 0.55,
  web: 0.4,
  extracted: 0.45,
  entailed: 0.3,
});

export const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENCY_FLOOR = 0.9; // recency multiplier stays within [0.9, 1.0]

// Actor-level (session-scoped) trust — a bounded nudge on a Source's type
// prior. Neutral (1.0) until core.mjs's recomputeSourceReliability writes it,
// so this stays additive-safe.
export const SOURCE_RELIABILITY_MIN = 0.5;
export const SOURCE_RELIABILITY_MAX = 1.5;
export const SOURCE_RELIABILITY_NEUTRAL = 1.0;

const round = (n, p = 6) => Number(n.toFixed(p));
const sourceTypeOf = (s) => (s?.attributes || []).find((a) => a.prop === "mgx:sourceType")?.value || "";

/** A Source's reliability multiplier: raw mgx:sourceReliability, clamped to
 *  [SOURCE_RELIABILITY_MIN, MAX], or neutral 1.0 when absent/unparseable. */
function sourceReliabilityOf(s) {
  const raw = (s?.attributes || []).find((a) => a.prop === "mgx:sourceReliability")?.value;
  if (raw === undefined) return SOURCE_RELIABILITY_NEUTRAL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SOURCE_RELIABILITY_NEUTRAL;
  return Math.max(SOURCE_RELIABILITY_MIN, Math.min(SOURCE_RELIABILITY_MAX, n));
}

/** Bounded recency multiplier in [RECENCY_FLOOR, 1], half-life decayed from
 *  createdAt. An unparseable timestamp yields 1.0 (no penalty). */
export function recencyNudge(createdAt, now = Date.now(), halfLifeMs = RECENCY_HALF_LIFE_MS) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 1;
  const ageMs = Math.max(0, now - t);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Pure trust for one Fact. `fact` supplies `{ sourceIds: [...], createdAt }`;
 * Source individuals resolve from `sourcesById` ({ id: Source }). Distinct
 * sources are corroborated by noisy-OR over their type priors and nudged by
 * recency. Deterministic given the same inputs and `opts.now`.
 *
 * opts: now, halfLifeMs, premiseTrusts/ruleConfidence (entailed hook).
 * Returns { score, inputs } — inputs recorded for audit.
 */
export function computeTrust(fact, sourcesById = {}, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const ids = Array.isArray(fact?.sourceIds) ? fact.sourceIds : [];

  // distinct sources -> type priors × mgx:sourceReliability, clamped to [0,1]
  const seen = new Set();
  const types = [];
  const priors = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const source = sourcesById[id];
    const t = sourceTypeOf(source);
    if (!t) continue;
    types.push(t);
    const p = (SOURCE_PRIOR[t] ?? 0) * sourceReliabilityOf(source);
    priors.push(Math.max(0, Math.min(1, p)));
  }

  // corroboration via noisy-OR over distinct-source EFFECTIVE priors, capped at 1
  let base = 0;
  let complement = 1;
  for (const p of priors) complement *= 1 - p;
  if (priors.length) base = Math.min(1, 1 - complement);

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

// Laplace/"add-k" pseudo-count: without it a single data point would saturate
// mgx:sourceReliability to the bare max/min immediately.
export const RELIABILITY_CONFIDENCE_PSEUDOCOUNT = 19;

/** Pure actor-level reliability from a session's asserted-vs-contradicted
 *  track record (findContradictions, core.mjs), confidence-scaled by sample
 *  size so a thin record stays near neutral (1.0). Bounded to
 *  [SOURCE_RELIABILITY_MIN, MAX]. A contradicted fact costs double an
 *  asserted one's weight. */
export function sessionReliabilityFrom({ factsAsserted = 0, factsContradicted = 0 } = {}) {
  const asserted = Math.max(0, Number(factsAsserted) || 0);
  const contradicted = Math.max(0, Number(factsContradicted) || 0);
  const net = Math.max(-1, Math.min(1, (asserted - 2 * contradicted) / Math.max(1, asserted)));
  const confidence = asserted / (asserted + RELIABILITY_CONFIDENCE_PSEUDOCOUNT);
  const ratio = (net * confidence + 1) / 2;
  return round(SOURCE_RELIABILITY_MIN + (SOURCE_RELIABILITY_MAX - SOURCE_RELIABILITY_MIN) * ratio);
}
