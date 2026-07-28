import test from "node:test";
import assert from "node:assert/strict";
import { relabelForBroadcast } from "../../../src/domain/p2p/provenance-relabel.mjs";

test("a teach-kind tag is relabeled to teach:peer:<displayName>@<ts>", () => {
  const out = relabelForBroadcast("teach:chat:sess-123@2026-01-01T00:00:00.000Z", "amber-fox", "2026-01-01T00:01:00.000Z");
  assert.equal(out, "teach:peer:amber-fox@2026-01-01T00:01:00.000Z");
});

test("an operator (ace:) tag is relabeled the same way as teach", () => {
  const out = relabelForBroadcast("ace:chat:sess-1@2026-01-01T00:00:00.000Z", "mossy-acorn", "2026-01-01T00:02:00.000Z");
  assert.equal(out, "teach:peer:mossy-acorn@2026-01-01T00:02:00.000Z");
});

test("a mud world/testimony tag passes through unchanged", () => {
  assert.equal(relabelForBroadcast("world:mud-garden:turn5", "amber-fox", "2026-01-01T00:00:00.000Z"), "world:mud-garden:turn5");
  assert.equal(relabelForBroadcast("mud:badger-2:turn5", "amber-fox", "2026-01-01T00:00:00.000Z"), "mud:badger-2:turn5");
});

test("a corpus/reference tag passes through unchanged", () => {
  assert.equal(relabelForBroadcast("corpus:conceptnet /r/IsA", "amber-fox", "2026-01-01T00:00:00.000Z"), "corpus:conceptnet /r/IsA");
});

test("a multi-source union relabels only its teach/operator segments, leaving the rest", () => {
  const combined = "teach:chat:sess-1@2026-01-01T00:00:00.000Z | corpus:conceptnet /r/IsA";
  const out = relabelForBroadcast(combined, "amber-fox", "2026-01-01T00:03:00.000Z");
  assert.equal(out, "teach:peer:amber-fox@2026-01-01T00:03:00.000Z | corpus:conceptnet /r/IsA");
});

test("an empty or falsy provenance value passes through unchanged rather than throwing", () => {
  assert.equal(relabelForBroadcast("", "amber-fox", "2026-01-01T00:00:00.000Z"), "");
  assert.equal(relabelForBroadcast(undefined, "amber-fox", "2026-01-01T00:00:00.000Z"), "");
});
