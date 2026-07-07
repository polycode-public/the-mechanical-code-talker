// ask-compositional.test.mjs — the compositional grammar layer (PLAN §5.16 P3):
// the step up from ELIZA keyword-spotting to a real recursive-descent grammar over
// CLAUSES. Each new capability is tested with BOTH a HIT (it compiles + answers
// from the real graph) and an HONEST-MISS control (a marker present but the phrase
// cannot compile → a stated miss, never a guess), plus the backward-compat guards
// that keep every existing simple query on the untouched two-strategy path.
//
// buildEntities/parseEntities build a REAL graph (same shape a real index produces)
// from a small fixture, exactly like ask.test.mjs, so these exercise the true
// traverse/render pipeline, not a mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../src/graph-build.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { parseQuery, ask } from "../src/ask.mjs";

// A fixture spanning every compositional capability:
//  - a 2-hop import chain (entry -> mid -> core, mid2 -> core) for NESTED;
//  - two call targets + a function calling both, one calling one, for BOOLEAN
//    intersection over callsSymbol;
//  - a Base with two subclasses, one in a TESTED module and one not, for BOOLEAN
//    difference/intersection with the `tested` qualifier and for INHERITS;
//  - public/private/static methods for QUALIFIER filters;
//  - a re-exported symbol for the `exported` qualifier;
//  - a test/ module (isTestPath) so a real tests edge exists.
const MODULES = [
  { path: "core.mjs", dotted: "core", imports: [], calls: [], defines: [{ name: "coreFn", kind: "function", lineno: 1, decorators: [] }] },
  { path: "mid.mjs", dotted: "mid", imports: ["core"], calls: [], defines: [] },
  { path: "mid2.mjs", dotted: "mid2", imports: ["core"], calls: [], defines: [] },
  { path: "entry.mjs", dotted: "entry", imports: ["mid"], calls: [], defines: [] },
  { path: "targets.mjs", dotted: "targets", imports: [], calls: [], defines: [
    { name: "alpha", kind: "function", lineno: 1, decorators: [] },
    { name: "beta", kind: "function", lineno: 2, decorators: [] }] },
  { path: "caller.mjs", dotted: "caller", imports: ["targets", "core"], calls: [], defines: [
    { name: "callsBoth", kind: "function", lineno: 1, decorators: [], calls: ["alpha", "beta"] },
    { name: "callsOne", kind: "function", lineno: 5, decorators: [], calls: ["alpha"] }] },
  { path: "base.mjs", dotted: "base", imports: [], calls: [], defines: [{ name: "Base", kind: "class", lineno: 1, decorators: [] }] },
  { path: "widget.mjs", dotted: "widget", imports: ["base"], calls: [], exports: ["pubMethod"], defines: [
    { name: "Widget", kind: "class", lineno: 1, decorators: [], bases: ["Base"] },
    { name: "pubMethod", kind: "method", lineno: 2, decorators: [] },
    { name: "privMethod", kind: "method", lineno: 3, decorators: [], visibility: "private" },
    { name: "statMethod", kind: "method", lineno: 4, decorators: [], is_static: true }] },
  { path: "gadget.mjs", dotted: "gadget", imports: ["base"], calls: [], defines: [{ name: "Gadget", kind: "class", lineno: 1, decorators: [], bases: ["Base"] }] },
  // path under test/ so isTestPath fires and a real mgx:testsCoverage edge is built
  // (widget.mjs becomes "tested"; gadget.mjs stays untested).
  { path: "test/widget.test.mjs", dotted: "test.widget", imports: ["widget"], calls: [], defines: [] },
];

function buildGraph() {
  const entities = buildEntities(MODULES, [], {});
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}
const graph = buildGraph();
const labels = (r) => r.tmct_ask.matches.map((m) => m.label).sort();

// ---- backward compat: the compositional layer must NOT hijack plain queries ----

test("compat: a plain reverse query still parses to a simple clause (no compositional hijack)", () => {
  const p = parseQuery("which functions call coreFn");
  assert.equal(p.node, undefined, "a plain clause must not become a compositional AST node");
  assert.equal(p.shape, "reverse");
  assert.equal(p.kind, "calls");
});

test("compat: the bare-template ambiguous case stays ambiguousParse (no gerund/that/qualifier marker)", () => {
  // this query has a boolean 'and' but no compositional MARKER (no 'that', no gerund
  // predicate, no leading qualifier), so it must remain the existing two-strategy
  // ambiguous parse rather than being seized as a boolean composition.
  const p = parseQuery("which classes extends Base and couples to logging");
  assert.equal(p.node, undefined);
  assert.equal(p.ambiguousParse, true);
});

