// ask-find.test.mjs — predicate-based "find" queries (Workstream 2 — new product
// feature: "find [me] a/the <term> <entityType>", e.g. "find me the payment class").
// Mirrors ask-compositional.test.mjs's convention: buildEntities/parseEntities build
// a REAL graph from a small fixture, each capability gets a HIT + an honest-miss
// control, and every new shape is exercised end-to-end through ask() (not a mock).
//
// Fixture: a Class hierarchy (Gateway <- StripeGateway, PaypalGateway) for the
// narrow/broad inheritance cascade; a standalone PaymentProcessor class (multi-token
// AND); a same-stem Class "Foo" / Function "foo" pair (grain-collision); a Module
// with no inherits edges among Modules at all (the cascade's no-op case); a Widget
// class importing the Gateway module (the §6 generalization: find-with-predicate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { parseQuery, ask } from "../../src/domain/ask.mjs";

const MODULES = [
  { path: "src/gateway.mjs", dotted: "src.gateway", imports: [], calls: [],
    defines: [{ name: "Gateway", kind: "class", lineno: 1, decorators: [] }] },
  { path: "src/stripe.mjs", dotted: "src.stripe", imports: ["src.gateway"], calls: [],
    defines: [{ name: "StripeGateway", kind: "class", lineno: 1, decorators: [], bases: ["Gateway"] }] },
  { path: "src/paypal.mjs", dotted: "src.paypal", imports: ["src.gateway"], calls: [],
    defines: [{ name: "PaypalGateway", kind: "class", lineno: 1, decorators: [], bases: ["Gateway"] }] },
  { path: "src/payment.mjs", dotted: "src.payment", imports: [], calls: [],
    defines: [{ name: "PaymentProcessor", kind: "class", lineno: 1, decorators: [] }] },
  // grain-collision: a Class "Foo" and a Function "foo" (same stem, case-insensitive),
  // in different modules — "find the foo class"/"find the foo function" must each
  // resolve their OWN grain, never leak into the other's.
  { path: "src/foo.mjs", dotted: "src.foo", imports: [], calls: [],
    defines: [{ name: "Foo", kind: "class", lineno: 1, decorators: [] }] },
  { path: "src/foofn.mjs", dotted: "src.foofn", imports: [], calls: [],
    defines: [{ name: "foo", kind: "function", lineno: 1, decorators: [] }] },
  // a plain function-grain hit target.
  { path: "src/validate.mjs", dotted: "src.validate", imports: [], calls: [],
    defines: [{ name: "validate", kind: "function", lineno: 1, decorators: [] }] },
  // a module-grain hit target — Modules never carry inherits edges among
  // themselves, so this doubles as the "cascade is a no-op for this type" fixture.
  { path: "src/logger.mjs", dotted: "src.logger", imports: [], calls: [], defines: [] },
  // §6 generalization: a Widget class that imports the Gateway module.
  { path: "src/widget.mjs", dotted: "src.widget", imports: ["src.gateway"], calls: [],
    defines: [{ name: "Widget", kind: "class", lineno: 1, decorators: [] }] },
];

function buildGraph() {
  const entities = buildEntities(MODULES, [], {});
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}
const graph = buildGraph();
const labels = (r) => r.tmct_ask.matches.map((m) => m.label).sort();

// ---- parse-shape sanity (both closed orders) ----

test("parseFind: trailing-type and leading-type-with-linker both parse to the same find node", () => {
  assert.deepEqual(parseQuery("find me the payment class"), { node: "find", entityType: "Class", term: "payment" });
  assert.deepEqual(parseQuery("find the class named Gateway"), { node: "find", entityType: "Class", term: "Gateway" });
  assert.deepEqual(parseQuery("find the class called Gateway"), { node: "find", entityType: "Class", term: "Gateway" });
});

// ---- 1. basic hit, one case per grain ----

test("find HIT (Class grain): 'find me the payment class' resolves the standalone PaymentProcessor", () => {
  const r = ask(graph, "find me the payment class");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["PaymentProcessor"]);
});

test("find HIT (Module grain): 'find the logger module'", () => {
  const r = ask(graph, "find the logger module");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["src/logger.mjs"]);
});

test("find HIT (Function grain): 'find the validate function'", () => {
  const r = ask(graph, "find the validate function");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["validate"]);
});

// ---- 2. multi-token AND ----

test("find HIT: multi-token AND — 'find me the payment processor class' requires BOTH tokens on the same candidate", () => {
  const r = ask(graph, "find me the payment processor class");
  assert.equal(r.tmct_ask.miss, false);
  // PaymentProcessor is the only Class whose label contains "payment" AND "processor" —
  // the Gateway family's classes contain neither, so a single-token OR would have
  // wrongly pulled them in too.
  assert.deepEqual(labels(r), ["PaymentProcessor"]);
});

// ---- 3. grain-collision adversarial case (Class vs Function sharing a stem) ----

