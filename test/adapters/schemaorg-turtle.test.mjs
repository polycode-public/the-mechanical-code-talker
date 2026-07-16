import test from "node:test";
import assert from "node:assert/strict";
import { parseSchemaClasses } from "../../src/domain/schemaorg/turtle.mjs";

// Literal fixtures throughout: the reader is pure, so none of this needs the
// schema.org clone the script that calls it reads from.

const PERSON = [
  ':Person a rdfs:Class ;',
  '    rdfs:label "Person" ;',
  '    rdfs:comment "A person (alive, dead, undead, or fictional)." ;',
  '    rdfs:subClassOf :Thing .',
  '',
].join("\n");

test("parseSchemaClasses: one class block yields name, label, comment and subClassOf", () => {
  const classes = parseSchemaClasses(PERSON);
  assert.deepEqual(classes.get("Person"), {
    name: "Person",
    label: "Person",
    comment: "A person (alive, dead, undead, or fictional).",
    subClassOf: ["Thing"],
  });
});

test("parseSchemaClasses: returns a Map keyed by class name", () => {
  const classes = parseSchemaClasses(PERSON);
  assert.ok(classes instanceof Map);
  assert.deepEqual([...classes.keys()], ["Person"]);
});

test("parseSchemaClasses: splits several class blocks on a line-initial ':Name'", () => {
  const text = [
    ':Thing a rdfs:Class ;',
    '    rdfs:label "Thing" ;',
    '    rdfs:comment "The most generic type of item." .',
    ':Place a rdfs:Class ;',
    '    rdfs:label "Place" ;',
    '    rdfs:subClassOf :Thing .',
    '',
  ].join("\n");
  const classes = parseSchemaClasses(text);
  assert.deepEqual([...classes.keys()], ["Thing", "Place"]);
  assert.equal(classes.get("Thing").subClassOf.length, 0);
  assert.deepEqual(classes.get("Place").subClassOf, ["Thing"]);
});

test("parseSchemaClasses: a class with several rdfs:subClassOf lines keeps all of them, in order", () => {
  const text = [
    ':LocalBusiness a rdfs:Class ;',
    '    rdfs:label "LocalBusiness" ;',
    '    rdfs:subClassOf :Organization ;',
    '    rdfs:subClassOf :Place .',
    '',
  ].join("\n");
  assert.deepEqual(parseSchemaClasses(text).get("LocalBusiness").subClassOf, ["Organization", "Place"]);
});

test("parseSchemaClasses: a non-class block (an rdf:Property) is skipped", () => {
  const text = [
    ':author a rdf:Property ;',
    '    rdfs:label "author" ;',
    '    schema:domainIncludes :CreativeWork .',
    ':Thing a rdfs:Class ;',
    '    rdfs:label "Thing" .',
    '',
  ].join("\n");
  assert.deepEqual([...parseSchemaClasses(text).keys()], ["Thing"]);
});

test("parseSchemaClasses: a class with no rdfs:label falls back to its own name, and no comment to ''", () => {
  const classes = parseSchemaClasses(':Widget a rdfs:Class ;\n    rdfs:subClassOf :Thing .\n');
  assert.equal(classes.get("Widget").label, "Widget");
  assert.equal(classes.get("Widget").comment, "");
});

test("parseSchemaClasses: text with no class at all yields an empty Map", () => {
  assert.equal(parseSchemaClasses("@prefix schema: <https://schema.org/> .\n").size, 0);
});
