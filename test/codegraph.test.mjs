// Pure-logic tests over the fixture entities payload — no fs/network beyond
// reading the fixture. Ported from marginalia seon-mcp (vitest) to node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEntities,
  resolveSymbol,
  relationKind,
  adjacencyForKinds,
  spiralExpand,
  MEMORY_SPIRAL_EXPAND_KINDS,
  derivedUpdatedAt,
  mostRecentIndividual,
  impactClosure,
  renderDescribe,
  renderCompare,
  renderImpact,
  renderSearch,
  searchModulesRanked,
  selectRankedModules,
  DEFAULT_SCORE_GAP,
  renderMembers,
  renderSubclasses,
  renderArchitecture,
  renderTestsFor,
  renderUntested,
  renderHistory,
  renderCallers,
  renderCallees,
  renderCochanges,
  renderExports,
  renderSignature,
  contextPlan,
  sizeBundle,
  bundleMask,
  trimBundleMask,
  rankModulesByProximity,
  renderCalls,
  callHint,
  renderToolsCatalog,
  renderContextMore,
  renderFileHistory,
  renderMethodHistory,
  buildVizNodesAndEdges,
  deriveFactTermGraph,
  MEMORY_FACT_LINK_KINDS,
  pickLegendDimension,
  legendValueFor,
} from "../src/codegraph.mjs";
import { buildEntities } from "../src/graph-build.mjs";
import { proseLayerHits } from "../src/prose.mjs";
import { appendUtterance, appendFact, loadMemory, CREATED_AT_PROP, UPDATED_AT_PROP } from "../src/memory/core.mjs";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url)), "utf8"),
);
const graph = parseEntities(fixture);

test("parseEntities indexes individuals by id and keeps relation groups", () => {
  assert.equal(graph.individuals.length, 16);
  assert.equal(graph.byId.get("mod-a").label, "app/lib/a.mjs");
  assert.deepEqual(graph.relations.map((g) => g.predicate), ["imports", "calls", "callsSymbol", "tests", "defines", "touches", "touchesSymbol", "contains", "inherits", "cochange", "reexports"]);
  assert.equal(graph.generatedAt, "2026-06-28T00:00:00.000Z");
  assert.deepEqual(graph.truncated, []); // local graph: counts match examples
});

test("parseEntities tolerates missing/odd payload pieces", () => {
  const empty = parseEntities({});
  assert.deepEqual(empty.individuals, []);
  assert.deepEqual(empty.relations, []);
  const ragged = parseEntities({
    individuals: [{ id: "x", label: "x" }, null],
    objectProperties: [{ predicate: "imports", examples: [{ subject: "x" }, null] }, {}],
  });
  assert.equal(ragged.individuals.length, 2);
  assert.equal(ragged.byId.size, 1);
  assert.equal(ragged.relations.length, 1);
  assert.deepEqual(ragged.relations[0].edges, []);
});

test("parseEntities detects server-side truncation (count > examples)", () => {
  const clipped = JSON.parse(JSON.stringify(fixture));
  clipped.objectProperties[0].count = 40; // imports: 40 claimed, 7 shown
  assert.deepEqual(parseEntities(clipped).truncated, [{ predicate: "imports", count: 40, shown: 7 }]);
});

test("relationKind matches the SEON/mgx prop token first, then the verb", () => {
  assert.equal(relationKind({ prop: "mgx:importsNamespace", predicate: "uses" }), "imports");
  assert.equal(relationKind({ prop: "mgx:callsCoarse" }), "calls");
  assert.equal(relationKind({ prop: "seon:declaresMethod" }), "defines");
  assert.equal(relationKind({ prop: "mgx:testsCoverage" }), "tests");
  assert.equal(relationKind({ prop: "mgx:touchedByCommit" }), "touches");
  assert.equal(relationKind({ prop: "seon:containsCodeEntity" }), "contains");
  assert.equal(relationKind({ prop: "seon:hasSuperType" }), "inherits");
  assert.equal(relationKind({ prop: "mg:imports", predicate: "uses" }), "imports"); // legacy fallback
  assert.equal(relationKind({ predicate: "imports from" }), "imports");
  assert.equal(relationKind({ predicate: "invokes" }), "calls");
  assert.equal(relationKind({ predicate: "covers" }), "tests");
  assert.equal(relationKind({ predicate: "contains entity" }), "contains");
  assert.equal(relationKind({ predicate: "subclass of" }), "inherits");
  assert.equal(relationKind({ predicate: "works at" }), null);
});

test("relationKind classifies the memory graph's real predicates (saidInSession/inReplyTo/statedBy/canonicalisedFrom) to themselves", () => {
  assert.equal(relationKind({ prop: "mgx:saidInSession" }), "saidInSession");
  assert.equal(relationKind({ prop: "mgx:inReplyTo" }), "inReplyTo");
  assert.equal(relationKind({ prop: "mgx:statedBy" }), "statedBy");
  assert.equal(relationKind({ prop: "mgx:canonicalisedFrom" }), "canonicalisedFrom");
});

test("resolveSymbol ranking: exact / path / basename / substring", () => {
  assert.equal(resolveSymbol(graph, "app/lib/a.mjs").match.id, "mod-a");
  assert.equal(resolveSymbol(graph, "mod-c").match.id, "mod-c");
  assert.equal(resolveSymbol(graph, "./App/Lib/A.mjs").match.id, "mod-a");
  assert.equal(resolveSymbol(graph, "handler.mjs").match.id, "mod-d");
  assert.equal(resolveSymbol(graph, "fnAlpha").match.id, "fn-alpha");
  assert.equal(resolveSymbol(graph, "abc1234").match.id, "commit-abc");
  assert.equal(resolveSymbol(graph, "a.mjs").match.id, "mod-a");
});

test("resolveSymbol: misses invent nothing; ties break on attestation", () => {
  const miss = resolveSymbol(graph, "does-not-exist-anywhere");
  assert.equal(miss.match, null);
  assert.deepEqual(miss.candidates, []);
  const r = resolveSymbol(graph, "mjs"); // substring of every module label
  assert.equal(r.match.id, "mod-a"); // 2 commit refs → best-attested
  assert.equal(r.candidates[0].id, "mod-b"); // 1 commit ref → next
});

test("impactClosure: reverse closure, diamond collapsed, cycle terminated", () => {
  const levels = impactClosure(graph, graph.byId.get("mod-a"));
  assert.deepEqual(levels[0].map((d) => d.id).sort(), ["mod-b", "mod-c", "mod-e", "mod-g"]);
  assert.deepEqual(levels[1].map((d) => d.id).sort(), ["mod-d", "mod-f"]);
  assert.equal(levels.length, 2);
});

test("impactClosure attaches covering test modules; leaves/objects have none", () => {
  const levels = impactClosure(graph, graph.byId.get("mod-a"));
  const byId = new Map(levels.flat().map((d) => [d.id, d]));
  assert.deepEqual(byId.get("mod-b").tests, ["app/unit-tests/b.test.mjs"]);
  assert.deepEqual(byId.get("mod-c").tests, []);
  assert.deepEqual(byId.get("mod-d").tests, ["app/unit-tests/b.test.mjs"]);
  assert.deepEqual(impactClosure(graph, graph.byId.get("mod-g")), []);
  assert.deepEqual(impactClosure(graph, graph.byId.get("fn-alpha")), []);
});

// ── impactClosure folds in callsSymbol, coarsened to module level on read (2026-07-02) ──
// Module-coarse "calls" (mgx:callsCoarse, graph-build.mjs) only fires when the callee's module
// is ALREADY in the caller's import list ("coarse, import-backed calls" — see graph-build.mjs's
// own comment above its callEdges loop), so by construction every "calls" edge duplicates an
// "imports" edge between the same pair — it can never independently extend this closure's
// reach. The main fixture's own single callsSymbol edge (m-render → fn-alpha, i.e.
// mod-b → mod-a) happens to sit on a pair that ALSO already has an imports edge, so it can't
// demonstrate genuinely new coverage either — hence this separate, minimal fixture: two
// modules connected ONLY by a callsSymbol edge, no imports/calls edge between them at all.
const callsSymbolOnlyPayload = {
  individuals: [
    { id: "mod:app/a.mjs", class: "Module", label: "app/a.mjs" },
    { id: "mod:app/b.mjs", class: "Module", label: "app/b.mjs" },
    { id: "fn:app/a.mjs#helperA", class: "Function", label: "helperA" },
    { id: "fn:app/b.mjs#callerB", class: "Function", label: "callerB" },
  ],
  objectProperties: [
    // B calls A — no imports/calls edge exists between mod:app/a.mjs and mod:app/b.mjs.
    { predicate: "callsSymbol", prop: "mgx:callsSymbol", examples: [
      { subject: "fn:app/b.mjs#callerB", object: "fn:app/a.mjs#helperA", subjectLabel: "callerB", objectLabel: "helperA" },
    ] },
  ],
};
const callsSymbolOnlyGraph = parseEntities(callsSymbolOnlyPayload);

test("impactClosure: callsSymbol alone (no imports/calls edge) still surfaces the caller's module as a dependent", () => {
  const levels = impactClosure(callsSymbolOnlyGraph, callsSymbolOnlyGraph.byId.get("mod:app/a.mjs"));
  assert.equal(levels.length, 1);
  assert.deepEqual(levels[0].map((d) => d.id), ["mod:app/b.mjs"]);
  assert.equal(levels[0][0].label, "app/b.mjs");
  assert.equal(levels[0][0].via, "callsSymbol");
});

test("renderImpact: a callsSymbol-only dependent renders with an honest (callsSymbol it) receipt", () => {
  const text = renderImpact(callsSymbolOnlyGraph, callsSymbolOnlyGraph.byId.get("mod:app/a.mjs"));
  assert.match(text, /app\/b\.mjs \(callsSymbol it\) — tests: none recorded/);
  assert.match(text, /total: 1 dependent\(s\)/);
});

test("impactClosure: two symbols calling each other in the SAME module never produce a self-referencing dependent", () => {
  const selfLoopPayload = {
    individuals: [
      { id: "mod:app/c.mjs", class: "Module", label: "app/c.mjs" },
      { id: "fn:app/c.mjs#one", class: "Function", label: "one" },
      { id: "fn:app/c.mjs#two", class: "Function", label: "two" },
    ],
    objectProperties: [
      { predicate: "callsSymbol", prop: "mgx:callsSymbol", examples: [
        { subject: "fn:app/c.mjs#two", object: "fn:app/c.mjs#one", subjectLabel: "two", objectLabel: "one" },
      ] },
    ],
  };
  const g = parseEntities(selfLoopPayload);
  assert.deepEqual(impactClosure(g, g.byId.get("mod:app/c.mjs")), []);
});

test("renderDescribe: edges both directions, commit attestation + provenance", () => {
  const text = renderDescribe(graph, graph.byId.get("mod-a"));
  assert.match(text, /app\/lib\/a\.mjs — Module \(id: mod-a\)/);
  assert.match(text, /attestation: touched by 2 commit\(s\)/);
  assert.match(text, /attribute: dotted = app\.lib\.a/);
  assert.match(text, /defines \[seon:declaresMethod\] \(1\) → fnAlpha/);
  assert.match(text, /← imports \[mgx:importsNamespace\] \(3\) by app\/lib\/b\.mjs, app\/lib\/c\.mjs, app\/lib\/e\.mjs/);
  assert.match(text, /← calls \[mgx:callsCoarse\] \(1\) by scripts\/g\.mjs/);
  assert.match(text, /← touches \[mgx:touchedByCommit\] \(1\) by abc1234/);
  assert.match(text, /provenance: git:abc1234, git:def5678/);
});

test("renderCompare: two same-kind Classes — shared + differing edges, attribute diff", () => {
  const text = renderCompare(graph, graph.byId.get("cls-widget"), graph.byId.get("cls-button"));
  assert.match(text, /^Comparing Widget and Button \(both Class\):/);
  // shared relation (both inherit — but from DIFFERENT supertypes, a real difference)
  assert.match(text, /inherits \[seon:hasSuperType\]: Widget \(1\) -> Base; Button \(1\) -> Widget/);
  // Widget-only edge (contains render/name); Button has none
  assert.match(text, /contains \[seon:containsCodeEntity\]: Widget \(2\) -> render, name; Button \(0\) -> none/);
  // attribute mismatch (different source sites)
  assert.match(text, /attribute site: Widget = app\/lib\/b\.mjs:1-30; Button = app\/lib\/c\.mjs:1-10/);
});

test("renderCompare: two same-kind Modules — imports/tests/cochange asymmetry", () => {
  const text = renderCompare(graph, graph.byId.get("mod-a"), graph.byId.get("mod-b"));
  assert.match(text, /^Comparing app\/lib\/a\.mjs and app\/lib\/b\.mjs \(both Module\):/);
  assert.match(text, /<- tests \[mgx:testsCoverage\]: app\/lib\/a\.mjs \(0\) -> none; app\/lib\/b\.mjs \(1\) -> app\/unit-tests\/b\.test\.mjs/);
  assert.match(text, /cochange \[mgx:changeCoupledWith\]: app\/lib\/a\.mjs \(2\) -> app\/lib\/b\.mjs, app\/lib\/c\.mjs; app\/lib\/b\.mjs \(0\) -> none/);
});

