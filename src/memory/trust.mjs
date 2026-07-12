// memory/trust.mjs — deterministic, explainable, auditable trust over a Fact's
// Sources (PLAN_PROVENANCE_TRUST step (c)).
//
// Trust is a COMPUTED attribute of a Fact — never hand-set — a pure function of
// its Source edges, those Sources' types, and its mgx:createdAt. Three inputs
// combine:
//   - a Source-TYPE PRIOR (operator > teach > provider > corpus > web > entailed);
//   - CORROBORATION over the fact's distinct Sources by noisy-OR
//     (1 − Π(1 − wᵢ), capped at 1) — two independent web sources (0.4) reach
//     0.64, a lone operator fact is already 1.0;
//   - a bounded RECENCY nudge in [0.9, 1.0] from createdAt, half-life decayed —
//     the codegraph "capped nudge" philosophy, so recency breaks ties and
//     freshens but never flips a source-type ordering by itself.
//
// A fourth, per-Source bounded nudge folds into the type-prior term above (not a
// separate multiplicative stage): each Source may carry mgx:sourceReliability in
// [0.5, 1.5] (neutral 1.0 when absent, true of every Source until a session's
// actor-level trust — sessionReliabilityFrom, core.mjs's recomputeSourceReliability —
// starts writing it), so a session with a track record of corroborated facts
// nudges its own Source's contribution up, one contradicted repeatedly nudges it
// down — additive and safe: absent, every existing score is byte-identical.
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

/** Source-type priors — the ordering operator > teach > provider-graph >
 *  curated-corpus > weak-corpus > web > unverified-entailment. `teach` is the
 *  chat teach lane's natural-frame writes ("remember that …", "<Name> owns
 *  <X>") — still operator speech, but through a looser recognizer than the
 *  ACE-parsed operator assert, so it sits just below the operator prior. The
 *  entailed value is a FLOOR before premise adjustment (see the entailed hook
 *  below). `corpusWeak` is for corpus-sourced facts whose underlying relation
 *  is real but low-precision (ConceptNet's /r/RelatedTo — ambiguous.
 *  undirected association, unlike the specific typed relations the plain
 *  `corpus` prior covers) — still a curated, committed dataset (above `web`),
 *  just not asserting the same strength of claim (below `corpus`). Computed
 *  from the Source's type exactly like every other tier — never hand-set on
 *  a Fact directly. */
export const SOURCE_PRIOR = Object.freeze({
  operator: 1.0,
  teach: 0.95,
  provider: 0.9,
  corpus: 0.7,
  corpusWeak: 0.55,
  web: 0.4,
  entailed: 0.3,
});

export const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENCY_FLOOR = 0.9; // recency multiplier stays within [0.9, 1.0]

// Actor-level (session-scoped) trust — a bounded NUDGE on top of a Source's
// type prior, read off the same already-passed Source individual a fact's
// corroboration already resolves via sourceTypeOf. `mgx:sourceReliability`
// lives in [SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX], NEUTRAL (1.0,
// exactly — no rounding drift) when absent, which is true of every Source
// until core.mjs's recomputeSourceReliability starts writing it. Neutral-when-
// absent makes this safely additive: every existing score is byte-identical
// until something actually writes the attribute.
export const SOURCE_RELIABILITY_MIN = 0.5;
export const SOURCE_RELIABILITY_MAX = 1.5;
export const SOURCE_RELIABILITY_NEUTRAL = 1.0;

const round = (n, p = 6) => Number(n.toFixed(p));
const sourceTypeOf = (s) => (s?.attributes || []).find((a) => a.prop === "mgx:sourceType")?.value || "";

/** A Source's reliability multiplier: the raw mgx:sourceReliability attribute,
 *  clamped into [SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX] (a corrupt or
 *  out-of-range stored value is defended against, never trusted blindly), or
 *  the neutral 1.0 when the attribute is absent/unparseable. */
