// The cross-turn temporal comparison: "was that before logger.mjs was
// touched" binds the singular form to a dated discourse referent (the
// commit-filter pivot), re-reads the embedded passive clause as its own
// when-question, and compares the two ISO dates with both sides cited. An
// unbound form or an unanswerable clause falls through, so the sentence
// keeps its honest miss. Driven through runTurn against the committed
// mini-webapp example graph, read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { emptyRecord } from "../../src/domain/discourse.mjs";

const GRAPH_FILE = join(new URL("../..", import.meta.url).pathname, "examples", "mini-webapp", ".tmct", "graph.json");

let graph;
test.before(async () => {
  graph = parseEntities(JSON.parse(await readFile(GRAPH_FILE, "utf8")));
});

const base = () => ({ config: { graphFile: GRAPH_FILE }, graph });

/** Run the commit-filter opener, then `followUp` with the record threaded. */
async function afterCommitFilter(followUp) {
  const first = await runTurn("what changed before 1b2c3d4e5f60", { ...base(), discourse: emptyRecord() });
  return runTurn(followUp, { ...base(), discourse: first.discourse, last: first.last, focus: first.focus });
}

test("'was that before X was touched' binds the pivot, reads the clause fresh, and cites both dates", async () => {
  const r = await afterCommitFilter("was that before logger.mjs was touched");
  assert.match(String(r.answer),
    /^No — 1b2c3d4e5f60 \(2026-05-24\) came after logger\.mjs was last touched \(e5f6a1b2c3d4, 2026-05-15\)\./);
  assert.equal(r.detail.matches.length, 2, "both cited commits ride the detail");
});

test("the yes direction and the after operator hold: the pivot post-dates every earlier touch", async () => {
  const r = await afterCommitFilter("was it after logger.mjs was touched");
  assert.match(String(r.answer),
    /^Yes — 1b2c3d4e5f60 \(2026-05-24\) came after logger\.mjs was last touched \(e5f6a1b2c3d4, 2026-05-15\)\./);
});

test("two events on the same day are said to land on the same day, never forced into before/after", async () => {
  // store.mjs's newest touch IS the pivot commit itself.
  const r = await afterCommitFilter("was that after store.mjs was touched");
  assert.match(String(r.answer),
    /^No — 1b2c3d4e5f60 \(2026-05-24\) landed on the same day as store\.mjs was last touched \(1b2c3d4e5f60, 2026-05-24\)\./);
});

test("an unbound form keeps today's miss: with no record standing the lane never answers", async () => {
  const r = await runTurn("was that before logger.mjs was touched", { ...base(), discourse: emptyRecord() });
  assert.doesNotMatch(String(r.answer), /came (?:before|after)/);
  assert.ok(r.record?.miss ?? /couldn't|don't know/.test(String(r.answer)), "the turn misses honestly");
});

test("a clause the engine cannot date keeps today's miss", async () => {
  const r = await afterCommitFilter("was that before no-such-file.mjs was touched");
  assert.doesNotMatch(String(r.answer), /came (?:before|after)|landed on the same day/);
});