test("find HIT: grain-collision — 'find the foo class' and 'find the foo function' each resolve their OWN type, never the other's", () => {
  const cls = ask(graph, "find the foo class");
  const fn = ask(graph, "find the foo function");
  assert.equal(cls.tmct_ask.miss, false);
  assert.deepEqual(labels(cls), ["Foo"]);
  assert.equal(cls.tmct_ask.matches[0].type, "Class");
  assert.equal(fn.tmct_ask.miss, false);
  assert.deepEqual(labels(fn), ["foo"]);
  assert.equal(fn.tmct_ask.matches[0].type, "Function");
});

// ---- 4. descendant-hit: term only matches a subclass; narrow pass finds it (and,
// per the "self+descendants" design, the ancestor too, via the chain) WITHOUT
// broadening — never presented as "related, not exact". ----

test("find HIT: descendant-hit — 'find the stripe class' finds StripeGateway directly (narrow pass), with its ancestor Gateway riding along via the chain — never labeled 'related, not exact'", () => {
  const r = ask(graph, "find me the stripe class");
  assert.equal(r.tmct_ask.miss, false);
  const ls = labels(r);
  assert.ok(ls.includes("StripeGateway"), "the direct, most-specific match must be present");
  assert.ok(ls.includes("Gateway"), "its ancestor counts too — a subclass IS a kind of its superclass (documented cascade behavior)");
  assert.ok(!ls.includes("PaypalGateway"), "an unrelated sibling must never ride along");
  assert.doesNotMatch(r.content, /related|no exact/);
});

// ---- 5. broad-pass: narrow pass EMPTY across the whole pool -> a bounded-fuzzy
// near-match on an ancestor/sibling, always clearly labeled "related, not exact". ----

test("find MISS->broad: 'find the gatewy class' (typo) — no exact hit anywhere, but a fuzzy near-match on the ancestor Gateway is found and clearly labeled related, not exact", () => {
  const r = ask(graph, "find the gatewy class");
  assert.equal(r.tmct_ask.miss, false, "a related hit is not a miss");
  assert.match(r.content, /^no exact class named "gatewy", but found a related class: Gateway in src\/gateway\.mjs\.$/);
  assert.deepEqual(labels(r), ["Gateway"]);
});

test("find MISS->broad: a fuzzy near-match on a SIBLING (not just the direct ancestor) is also found", () => {
  const r = ask(graph, "find the paypalgatewy class");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /related class: PaypalGateway in src\/paypal\.mjs\./);
});

// ---- 6. no-op cascade: Module never carries inherits edges among Modules, so the
// broad pass never even attempts to fire for this type — a Module miss is the
// plain flat zero-hit honest miss, exactly like a type with no hierarchy at all. ----

test("find MISS (no-op cascade): a Module search that misses stays a PLAIN zero-hit miss — the broad pass is a no-op for a type with no inherits edges", () => {
  const r = ask(graph, "find the zzz module");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /no modules found matching "zzz"\./);
  assert.doesNotMatch(r.content, /related|exact/);
});

// ---- 7. zero-hit honest miss (both narrow and broad passes exhausted, even
// though the type DOES participate in inherits) ----

test("find MISS: zero-hit honest miss — both the narrow and broad passes are genuinely exhausted", () => {
  const r = ask(graph, "find the xyzzy class");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /no classes found matching "xyzzy"\./);
});

// ---- 8. type-not-recognized honest miss — a PARSE-TIME miss, structurally
// distinct from evalSet("find")'s zero-hit SEARCH miss above (a different content
// template entirely, via the generic compositeMiss path every other compositional
// production already uses). ----

test("find MISS: type-not-recognized is a parse-time miss, not the zero-hit search miss", () => {
  const r = ask(graph, "find bananas");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /"bananas" isn't a listable kind/);
  // structurally distinct wording from the zero-hit search miss template above.
  assert.doesNotMatch(r.content, /found matching/);
});

// ---- 9. §6 generalization: "find <term> <entityType> that|which|who <predicate>"
// seeds the boolean fold with a find atom instead of allOfClass. ----

test("find + predicate (§6 generalization): 'find the widget class that imports src/gateway.mjs' seeds the boolean fold with a find atom", () => {
  const p = parseQuery("find the widget class that imports src/gateway.mjs");
  assert.equal(p.node, "boolean");
  assert.equal(p.atoms[0].ast.node, "find");
  assert.equal(p.atoms[0].ast.term, "widget");
  const r = ask(graph, "find the widget class that imports src/gateway.mjs");
  assert.equal(r.tmct_ask.miss, false);
  assert.deepEqual(labels(r), ["Widget"]);
});

test("find + predicate (§6 generalization): the seed still applies even when the predicate alone would match MORE than the find term (proves real intersection, not just the predicate winning)", () => {
  // every class that imports src/gateway.mjs is {StripeGateway, PaypalGateway, Widget} —
  // strictly more than the find-seed {Widget} alone, so a non-empty, Widget-only
  // result proves the fold is a genuine intersection, not a fallthrough to the predicate.
  const r = ask(graph, "which classes import src/gateway.mjs");
  assert.deepEqual(labels(r).sort(), ["PaypalGateway", "StripeGateway", "Widget"].sort());
  const findAndR = ask(graph, "find the widget class that imports src/gateway.mjs");
  assert.deepEqual(labels(findAndR), ["Widget"]);
});
