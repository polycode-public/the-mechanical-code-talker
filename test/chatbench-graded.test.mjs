// chatbench-graded tests — the graded benchmark's harness (chatbench/GRADED.md):
// (a) graded-pool.jsonl lint (schema, unique ids, grade/construction enums,
//     cell coverage matching GRADED_MATRIX, frontier discipline);
// (b) the sampling machinery (stratified seeded draws, the dual draw's
//     without-replacement rule, fixed promoted subsets);
// (c) the agreement computation (parallel-forms reliability verdicts);
// (d) ladder gating logic;
// (e) the PROMOTED ALWAYS-RUN set: every promoted grade's fixed 5-item cell
//     subsets replayed through the REAL engine as deterministic, judge-free
//     unit tests (grade promotion per the operator: reliably-passing lower
//     grades become always-run tests). Promoting a future grade = adding its
//     band name to the PROMOTED_GRADES array in chatbench/graded.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  GRADES, CONSTRUCTIONS, COMBO_PARTS, GRADED_MATRIX, PROMOTED_GRADES,
  MIN_PER_CELL, AGREEMENT_TOLERANCE, CELL_SAMPLE,
  validateConstruction, isCombo, cellKey, fnv1a, mulberry32, seededShuffle,
  isFrontierCase, isGreenRow, promotedSubset, stratifiedSample, dualDraws,
  computeAgreement, renderAgreementTable, gradeReliability, ladderGate,
  gradedRollup, isProductiveRow, isTemplateLane, bandScore, templateLaneLint,
  timingBucket, timingRollup, renderTimings,
} from "../chatbench/graded.mjs";
import {
  parseCases, summarizeTier1, runTurnsCase, runSessionCase, createRunnerDeps,
  runGradedDraw,
} from "../chatbench/run.mjs";

// The per-run sample size a cell draws: its CELL_SAMPLE override (census cells,
// grown for dual-draw reliability) else the MIN_PER_CELL floor.
const cellSample = (cell) => CELL_SAMPLE[cellKey(cell)] ?? MIN_PER_CELL;

const POOL_FILE = fileURLToPath(new URL("../chatbench/graded-pool.jsonl", import.meta.url));
const CASES_FILE = fileURLToPath(new URL("../chatbench/cases.jsonl", import.meta.url));

const poolText = await readFile(POOL_FILE, "utf8");
const { cases: pool, errors: poolErrors } = parseCases(poolText);

// ---- (a) pool lint ----

test("graded pool: parses clean through the shared case lint", () => {
  assert.deepEqual(poolErrors, [], "lint errors");
  assert.ok(pool.length >= 500, `a real pool (got ${pool.length})`);
});

test("graded pool: every case carries grade + construction + the graded tag; ids are unique, well-formed, and band-consistent", async () => {
  const seen = new Set();
  for (const c of pool) {
    assert.ok(GRADES.includes(c.grade), `${c.id}: grade`);
    assert.equal(validateConstruction(c.construction), null, `${c.id}: construction "${c.construction}"`);
    assert.deepEqual(c.tags, ["graded"], `${c.id}: tags`);
    assert.match(c.id, /^g-(a1|a2|b1|b2|c1|c2)-[a-z][a-z-]*-\d+$/, `${c.id}: id shape`);
    assert.ok(c.id.startsWith(`g-${c.grade.toLowerCase()}-`), `${c.id}: id band matches grade field`);
    assert.ok(!seen.has(c.id), `${c.id}: duplicate id`);
    seen.add(c.id);
    assert.ok(Array.isArray(c.judge?.dimensions) && c.judge.dimensions.length, `${c.id}: judge dimensions`);
    assert.ok(typeof c.judge?.context === "string" && c.judge.context.length, `${c.id}: judge context`);
    if (c.mode === "session") assert.equal(c.graph, "fixture", `${c.id}: session cases run over the seeded fixture`);
  }
  // no collision with the frozen v1 set
  const { cases: v1 } = parseCases(await readFile(CASES_FILE, "utf8"));
  for (const c of pool) assert.ok(!v1.some((v) => v.id === c.id), `${c.id} collides with cases.jsonl`);
  assert.equal(v1.length, 48, "the v1 case set is untouched (48 cases)");
});

