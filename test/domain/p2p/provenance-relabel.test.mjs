import test from "node:test";
import assert from "node:assert/strict";
import { relabelForBroadcast, peerProvenanceTag } from "../../../src/domain/p2p/provenance-relabel.mjs";
import { provenanceTagToSource } from "../../../src/domain/memory/trust.mjs";

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

// ---- the node segment ------------------------------------------------------

test("a relabeled tag carries the broadcasting node's stable id, not only the name it shows", () => {
  const out = relabelForBroadcast("teach:chat:sess-123@2026-01-01T00:00:00.000Z", "amber-fox", "2026-01-01T00:01:00.000Z", "7f3a9c2e5b1d4a60");
  assert.equal(out, "teach:peer:amber-fox#node:7f3a9c2e5b1d4a60@2026-01-01T00:01:00.000Z");
});

test("a node with no id yet emits the segment-free shape, which every reader still parses", () => {
  const out = relabelForBroadcast("teach:chat:sess-123@2026-01-01T00:00:00.000Z", "amber-fox", "2026-01-01T00:01:00.000Z");
  assert.equal(out, "teach:peer:amber-fox@2026-01-01T00:01:00.000Z");
});

test("a tag already carrying another node's id passes through untouched, so relaying never reassigns authorship", () => {
  const theirs = "teach:peer:mossy-acorn#node:6589e595d1fa9a90@2026-01-01T00:00:00.000Z";
  assert.equal(relabelForBroadcast(theirs, "amber-fox", "2026-01-01T00:09:00.000Z", "7f3a9c2e5b1d4a60"), theirs);
});

test("relabeling twice is byte-identical, so a union stops growing once every peer has seen a tag", () => {
  const once = relabelForBroadcast("teach:chat:s@2026-01-01T00:00:00.000Z", "amber-fox", "2026-01-01T00:01:00.000Z", "7f3a9c2e5b1d4a60");
  assert.equal(relabelForBroadcast(once, "amber-fox", "2026-01-01T00:01:00.000Z", "7f3a9c2e5b1d4a60"), once);
});

test("a tag the relabeler emits parses back to the node id it embedded", () => {
  const tag = peerProvenanceTag("amber-fox", "2026-01-01T00:01:00.000Z", "7f3a9c2e5b1d4a60");
  const source = provenanceTagToSource(tag);
  assert.equal(source.kind, "teachNode");
  assert.equal(source.nodeId, "7f3a9c2e5b1d4a60");
  assert.equal(source.displayName, "amber-fox");
  assert.equal(source.createdAt, "2026-01-01T00:01:00.000Z");
});