test("renderCompare: refuses mismatched kinds and the same individual, honestly (null)", () => {
  assert.equal(renderCompare(graph, graph.byId.get("cls-widget"), graph.byId.get("mod-a")), null);
  assert.equal(renderCompare(graph, graph.byId.get("cls-widget"), graph.byId.get("cls-widget")), null);
});

test("renderImpact: depth groups, totals, no false truncation warning", () => {
  const text = renderImpact(graph, graph.byId.get("mod-a"));
  assert.match(text, /depth 1 \(4 direct dependents\):/);
  assert.match(text, /depth 2 \(2\):/);
  assert.match(text, /app\/lib\/b\.mjs \(imports it\) — tests: app\/unit-tests\/b\.test\.mjs/);
  assert.match(text, /scripts\/g\.mjs \(calls it\) — tests: none recorded/);
  assert.match(text, /total: 6 dependent\(s\) across 2 depth level\(s\)/);
  assert.doesNotMatch(text, /closure may be missing edges/);
  assert.match(renderImpact(graph, graph.byId.get("mod-g")), /no dependents found/);
});

test("renderImpact warns when a structural relation is truncated", () => {
  const clipped = JSON.parse(JSON.stringify(fixture));
  clipped.objectProperties[0].count = 40;
  const g2 = parseEntities(clipped);
  const text = renderImpact(g2, g2.byId.get("mod-a"));
  assert.match(text, /closure may be missing edges/);
  assert.match(text, /imports: 7\/40/);
});

test("renderSearch: finds the module by defined-symbol name, ranked, compact", () => {
  const text = renderSearch(graph, "fnAlpha");
  assert.match(text, /module\(s\) match "fnAlpha"/);
  assert.match(text, /app\/lib\/a\.mjs \(defines 1 symbol\(s\)\) — matching: fnAlpha/);
  assert.match(text, /tmct_describe/);
  assert.match(renderSearch(graph, "nothing-matches-this"), /no module matches/);
  assert.equal(renderSearch(graph, "   "), "empty query");
});

test("renderSearch kind= switches to symbol search with name/decorator filters", () => {
  const classes = renderSearch(graph, "", { kind: "class" });
  assert.match(classes, /3 class\(s\) match/);
  assert.match(classes, /- Widget \[app\/lib\/b\.mjs:1-30\]/);
  const decorated = renderSearch(graph, "", { kind: "method", decorator: "property" });
  assert.match(decorated, /Widget\.render \[app\/lib\/b\.mjs:5-9\]/);
  const named = renderSearch(graph, "", { kind: "class", name: "^Butt" });
  assert.match(named, /1 class\(s\) match/);
  assert.match(named, /- Button/);
  assert.match(renderSearch(graph, "", { kind: "attribute", name: "zzz" }), /no attribute matches/);
});

test("renderMembers lists a class's methods + attributes with sites/decorators", () => {
  const text = renderMembers(graph, graph.byId.get("cls-widget"));
  assert.match(text, /Widget — Class \(id: cls-widget\)/);
  assert.match(text, /methods \(1\): render \[app\/lib\/b\.mjs:5-9\] @property/);
  assert.match(text, /attributes \(1\): name \[app\/lib\/b\.mjs:2\]/);
  assert.match(renderMembers(graph, graph.byId.get("cls-base")), /members: none recorded/);
});

test("renderSubclasses shows bases + transitive reverse closure", () => {
  const widget = renderSubclasses(graph, graph.byId.get("cls-widget"));
  assert.match(widget, /extends: Base/);
  assert.match(widget, /subclasses: 1 total across 1 level\(s\)/);
  assert.match(widget, /depth 1 \(1\): Button/);
  const base = renderSubclasses(graph, graph.byId.get("cls-base"));
  assert.match(base, /extends: \(no internal\/recorded base classes\)/);
  assert.match(base, /depth 1 \(1\): Widget/); // Widget directly, Button at depth 2
  assert.match(base, /depth 2 \(1\): Button/);
  assert.match(renderSubclasses(graph, graph.byId.get("cls-button")), /subclasses: none recorded/);
});

test("renderArchitecture maps packages + hub modules; package prefix scopes it", () => {
  const all = renderArchitecture(graph);
  assert.match(all, /Architecture: 8 module\(s\)/);
  assert.match(all, /hub modules \(most imported\): app\/lib\/a\.mjs \(3 importers\)/);
  const scoped = renderArchitecture(graph, { pkg: "app/lib" });
  assert.match(scoped, /Architecture of app\/lib: 5 module\(s\)/);
  assert.match(renderArchitecture(graph, { pkg: "nope" }), /no modules under "nope"/);
});

test("renderTestsFor / renderUntested read the test-coverage relation", () => {
  assert.match(renderTestsFor(graph, graph.byId.get("mod-b")), /covered by 1 test module\(s\)/);
  assert.match(renderTestsFor(graph, graph.byId.get("mod-b")), /app\/unit-tests\/b\.test\.mjs/);
  assert.match(renderTestsFor(graph, graph.byId.get("mod-a")), /no covering tests recorded/);
  const untested = renderUntested(graph);
  assert.match(untested, /source module\(s\) with no covering test module/);
  assert.match(untested, /app\/lib\/a\.mjs/);
  assert.doesNotMatch(untested, /b\.test\.mjs/); // test modules are excluded
});

test("contextPlan bundles siblings + registration globals + tests for a module", () => {
  const plan = contextPlan(graph, graph.byId.get("mod-b"));
  assert.equal(plan.moduleLabel, "app/lib/b.mjs");
  assert.deepEqual(plan.siblings.map((s) => s.label), ["Widget"]); // Function/Class only
  assert.equal(plan.siblings[0].class, "Class");
  assert.deepEqual(plan.globals.map((g) => [g.label, g.value]), [["register", "Library()"]]);
  assert.deepEqual(plan.tests, ["app/unit-tests/b.test.mjs"]);
  assert.deepEqual(plan.cochange.map((c) => [c.label, c.weight]), [["app/lib/a.mjs", 3]]); // mod-b co-changes with mod-a ×3
  assert.ok(plan.insertion >= 1); // an insertion line was computed from sibling sites
  assert.equal(plan.anchor, null); // a Module has no anchor snippet
});

test("contextPlan sets the anchor when given a defined symbol", () => {
  const plan = contextPlan(graph, graph.byId.get("fn-alpha"));
  assert.equal(plan.moduleLabel, "app/lib/a.mjs");
  assert.equal(plan.anchor.label, "fnAlpha");
  assert.ok(plan.anchor.site && plan.anchor.site.start === 12);
  assert.equal(plan.exemplar, null); // a defined-symbol anchor shows its own body; no extra exemplar
});

test("contextPlan: Lever 1 ranks siblings (decorator > name > position) + caps; Lever 2 picks a module exemplar", () => {
  const mods = [{
    path: "df.py", dotted: "df", imports: [], calls: [],
    defines: [
      { name: "register", kind: "global", lineno: 1, end_lineno: 1, decorators: [], value: "Library()" },
      { name: "lower", kind: "function", lineno: 5, end_lineno: 7, decorators: ["register.filter"] },
      { name: "upper", kind: "function", lineno: 9, end_lineno: 11, decorators: ["register.filter"] },
      { name: "helper_misc", kind: "function", lineno: 13, end_lineno: 15, decorators: [] },
    ],
  }];
  const g = parseEntities(buildEntities(mods, []));
  const plan = contextPlan(g, g.byId.get("mod:df.py"));
  assert.equal(plan.siblingCap, 8);
  // decorated siblings (the module's @register.filter registration pattern) rank above the bare helper
  const order = plan.siblings.map((s) => s.label);
  assert.ok(order.indexOf("lower") < order.indexOf("helper_misc"));
  assert.ok(order.indexOf("upper") < order.indexOf("helper_misc"));
  // module anchor → a full-body exemplar is chosen (a decorated filter, first by position)
  assert.ok(plan.exemplar && plan.exemplar.site);
  assert.equal(plan.exemplar.label, "lower");
  assert.equal(plan.exemplar.decorators, "register.filter");
});

test("contextPlan: B007 bundle gaps — class members (class anchor), literal __all__, sibling raises", () => {
  const mods = [{
    path: "validators.py", dotted: "validators", imports: [], calls: [], exports: ["validate_slug", "EmailValidator"],
    defines: [
      { name: "validate_slug", kind: "function", lineno: 5, end_lineno: 8, decorators: [], raises: ["ValidationError"], doc: "Validate a slug." },
      { name: "EmailValidator", kind: "class", lineno: 10, end_lineno: 30, bases: [], decorators: [] },
      { name: "EmailValidator.__call__", kind: "method", lineno: 12, end_lineno: 20, decorators: [], params: "self, value", raises: ["ValidationError"] },
      { name: "EmailValidator.message", kind: "attribute", lineno: 11, end_lineno: 11, decorators: [] },
    ],
  }];
  const g = parseEntities(buildEntities(mods, []));
  // literal __all__ surfaced (module anchor)
  const modPlan = contextPlan(g, g.byId.get("mod:validators.py"));
  assert.equal(modPlan.allExports, "validate_slug, EmailValidator");
  // sibling raises carried
  const sib = modPlan.siblings.find((s) => s.label === "validate_slug");
  assert.equal(sib.raises, "ValidationError");
  // class anchor → class members with signatures + raises
  const clsPlan = contextPlan(g, g.byId.get("fn:validators.py#EmailValidator"));
  assert.ok(clsPlan.classMembers && clsPlan.classMembers.className === "EmailValidator");
  const call = clsPlan.classMembers.members.find((m) => /__call__/.test(m.label));
  assert.equal(call.params, "self, value");
  assert.equal(call.raises, "ValidationError");
  // method anchor → resolves to its owner class's members
  const mPlan = contextPlan(g, g.byId.get("fn:validators.py#EmailValidator.__call__"));
  assert.ok(mPlan.classMembers && mPlan.classMembers.className === "EmailValidator");
});

test("renderSignature: compact API surface (params/returns/raises/self-fields/flags/doc)", () => {
  const text = renderSignature(graph, graph.byId.get("m-render"));
  assert.match(text, /signature: Widget\.render\(self, mode='full'\) -> str/);
  assert.match(text, /raises: ValueError/);
  assert.match(text, /self fields: name, size/);
  assert.match(text, /decorators: @property/);
  assert.match(text, /doc: Render the widget\./);
});

test("renderExports lists a module's public API resolved to origin", () => {
  const text = renderExports(graph, graph.byId.get("mod-d"));
  // language-neutral wording (cycle W2P): the reexports edge covers JS/TS `export` as well
  // as Python `__all__`, so the header no longer claims a Python-only "via __all__".
  assert.match(text, /public API \(1 export\(s\)\)/);
  assert.match(text, /fnAlpha ← app\/lib\/a\.mjs/); // re-export resolves to the defining module
  assert.match(renderExports(graph, graph.byId.get("mod-b")), /no public exports recorded/);
});

test("renderCochanges lists co-changed modules by weight", () => {
  const text = renderCochanges(graph, graph.byId.get("mod-a"));
  assert.match(text, /usually changes together with 2 module\(s\)/);
  assert.match(text, /app\/lib\/b\.mjs \(×3\)/);
  assert.match(text, /app\/lib\/c\.mjs \(×2\)/);
  assert.match(renderCochanges(graph, graph.byId.get("scripts/g.mjs") || graph.byId.get("mod-g")), /no change-coupling recorded/);
});

test("renderHistory / renderCallers / renderCallees read history + call edges", () => {
  assert.match(renderHistory(graph, graph.byId.get("mod-a")), /touched by 1 recent commit\(s\): abc1234/);
  assert.match(renderHistory(graph, graph.byId.get("mod-c")), /no commit history recorded/);
  assert.match(renderCallers(graph, graph.byId.get("mod-a")), /called by 1 module\(s\)/);
  assert.match(renderCallers(graph, graph.byId.get("mod-a")), /scripts\/g\.mjs/);
  assert.match(renderCallees(graph, graph.byId.get("mod-g")), /calls into 1 module\(s\)/);
  assert.match(renderCallees(graph, graph.byId.get("mod-g")), /app\/lib\/a\.mjs/);
  assert.match(renderCallers(graph, graph.byId.get("mod-f")), /no recorded callers/);
});

// ---- fine-grained callsSymbol / touchesSymbol (inline graphs; the shared fixture lacks
//      these edges and another agent owns it) -------------------------------------------

