// idxbench tests — the measurement harness only, never a scored measurement:
// the committed case set lints clean, the runner executes a real case through
// the real producer (extractRepo/assembleEntities + the conformance gate) and
// writes a well-formed row, and the pure grader catches the empty-gold
// fabrication case IDX-8 relies on. The full ladder runs via
// `node test-benchmarks/idxbench/run.mjs --ladder` (fast, but touches git/fs) — deliberately
// not the whole case set here, so `npm test` gates the instrument.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCases, gradeEdges, RUNGS } from "../../test-benchmarks/idxbench/grade.mjs";
import { runIdxbench, DEFAULT_CASES } from "../../test-benchmarks/idxbench/run.mjs";

test("the committed case set lints clean and every rung is a real rung", async () => {
  const text = await readFile(DEFAULT_CASES, "utf8");
  const { cases, errors } = parseCases(text);
  assert.deepEqual(errors, []);
  assert.ok(cases.length > 0, "the case set is non-empty");
  for (const c of cases) assert.ok(RUNGS.includes(c.rung), `${c.id} carries a real rung`);
});

test("the runner executes IDX-0 (the smallest rung) through the real producer and writes a well-formed row", async () => {
  const text = await readFile(DEFAULT_CASES, "utf8");
  const { cases } = parseCases(text);
  const idx0 = cases.find((c) => c.rung === "IDX-0");
  assert.ok(idx0, "a committed IDX-0 case exists");

  const result = await runIdxbench([idx0]);
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.id, idx0.id);
  assert.equal(row.rung, "IDX-0");
  assert.ok(row.entities, "an entity-graded case reports an entities cell");
  assert.equal(typeof row.entities.matched, "number");
  assert.equal(typeof row.entities.gold, "number");
  assert.equal(typeof row.entities.extra, "number");
  assert.ok(row.edges?.defines, "the defines edge set is graded too");
  assert.ok(row.conformance, "every structural case runs the conformance gate against its produced graph");
  assert.equal(row.conformance.ok, true, `conformance kit failures: ${JSON.stringify(row.conformance.failures)}`);

  const rolled = result.rolled.byRung["IDX-0"];
  assert.equal(rolled.gatePass, true, "the smallest rung clears its own honest gate");
  assert.equal(rolled.fabricationRate, 0);
});

test("gradeEdges flags any in-scope produced edge as fabrication when gold is empty (IDX-8's honest-miss check)", () => {
  const produced = [{ subject: "fn:caller.mjs#run", subjectLabel: "run", objectLabel: "handle" }];
  const graded = gradeEdges(produced, [], ["caller.mjs"]);
  assert.equal(graded.gold, 0);
  assert.equal(graded.extra, 1, "a produced edge with no gold counterpart is a fabrication, not a free pass");
});

test("gradeEdges scopes fabrication-checking to the named modules only", () => {
  const produced = [
    { subject: "fn:caller.mjs#run", subjectLabel: "run", objectLabel: "handle" },
    { subject: "fn:other.mjs#thing", subjectLabel: "thing", objectLabel: "handle" },
  ];
  const graded = gradeEdges(produced, [], ["caller.mjs"]);
  assert.equal(graded.extra, 1, "an edge outside the case's declared scope is not this case's fabrication to catch");
});
