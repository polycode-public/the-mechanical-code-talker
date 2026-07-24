// chatbench/rubrics.mjs — rubric compilation + judge down-tiering (PLAN lever 3).
//
// For the cases that still need judgment after delta-judging (lever 1) and tier
// promotion (lever 2), we author per-construction rubrics ONCE, as committed
// data (chatbench/rubrics.json): a short checklist of quotable criteria per
// construction family, over the same three-field-plus-rephrase 0|1|2 verdict
// schema. Then a small CALIBRATION set — cases graded at frontier tier — measures
// a cheaper judge model against the frontier grader per family; a family whose
// small-model agreement clears a threshold runs on the small model from then on.
// Re-calibrate only when a rubric changes.
//
// This module is the pure machinery: family mapping, the calibration-set
// selection, the per-family agreement metric, the down-tier gate, and the model
// pick. The REAL calibration run (frontier-grade the set, small-grade it, read
// the agreement) is a paid pass left to the coordinator — chatbench/calibrate.mjs
// dry-runs the selection and emits both prompt sets without calling a model.
//
// Invariant: down-tiering is calibration-GATED. A family only leaves the frontier
// model once measured agreement clears the threshold, so a cheaper judge is never
// trusted on a family it was not shown to agree on.

import { mulberry32, seededShuffle } from "../src/domain/seeded-random.mjs";
import { fnv1a32 } from "../src/domain/hash.mjs";

/** Validate a loaded rubrics.json: every family carries constructions[],
 *  dimensions[], criteria[]; no construction is claimed by two families. Returns
 *  an array of error strings (empty when valid). */
export function validateRubrics(rubrics) {
  const errors = [];
  const families = rubrics?.families;
  if (!families || typeof families !== "object") return ["rubrics: missing families object"];
  const claimed = new Map();
  for (const [name, fam] of Object.entries(families)) {
    if (!Array.isArray(fam.constructions)) errors.push(`family ${name}: constructions must be an array`);
    if (!Array.isArray(fam.dimensions) || !fam.dimensions.length) errors.push(`family ${name}: dimensions must be a non-empty array`);
    if (!Array.isArray(fam.criteria) || !fam.criteria.length) errors.push(`family ${name}: criteria must be a non-empty array`);
    for (const c of fam.constructions ?? []) {
      if (claimed.has(c)) errors.push(`construction "${c}" claimed by both ${claimed.get(c)} and ${name}`);
      claimed.set(c, name);
    }
  }
  return errors;
}

/** Build a construction -> family index from a rubrics object. */
export function familyIndex(rubrics) {
  const index = new Map();
  for (const [name, fam] of Object.entries(rubrics.families)) {
    for (const c of fam.constructions ?? []) index.set(c, name);
  }
  return index;
}

/** The rubric family for a construction (single or `a+b` combo). A combo drops
 *  its `noise` part and takes the family of the remaining construction; a combo
 *  of two real constructions is compositional, so it reads as "composition"; a
 *  pure `noise` surface reads as "surface-noise"; an unmapped single falls back
 *  to "composition" (the widest checklist). */
export function familyOf(construction, index) {
  if (construction == null) return null;
  if (construction === "noise") return "surface-noise";
  const parts = String(construction).split("+");
  if (parts.length === 1) return index.get(parts[0]) ?? "composition";
  const real = parts.filter((p) => p !== "noise");
  if (real.length === 0) return "surface-noise";
  if (real.length === 1) return index.get(real[0]) ?? "composition";
  return "composition";
}

/** The rubric family a product/pool row belongs to. */
export function rowFamily(row, index) {
  return familyOf(row.construction, index);
}

/** Group rows by rubric family — the unit the calibration measures and the
 *  batched judge (lever 6) groups a prompt over. Returns a Map family -> rows,
 *  each list id-sorted for determinism. */
export function groupByFamily(rows, index) {
  const groups = new Map();
  for (const row of rows) {
    const fam = rowFamily(row, index);
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam).push(row);
  }
  for (const list of groups.values()) list.sort((a, b) => String(a.caseId ?? a.id).localeCompare(String(b.caseId ?? b.id)));
  return groups;
}

/** Deterministically select the calibration set: up to `perFamily` graded cases
 *  from each rubric family, seeded so the same pool + seed yields the same set.
 *  ~50 cases across the ~11 families at perFamily 5. This is the set a human
 *  frontier-grades once; the machinery here only picks WHICH cases. */
