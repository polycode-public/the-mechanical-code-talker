// ingestbench tests — the measurement HARNESS only, never the measurements: the
// case lint over the committed file's schema, the fidelity classifier's rules,
// the ING-7 deterministic equivalence check, the rung rollup + ladder gate math,
// the judge's pure prompt/parse helpers, and one smoke run of the runner over its
// smallest rung. The full ladder runs via `node test-benchmarks/ingestbench/run.mjs --ladder`
// (fast + free on the deterministic rungs) — deliberately NOT in `npm test`, so
// the suite gates the instrument while the bench measures the product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseCases, classifyStored, verifyCanonicalRestatement, gradeDeterministicCase,
  rollup, ladderGate, restateDocument, canonicalTriple, COMPLETION_FLOOR, RUNGS,
} from "../../test-benchmarks/ingestbench/grade.mjs";
import { runIngestbench, main as runMain } from "../../test-benchmarks/ingestbench/run.mjs";
import { buildPrompt, validateScores, parseJudgeOutput, DIMENSIONS } from "../../test-benchmarks/ingestbench/judge.mjs";

const caseLine = (fields) => JSON.stringify({
  id: "ing-1-clean-isa-cat",
  rung: "ING-1",
  grade: "deterministic",
  input: "A cat is a mammal.",
  expect: { statements: [{ subject: "cat", predicate: "rdfs:subClassOf", object: "mammal" }] },
  tags: ["isa"],
  ...fields,
});

// ---- case lint ----

test("a well-formed deterministic case lints clean", () => {
  const { cases, errors } = parseCases(caseLine({}));
  assert.deepEqual(errors, []);
  assert.equal(cases[0].id, "ing-1-clean-isa-cat");
});