// Two functions in cg.py (alpha→beta in-repo call) + a function in other.py (cross-module
// call from alpha). A commit touches alpha (touchesSymbol) and cg.py (module touches).
const fineGraph = parseEntities({
  generated_at: "2026-06-28T00:00:00.000Z",
  objectProperties: [
    { predicate: "defines", prop: "seon:declaresMethod", count: 2, examples: [
      { subject: "mod:cg.py", object: "fn:cg.py#alpha", subjectLabel: "cg.py", objectLabel: "alpha" },
      { subject: "mod:cg.py", object: "fn:cg.py#beta", subjectLabel: "cg.py", objectLabel: "beta" },
    ] },
    { predicate: "callsSymbol", prop: "mgx:callsSymbol", count: 2, examples: [
      { subject: "fn:cg.py#alpha", object: "fn:cg.py#beta", subjectLabel: "alpha", objectLabel: "beta" },
      { subject: "fn:cg.py#alpha", object: "fn:other.py#ext", subjectLabel: "alpha", objectLabel: "ext" },
    ] },
    { predicate: "touches", prop: "mgx:touchedByCommit", count: 1, examples: [
      { subject: "commit:c1", object: "mod:cg.py", subjectLabel: "c1abc", objectLabel: "cg.py" },
    ] },
    { predicate: "touchesSymbol", prop: "mgx:touchesSymbol", count: 1, examples: [
      { subject: "commit:c1", object: "fn:cg.py#alpha", subjectLabel: "c1abc", objectLabel: "alpha" },
    ] },
  ],
  individuals: [
    { id: "mod:cg.py", label: "cg.py", class: "Module", derived_from: [], mentions: [] },
    { id: "fn:cg.py#alpha", label: "alpha", class: "Function", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "cg.py:1-3" }] },
    { id: "fn:cg.py#beta", label: "beta", class: "Function", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "cg.py:5-7" }] },
    { id: "fn:other.py#ext", label: "ext", class: "Function", derived_from: [], mentions: [], attributes: [{ prop: "seon:startsAt", key: "site", value: "other.py:1-2" }] },
    { id: "commit:c1", label: "c1abc", class: "Commit", derived_from: [], mentions: [], attributes: [
      { prop: "mgx:commitAuthor", key: "commitAuthor", value: "Ada" },
      { prop: "mgx:commitDate", key: "commitDate", value: "2026-06-01" },
      { prop: "mgx:commitMessage", key: "commitMessage", value: "tweak alpha" },
    ] },
  ],
});

test("relationKind classifies the fine-grained symbol-level tokens (+ near-miss fallback)", () => {
  assert.equal(relationKind({ prop: "mgx:callsSymbol" }), "callsSymbol");
  assert.equal(relationKind({ prop: "mgx:touchesSymbol" }), "touchesSymbol");
  assert.equal(relationKind({ predicate: "callsSymbol" }), "callsSymbol"); // token-name fallback
  assert.equal(relationKind({ predicate: "touchesSymbol" }), "touchesSymbol");
});

test("renderCalls + callHint list fn→fn in-repo calls with file:line", () => {
  const alpha = fineGraph.byId.get("fn:cg.py#alpha");
  const calls = renderCalls(fineGraph, alpha);
  assert.match(calls, /alpha — Function calls 2 in-repo symbol/);
  assert.match(calls, /beta \[cg\.py:5\]/);
  assert.match(calls, /ext \[other\.py:1\]/);
  assert.equal(callHint(fineGraph, alpha), "calls in-repo: beta [cg.py:5], ext [other.py:1]");
  assert.match(renderCalls(fineGraph, fineGraph.byId.get("fn:cg.py#beta")), /no in-repo calls recorded/);
  assert.equal(callHint(fineGraph, fineGraph.byId.get("fn:cg.py#beta")), "");
});

test("renderFileHistory / renderMethodHistory show author/date/subject from commit attrs", () => {
  const file = renderFileHistory(fineGraph, fineGraph.byId.get("mod:cg.py"));
  assert.match(file, /touched by 1 recent commit/);
  assert.match(file, /c1abc 2026-06-01 Ada — tweak alpha/);
  const method = renderMethodHistory(fineGraph, fineGraph.byId.get("fn:cg.py#alpha"));
  assert.match(method, /alpha — Function: touched by 1 commit/);
  assert.match(method, /c1abc 2026-06-01 Ada — tweak alpha/);
  assert.match(renderMethodHistory(fineGraph, fineGraph.byId.get("fn:cg.py#beta")), /no symbol-level commit history/);
});

test("sizeBundle: TINY (tiny self-contained fn), MID (default), LARGE (big class / cross-module call)", () => {
  // TINY: a 2-LOC, 0-arity, no-raises function as the module's exemplar
  const tinyMods = [{
    path: "t.py", dotted: "t", imports: [], calls: [],
    defines: [
      { name: "register", kind: "global", lineno: 1, end_lineno: 1, decorators: [], value: "Library()" },
      { name: "ping", kind: "function", lineno: 3, end_lineno: 4, decorators: ["register.filter"] },
    ],
  }];
  const tg = parseEntities(buildEntities(tinyMods, []));
  const tinyPlan = contextPlan(tg, tg.byId.get("mod:t.py"));
  const tiny = sizeBundle(tinyPlan, tg);
  assert.equal(tiny.tier, "TINY");
  assert.equal(tiny.mask.tests, false);
  assert.equal(tiny.mask.siblings, false);
  assert.equal(tiny.mask.insertionRegion, true);

  // MID: a long SYMBOL anchor (20-LOC function, anchored on the symbol itself) → not tiny, no
  // cross-module call, not a big-class method. The anchor-gate (#1) only suppresses MODULE
  // digests, so an explicit symbol anchor still tops up.
  const midMods = [{
    path: "m.py", dotted: "m", imports: [], calls: [],
    defines: [
      { name: "big_fn", kind: "function", lineno: 1, end_lineno: 20, decorators: [], params: "a, b" },
      { name: "helper", kind: "function", lineno: 22, end_lineno: 23, decorators: [], params: "x" },
    ],
  }];
  const mg = parseEntities(buildEntities(midMods, []));
  const midPlan = contextPlan(mg, mg.byId.get("fn:m.py#big_fn"));
  assert.equal(sizeBundle(midPlan, mg).tier, "MID");

  // LARGE via big class: a method of a class with ≥8 members
  const bigMods = [{
    path: "c.py", dotted: "c", imports: [], calls: [],
    defines: [
      { name: "Big", kind: "class", lineno: 1, end_lineno: 40, bases: [], decorators: [] },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `Big.m${i}`, kind: "method", lineno: 2 + i, end_lineno: 2 + i, decorators: [], params: "self" })),
    ],
  }];
  const bg = parseEntities(buildEntities(bigMods, []));
  const bigPlan = contextPlan(bg, bg.byId.get("fn:c.py#Big.m0"));
  assert.equal(sizeBundle(bigPlan, bg).tier, "LARGE");

  // LARGE via cross-module call from the focal symbol (inline graph): alpha calls ext in other.py
  const xPlan = contextPlan(fineGraph, fineGraph.byId.get("fn:cg.py#alpha"));
  assert.equal(sizeBundle(xPlan, fineGraph).tier, "LARGE");
});

test("sizeBundle: leaner TINY default + top-up flag (B1/B6)", () => {
  // the COMMON task — a small 1-param helper in a single module → lean TINY, NO top-up
  const smallMods = [{
    path: "u.py", dotted: "u", imports: [], calls: [],
    defines: [{ name: "slug", kind: "function", lineno: 1, end_lineno: 5, decorators: [], params: "value" }],
  }];
  const sg = parseEntities(buildEntities(smallMods, []));
  const sized = sizeBundle(contextPlan(sg, sg.byId.get("mod:u.py")), sg);
  assert.equal(sized.tier, "TINY");
  assert.equal(sized.topup, false);

  // an edit INSIDE a class (class anchor with members) tops up above TINY
  const clsMods = [{
    path: "v.py", dotted: "v", imports: [], calls: [],
    defines: [
      { name: "Thing", kind: "class", lineno: 1, end_lineno: 20, bases: [], decorators: [] },
      { name: "Thing.go", kind: "method", lineno: 2, end_lineno: 4, decorators: [], params: "self" },
    ],
  }];
  const cg = parseEntities(buildEntities(clsMods, []));
  const csized = sizeBundle(contextPlan(cg, cg.byId.get("fn:v.py#Thing")), cg);
  assert.notEqual(csized.tier, "TINY");
  assert.equal(csized.topup, true);
});

test("sizeBundle (B012: TUNING #1 reverted): a long-exemplar MODULE digest escalates TINY→MID", () => {
  // A module whose closest exemplar is LONG (20 LOC) but with NO symbol anchor (the add-a-sibling
  // module-digest case). B011's anchor-gate suppressed branch-(c) to TINY; BENCHMARK_011 proved
  // that trim REGRESSED every model (the trimmed sibling/test tail was load-bearing), so B012
  // reverts it — a long focal escalates to MID regardless of anchor, and `untuned` is now a no-op.
  const longExemplarMods = [{
    path: "text.py", dotted: "text", imports: [], calls: [],
    defines: [
      { name: "register", kind: "global", lineno: 1, end_lineno: 1, decorators: [], value: "Library()" },
      { name: "wrap", kind: "function", lineno: 3, end_lineno: 24, decorators: ["register.filter"], params: "value, length" },
      { name: "ping", kind: "function", lineno: 26, end_lineno: 27, decorators: ["register.filter"], params: "value" },
    ],
  }];
  const lg = parseEntities(buildEntities(longExemplarMods, []));
  const lplan = contextPlan(lg, lg.byId.get("mod:text.py"));
  assert.equal(lplan.anchor, null, "module digest → no symbol anchor");
  assert.ok(lplan.exemplar && lplan.exemplar.site.end - lplan.exemplar.site.start + 1 > 12, "exemplar is long");
  // reverted default: a long exemplar escalates → MID + top-up (== the B010 digest)
  const def = sizeBundle(lplan, lg);
  assert.equal(def.tier, "MID");
  assert.equal(def.topup, true);
  // untuned is now a no-op for sizing → identical MID
  const old = sizeBundle(lplan, lg, { untuned: true });
  assert.equal(old.tier, "MID");
  assert.equal(old.topup, true);
});

test("searchModulesRanked (TUNING #3): ranked [{path, score}] highest-first, same ranking as renderSearch", () => {
  const ranked = searchModulesRanked(graph, "fnAlpha");
  assert.ok(ranked.length >= 1, "at least one module ranked");
  // descending by score
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score, "sorted desc");
  // each entry is a relpath + numeric score
  for (const r of ranked) {
    assert.equal(typeof r.path, "string");
    assert.equal(typeof r.score, "number");
  }
  // rank-1 is the module that defines fnAlpha (the same self-location renderSearch picks)
  assert.match(ranked[0].path, /a\.mjs$/);
  // empty/blank query → empty list (no crash)
  assert.deepEqual(searchModulesRanked(graph, "   "), []);
  assert.deepEqual(searchModulesRanked(graph, "zzz-nothing-matches"), []);
});

test("scoreModules (B012 locate fix): IDF + component matching + symbol-component cap", () => {
  // utils/text.py defines the rare exact symbol `slugify` and the class `Truncator`; db/citext.py
  // merely contains the substring "text" in its path; db/features.py is a bag-of-30 symbols whose
  // components include every common token. A realistic whole-sentence query must rank text.py first.
  const mods = [
    { path: "utils/text.py", dotted: "utils.text", imports: [], calls: [],
      defines: [
        { name: "slugify", kind: "function", lineno: 1, end_lineno: 3, decorators: [], params: "value, allow_unicode" },
        { name: "Truncator", kind: "class", lineno: 5, end_lineno: 12, decorators: [], bases: [] },
      ] },
    { path: "db/citext.py", dotted: "db.citext", imports: [], calls: [],
      defines: [{ name: "CIText", kind: "class", lineno: 1, end_lineno: 4, decorators: [], bases: [] }] },
    { path: "db/features.py", dotted: "db.features", imports: [], calls: [],
      defines: Array.from({ length: 30 }, (_, i) => ({ name: `supports_text_value_${i}`, kind: "attribute", lineno: i + 1, end_lineno: i + 1, decorators: [] })) },
  ];
  const g = parseEntities(buildEntities(mods, []));
  // (1) an EXACT rare-symbol hit (`slugify`) wins over a path-substring ("text") and the symbol bag.
  const r1 = searchModulesRanked(g, "add a way to slugify the text value");
  assert.match(r1[0].path, /utils\/text\.py$/, JSON.stringify(r1.slice(0, 3)));
  // (2) camelCase component matching: querying `truncator` finds the Truncator class' module.
  const r2 = searchModulesRanked(g, "truncator");
  assert.match(r2[0].path, /utils\/text\.py$/, JSON.stringify(r2.slice(0, 3)));
  // (3) the symbol-component channel is capped: features.py (30 "text"/"value" components) cannot
  //     run away — its score stays bounded (no more than a handful of capped component hits).
  const fScore = searchModulesRanked(g, "text value supports").find((r) => /features\.py$/.test(r.path))?.score ?? 0;
  const tScore = searchModulesRanked(g, "text value supports").find((r) => /text\.py$/.test(r.path))?.score ?? 0;
  assert.ok(fScore < tScore * 4, `bag-of-symbols module is capped (features=${fScore}, text=${tScore})`);
  // (4) deterministic.
  assert.deepEqual(searchModulesRanked(g, "slugify text"), searchModulesRanked(g, "slugify text"));
});

