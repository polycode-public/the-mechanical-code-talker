// ask-plural-anaphora-object.test.mjs — regression test for HANDOVER.md's
// deferred "plural anaphora" finding: CONTEXT_WORDS/resolveTermOrContext
// (src/chat.mjs, src/ask.mjs) only ever bound a SINGULAR pronoun ("it"/"this"/
// "that"/"here") to ask()'s contextId. "those"/"them" had no equivalent — a
// follow-up like "what tests cover those" after a list-shaped answer fell to
// an honest miss with the literal word "those" treated as an unresolvable
// module name, instead of resolving against the SET of entities the previous
// turn just listed.
//
// Fixed by a new compositional production, parsePluralAnaphoraObject
// (src/ask.mjs): a bare "those"/"them" — the reverse-clause OBJECT trailing
// its verb ("what tests cover those") or the forward-clause SUBJECT leading
// its verb ("what do those import") — compiles to the SAME reverseSet/
// forwardSet AST parseNested already uses for a nested relative clause
// ("modules that import X"), just with a new kind of `inner` leaf,
// {node:"prevSet"}, that reads ask()'s own `prev` id array (the same
// discourse state parseAnaphora's "of those"/"count them" shapes already
// read) instead of evaluating a nested clause. reverseSet/forwardSet's
// existing multi-object UNION traversal is reused verbatim — no new
// traversal primitive.
//
// Deliberately scoped (per the task): only "those"/"them" resolving against
// the most recent list-shaped answer, as the bare pronoun-position object/
// subject of an ordinary relation clause. A determiner use ("list those
// functions") and an "of those"/"of them" tail (parseAnaphora's own territory)
// are both left untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { ask, parseQueryFull } from "../src/ask.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

// Fixture ground truth this suite leans on (test/fixtures/entities.fixture.json):
//   imports: b.mjs -> a.mjs, c.mjs -> a.mjs, d/handler.mjs -> b.mjs, d/handler.mjs -> c.mjs,
//            e.mjs -> a.mjs, e.mjs -> f.mjs, f.mjs -> e.mjs
//   tests:   app/unit-tests/b.test.mjs covers BOTH app/lib/b.mjs AND app/functions/d/handler.mjs

test("parse: a trailing bare 'those'/'them' compiles to reverseSet+prevSet, not a literal object term", () => {
  assert.deepEqual(parseQueryFull("what tests cover those").parsed,
    { node: "reverseSet", kind: "tests", entityType: null, inner: { node: "prevSet" } });
  assert.deepEqual(parseQueryFull("what tests cover them").parsed,
    { node: "reverseSet", kind: "tests", entityType: null, inner: { node: "prevSet" } });
});

test("parse: a leading bare 'those' (forward-clause subject) compiles to forwardSet+prevSet", () => {
  assert.deepEqual(parseQueryFull("what do those import").parsed,
    { node: "forwardSet", kind: "imports", entityType: null, inner: { node: "prevSet" } });
  assert.deepEqual(parseQueryFull("what does those import").parsed,
    { node: "forwardSet", kind: "imports", entityType: null, inner: { node: "prevSet" } });
});

test("reverse: 'what tests cover those' unions the covering tests over the WHOLE prev set, deduped", () => {
  const r = ask(graph, "what tests cover those", { prev: ["mod-b", "mod-d"] });
  assert.equal(r.tmct_ask.miss, false, `expected a real answer, got a miss: ${r.content}`);
  // app/unit-tests/b.test.mjs covers BOTH mod-b and mod-d — the union must
  // still cite it exactly once, not twice.
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label), ["app/unit-tests/b.test.mjs"]);
});

test("reverse: 'what tests cover them' (the other plural pronoun) resolves the same way", () => {
  const r = ask(graph, "what tests cover them", { prev: ["mod-b", "mod-d"] });
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label), ["app/unit-tests/b.test.mjs"]);
});

test("forward: 'what do those import' unions the imports over the WHOLE prev set, deduped", () => {
  // mod-b imports {a}; mod-e imports {a, f} — union is {a, f}, "a" not doubled.
  const r = ask(graph, "what do those import", { prev: ["mod-b", "mod-e"] });
  assert.equal(r.tmct_ask.miss, false, `expected a real answer, got a miss: ${r.content}`);
  assert.deepEqual(
    r.tmct_ask.matches.map((m) => m.label).sort(),
    ["app/lib/a.mjs", "app/lib/f.mjs"],
  );
});

test("honest miss: 'those'/'them' with NO prior answer at all needs a previous answer, not an unresolvable-name miss", () => {
  const r = ask(graph, "what tests cover those", {});
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /needs a previous answer/);
  assert.doesNotMatch(r.content, /no module matching "those"/, "must not treat the bare pronoun as a literal unresolved name");
});

test("regression guard: a real prior TURN feeds prev end to end (ask() chained, no chat.mjs involvement)", () => {
  const first = ask(graph, "which modules import app/lib/a.mjs", {});
  assert.equal(first.tmct_ask.miss, false);
  const prevIds = first.tmct_ask.matches.map((m) => m.id);
  assert.ok(prevIds.length >= 2, "sanity: the prior set actually has 2+ ids");
  const follow = ask(graph, "what tests cover those", { prev: prevIds });
  assert.equal(follow.tmct_ask.miss, false, `expected a real answer, got a miss: ${follow.content}`);
  assert.match(follow.content, /app\/unit-tests\/b\.test\.mjs/);
});

test("regression guard: a determiner use ('list those functions') is UNTOUCHED — never seized as the plural-pronoun leaf", () => {
  const parsed = parseQueryFull("list those functions").parsed;
  assert.notEqual(parsed?.node, "reverseSet");
  assert.notEqual(parsed?.node, "forwardSet");
});

test("regression guard: an 'of those'/'of them' tail is STILL parseAnaphora's own shape, not reinterpreted here", () => {
  const parsed = parseQueryFull("which of those are tested").parsed;
  assert.equal(parsed?.node, "anaphora");
  const r = ask(graph, "which of those are tested", {});
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /needs a previous answer/);
});

test("regression guard: existing singular pronoun resolution (contextId) is unaffected by this change", () => {
  const r = ask(graph, "what does it import", { contextId: "mod-b" });
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label), ["app/lib/a.mjs"]);
});
