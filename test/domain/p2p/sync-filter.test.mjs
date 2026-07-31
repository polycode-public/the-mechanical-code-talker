import test from "node:test";
import assert from "node:assert/strict";
import { chatSyncableFacts, mudSyncableFacts } from "../../../src/domain/p2p/sync-filter.mjs";

test("chatSyncableFacts keeps only teach/operator-provenance rows, dropping shipped corpus rows", () => {
  const rows = [
    { subject: "rover", predicate: "mgx:isA", object: "dog", provenance: "teach:chat:sess-1@2026-01-01T00:00:00.000Z" },
    { subject: "rover", predicate: "mgx:barks", object: "true", provenance: "ace:chat:sess-1@2026-01-01T00:00:00.000Z" },
    { subject: "dog", predicate: "mgx:isA", object: "animal", provenance: "corpus:conceptnet /r/IsA" },
    { subject: "cat", predicate: "mgx:isA", object: "animal", provenance: "" },
  ];
  const kept = chatSyncableFacts(rows);
  assert.deepEqual(kept.map((r) => r.subject), ["rover", "rover"]);
});

test("mudSyncableFacts keeps rows the injected predicate check accepts, plus any extra P2P predicate", () => {
  const isMudStatePredicate = (predicate) => predicate === "mgx:currently-in" || /^mgx:has-exit-/.test(predicate);
  const rows = [
    { subject: "badger-2@turn5", predicate: "mgx:currently-in", object: "sett-1" },
    { subject: "sett-1", predicate: "mgx:has-exit-north", object: "sett-1-north" },
    { subject: "sett-1", predicate: "rdf:type", object: "room" },
    { subject: "peer:p1", predicate: "mgx:nodeName", object: "amber-fox" },
  ];
  const kept = mudSyncableFacts(rows, isMudStatePredicate, ["mgx:nodeName"]);
  assert.deepEqual(kept.map((r) => r.predicate), ["mgx:currently-in", "mgx:has-exit-north", "mgx:nodeName"]);
});

test("mudSyncableFacts with no extra predicates still works, dropping anything the check rejects", () => {
  const rows = [{ subject: "x", predicate: "rdf:type", object: "room" }];
  assert.deepEqual(mudSyncableFacts(rows, () => false), []);
});
