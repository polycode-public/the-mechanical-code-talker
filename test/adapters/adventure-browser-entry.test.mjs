// adventure-browser-entry: a saved Backend-B payload snapshot restores into a
// fresh session with the world state intact — the round-trip the adventure
// page's own IndexedDB persistence rests on. A minimal two-room world with
// go/take rules (mirroring Ashcombe Hall's own rule shapes) is enough to
// prove the whole mechanism: play, snapshot the payload, rebuild, keep
// playing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdventureSession } from "../../src/surfaces/web/adventure-browser-entry.mjs";

const worldPayload = {
  name: "two-room-world",
  facts: [
    { subject: "player", predicate: "rdf:type", object: "adventurer" },
    { subject: "player", predicate: "mgx:currently-in", object: "hall" },
    { subject: "hall", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "rdf:type", object: "room" },
    { subject: "hall", predicate: "mgx:has-exit-east", object: "garden" },
    { subject: "garden", predicate: "mgx:has-exit-west", object: "hall" },
    { subject: "lamp", predicate: "rdf:type", object: "portable" },
    { subject: "lamp", predicate: "mgx:located-in", object: "garden" },
  ],
  rules: [
    { name: "go", ruleKind: "action-signature", slots: { subjectClass: "adventurer", targetClass: "room" } },
    { name: "go", ruleKind: "action-effect", slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" } },
    { name: "take", ruleKind: "action-signature", slots: { subjectClass: "portable", targetClass: "adventurer" } },
    { name: "take", ruleKind: "action-effect", slots: { predicate: "located-in", subjectRole: "subject", objectRole: "target" } },
  ],
  opening: "you are in the hall.",
};

test("a restored payload snapshot resumes a go/take sequence: position, inventory, turn count and visited rooms all survive, and play continues", async () => {
  const session = await createAdventureSession(worldPayload);
  await session.turn("go east");
  await session.turn("take lamp");
  const before = await session.snapshot();
  assert.equal(before.here, "garden");
  assert.equal(before.turn, 2);

  const savedPayload = structuredClone(session.memoryDir.payload);
  const savedVisited = [...before.visitedRoomIds];

  const restored = await createAdventureSession(worldPayload, {
    restoredPayload: savedPayload,
    restoredVisitedRoomIds: savedVisited,
  });
  const snap = await restored.snapshot();
  assert.equal(snap.here, "garden", "the player resumes in the room the snapshot left them in");
  assert.equal(snap.turn, 2, "the turn counter folds back from the snapshot's @turnN rows");
  assert.equal(snap.state.placements.get("lamp")?.object, "player", "the carried lamp is still carried");
  assert.deepEqual([...snap.visitedRoomIds].sort(), ["garden", "hall"], "the exposure set carries forward");

  const back = await restored.turn("go west");
  assert.match(back.answer, /go west/i, "the restored session keeps executing world commands");
  const after = await restored.snapshot();
  assert.equal(after.here, "hall");
  assert.equal(after.turn, 3, "new turns append past the restored counter, never restarting it");
});

test("restoring without a visited-room list still exposes the player's current room", async () => {
  const session = await createAdventureSession(worldPayload);
  await session.turn("go east");
  const savedPayload = structuredClone(session.memoryDir.payload);

  const restored = await createAdventureSession(worldPayload, { restoredPayload: savedPayload });
  const snap = await restored.snapshot();
  assert.deepEqual(snap.visitedRoomIds, ["garden"], "the room the player stands in is always visible");
});
