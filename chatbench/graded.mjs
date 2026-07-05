// chatbench/graded.mjs — the graded-benchmark layer's pure logic (case-set v2,
// operator-specified 2026-07-04): CEFR band × construction cell registry,
// deterministic stratified sampling (with the dual-draw parallel-forms
// reliability check), ladder gating, cell-level promotion, and the per-grade /
// per-cell rollups. No engine imports here — run.mjs wires this around the
// product; generate-graded.mjs uses the same registry to author the pool.
//
// Design doc: chatbench/GRADED.md. The pool lives in chatbench/graded-pool.jsonl
// (a SEPARATE file — cases.jsonl keeps the frozen v1 48 untouched).

// ---- registries ----

/** CEFR bands, ascending — the ladder's rungs. */
export const GRADES = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** The TROG/CELF-adapted construction taxonomy (structure borrowed, items
 *  original — the licence rule in GRADED.md). */
export const CONSTRUCTIONS = [
  "naming-vocabulary",
  "svo-query",
  "pronoun-binding",
  "reversible-passive",
  "relative-embedded",
  "quantifier-counting",
  "negation",
  "temporal",
  "coordination-compositional",
  "discourse-reference",
  "assert-recall",
];

/** Combo cells may pair a construction with "noise" (a v1 surface dimension,
 *  not a construction of its own). */
export const COMBO_PARTS = [...CONSTRUCTIONS, "noise"];

/** A construction field is either one taxonomy entry or a "left+right" combo
 *  of two COMBO_PARTS. Returns null if valid, else an error string. */
export function validateConstruction(construction) {
  if (typeof construction !== "string" || !construction) return "construction must be a non-empty string";
  const parts = construction.split("+");
  if (parts.length === 1) {
    return CONSTRUCTIONS.includes(parts[0]) ? null : `unknown construction "${construction}"`;
  }
  if (parts.length === 2) {
    for (const p of parts) if (!COMBO_PARTS.includes(p)) return `unknown combo part "${p}" in "${construction}"`;
    if (parts[0] === parts[1]) return `combo "${construction}" pairs a part with itself`;
    return null;
  }
  return `construction "${construction}" has more than two parts`;
}

export const isCombo = (construction) => String(construction).includes("+");
export const cellKey = (c) => `${c.grade}:${c.construction}`;

/** The populated grade × construction matrix (GRADED.md documents the why).
 *  size = the POOL size the generator must produce per cell (50 default,
 *  25 where the surface space is narrower); the per-run SAMPLE is 10% with a
 *  5-item floor. slug is the id fragment: g-<band>-<slug>-<n>. */
export const GRADED_MATRIX = [
  { grade: "A1", construction: "naming-vocabulary", slug: "naming", size: 25 },
  { grade: "A1", construction: "svo-query", slug: "svo", size: 50 },
  { grade: "A1", construction: "quantifier-counting", slug: "count", size: 25 },
  { grade: "A2", construction: "naming-vocabulary", slug: "naming", size: 25 },
  { grade: "A2", construction: "svo-query", slug: "svo", size: 50 },
  { grade: "A2", construction: "quantifier-counting", slug: "count", size: 25 },
  { grade: "A2", construction: "pronoun-binding", slug: "pron", size: 25 },
  { grade: "A2", construction: "negation", slug: "neg", size: 25 },
  { grade: "A2", construction: "noise+svo-query", slug: "noise-svo", size: 25 },
  { grade: "B1", construction: "pronoun-binding", slug: "pron", size: 25 },
  { grade: "B1", construction: "negation", slug: "neg", size: 25 },
  { grade: "B1", construction: "reversible-passive", slug: "passive", size: 25 },
  { grade: "B1", construction: "temporal", slug: "temp", size: 25 },
  { grade: "B1", construction: "discourse-reference", slug: "disc", size: 25 },
  { grade: "B1", construction: "pronoun-binding+negation", slug: "pron-neg", size: 25 },
  { grade: "B1", construction: "discourse-reference+quantifier-counting", slug: "disc-count", size: 25 },
  { grade: "B2", construction: "reversible-passive", slug: "passive", size: 25 },
  { grade: "B2", construction: "relative-embedded", slug: "rel", size: 50 },
  { grade: "B2", construction: "coordination-compositional", slug: "coord", size: 50 },
  { grade: "B2", construction: "discourse-reference", slug: "disc", size: 25 },
  { grade: "B2", construction: "assert-recall", slug: "assert", size: 25 },
  { grade: "B2", construction: "quantifier-counting+temporal", slug: "count-temp", size: 25 },
  { grade: "B2", construction: "noise+pronoun-binding", slug: "noise-pron", size: 25 },
  { grade: "C1", construction: "temporal", slug: "temp", size: 25 },
  { grade: "C1", construction: "relative-embedded", slug: "rel", size: 25 },
  { grade: "C1", construction: "coordination-compositional", slug: "coord", size: 25 },
  { grade: "C1", construction: "assert-recall", slug: "assert", size: 25 },
  { grade: "C1", construction: "negation+relative-embedded", slug: "neg-rel", size: 25 },
  { grade: "C2", construction: "pronoun-binding", slug: "pron", size: 25 },
  { grade: "C2", construction: "relative-embedded", slug: "rel", size: 25 },
];