test("graded pool: cell coverage matches GRADED_MATRIX exactly (the design doc's matrix is enforced, not aspirational)", () => {
  const byCell = new Map();
  for (const c of pool) byCell.set(cellKey(c), (byCell.get(cellKey(c)) ?? 0) + 1);
  assert.equal(byCell.size, GRADED_MATRIX.length, "no unregistered cells");
  for (const cell of GRADED_MATRIX) {
    assert.equal(byCell.get(cellKey(cell)), cell.size, `cell ${cellKey(cell)} pool size`);
    assert.ok(cell.size >= 25, `cell ${cellKey(cell)} meets the 25-item pool floor`);
  }
});

test("graded pool: frontier discipline — baselineFail turns record the observed answer; enforced turns never carry one", () => {
  for (const c of pool) {
    for (const [i, turn] of c.turns.entries()) {
      if (turn.expect?.baselineFail) {
        assert.ok(typeof turn.observed === "string" && turn.observed.length,
          `${c.id} turn ${i + 1}: a documented weakness records the honest current answer`);
      } else {
        assert.equal(turn.observed, undefined, `${c.id} turn ${i + 1}: observed is a frontier-only record`);
      }
    }
  }
});

test("graded pool: every promoted-grade cell has a full fixed promoted subset of passing cases", () => {
  for (const cell of GRADED_MATRIX.filter((c) => PROMOTED_GRADES.includes(c.grade))) {
    const cellCases = pool.filter((c) => cellKey(c) === cellKey(cell));
    const subset = promotedSubset(cellCases);
    assert.equal(subset.length, MIN_PER_CELL, `${cellKey(cell)}: ${MIN_PER_CELL} non-frontier cases to promote`);
    for (const c of subset) assert.ok(!isFrontierCase(c), `${c.id} promoted but frontier`);
  }
});

test("construction validator: taxonomy entries, two-part combos (incl. noise), rejects junk", () => {
  for (const c of CONSTRUCTIONS) assert.equal(validateConstruction(c), null);
  assert.equal(validateConstruction("noise+svo-query"), null);
  assert.equal(validateConstruction("pronoun-binding+negation"), null);
  assert.match(validateConstruction("winograd"), /unknown construction/);
  assert.match(validateConstruction("noise+bogus"), /unknown combo part/);
  assert.match(validateConstruction("negation+negation"), /itself/);
  assert.match(validateConstruction("a+b+c"), /more than two/);
  assert.ok(isCombo("noise+svo-query"));
  assert.ok(!isCombo("svo-query"));
  assert.ok(COMBO_PARTS.includes("noise"));
});

// ---- (b) sampling ----

test("stratifiedSample: deterministic per seed, 5-per-cell floor, promoted grades fixed", () => {
  const s1 = stratifiedSample(pool, { fraction: 0.1, seed: 42 });
  const s2 = stratifiedSample(pool, { fraction: 0.1, seed: 42 });
  assert.deepEqual(s1.map((c) => c.id), s2.map((c) => c.id), "same seed → same draw");
  const s3 = stratifiedSample(pool, { fraction: 0.1, seed: 43 });
  assert.notDeepEqual(s1.map((c) => c.id), s3.map((c) => c.id), "different seed → different draw");
  const byCell = new Map();
  for (const c of s1) byCell.set(cellKey(c), (byCell.get(cellKey(c)) ?? 0) + 1);
  assert.equal(byCell.size, GRADED_MATRIX.length, "every cell represented");
  for (const [key, n] of byCell) {
    const expected = CELL_SAMPLE[key] ?? MIN_PER_CELL; // census cells draw their full override
    assert.equal(n, expected, `${key}: draws ${expected} (10% of 25/50 floors at ${MIN_PER_CELL}, census cells draw their override)`);
  }
  // promoted grades: the FIXED promoted subset regardless of seed
  for (const grade of PROMOTED_GRADES) {
    const fixed1 = s1.filter((c) => c.grade === grade).map((c) => c.id).sort();
    const fixed3 = s3.filter((c) => c.grade === grade).map((c) => c.id).sort();
    assert.deepEqual(fixed1, fixed3, `${grade} cells are never sampled out`);
  }
});

