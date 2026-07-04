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
  MIN_PER_CELL, AGREEMENT_TOLERANCE,
  validateConstruction, isCombo, cellKey, fnv1a, mulberry32, seededShuffle,
  isFrontierCase, isGreenRow, promotedSubset, stratifiedSample, dualDraws,
  computeAgreement, renderAgreementTable, gradeReliability, ladderGate,
  gradedRollup,
} from "../chatbench/graded.mjs";
import {
  parseCases, summarizeTier1, runTurnsCase, runSessionCase, createRunnerDeps,
} from "../chatbench/run.mjs";

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
  for (const [key, n] of byCell) assert.equal(n, MIN_PER_CELL, `${key}: 10% of 25/50 floors at ${MIN_PER_CELL}`);
  // promoted grades: the FIXED promoted subset regardless of seed
  for (const grade of PROMOTED_GRADES) {
    const fixed1 = s1.filter((c) => c.grade === grade).map((c) => c.id).sort();
    const fixed3 = s3.filter((c) => c.grade === grade).map((c) => c.id).sort();
    assert.deepEqual(fixed1, fixed3, `${grade} cells are never sampled out`);
  }
});

test("dualDraws: distinct seeds, no within-cell overlap for non-promoted cells, identical fixed subsets for promoted cells", () => {
  const { a, b } = dualDraws(pool, { fraction: 0.1, seedA: 7, seedB: 8 });
  const aIds = new Set(a.map((c) => c.id));
  for (const c of b) {
    if (PROMOTED_GRADES.includes(c.grade)) {
      assert.ok(aIds.has(c.id), `${c.id}: promoted cases identical across draws`);
    } else {
      assert.ok(!aIds.has(c.id), `${c.id}: pools are ≥ 2× the quota, so draw B shares nothing with draw A`);
    }
  }
  assert.equal(a.length, b.length, "parallel forms are the same shape");
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