test("trimBundleMask (B2): drops bodies + variable tails, keeps signatures + insertion region", () => {
  const m = trimBundleMask(bundleMask("MID"));
  assert.equal(m.anchor, false);
  assert.equal(m.exemplar, false);
  assert.equal(m.inlinedCallees, false);
  assert.equal(m.tests, false);
  assert.equal(m.cochange, false);
  assert.equal(m.siblings, true);        // signatures kept
  assert.equal(m.registration, true);
  assert.equal(m.insertionRegion, true); // placement kept
});

test("rankModulesByProximity (B2): orders secondaries by import/cochange closeness to the primary", () => {
  // primary app/lib/a.mjs: b imports it AND co-changes ×3; c imports it + co-changes ×2; g only calls it
  const order = rankModulesByProximity(graph, "app/lib/a.mjs", ["scripts/g.mjs", "app/lib/c.mjs", "app/lib/b.mjs"]);
  assert.deepEqual(order, ["app/lib/b.mjs", "app/lib/c.mjs", "scripts/g.mjs"]);
  // unmappable primary → input order preserved
  assert.deepEqual(rankModulesByProximity(graph, "no/such/module.py", ["x.py", "y.py"]), ["x.py", "y.py"]);
});

test("renderSearch (B3 i): an exact defined-symbol name beats a mere path substring", () => {
  const mods = [
    { path: "filters.py", dotted: "filters", imports: [], calls: [],
      defines: [{ name: "slugify", kind: "function", lineno: 1, end_lineno: 3, decorators: [] }] },
    { path: "slugify_compat.py", dotted: "slugify_compat", imports: [], calls: [],
      defines: [{ name: "helper", kind: "function", lineno: 1, end_lineno: 3, decorators: [] }] },
  ];
  const g = parseEntities(buildEntities(mods, []));
  const text = renderSearch(g, "slugify");
  const iDefiner = text.indexOf("filters.py");
  const iPathOnly = text.indexOf("slugify_compat.py");
  assert.ok(iDefiner !== -1 && iPathOnly !== -1 && iDefiner < iPathOnly, text);
});

test("renderSearch (B3 ii): import-graph proximity keeps the top hits coherent", () => {
  const mods = [
    { path: "core.py", dotted: "core", imports: [], calls: [],
      defines: [{ name: "widget", kind: "function", lineno: 1, end_lineno: 3, decorators: [] }] },
    { path: "widget_views.py", dotted: "widget_views", imports: ["core"], calls: [],
      defines: [{ name: "view_one", kind: "function", lineno: 1, end_lineno: 3, decorators: [] }] },
    { path: "widget_utils.py", dotted: "widget_utils", imports: [], calls: [],
      defines: [{ name: "util_one", kind: "function", lineno: 1, end_lineno: 3, decorators: [] }] },
  ];
  const g = parseEntities(buildEntities(mods, []));
  const text = renderSearch(g, "widget");
  // both widget_* modules match the path only; the one importing the strong match (core) wins
  assert.ok(text.indexOf("widget_views.py") < text.indexOf("widget_utils.py"), text);
});

test("bundleMask: TINY trims; FULL/LARGE turn everything on (LARGE inlines callees)", () => {
  assert.equal(bundleMask("TINY").siblings, false);
  assert.equal(bundleMask("TINY").cochange, false);
  assert.equal(bundleMask("MID").siblings, true);
  assert.equal(bundleMask("MID").inlinedCallees, false);
  assert.equal(bundleMask("LARGE").inlinedCallees, true);
  assert.equal(bundleMask("FULL").inlinedCallees, true);
});

test("contextPlan exposes the contiguous insertion region + trimmed MID tails", () => {
  const plan = contextPlan(graph, graph.byId.get("mod-b"));
  assert.ok(plan.insertionRegion && plan.insertionRegion.start >= 1);
  // #13: caps tightened — cochange ≤4, tests ≤6
  assert.ok(plan.cochange.length <= 4);
  assert.ok(plan.tests.length <= 6);
});

test("renderContextMore renders only the omitted sections (siblings/tests/cochange/...)", () => {
  const plan = contextPlan(graph, graph.byId.get("mod-b"));
  const text = renderContextMore(plan);
  assert.match(text, /Additional context for app\/lib\/b\.mjs/);
  assert.match(text, /sibling symbols/);
  assert.match(text, /Class Widget/);
  assert.match(text, /covering tests: app\/unit-tests\/b\.test\.mjs/);
});