test("dualDraws: distinct seeds, no within-cell overlap for non-promoted cells, identical fixed subsets for promoted + census cells", () => {
  const { a, b } = dualDraws(pool, { fraction: 0.1, seedA: 7, seedB: 8 });
  const aIds = new Set(a.map((c) => c.id));
  // a census cell (CELL_SAMPLE ≥ pool size) is fully drawn in BOTH draws, so it
  // overlaps by design (that is what makes it always agree); every other
  // non-promoted cell has pool ≥ 2× quota so draw B shares nothing with A.
  const censusCell = (c) => (CELL_SAMPLE[cellKey(c)] ?? 0) >= (GRADED_MATRIX.find((m) => cellKey(m) === cellKey(c))?.size ?? Infinity);
  for (const c of b) {
    if (PROMOTED_GRADES.includes(c.grade) || censusCell(c)) {
      assert.ok(aIds.has(c.id), `${c.id}: promoted/census cases identical across draws`);
    } else {
      assert.ok(!aIds.has(c.id), `${c.id}: pools are ≥ 2× the quota, so draw B shares nothing with draw A`);
    }
  }
  assert.equal(a.length, b.length, "parallel forms are the same shape");
  // the census cells guarantee agreement: both draws hold the identical full cell.
  for (const key of Object.keys(CELL_SAMPLE)) {
    const ca = a.filter((c) => cellKey(c) === key).map((c) => c.id).sort();
    const cb = b.filter((c) => cellKey(c) === key).map((c) => c.id).sort();
    assert.deepEqual(ca, cb, `${key}: census cell is the identical full set in both draws → |Δ green-rate| = 0`);
  }
});

test("stratifiedSample: exclude tops up from the excluded set only when the cell runs dry", () => {
  const cell = pool.filter((c) => cellKey(c) === "C2:pronoun-binding"); // 25 items
  const all = new Set(cell.map((c) => c.id));
  // exclude 22 of 25 → only 3 fresh remain; the draw must still deliver 5
  const exclude = new Set([...all].slice(0, 22));
  const draw = stratifiedSample(cell, { fraction: 0.1, seed: 1, exclude, promotedGrades: [] });
  assert.equal(draw.length, MIN_PER_CELL);
  const fresh = draw.filter((c) => !exclude.has(c.id));
  assert.equal(fresh.length, 3, "every still-fresh item is preferred before reuse");
});

test("prng + shuffle: deterministic and platform-stable", () => {
  const r1 = mulberry32(123);
  const r2 = mulberry32(123);
  assert.equal(r1(), r2());
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], mulberry32(9)), seededShuffle([1, 2, 3, 4, 5], mulberry32(9)));
  assert.equal(fnv1a("graded-smoke"), fnv1a("graded-smoke"));
  assert.notEqual(fnv1a("a"), fnv1a("b"));
});

// ---- (c) agreement (the instrument's self-test) ----

const row = (id, grade, construction, { pass = true, bf = [], improved = [] } = {}) => ({
  caseId: id, grade, construction,
  tier1: { pass, baselineFailTurns: bf, improvedBaselineTurns: improved, failing: [], checksTotal: 1, checksFailed: pass ? 0 : 1 },
});

test("isGreenRow / isFrontierCase: green = passed AND every documented weakness improved", () => {
  assert.ok(isGreenRow(row("x", "B1", "negation")));
  assert.ok(!isGreenRow(row("x", "B1", "negation", { pass: false })));
  assert.ok(!isGreenRow(row("x", "B1", "negation", { bf: [0] })), "an unimproved frontier row is not green — that is its job");
  assert.ok(isGreenRow(row("x", "B1", "negation", { bf: [0], improved: [0] })), "an improved weakness counts green");
  assert.ok(isFrontierCase({ turns: [{ expect: { baselineFail: true } }] }));
  assert.ok(!isFrontierCase({ turns: [{ expect: { baselineFail: true, improvedIn: "003" } }] }), "a fixed weakness is enforced, no longer frontier");
  assert.ok(!isFrontierCase({ turns: [{ expect: { miss: true } }] }));
});