export function selectCalibrationSet(pool, index, { perFamily = 5, seed = 20260724 } = {}) {
  const graded = pool.filter((c) => c.grade);
  const byFamily = groupByFamily(graded, index);
  const picked = [];
  for (const fam of [...byFamily.keys()].sort()) {
    const cases = byFamily.get(fam);
    const rng = mulberry32((seed ^ fnv1a32(fam)) >>> 0);
    picked.push(...seededShuffle(cases, rng).slice(0, perFamily));
  }
  return picked.sort((a, b) => String(a.id ?? a.caseId).localeCompare(String(b.id ?? b.caseId)));
}

/** The pass/fail BUCKET of a per-case judge reading, for the agreement metric:
 *  a case "passes" the judge when it did not hard-fail and its mean clears the
 *  floor. Bucketing (rather than raw mean equality) is what the agreement gate
 *  measures — does the cheap model reach the SAME verdict, not the same decimal. */
export function verdictBucket(caseSummary, { meanFloor = 1.5 } = {}) {
  if (!caseSummary || caseSummary.mean === null || caseSummary.mean === undefined) return null;
  if (caseSummary.hardFail) return "fail";
  return caseSummary.mean >= meanFloor ? "pass" : "fail";
}

/** Per-family agreement between a frontier grading and a small-model grading over
 *  the calibration cases: the fraction of comparable cases where the two reach
 *  the same verdict bucket. `frontierById`/`smallById` are maps caseId ->
 *  per-case summary. Returns family -> { n, agree, rate }. A case either side
 *  cannot bucket (voided, unscored) is excluded from that family's denominator. */
export function agreementByFamily(calibrationCases, frontierById, smallById, index, opts = {}) {
  const byFamily = groupByFamily(calibrationCases, index);
  const out = {};
  for (const fam of [...byFamily.keys()].sort()) {
    let n = 0;
    let agree = 0;
    for (const c of byFamily.get(fam)) {
      const id = c.id ?? c.caseId;
      const fb = verdictBucket(frontierById.get(id), opts);
      const sb = verdictBucket(smallById.get(id), opts);
      if (fb === null || sb === null) continue;
      n += 1;
      if (fb === sb) agree += 1;
    }
    out[fam] = { n, agree, rate: n ? agree / n : null };
  }
  return out;
}

/** The down-tier gate: a family may run on the small model iff its measured
 *  agreement clears `threshold` over at least `minCases` comparable calibration
 *  cases. A family with too few cases, or below threshold, stays on the frontier
 *  model. Returns family -> { downTier: boolean, rate, n, reason }. */
export function gateDownTier(agreement, { threshold = 0.9, minCases = 3 } = {}) {
  const gate = {};
  for (const [fam, a] of Object.entries(agreement)) {
    let downTier = false;
    let reason;
    if (a.n < minCases) reason = `only ${a.n} calibration case(s) (< ${minCases}) — stays frontier`;
    else if (a.rate === null || a.rate < threshold) reason = `agreement ${a.rate === null ? "—" : (a.rate * 100).toFixed(0) + "%"} < ${(threshold * 100).toFixed(0)}% — stays frontier`;
    else { downTier = true; reason = `agreement ${(a.rate * 100).toFixed(0)}% ≥ ${(threshold * 100).toFixed(0)}% over ${a.n} case(s) — down-tiered`; }
    gate[fam] = { downTier, rate: a.rate, n: a.n, reason };
  }
  return gate;
}

/** Pick the judge model for a row given the down-tier gate: the small model when
 *  the row's family is gated down, else the frontier model. A family absent from
 *  the gate (never calibrated) stays on the frontier model — the safe default. */
export function pickModel(row, gate, index, { frontierModel, smallModel }) {
  const fam = rowFamily(row, index);
  return gate?.[fam]?.downTier ? smallModel : frontierModel;
}

/** Render the calibration/down-tier decision as a plain-text table for a run's
 *  receipt (the coordinator reads this after the real calibration pass). */
export function renderDownTierTable(gate) {
  const lines = ["family | agreement | n | decision", "--- | --- | ---: | ---"];
  for (const fam of Object.keys(gate).sort()) {
    const g = gate[fam];
    lines.push(`${fam} | ${g.rate === null ? "—" : (g.rate * 100).toFixed(0) + "%"} | ${g.n} | ${g.downTier ? "small model" : "frontier"}`);
  }
  return lines.join("\n");
}
