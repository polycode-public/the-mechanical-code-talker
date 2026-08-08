// world-snapshot.test.mjs — the one snapshot-subject grammar every reader
// (the adventure lane, autoplay, the recognizer) parses through. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotSubject, parseSnapshotSubject, baseSubjectOf } from "../../src/domain/world-snapshot.mjs";

test("snapshotSubject and parseSnapshotSubject round-trip an unstamped turn", () => {
  const subject = snapshotSubject("player", 3);
  assert.equal(subject, "player@turn3");
  assert.deepEqual(parseSnapshotSubject(subject), { base: "player", epoch: 0, turn: 3 });
});

test("an epoch-stamped subject reads its base, turn and epoch back whole", () => {
  const subject = snapshotSubject("letter", 3, 2);
  assert.equal(subject, "letter@epoch2@turn3");
  assert.deepEqual(parseSnapshotSubject(subject), { base: "letter", epoch: 2, turn: 3 });
});

test("a base row with no stamp parses to null and keeps its own subject", () => {
  assert.equal(parseSnapshotSubject("letter"), null);
  assert.equal(parseSnapshotSubject(""), null);
  assert.equal(parseSnapshotSubject(undefined), null);
});

test("baseSubjectOf strips an epoch segment as well as a turn segment", () => {
  assert.equal(baseSubjectOf("letter@epoch2@turn3"), "letter");
  assert.equal(baseSubjectOf("player@turn3"), "player");
  assert.equal(baseSubjectOf("letter"), "letter");
});