test("a case whose rung is not on the ladder is rejected", () => {
  const { errors } = parseCases(caseLine({ rung: "ING-42" }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rung must be one of/);
});

test("a deterministic case with neither statements nor an abstain flag is rejected", () => {
  const { errors } = parseCases(caseLine({ expect: {} }));
  assert.ok(errors.some((e) => /needs expect.statements or expect.abstain/.test(e)));
});

test("an abstain case with no statements lints clean", () => {
  const { errors } = parseCases(caseLine({ expect: { abstain: true } }));
  assert.deepEqual(errors, []);
});

test("a forbid guard naming an unknown wrong-fact class is rejected", () => {
  const line = caseLine({ expect: { statements: [{ subject: "cat", predicate: "rdfs:subClassOf", object: "mammal" }], forbid: [{ subject: "cat", predicate: "rdfs:subClassOf", object: "pet", class: "sloppy" }] } });
  const { errors } = parseCases(line);
  assert.ok(errors.some((e) => /forbid class must be one of/.test(e)));
});

test("a judged case may omit statements", () => {
  const { errors } = parseCases(caseLine({ grade: "judged", rung: "ING-8", expect: {} }));
  assert.deepEqual(errors, []);
});

test("a ceiling that names no capability is rejected", () => {
  const { errors } = parseCases(caseLine({ ceiling: "   " }));
  assert.ok(errors.some((e) => /ceiling must be a non-empty string/.test(e)));
});

// ---- the fidelity classifier (recall + the four failure classes) ----

const isa = (s, o) => ({ subject: s, predicate: "rdfs:subClassOf", object: o });

test("an exact match on the one expected statement is full recall, zero wrong facts", () => {
  const caseDef = { rung: "ING-1", expect: { statements: [isa("cat", "mammal")] } };
  const c = classifyStored([isa("cat", "mammal")], caseDef);
  assert.equal(c.recall, 1);
  assert.equal(c.precision, 1);
  assert.equal(c.wrongCount, 0);
  assert.equal(c.failureCounts["missed-useful"], 0);
});

test("a stored triple the case does not expect is a wrong fact, classed by its forbid guard", () => {
  const caseDef = { rung: "ING-2", expect: { statements: [isa("violin", "string instrument")], forbid: [{ ...isa("violin", "string"), class: "greedy-span" }] } };
  const c = classifyStored([isa("violin", "string")], caseDef);
  assert.equal(c.wrongCount, 1);
  assert.equal(c.wrong[0].class, "greedy-span");
  assert.equal(c.failureCounts["greedy-span"], 1);
  assert.equal(c.recall, 0, "the expected span was never stored");
});

test("an unanticipated stored triple with no forbid guard defaults to fabricated", () => {
  const caseDef = { rung: "ING-1", expect: { statements: [isa("cat", "mammal")] } };
  const c = classifyStored([isa("cat", "mammal"), isa("cat", "vegetable")], caseDef);
  assert.equal(c.wrongCount, 1);
  assert.equal(c.wrong[0].class, "fabricated");
});

test("a correct abstain — nothing stored — is full recall", () => {
  const caseDef = { rung: "ING-2", expect: { abstain: true } };
  const c = classifyStored([], caseDef);
  assert.equal(c.recall, 1);
  assert.equal(c.wrongCount, 0);
});

test("an abstain case that stores a fact is a wrong fact, not a pass", () => {
  const caseDef = { rung: "ING-2", expect: { abstain: true, forbid: [{ ...isa("glacier", "body"), class: "confused" }] } };
  const c = classifyStored([isa("glacier", "body")], caseDef);
  assert.equal(c.wrongCount, 1);
  assert.equal(c.wrong[0].class, "confused");
});

test("a partial recall keeps the facts it grounded and misses the rest", () => {
  const caseDef = { rung: "ING-6", expect: { statements: [{ subject: "star", predicate: "mgx:capableOf", object: "form" }, { subject: "star", predicate: "mgx:capableOf", object: "collapse" }] } };
  const c = classifyStored([{ subject: "star", predicate: "mgx:capableOf", object: "form" }], caseDef);
  assert.equal(c.recall, 0.5);
  assert.equal(c.failureCounts["missed-useful"], 1);
  assert.equal(c.wrongCount, 0, "a missed-useful fact is the honest side, never a wrong fact");
});

// ---- the ING-7 deterministic equivalence check ----

test("an isa triple's canonical restatement round-trips through the closure check", () => {
  const r = verifyCanonicalRestatement(isa("dog", "animal"));
  assert.equal(r.verified, true);
  assert.equal(r.method, "isa-closure");
});

test("a compound-modifier class still round-trips as one term", () => {
  const r = verifyCanonicalRestatement(isa("violin", "string instrument"));
  assert.equal(r.verified, true);
});

test("an object-property triple round-trips through a parseAce re-parse", () => {
  const r = verifyCanonicalRestatement({ subject: "bird", predicate: "tmct:has", object: "feather" });
  assert.equal(r.verified, true);
  assert.equal(r.method, "parseAce");
});

// ---- grading one deterministic case ----

test("a clean single-fact case passes the gate", () => {
  const caseDef = { id: "x", rung: "ING-1", expect: { statements: [isa("cat", "mammal")] } };
  const row = gradeDeterministicCase(caseDef, [isa("cat", "mammal")]);
  assert.equal(row.pass, true);
  assert.equal(row.wrongCount, 0);
});

test("one wrong fact fails the case outright, however good the recall", () => {
  const caseDef = { id: "x", rung: "ING-1", expect: { statements: [isa("cat", "mammal")] } };
  const row = gradeDeterministicCase(caseDef, [isa("cat", "mammal"), isa("cat", "rock")]);
  assert.equal(row.pass, false, "the no-wrong-fact line is absolute");
});

test("an ING-7 case fails when its stored triple does not round-trip, even at full recall", () => {
  // "creates" is not a parseAce-round-trippable relation verb, so the equivalence
  // check cannot confirm it — an honest ceiling, not a pass.
  const caseDef = { id: "x", rung: "ING-7", expect: { statements: [{ subject: "weight", predicate: "tmct:creates", object: "pressure" }] } };
  const row = gradeDeterministicCase(caseDef, [{ subject: "weight", predicate: "tmct:creates", object: "pressure" }]);
  assert.equal(row.recall, 1);
  assert.equal(row.wrongCount, 0);
  assert.equal(row.equivVerified, 0);
  assert.equal(row.pass, false);
});

// ---- rung rollup + ladder gate ----

test("the ladder gates at the first rung below the recall floor and skips every rung above", () => {
  const rows = [
    gradeDeterministicCase({ id: "a", rung: "ING-0", expect: { statements: [isa("dog", "animal")] } }, [isa("dog", "animal")]),
    gradeDeterministicCase({ id: "b", rung: "ING-1", expect: { statements: [isa("cat", "mammal")] } }, []), // 0% recall
    gradeDeterministicCase({ id: "c", rung: "ING-2", expect: { statements: [isa("poodle", "dog")] } }, [isa("poodle", "dog")]),
  ];
  const rolled = rollup(rows);
  assert.equal(rolled.byRung["ING-0"].gatePass, true);
  assert.equal(rolled.byRung["ING-1"].gatePass, false);
  const ladder = ladderGate(rolled);
  assert.match(ladder.gatedAt, /ING-1/);
  assert.deepEqual(ladder.receipts.map((r) => r.rung), ["ING-2"]);
  assert.match(ladder.receipts[0].reason, /gated by ING-1/);
});

test("a wrong fact anywhere in a rung fails its gate even at full recall", () => {
  const rows = [gradeDeterministicCase({ id: "a", rung: "ING-1", expect: { statements: [isa("cat", "mammal")] } }, [isa("cat", "mammal"), isa("cat", "rock")])];
  assert.equal(rollup(rows).byRung["ING-1"].gatePass, false);
  assert.ok(COMPLETION_FLOOR > 0 && COMPLETION_FLOOR <= 1);
});

// ---- restatement + the judge's pure helpers ----

test("restateDocument turns stored triples into canonical statements", () => {
  const text = restateDocument([isa("planet", "world"), { subject: "planet", predicate: "tmct:has", object: "atmosphere" }]);
  assert.match(text, /planet/);
  assert.match(text, /world/);
  assert.match(text, /atmosphere/);
  assert.match(text, /\.$/);
});

test("the judge prompt fills the input and the restatement, and marks an empty restatement", () => {
  const template = "IN:{{INPUT}} OUT:{{RESTATEMENT}} ID:{{CASE_ID}}";
  const filled = buildPrompt({ caseId: "c1", input: "A dog is an animal.", restatement: "" }, template);
  assert.match(filled, /IN:A dog is an animal\./);
  assert.match(filled, /OUT:\(nothing extracted\)/);
  assert.match(filled, /ID:c1/);
});

test("the judge score validator holds the rubric bounds both ways", () => {
  assert.equal(validateScores({ forward: 2, backward: 1, rationale: "ok" }), null);
  assert.match(validateScores({ forward: 3, backward: 1, rationale: "x" }), /not 0\|1\|2\|null/);
  assert.match(validateScores({ forward: null, backward: null, rationale: "x" }), /nothing scored/);
});

test("parseJudgeOutput reads the structured envelope and rejects a malformed one", () => {
  const good = JSON.stringify({ structured_output: { forward: 2, backward: 1, rationale: "grounded, partial" } });
  const parsed = parseJudgeOutput(good);
  assert.deepEqual(Object.keys(parsed.scores).sort(), [...DIMENSIONS].sort());
  assert.equal(parsed.scores.forward, 2);
  assert.ok(parseJudgeOutput("not json").error);
});

// ---- SMOKE: the runner executes its smallest rung and writes a well-formed result ----

test("the runner grades the smallest rung deterministically", async () => {
  const { cases } = parseCases(await readFile(new URL("../../test-benchmarks/ingestbench/cases.jsonl", import.meta.url), "utf8"));
  const floor = cases.filter((c) => c.rung === RUNGS[0]);
  assert.ok(floor.length >= 1, "there is at least one ING-0 case to smoke-test");
  const { rows, rolled } = await runIngestbench(floor, { concurrency: 2, ladder: true });
  assert.equal(rows.length, floor.length);
  for (const r of rows) {
    assert.equal(r.rung, "ING-0");
    assert.equal(typeof r.pass, "boolean");
    assert.ok(Array.isArray(r.stored));
  }
  assert.equal(rolled.byRung["ING-0"].wrong, 0, "the floor stores no wrong fact");
});

test("main writes a well-formed product.jsonl for the smallest rung", async () => {
  const out = await mkdtemp(join(tmpdir(), "ingestbench-smoke-"));
  try {
    const code = await runMain(["--rung", "ING-0", "--stamp", "smoke", "--out", out]);
    assert.equal(code, 0);
    const product = await readFile(join(out, "product.jsonl"), "utf8");
    const parsed = product.trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(parsed.length >= 1);
    for (const r of parsed) {
      assert.equal(r.rung, "ING-0");
      assert.equal(r.grade, "deterministic");
      assert.ok("pass" in r && "recall" in r && "wrongCount" in r);
      for (const t of r.stored) assert.deepEqual(canonicalTriple(t), t, "stored triples are already canonical");
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
