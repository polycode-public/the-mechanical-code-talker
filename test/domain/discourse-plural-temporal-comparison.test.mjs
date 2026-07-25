// The cross-turn temporal comparison over a PLURAL antecedent: "were those
// before logger.mjs was touched" binds a `set` referent a prior listing/filter
// established, dates every member from the graph, re-reads the embedded passive
// clause as its own when-question, and quantifies the set against that date —
// all, none, or M of N — with both the clause commit and its date cited. A set
// whose members are not all datable, an unbound plural form, or an undatable
// clause each keep the honest miss. Driven through runTurn against the
// committed mini-webapp example graph, read-only.
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

/** Run an opener that registers a `set` referent, then `followUp` with the
 *  record threaded. */
async function afterOpener(opener, followUp) {
  const first = await runTurn(opener, { ...base(), discourse: emptyRecord() });
  return runTurn(followUp, { ...base(), discourse: first.discourse, last: first.last, focus: first.focus });
}

const afterCommitFilter = (followUp) => afterOpener("what changed before 1b2c3d4e5f60", followUp);

test("a partial split reports M of N: the commit set straddles the clause date", async () => {
  const r = await afterCommitFilter("were those before logger.mjs was touched");
  assert.match(String(r.answer),
    /^Partly — 4 of the 7 commits before 1b2c3d4e5f60 came before logger\.mjs was last touched \(e5f6a1b2c3d4, 2026-05-15\); the other 3 did not\./);
  assert.equal(r.detail.matches.length, 8, "all seven set members plus the clause commit ride the detail");
});

test("the after operator flips the split: two commits post-date the clause", async () => {
  const r = await afterCommitFilter("were those after logger.mjs was touched");
  assert.match(String(r.answer),
    /^Partly — 2 of the 7 commits before 1b2c3d4e5f60 came after logger\.mjs was last touched \(e5f6a1b2c3d4, 2026-05-15\); the other 5 did not\./);
});

test("all members satisfy: every commit pre-dates the newest touch of store.mjs", async () => {
  const r = await afterCommitFilter("are these before store.mjs was touched");
  assert.match(String(r.answer),
    /^Yes — all 7 commits before 1b2c3d4e5f60 came before store\.mjs was last touched \(1b2c3d4e5f60, 2026-05-24\)\./);
});

test("no member satisfies: none of the set post-dates a touch every member pre-dates", async () => {
  const r = await afterCommitFilter("were those after store.mjs was touched");
  assert.match(String(r.answer),
    /^No — none of the 7 commits before 1b2c3d4e5f60 came after store\.mjs was last touched \(1b2c3d4e5f60, 2026-05-24\)\./);
});

test("a set whose members carry no date refuses rather than guessing a comparison", async () => {
  // A module listing registers a `set` of Modules, which carry no date.
  const r = await afterOpener("which modules import http.mjs", "were those before logger.mjs was touched");
  assert.match(String(r.answer),
    /not every member carries a date I can compare — 3 of the 3 have no date on record/);
  assert.doesNotMatch(String(r.answer), /came (?:before|after)/);
});

test("an unbound plural form keeps today's miss: with no set standing the lane never answers", async () => {
  const r = await runTurn("were those before logger.mjs was touched", { ...base(), discourse: emptyRecord() });
  assert.doesNotMatch(String(r.answer), /came (?:before|after)/);
  assert.match(String(r.answer), /I don't have a set for "those" yet/);
});

test("a clause the engine cannot date keeps today's miss", async () => {
  const r = await afterCommitFilter("were those before no-such-file.mjs was touched");
  assert.doesNotMatch(String(r.answer), /came (?:before|after)/);
  assert.match(String(r.answer), /couldn't date when no-such-file\.mjs was last touched/);
});
