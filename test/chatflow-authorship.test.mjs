// chatflow-authorship.test.mjs — SKILL_CHAT_PLAYTEST regression transcript. The
// 0.8.1 commit-ref quick-win made "who touched X" name the author beside the sha
// ("abc1234 (Ada Lovelace)"), which invites the authorship synonyms a developer
// reaches for next — "who wrote X", "who authored X", "who is the author of X" —
// and every one of them hit the grammar wall. tmct has no separate authorship edge;
// "touched" IS the authorship signal (the churn commits carry the author), so these
// are true SYNONYMS of "who touched X", not a new capability.
//
// The dead-ends this pins (all ROUTING, no grammar rigidity — interpret/normalize.mjs):
//   D1  "who wrote X" / "who authored X" / "who is the author of X"  → who touched X
//   D2  "what needs tests" / "what needs testing"                    → the untested survey
//
// Driven against the SHIPPED examples/mini-webapp graph, whose churn history carries
// three named commit authors on src/core/store.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";
import { driveTurns } from "./helpers/session.mjs";

const GRAPH = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;
const drive = (queries) => driveTurns({ graphFile: GRAPH }, queries);

test("authorship flow: the 'who touched/wrote' conversation flows end to end (was 3 grammar walls)", async () => {
  const turns = [
    "who touched src/core/store.mjs",             // churn — friendly commit refs (quick-win)
    "who wrote src/core/store.mjs",               // synonym — was the grammar wall
    "who authored src/core/store.mjs",            // synonym — was the grammar wall
    "who is the author of src/core/store.mjs",    // synonym — was the grammar wall
  ];
  const rs = await drive(turns);

  for (let i = 0; i < rs.length; i += 1) {
    assert.equal(rs[i].record.miss, false, `turn ${i} "${turns[i]}" must not miss`);
    assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} no grammar wall`);
  }

  // the quick-win friendly commit ref (short sha + author) still leads.
  assert.match(rs[0].answer, /\(Grace Hopper\)/, "the friendly commit ref names the author");
  // …and every authorship synonym resolves to the identical churn answer — a true
  // route, not a guess.
  assert.equal(rs[1].answer, rs[0].answer, "'who wrote X' == 'who touched X'");
  assert.equal(rs[2].answer, rs[0].answer, "'who authored X' == 'who touched X'");
  assert.equal(rs[3].answer, rs[0].answer, "'who is the author of X' == 'who touched X'");
});

test("authorship routing: the synonym is FAITHFUL — 'who wrote it' == the canonical 'who touched it'", async () => {
  // the rewrite preserves the "it" anaphora verbatim, so "who wrote it" produces
  // exactly what the canonical "who touched it" produces in the same discourse — the
  // synonym never diverges from the shape it routes to (whatever that shape resolves
  // to for a given focus). Pinned as byte-equality against the canonical, not against
  // a fixed answer, so it stays true if the churn-focus behaviour itself changes.
  const config = { graphFile: GRAPH };
  clearCache();
  const first = await runTurn("who touched src/core/store.mjs", { config });
  clearCache();
  const synonym = await runTurn("who wrote it", { config, last: first.last });
  clearCache();
  const canonical = await runTurn("who touched it", { config, last: first.last });
  assert.equal(synonym.answer, canonical.answer, "'who wrote it' == 'who touched it' (faithful route)");
  assert.equal(synonym.record.miss, canonical.record.miss, "…and the same miss verdict");
});

test("needs-tests routing: 'what needs tests' / 'what needs testing' reach the untested survey", async () => {
  const [needsTests, needsTesting, untested] = await drive([
    "what needs tests",
    "what needs testing",
    "untested modules",
  ]);
  for (const [name, r] of [["what needs tests", needsTests], ["what needs testing", needsTesting]]) {
    assert.equal(r.record.miss, false, `"${name}" now answers`);
    assert.match(r.answer, /src\/core\/validate\.mjs/, `"${name}" names an uncovered module`);
  }
  assert.equal(needsTests.answer, untested.answer, "'what needs tests' == 'untested modules'");
  assert.equal(needsTesting.answer, untested.answer, "'what needs testing' == 'untested modules'");
});

// ---- 0.8.2 WS4 APPENDS below (this file is append-only) -----------------------
// The AUTHOR LANE: author is a Commit ATTRIBUTE (key "author"/mgx:commitAuthor),
// so "who is Grace Hopper" can never resolve as a graph entity — chat.mjs's
// authorLane answers it from codegraph.mjs's authorIndex renderers instead.
// Closed regexes + exact case-insensitive name hits; unknown names fall through
// to the ordinary honest miss. Driven against the SHIPPED examples/mini-webapp
// graph (real named authors: Grace Hopper, Alan Kay, Radia Perlman, Barbara Liskov).
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

let WS4_GRAPH;
async function ws4Graph() {
  clearCache();
  return (WS4_GRAPH ||= parseEntities(await source.fetchEntities({ graphFile: GRAPH })));
}

async function ws4Drive(queries) {
  const config = { graphFile: GRAPH };
  const graph = await ws4Graph();
  const out = [];
  let last = null;
  for (const q of queries) {
    const r = await runTurn(q, { config, graph, last });
    out.push(r);
    last = r.last ?? last;
  }
  return out;
}

test("WS4 author lane: who-is / what-did-touch / sha authorship answer from Commit attributes", async () => {
  const turns = [
    "who is Grace Hopper",                          // identity card
    "what did grace hopper touch",                  // touched-entity list (case-insensitive)
    "what has Barbara Liskov worked on",            // worked-on synonym
    "who authored a1b2c3d",                         // sha PREFIX form (3 words — via the meta delegation)
    "who is the author of commit a1b2c3d4e5f6",     // full-sha wrapped form
  ];
  const rs = await ws4Drive(turns);
  for (let i = 0; i < rs.length; i += 1) {
    assert.equal(rs[i].record.miss, false, `turn ${i} "${turns[i]}" must not miss`);
    assert.equal(rs[i].record.via, "author", `turn ${i} carries the author-lane provenance`);
    assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} no grammar wall`);
  }
  assert.match(rs[0].answer, /^Grace Hopper — 2 commits in this index \(May 2026\), touching: /, "the identity card");
  assert.match(rs[0].answer, /src\/core\/model\.mjs/, "…naming what she touched");
  assert.match(rs[1].answer, /^Grace Hopper touched 3 entities across 2 commits:/, "the touched list, exact-hit on lowercased input");
  assert.match(rs[1].answer, /src\/core\/store\.mjs/);
  assert.match(rs[2].answer, /^Barbara Liskov touched \d+ entit/, "worked-on synonym answers too");
  assert.equal(rs[3].answer, "a1b2c3d4e5f6: authored by Grace Hopper (2026-05-02T09:12:00+00:00).", "sha prefix → author + date");
  assert.equal(rs[4].answer, rs[3].answer, "the wrapped full-sha form gives the identical answer");
});

test("WS4 author lane: an unknown name is an honest miss, never a guess", async () => {
  const rs = await ws4Drive(["who is Bogus McPhantom", "what did Nobody Here touch"]);
  for (const r of rs) {
    assert.equal(r.record.miss, true, "unknown names fall through to the ordinary miss");
    assert.notEqual(r.record.via, "author", "the author lane never claims an unknown name");
    assert.doesNotMatch(r.answer, /Bogus McPhantom —/, "no fabricated identity card");
  }
});