/** Grades whose reliably-passing cells are PROMOTED: their fixed 5-item
 *  promoted subsets run as always-run deterministic unit tests
 *  (test/chatbench-graded.test.mjs) and are FIXED in every sample (never
 *  sampled out). Promoting a future grade = appending its band name here. */
export const PROMOTED_GRADES = ["A1", "A2"];

/** Per-run sample floor per populated cell — keeps per-area performance
 *  statistically readable (operator spec). */
export const MIN_PER_CELL = 5;

/** Dual-draw agreement tolerance: |Δ pass-rate| ≤ 0.2 per cell (1 item of 5). */
export const AGREEMENT_TOLERANCE = 0.2;

// ---- deterministic randomness ----

/** FNV-1a 32-bit — turns a stamp/cell label into a seed. Sourced from the single
 *  hash module (src/hash.mjs) so the bench seed and the memory fact-id contract
 *  share ONE definition; output is byte-identical to the prior inline copy (the old
 *  mid-loop `>>> 0` was a no-op — proven by fuzz). Imported as a local binding (not
 *  a bare re-export) so this module's own seed derivation can call it too. */
import { fnv1a32 as fnv1a } from "../src/hash.mjs";
export { fnv1a };

/** mulberry32 PRNG — small, seedable, deterministic across platforms. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, driven by the supplied rng. */
export function seededShuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- case classification ----

/** A FRONTIER case documents a current weakness: some turn carries
 *  baselineFail:true without improvedIn (the desired behavior is stated but
 *  the engine does not exhibit it yet). Non-frontier cases are the reliability
 *  denominator everywhere (ladder, promotion, agreement pass-rates). */
export function isFrontierCase(c) {
  return (c.turns ?? []).some((t) => t.expect?.baselineFail === true && !t.expect?.improvedIn);
}

/** A product row is GREEN when tier-1 passed AND every documented-weakness
 *  turn it carries actually improved — i.e. the case behaves as DESIRED, not
 *  merely "did not fail". Frontier rows whose weakness still reproduces are
 *  not green (that is their job); this is the pass-rate agreement + rollups use. */
export function isGreenRow(row) {
  const t1 = row.tier1 ?? {};
  if (!t1.pass) return false;
  const improved = new Set(t1.improvedBaselineTurns ?? []);
  return (t1.baselineFailTurns ?? []).every((i) => improved.has(i));
}

/** The fixed promoted subset of one cell's pool: the first `n` non-frontier
 *  cases by id — deterministic, stable across regenerations, and exactly what
 *  the always-run unit tests execute. */
export function promotedSubset(cellCases, n = MIN_PER_CELL) {
  return cellCases
    .filter((c) => !isFrontierCase(c))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, n);
}

// ---- stratified sampling + dual draws ----

function groupByCell(cases) {
  const map = new Map();
  const idOf = (c) => c.id ?? c.caseId; // pool cases carry id; product rows carry caseId
  for (const c of cases) {
    const key = cellKey(c);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }
  for (const list of map.values()) list.sort((a, b) => idOf(a).localeCompare(idOf(b)));
  return map;
}

/** One stratified draw over the graded pool: per grade×construction cell,
 *  max(minPerCell, round(fraction × poolSize)) items, seeded per cell so a
 *  draw is reproducible from (seed, fraction) alone. Cells of PROMOTED grades
 *  return their FIXED promoted subset (never sampled out — spec 3a).
 *  `exclude` (a Set of ids) supports the dual draw's without-replacement rule:
 *  excluded items are avoided while the cell can still fill the quota without
 *  them, otherwise the remainder is topped up from the full cell. */