test("compat: predicate-find (Workstream 2) must NOT hijack 'find the file that imports store' — it still parses via the existing (non-find) path, unaffected", () => {
  // parseFind declines outright: a relative-clause marker ("that") is present
  // anywhere in the tokens, and that production explicitly defers whenever one
  // is found. The §6 find-with-predicate generalization ALSO declines: the
  // entity noun "file" sits immediately after "find the" with no term words in
  // between (an EMPTY term), which is deliberately NOT the find-with-predicate
  // shape (an empty term already reaches the plain head-parsing path with no
  // find-seed needed). So this stays exactly what it was before Workstream 2 —
  // never a {node:"find"} or a find-seeded {node:"boolean"}.
  const p = parseQuery("find the file that imports store");
  assert.notEqual(p?.node, "find");
  if (p?.node === "boolean") assert.notEqual(p.atoms?.[0]?.ast?.node, "find");
});

// ---- 1. NESTED / RELATIVE clauses (multi-hop, two-stage traversal) ----

test("nested HIT: 'what imports something that imports core.mjs' = importers of core's importers (2-hop)", () => {
  const p = parseQuery("what imports something that imports core.mjs");
  assert.equal(p.node, "reverseSet");
  assert.equal(p.kind, "imports");
  assert.equal(p.inner.node, "clause"); // inner recurses to a set
  // inner: {mid, mid2} import core; outer: who imports {mid,mid2} = entry (imports mid)
  assert.deepEqual(labels(ask(graph, "what imports something that imports core.mjs")), ["entry.mjs"]);
});

test("nested depth ≥2: an inner relative clause itself composes", () => {
  // entry -> mid -> core: "what imports something that imports something that imports core"
  // resolves the inner-inner (importers of core = mid,mid2), then importers of THOSE
  // (entry), then importers of that (none) — depth-2 nesting, an honest empty, not a crash.
  const r = ask(graph, "what imports something that imports something that imports core.mjs");
  assert.equal(r.tmct_ask.miss, true);
});

test("nested MISS: an inner clause that cannot parse is an honest stated miss, not a guess", () => {
  const r = ask(graph, "what calls something that frobnicates the wibble");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /couldn't compile this compositional question/);
});

// ---- 2. BOOLEAN combination over the SAME subject ----

test("boolean intersection HIT: 'functions that call alpha and call beta'", () => {
  const p = parseQuery("functions that call alpha and call beta");
  assert.equal(p.node, "boolean");
  assert.equal(p.atoms.length, 2);
  assert.deepEqual(labels(ask(graph, "functions that call alpha and call beta")), ["callsBoth"]);
});

test("boolean union HIT: 'modules importing core.mjs or targets.mjs' (verb distributed across branches)", () => {
  assert.deepEqual(labels(ask(graph, "modules importing core.mjs or targets.mjs")),
    ["caller.mjs", "mid.mjs", "mid2.mjs"]);
});

test("boolean difference HIT: 'classes inheriting from Base but not tested'", () => {
  // Widget's module is tested (test/widget.test.mjs), Gadget's is not.
  assert.deepEqual(labels(ask(graph, "classes inheriting from Base but not tested")), ["Gadget"]);
  assert.deepEqual(labels(ask(graph, "classes inheriting from Base and tested")), ["Widget"]);
});

test("boolean MISS: an uncompilable branch makes the whole combination an honest miss", () => {
  const r = ask(graph, "functions that call something that blargh and call beta");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /couldn't compile this compositional question/);
});

// ---- 3. QUALIFIERS / adjectives on the subject noun ----

test("qualifier HIT: visibility, static, exported, tested — each a real attribute/edge filter", () => {
  assert.deepEqual(labels(ask(graph, "private methods")), ["privMethod"]);
  assert.deepEqual(labels(ask(graph, "static methods")), ["statMethod"]);
  assert.deepEqual(labels(ask(graph, "exported methods")), ["pubMethod"]);
  assert.deepEqual(labels(ask(graph, "tested classes")), ["Widget"]);
});

test("qualifier + membership HIT: 'public methods in widget.mjs' (of/in <term>)", () => {
  // pubMethod (no visibility → public) and statMethod (public + static); privMethod excluded.
  assert.deepEqual(labels(ask(graph, "public methods in widget.mjs")), ["pubMethod", "statMethod"]);
});