test("computeAgreement: AGREE within tolerance (float-safe at exactly 0.2), DISAGREE flags UNDER-COVERED with the prescription", () => {
  const a = [
    ...[1, 2, 3, 4].map((i) => row(`p${i}`, "B1", "negation")), row("p5", "B1", "negation", { pass: false }), // 0.8
    ...[1, 2, 3, 4, 5].map((i) => row(`q${i}`, "B1", "temporal")), // 1.0
  ];
  const b = [
    ...[1, 2, 3].map((i) => row(`r${i}`, "B1", "negation")), row("r4", "B1", "negation", { pass: false }), row("r5", "B1", "negation", { pass: false }), // 0.6
    ...[1, 2].map((i) => row(`s${i}`, "B1", "temporal")), ...[3, 4, 5].map((i) => row(`s${i}`, "B1", "temporal", { pass: false })), // 0.4
  ];
  const agreement = computeAgreement(a, b, {});
  const neg = agreement.cells.find((c) => c.construction === "negation");
  assert.equal(neg.verdict, "AGREE", "0.8 vs 0.6 is exactly the 1-in-5 tolerance (float epsilon applied)");
  const temp = agreement.cells.find((c) => c.construction === "temporal");
  assert.equal(temp.verdict, "DISAGREE");
  assert.equal(temp.underCovered, true);
  assert.match(temp.prescription, /grow this cell's pool/);
  assert.match(temp.prescription, /unmeasured, not failed/);
  assert.equal(agreement.overall.agree, 1);
  assert.equal(agreement.overall.disagree, 1);
  assert.equal(agreement.overall.agreementRate, 0.5);
  assert.deepEqual(agreement.overall.underCovered, ["B1:temporal"]);
  assert.equal(agreement.tolerance, AGREEMENT_TOLERANCE);
  const table = renderAgreementTable(agreement);
  assert.match(table, /B1 temporal \| .* \| DISAGREE \(UNDER-COVERED\)/);
  assert.match(table, /overall agreement: 1\/2 cells \(50%\)/);
});

test("computeAgreement: a cell present in only one draw is UNMEASURED, never a disagreement", () => {
  const agreement = computeAgreement([row("a", "C2", "relative-embedded")], []);
  assert.equal(agreement.cells[0].verdict, "UNMEASURED");
  assert.equal(agreement.overall.measured, 0);
  assert.equal(agreement.overall.agreementRate, null);
});

// ---- (d) ladder ----

test("gradeReliability: frontier cases never block the climb; a failing enforced case does", () => {
  const rows = [
    row("a", "B1", "temporal"),
    row("b", "B1", "temporal", { bf: [0] }), // frontier: excluded from the denominator
    row("c", "B1", "negation", { pass: false }),
  ];
  const r = gradeReliability(rows);
  assert.equal(r.total, 3);
  assert.equal(r.real, 2);
  assert.equal(r.passing, 1);
  assert.equal(r.frontier, 1);
  assert.equal(r.reliable, false);
  assert.equal(gradeReliability([row("x", "C2", "pronoun-binding", { bf: [0] })]).reliable, true,
    "a grade of only ceiling markers is vacuously reliable");
});

test("ladderGate: the first unreliable grade gates everything above it, with a receipt", () => {
  const gate = ladderGate({
    A1: { reliable: true, passing: 15, real: 15 },
    A2: { reliable: true, passing: 30, real: 30 },
    B1: { reliable: false, passing: 4, real: 6 },
    B2: { reliable: true, passing: 5, real: 5 },
    C1: { reliable: true, passing: 5, real: 5 },
  });
  assert.equal(gate.gateAt, "B1");
  assert.deepEqual(gate.skip, ["B2", "C1"]);
  assert.equal(gate.reason, "B1 at 4/6");
  const open = ladderGate({ A1: { reliable: true, passing: 1, real: 1 } });
  assert.equal(open.gateAt, null);
  assert.deepEqual(open.skip, []);
});

test("gradedRollup: per-grade cells with single vs combo separated (the weak-alone vs weak-in-combination diagnosis)", () => {
  const rows = [
    row("1", "B1", "negation"),
    row("2", "B1", "negation", { bf: [0] }),
    row("3", "B1", "pronoun-binding+negation", { bf: [0] }),
    row("4", "A1", "svo-query"),
  ];
  const rollup = gradedRollup(rows);
  assert.deepEqual(rollup.map((g) => g.grade), ["A1", "B1"], "grades ascending");
  const b1 = rollup.find((g) => g.grade === "B1");
  assert.deepEqual(b1.single, { n: 2, green: 1, frontier: 1 });
  assert.deepEqual(b1.combo, { n: 1, green: 0, frontier: 1 });
  const comboCell = b1.cells.find((c) => c.combo);
  assert.equal(comboCell.construction, "pronoun-binding+negation");
});

// ---- dual banding + template-lane (PLAN_FORMULAIC_COMPETENCE.md) ----

// a row with an explicit via + tags for band accounting.
const brow = (id, grade, construction, { pass = true, via = "composed", tags = ["graded"] } = {}) => ({
  caseId: id, grade, construction, via, tags,
  tier1: { pass, baselineFailTurns: [], improvedBaselineTurns: [], failing: [], checksTotal: 1, checksFailed: pass ? 0 : 1 },
});

test("dual banding: productive counts composed greens only; performance counts every green; gap ≥ 0", () => {
  const rows = [
    brow("1", "C1", "temporal", { via: "composed" }),        // green + composed → both bands
    brow("2", "C1", "temporal", { via: "template" }),        // green + template → performance only
    brow("3", "C1", "temporal", { via: "count" }),           // green + count → performance only
    brow("4", "C1", "temporal", { via: "composed", pass: false }), // not green → neither
  ];
  const b = bandScore(rows);
  assert.equal(b.n, 4);
  assert.equal(b.performance.green, 3, "three greens by any via");
  assert.equal(b.productive.green, 1, "one green is composed");
  assert.ok(Math.abs(b.gap - (3 / 4 - 1 / 4)) < 1e-9, "gap = perf rate − prod rate");
  assert.ok(b.gap >= 0, "productive greens are a subset of performance greens");
  assert.ok(isProductiveRow(brow("x", "C1", "temporal", { via: "composed" })));
  assert.ok(!isProductiveRow(brow("x", "C1", "temporal", { via: "template" })));
});

test("template-lane invariant: a template-carried pass RAISES performance and NEVER productive", () => {
  const base = [brow("p1", "C1", "temporal", { via: "composed" })]; // one composed green
  const before = bandScore(base);
  // add a template-lane pass carried by a template (the faked level)
  const withTemplate = [...base, brow("t1", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] })];
  const after = bandScore(withTemplate);
  assert.equal(after.performance.green, before.performance.green + 1, "performance band rises by the template pass");
  assert.equal(after.productive.green, before.productive.green, "productive band NEVER moves for a template pass");
  assert.ok(after.gap > before.gap, "the band gap widens by exactly the acquired chunk");
  assert.ok(isTemplateLane(withTemplate[1]) && !isProductiveRow(withTemplate[1]));
});