export function stratifiedSample(cases, { fraction = 0.1, seed = 1, minPerCell = MIN_PER_CELL, promotedGrades = PROMOTED_GRADES, exclude = new Set() } = {}) {
  const byCell = groupByCell(cases);
  const picked = [];
  for (const [key, cell] of [...byCell.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const grade = cell[0].grade;
    if (promotedGrades.includes(grade)) {
      const fixed = promotedSubset(cell, minPerCell);
      // pad with frontier items (still deterministic) if the cell has too few
      // non-frontier cases to fill the promoted quota
      const padding = cell.filter((c) => !fixed.includes(c)).slice(0, Math.max(0, minPerCell - fixed.length));
      picked.push(...fixed, ...padding);
      continue;
    }
    const need = Math.min(cell.length, Math.max(minPerCell, Math.round(fraction * cell.length)));
    const rng = mulberry32((seed ^ fnv1a(key)) >>> 0);
    const shuffled = seededShuffle(cell, rng);
    const fresh = shuffled.filter((c) => !exclude.has(c.id));
    const take = fresh.slice(0, need);
    if (take.length < need) take.push(...shuffled.filter((c) => exclude.has(c.id)).slice(0, need - take.length));
    picked.push(...take);
  }
  return picked;
}

/** The DUAL DRAW (parallel-forms reliability): two independent stratified
 *  draws with distinct seeds; within each cell draw B samples WITHOUT
 *  REPLACEMENT against draw A where the pool is deep enough (a cell of ≥ 2×
 *  quota shares no item between draws). Promoted-grade cells are the same
 *  fixed subset in both draws by design (they are the instrument's anchor). */
export function dualDraws(cases, { fraction = 0.1, seedA = 1, seedB = 2, minPerCell = MIN_PER_CELL, promotedGrades = PROMOTED_GRADES } = {}) {
  const a = stratifiedSample(cases, { fraction, seed: seedA, minPerCell, promotedGrades });
  const promoted = new Set(a.filter((c) => promotedGrades.includes(c.grade)).map((c) => c.id));
  const exclude = new Set(a.filter((c) => !promoted.has(c.id)).map((c) => c.id));
  const b = stratifiedSample(cases, { fraction, seed: seedB, minPerCell, promotedGrades, exclude });
  return { a, b };
}

// ---- agreement (the instrument's self-test) ----

function rate(rows) {
  const green = rows.filter(isGreenRow).length;
  return { n: rows.length, green, rate: rows.length ? green / rows.length : null };
}

/** Compare draw A vs draw B per cell on tier-1 pass-rate (green-rate). A cell
 *  whose |Δ| exceeds the tolerance DISAGREES: the benchmark under-covers that
 *  cell's volatility (instrument failure, not product signal) — it is flagged
 *  UNDER-COVERED with the grow-the-pool prescription and must be excluded
 *  from cycle PASS/FAIL statistics until it agrees. */
export function computeAgreement(rowsA, rowsB, { tolerance = AGREEMENT_TOLERANCE } = {}) {
  const cellsA = groupByCell(rowsA.filter((r) => r.grade));
  const cellsB = groupByCell(rowsB.filter((r) => r.grade));
  const keys = [...new Set([...cellsA.keys(), ...cellsB.keys()])].sort();
  const cells = keys.map((key) => {
    const [grade, construction] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const a = rate(cellsA.get(key) ?? []);
    const b = rate(cellsB.get(key) ?? []);
    const measurable = a.rate !== null && b.rate !== null;
    const delta = measurable ? Math.abs(a.rate - b.rate) : null;
    // 1e-9 epsilon: pass-rates are small fractions (n/5), so raw float
    // subtraction can land a hair above the tolerance (0.8 - 0.6 > 0.2).
    const verdict = !measurable ? "UNMEASURED" : delta <= tolerance + 1e-9 ? "AGREE" : "DISAGREE";
    return {
      grade, construction, combo: isCombo(construction),
      a, b, delta,
      verdict,
      ...(verdict === "DISAGREE"
        ? { underCovered: true, prescription: "grow this cell's pool and/or per-run sample; exclude the cell from cycle PASS/FAIL statistics until it agrees (unmeasured, not failed)" }
        : {}),
    };
  });
  const measured = cells.filter((c) => c.verdict !== "UNMEASURED");
  const agree = measured.filter((c) => c.verdict === "AGREE").length;
  return {
    tolerance,
    cells,
    overall: {
      cells: cells.length,
      measured: measured.length,
      agree,
      disagree: measured.length - agree,
      agreementRate: measured.length ? agree / measured.length : null,
      underCovered: cells.filter((c) => c.underCovered).map((c) => `${c.grade}:${c.construction}`),
    },
  };
}

/** Render the agreement table (plain text, for the runner's stdout). */
export function renderAgreementTable(agreement) {
  const fmt = (r) => (r.rate === null ? "—" : `${r.green}/${r.n} (${r.rate.toFixed(2)})`);
  const lines = [
    "cell | draw A | draw B | |Δ| | verdict",
    "--- | --- | --- | --- | ---",
    ...agreement.cells.map((c) =>
      `${c.grade} ${c.construction}${c.combo ? " [combo]" : ""} | ${fmt(c.a)} | ${fmt(c.b)} | ${c.delta === null ? "—" : c.delta.toFixed(2)} | ${c.verdict}${c.underCovered ? " (UNDER-COVERED)" : ""}`),
    `overall agreement: ${agreement.overall.agree}/${agreement.overall.measured} cells (${agreement.overall.agreementRate === null ? "—" : (agreement.overall.agreementRate * 100).toFixed(0) + "%"}) at tolerance ${agreement.tolerance}`,
  ];
  return lines.join("\n");
}

// ---- ladder gating ----

/** Reliability of one grade over its evaluated rows: every NON-FRONTIER case
 *  passed tier-1. Frontier cases are the ladder's documented weaknesses — they
 *  never block the climb (a grade of only ceiling markers is vacuously
 *  reliable; its job is to stay on the record). */
export function gradeReliability(rows) {
  const real = rows.filter((r) => !(r.tier1?.baselineFailTurns ?? []).some((i) => !(r.tier1?.improvedBaselineTurns ?? []).includes(i)));
  const passing = real.filter((r) => r.tier1?.pass).length;
  return {
    total: rows.length,
    real: real.length,
    passing,
    frontier: rows.length - real.length,
    reliable: passing === real.length,
  };
}

/** The ladder plan: given per-grade evaluated results ascending, the first
 *  unreliable grade gates — every grade above it is SKIPPED with a receipt
 *  ("grade B2 skipped: B1 at 4/6"). Used by run.mjs --ladder interleaved with
 *  execution; pure here so the gating rule is unit-testable. */
export function ladderGate(reliabilityByGrade, grades = GRADES) {
  const present = grades.filter((g) => reliabilityByGrade[g]);
  for (const g of present) {
    const r = reliabilityByGrade[g];
    if (!r.reliable) {
      const above = present.slice(present.indexOf(g) + 1);
      return { gateAt: g, skip: above, reason: `${g} at ${r.passing}/${r.real}` };
    }
  }
  return { gateAt: null, skip: [], reason: null };
}

// ---- rollups ----

/** Per-grade + per-cell rollup over graded product rows, single vs combo
 *  separated so a weak area is diagnosable as weak ALONE or in COMBINATION. */
export function gradedRollup(rows) {
  const graded = rows.filter((r) => r.grade);
  const grades = [];
  for (const grade of GRADES) {
    const ofGrade = graded.filter((r) => r.grade === grade);
    if (!ofGrade.length) continue;
    const cells = [];
    for (const construction of [...new Set(ofGrade.map((r) => r.construction))].sort()) {
      const cellRows = ofGrade.filter((r) => r.construction === construction);
      cells.push({
        construction,
        combo: isCombo(construction),
        n: cellRows.length,
        green: cellRows.filter(isGreenRow).length,
        frontier: cellRows.filter((r) => (r.tier1?.baselineFailTurns ?? []).some((i) => !(r.tier1?.improvedBaselineTurns ?? []).includes(i))).length,
      });
    }
    const single = cells.filter((c) => !c.combo);
    const combo = cells.filter((c) => c.combo);
    const sum = (list, k) => list.reduce((acc, c) => acc + c[k], 0);
    grades.push({
      grade,
      cells,
      single: { n: sum(single, "n"), green: sum(single, "green"), frontier: sum(single, "frontier") },
      combo: { n: sum(combo, "n"), green: sum(combo, "green"), frontier: sum(combo, "frontier") },
    });
  }
  return grades;
}

/** Render the rollup for stdout. */
export function renderRollup(rollup) {
  const lines = [];
  for (const g of rollup) {
    const part = (p, label) => (p.n ? ` ${label} ${p.green}/${p.n} green (${p.frontier} frontier)` : "");
    lines.push(`  ${g.grade}:${part(g.single, "single")}${part(g.combo, "| combo")}`);
    for (const c of g.cells) {
      lines.push(`    ${c.construction}${c.combo ? " [combo]" : ""}: ${c.green}/${c.n} green, ${c.frontier} frontier`);
    }
  }
  return lines.join("\n");
}
