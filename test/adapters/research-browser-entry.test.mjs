// research-browser-entry.test.mjs — researchSnapshot()'s hubs/recent panels,
// the pure derivation over an in-memory store src/surfaces/web/
// research-browser-entry.mjs feeds research.html's engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore, appendFacts } from "../../src/adapters/memory/core.mjs";
import { researchSnapshot } from "../../src/surfaces/web/research-browser-entry.mjs";

const fact = (subject, predicate, object) => ({ subject, predicate, object });

test("researchSnapshot(): hubs break a tied degree by codepoint term order, not locale order, whichever way the facts arrived", async () => {
  // "zebra" sorts BEFORE "élan" in codepoint order (z=0x7A < é=0xE9) but AFTER
  // it under locale-aware collation, so this only holds under codepoint order.
  // Both terms name exactly one fact each (tied degree 1).
  const rows = [
    fact("hub", "mgx:hasProperty", "zebra"),
    fact("hub", "mgx:hasProperty", "élan"),
  ];

  const forward = createInMemoryStore();
  await appendFacts(forward, rows.map((r) => ({ ...r, provenance: "corpus:test" })));
  const reversed = createInMemoryStore();
  await appendFacts(reversed, [...rows].reverse().map((r) => ({ ...r, provenance: "corpus:test" })));

  const forwardHubs = (await researchSnapshot(forward)).hubs.map((h) => h.term);
  const reversedHubs = (await researchSnapshot(reversed)).hubs.map((h) => h.term);
  assert.deepEqual(forwardHubs, reversedHubs, "fact arrival order never changes the hub order");

  const zebraIdx = forwardHubs.indexOf("zebra");
  const elanIdx = forwardHubs.indexOf("élan");
  assert.ok(zebraIdx >= 0 && elanIdx >= 0, "both terms appear as hubs");
  assert.ok(zebraIdx < elanIdx, "codepoint order ranks 'zebra' ahead of 'élan' on a tied degree");
});

test("researchSnapshot(): the recent panel renders byte-identical however the underlying facts arrived", async () => {
  const rows = [
    { ...fact("alpha", "mgx:hasProperty", "one"), createdAt: "2026-08-01T00:00:00.000Z" },
    { ...fact("beta", "mgx:hasProperty", "two"), createdAt: "2026-08-02T00:00:00.000Z" },
    { ...fact("gamma", "mgx:hasProperty", "three"), createdAt: "2026-08-03T00:00:00.000Z" },
  ];
  const sessionIds = { chatSessionId: "s1" };
  const withProvenance = (order) => order.map((r) => ({
    ...r, provenance: `teach:chat:s1@${r.createdAt}`,
  }));

  const forward = createInMemoryStore();
  await appendFacts(forward, withProvenance(rows));
  const reversed = createInMemoryStore();
  await appendFacts(reversed, withProvenance([...rows].reverse()));

  const forwardRecent = (await researchSnapshot(forward, sessionIds)).recent;
  const reversedRecent = (await researchSnapshot(reversed, sessionIds)).recent;
  assert.deepEqual(reversedRecent, forwardRecent, "fact arrival order never changes the recent-panel order");
  assert.deepEqual(forwardRecent.map((r) => r.subject), ["gamma", "beta", "alpha"], "newest first");
});
