// The FIXTURE reference provider — a small, real, self-contained code graph that
// implements every Repository-Interface service.
//
// It is a degenerate provider in the sense that its graph is tiny and its source
// bodies are absent (snippet/context answer NO_SOURCE) — but every OTHER service
// returns real graph truth. The contract suite (test/adapters/repository-interface.test.mjs)
// runs the whole compatibility kit against it.
//
// The payload is embedded (not read from test/) so this ships as a runnable spec
// inside the library. Its shape is exactly a parseEntities() input.

import { parseEntities } from "../../domain/codegraph.mjs";
import { createGraphService } from "./graph-service.mjs";

/** A compact but type-complete entities payload: modules, a class hierarchy
 *  (Base ← Widget ← Button), a method with a full signature, an attribute, a
 *  module global, and a commit — wired by one edge of every closed kind. */
export const FIXTURE_ENTITIES = Object.freeze({
  generated_at: "2026-07-05T00:00:00.000Z",
  bootstrap: false,
  prefixes: { seon: "http://se-on.org/ontologies/seon.owl#", mgx: "urn:tmct:mgx#" },
  classes: [
    { name: "Module", count: 5, sample: ["pkg/core/graph.mjs"] },
    { name: "Class", count: 3, sample: ["Base", "Widget", "Button"] },
    { name: "Method", count: 1, sample: ["Widget.render"] },
    { name: "Attribute", count: 1, sample: ["Widget.name"] },
    { name: "Function", count: 1, sample: ["parseNode"] },
    { name: "Commit", count: 1, sample: ["a1b2c3d"] },
  ],
  vocabulary: [],
  objectProperties: [
    { predicate: "imports", prop: "mgx:importsNamespace", count: 3, examples: [
      { subject: "mod:view.mjs", object: "mod:graph.mjs", subjectLabel: "pkg/ui/view.mjs", objectLabel: "pkg/core/graph.mjs" },
      { subject: "mod:widget.mjs", object: "mod:graph.mjs", subjectLabel: "pkg/ui/widget.mjs", objectLabel: "pkg/core/graph.mjs" },
      { subject: "mod:button.mjs", object: "mod:widget.mjs", subjectLabel: "pkg/ui/button.mjs", objectLabel: "pkg/ui/widget.mjs" },
    ] },
    { predicate: "calls", prop: "mgx:callsCoarse", count: 1, examples: [
      { subject: "mod:script.mjs", object: "mod:graph.mjs", subjectLabel: "scripts/build.mjs", objectLabel: "pkg/core/graph.mjs" },
    ] },
    { predicate: "callsSymbol", prop: "mgx:callsSymbol", count: 1, examples: [
      { subject: "m:render", object: "fn:parseNode", subjectLabel: "Widget.render", objectLabel: "parseNode" },
    ] },
    { predicate: "defines", prop: "seon:declaresMethod", count: 3, examples: [
      { subject: "mod:graph.mjs", object: "fn:parseNode", subjectLabel: "pkg/core/graph.mjs", objectLabel: "parseNode" },
      { subject: "mod:widget.mjs", object: "cls:widget", subjectLabel: "pkg/ui/widget.mjs", objectLabel: "Widget" },
      { subject: "mod:widget.mjs", object: "g:register", subjectLabel: "pkg/ui/widget.mjs", objectLabel: "register" },
    ] },
    { predicate: "tests", prop: "mgx:testsCoverage", count: 1, examples: [
      { subject: "mod:widget.test.mjs", object: "mod:widget.mjs", subjectLabel: "pkg/test/widget.test.mjs", objectLabel: "pkg/ui/widget.mjs" },
    ] },
    { predicate: "touches", prop: "mgx:touchedByCommit", count: 1, examples: [
      { subject: "commit:a1b2c3d", object: "mod:widget.mjs", subjectLabel: "a1b2c3d", objectLabel: "pkg/ui/widget.mjs" },
    ] },
    { predicate: "touchesSymbol", prop: "mgx:touchesSymbol", count: 1, examples: [
      { subject: "commit:a1b2c3d", object: "m:render", subjectLabel: "a1b2c3d", objectLabel: "Widget.render" },
    ] },
    { predicate: "contains", prop: "seon:containsCodeEntity", count: 2, examples: [
      { subject: "cls:widget", object: "m:render", subjectLabel: "Widget", objectLabel: "render" },
      { subject: "cls:widget", object: "a:name", subjectLabel: "Widget", objectLabel: "name" },
    ] },
    { predicate: "inherits", prop: "seon:hasSuperType", count: 2, examples: [
      { subject: "cls:widget", object: "cls:base", subjectLabel: "Widget", objectLabel: "Base" },
      { subject: "cls:button", object: "cls:widget", subjectLabel: "Button", objectLabel: "Widget" },
    ] },
    { predicate: "cochange", prop: "mgx:changeCoupledWith", count: 1, examples: [
      { subject: "mod:widget.mjs", object: "mod:graph.mjs", subjectLabel: "pkg/ui/widget.mjs", objectLabel: "pkg/core/graph.mjs", weight: 3 },
    ] },
    { predicate: "reexports", prop: "mgx:reExports", count: 1, examples: [
      { subject: "mod:widget.mjs", object: "cls:widget", subjectLabel: "pkg/ui/widget.mjs", objectLabel: "Widget" },
    ] },
  ],
  individuals: [
    { id: "mod:graph.mjs", label: "pkg/core/graph.mjs", class: "Module", derived_from: ["git:a1b2c3d"], mentions: [] },
    { id: "mod:view.mjs", label: "pkg/ui/view.mjs", class: "Module", derived_from: [], mentions: [] },
    { id: "mod:widget.mjs", label: "pkg/ui/widget.mjs", class: "Module", derived_from: ["git:a1b2c3d"], mentions: [] },
    { id: "mod:button.mjs", label: "pkg/ui/button.mjs", class: "Module", derived_from: [], mentions: [] },
    { id: "mod:script.mjs", label: "scripts/build.mjs", class: "Module", derived_from: [], mentions: [] },
    { id: "mod:widget.test.mjs", label: "pkg/test/widget.test.mjs", class: "Module", derived_from: [], mentions: [] },
    { id: "fn:parseNode", label: "parseNode", class: "Function", derived_from: [], mentions: [], attributes: [
      { prop: "seon:startsAt", key: "site", value: "pkg/core/graph.mjs:10-24" },
      { prop: "seon:hasParameter", key: "params", value: "node, depth=0" },
      { prop: "seon:hasReturnType", key: "returns", value: "Node" },
    ] },
    { id: "cls:base", label: "Base", class: "Class", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "pkg/core/graph.mjs:1-6" }] },
    { id: "cls:widget", label: "Widget", class: "Class", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "pkg/ui/widget.mjs:1-40" }] },
    { id: "cls:button", label: "Button", class: "Class", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "pkg/ui/button.mjs:1-12" }] },
    { id: "m:render", label: "Widget.render", class: "Method", derived_from: [], mentions: [], attributes: [
      { prop: "seon:startsAt", key: "site", value: "pkg/ui/widget.mjs:8-20" },
      { prop: "mgx:decorator", key: "decorators", value: "property" },
      { prop: "seon:hasParameter", key: "params", value: "self, mode='full'" },
      { prop: "seon:hasReturnType", key: "returns", value: "str" },
      { prop: "seon:throwsException", key: "raises", value: "ValueError" },
      { prop: "seon:accessesField", key: "self_fields", value: "name, size" },
      { prop: "seon:hasDoc", key: "doc", value: "Render the widget." },
    ] },
    { id: "a:name", label: "Widget.name", class: "Attribute", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "pkg/ui/widget.mjs:2" }] },
    { id: "g:register", label: "register", class: "GlobalVariable", derived_from: [], mentions: [], attributes: [
      { prop: "seon:startsAt", key: "site", value: "pkg/ui/widget.mjs:1" },
      { prop: "mgx:value", key: "value", value: "Library()" },
    ] },
    { id: "commit:a1b2c3d", label: "a1b2c3d", class: "Commit", derived_from: [], mentions: [], attributes: [
      { prop: "mgx:commitAuthor", key: "author", value: "Grace Hopper" },
      { prop: "mgx:commitDate", key: "date", value: "2026-07-01" },
      { prop: "mgx:commitMessage", key: "message", value: "render the widget in full mode" },
    ] },
  ],
});

/** The parsed fixture graph (shared, immutable truth). */
export function fixtureGraph() {
  return parseEntities(FIXTURE_ENTITIES);
}

/** The fixture provider: a Repository-Interface service over the small real graph.
 *  `opts` passes straight through to createGraphService — e.g. `{ sourceAccess: true,
 *  repoRoot, readFile }` to construct a source-capable fixture provider for testing
 *  (see test/adapters/repository-interface.test.mjs's third runConformance call, which is the
 *  only thing that exercises the conformance kit's source-capable branch). */
export function fixtureProvider(opts = {}) {
  return createGraphService(fixtureGraph(), opts);
}