test("qualifier abstract is honestly EMPTY (isAbstract is never populated) — not an error", () => {
  const r = ask(graph, "abstract classes");
  assert.equal(r.tmct_ask.miss, true); // empty set, honest blank
  assert.equal(r.tmct_ask.matches.length, 0);
});

test("qualifier MISS: an unrecognized qualifier word is tried as a predicate-find term first, honest zero-hit miss if nothing matches", () => {
  // "shiny" is neither a real QUALIFIER nor a real Method label/attribute in the
  // fixture — rather than the old hard "unknown qualifier" rejection, it's now tried
  // as a fuzzy find term (a real answer beats an error when one exists) and honestly
  // reports the zero-hit search, never a confident-wrong guess either way.
  const r = ask(graph, "which shiny methods");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /no methods found matching "shiny"/);
});

test("qualifier-slot-to-find HIT: 'list payment modules'-shaped queries now answer instead of erroring", () => {
  // Found live: "list payment modules" used to hard-fail with "unknown qualifier
  // 'payment'" even though "find me the payment class" already worked — the same
  // unrecognized-qualifier-slot word is now tried as a predicate-find term, so this
  // phrasing and the equivalent "find" phrasing land the same real answer.
  const r = ask(graph, "which pub methods");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["pubMethod"]);
});

// ---- 4. AGGREGATES + SUPERLATIVES ----

test("aggregate HIT: 'how many classes' counts the class of individuals; a restrictor counts a clause", () => {
  const p = parseQuery("how many classes");
  assert.equal(p.node, "count");
  assert.match(ask(graph, "how many classes").content, /^3 classes\.$/);
  assert.match(ask(graph, "how many functions call alpha").content, /^2 functions\.$/); // callsBoth, callsOne
});

test("aggregate MISS: 'how many bananas' names no known entity kind — honest miss", () => {
  const r = ask(graph, "how many bananas");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /count needs a known entity kind/);
});

test("superlative HIT: 'which module has the most imports' ranks by out-degree", () => {
  const p = parseQuery("which module has the most imports");
  assert.equal(p.node, "superlative");
  assert.equal(p.extreme, "most");
  // caller.mjs imports targets AND core (2); every other module imports one (or zero).
  assert.match(ask(graph, "which module has the most imports").content, /^caller\.mjs — the most imports \(2\)\./);
});

test("superlative HIT: 'the most connected module' ranks by total degree", () => {
  const r = ask(graph, "the most connected module");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /the most connected \(\d+\)/);
});

test("superlative MISS: an unrecognized rank-by noun is an honest miss naming the supported ones", () => {
  const r = ask(graph, "which module has the most bananas");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /imports, callers, methods, tests, or connections/);
});

// ---- FIX 2 (cycle W2P): widened AGGREGATE + SUPERLATIVE synonym net — more phrasings for
// the SAME cardinality-COUNT / ARGMAX-by-degree intents now hit the existing infra. ----

test("aggregate synonyms: 'sum of'/'tally of'/'total of'/'amount of' <kind> all count the class", () => {
  // BEFORE (cycle W2P): these '<measure> of <kind>' forms missed the grammar entirely
  // ("couldn't parse this as a graph question") — only "how many"/"count"/"number of" hit.
  assert.match(ask(graph, "sum of classes").content, /^3 classes\.$/);
  assert.match(ask(graph, "tally of classes").content, /^3 classes\.$/);
  assert.match(ask(graph, "total of functions").content, /^5 functions\.$/);
  assert.match(ask(graph, "amount of classes").content, /^3 classes\.$/);
  for (const q of ["sum of classes", "tally of classes", "total of functions", "amount of classes"]) {
    assert.equal(ask(graph, q).tmct_ask.miss, false, `${q} is no longer an honest-miss`);
  }
});

test("superlative degree-nouns: 'most imported'/'most depended-on'/'most used' rank by in-degree", () => {
  // BEFORE (cycle W2P): "which module is most imported" compiled to an honest miss ("name
  // what to rank by") because only the noun "imports"/"importers" was a rank-by metric, not
  // the participle. core.mjs is imported by mid, mid2 and caller → the argmax at in-degree 3.
  assert.match(ask(graph, "which module is most imported").content, /^core\.mjs — the most imported \(3\)\.$/);
  assert.match(ask(graph, "which module is most depended-on").content, /^core\.mjs — the most depended-on \(3\)\.$/);
  assert.match(ask(graph, "which module is most used").content, /^core\.mjs — the most used \(3\)\.$/);
  for (const q of ["which module is most imported", "which module is most depended-on", "which module is most used"]) {
    assert.equal(ask(graph, q).tmct_ask.miss, false, `${q} now ranks instead of missing`);
  }
});

