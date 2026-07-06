// chatflow-architecture.test.mjs — SKILL_CHAT_PLAYTEST regression transcript. A
// tier-3 "get oriented in this codebase" conversation — count → hotspot → its
// dependents → visibility → coverage — that flows to a USEFUL outcome (the user
// leaves knowing the central module, its blast radius, and what's untested), every
// turn answering with no grammar wall.
//
// It exercises the predicative-qualifier routing (interpret/normalize.mjs) mid-flow,
// alongside the count / superlative / depends-on shapes that already worked, so the
// fix is pinned inside a real multi-turn conversation, not just in isolation.
//
// Driven against the SHIPPED examples/mini-webapp graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const GRAPH = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;

async function drive(queries) {
  const config = { graphFile: GRAPH };
  const out = [];
  let last = null;
  for (const q of queries) {
    clearCache();
    const r = await runTurn(q, { config, last });
    out.push(r);
    last = r.last;
  }
  return out;
}

test("architecture flow: count → hotspot → dependents → visibility → coverage flows end to end", async () => {
  const turns = [
    "how many modules are there",              // aggregate — worked
    "what is the most imported module",        // superlative hotspot — worked
    "what depends on src/core/model.mjs",      // reverse-imports blast radius — worked
    "which classes are public",                // predicative qualifier — was a wall
    "which modules are untested",              // predicative qualifier — was a wall
  ];
  const rs = await drive(turns);

  for (let i = 0; i < rs.length; i += 1) {
    assert.equal(rs[i].record.miss, false, `turn ${i} "${turns[i]}" must not miss`);
    assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} no grammar wall`);
    assert.doesNotMatch(rs[i].answer, /unknown qualifier/, `turn ${i} no unknown-qualifier`);
  }

  assert.match(rs[0].answer, /12 modules/, "the module count");
  assert.match(rs[1].answer, /src\/core\/model\.mjs.*most imported/, "the hotspot is the most-imported module");
  // its dependents — the blast radius the hotspot's importers form.
  assert.match(rs[2].answer, /src\/core\/store\.mjs/, "a real dependent is named");
  assert.match(rs[2].answer, /src\/handlers\/tasks\.mjs/, "…and another");
  // visibility survey (public is the default, so every class lists).
  assert.match(rs[3].answer, /Record/, "public-classes survey lists the domain base class");
  // coverage survey — the untested set the user leaves with.
  assert.match(rs[4].answer, /src\/core\/validate\.mjs/, "coverage survey names an untested module");
});
