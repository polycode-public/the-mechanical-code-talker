// Regression coverage for the bug report that opened this: teaching "Rover is
// a dog." then asking "Does Rover bark?" must chain the taught fact (rover
// rdf:type dog — "Rover" is lexicon-absent, so it reads as a named
// individual, not a class) through the corpus fact (dog mgx:capableOf bark)
// and answer with both citations. examples/rover-infer.mjs carries the
// verified TEACH/ASK constants and the provenance-normalization this test
// reuses rather than re-deriving the scenario; e2e coverage for the same
// scenario against chat.html and the TUI lives in test-e2e/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runExample, TEACH, ASK } from "../../examples/rover-infer.mjs";

test("teaching \"Rover is a dog.\" then asking \"Does Rover bark?\" chains the taught ISA fact through the corpus capability fact", async () => {
  assert.deepEqual(TEACH, ["Rover is a dog."]);
  assert.equal(ASK, "Does Rover bark?");

  const answers = await runExample();
  assert.equal(answers.length, 2, "one answer per scripted line");

  assert.match(answers[0], /^noted — remembered 1 fact: rover rdf:type dog/, "the teach turn records the ISA fact");

  assert.equal(
    answers[1],
    'yes — dog can bark (source: corpus:human /r/CapableOf) — via: rover is a dog (source: ace:chat:<session-id>@<timestamp>)',
    "the ask chains through the taught fact and cites both the corpus capability and the taught ISA link",
  );
});