function sourceReliabilityOf(s) {
  const raw = (s?.attributes || []).find((a) => a.prop === "mgx:sourceReliability")?.value;
  if (raw === undefined) return SOURCE_RELIABILITY_NEUTRAL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SOURCE_RELIABILITY_NEUTRAL;
  return Math.max(SOURCE_RELIABILITY_MIN, Math.min(SOURCE_RELIABILITY_MAX, n));
}

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

  // distinct sources → their type priors, nudged by each Source's own
  // mgx:sourceReliability (neutral 1.0 when absent — see sourceReliabilityOf).
  // `types` stays the plain type multiset (the audit-trail shape callers/tests
  // already read off `inputs.sourceTypes` is unchanged); `priors` is the
  // per-source EFFECTIVE prior (type prior × reliability, clamped to [0,1])
  // the noisy-OR below actually corroborates over.
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

// How many facts a session needs to have amassed before its track record can
// swing mgx:sourceReliability with full confidence toward an extreme. Without
// this, a SINGLE data point saturates the score immediately (asserted=1,
// contradicted=0 → the bare max 1.5) — measured in practice, this broke the
// standing invariant that a lone, uncontradicted teach-sourced fact must
// still score below the operator prior (0.95 × 1.5 clamps past 1.0). This
// pseudo-count keeps a thin track record close to NEUTRAL and only lets a
// session earn a confident nudge once it has a real history — the classic
// Bayesian-smoothing shape (Laplace/"add-k" pseudo-count) for small-sample
// rates.
export const RELIABILITY_CONFIDENCE_PSEUDOCOUNT = 19;

/**
 * Pure actor-level (session-scoped) reliability from one session's track
 * record: how many facts it asserted vs. how many of those later turned out
 * to be CONTRADICTED (findContradictions, core.mjs). Bounded to
 * [SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX] — the same range
 * mgx:sourceReliability lives in (B1 above), so the result of this function is
 * exactly what a caller materialises onto a session's Source individual.
 *
 * Monotonic in the right direction: more uncontradicted assertions → closer to
 * the max (1.5); more contradicted ones → closer to the min (0.5) — but
 * CONFIDENCE-SCALED by sample size, so a session with only one or two
 * assertions stays close to neutral (1.0) either way, and only a real track
 * record (many assertions) earns a confident swing toward an extreme. Zero
 * assertions is exactly neutral (1.0) — no track record, no opinion, matching
 * the neutral default a Source without this attribute at all already gets
 * (sourceReliabilityOf above). The shape:
 *   net        = clamp[-1,1]((asserted − 2×contradicted) / max(1, asserted))
 *   confidence = asserted / (asserted + RELIABILITY_CONFIDENCE_PSEUDOCOUNT)
 *   ratio      = (net × confidence + 1) / 2         → [0, 1], 0.5 at confidence 0
 *   reliability = MIN + (MAX − MIN) × ratio
 * Each contradicted fact costs DOUBLE an asserted fact's worth of `net` (the
 * `2×` term), so a session that is right twice and wrong once nets a positive
 * but reduced score rather than a wash — corroboration should count for less
 * than the reputational cost of a contradiction. Deterministic, no I/O.
 */
export function sessionReliabilityFrom({ factsAsserted = 0, factsContradicted = 0 } = {}) {
  const asserted = Math.max(0, Number(factsAsserted) || 0);
  const contradicted = Math.max(0, Number(factsContradicted) || 0);
  const net = Math.max(-1, Math.min(1, (asserted - 2 * contradicted) / Math.max(1, asserted)));
  const confidence = asserted / (asserted + RELIABILITY_CONFIDENCE_PSEUDOCOUNT);
  const ratio = (net * confidence + 1) / 2;
  return round(SOURCE_RELIABILITY_MIN + (SOURCE_RELIABILITY_MAX - SOURCE_RELIABILITY_MIN) * ratio);
}