// ---- 4b. LIST shape ("list <kind>" / "show the <kind>s") — sibling of the count node ----

test("list HIT: bare 'list classes' / 'show me the classes' enumerate the class of individuals", () => {
  const p = parseQuery("list classes");
  assert.equal(p.node, "list");
  assert.equal(p.entityType, "Class");
  assert.equal(p.scoped, false);
  // Base, Widget, Gadget — under the cap, so all three list, no "…and N more"
  assert.deepEqual(labels(ask(graph, "list classes")), ["Base", "Gadget", "Widget"]);
  assert.deepEqual(labels(ask(graph, "show me the classes")), ["Base", "Gadget", "Widget"]);
  assert.doesNotMatch(ask(graph, "list classes").content, /more/);
});

test("list HIT: many synonym triggers all reach the list ('display', 'dump', 'enumerate', 'what are the')", () => {
  for (const q of ["display the classes", "dump classes", "enumerate the classes", "what are the classes", "name the classes"]) {
    assert.deepEqual(labels(ask(graph, q)), ["Base", "Gadget", "Widget"], `trigger failed: "${q}"`);
  }
});

test("list HIT (scoped): 'list methods in widget.mjs' lists that module's members, no narrow hint", () => {
  const r = ask(graph, "list methods in widget.mjs");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["privMethod", "pubMethod", "statMethod"]);
  assert.doesNotMatch(r.content, /narrow with/); // already scoped
});

// ---- 4b-i. LIST shape, DIRECTORY scope ("list <kind> in <dir>") — Bug 6 regression:
// a bare directory term (no node of its own) used to fuzzy-match ONE arbitrary module
// whose label merely CONTAINED the directory substring, then traverse THAT module's
// own membership edges — which never yields other modules, producing a false-empty
// "no modules in this index." even though real modules live under the directory. The
// fixture's "test/widget.test.mjs" is the only module under a "test/" directory, so it
// exercises the fix without disturbing any other test's fixture/count assumptions.
test("list HIT (directory-scoped): 'list modules in test' lists the modules under that directory", () => {
  const r = ask(graph, "list modules in test");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["test/widget.test.mjs"]);
  assert.equal(r.tmct_ask.parsed.base.node, "membership");
  assert.equal(r.tmct_ask.parsed.scoped, true);
});

test("list HONEST-EMPTY (directory-scoped): 'list modules in nope' is a genuine dead-end, not a guess", () => {
  const r = ask(graph, "list modules in nope");
  // an empty list is rendered as an honest miss (same convention as every other empty
  // list, e.g. "list bananas") — the point under test is that it's an HONEST empty
  // (no modules exist under "nope"), not the false-empty the bug produced for a
  // directory that genuinely DOES have modules under it.
  assert.equal(r.tmct_ask.miss, true);
  assert.deepEqual(r.tmct_ask.matches, []);
  assert.match(r.content, /no modules in this index/);
});

test("list HIT (directory-scoped, non-Module entityType): 'list functions in a subdirectory' collects the entity kind across every module under it, not just the fuzzy-picked one", () => {
  // a dedicated fixture with TWO modules under the same directory, each defining a
  // function, so the directory scope must union across BOTH modules (a single-node
  // fuzzy match, the old behavior, could only ever reach one of them).
  const dirModules = [
    { path: "lib/alpha.mjs", dotted: "lib.alpha", imports: [], calls: [], defines: [{ name: "alphaFn", kind: "function", lineno: 1, decorators: [] }] },
    { path: "lib/beta.mjs", dotted: "lib.beta", imports: [], calls: [], defines: [{ name: "betaFn", kind: "function", lineno: 1, decorators: [] }] },
    { path: "outside.mjs", dotted: "outside", imports: [], calls: [], defines: [{ name: "outsideFn", kind: "function", lineno: 1, decorators: [] }] },
  ];
  const dirEntities = buildEntities(dirModules, [], {});
  ingestSchemaDocs(dirEntities);
  const dirGraph = parseEntities(dirEntities);
  const r = ask(dirGraph, "list functions in lib");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["alphaFn", "betaFn"]); // both modules under lib/, outside.mjs excluded
});

test("list compat: an EXACT single-file match still takes the single-container path, not directory scope", () => {
  // "widget.mjs" is an exact module node (tier 1) — this must stay the existing
  // single-container-node behavior even though the fix adds a directory-scope branch.
  const r = ask(graph, "list methods in widget.mjs");
  assert.deepEqual(labels(r), ["privMethod", "pubMethod", "statMethod"]);
});

