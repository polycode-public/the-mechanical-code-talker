// code-explorer-hints: suggested next queries drawn from a loaded code graph.
// The generator is pure over the entities payload and never imports Electron,
// so it lives in npm test's hermetic tree. These tests hold it to its core
// promise: a hint appears only when the graph actually carries the edge or
// class it names, and the focus symbol fills a slot only where it sits on a
// real edge — so every suggestion resolves to a real answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCodeHints } from "../../src/domain/code-explorer-hints.mjs";

// A small hand-built graph in the payload shape parseEntities reads: a module
// that imports another and defines a function, a function called by another,
// and a class that contains a method.
function sampleGraph() {
  return {
    individuals: [
      { id: "mod:a.mjs", label: "a.mjs", class: "Module" },
      { id: "mod:b.mjs", label: "b.mjs", class: "Module" },
      { id: "fn:doThing", label: "doThing", class: "Function" },
      { id: "fn:caller", label: "caller", class: "Function" },
      { id: "cls:Widget", label: "Widget", class: "Class" },
      { id: "meth:Widget.render", label: "Widget.render", class: "Method" },
    ],
    objectProperties: [
      { predicate: "imports", count: 1, examples: [{ subject: "mod:a.mjs", object: "mod:b.mjs", subjectLabel: "a.mjs", objectLabel: "b.mjs" }] },
      { predicate: "defines", count: 1, examples: [{ subject: "mod:a.mjs", object: "fn:doThing", subjectLabel: "a.mjs", objectLabel: "doThing" }] },
      { predicate: "calls", count: 1, examples: [{ subject: "fn:caller", object: "fn:doThing", subjectLabel: "caller", objectLabel: "doThing" }] },
      { predicate: "contains", count: 1, examples: [{ subject: "cls:Widget", object: "meth:Widget.render", subjectLabel: "Widget", objectLabel: "Widget.render" }] },
      { predicate: "tests", count: 1, examples: [{ subject: "mod:b.mjs", object: "mod:a.mjs", subjectLabel: "b.mjs", objectLabel: "a.mjs" }] },
    ],
  };
}

const texts = (payload, opts) => generateCodeHints(payload, opts).hints.map((h) => h.text);

test("an empty graph yields no hints and a null focus", () => {
  const out = generateCodeHints({ individuals: [], objectProperties: [] });
  assert.equal(out.focus, null);
  assert.deepEqual(out.hints, []);
});

test("a listing and a count are suggested for every present code class", () => {
  // A generous limit so the assertion sees past the capped default, which
  // ranks neighbourhood and whole-graph rankings ahead of per-class listings.
  const t = texts(sampleGraph(), { limit: 40 });
  assert.ok(t.includes("list modules"), "list modules");
  assert.ok(t.includes("how many modules"), "how many modules");
  assert.ok(t.includes("list functions"), "list functions");
  assert.ok(t.includes("how many classes"), "how many classes");
  assert.ok(t.includes("list methods"), "list methods");
});

test("no listing is suggested for a class the graph does not hold", () => {
  const t = texts(sampleGraph());
  assert.ok(!t.some((s) => /variables|commits/.test(s)), "no variable/commit lists for a graph without them");
});

test("a forward neighbourhood hint appears only where the focus is an edge subject", () => {
  const t = texts(sampleGraph(), { focus: "a.mjs" });
  assert.ok(t.includes("what does a.mjs import"), "a.mjs imports something");
  assert.ok(t.includes("what does a.mjs define"), "a.mjs defines something");
  // a.mjs never calls anything in this graph, so no forward-call hint.
  assert.ok(!t.includes("what does a.mjs call"), "a.mjs calls nothing");
});

test("a reverse neighbourhood hint appears only where the focus is an edge object", () => {
  const t = texts(sampleGraph(), { focus: "doThing" });
  assert.ok(t.includes("what calls doThing"), "doThing is a call target");
  // doThing is not imported by anything, so no reverse-import hint.
  assert.ok(!t.includes("what imports doThing"), "doThing is never imported");
});

test("the compositional call shape names a real call target", () => {
  const t = texts(sampleGraph());
  assert.ok(t.includes("which functions call doThing"), "doThing is called in the graph");
});

test("public-methods hint names a class that actually contains members", () => {
  const t = texts(sampleGraph());
  assert.ok(t.includes("public methods of Widget"), "Widget contains a method");
});

test("a superlative is only offered when its ranking relation is present", () => {
  const withImports = texts(sampleGraph());
  assert.ok(withImports.includes("which module has the most imports"), "imports present");

  const noImports = {
    individuals: [{ id: "cls:X", label: "X", class: "Class" }],
    objectProperties: [{ predicate: "contains", count: 0, examples: [] }],
  };
  assert.ok(!texts(noImports).some((s) => /most imports/.test(s)), "no import ranking without import edges");
});

test("focus defaults to the highest-degree focusable symbol", () => {
  // doThing sits on two edges (defines-object, calls-object); a.mjs sits on
  // three (imports-subject, defines-subject, tests-object) — a.mjs wins.
  assert.equal(generateCodeHints(sampleGraph()).focus, "a.mjs");
});

test("an explicit focus overrides the default when it is a real term", () => {
  assert.equal(generateCodeHints(sampleGraph(), { focus: "doThing" }).focus, "doThing");
  // an unknown term falls back to the default rather than inventing a slot.
  assert.equal(generateCodeHints(sampleGraph(), { focus: "ghost" }).focus, "a.mjs");
});

test("the limit caps the returned hint count", () => {
  assert.ok(generateCodeHints(sampleGraph(), { limit: 3 }).hints.length <= 3);
});

// The provider-declared kinds. tmct's own indexer emits neither, so sampleGraph
// carries no such edge and no such hint — a graph supplied over the provider
// seam gets the same forward/reverse pair every other relation gets.
function providerGraph() {
  return {
    individuals: [
      { id: "mod:handler.mjs", label: "handler.mjs", class: "Module" },
      { id: "mod:route.mjs", label: "route.mjs", class: "Module" },
      { id: "lex:task", label: "task", class: "Function" },
    ],
    objectProperties: [
      { predicate: "serves", count: 1, examples: [{ subject: "mod:handler.mjs", object: "mod:route.mjs", subjectLabel: "handler.mjs", objectLabel: "route.mjs" }] },
      { predicate: "denotes", count: 1, examples: [{ subject: "lex:task", object: "mod:handler.mjs", subjectLabel: "task", objectLabel: "handler.mjs" }] },
    ],
  };
}

test("a serves edge suggests the query from whichever end the focus sits on", () => {
  assert.ok(texts(providerGraph(), { focus: "handler.mjs", limit: 40 }).includes("what does handler.mjs serve"));
  assert.ok(texts(providerGraph(), { focus: "route.mjs", limit: 40 }).includes("what serves route.mjs"));
});

test("a denotes edge suggests the naming query from either end", () => {
  assert.ok(texts(providerGraph(), { focus: "task", limit: 40 }).includes("what does task denote"));
  assert.ok(texts(providerGraph(), { focus: "handler.mjs", limit: 40 }).includes("what denotes handler.mjs"));
});

test("no serves/denotes hint appears for a graph that carries neither edge", () => {
  const t = texts(sampleGraph(), { limit: 40 });
  assert.ok(!t.some((s) => /\bserve\b|\bdenote\b/.test(s)), "a hint names only a relation the graph actually holds");
});
