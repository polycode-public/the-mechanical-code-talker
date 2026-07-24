// researchbench tests — the measurement harness only, never a scored
// measurement: the committed case set lints clean, the runner drives its
// smallest rung through the REAL lane (src/services/research.mjs) against the
// fixture provider and writes a well-formed row, and the pure grader's hub
// signal and invented-traversal check hold on hand-built inputs. The full
// ladder runs via `node researchbench/run.mjs --ladder` — deliberately not the
// whole case set here, so `npm test` gates the instrument.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseCases, RUNGS, computeHubSet, reachableFromSeed, gradeWalk,
} from "../../researchbench/grade.mjs";
import { runResearchbench, DEFAULT_CASES } from "../../researchbench/run.mjs";
import { loadGraph } from "../../researchbench/fixture/provider.mjs";

test("the committed case set lints clean and every rung is a real rung", async () => {
  const text = await readFile(DEFAULT_CASES, "utf8");
  const { cases, errors } = parseCases(text);
  assert.deepEqual(errors, []);
  assert.ok(cases.length > 0, "the case set is non-empty");
  for (const c of cases) assert.ok(RUNGS.includes(c.rung), `${c.id} carries a real rung`);
});

test("the runner drives RES-0 (the smallest rung) through the real lane and writes a well-formed row", async () => {
  const text = await readFile(DEFAULT_CASES, "utf8");
  const { cases } = parseCases(text);
  const res0 = cases.find((c) => c.rung === "RES-0");
  assert.ok(res0, "a committed RES-0 case exists");

  const result = await runResearchbench([res0]);
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.id, res0.id);
  assert.equal(row.rung, "RES-0");
  assert.equal(typeof row.recall, "number");
  assert.equal(typeof row.hubAvoidance, "number");
  assert.equal(row.invented, false, "the depth-0 fetch never invents a traversal");

  const rolled = result.rolled.byRung["RES-0"];
  assert.equal(rolled.gatePass, true, "the smallest rung clears its own honest gate");
});

test("a RES-7/RES-8 case never reaches the lane — a ceiling marker, not a driven case", async () => {
  const text = await readFile(DEFAULT_CASES, "utf8");
  const { cases } = parseCases(text);
  const res7 = cases.find((c) => c.rung === "RES-7");
  assert.ok(res7, "a committed RES-7 case exists");
  const result = await runResearchbench([res7]);
  const [row] = result.rows;
  assert.equal(row.measured, false);
  assert.equal(row.ceiling, true);
  assert.equal("recall" in row, false, "no lane call means no traversal metric to report");
});

test("computeHubSet flags a title by degree AND a title by pattern, never by a live count", () => {
  const graph = loadGraph();
  const hubs = computeHubSet(graph);
  assert.ok(hubs.has("Earth"), "Earth's in-degree clears the committed floor");
  assert.ok(hubs.has("Geology"), "Geology's in-degree clears the committed floor");
  assert.ok(hubs.has("ISBN 0-19-960146-4"), "an identifier-shaped link is a hub by pattern regardless of degree");
  assert.equal(hubs.has("Active volcano"), false, "a low-in-degree kin is not a hub");
});

test("reachableFromSeed never manufactures a title outside the fixture's own link closure", () => {
  const graph = loadGraph();
  const reachable = reachableFromSeed(graph, "volcano", 1);
  assert.ok(reachable.has("Earth"));
  assert.equal(reachable.has("Magma"), false, "Magma is 2 hops away, outside a depth-1 closure");
});

test("gradeWalk's invented-traversal check catches a grounded title outside the reachable closure", () => {
  const graph = loadGraph();
  const caseDef = { seed: "volcano", k: 1, goldFollow: [], goldHubs: [] };
  const afterStart = { pending: [] };
  const final = { done: [{ title: "Volcano" }, { title: "A Made-Up Article" }], skipped: [] };
  const graded = gradeWalk(caseDef, { afterStart, final, graph });
  assert.equal(graded.invented, true, "a grounded title the fixture never linked is an invented edge");
});