test("templateLaneLint: flags a template-lane row that passed via:composed (not actually faking the level)", () => {
  const rows = [
    brow("ok", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] }), // clean
    brow("bad", "C1", "temporal", { via: "composed", tags: ["graded", "template-lane"] }), // composed green under a template-lane tag
    brow("plain", "C1", "temporal", { via: "composed" }), // not template-lane → ignored
  ];
  const findings = templateLaneLint(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].caseId, "bad");
  assert.match(findings[0].finding, /not faking the level/);
});

test("gradedRollup: cells + grades carry the two-band score and gap; template-lane rows are counted", () => {
  const rows = [
    brow("1", "C1", "temporal", { via: "composed" }),
    brow("2", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] }),
  ];
  const g = gradedRollup(rows).find((x) => x.grade === "C1");
  assert.equal(g.bands.performance.green, 2);
  assert.equal(g.bands.productive.green, 1);
  const cell = g.cells.find((c) => c.construction === "temporal");
  assert.equal(cell.bands.performance.green, 2);
  assert.equal(cell.bands.productive.green, 1);
  assert.equal(cell.templateLane, 1, "one template-lane row in the cell");
  assert.ok(renderRollupHasBand(g));
});

function renderRollupHasBand(grade) {
  return grade.bands && typeof grade.bands.gap === "number";
}

// ---- timings (cycle-005 per-CEFR-grade wall-clock rollup) ----

// a product row carrying a synthetic replay time and (optionally) a grade.
const trow = (id, timingMs, grade) => ({ caseId: id, timingMs, ...(grade ? { grade } : {}) });