test("list HIT (qualifier): 'list public methods' filters, still a list", () => {
  assert.deepEqual(labels(ask(graph, "list public methods")), ["pubMethod", "statMethod"]);
});

test("list OVERFLOW-CAP: a large unscoped list shows the first N + '…and M more' + a scope hint", () => {
  // a fixture with more functions than OVERFLOW_CAP (12) to exercise the cap + hint
  const many = [{
    path: "big.mjs", dotted: "big", imports: [], calls: [],
    defines: Array.from({ length: 20 }, (_, k) => ({ name: `fn${k}`, kind: "function", lineno: k + 1, decorators: [] })),
  }];
  const bigEntities = buildEntities(many, [], {});
  ingestSchemaDocs(bigEntities);
  const big = parseEntities(bigEntities);
  const r = ask(big, "list functions");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /…and 8 more/); // 20 − 12 shown
  assert.match(r.content, /narrow with "functions in <module>"/);
  assert.equal(r.tmct_ask.matches.length, 20); // the full set is still returned in the envelope
});

test("list MISS: 'list bananas' is an honest miss that NAMES the listable kinds, never a guess", () => {
  const r = ask(graph, "list bananas");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /isn't a listable kind/);
  assert.match(r.content, /functions, classes, methods, modules/);
});

test("list compat: bare 'which methods' still doesn't PARSE (not a list, not a reverse), but the cascade's bare-kind-noun terminal rule now lands a COUNT default", () => {
  // A bare interrogative "which methods" is deliberately NOT a compositional parse — it
  // is neither a list (only the "… are there" filler form lists) nor a reverse query.
  const p = parseQuery("which methods");
  assert.equal(p, null); // no direct parse at all
  // …but rather than dead-ending in an honest miss, the relaxation cascade's terminal
  // rule reads it as a bare kind noun wrapped in a question word and DEFAULTS to a count
  // (the operator's "vague enough to land" case). The count is the safe zero-arg answer.
  const r = ask(graph, "which methods");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /\bmethods?\.$/);
  assert.equal(r.tmct_ask.relaxed.to, "count methods");
  // The safety property the bare form protects is UNCHANGED: a dangling qualifier-slot
  // word ("which shiny methods") still blocks the count default rather than being
  // silently dropped — the terminal rule classifies the ORIGINAL tokens. It's now tried
  // as a predicate-find term first (see the "qualifier MISS" test above) and still
  // resolves to an honest miss, since no fixture Method matches "shiny".
  assert.equal(ask(graph, "which shiny methods").tmct_ask.miss, true);
  assert.match(ask(graph, "which shiny methods").content, /no methods found matching "shiny"/);
  assert.deepEqual(labels(ask(graph, "which classes are there")), ["Base", "Gadget", "Widget"]); // the filler form DOES list
});

// ---- 5. ANAPHORA over the PREVIOUS result set (ask()'s `prev`) ----

test("anaphora HIT: 'which of those are tested' / 'how many of those' filter+count the prior ids", () => {
  const first = ask(graph, "which classes inherit from Base"); // {Widget, Gadget}
  const prev = first.tmct_ask.matches.map((m) => m.id);
  assert.deepEqual(labels(ask(graph, "which of those are tested", { prev })), ["Widget"]);
  assert.match(ask(graph, "how many of those are tested", { prev }).content, /^1 class\.$/);
});

test("anaphora HIT: a clause filter over the prior set ('which of those call alpha')", () => {
  const first = ask(graph, "which functions call alpha"); // {callsBoth, callsOne}
  const prev = first.tmct_ask.matches.map((m) => m.id);
  assert.deepEqual(labels(ask(graph, "which of those call beta", { prev })), ["callsBoth"]);
});

test("anaphora MISS: with no prev supplied, 'those' has nothing to refer to — honest miss, never a guess", () => {
  const r = ask(graph, "which of those are tested");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /needs a previous answer/);
});

// ---- determinism: same query + same graph → same parse + answer ----

test("determinism: a compositional parse + answer is identical across repeated calls", () => {
  const a = ask(graph, "functions that call alpha and call beta");
  const b = ask(graph, "functions that call alpha and call beta");
  assert.deepEqual(a, b);
  assert.deepEqual(parseQuery("what imports something that imports core.mjs"),
    parseQuery("what imports something that imports core.mjs"));
});
