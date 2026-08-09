// tableau-transitive.test.mjs — owl:TransitiveProperty: the universal rule
// propagating a filler through a role's own transitive successors (both
// ∃-rule-generated and directly asserted), and equality blocking terminating
// a transitive cyclic existential.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableauKb, canonicalKey, isSatisfiable, proveEntailment } from "../../src/domain/tableau.mjs";

const atom = (name) => ({ t: "atom", name });
const someE = (r, c) => ({ t: "some", r, c });
const allE = (r, c) => ({ t: "all", r, c });
const andE = (cs) => ({ t: "and", cs });

const transitiveKb = (role) => buildTableauKb([{ id: "t0", subject: role, predicate: "rdf:type", object: "transitiveproperty" }]);
const findNode = (model, id) => model.nodes.find((n) => n.id === id);
const hasLabel = (node, expr) => node.labels.some((l) => canonicalKey(l.expr) === canonicalKey(expr));

test("a role with no transitive declaration keeps the universal on the immediate successor only", () => {
  const query = andE([someE("has", andE([atom("mid"), someE("has", atom("end"))])), allE("has", atom("safe"))]);
  const result = isSatisfiable(buildTableauKb([]), [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const grandchild = findNode(result.model, "x.1.1");
  assert.ok(grandchild, "the nested existential must still create a grandchild successor");
  assert.ok(!hasLabel(grandchild, atom("safe")), "a non-transitive role's universal must not reach past its immediate successor");
});

test("a transitive role's universal propagates its filler through a two-hop successor chain", () => {
  const query = andE([someE("has", andE([atom("mid"), someE("has", atom("end"))])), allE("has", atom("safe"))]);
  const result = isSatisfiable(transitiveKb("has"), [{ ind: "x", expr: query, from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  const child = findNode(result.model, "x.1");
  const grandchild = findNode(result.model, "x.1.1");
  assert.ok(hasLabel(child, atom("safe")), "the immediate has-successor must carry the universal's filler");
  assert.ok(grandchild, "the nested existential must still create a grandchild successor");
  assert.ok(hasLabel(grandchild, atom("safe")), "a transitive role's universal must reach the successor's own successor too");
});

test("a transitive role's propagated universal carries the same premises as the original", () => {
  const query = andE([someE("has", someE("has", atom("end"))), allE("has", atom("safe"))]);
  const result = isSatisfiable(transitiveKb("has"), [{ ind: "x", expr: query, from: ["p9"] }]);
  assert.equal(result.satisfiable, true);
  const grandchild = findNode(result.model, "x.1.1");
  const entry = grandchild.labels.find((l) => canonicalKey(l.expr) === canonicalKey(atom("safe")));
  assert.ok(entry.from.includes("p9"), "the propagated filler must still trace back to the universal's own premise");
});

test("termination: a transitive cyclic existential (A subclass-of exists r.A, r transitive) still blocks instead of growing forever", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-has-a" },
    { id: "f3", subject: "some-has-a", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "some-has-a", predicate: "owl:someValuesFrom", object: "a" },
    { id: "f5", subject: "has", predicate: "rdf:type", object: "transitiveproperty" },
  ]);
  const result = isSatisfiable(kb, []);
  assert.equal(result.satisfiable, true);
  assert.ok(result.model.nodes.length <= 4, `equality blocking must cap the model size, got ${result.model.nodes.length} nodes`);
  assert.ok(result.steps < 200, `equality blocking must terminate quickly, took ${result.steps} steps`);
});

test("termination: a transitive cyclic existential combined with a self-propagating universal still terminates", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-has-a" },
    { id: "f3", subject: "some-has-a", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "some-has-a", predicate: "owl:someValuesFrom", object: "a" },
    { id: "f5", subject: "has", predicate: "rdf:type", object: "transitiveproperty" },
  ]);
  const result = isSatisfiable(kb, [{ ind: "x", expr: allE("has", atom("safe")), from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  assert.ok(result.steps < 500, `a transitive universal reapplying itself down the blocked chain must still terminate, took ${result.steps} steps`);
});

test("a class-level universal proved through a stored subClassOf chain still honestly proves an entailment", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "rex", predicate: "rdf:type", object: "dog" },
    { id: "f2", subject: "dog", predicate: "rdfs:subClassOf", object: "mammal" },
    { id: "f3", subject: "has", predicate: "rdf:type", object: "transitiveproperty" },
  ]);
  const result = proveEntailment(kb, "rex", atom("mammal"));
  assert.equal(result.status, "proved");
  assert.deepEqual(result.premises, ["f1", "f2"]);
});

test("order-independence: a transitive role's propagation is byte-identical across two input orders", () => {
  const rowsA = [
    { id: "f1", subject: "x", predicate: "rdf:type", object: "a" },
    { id: "f2", subject: "a", predicate: "rdfs:subClassOf", object: "some-has-a" },
    { id: "f3", subject: "some-has-a", predicate: "owl:onProperty", object: "has" },
    { id: "f4", subject: "some-has-a", predicate: "owl:someValuesFrom", object: "a" },
    { id: "f5", subject: "has", predicate: "rdf:type", object: "transitiveproperty" },
  ];
  const rowsB = [...rowsA].reverse();
  const resultA = isSatisfiable(buildTableauKb(rowsA), []);
  const resultB = isSatisfiable(buildTableauKb(rowsB), []);
  assert.deepEqual(resultA, resultB);
});

// ---- ABox role assertions over a transitive role ---------------------------

test("a chain of two asserted edges over a declared-transitive role composes for the ∀-rule, and equality blocking still terminates", () => {
  const kb = buildTableauKb([
    { id: "t0", subject: "contains", predicate: "rdf:type", object: "transitiveproperty" },
    { id: "ta", subject: "a", predicate: "rdf:type", object: "module" },
    { id: "tb", subject: "b", predicate: "rdf:type", object: "module" },
    { id: "tc", subject: "c", predicate: "rdf:type", object: "module" },
    { id: "e1", subject: "a", predicate: "contains", object: "b" },
    { id: "e2", subject: "b", predicate: "contains", object: "c" },
  ]);
  const result = isSatisfiable(kb, [{ ind: "a", expr: allE("contains", atom("safe")), from: ["p1"] }]);
  assert.equal(result.satisfiable, true);
  assert.ok(hasLabel(findNode(result.model, "b"), atom("safe")), "the immediate asserted successor must carry the universal's filler");
  assert.ok(hasLabel(findNode(result.model, "c"), atom("safe")), "a transitive role's universal must reach an asserted successor's own asserted successor too");
  assert.ok(result.steps < 200, `propagating across two asserted edges must terminate quickly, took ${result.steps} steps`);
});

test("kb.transitiveRoles carries every declared transitive role, and only those", () => {
  const kb = buildTableauKb([
    { id: "f1", subject: "has", predicate: "rdf:type", object: "transitiveproperty" },
    { id: "f2", subject: "contains", predicate: "rdf:type", object: "transitiveproperty" },
    { id: "f3", subject: "owns", predicate: "rdfs:subClassOf", object: "possesses" },
  ]);
  assert.ok(kb.transitiveRoles.has("has"));
  assert.ok(kb.transitiveRoles.has("contains"));
  assert.ok(!kb.transitiveRoles.has("owns"));
});
