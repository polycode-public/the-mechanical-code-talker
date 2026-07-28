import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_NAME_PREDICATE, NODE_NAME_PREDICATE, PLAYED_BY_PREDICATE, WAVED_PREDICATE,
  worldNameFact, nodeNameFact, playedByFact, waveFact,
  latestProvenanceTimestamp, isRecentWave, latestFact,
} from "../../../src/domain/p2p/facts.mjs";

test("each constructor writes the predicate its own name promises, with a parseable provenance", () => {
  const w = worldNameFact("world-1", "amber-meadow", "2026-01-01T00:00:00.000Z");
  assert.equal(w.predicate, WORLD_NAME_PREDICATE);
  assert.equal(latestProvenanceTimestamp(w.provenance), Date.parse("2026-01-01T00:00:00.000Z"));

  const n = nodeNameFact("peer-1", "mossy-acorn", "2026-01-01T00:00:00.000Z");
  assert.equal(n.predicate, NODE_NAME_PREDICATE);
  assert.equal(n.subject, "peer:peer-1");

  const p = playedByFact("badger-2", "peer-1", "2026-01-01T00:00:00.000Z");
  assert.equal(p.predicate, PLAYED_BY_PREDICATE);
  assert.equal(p.object, "peer:peer-1");

  const wave = waveFact("badger-2", "sett-1", "2026-01-01T00:00:00.000Z");
  assert.equal(wave.predicate, WAVED_PREDICATE);
  assert.equal(wave.subject, "badger-2");
  assert.equal(wave.object, "sett-1");
});

test("a wave repeated in the same room mints the identical (subject,predicate,object) — only the provenance differs", () => {
  const first = waveFact("badger-2", "sett-1", "2026-01-01T00:00:00.000Z");
  const second = waveFact("badger-2", "sett-1", "2026-01-01T00:05:00.000Z");
  assert.equal(first.subject, second.subject);
  assert.equal(first.predicate, second.predicate);
  assert.equal(first.object, second.object);
  assert.notEqual(first.provenance, second.provenance);
});

test("isRecentWave is true within the window and false once it's elapsed", () => {
  const wave = waveFact("badger-2", "sett-1", "2026-01-01T00:00:00.000Z");
  const at = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(isRecentWave(wave, at + 2000, 8000), true);
  assert.equal(isRecentWave(wave, at + 9000, 8000), false);
  assert.equal(isRecentWave(wave, at - 1, 8000), false, "a wave can't be recent before it happened");
});

test("isRecentWave reads the NEWEST provenance segment when a wave fact has accumulated more than one", () => {
  const stale = waveFact("badger-2", "sett-1", "2026-01-01T00:00:00.000Z");
  const fresh = waveFact("badger-2", "sett-1", "2026-01-01T00:00:10.000Z");
  const merged = { ...stale, provenance: `${stale.provenance} | ${fresh.provenance}` };
  const now = Date.parse("2026-01-01T00:00:10.000Z") + 1000;
  assert.equal(isRecentWave(merged, now, 8000), true, "the fresh segment should win, not the stale one");
});

test("latestFact picks the row with the newest provenance timestamp for a subject+predicate pair", () => {
  const older = nodeNameFact("peer-1", "old-name", "2026-01-01T00:00:00.000Z");
  const newer = nodeNameFact("peer-1", "new-name", "2026-01-01T00:10:00.000Z");
  const found = latestFact([older, newer], "peer:peer-1", NODE_NAME_PREDICATE);
  assert.equal(found.object, "new-name");
});

test("latestFact returns null when nothing matches the subject+predicate pair", () => {
  assert.equal(latestFact([], "peer:peer-1", NODE_NAME_PREDICATE), null);
});
