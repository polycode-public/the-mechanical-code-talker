import { test } from "node:test";
import assert from "node:assert/strict";
import { runExample, TEACH, ASK } from "../examples/teach-and-infer.mjs";

test("examples/teach-and-infer.mjs: family-tree teach+infer produces the exact README-shown transcript", async () => {
  const answers = await runExample();
  assert.equal(answers.length, TEACH.length + 1, "one answer per teach line, plus the final question");

  assert.equal(answers[0], "noted — remembered: ahab fathers john\n\nGoal (inferred): Teach/remember a new fact.");
  assert.equal(answers[1], "noted — remembered: john fathers ishmael\n\nGoal (inferred): Teach/remember a new fact.");
  assert.equal(
    answers[2],
    'noted — remembered 1 fact: father rdfs:subClassOf parent (father is a type of parent)\n\n' +
    'Goal (inferred): Teach/remember a new fact.\n\n' +
    'Canonical: does "father" inherits "parent"? — ask(inherits, subject="father", "parent")',
  );
  assert.equal(answers[3], "noted — remembered: ahab is male\n\nGoal (inferred): Teach/remember a new fact.");
  assert.equal(answers[4], "noted — remembered: a grandparent is a parent of a parent\n\nGoal (inferred): Teach/remember a new fact.");
  assert.equal(answers[5], "noted — remembered: a grandfather is a grandparent who is male\n\nGoal (inferred): Teach/remember a new fact.");

  // The last answer is the multi-hop derivation: tmct was never told "ahab is
  // the grandfather of ishmael" directly. It combines the two father facts,
  // the taught father/parent alias, and the ahab-is-male property, and cites
  // all four sources.
  const finalAnswer = answers[6];
  assert.equal(ASK, "is ahab the grandfather of ishmael");
  assert.match(finalAnswer, /^yes —/);
  assert.equal(
    finalAnswer,
    "yes — you told me: ahab fathers john (source: teach:chat:<session-id>@<timestamp>); " +
    "father is a kind of parent (source: ace:chat:<session-id>@<timestamp>); " +
    "you told me: john fathers ishmael (source: teach:chat:<session-id>@<timestamp>); " +
    "you told me: ahab is male (source: teach:chat:<session-id>@<timestamp>)",
  );
});
