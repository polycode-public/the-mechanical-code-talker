// infbench tests — the measurement harness only, NEVER the measurements: the
// case lint over the committed file's schema, the grading core's verdict rules,
// and the rollup's own arithmetic. The ladder itself runs via `npm run infbench`
// (free, but minutes of real chat sessions) — deliberately NOT in tests, so
// `npm test` gates the instrument and the bench measures the product.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseCases, rollup, renderRollup, ceilingCapabilities, gradeChatRow,
} from "../../infbench/grade.mjs";

const caseLine = (fields) => JSON.stringify({
  id: "inf-a1-lookup-subClassOf-001",
  band: "INF-A1",
  template: "a1Lookup",
  variant: "subClassOf",
  arms: ["kernel", "chat"],
  checkType: "isa",
  premises: ["every widget is a gadget"],
  query: "is a widget a gadget",
  expect: { verdict: "yes", entailed: [] },
  ...fields,
});

const row = (fields) => ({ band: "INF-B2", pass: true, completed: true, fabricated: false, ...fields });

test("a case may declare the capability that would lift its ceiling", () => {
  const { cases, errors } = parseCases(caseLine({ ceiling: "chat-layer multi-hop proof-chain materialization" }));
  assert.deepEqual(errors, []);
  assert.equal(cases[0].ceiling, "chat-layer multi-hop proof-chain materialization");
});

test("a case with no ceiling is graded against a real capability and lints clean", () => {
  const { cases, errors } = parseCases(caseLine({}));
  assert.deepEqual(errors, []);
  assert.equal(cases[0].ceiling, undefined);
});

test("a ceiling that names no capability is rejected", () => {
  for (const ceiling of ["", "   ", true, 42, {}]) {
    const { errors } = parseCases(caseLine({ ceiling }));
    assert.equal(errors.length, 1, `expected a lint error for ceiling ${JSON.stringify(ceiling)}`);
    assert.match(errors[0], /ceiling must be a non-empty string/);
  }
});

test("a band reports how many of its passes are graded against a declared ceiling", () => {
  const rolled = rollup([
    row({ ceiling: "proof-chain materialization" }),
    row({ ceiling: "proof-chain materialization" }),
    row({}),
    row({ pass: false, completed: false, ceiling: "proof-chain materialization" }),
  ]);
  const cell = rolled.byBand["INF-B2"];
  assert.equal(cell.passed, 3);
  assert.equal(cell.ceilingGraded, 3, "every row carrying a ceiling counts, passing or not");
  assert.equal(cell.ceilingGradedPassed, 2, "only the ceiling-graded rows that passed");
});

test("a band with no ceiling-graded rows reports none rather than omitting the count", () => {
  const cell = rollup([row({}), row({})]).byBand["INF-B2"];
  assert.equal(cell.ceilingGraded, 0);
  assert.equal(cell.ceilingGradedPassed, 0);
});

test("the capabilities behind a band's ceilings are listed once each, sorted", () => {
  const capabilities = ceilingCapabilities([
    row({ ceiling: "proof-chain materialization" }),
    row({ ceiling: "proof-chain materialization" }),
    row({ band: "INF-C2", ceiling: "a consistency checker" }),
    row({ band: "INF-A1" }),
  ]);
  assert.deepEqual(capabilities, {
    "INF-B2": ["proof-chain materialization"],
    "INF-C2": ["a consistency checker"],
  });
  assert.equal("INF-A1" in capabilities, false, "a band with no ceiling-graded row is absent, not empty");
});

test("the rendered rollup carries the ceiling count beside the band's pass count", () => {
  const rendered = renderRollup(rollup([row({ ceiling: "proof-chain materialization" }), row({})]), "chat");
  assert.match(rendered, /ceiling\/pass/);
  assert.match(rendered, /INF-B2.*\s1\/2/);
});

test("a confident yes against an expected refusal is fabrication, not a plain miss", () => {
  const existential = { checkType: "isa", expect: { verdict: "unproven" } };
  const graded = gradeChatRow(existential, { answer: "yes — you told me: test is a kind of file", miss: false });
  assert.equal(graded.observed, "yes");
  assert.equal(graded.pass, false);
  assert.equal(graded.fabricated, true, "asserting a universal the premise never stated is the fabrication the probe exists to catch");
});

test("an honest refusal against an expected refusal passes without fabricating", () => {
  const existential = { checkType: "isa", expect: { verdict: "unproven" } };
  const graded = gradeChatRow(existential, { answer: "I can't confirm that — I don't know \"test\" at all yet.", miss: true });
  assert.equal(graded.observed, "unproven");
  assert.equal(graded.pass, true);
  assert.equal(graded.fabricated, false);
});