test("timingRollup: sums per-CEFR-grade + v1-spine totals and means correctly over a synthetic row set", () => {
  const rows = [
    trow("v1", 10),          // ungraded → v1 spine
    trow("v2", 30),          // ungraded → v1 spine
    trow("a1a", 4, "A1"),
    trow("a1b", 6, "A1"),
    trow("b1a", 20, "B1"),
    trow("b1b", 40, "B1"),
    trow("b1c", 60, "B1"),
  ];
  const t = timingRollup(rows, { wallMs: 250 });

  assert.equal(t.wallMs, 250, "wall-time threaded through unchanged");

  // all rows: total = 10+30+4+6+20+40+60 = 170 over 7 rows.
  assert.equal(t.all.n, 7);
  assert.equal(t.all.totalMs, 170);
  assert.ok(Math.abs(t.all.meanMs - 170 / 7) < 1e-9, "mean ms per row over the whole set");

  // v1 spine (ungraded): 10 + 30 = 40 over 2 rows, mean 20.
  assert.equal(t.spine.label, "v1-spine");
  assert.deepEqual({ n: t.spine.n, total: t.spine.totalMs, mean: t.spine.meanMs }, { n: 2, total: 40, mean: 20 });

  // grades ascending, only the populated ones (A1, B1 — no A2/B2/C1/C2 here).
  assert.deepEqual(t.grades.map((g) => g.label), ["A1", "B1"], "only populated grades, ascending");
  const a1 = t.grades.find((g) => g.label === "A1");
  assert.deepEqual({ n: a1.n, total: a1.totalMs, mean: a1.meanMs }, { n: 2, total: 10, mean: 5 });
  const b1 = t.grades.find((g) => g.label === "B1");
  assert.deepEqual({ n: b1.n, total: b1.totalMs, mean: b1.meanMs }, { n: 3, total: 120, mean: 40 });

  // per-grade totals + the spine reconstruct the whole-set total (no double count).
  const reconstructed = t.spine.totalMs + t.grades.reduce((acc, g) => acc + g.totalMs, 0);
  assert.equal(reconstructed, t.all.totalMs, "spine + grades == all (partition is exact)");
});

test("timingBucket: ignores rows without a finite timingMs so a partial set never poisons the mean", () => {
  const b = timingBucket("x", [trow("a", 10), { caseId: "b" }, trow("c", 30), trow("d", NaN)]);
  assert.deepEqual({ n: b.n, total: b.totalMs, mean: b.meanMs }, { n: 2, total: 40, mean: 20 });
  const empty = timingBucket("none", [{ caseId: "z" }]);
  assert.deepEqual({ n: empty.n, total: empty.totalMs, mean: empty.meanMs }, { n: 0, total: 0, mean: null });
});

test("renderTimings: reports wall-time, all, v1-spine and each populated grade", () => {
  const text = renderTimings(timingRollup([trow("v", 10), trow("a1", 6, "A1")], { wallMs: 42 }));
  assert.match(text, /wall-time \(product replay\): 42ms/);
  assert.match(text, /v1-spine: 1 row\(s\), total 10ms, mean 10\.0ms\/row/);
  assert.match(text, /A1: 1 row\(s\), total 6ms, mean 6\.0ms\/row/);
});

test("computeAgreement: a template-lane parallel-forms line is reported alongside the standard cells", () => {
  const a = [
    brow("t1", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] }),
    brow("t2", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] }),
    brow("s1", "C1", "temporal", { via: "composed" }),
  ];
  const b = [
    brow("t3", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] }),
    brow("t4", "C1", "temporal", { via: "template", tags: ["graded", "template-lane"] }),
    brow("s2", "C1", "temporal", { via: "composed" }),
  ];
  const agreement = computeAgreement(a, b, {});
  assert.ok(agreement.templateLane, "template-lane sub-agreement present");
  assert.equal(agreement.templateLane.cells.length, 1, "one template-lane cell");
  assert.equal(agreement.templateLane.cells[0].construction, "temporal");
  const table = renderAgreementTable(agreement);
  assert.match(table, /template-lane C1 temporal/);
  assert.match(table, /template-lane agreement:/);
});