test("renderToolsCatalog lists the cold tools with exact CLI invocations", () => {
  const cat = renderToolsCatalog("/abs/bin/cli.mjs");
  assert.match(cat, /# tmct cold-tool catalog/);
  // hot tools are NOT given a cold ## entry
  assert.doesNotMatch(cat, /## tmct_context\n/);
  assert.doesNotMatch(cat, /## tmct_snippet\n/);
  // representative cold tools + their exact Bash invocation
  for (const name of ["tmct_describe", "tmct_calls", "tmct_file_history", "tmct_method_history", "tmct_class_history", "tmct_context_more", "tmct_impact"]) {
    assert.ok(cat.includes(`## ${name}`), `missing ${name}`);
  }
  assert.match(cat, /node \/abs\/bin\/cli\.mjs cli tmct_describe '\{"symbol":"django\/utils\/text\.py"\}'/);
  assert.match(cat, /node \/abs\/bin\/cli\.mjs cli tmct_calls '\{"symbol":"slugify"\}'/);
});

test("structural ranking: a structurally-closer sibling outranks a far one within a name tier", () => {
  // No decorators, no name overlap → decoration & name tiers tie; structural affinity decides.
  // anchor `make_thing` has 2 params + returns; `build_item` matches that shape, `noop` doesn't.
  const mods = [{
    path: "s.py", dotted: "s", imports: [], calls: [],
    defines: [
      { name: "make_thing", kind: "function", lineno: 1, end_lineno: 3, decorators: [], params: "a, b", returns: "Thing" },
      { name: "build_item", kind: "function", lineno: 5, end_lineno: 7, decorators: [], params: "x, y", returns: "Item" },
      { name: "noop", kind: "function", lineno: 9, end_lineno: 10, decorators: [] },
    ],
  }];
  const g = parseEntities(buildEntities(mods, []));
  const plan = contextPlan(g, g.byId.get("fn:s.py#make_thing"));
  const order = plan.siblings.map((s) => s.label);
  assert.ok(order.indexOf("build_item") < order.indexOf("noop"));
});

// ── B016 recall levers (R1a demoteNonProd · E1a callAdjacency) ─────────────────────────────────
// Both flags are opt-in; the first test pins the OFF path byte-identical to the pre-B016 ranking.

const b016Payload = {
  individuals: [
    { id: "mod:lib/widget.js", class: "Module", label: "lib/widget.js" },
    { id: "mod:examples/widget/index.js", class: "Module", label: "examples/widget/index.js" },
    { id: "mod:lib/helpers.js", class: "Module", label: "lib/helpers.js" },
    { id: "mod:util/helpers.js", class: "Module", label: "util/helpers.js" },
    { id: "fn:lib/widget.js#renderWidget", class: "Function", label: "renderWidget" },
    { id: "fn:lib/helpers.js#escapeHtml", class: "Function", label: "escapeHtml" },
    { id: "fn:util/helpers.js#escapeHtml", class: "Function", label: "escapeHtml" },
  ],
  objectProperties: [
    { predicate: "defines", examples: [
      { subject: "mod:lib/widget.js", object: "fn:lib/widget.js#renderWidget", objectLabel: "renderWidget" },
      { subject: "mod:examples/widget/index.js", object: "sym:widgetDemo", objectLabel: "widgetDemo" },
      { subject: "mod:lib/helpers.js", object: "fn:lib/helpers.js#escapeHtml", objectLabel: "escapeHtml" },
      { subject: "mod:util/helpers.js", object: "fn:util/helpers.js#escapeHtml", objectLabel: "escapeHtml" },
    ] },
    // The call edge is function-level and lands on the LONGER-labelled twin, so the lexical
    // tie-break (shorter label) puts it second when the flag is OFF — the flag must flip it.
    { predicate: "calls", examples: [
      { subject: "fn:lib/widget.js#renderWidget", object: "fn:util/helpers.js#escapeHtml" },
    ] },
  ],
};
const b016Graph = parseEntities(b016Payload);

test("B016 flags OFF: searchModulesRanked is byte-identical with absent, empty, and false opts", () => {
  for (const q of ["widget", "renderWidget escapeHtml helpers", "fnAlpha"]) {
    const base = searchModulesRanked(graph, q);
    assert.deepEqual(searchModulesRanked(graph, q, {}), base);
    assert.deepEqual(searchModulesRanked(graph, q, { demoteNonProd: false, callAdjacency: false, implOfInterface: false }), base);
  }
  const base = searchModulesRanked(b016Graph, "widget");
  assert.deepEqual(searchModulesRanked(b016Graph, "widget", {}), base);
  assert.deepEqual(searchModulesRanked(b016Graph, "widget", { implOfInterface: false }), base);
});

test("B016 R1a demoteNonProd: examples/ module drops below production; OFF ranking untouched", () => {
  const off = searchModulesRanked(b016Graph, "widget");
  const on = searchModulesRanked(b016Graph, "widget", { demoteNonProd: true });
  const offExamples = off.find((r) => r.path.startsWith("examples/"));
  const onExamples = on.find((r) => r.path.startsWith("examples/"));
  assert.ok(offExamples && onExamples, "examples module matches in both runs (demoted, not excluded)");
  assert.ok(onExamples.score < offExamples.score, "flag strictly reduces the non-prod score");
  assert.equal(on[0].path, "lib/widget.js");
  assert.equal(on[on.length - 1].path, "examples/widget/index.js", "non-prod ranks last with the flag");
});

test("B016 E1a callAdjacency: the called-into twin overtakes its lexically-tied sibling", () => {
  const q = "renderWidget escapeHtml helpers";
  const off = searchModulesRanked(b016Graph, q);
  const on = searchModulesRanked(b016Graph, q, { callAdjacency: true });
  const pos = (list, p) => list.findIndex((r) => r.path === p);
  // OFF: identical base scores → shorter label wins the tie-break.
  assert.ok(pos(off, "lib/helpers.js") < pos(off, "util/helpers.js"));
  // ON: util/helpers.js rides the call edge from the strongly-matched lib/widget.js and flips.
  // (The bounded nudge may also reorder other near-ties, like import-proximity —
  // so the only pinned behaviour is the twin flip itself.)
  assert.ok(pos(on, "util/helpers.js") < pos(on, "lib/helpers.js"));
});

// ── B016 E1b (implOfInterface) — mirrors the real eshoponweb shape: the `inherits` edge OBJECT
// is an unresolved `ext:<Name>` id (C#'s extractor never resolves it to the interface's own
// individual), so E1b must resolve by exact label match. A distractor concrete-base edge and a
// Python-labelled false-positive prove the guard (C#-scope + `I<Upper>` naming) doesn't over-fire.
const e1bPayload = {
  individuals: [
    { id: "mod:Interfaces/IWidget.cs", class: "Module", label: "Interfaces/IWidget.cs" },
    { id: "fn:Interfaces/IWidget.cs#IWidget", class: "Class", label: "IWidget" },
    { id: "mod:Services/Widget.cs", class: "Module", label: "Services/Widget.cs" },
    { id: "fn:Services/Widget.cs#Widget", class: "Class", label: "Widget" },
    { id: "mod:Services/OtherThing.cs", class: "Module", label: "Services/OtherThing.cs" },
    { id: "fn:Services/OtherThing.cs#OtherThing", class: "Class", label: "OtherThing" },
    { id: "mod:util/ioutil.py", class: "Module", label: "util/ioutil.py" },
    { id: "fn:util/ioutil.py#ImplantThing", class: "Class", label: "ImplantThing" },
  ],
  objectProperties: [
    { predicate: "defines", examples: [
      { subject: "mod:Interfaces/IWidget.cs", object: "fn:Interfaces/IWidget.cs#IWidget", objectLabel: "IWidget" },
      { subject: "mod:Services/Widget.cs", object: "fn:Services/Widget.cs#Widget", objectLabel: "Widget" },
      { subject: "mod:Services/OtherThing.cs", object: "fn:Services/OtherThing.cs#OtherThing", objectLabel: "OtherThing" },
      { subject: "mod:util/ioutil.py", object: "fn:util/ioutil.py#ImplantThing", objectLabel: "ImplantThing" },
    ] },
    { predicate: "inherits", examples: [
      // Widget implements IWidget — object is an UNRESOLVED ext: ref, exactly like real C#.
      { subject: "fn:Services/Widget.cs#Widget", object: "ext:IWidget", subjectLabel: "Widget", objectLabel: "IWidget" },
      // Distractor: OtherThing extends a plain base (no I-prefix) — must NOT be boosted.
      { subject: "fn:Services/OtherThing.cs#OtherThing", object: "ext:BaseThing", subjectLabel: "OtherThing", objectLabel: "BaseThing" },
      // False-positive risk: a .py module "implementing" something matching I[A-Z] (like django's
      // IOBase/IExact) — the C#-only scope must suppress this regardless of the naming match.
      { subject: "fn:util/ioutil.py#ImplantThing", object: "ext:IOBase", subjectLabel: "ImplantThing", objectLabel: "IOBase" },
    ] },
  ],
};
const e1bGraph = parseEntities(e1bPayload);

test("B016 E1b implOfInterface: C# implementer rises with its strongly-matched interface (unresolved ext: ref)", () => {
  const q = "widget interface implementation";
  const off = searchModulesRanked(e1bGraph, q);
  const on = searchModulesRanked(e1bGraph, q, { implOfInterface: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.ok(scoreOf(on, "Services/Widget.cs") > scoreOf(off, "Services/Widget.cs"), "Widget.cs rises when the flag is on");
  assert.equal(scoreOf(on, "Interfaces/IWidget.cs"), scoreOf(off, "Interfaces/IWidget.cs"), "the interface's OWN score is untouched (it donates, not receives)");
});

test("B016 E1b implOfInterface: a distractor concrete-base edge (no I-prefix) is not boosted", () => {
  const q = "widget otherthing basething";
  const off = searchModulesRanked(e1bGraph, q);
  const on = searchModulesRanked(e1bGraph, q, { implOfInterface: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.equal(scoreOf(on, "Services/OtherThing.cs"), scoreOf(off, "Services/OtherThing.cs"), "no I[A-Z] base name → no boost");
});

test("B016 E1b implOfInterface: a Python module is never boosted even with an I[A-Z]-named base (C#-only scope)", () => {
  const q = "iobase implant thing";
  const off = searchModulesRanked(e1bGraph, q);
  const on = searchModulesRanked(e1bGraph, q, { implOfInterface: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.equal(scoreOf(on, "util/ioutil.py"), scoreOf(off, "util/ioutil.py"), "non-.cs implementer module is never boosted, even when the base name matches I[A-Z]");
});

// ── PLAN_PROSE_INDEX.md §6 (proseBoost, 2026-07-02) — a lexical boost from decomposed-identifier/
// doc-comment prose tokens (entities.proseIndex, built by prose.mjs). "invoice"/"subtotal"/"tax"
// appear nowhere in calculateTotalPrice's own path or identifier components — only in its prose
// tokens (as attachProseTokens would derive from a doc comment) — mirroring the exact
// "billing calculation" -> calculateTotalPrice case the plan itself worked through. Opt-in, and
// only ever re-ranks a module already present in `scored` via ordinary lexical match ("price",
// a real identComponents hit) — never introduces a new zero-match candidate.
const proseBoostPayload = {
  individuals: [
    { id: "mod:src/billing.mjs", class: "Module", label: "src/billing.mjs" },
    { id: "fn:src/billing.mjs#calculateTotalPrice", class: "Function", label: "calculateTotalPrice" },
    { id: "mod:src/unrelated.mjs", class: "Module", label: "src/unrelated.mjs" },
    { id: "fn:src/unrelated.mjs#noop", class: "Function", label: "noop" },
  ],
  objectProperties: [
    { predicate: "defines", examples: [
      { subject: "mod:src/billing.mjs", object: "fn:src/billing.mjs#calculateTotalPrice", objectLabel: "calculateTotalPrice" },
      { subject: "mod:src/unrelated.mjs", object: "fn:src/unrelated.mjs#noop", objectLabel: "noop" },
    ] },
  ],
  proseIndex: {
    invoice: ["fn:src/billing.mjs#calculateTotalPrice"],
    subtotal: ["fn:src/billing.mjs#calculateTotalPrice"],
    tax: ["fn:src/billing.mjs#calculateTotalPrice"],
  },
};
const proseBoostGraph = parseEntities(proseBoostPayload);

test("PLAN_PROSE_INDEX.md proseBoost: prose-only vocabulary (never in the path/symbol name) boosts an already-matched module, never introduces a new one", () => {
  const q = "price invoice";
  const off = searchModulesRanked(proseBoostGraph, q);
  const on = searchModulesRanked(proseBoostGraph, q, { proseBoost: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.ok(scoreOf(off, "src/billing.mjs") > 0, "billing.mjs matches lexically on \"price\" alone (an identComponents hit)");
  assert.ok(scoreOf(on, "src/billing.mjs") > scoreOf(off, "src/billing.mjs"), "the flag adds a strictly higher score via the \"invoice\" prose token");
  assert.equal(off.some((r) => r.path === "src/unrelated.mjs"), false, "unrelated.mjs never matches lexically");
  assert.equal(on.some((r) => r.path === "src/unrelated.mjs"), false, "…still true with the flag on (SAFETY SCOPE: no new candidates, ever)");
});

test("PLAN_PROSE_INDEX.md proseBoost: OFF (absent/false/no proseIndex) is byte-identical to the pre-existing ranking", () => {
  const q = "price invoice";
  const base = searchModulesRanked(proseBoostGraph, q);
  assert.deepEqual(searchModulesRanked(proseBoostGraph, q, {}), base);
  assert.deepEqual(searchModulesRanked(proseBoostGraph, q, { proseBoost: false }), base);
  // graph.proseIndex is `{}` on the pre-existing fixtures used throughout this file (no proseIndex
  // field in their payloads) — proseBoost:true against a graph with nothing to look up must be a
  // pure no-op, not an error.
  assert.deepEqual(searchModulesRanked(graph, "fnAlpha", { proseBoost: true }), searchModulesRanked(graph, "fnAlpha"));
});

// ── Layered prose normalisation (proseLayers, 2026-07-02) — the prose index carries NORMALISED
// layers (spell-corrected / canonical-schema-term / stem / lemma) under proseIndex["tmct:layers"],
// keyed by the normalised token. A task-text word that only reaches a module through a normalised
// form ("refund" → the module's lemma layer) scores nothing in the verbatim scorer; the opt-in
// flag adds a bounded, discounted signal. "refund" appears NOWHERE in calculateTotal's path or
// identifier components — only in the lemma layer's postings — while the module is already in
// `scored` via the ordinary lexical hit on "total" (an identComponents match). unrelated.mjs has
// a layer posting too, but never matches lexically, so it must stay absent (no new candidate).
const proseLayersPayload = {
  individuals: [
    { id: "mod:src/billing.mjs", class: "Module", label: "src/billing.mjs" },
    { id: "fn:src/billing.mjs#calculateTotal", class: "Function", label: "calculateTotal" },
    { id: "mod:src/unrelated.mjs", class: "Module", label: "src/unrelated.mjs" },
    { id: "fn:src/unrelated.mjs#noop", class: "Function", label: "noop" },
  ],
  objectProperties: [
    { predicate: "defines", examples: [
      { subject: "mod:src/billing.mjs", object: "fn:src/billing.mjs#calculateTotal", objectLabel: "calculateTotal" },
      { subject: "mod:src/unrelated.mjs", object: "fn:src/unrelated.mjs#noop", objectLabel: "noop" },
    ] },
  ],
  proseIndex: {
    // verbatim top level (unused by proseLayers — it consults only the layers below)
    total: ["fn:src/billing.mjs#calculateTotal"],
    "tmct:layers": {
      lemma: {
        refund: ["fn:src/billing.mjs#calculateTotal"],   // billing.mjs reachable only via the lemma layer
        widget: ["fn:src/unrelated.mjs#noop"],           // unrelated.mjs has a layer posting but no lexical match
      },
      stem: {
        calcul: ["fn:src/billing.mjs#calculateTotal"],
      },
    },
  },
};
const proseLayersGraph = parseEntities(proseLayersPayload);

test("proseLayers: a token matching a module only via a normalised layer boosts it at a discounted score, never a new candidate", () => {
  const q = "total refund"; // "total" → lexical hit (calculateTotal component); "refund" → lemma layer only
  const off = searchModulesRanked(proseLayersGraph, q);
  const on = searchModulesRanked(proseLayersGraph, q, { proseLayers: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.ok(scoreOf(off, "src/billing.mjs") > 0, "billing.mjs matches lexically on \"total\" alone");
  assert.ok(scoreOf(on, "src/billing.mjs") > scoreOf(off, "src/billing.mjs"), "the flag adds a strictly higher score via the \"refund\" lemma-layer hit");
  // Discounted below the module's own base: the nudge is capped at PROSE_LAYER_CAP_FRAC (0.35) of it.
  assert.ok(scoreOf(on, "src/billing.mjs") <= scoreOf(off, "src/billing.mjs") * 1.35 + 1e-9, "layer nudge stays within the FRAC/CAP bound (never rivals a verbatim match)");
  assert.equal(off.some((r) => r.path === "src/unrelated.mjs"), false, "unrelated.mjs never matches lexically");
  assert.equal(on.some((r) => r.path === "src/unrelated.mjs"), false, "…still true with the flag on: a layer posting alone never introduces a candidate");
});

test("proseLayers: a token that ALREADY matched a module lexically is not double-counted via a layer", () => {
  // "calcul" is both the stem-layer key AND (as an identComponents split of calculateTotal) a real
  // lexical component — but the query token is the whole word "total", which matches lexically and
  // has no layer posting, so billing gets no ADDITIVE layer signal from a token it already saw.
  const q = "total"; // lexical-only; no layer posting for "total"
  const off = searchModulesRanked(proseLayersGraph, q);
  const on = searchModulesRanked(proseLayersGraph, q, { proseLayers: true });
  assert.deepEqual(on, off, "no layer posting for an already-matched token → byte-identical");
});

test("proseLayers: OFF (absent/false/no layers) is byte-identical to the pre-existing ranking", () => {
  const q = "total refund";
  const base = searchModulesRanked(proseLayersGraph, q);
  assert.deepEqual(searchModulesRanked(proseLayersGraph, q, {}), base);
  assert.deepEqual(searchModulesRanked(proseLayersGraph, q, { proseLayers: false }), base);
  // A graph with NO prose layers at all (the fixtures used throughout this file carry proseIndex:{})
  // — proseLayers:true must be a pure no-op, not an error.
  assert.deepEqual(searchModulesRanked(graph, "fnAlpha", { proseLayers: true }), searchModulesRanked(graph, "fnAlpha"));
  // A graph WITH a verbatim proseIndex but no "tmct:layers" key: still a pure no-op.
  assert.deepEqual(searchModulesRanked(proseBoostGraph, "price invoice", { proseLayers: true }), searchModulesRanked(proseBoostGraph, "price invoice"));
});

test("proseLayerHits accessor: reads the normalised layers read-only, tolerates absent/malformed, returns {ids, via}", () => {
  const hit = proseLayerHits(proseLayersGraph.proseIndex, "refund");
  assert.deepEqual(hit, { ids: ["fn:src/billing.mjs#calculateTotal"], via: "lemma" });
  // multi-layer hit: sorted ids, "+"-joined sorted via
  const multi = proseLayerHits({ "tmct:layers": {
    lemma: { foo: ["b", "a"] },
    stem: { foo: ["a", "c"] },
  } }, "foo");
  assert.deepEqual(multi, { ids: ["a", "b", "c"], via: "lemma+stem" });
  // posting given as { ids: [...] } is tolerated
  assert.deepEqual(proseLayerHits({ "tmct:layers": { canonical: { x: { ids: ["z"] } } } }, "x"), { ids: ["z"], via: "canonical" });
  // accepts a parsed graph too (reads .proseIndex)
  assert.deepEqual(proseLayerHits(proseLayersGraph, "refund"), { ids: ["fn:src/billing.mjs#calculateTotal"], via: "lemma" });
  // misses / malformed / absent → { ids: [], via: null }
  assert.deepEqual(proseLayerHits(proseLayersGraph.proseIndex, "nope"), { ids: [], via: null });
  assert.deepEqual(proseLayerHits({}, "refund"), { ids: [], via: null });
  assert.deepEqual(proseLayerHits(null, "refund"), { ids: [], via: null });
  assert.deepEqual(proseLayerHits({ "tmct:layers": null }, "refund"), { ids: [], via: null });
});

// ── PLAN_SEON_TUNING.md §7.5/§7.6(5a) (literalMention, 2026-07-02) — the tokenizer destroys a
// verbatim dotted module reference in task text; the lever matches the RAW query against each
// Module's `dotted` attribute / path label with boundary + min-component rules. Mirrors the B016
// domain-filter shape: http.py's rival (httpx.py) outscores it lexically on shared "http"
// vocabulary, and only the literal mention "django.utils.http" identifies the true module.
const literalPayload = {
  individuals: [
    { id: "mod:django/utils/http.py", class: "Module", label: "django/utils/http.py",
      attributes: [{ prop: "mgx:dotted", key: "dotted", value: "django.utils.http" }] },
    { id: "fn:django/utils/http.py#parse_thing", class: "Function", label: "parse_thing" },
    // Rival: many http-ish symbols + the "http" path substring → lexically stronger than http.py.
    { id: "mod:django/utils/httpx.py", class: "Module", label: "django/utils/httpx.py",
      attributes: [{ prop: "mgx:dotted", key: "dotted", value: "django.utils.httpx" }] },
    { id: "fn:django/utils/httpx.py#http_get", class: "Function", label: "http_get" },
    { id: "fn:django/utils/httpx.py#http_post", class: "Function", label: "http_post" },
    { id: "fn:django/utils/httpx.py#http_client", class: "Function", label: "http_client" },
    // The __init__.py prefix artifact: dotted "django.utils" (2 components) sits INSIDE the
    // literal "django.utils.http" and also appears standalone in the query — must never fire.
    { id: "mod:django/utils/__init__.py", class: "Module", label: "django/utils/__init__.py",
      attributes: [{ prop: "mgx:dotted", key: "dotted", value: "django.utils" }] },
    { id: "fn:django/utils/__init__.py#autodetect", class: "Function", label: "autodetect" },
  ],
  objectProperties: [
    { predicate: "defines", examples: [
      { subject: "mod:django/utils/http.py", object: "fn:django/utils/http.py#parse_thing", objectLabel: "parse_thing" },
      { subject: "mod:django/utils/httpx.py", object: "fn:django/utils/httpx.py#http_get", objectLabel: "http_get" },
      { subject: "mod:django/utils/httpx.py", object: "fn:django/utils/httpx.py#http_post", objectLabel: "http_post" },
      { subject: "mod:django/utils/httpx.py", object: "fn:django/utils/httpx.py#http_client", objectLabel: "http_client" },
      { subject: "mod:django/utils/__init__.py", object: "fn:django/utils/__init__.py#autodetect", objectLabel: "autodetect" },
    ] },
  ],
};
const literalGraph = parseEntities(literalPayload);
// Both the dotted form and a standalone 2-component package mention appear verbatim.
const literalQ = "make the http client timeout configurable in django.utils.http (django.utils is the package)";

test("literalMention OFF (absent/false) is byte-identical to the pre-existing ranking", () => {
  const base = searchModulesRanked(literalGraph, literalQ);
  assert.deepEqual(searchModulesRanked(literalGraph, literalQ, {}), base);
  assert.deepEqual(searchModulesRanked(literalGraph, literalQ, { literalMention: false }), base);
  // and on the main fixture (whose modules carry no dotted attributes at all)
  assert.deepEqual(searchModulesRanked(graph, "fnAlpha", { literalMention: true }), searchModulesRanked(graph, "fnAlpha"));
});

test("literalMention: the verbatim dotted mention flips the true module above its lexically-stronger rival", () => {
  const off = searchModulesRanked(literalGraph, literalQ);
  const on = searchModulesRanked(literalGraph, literalQ, { literalMention: true });
  const pos = (list, p) => list.findIndex((r) => r.path === p);
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  // OFF: the http_* symbol bag + "http" path substring put httpx.py first — the B016 failure shape.
  assert.ok(pos(off, "django/utils/httpx.py") < pos(off, "django/utils/http.py"), JSON.stringify(off));
  // ON: the literal mention lifts http.py above it; the unmentioned rival's score is untouched.
  assert.ok(pos(on, "django/utils/http.py") < pos(on, "django/utils/httpx.py"), JSON.stringify(on));
  assert.equal(scoreOf(on, "django/utils/httpx.py"), scoreOf(off, "django/utils/httpx.py"),
    "no mention → no bonus (httpx.py is a rival, not a match: 'django.utils.httpx' never occurs)");
});

test("literalMention: bounded — the bonus never exceeds LIT_CAP_FRAC of the strongest base score", () => {
  const off = searchModulesRanked(literalGraph, literalQ);
  const on = searchModulesRanked(literalGraph, literalQ, { literalMention: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  const bonus = scoreOf(on, "django/utils/http.py") - scoreOf(off, "django/utils/http.py");
  assert.ok(bonus > 0, "the mentioned module gains a strictly positive bonus");
  assert.ok(bonus <= off[0].score * 0.9 + 1e-9, `FRAC/CAP bound holds (bonus=${bonus}, maxBase=${off[0].score})`);
});

test("literalMention: a 2-component dotted name (package __init__ prefix artifact) never fires", () => {
  const off = searchModulesRanked(literalGraph, literalQ);
  const on = searchModulesRanked(literalGraph, literalQ, { literalMention: true });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  // "django.utils" occurs BOTH standalone and as a prefix inside "django.utils.http"; the
  // min-component floor + continuation-boundary rule mean __init__.py gets nothing either way.
  assert.equal(scoreOf(on, "django/utils/__init__.py"), scoreOf(off, "django/utils/__init__.py"));
});

test("literalMention: the repo-relative PATH form fires too, and flanked (non-boundary) occurrences do not", () => {
  const pathQ = "the fix belongs in django/utils/http.py next to parse_thing";
  const on = searchModulesRanked(literalGraph, pathQ, { literalMention: true });
  const off = searchModulesRanked(literalGraph, pathQ);
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.ok(scoreOf(on, "django/utils/http.py") > scoreOf(off, "django/utils/http.py"), "path-form mention fires");
  // Flanked occurrences are not mentions: continuation chars on either side (a longer dotted/path
  // run) must suppress the match entirely.
  for (const q of ["see mydjango.utils.http here", "see django.utils.httpext here", "see corpus/django.utils.http here"]) {
    assert.deepEqual(searchModulesRanked(literalGraph, q, { literalMention: true }),
      searchModulesRanked(literalGraph, q), q);
  }
});

// ── PLAN_SEON_TUNING.md §7.6(5b) (embedRank, 2026-07-02) — static-embedding cosine re-rank.
// The embedder is INJECTED (codegraph.mjs stays fs-free and CI never needs the 30 MB weights):
// these tests use a fake keyword embedder, not the real potion-base-8M table (embed.test.mjs
// covers that loader numerically). The literalMention fixture is reused: httpx.py beats http.py
// lexically, and only semantic similarity ("url host handling" ↔ http.py's text) can flip them.
const fakeEmbedder = {
  dim: 2,
  // Axis 0 = "url-ness", axis 1 = "client-ness": http.py's module text (path + parse_thing)
  // maps to the url axis, httpx.py's (http_get/http_post/http_client) to the client axis.
  embed(text) {
    const t = String(text).toLowerCase();
    const v = new Float32Array(2);
    if (/\burl\b|parse_thing/.test(t)) v[0] = 1;
    if (/http_get|http_client|\bclient\b/.test(t)) v[1] = 1;
    const n = Math.hypot(v[0], v[1]);
    if (n > 0) { v[0] /= n; v[1] /= n; }
    return v;
  },
};

test("embedRank: cosine similarity flips a lexically-tied rival; unrelated scores only ever grow boundedly", () => {
  const q = "normalise the url host handling in the http helpers"; // "url" → http.py's axis
  const off = searchModulesRanked(literalGraph, q);
  const on = searchModulesRanked(literalGraph, q, { embedRank: true, embedder: fakeEmbedder });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.ok(scoreOf(on, "django/utils/http.py") > scoreOf(off, "django/utils/http.py"),
    "the semantically-close module gains a strictly positive nudge");
  // FRAC/CAP bound: no module's score may grow by more than EMB_CAP_FRAC (0.35) of itself.
  for (const r of off) {
    const grown = scoreOf(on, r.path);
    assert.ok(grown <= r.score * 1.35 + 1e-9, `${r.path} bounded (${r.score} → ${grown})`);
  }
  assert.equal(on.length, off.length, "re-rank only — never introduces a new candidate");
});

test("embedRank OFF (absent/false) and embedRank WITHOUT an embedder are byte-identical no-ops", () => {
  const q = "normalise the url host handling in the http helpers";
  const base = searchModulesRanked(literalGraph, q);
  assert.deepEqual(searchModulesRanked(literalGraph, q, {}), base);
  assert.deepEqual(searchModulesRanked(literalGraph, q, { embedRank: false }), base);
  // weights-absent path: flag on, no embedder injected → no-op (plus a one-time stderr note).
  assert.deepEqual(searchModulesRanked(literalGraph, q, { embedRank: true }), base);
});

// B016 R1b promoted to the shipped default (2026-07-02, PLAN_B016.md §6.9): selectRankedModules is
// the single source of truth for gap-extension, shared by cli.mjs's digest query-mode (which
// EXPLICITLY opts into DEFAULT_SCORE_GAP as ITS OWN policy default) and bench/run.mjs's
// selectModules (which always threads its own explicit scoreGapK, defaulting to null). The
// function itself must stay neutral — these tests are the byte-identical-when-off guarantee every
// future bench arm and future caller depends on.
const gapRanked = [
  { path: "a.py", score: 10 },
  { path: "b.py", score: 8 },   // 0.8 of rank-1 — within any reasonable gap
  { path: "c.py", score: 1 },   // far below
];

test("selectRankedModules: scoreGapK absent (undefined) defaults to OFF — plain top-k, no gap-extension", () => {
  assert.deepEqual(selectRankedModules(gapRanked, { top_k: 1 }), ["a.py"]);
  assert.deepEqual(selectRankedModules(gapRanked, { top_k: 2 }), ["a.py", "b.py"]);
});

test("selectRankedModules: scoreGapK explicitly null/false is identical to plain slice(0, top_k)", () => {
  const plain = gapRanked.slice(0, 1).map((r) => r.path);
  assert.deepEqual(selectRankedModules(gapRanked, { top_k: 1, scoreGapK: null }), plain);
  assert.deepEqual(selectRankedModules(gapRanked, { top_k: 1, scoreGapK: false }), plain);
});

test("selectRankedModules: scoreGapK extends top-1 to include a near-tied rank-2, but not a distant rank-3", () => {
  assert.deepEqual(selectRankedModules(gapRanked, { top_k: 1, scoreGapK: DEFAULT_SCORE_GAP }), ["a.py", "b.py"]);
});

test("selectRankedModules: never resurrects a suppressed (top_k=0) selection, regardless of scoreGapK", () => {
  assert.deepEqual(selectRankedModules(gapRanked, { top_k: 0, scoreGapK: DEFAULT_SCORE_GAP }), []);
});

test("selectRankedModules: empty ranked list is always empty, any options", () => {
  assert.deepEqual(selectRankedModules([], { top_k: 5, scoreGapK: DEFAULT_SCORE_GAP }), []);
});

// ── §5.15 beam search (beamSearch/beamWidth) — a two-ply threshold+cap expansion over
// imports/calls/inherits/cochange. Reuses e1bGraph (already has an inherits edge shape) plus a
// dedicated two-hop fixture (a -> b via imports -> c via calls) to exercise multi-ply propagation.
test("beamSearch: OFF by default — byte-identical to no opts at all", () => {
  const off = searchModulesRanked(e1bGraph, "widget interface implementation");
  const explicitOff = searchModulesRanked(e1bGraph, "widget interface implementation", { beamSearch: false });
  assert.deepEqual(off, explicitOff);
});

const beamPayload = {
  individuals: [
    { id: "mod:a.py", class: "Module", label: "a.py" },
    { id: "fn:a.py#Alpha", class: "Class", label: "Alpha" },
    { id: "mod:b.py", class: "Module", label: "b.py" }, // ply-1 successor of a.py via imports
    { id: "fn:b.py#Beta", class: "Class", label: "Beta" },
    { id: "mod:c.py", class: "Module", label: "c.py" }, // ply-2 successor of b.py via calls
    { id: "fn:c.py#Gamma", class: "Class", label: "Gamma" },
    { id: "mod:d.py", class: "Module", label: "d.py" }, // unrelated — never reached, never boosted
    { id: "fn:d.py#Delta", class: "Class", label: "Delta" },
  ],
  objectProperties: [
    { predicate: "defines", examples: [
      { subject: "mod:a.py", object: "fn:a.py#Alpha", objectLabel: "Alpha" },
      { subject: "mod:b.py", object: "fn:b.py#Beta", objectLabel: "Beta" },
      { subject: "mod:c.py", object: "fn:c.py#Gamma", objectLabel: "Gamma" },
      { subject: "mod:d.py", object: "fn:d.py#Delta", objectLabel: "Delta" },
    ] },
    { predicate: "imports", examples: [
      { subject: "mod:a.py", object: "mod:b.py", subjectLabel: "a.py", objectLabel: "b.py" },
    ] },
    { predicate: "calls", examples: [
      { subject: "fn:b.py#Beta", object: "fn:c.py#Gamma", subjectLabel: "Beta", objectLabel: "Gamma" },
    ] },
  ],
};
const beamGraph = parseEntities(beamPayload);

test("beamSearch: multi-ply propagation — a ply-2 successor (reached only via b.py) is boosted; an unrelated module is not", () => {
  // Query matches a.py (Alpha, strong) and weakly matches b.py/c.py via a shared generic token so
  // they all start in `scored`, then the beam should propagate a.py's strength outward.
  const q = "alpha beta gamma delta module";
  const off = searchModulesRanked(beamGraph, q);
  const on = searchModulesRanked(beamGraph, q, { beamSearch: true, beamWidth: 8 });
  const scoreOf = (list, p) => list.find((r) => r.path === p)?.score ?? 0;
  assert.ok(scoreOf(on, "b.py") >= scoreOf(off, "b.py"), "ply-1 successor (imports) is boosted or unchanged");
  assert.ok(scoreOf(on, "c.py") >= scoreOf(off, "c.py"), "ply-2 successor (calls, reached only via b.py) is boosted or unchanged");
  assert.equal(scoreOf(on, "d.py"), scoreOf(off, "d.py"), "an unreachable module is never boosted — only already-matched modules can be re-ranked");
});

test("beamSearch: never boosts a module with zero lexical match (safety scope — only re-ranks `scored` candidates)", () => {
  // d.py never matches any query token, so it must never appear boosted regardless of graph topology.
  const q = "alpha";
  const on = searchModulesRanked(beamGraph, q, { beamSearch: true, beamWidth: 13 });
  assert.equal(on.find((r) => r.path === "d.py"), undefined, "d.py never lexically matched, so it's absent from the ranked list even with beam search on");
});

test("beamSearch: beamWidth defaults to 8 when beamSearch is on but beamWidth is omitted", () => {
  const q = "alpha beta gamma delta module";
  const implicitWidth = searchModulesRanked(beamGraph, q, { beamSearch: true });
  const explicitWidth8 = searchModulesRanked(beamGraph, q, { beamSearch: true, beamWidth: 8 });
  assert.deepEqual(implicitWidth, explicitWidth8);
});

test("beamSearch: an invalid beamWidth (0, negative, non-finite) falls back to the default 8, never throws", () => {
  const q = "alpha beta gamma delta module";
  for (const bad of [0, -1, NaN, undefined]) {
    assert.doesNotThrow(() => searchModulesRanked(beamGraph, q, { beamSearch: true, beamWidth: bad }));
  }
});

// ── PLAN_VIZ.md §2/§3: derivedUpdatedAt / mostRecentIndividual / spiralExpand generalization ──

test("derivedUpdatedAt: own updatedAt/createdAt attribute, or the max edge createdAt touching the node, whichever is newer; tolerates missing timestamps; \"\" when nothing carries one", () => {
  const g = parseEntities({
    individuals: [
      { id: "a", label: "a", class: "Thing", attributes: [{ prop: CREATED_AT_PROP, key: "createdAt", value: "2026-01-01T00:00:00.000Z" }] },
      { id: "b", label: "b", class: "Thing", attributes: [
        { prop: CREATED_AT_PROP, key: "createdAt", value: "2026-01-01T00:00:00.000Z" },
        { prop: UPDATED_AT_PROP, key: "updatedAt", value: "2026-01-05T00:00:00.000Z" },
      ] },
      { id: "c", label: "c", class: "Thing", attributes: [] }, // no timestamp at all, no edges either
      { id: "d", label: "d", class: "Thing", attributes: [{ prop: CREATED_AT_PROP, key: "createdAt", value: "2026-01-01T00:00:00.000Z" }] },
    ],
    objectProperties: [
      // endpoints ("src:dummy"/"session:dummy") deliberately don't resolve to a real individual —
      // derivedUpdatedAt only reads e.subject/e.object as plain ids, never dereferences them —
      // and are each used by only ONE edge, so "b"'s own-attribute case stays uncontaminated by
      // any edge (it carries zero edges of its own in this fixture).
      { predicate: "statedBy", prop: "mgx:statedBy", count: 1, examples: [
        { subject: "d", object: "src:dummy", createdAt: "2026-01-10T00:00:00.000Z" }, // newer than d's own createdAt
      ] },
      { predicate: "saidInSession", prop: "mgx:saidInSession", count: 1, examples: [
        { subject: "a", object: "session:dummy" }, // NO createdAt field at all — must be tolerated, not thrown on
      ] },
    ],
  });
  const byId = (id) => g.individuals.find((i) => i.id === id);

  assert.equal(derivedUpdatedAt(g, byId("c")), "", "no own timestamp and no edges at all -> \"\"");
  assert.equal(derivedUpdatedAt(g, byId("b")), "2026-01-05T00:00:00.000Z", "own mgx:updatedAt wins when it's the newest signal");
  assert.equal(derivedUpdatedAt(g, byId("d")), "2026-01-10T00:00:00.000Z", "a newer edge createdAt beats the node's own (older) createdAt");
  assert.equal(derivedUpdatedAt(g, byId("a")), "2026-01-01T00:00:00.000Z", "an edge touching the node with NO createdAt field is skipped, never thrown on — falls back to its own createdAt");
  assert.equal(derivedUpdatedAt(g, null), "", "null individual -> \"\"");
});

test("mostRecentIndividual: most recent createdAt wins; ties break by id (lowest wins); missing attribute never wins; empty graph -> null", () => {
  const g = parseEntities({
    individuals: [
      { id: "z", label: "z", class: "Thing", attributes: [{ prop: CREATED_AT_PROP, key: "createdAt", value: "2026-01-01T00:00:00.000Z" }] },
      { id: "b", label: "b", class: "Thing", attributes: [{ prop: CREATED_AT_PROP, key: "createdAt", value: "2026-01-05T00:00:00.000Z" }] },
      { id: "a", label: "a", class: "Thing", attributes: [{ prop: CREATED_AT_PROP, key: "createdAt", value: "2026-01-05T00:00:00.000Z" }] }, // tied with b, id "a" < "b"
      { id: "c", label: "c", class: "Thing", attributes: [] }, // no createdAt at all — never wins
    ],
    objectProperties: [],
  });
  assert.equal(mostRecentIndividual(g).id, "a", "the most recent createdAt wins, tie broken to the lower id (a < b)");
  assert.equal(mostRecentIndividual(parseEntities({ individuals: [], objectProperties: [] })), null, "empty graph -> null");
  const noTimestamps = parseEntities({ individuals: [{ id: "x", label: "x", class: "Thing", attributes: [] }], objectProperties: [] });
  assert.equal(mostRecentIndividual(noTimestamps), null, "no individual carries the attribute -> null");
});

test("spiralExpand walks the MEMORY graph (kinds=MEMORY_SPIRAL_EXPAND_KINDS, idNormalizer=(id)=>id, classPredicate=()=>true): a single Utterance seed reaches its Session (saidInSession), its canonicalised Fact, and that Fact's Source (statedBy)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-spiral-"));
  try {
    const SESSION = "01890000-0000-7000-8000-0000000000ee";
    const TS = "2026-07-11T10:00:00.000Z";
    const { id: uttId } = await appendUtterance(dir, {
      role: "visitor", text: "what colour is the sky?", ts: TS, sessionId: SESSION, sessionStarted: TS,
    });
    const { id: factId } = await appendFact(dir, {
      subject: "sky", predicate: "mgx:hasProperty", object: "blue", provenance: "corpus:conceptnet /r/HasProperty",
    });

    const m = await loadMemory(dir);
    const sourceInd = m.individuals.find((i) => i.class === "Source");
    assert.ok(sourceInd, "fixture sanity: a Source individual was derived from the fact's provenance");
    // Simulate memory/fold.mjs's addCanonicalisedFromEdges (Fact → Utterance) — out of this
    // agent's assigned files (src/memory/fold.mjs), so injected directly here in the exact shape
    // that function produces, rather than driving the whole session-fold pipeline just to prove
    // spiralExpand's OWN traversal mechanics work over the real edge inventory.
    m.objectProperties.push({
      predicate: "canonicalisedFrom", prop: "mgx:canonicalisedFrom", count: 1,
      examples: [{ subject: factId, object: uttId, subjectLabel: "sky mgx:hasProperty blue", objectLabel: "what colour is the sky?" }],
    });

    const g = parseEntities(m);
    const sessId = `session:${SESSION}`;
    assert.ok(g.byId.has(uttId) && g.byId.has(factId) && g.byId.has(sessId) && g.byId.has(sourceInd.id), "fixture sanity: every individual exists");

    const results = spiralExpand(g, [], {
      // q: 1 (no hub pruning) — the utterance's hop-1 frontier is only 2 wide (Session + Fact) in
      // this tiny fixture, and the default SPIRAL_Q_DEFAULT (0.9) would quantile-gate one of them
      // away (floor(0.9 * 2) === 1); this test is about reachability, not the hub gate.
      kinds: MEMORY_SPIRAL_EXPAND_KINDS, idNormalizer: (id) => id, classPredicate: () => true,
      seeds: [uttId], depth: 3, nodeLimit: 10, q: 1,
    });
    const byNodeId = new Map(results.map((r) => [r.id, r.hop]));

    assert.equal(byNodeId.get(uttId), 0, "the seed itself is included, at hop 0");
    assert.equal(byNodeId.get(sessId), 1, "the Session is reached one hop away via saidInSession");
    assert.equal(byNodeId.get(factId), 1, "the Fact is reached one hop away via canonicalisedFrom");
    assert.equal(byNodeId.get(sourceInd.id), 2, "the Source is reached two hops away via statedBy (Utterance -> Fact -> Source)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── PLAN_VIZ_MEMORY.md Bug 2 fix: deriveFactTermGraph + the dual walk-kind behavior ──

/** A reified Fact individual, exactly memory/core.mjs's appendFact shape —
 *  built by hand (no memory dir / fs) so these are pure, synchronous tests. */
function factInd(id, subject, predicate, object, provenance) {
  return {
    id, label: `${subject} ${predicate} ${object}`, class: "Fact",
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: subject },
      { prop: "rdf:predicate", key: "predicate", value: predicate },
      { prop: "rdf:object", key: "object", value: object },
      ...(provenance ? [{ prop: "mgx:factProvenance", key: "provenance", value: provenance }] : []),
    ],
  };
}

test("deriveFactTermGraph: materializes one Term individual per distinct subject/object and one relation group per distinct predicate — no fixed vocabulary, any predicate classifies", () => {
  const g = parseEntities({
    individuals: [
      factInd("fact:1", "dog", "rdfs:subClassOf", "animal", "corpus:human"),
      factInd("fact:2", "dog", "mgx:hasA", "tail", "corpus:conceptnet /r/HasA"),
      factInd("fact:3", "dog", "mgx:capableOf", "bark", "corpus:conceptnet /r/CapableOf"),
      { id: "sess:1", label: "session", class: "Session", attributes: [] }, // a non-Fact individual: untouched
    ],
    objectProperties: [],
  });

  const { graph: augmented, factRelationKinds } = deriveFactTermGraph(g);
  assert.deepEqual(factRelationKinds.sort(), ["mgx:capableOf", "mgx:hasA", "rdfs:subClassOf"].sort(),
    "one kind per DISTINCT predicate actually present — dynamically discovered, no hardcoded vocabulary");

  const termIds = augmented.individuals.filter((i) => i.class === "Term").map((i) => i.id).sort();
  assert.deepEqual(termIds, ["term:animal", "term:bark", "term:dog", "term:tail"].sort(),
    "one Term per distinct normalized subject/object string, deduped (dog appears in all 3 facts, one Term)");
  assert.ok(augmented.byId.has("term:dog") && augmented.byId.get("term:dog").label === "dog");
  assert.ok(augmented.byId.has("sess:1"), "the original graph's own individuals are preserved unchanged");

  // The synthetic relation groups: Term -> Term (the real concept edge) plus the
  // two FIXED structural links (Fact -> its own subject/object Term) that make a
  // Fact-seeded walk able to reach the term graph at all.
  const bySubClass = augmented.relations.find((r) => r.predicate === "rdfs:subClassOf");
  assert.deepEqual(bySubClass.edges, [{ subject: "term:dog", object: "term:animal", subjectLabel: "dog", objectLabel: "animal" }]);
  const subjLinks = augmented.relations.find((r) => r.predicate === "factSubjectTerm");
  assert.equal(subjLinks.edges.length, 3, "one factSubjectTerm link per Fact");
  assert.ok(subjLinks.edges.some((e) => e.subject === "fact:1" && e.object === "term:dog"));
  const objLinks = augmented.relations.find((r) => r.predicate === "factObjectTerm");
  assert.ok(objLinks.edges.some((e) => e.subject === "fact:1" && e.object === "term:animal"));

  // relationKind's new "factrel:" branch self-classifies each synthetic group
  // to its raw predicate — the SAME string spiralExpand's `kinds` list uses.
  assert.equal(relationKind(bySubClass), "rdfs:subClassOf");
  assert.equal(relationKind(subjLinks), "factSubjectTerm");
  assert.equal(relationKind(objLinks), "factObjectTerm");
  assert.deepEqual(MEMORY_FACT_LINK_KINDS, ["factSubjectTerm", "factObjectTerm"]);

  // A no-op on a graph with no Fact individuals at all (safe on a code graph too).
  const codeGraph = parseEntities({ individuals: [{ id: "mod:a", label: "a.mjs", class: "Module", attributes: [] }], objectProperties: [] });
  const noop = deriveFactTermGraph(codeGraph);
  assert.equal(noop.graph, codeGraph, "same graph object back, unchanged");
  assert.deepEqual(noop.factRelationKinds, []);
});

test("Bug 2 fix: a walk over BOTH kind sets (meta + relation, the default) reaches a real concept-relation edge a meta-only walk cannot; the meta-only toggle still reproduces today's exact provenance-only view", () => {
  const g = parseEntities({
    individuals: [
      factInd("fact:1", "dog", "rdfs:subClassOf", "animal"),
      factInd("fact:2", "dog", "mgx:hasA", "tail"),
    ],
    objectProperties: [],
  });
  const { graph: augmented, factRelationKinds } = deriveFactTermGraph(g);

  // meta-only (MEMORY_SPIRAL_EXPAND_KINDS alone, unchanged from before this fix):
  // seeded on the Fact itself, the walk can reach NOTHING ELSE at all — a Fact
  // has zero saidInSession/inReplyTo/statedBy/canonicalisedFrom edges of its own
  // in this fixture, so it stays alone; today's exact byte-identical behavior.
  const metaOnly = spiralExpand(augmented, [], {
    kinds: MEMORY_SPIRAL_EXPAND_KINDS, idNormalizer: (id) => id, classPredicate: () => true,
    seeds: ["fact:1"], depth: 3, nodeLimit: 50,
  });
  assert.deepEqual(metaOnly.map((r) => r.id), ["fact:1"], "meta-only walk from a Fact reaches nothing — the pre-Bug-2 gap");

  // both (the new default): the SAME seed now reaches its own subject/object
  // Terms (via the factSubjectTerm/factObjectTerm links) AND, from "dog", the
  // OTHER fact's relation too — a real concept-relation edge, structurally
  // invisible before this fix.
  const both = spiralExpand(augmented, [], {
    kinds: [...MEMORY_SPIRAL_EXPAND_KINDS, ...factRelationKinds, ...MEMORY_FACT_LINK_KINDS],
    idNormalizer: (id) => id, classPredicate: () => true,
    seeds: ["fact:1"], depth: 3, nodeLimit: 50, q: 1,
  });
  const reached = new Set(both.map((r) => r.id));
  assert.ok(reached.has("term:dog"), "reaches the Fact's own subject Term");
  assert.ok(reached.has("term:animal"), "reaches the Fact's own object Term");
  assert.ok(reached.has("fact:2"), "reaches the OTHER fact via the shared \"dog\" term — a real concept-relation edge");
  assert.ok(reached.has("term:tail"), "reaches that other fact's object Term too — the concept neighbourhood, not just one fact");

  // relation-only isolates the concept view: the Fact -> Term links are relation
  // kinds too (needed for reachability at all), so the seed Fact and its own
  // terms are still reached, but nothing PROVENANCE-shaped would be (none exists
  // in this fixture to begin with, so this mirrors the "both" reachable set here
  // — the meaningful contrast already lives in the meta-only case above).
  const relationOnly = spiralExpand(augmented, [], {
    kinds: [...factRelationKinds, ...MEMORY_FACT_LINK_KINDS],
    idNormalizer: (id) => id, classPredicate: () => true,
    seeds: ["fact:1"], depth: 3, nodeLimit: 50, q: 1,
  });
  assert.ok(new Set(relationOnly.map((r) => r.id)).has("fact:2"), "relation-only walk also reaches the concept neighbourhood");
});

test("spiralExpand hubDegree: a node above the cap is still emitted (shown) but never expanded THROUGH; Infinity (default) is byte-identical to before this option existed", () => {
  // A star: hub connected to 5 leaves, each leaf also connected to its own tail node.
  // Seeded on a LEAF (not the hub) so the test isolates "the hub is reached, shown,
  // but its own fan-out is gated" from "a seed ON a hub can't expand at all" (the
  // separate, simpler case the next test covers).
  const edges = [];
  for (let i = 0; i < 5; i++) {
    edges.push({ subject: "hub", object: `leaf${i}`, subjectLabel: "hub", objectLabel: `leaf${i}` });
    edges.push({ subject: `leaf${i}`, object: `tail${i}`, subjectLabel: `leaf${i}`, objectLabel: `tail${i}` });
  }
  const individuals = [{ id: "hub", label: "hub", class: "Thing", attributes: [] }];
  for (let i = 0; i < 5; i++) {
    individuals.push({ id: `leaf${i}`, label: `leaf${i}`, class: "Thing", attributes: [] });
    individuals.push({ id: `tail${i}`, label: `tail${i}`, class: "Thing", attributes: [] });
  }
  // prop namespaced "factrel:" so relationKind's own dedicated branch self-classifies
  // this fixture's edges to kind "rel" — the SAME mechanism deriveFactTermGraph's
  // real synthetic groups use, exercised here on a plain synthetic graph.
  const g = parseEntities({
    individuals,
    objectProperties: [{ predicate: "rel", prop: "factrel:rel", count: edges.length, examples: edges }],
  });
  const opts = { kinds: ["rel"], idNormalizer: (id) => id, classPredicate: () => true, seeds: ["leaf0"], depth: 5, nodeLimit: 50, q: 1 };

  const uncapped = spiralExpand(g, [], opts);
  assert.equal(uncapped.length, 11, "no hub gate (default Infinity): reaches leaf0 + tail0 + hub + the other 4 leaves + their 4 tails");

  const capped = spiralExpand(g, [], { ...opts, hubDegree: 4 }); // hub has degree 5, above the cap
  const reachedIds = capped.map((r) => r.id);
  assert.deepEqual(reachedIds, ["leaf0", "tail0", "hub"],
    "the hub is still reached and shown (leaf0's own hop-1 neighbour, under leaf0's degree-2 cap-check, not the hub's) — but nothing beyond it: the hub's OWN fan-out to the other 4 leaves is gated, so they (and their tails) are never reached");
});

test("spiralExpand hubDegree: EXEMPTS the seed itself (hop 0) — a walk started directly on a hub still shows that hub's own immediate neighbourhood — but a hub reached MID-walk (hop > 0) still gates normally", () => {
  // seeded ON hub0 (degree 5, above the cap): its own 5 immediate neighbours
  // (leafA..E) ARE reached (the seed-exemption). leafA is ALSO a hub (10 more
  // "sub" neighbours, degree 11) — reached at hop 1 > 0, so ITS fan-out IS
  // gated: none of leafA's own "sub" nodes are reached.
  const edges = [];
  ["leafA", "leafB", "leafC", "leafD", "leafE"].forEach((l) => edges.push({ subject: "hub0", object: l, subjectLabel: "hub0", objectLabel: l }));
  for (let i = 0; i < 10; i++) edges.push({ subject: "leafA", object: `sub${i}`, subjectLabel: "leafA", objectLabel: `sub${i}` });
  const individuals = [{ id: "hub0", label: "hub0", class: "Thing", attributes: [] }];
  ["leafA", "leafB", "leafC", "leafD", "leafE"].forEach((l) => individuals.push({ id: l, label: l, class: "Thing", attributes: [] }));
  for (let i = 0; i < 10; i++) individuals.push({ id: `sub${i}`, label: `sub${i}`, class: "Thing", attributes: [] });
  const g = parseEntities({
    individuals,
    objectProperties: [{ predicate: "rel", prop: "factrel:rel", count: edges.length, examples: edges }],
  });
  const capped = spiralExpand(g, [], {
    kinds: ["rel"], idNormalizer: (id) => id, classPredicate: () => true,
    seeds: ["hub0"], depth: 5, nodeLimit: 50, q: 1, hubDegree: 4, // hub0's degree (5) and leafA's (11) both exceed the cap
  });
  const reachedIds = new Set(capped.map((r) => r.id));
  assert.deepEqual(reachedIds, new Set(["hub0", "leafA", "leafB", "leafC", "leafD", "leafE"]),
    "the seed's own immediate neighbours are all reached (seed exemption), but none of leafA's OWN neighbours are — leafA is a hub reached at hop > 0, so its fan-out is still gated");
  for (let i = 0; i < 10; i++) assert.ok(!reachedIds.has(`sub${i}`), `sub${i} unreachable — gated by leafA's own hub cap`);
});

// ── PLAN_VIZ_MEMORY.md "Auto-picking the filter/legend dimension at generation time" ──

test("legendValueFor: class reads every node; predicate/provenance only ever return non-null for a Fact node", () => {
  const g = parseEntities({
    individuals: [factInd("fact:1", "dog", "mgx:hasA", "tail", "corpus:conceptnet /r/HasA")],
    objectProperties: [],
  });
  const factNode = { id: "fact:1", class: "Fact" };
  const sessNode = { id: "sess:1", class: "Session" };
  assert.equal(legendValueFor(g, factNode, "class"), "Fact");
  assert.equal(legendValueFor(g, sessNode, "class"), "Session");
  assert.equal(legendValueFor(g, factNode, "predicate"), "mgx:hasA");
  assert.equal(legendValueFor(g, sessNode, "predicate"), null, "a non-Fact node has no predicate of its own to bucket on");
  assert.equal(legendValueFor(g, factNode, "provenance"), "corpus:conceptnet", "the session-id/timestamp suffix is collapsed, corpus name kept");
  assert.equal(legendValueFor(g, sessNode, "provenance"), null);
});

test("pickLegendDimension: a hand-verifiable synthetic node set where `class` is 90% one bucket (disqualified as primary) and `predicate` splits evenly (wins)", () => {
  // 9 Facts, 3 each of 3 distinct predicates (perfectly even -> entropy 1.0), plus
  // 1 Session — class bucket = {Fact: 9, Session: 1} (90/10, entropy << 1).
  const facts = [];
  const predicates = ["rdfs:subClassOf", "mgx:hasA", "mgx:capableOf"];
  for (let i = 0; i < 9; i++) facts.push(factInd(`fact:${i}`, `s${i}`, predicates[i % 3], `o${i}`, "corpus:human"));
  const g = parseEntities({
    individuals: [...facts, { id: "sess:1", label: "session", class: "Session", attributes: [] }],
    objectProperties: [],
  });
  const nodes = [
    ...facts.map((f) => ({ id: f.id, class: "Fact" })),
    { id: "sess:1", class: "Session" },
  ];
  const result = pickLegendDimension(g, nodes);

  assert.equal(result.dimensions.class.buckets.length, 2);
  assert.ok(result.dimensions.class.score < 0.5, `class split should score low (one dominant bucket) — got ${result.dimensions.class.score}`);

  assert.equal(result.dimensions.predicate.buckets.length, 3);
  assert.equal(result.dimensions.predicate.score, 1, "a perfectly even 3/3/3 split scores maximum normalized entropy");

  // provenance: all 9 facts share ONE provenance ("corpus:human") -> k=1 -> disqualified (k < 2).
  assert.equal(result.dimensions.provenance.buckets.length, 1);
  assert.equal(result.dimensions.provenance.qualifies, false, "a single-bucket dimension never qualifies (k < 2)");

  assert.equal(result.primary, "predicate", "predicate's perfect-entropy split beats class's 90/10 skew as the auto-picked PRIMARY legend");
});

test("pickLegendDimension: a dimension with > 20 buckets collapses to top-15 + \"Other\" before scoring, never simply disqualifies on cardinality alone", () => {
  const facts = [];
  for (let i = 0; i < 25; i++) facts.push(factInd(`fact:${i}`, `s${i}`, `mgx:pred${i}`, `o${i}`)); // 25 distinct predicates
  const g = parseEntities({ individuals: facts, objectProperties: [] });
  const nodes = facts.map((f) => ({ id: f.id, class: "Fact" }));
  const result = pickLegendDimension(g, nodes);
  assert.ok(result.dimensions.predicate.buckets.length <= 20, "collapsed to at most 20 buckets (top 15 + Other)");
  assert.ok(result.dimensions.predicate.buckets.some((b) => b.value === "Other"), "the collapsed remainder is labeled Other");
  assert.equal(result.dimensions.predicate.qualifies, true, "post-collapse bucket count (<=20) qualifies");
});

test("pickLegendDimension: falls back to \"class\" when nothing qualifies (a tiny 1-node walk), never an empty/undefined primary", () => {
  const g = parseEntities({ individuals: [factInd("fact:1", "a", "mgx:hasA", "b")], objectProperties: [] });
  const result = pickLegendDimension(g, [{ id: "fact:1", class: "Fact" }]);
  assert.equal(result.primary, "class", "a single node's class bucket (k=1) is itself disqualified, but the fallback is still class, never left undefined");
});

test("buildVizNodesAndEdges renders deriveFactTermGraph's synthetic edges byte-identically to any other relation group (no special-casing needed — plan's own claim, re-verified)", () => {
  const g = parseEntities({
    individuals: [factInd("fact:1", "dog", "rdfs:subClassOf", "animal")],
    objectProperties: [],
  });
  const { graph: augmented } = deriveFactTermGraph(g);
  const walked = [{ id: "fact:1", hop: 0 }, { id: "term:dog", hop: 1 }, { id: "term:animal", hop: 1 }];
  const { nodes, edges } = buildVizNodesAndEdges(augmented, walked);
  assert.equal(nodes.length, 3);
  assert.ok(nodes.find((n) => n.id === "term:dog" && n.class === "Term" && n.label === "dog"));
  assert.ok(edges.find((e) => e.source === "term:dog" && e.target === "term:animal" && e.kind === "rdfs:subClassOf"));
  assert.ok(edges.find((e) => e.source === "fact:1" && e.target === "term:dog" && e.kind === "factSubjectTerm"));
});
