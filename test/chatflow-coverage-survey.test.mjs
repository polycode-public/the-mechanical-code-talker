// chatflow-coverage-survey.test.mjs — SKILL_CHAT_PLAYTEST regression transcript.
// A tier beyond chatflow-coverage.test.mjs: that one pins the PREDICATIVE survey
// ("which modules are untested"); this one pins the BARE survey a developer asks
// once "what is a test" has opened the topic — no entity noun at all: "what is
// untested", "what's not tested", "what isn't covered". Those hit a soft wall
// ("no module matching 'not'…" / the "I answer questions…" orientation) while the
// predicative and attributive twins answered. interpret/normalize.mjs now routes
// the bare form onto the attributive "<qualifier> modules" the grammar answers,
// folding the negation into the qualifier (not tested → untested).
//
// The dead-ends this pins (all ROUTING, no grammar rigidity):
//   D1  "what is untested" / "what's not tested" / "what isn't covered"  → the
//       untested/uncovered module survey (== the predicative & set-complement twins).
//   D2  "what is covered"                                                → the covered set.
// The quick-win "No tests cover X." honest-empty (ask.mjs) rides along at the end,
// so the whole plain-phrasing coverage conversation is frozen flowing end to end.
//
// Driven against the SHIPPED examples/mini-webapp graph — the graph the playtest
// chatted — so the answers are real, not fixture-mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveTurns, stripGoalLine } from "./helpers/session.mjs";

const GRAPH = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;

// FEATURE B (0.9.x): every runAsk-composed answer carries an ALWAYS-ON trailing
// "\n\nGoal (inferred): …" line — this suite is about ROUTING/wall-avoidance,
// not that feature, so it's stripped here rather than teaching every one of
// this file's exact-text assertions a new goal-line-shaped tail.
const drive = (queries) => driveTurns({ graphFile: GRAPH }, queries, { strip: stripGoalLine });

test("coverage-survey flow: the bare 'what is untested' conversation flows end to end (was a soft wall)", async () => {
  const turns = [
    "what is a test",                            // relation force — quick-win singular meta
    "what is untested",                          // bare survey — was "no module matching 'not'…"
    "what's not tested",                         // negated bare survey — was the orientation wall
    "what is covered",                           // affirmative bare survey — was the orientation wall
    "what tests cover src/core/validate.mjs",    // honest empty — the quick-win "No tests cover X."
  ];
  const rs = await drive(turns);

  // Every turn flows: none hits the grammar wall / the "no module matching" miss /
  // the bare "I answer questions…" orientation dead-end.
  for (let i = 0; i < rs.length; i += 1) {
    assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} "${turns[i]}" no grammar wall`);
    assert.doesNotMatch(rs[i].answer, /no module matching "not"/, `turn ${i} "${turns[i]}" no 'not' misparse`);
    assert.doesNotMatch(rs[i].answer, /I answer questions about THIS codebase/, `turn ${i} "${turns[i]}" no orientation wall`);
  }

  // the relation force still opens the topic (quick-win singular "what is a test").
  assert.equal(rs[0].record.miss, false, "'what is a test' fires the relation force");
  assert.match(rs[0].answer, /^A test is code that exercises/, "relation force definition band");

  // D1 — the bare untested survey answers with the uncovered set.
  assert.equal(rs[1].record.miss, false, "'what is untested' now answers");
  assert.match(rs[1].answer, /src\/core\/validate\.mjs/, "the untested survey names an uncovered module");
  // …and the negated twin agrees byte-for-byte (a true synonym route, not a guess).
  assert.equal(rs[2].record.miss, false, "'what's not tested' now answers");
  assert.equal(rs[1].answer, rs[2].answer, "'what is untested' == 'what's not tested'");

  // D2 — the affirmative bare survey answers with the covered set.
  assert.equal(rs[3].record.miss, false, "'what is covered' now answers");
  assert.match(rs[3].answer, /src\/core\/store\.mjs/, "the covered survey names a covered module");

  // the honest empty reads cleanly (quick-win) — a genuine absence with a receipt is FLOW.
  assert.equal(rs[4].record.miss, true, "src/core/validate.mjs genuinely has no tests");
  assert.match(rs[4].answer, /^No tests cover src\/core\/validate\.mjs\./, "the honest empty reads cleanly, not a wall");
});

test("coverage-survey routing: every bare phrasing agrees with the predicative & set-complement twins", async () => {
  // the load-bearing invariant: the bare survey is a true SYNONYM of the working
  // canonicals, so all three routes return the identical set — never a different
  // (or fabricated) answer. Pinned across the negated, predicative, attributive and
  // set-complement forms.
  const [bare, notBare, predicative, attributive, complement] = await drive([
    "what is untested",
    "what isn't tested",
    "which modules are untested",
    "untested modules",
    "which modules are not tested",
  ]);
  for (const [name, r] of [["bare", bare], ["notBare", notBare], ["predicative", predicative], ["attributive", attributive], ["complement", complement]]) {
    assert.equal(r.record.miss, false, `"${name}" answers`);
    assert.match(r.answer, /src\/core\/validate\.mjs/, `"${name}" names the untested module`);
  }
  assert.equal(bare.answer, notBare.answer, "'what is untested' == 'what isn't tested'");
  assert.equal(bare.answer, predicative.answer, "'what is untested' == 'which modules are untested'");
  assert.equal(bare.answer, attributive.answer, "'what is untested' == 'untested modules'");
  assert.equal(bare.answer, complement.answer, "'what is untested' == 'which modules are not tested'");

  // the covered/uncovered pair likewise agrees with its predicative twins.
  const [uncovered, uncoveredPred, covered, coveredPred] = await drive([
    "what is uncovered",
    "which modules are uncovered",
    "what is covered",
    "which modules are covered",
  ]);
  assert.equal(uncovered.answer, uncoveredPred.answer, "'what is uncovered' == 'which modules are uncovered'");
  assert.equal(covered.answer, coveredPred.answer, "'what is covered' == 'which modules are covered'");
});

test("coverage-survey discipline: an object-bearing 'tests' query is NOT hijacked by the bare-survey frame", async () => {
  // the frame is anchored with NO object, so "what tests cover X" (honest empty) and
  // "what is a test" (the relation force) keep their own paths — the bare survey never
  // swallows a real tests-of question or the concept touch.
  const [coverX, whatIsATest] = await drive([
    "what tests cover src/core/model.mjs",   // real tests-of — resolves to the covering tests
    "what is a test",                         // concept touch — the relation force
  ]);
  assert.equal(coverX.record.miss, false, "'what tests cover X' still resolves to the covering tests");
  assert.match(coverX.answer, /test\/tasks\.test\.mjs/, "…naming the real test module");
  assert.match(whatIsATest.answer, /^A test is code that exercises/, "'what is a test' still fires the relation force");
});