// ---- runGradedDraw ladder integration (META-2, PLAN_CYCLE_4.md) ----

test("runGradedDraw: --ladder gates every grade above the first unreliable one, with a receipt; without --ladder all grades run", async () => {
  // A synthetic pool: B1 has an ENFORCED failure (non-frontier, fails tier-1) so
  // the grade is unreliable; a stub runner returns the case's authored outcome.
  const cases = [
    { id: "a1", grade: "A1", construction: "svo-query" },
    { id: "b1a", grade: "B1", construction: "temporal" },       // passes
    { id: "b1b", grade: "B1", construction: "temporal", fail: true }, // enforced fail → unreliable
    { id: "c1", grade: "C1", construction: "temporal" },
    { id: "c2", grade: "C2", construction: "relative-embedded" },
  ];
  const stubRun = async (c) => ({
    caseId: c.id, grade: c.grade, construction: c.construction,
    tier1: { pass: !c.fail, baselineFailTurns: [], improvedBaselineTurns: [], failing: [], checksTotal: 1, checksFailed: c.fail ? 1 : 0 },
  });
  const gated = await runGradedDraw(cases, {}, { ladder: true, run: stubRun });
  assert.deepEqual(gated.skipped.map((s) => s.grade), ["C1", "C2"], "grades above B1 are skipped");
  assert.match(gated.skipped[0].reason, /B1 at 1\/2/);
  assert.deepEqual(gated.rows.map((r) => r.grade), ["A1", "B1", "B1"], "nothing above the gate ran");
  const open = await runGradedDraw(cases, {}, { ladder: false, run: stubRun });
  assert.equal(open.skipped.length, 0, "no --ladder → every grade runs");
  assert.equal(open.rows.length, 5);
});

test("census cells (CELL_SAMPLE ≥ size) agree on the REAL pool: both draws are the identical full cell, so green-rate is identical", () => {
  // isFrontierCase is the deterministic green proxy (a replayed row is green iff
  // the pool case is non-frontier — the engine is unchanged and deterministic).
  const nonFrontierRate = (list) => (list.length ? list.filter((c) => !isFrontierCase(c)).length / list.length : null);
  for (const stamp of ["cycle3", "cycle4", "run-004", "graded-smoke", "xyz"]) {
    const seedA = fnv1a(stamp);
    const { a, b } = dualDraws(pool, { fraction: 0.1, seedA, seedB: (seedA + 1) >>> 0 });
    for (const key of Object.keys(CELL_SAMPLE)) {
      const ca = a.filter((c) => cellKey(c) === key);
      const cb = b.filter((c) => cellKey(c) === key);
      assert.equal(Math.abs(nonFrontierRate(ca) - nonFrontierRate(cb)), 0, `${key} @ ${stamp}: census cell agrees exactly`);
    }
  }
});

// ---- (e) the PROMOTED ALWAYS-RUN set ----
// Every promoted grade's fixed 5-item cell subsets replay through the REAL
// engine (same runner machinery as the bench, no judge, no sampling) at unit
// timescale. A regression here fails `npm test` — the promotion contract.

const promotedCells = GRADED_MATRIX.filter((c) => PROMOTED_GRADES.includes(c.grade));
const runnerDepsPromise = createRunnerDeps("promoted-unit");
after(async () => { const { cleanup } = await runnerDepsPromise; await cleanup(); });

for (const cell of promotedCells) {
  test(`promoted ${cellKey(cell)}: the fixed 5-item subset passes tier-1 through the real engine`, async () => {
    const { deps } = await runnerDepsPromise;
    const subset = promotedSubset(pool.filter((c) => cellKey(c) === cellKey(cell)));
    assert.equal(subset.length, MIN_PER_CELL);
    for (const caseDef of subset) {
      const { turnEvals } = caseDef.mode === "session"
        ? await runSessionCase(caseDef, deps)
        : await runTurnsCase(caseDef, deps);
      const tier1 = summarizeTier1(turnEvals);
      assert.equal(tier1.pass, true, `${caseDef.id}: ${JSON.stringify(tier1.failing)}`);
      assert.equal(tier1.baselineFailTurns.length, 0, `${caseDef.id}: promoted cases are non-frontier`);
    }
  });
}
