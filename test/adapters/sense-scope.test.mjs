// The same-sense discipline a read-time walk applies, over a taxonomy shaped
// like the corpus rows that motivated it: russia climbs to `place` through
// `country`, passage climbs to `artifact` through `structure`, and the
// entailment closure has already written the "russia is a kind of passage"
// shortcut that joins the two.
import test from "node:test";
import assert from "node:assert/strict";

import { buildSenseScope } from "../../src/domain/sense-scope.mjs";

const row = (id, subject, predicate, object, provenance = "corpus:conceptnet") => ({
  id, subject, predicate, object, provenance,
});

const geographyAndAnatomyRows = () => [
  row("f:russia-country", "russia", "rdfs:subClassOf", "country"),
  row("f:country-place", "country", "rdfs:subClassOf", "place"),
  row("f:israel", "israel", "rdfs:subClassOf", "country"),
  row("f:turkey", "turkey", "rdfs:subClassOf", "country"),
  row("f:australia", "australia", "rdfs:subClassOf", "country"),
  row("f:passage-structure", "passage", "rdfs:subClassOf", "structure"),
  row("f:structure-artifact", "structure", "rdfs:subClassOf", "artifact"),
  row("f:orifice", "orifice", "rdfs:subClassOf", "passage"),
  row("f:duct", "duct", "rdfs:subClassOf", "passage"),
  row("f:battery-message", "battery", "rdfs:subClassOf", "message"),
  row("f:russia-passage", "russia", "rdfs:subClassOf", "passage", "entailed:subClassOf"),
];

test("a term keeps the neighbourhood of its own top class and loses the one on the far side of a shared class node", () => {
  const scope = buildSenseScope(geographyAndAnatomyRows());
  assert.deepEqual(scope.topsOf("russia"), ["place"]);
  assert.deepEqual(scope.topsOf("passage"), ["artifact"]);

  const inRussiasSense = scope.sameSenseAs("russia");
  for (const kept of ["country", "israel", "turkey", "australia"]) {
    assert.equal(inRussiasSense(kept), true, `${kept} shares russia's sense`);
  }
  for (const dropped of ["passage", "orifice", "duct", "battery"]) {
    assert.equal(inRussiasSense(dropped), false, `${dropped} does not share russia's sense`);
  }
});

test("the closure's own shortcut never places a term: an entailed isa row is not evidence for the gate that constrains it", () => {
  const withShortcut = buildSenseScope(geographyAndAnatomyRows());
  const withoutShortcut = buildSenseScope(geographyAndAnatomyRows().filter((r) => r.id !== "f:russia-passage"));
  assert.deepEqual(withShortcut.topsOf("russia"), withoutShortcut.topsOf("russia"));
  assert.equal(withShortcut.sameSenseAs("russia")("passage"), false);
});

test("a term the bands never classify is admitted, and an anchor they never classify admits everything", () => {
  const scope = buildSenseScope(geographyAndAnatomyRows());
  assert.deepEqual(scope.topsOf("robert gilman"), []);
  assert.equal(scope.sameSenseAs("russia")("robert gilman"), true);

  const inAnUnplacedSense = scope.sameSenseAs("robert gilman");
  for (const term of ["country", "passage", "orifice", "battery"]) {
    assert.equal(inAnUnplacedSense(term), true, `an unplaced anchor keeps ${term}`);
  }
});

test("several anchors pool their tops, and each anchor stays in its own scope", () => {
  const scope = buildSenseScope(geographyAndAnatomyRows());
  const inBothSenses = scope.sameSenseAs(["russia", "duct"]);
  assert.equal(inBothSenses("country"), true);
  assert.equal(inBothSenses("orifice"), true);
  assert.equal(inBothSenses("battery"), false);
  assert.equal(scope.sameSenseAs("russia")("russia"), true);
});

test("the same facts in two orders admit the same terms", () => {
  const forward = buildSenseScope(geographyAndAnatomyRows()).sameSenseAs("russia");
  const backward = buildSenseScope(geographyAndAnatomyRows().reverse()).sameSenseAs("russia");
  const terms = ["country", "israel", "turkey", "australia", "passage", "orifice", "duct", "battery", "robert gilman"];
  assert.deepEqual(terms.map(forward), terms.map(backward));
});
