// ask-memory-class-query.test.mjs — a real "list/count all X of class Y" query shape for
// MEMORY-graph classes (Fact/Utterance/Session/Source/Rule, or any taught class),
// reachable via ask.mjs alone — the gap live-testing during the viz chat panel's
// build confirmed ("how many facts are there"/"list facts" missed against a real
// memory graph, since the only working machinery lived in chat.mjs's factAnswer
// cascade, out of ask.mjs's/the browser bundle's scope).
//
// Uses a hand-built memory-shaped payload (the exact `{individuals,
// objectProperties}` shape memory/core.mjs's loadMemory + graph-build.mjs both
// produce), fed through the real parseEntities()+ask() pipeline — no mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask } from "../../src/domain/ask.mjs";

function memoryGraph() {
  const individuals = [
    { id: "fact:1", label: "cache is a kind of component", class: "Fact" },
    { id: "fact:2", label: "widget is a kind of gadget", class: "Fact" },
    { id: "fact:3", label: "widget has 2 parts", class: "Fact" },
    { id: "utt:1", label: "hello there", class: "Utterance" },
    { id: "utt:2", label: "how are you", class: "Utterance" },
  ];
  return parseEntities({ generated_at: "t", individuals, objectProperties: [] });
}

test("dynamic memory-class COUNT hit: 'how many facts are there' counts real Fact individuals", () => {
  const graph = memoryGraph();
  const r = ask(graph, "how many facts are there");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /^3 facts\.$/);
});

test("dynamic memory-class COUNT hit: synonym triggers ('count facts', 'number of facts', bare recall) all reach it", () => {
  const graph = memoryGraph();
  assert.match(ask(graph, "count facts").content, /^3 facts\.$/);
  assert.match(ask(graph, "number of facts").content, /^3 facts\.$/);
  assert.match(ask(graph, "how many facts do you know").content, /^3 facts\.$/);
});

test("dynamic memory-class COUNT hit: a different class in the same graph ('utterances') counts independently", () => {
  const graph = memoryGraph();
  assert.match(ask(graph, "how many utterances are there").content, /^2 utterances\.$/);
});

test("dynamic memory-class LIST hit: 'list facts' enumerates the real Fact labels", () => {
  const graph = memoryGraph();
  const r = ask(graph, "list facts");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(
    r.tmct_ask.matches.map((m) => m.label).sort(),
    ["cache is a kind of component", "widget has 2 parts", "widget is a kind of gadget"],
  );
});

test("dynamic memory-class LIST hit: synonym triggers ('list the facts', 'show me all facts', 'show the facts') all reach it", () => {
  const graph = memoryGraph();
  const base = ask(graph, "list facts").content;
  assert.equal(ask(graph, "list the facts").content, base);
  assert.equal(ask(graph, "show me all facts").content, base);
  assert.equal(ask(graph, "show the facts").content, base);
});

test("dynamic memory-class HONEST MISS: a class with zero individuals in THIS graph never fabricates a count/list", () => {
  const graph = memoryGraph(); // no Rule/Session/Source individuals in this fixture
  assert.equal(ask(graph, "how many rules are there").tmct_ask.miss, true);
  assert.equal(ask(graph, "list sessions").tmct_ask.miss, true);
});

test("dynamic memory-class HONEST MISS: a real restrictor tail is NOT this bare shape — declines rather than silently dropping the restrictor", () => {
  const graph = memoryGraph();
  const r = ask(graph, "list facts that mention widget");
  assert.equal(r.tmct_ask.miss, true);
  // must not silently answer as if the restrictor were never there
  assert.notEqual(r.content, ask(graph, "list facts").content);
});

test("dynamic memory-class fallback NEVER intercepts an ENTITY_TO_TYPE-owned noun (code-graph classes stay exactly as before)", () => {
  const graph = memoryGraph(); // no Module individuals at all
  const r = ask(graph, "list modules");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /no modules in this index/);
});

test("dynamic memory-class LIST hit: overflow past OVERFLOW_CAP gets NO module-scope narrow hint (facts aren't scoped by module)", () => {
  const individuals = [];
  for (let i = 0; i < 15; i++) individuals.push({ id: `fact:${i}`, label: `fact number ${i}`, class: "Fact" });
  const graph = parseEntities({ generated_at: "t", individuals, objectProperties: [] });
  const r = ask(graph, "list facts");
  assert.equal(r.tmct_ask.miss, false);
  assert.doesNotMatch(r.content, /narrow with/);
  assert.match(r.content, /…and 3 more/);
});

test("dynamic memory-class COUNT/LIST both carry a non-throwing canonical form (compositional fallback gloss)", () => {
  const graph = memoryGraph();
  const r = ask(graph, "how many facts are there");
  assert.ok(r.tmct_ask.canonical);
  assert.equal(r.tmct_ask.canonical.machine, "composite(count)");
});
