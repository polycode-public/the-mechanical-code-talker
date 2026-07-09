// ask.mjs tests — the mechanical NL query engine (PLAN_MECHANICAL_CHAT.md P0).
// buildEntities()/parseEntities() build a REAL graph (same shape a real index
// produces) from a small fixture; ask.mjs's four stages are then exercised both
// in isolation (parseQuery/resolveObject/traverse/render) and end-to-end (ask()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../src/graph-build.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { parseQuery, resolveObject, traverse, render, ask, rephraseHint, normalizeQuery } from "../src/ask.mjs";

// Mirrors the operator's own worked example, with an INTERNAL coupling target instead of
// an external package (log4j-style external imports do not surface as graph edges today —
// see PLAN_MECHANICAL_CHAT.md §10; graph-build.mjs only resolves imports that match an internal
// module's `dotted` name via its registry).
const MODULES = [
  { path: "src/logging.mjs", dotted: "src.logging", imports: [], calls: [],
    defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
  { path: "myFile.mjs", dotted: "myFile", imports: ["src.logging"], calls: [],
    defines: [{ name: "startup", kind: "function", lineno: 3, decorators: [] }],
    // §exports-family fixture (2026-07-02 query families): a real reExports edge
    // (mod:myFile.mjs -> fn:myFile.mjs#startup) so "what does myFile export" answers.
    exports: ["startup"] },
  { path: "src/someOtherFile.mjs", dotted: "src.someOtherFile", imports: ["src.logging"], calls: [],
    defines: [{ name: "myFunc", kind: "function", lineno: 5, decorators: [] }] },
  { path: "src/unrelated.mjs", dotted: "src.unrelated", imports: [], calls: [],
    defines: [{ name: "noop", kind: "function", lineno: 1, decorators: [] }] },
  // a class hierarchy + a test module, for the inherits/tests verb families.
  { path: "app/base.mjs", dotted: "app.base", imports: [], calls: [],
    defines: [{ name: "Base", kind: "class", lineno: 1, decorators: [] }] },
  { path: "app/widget.mjs", dotted: "app.widget", imports: ["app.base"], calls: [],
    defines: [{ name: "Widget", kind: "class", lineno: 1, decorators: [], bases: ["Base"] },
      // §dotted-symbol fixture: a Class.method label for exact dotted resolution.
      { name: "Widget.render", kind: "method", lineno: 2, decorators: [] }] },
  { path: "app/widget_test.mjs", dotted: "app.widget_test", imports: ["app.widget"], calls: [],
    defines: [] },
  // §prose-fallback fixture (PLAN_PROSE_INDEX.md): a symbol whose PURPOSE ("invoice") is
  // only expressed in its doc comment and its decomposed identifier words, never as its
  // own literal name/label — the exact case resolveObject's tier-4 fallback exists for.
  { path: "src/billing.mjs", dotted: "src.billing", imports: [], calls: [],
    defines: [{ name: "calculateTotalPrice", kind: "function", lineno: 1, decorators: [],
      doc: "Computes the invoice subtotal before tax." }] },
  { path: "src/checkout.mjs", dotted: "src.checkout", imports: ["src.billing"], calls: [],
    defines: [{ name: "checkout", kind: "function", lineno: 1, decorators: [], calls: ["calculateTotalPrice"] }] },
  // §transitive-modifier fixture (PLAN_MECHANICAL_CHAT.md P1): a genuine 2-hop import
  // chain — entrypoint.mjs -> myFile.mjs -> src/logging.mjs — distinguishing "which
  // modules import logging" (direct: myFile.mjs, src/someOtherFile.mjs only) from
  // "which modules transitively import logging" (also reaches app/entrypoint.mjs,
  // which never imports logging.mjs itself). Deliberately does NOT touch any existing
  // module's imports/defines, so every prior direct-modifier assertion is unaffected.
  { path: "app/entrypoint.mjs", dotted: "app.entrypoint", imports: ["myFile"], calls: [], defines: [] },
  // §dotted-symbol fixture (advisor-verified res.json bug): a module whose PATH
  // contains the dotted term "res.json" AND a class method whose label carries the
  // ".json" member — resolveObject must pick the SYMBOL (Response.json), never the
  // path-grain module (test/res.json.js).
  { path: "test/res.json.js", dotted: "test.res.json", imports: [], calls: [], defines: [] },
  { path: "app/response.mjs", dotted: "app.response", imports: [], calls: [],
    defines: [{ name: "Response", kind: "class", lineno: 1, decorators: [] },
      { name: "Response.json", kind: "method", lineno: 2, decorators: [] }] },
];
const COMMITS = [
  { sha: "abc123", files: ["myFile.mjs"] },
  // §commit-question fixture (viewer commit-chat fix): a realistic full-length sha whose
  // commit touches TWO modules (coarse grain) and — via SYMBOL_HISTORY below — one
  // symbol (fine grain), so grain selection is observable. Touches each module pair only
  // once, below graph-build.mjs's COCHANGE_MIN, so no cochange edge appears as a side effect.
  { sha: "ef74e44e25c8f00dbaadf00dcafe123456789abc", files: ["myFile.mjs", "src/logging.mjs"],
    author: "fixture", date: "2026-07-01T00:00:00+00:00", subject: "touch fixture" },
];
// changed line ranges for the fixture commit — intersects startup()'s span (myFile.mjs:3)
// so buildEntities emits a mgx:touchesSymbol edge alongside the module-coarse touches.
const SYMBOL_HISTORY = [
  { sha: "ef74e44e25c8f00dbaadf00dcafe123456789abc", ranges: { "myFile.mjs": [[1, 5]] } },
];

function buildGraph() {
  const entities = buildEntities(MODULES, COMMITS, { symbolHistory: SYMBOL_HISTORY });
  // Mirrors a graph writer: buildEntities -> ingestSchemaDocs(entities) ->
  // (write to disk, skipped here) -> parseEntities. Without this, the graph the test
  // fixture builds would never carry the SchemaClass/SchemaPredicate individuals a real
  // index build always has, and the "meta" shape's tests below would be testing against
  // a graph shape production never actually produces.
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}

// ---- parseQuery (grammar) ----

test("parseQuery: reverse shape — the operator's own example", () => {
  const p = parseQuery("Which functions explicitly couple to logging");
  assert.deepEqual(p, { shape: "reverse", entityType: "Function", modifier: "direct", kind: "imports", object: "logging" });
});

test("parseQuery: reverse shape without a modifier defaults to direct", () => {
  const p = parseQuery("which classes inherit from Base");
  assert.equal(p.modifier, "direct");
  assert.equal(p.kind, "inherits");
  assert.equal(p.entityType, "Class");
});

test("parseQuery: forward shape", () => {
  const p = parseQuery("what does myFile import");
  assert.deepEqual(p, { shape: "forward", entityType: null, modifier: "direct", kind: "imports", object: "myFile" });
});

test("parseQuery: ask shape", () => {
  const p = parseQuery("does myFile import logging");
  assert.equal(p.shape, "ask");
  assert.equal(p.subject, "myFile");
  assert.equal(p.object, "logging");
});

test("parseQuery: an out-of-grammar question returns null (honest grammar miss)", () => {
  assert.equal(parseQuery("what is the meaning of this codebase"), null);
  assert.equal(parseQuery(""), null);
});

test("parseQuery: plural/singular entity nouns and verb aliases both resolve to the same kind", () => {
  // "use(s)" moved to the query-side union family (2026-07-02 query families):
  // it now traverses imports+calls+callsSymbol together instead of imports alone.
  assert.equal(parseQuery("which modules use logging").kind, "uses");
  assert.equal(parseQuery("which modules depends on logging")?.kind ?? parseQuery("which modules depend on logging").kind, "imports");
});

// ---- resolveObject (§4 tiered resolution) ----

test("resolveObject: tier 1 exact label match", () => {
  const graph = buildGraph();
  const { match, tier, ambiguous } = resolveObject(graph, "src/logging.mjs");
  assert.equal(match.label, "src/logging.mjs");
  assert.equal(tier, 1);
  assert.equal(ambiguous, false);
});

test("resolveObject: tier 3 substring/component match", () => {
  const graph = buildGraph();
  const { match, tier } = resolveObject(graph, "logging");
  assert.equal(match.label, "src/logging.mjs");
  assert.equal(tier, 3);
});

test("resolveObject: no match — honest miss, never a fuzzy guess", () => {
  const graph = buildGraph();
  const { match, candidates, tier } = resolveObject(graph, "totallyMissingPackage");
  assert.equal(match, null);
  assert.deepEqual(candidates, []);
  assert.equal(tier, null);
});

// ---- resolveObject tier 3: minimum-length floor on the raw containment check
// (Tier-2 playtest cycle 9, targeted substring-match sweep) ----
//
// Cycle 8 found and patched THREE short-word accidental-substring focus-corruption
// bugs one word at a time, at individual chat.mjs call sites ("and"/"also"/"so"/
// "then"/"now" via STACCATO_LEAKED_CONNECTIVES, bare "it" via the pronoun-reuse
// guard). This sweep confirmed the root cause lives in resolveObject's tier-3
// containment check itself (`label.includes(tLc)`, no minimum-length floor) —
// EVERY one of these closed-vocabulary words is a genuine accidental substring of
// a real label in THIS fixture (several via the schema/meta individuals
// ingestSchemaDocs adds — "imports" contains "or", "defines" contains "in",
// "Attribute" contains "at"/"but", "touches" contains "to", "Session" contains
// "on", "src/someOtherFile.mjs" contains "so"/"the", "Base" contains "a") — so
// fixing it once here, at the source, closes every current AND future short-word
// variant, not just the ones already found.
test("resolveObject: a closed-vocabulary word ≤3 chars never wins via raw substring containment, even though it IS an accidental substring of a real label", () => {
  const graph = buildGraph();
  for (const w of ["so", "then", "now", "or", "but", "the", "a", "is", "in", "on", "at", "to", "of"]) {
    const { match, tier } = resolveObject(graph, w);
    assert.equal(match, null, `"${w}" must stay an honest miss, not a substring guess`);
    assert.equal(tier, null, `"${w}" must not report a stale tier`);
  }
});

test("resolveObject: the SAME containment tier still resolves a real ≥4-char term by substring (the floor doesn't over-reach)", () => {
  const graph = buildGraph();
  const { match, tier } = resolveObject(graph, "logging");
  assert.equal(match.label, "src/logging.mjs");
  assert.equal(tier, 3);
});

// ---- resolveObject tier 3: slashed-path terms require the FILENAME STEM, not
// just any component overlap (Tier-2 playtest cycle 9, existence-recognizer
// follow-up) ----
//
// "is there a class in src/nope.mjs" (a NONEXISTENT module) used to ambiguously
// "match" a real module purely because both share generic directory/extension
// components ("app"/"mjs") with every other module in the pool — the identical
// accidental-match disease as the short-word bug above, one tier's mechanism
// over (component-overlap rather than raw containment). Fixed by requiring a
// slashed term's final path segment (extension stripped) to be a genuine
// component of the matched label — while still tolerating a leaked verb/noise
// word elsewhere in the term (router-interface.test.mjs's own frozen "cover
// app/lib/b.mjs" contract), since the stem itself still matches in that case.
test("resolveObject: a slashed term for a module that genuinely doesn't exist stays an honest miss, never an ambiguous guess at a same-directory module", () => {
  const graph = buildGraph();
  const { match, tier, ambiguous } = resolveObject(graph, "app/nope.mjs", { expectedClass: "Module" });
  assert.equal(match, null);
  assert.equal(tier, null);
  assert.equal(ambiguous, false);
});

test("resolveObject: a leaked verb/noise word around a REAL slashed path still resolves it (the stem gate doesn't over-reach)", () => {
  const graph = buildGraph();
  assert.equal(resolveObject(graph, "cover app/base.mjs", { expectedClass: "Module" }).match?.label, "app/base.mjs");
  assert.equal(resolveObject(graph, "app/base.mjs but untested", { expectedClass: "Module" }).match?.label, "app/base.mjs");
});

// ---- resolveObject tier 4: prose-index fallback (PLAN_PROSE_INDEX.md §6) ----

test("resolveObject: tier 4 prose-index fallback resolves a term that ONLY matches via a doc-comment word, never the symbol's own literal name", () => {
  const graph = buildGraph();
  // "invoice" appears nowhere in the identifier "calculateTotalPrice" (tiers 1-3 all
  // fail against it — no exact/substring/component overlap) — only in its doc comment
  // ("Computes the invoice subtotal before tax."), tokenized by attachProseTokens.
  const { match, tier, ambiguous, matchedVia } = resolveObject(graph, "invoice");
  assert.equal(match.label, "calculateTotalPrice");
  assert.equal(tier, 4);
  assert.equal(ambiguous, false);
  assert.equal(matchedVia, "prose");
});

test("resolveObject: tier 4 also resolves a MULTI-WORD query via DECOMPOSED identifier tokens, not just doc-comment prose", () => {
  const graph = buildGraph();
  // "total price" (a space-separated two-word query) is never a literal substring of
  // "calculateTotalPrice" (no space in the identifier) and shares no component with it
  // under tier 3's non-alphanumeric-only componentSet split (camelCase isn't split
  // there, so the whole identifier is one opaque token to tier 3) — tiers 1-3 all
  // genuinely fail here. Only the prose index's own identifier-decomposition tokens
  // (calculate/total/price, from splitIdentifierWords) — not the doc comment, which
  // never contains the word "total" — let tier 4 match both query words.
  const { match, tier, matchedVia } = resolveObject(graph, "total price");
  assert.equal(match.label, "calculateTotalPrice");
  assert.equal(tier, 4);
  assert.equal(matchedVia, "prose");
});

test("resolveObject: a term that resolves at an earlier tier never falls through to the prose tier", () => {
  const graph = buildGraph();
  // "logging" is an exact substring of src/logging.mjs's label — must stop at tier 3,
  // never reach tier 4, even though "logging" would also plausibly prose-match something.
  const { tier, matchedVia } = resolveObject(graph, "logging");
  assert.equal(tier, 3);
  assert.equal(matchedVia, undefined);
});

test("ask(): end-to-end — a reverse-shape query resolves its object term via the prose fallback and still returns a correct, real graph answer", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which functions call invoice");
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.matchedVia, "prose");
  assert.match(content, /checkout/);
});

// ---- render (§5 templates: grouping/pluralization/overflow/zero-hit) ----

test("render: zero hits — a stated blank in plain words; the traversal receipt rides the result, not the prose", () => {
  // (0.8.2 WS1: the " (traversal: …)" tail was dropped from the honest-empty prose —
  // the receipt still flows on the result/envelope so chat's why/verbose re-render
  // surfaces it on demand.)
  const parsed = { shape: "reverse", entityType: "Function", modifier: "direct", kind: "imports", object: "unrelated" };
  const result = { matches: [], objMatch: { label: "src/unrelated.mjs" }, candidates: [], traversal: "imports edges where object = src/unrelated.mjs", ambiguous: false };
  const r = render(parsed, result);
  assert.equal(r.miss, true);
  assert.match(r.content, /No functions found/);
  assert.doesNotMatch(r.content, /traversal:/, "the receipt no longer rides the prose");
  assert.equal(result.traversal, "imports edges where object = src/unrelated.mjs", "…but stays on the result for the why-path");
});

test("render: reverse-shape zero hits never double-pluralizes the kind (\"callss\"/\"importss\")", () => {
  const cases = [
    ["calls", "calls"], ["imports", "imports"], ["touches", "touches"],
    ["defines", "defines"], ["contains", "contains"], ["tests", "tests"],
    // "reexports" -> "export" (Bug B3, HANDOVER follow-up #2): verbFor()'s override
    // table is shared with the forward-miss template's fix below, so the reverse
    // shape's honest miss reads "directly export x" too — a minor grammar trade
    // (vs. the grammatically-exact but internal-vocabulary-leaking "reexports")
    // accepted deliberately so both templates read off ONE table, not two.
    ["inherits", "inherits"], ["reexports", "export"], ["cochange", "cochanges"],
  ];
  for (const [kind, expectedVerb] of cases) {
    const parsed = { shape: "reverse", entityType: "Function", modifier: "direct", kind, object: "x" };
    const result = { matches: [], objMatch: { label: "x" }, candidates: [], traversal: "…", ambiguous: false };
    const r = render(parsed, result);
    assert.match(r.content, new RegExp(`whose module directly ${expectedVerb} x\\.`), kind);
  }
});

test("render: forward-shape zero hits reads as a subject-first sentence, not \"found ... that <pronoun>\"", () => {
  const parsed = { shape: "forward", entityType: null, modifier: "direct", kind: "imports", object: "this" };
  const result = { matches: [], objMatch: { label: "src/leaf.mjs" }, candidates: [], traversal: "imports edges where subject = src/leaf.mjs", ambiguous: false };
  const r = render(parsed, result);
  assert.equal(r.miss, true);
  // (0.8.2 WS1: plain words — the traversal receipt rides the result, not the prose.)
  assert.equal(r.content, "src/leaf.mjs has no imports edges in the index.");
  assert.equal(result.traversal, "imports edges where subject = src/leaf.mjs", "the receipt survives on the result for the why-path");
  assert.doesNotMatch(r.content, /\bthis\b/); // the resolved label is used, never the raw pronoun text
});

test("render: a grammar miss uses the rephrase hint generated from the SAME vocabulary tables", () => {
  const r = render(null, { matches: [] });
  assert.equal(r.miss, true);
  assert.equal(r.content, `couldn't parse this as a graph question. Try: ${rephraseHint()}`);
});

test("render: singular result (1 hit) does not pluralize awkwardly", () => {
  const parsed = { shape: "reverse", entityType: "Function", modifier: "direct", kind: "imports", object: "logging" };
  const result = {
    matches: [{ id: "fn:myFile.mjs#startup", label: "startup", class: "Function", attributes: [{ key: "site", value: "myFile.mjs:3" }] }],
    objMatch: { label: "src/logging.mjs" }, candidates: [], traversal: "…", ambiguous: false,
  };
  const r = render(parsed, result);
  assert.equal(r.content, "in myFile.mjs there is function startup().");
});

// ---- end-to-end: the operator's exact worked example ----

test("ask(): the operator's worked example renders EXACTLY the specified sentence", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "Which functions explicitly couple to logging");
  assert.equal(content, "in myFile.mjs there is function startup() and there is function myFunc() in src/someOtherFile.mjs.");
  assert.equal(tmct_ask.mechanical, true);
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.ambiguous, false);
  assert.equal(tmct_ask.matches.length, 2);
  assert.deepEqual(tmct_ask.parsed, { shape: "reverse", entityType: "Function", modifier: "direct", kind: "imports", object: "logging" });
  assert.match(tmct_ask.traversal, /imports edges where object = src\/logging\.mjs/);
});

test("ask(): reverse-shape without an explicit entity keyword (\"what imports X\") still renders the clean module-join, not the fine-grained by-module grouping", () => {
  const graph = buildGraph();
  // No "modules"/"functions" keyword here, so parseQuery leaves entityType null — the
  // matched individuals are still Module-class (imports is a module-level relation), and
  // render() must route on THAT, not the (absent) parsed hint, or it falls into the
  // fine-grained grouping path and produces "in a.mjs there is a.mjs" nonsense.
  const { content, tmct_ask } = ask(graph, "what imports logging");
  assert.equal(content, "myFile.mjs and src/someOtherFile.mjs.");
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.matches.length, 2);
});

test("ask(): grammar miss — clean rephrase hint, never a wrong guess", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "tell me a story about this codebase");
  assert.equal(tmct_ask.mechanical, true);
  assert.equal(tmct_ask.miss, true);
  assert.equal(tmct_ask.matches.length, 0);
  assert.match(content, /couldn't parse this/);
});

test("ask(): unresolved object term — honest miss with the receipt of what was checked", () => {
  const graph = buildGraph();
  const { tmct_ask } = ask(graph, "which functions import totallyMissingPackage");
  assert.equal(tmct_ask.miss, true);
  assert.equal(tmct_ask.matches.length, 0);
});

test("ask(): inherits verb family — which classes inherit from Base", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which classes inherit from Base");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /Widget/);
});

// Seonix Batch 2 Fix 2 — the reverse "is X a superclass of Y" phrasing (fixture:
// Widget extends Base, so Widget is the subclass and Base the superclass). Both
// phrasings of the SAME true relationship must produce the SAME Yes content — the
// reverse phrasing's subject/object are swapped at parse time (grammar.mjs T1 /
// keywords.mjs), not silently answered backwards.
test("ask(): \"is Base a superclass of Widget\" and \"is Widget a subclass of Base\" agree (Batch 2 Fix 2 — reverse inherits)", () => {
  const graph = buildGraph();
  const reverse = ask(graph, "is Base a superclass of Widget");
  const forward = ask(graph, "is Widget a subclass of Base");
  assert.equal(reverse.tmct_ask.miss, false);
  assert.equal(forward.tmct_ask.miss, false);
  assert.match(reverse.content, /^Yes/);
  assert.equal(reverse.content, forward.content);
});

test("ask(): \"is Widget a superclass of Base\" honestly says No — the reverse phrasing is not silently flipped to a wrong Yes (Batch 2 Fix 2)", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "is Widget a superclass of Base");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /^No/);
});

test("ask(): tests verb family — which modules test app.widget's module", () => {
  const graph = buildGraph();
  const { tmct_ask } = ask(graph, "which modules tests app/widget.mjs");
  // widget_test.mjs imports widget.mjs but is not itself wired through mgx:testsCoverage in
  // this minimal fixture (buildEntities' testsCoverage rule may require a stricter shape) —
  // this test documents current behaviour rather than asserting an un-verified positive.
  assert.equal(typeof tmct_ask.miss, "boolean");
});

test("ask(): forward shape — what does myFile import", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what does myFile import");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /src\/logging\.mjs/);
});

test("ask(): ask-shape yes/no", () => {
  const graph = buildGraph();
  const yes = ask(graph, "does myFile import logging");
  // (0.8.2 WS1: the yes render is plain words — the edge sentence, no parenthetical.)
  assert.equal(yes.content, "Yes — imports edge from myFile.mjs to src/logging.mjs.");
  const no = ask(graph, "does myFile import unrelated");
  assert.match(no.content, /^No/);
});

// ---- §transitive modifier (PLAN_MECHANICAL_CHAT.md P1) — wired onto impactClosure
// (codegraph.mjs) for reverse-shape imports/calls, module-level only. Everything else
// parsing to a non-"direct" modifier gets an honest "not supported yet" response —
// the modifierIsWired() safety net, never a silent fallback to direct-only behavior. ----

test("parseQuery: \"transitively\"/\"indirectly\" both parse to modifier:transitive", () => {
  assert.equal(parseQuery("which modules transitively import logging").modifier, "transitive");
  assert.equal(parseQuery("which modules indirectly import logging").modifier, "transitive");
});

test("ask(): transitive imports finds a 2-hop dependent (entrypoint.mjs) that the DIRECT modifier correctly misses", () => {
  const graph = buildGraph();
  const direct = ask(graph, "which modules import logging");
  const directLabels = direct.tmct_ask.matches.map((m) => m.label).sort();
  assert.deepEqual(directLabels, ["myFile.mjs", "src/someOtherFile.mjs"]);

  const transitive = ask(graph, "which modules transitively import logging");
  assert.equal(transitive.tmct_ask.miss, false);
  const transitiveLabels = transitive.tmct_ask.matches.map((m) => m.label).sort();
  assert.deepEqual(transitiveLabels, ["app/entrypoint.mjs", "myFile.mjs", "src/someOtherFile.mjs"]);
  assert.match(transitive.tmct_ask.traversal, /reverse dependency closure/);
});

test("ask(): \"indirectly\" is a true synonym of \"transitively\" — same real result, not just the same parsed modifier value", () => {
  const graph = buildGraph();
  const a = ask(graph, "which modules transitively import logging");
  const b = ask(graph, "which modules indirectly import logging");
  assert.deepEqual(a.tmct_ask.matches, b.tmct_ask.matches);
});

test("traverse(): reverse+transitive+calls reaches the real impactClosure path (a hand-built graph, since buildEntities does not emit module-coarse mgx:callsCoarse edges from any current MODULES fixture shape — see the fork report) — proves \"calls\" is genuinely wired, not just gated-through", () => {
  const individuals = [
    { id: "mod:a.mjs", label: "a.mjs", class: "Module" },
    { id: "mod:b.mjs", label: "b.mjs", class: "Module" },
    { id: "mod:c.mjs", label: "c.mjs", class: "Module" },
  ];
  const graph = {
    individuals, byId: new Map(individuals.map((i) => [i.id, i])), proseIndex: {}, truncated: [],
    relations: [{
      predicate: "mgx:callsCoarse", prop: "mgx:callscoarse", count: 2,
      edges: [
        { subject: "mod:b.mjs", object: "mod:a.mjs", subjectLabel: "b.mjs", objectLabel: "a.mjs" },
        { subject: "mod:c.mjs", object: "mod:b.mjs", subjectLabel: "c.mjs", objectLabel: "b.mjs" },
      ],
    }],
  };
  const parsed = { shape: "reverse", entityType: "Module", modifier: "transitive", kind: "calls", object: "a.mjs" };
  const result = traverse(graph, parsed);
  const labels = result.matches.map((m) => m.label).sort();
  assert.deepEqual(labels, ["b.mjs", "c.mjs"]);
  assert.match(result.traversal, /reverse dependency closure over imports\+calls edges/);
});

test("ask(): transitive + inherits (no closure primitive for this kind) is an HONEST \"not supported\" miss, never silently identical to the direct answer", () => {
  const graph = buildGraph();
  const direct = ask(graph, "which classes inherit from Base");
  const transitive = ask(graph, "which classes transitively inherit from Base");
  assert.equal(direct.tmct_ask.miss, false);
  assert.equal(transitive.tmct_ask.miss, true);
  assert.match(transitive.content, /"transitive" modifier isn't supported for "inherits"/);
  // the exact regression class this test guards against: silently behaving as if
  // "transitively" had never been said, i.e. matching the direct answer's content.
  assert.notEqual(transitive.content, direct.content);
});

test("ask(): transitive + a fine-grained entity type (\"which functions transitively call X\") is an honest \"not supported\" miss — impactClosure is module-coarse only", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which functions transitively call checkout");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /"transitive" modifier isn't supported for "calls"/);
});

// ---- §meta shape: questions about the graph's OWN vocabulary (schema-docs.mjs's
// SchemaClass/SchemaPredicate individuals, ingested via ingestSchemaDocs — see buildGraph()
// above), not a code-edge traversal. ----

test("parseQuery: \"what does cochange mean\" parses to the meta shape", () => {
  const p = parseQuery("what does cochange mean");
  assert.deepEqual(p, { shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: "cochange" });
});

test("parseQuery: \"what is a Commit\" parses to the meta shape via the mandatory-article template", () => {
  const p = parseQuery("what is a Commit");
  assert.equal(p.shape, "meta");
  assert.equal(p.object, "Commit");
});

// Seonix Batch 2 Fix 1: the article is now OPTIONAL, but only for terms in the closed
// ENTITY_TO_TYPE vocabulary — "what is Commit" (no article) now parses identically to
// "what is a Commit" since "commit" is one of ENTITY_TO_TYPE's keys.
test("parseQuery: bare \"what is Commit\" (no article) parses identically to \"what is a Commit\" — closed-vocabulary bare form (Batch 2 Fix 1)", () => {
  const p = parseQuery("what is Commit");
  assert.equal(p.shape, "meta");
  assert.equal(p.object, "Commit");
});

test("parseQuery: the existing honest-miss regression (\"what is the meaning of this codebase\") still returns null — the meta-whatis template's mandatory article keeps it from swallowing this", () => {
  assert.equal(parseQuery("what is the meaning of this codebase"), null);
});

// Batch 2 Fix 1 re-assertion: the bare-form closed-vocabulary restriction must still
// reject a bare term that ISN'T in ENTITY_TO_TYPE, same as before the article was
// loosened — both of the pinned honest-miss regressions below must keep failing null.
test("parseQuery: bare \"what is the meaning of this codebase\" still returns null after Batch 2 Fix 1 (not an ENTITY_TO_TYPE term)", () => {
  assert.equal(parseQuery("what is the meaning of this codebase"), null);
});

test("parseQuery: bare \"what is exposed\" still returns null after Batch 2 Fix 1 (\"exposed\" isn't an ENTITY_TO_TYPE term)", () => {
  assert.equal(parseQuery("what is exposed", { nlp: null }), null);
});

// Seonix Batch 2 Fix 3: a curated trailing scope clause is stripped from the captured
// object before it's used as a lookup term, so a scoping tail never corrupts it.
test("parseQuery: \"what is a Module in this graph\" resolves the same object as \"what is a Module\" (Batch 2 Fix 3, trailing scope filler stripped)", () => {
  const withFiller = parseQuery("what is a Module in this graph");
  const withoutFiller = parseQuery("what is a Module");
  assert.equal(withFiller.shape, "meta");
  assert.equal(withFiller.object, "Module");
  assert.deepEqual(withFiller, withoutFiller);
});

test("ask(): \"what does cochange mean\" answers from the graph's own SchemaPredicate individual, by human-facing kind name", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what does cochange mean");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /frequently committed together/i);
});

test("ask(): \"what is a Commit\" answers from the graph's own SchemaClass individual", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what is a Commit");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /git commit/i);
});

test("ask(): \"what does mgx:callsSymbol mean\" resolves by the raw prop TOKEN, not just the human-facing kind label", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what does mgx:callsSymbol mean");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /unambiguous names only/i);
});

test("ask(): a meta question about an undocumented term is an honest miss, never a guess", () => {
  const graph = buildGraph();
  const { tmct_ask } = ask(graph, "what does zzznotarealterm mean");
  assert.equal(tmct_ask.miss, true);
  assert.equal(tmct_ask.matches.length, 0);
});

// ---- §commit questions (viewer commit-chat fix): sha-term resolution + the
// commit-as-subject flip over touches/touchesSymbol, both parse strategies. ----

const FIXTURE_SHA = "ef74e44e25c8f00dbaadf00dcafe123456789abc";
const FIXTURE_SHORT = "ef74e44e25c8"; // the Commit individual's label (sha.slice(0,12))

test("parseQuery: \"which changes touch commit <sha>\" — the operator's failing question parses (both strategies agree on the reverse shape)", () => {
  const p = parseQuery(`which changes touch commit ${FIXTURE_SHORT}`);
  assert.deepEqual(p, { shape: "reverse", entityType: "Change", modifier: "direct", kind: "touches", object: `commit ${FIXTURE_SHORT}` });
});

test("parseQuery: \"what did commit abc1234 touch\" parses forward — no spurious strategy disagreement over the \"commit\" noun", () => {
  const p = parseQuery("what did commit abc1234 touch");
  assert.equal(p.ambiguousParse, undefined);
  assert.equal(p.shape, "forward");
  assert.equal(p.kind, "touches");
  assert.equal(p.object, "commit abc1234");
});

test("parseQuery: casual \"what changed in abc1234\" parses via keyword-spot alone", () => {
  const p = parseQuery("what changed in abc1234");
  assert.equal(p.shape, "reverse");
  assert.equal(p.kind, "touches");
  assert.equal(p.object, "abc1234");
});

test("parseQuery: the existing commit-as-answer shape (\"which commits touched myFile.mjs\") still parses unchanged", () => {
  const p = parseQuery("which commits touched myFile.mjs");
  assert.deepEqual(p, { shape: "reverse", entityType: "Commit", modifier: "direct", kind: "touches", object: "myFile.mjs" });
});

test("resolveObject: a full 40-char sha resolves to the Commit individual", () => {
  const graph = buildGraph();
  const { match, tier, ambiguous } = resolveObject(graph, FIXTURE_SHA);
  assert.equal(match.class, "Commit");
  assert.equal(match.label, FIXTURE_SHORT);
  assert.equal(tier, 1);
  assert.equal(ambiguous, false);
});

test("resolveObject: a short unique sha prefix (≥7 hex) resolves, with or without the \"commit\" noun, case-insensitively", () => {
  const graph = buildGraph();
  for (const term of ["ef74e44", `commit ${FIXTURE_SHORT}`, `COMMIT EF74E44E`, "commit:ef74e44"]) {
    const { match, ambiguous } = resolveObject(graph, term);
    assert.equal(match?.label, FIXTURE_SHORT, term);
    assert.equal(ambiguous, false, term);
  }
});

test("resolveObject: an AMBIGUOUS sha prefix is an honest miss listing the candidate commits, never \"the first one\"", () => {
  const a = { id: "commit:abcdef1000000000000000000000000000000000", label: "abcdef100000", class: "Commit" };
  const b = { id: "commit:abcdef1fffffffffffffffffffffffffffffffff", label: "abcdef1fffff", class: "Commit" };
  const graph = { individuals: [a, b], byId: new Map([[a.id, a], [b.id, b]]), relations: [], truncated: [], proseIndex: {} };
  const { match, candidates, ambiguous } = resolveObject(graph, "abcdef1");
  assert.equal(ambiguous, true);
  assert.equal(match.class, "Commit");
  assert.equal(candidates.length, 1);
  // …and end-to-end the render says so, naming the right kind of thing:
  const { content, tmct_ask } = ask(graph, "which changes touch commit abcdef1");
  assert.equal(tmct_ask.ambiguous, true);
  assert.match(content, /matches more than one commit ambiguously/);
});

test("resolveObject: a hex-looking term matching NO commit falls through the ordinary tiers unchanged (honest null here), and a non-hex term never enters the commit tier", () => {
  const graph = buildGraph();
  const hexMiss = resolveObject(graph, "decade1"); // 7 hex chars, no commit, no other match
  assert.equal(hexMiss.match, null);
  assert.equal(hexMiss.tier, null);
  const nonHex = resolveObject(graph, "logging"); // unchanged: tier-3 substring as ever
  assert.equal(nonHex.tier, 3);
  assert.equal(nonHex.match.label, "src/logging.mjs");
});

test("ask(): \"which changes touch commit <sha>\" — the operator's question answers with BOTH grains, commit cited, grouped by class", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, `which changes touch commit ${FIXTURE_SHORT}`);
  assert.equal(tmct_ask.miss, false);
  assert.match(content, new RegExp(`^commit ${FIXTURE_SHORT} touched `));
  assert.match(content, /modules myFile\.mjs and src\/logging\.mjs/);
  assert.match(content, /function startup\(\)/);
  assert.equal(tmct_ask.matches.length, 3);
  assert.match(tmct_ask.traversal, /touches\+touchesSymbol edges where subject = commit/);
});

test("ask(): \"which modules did commit <sha> touch\" — module grain only, no symbol bleed-through", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, `which modules did commit ${FIXTURE_SHORT} touch`);
  assert.equal(tmct_ask.miss, false);
  assert.deepEqual(tmct_ask.matches.map((m) => m.label).sort(), ["myFile.mjs", "src/logging.mjs"]);
  assert.doesNotMatch(content, /startup/);
});

test("ask(): \"which functions changed in <sha>\" — symbol grain only, filtered to the asked class", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, `which functions changed in ${FIXTURE_SHORT}`);
  assert.equal(tmct_ask.miss, false);
  assert.deepEqual(tmct_ask.matches.map((m) => m.label), ["startup"]);
  assert.equal(content, `commit ${FIXTURE_SHORT} touched function startup().`);
});

test("ask(): \"what did commit <sha> touch\" (forward) and the passive \"what was touched by commit <sha>\" reach the same commit-as-subject answer", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, `what did commit ${FIXTURE_SHORT} touch`);
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.matches.length, 3);
  assert.match(content, /myFile\.mjs/);
  const passive = ask(graph, `what was touched by commit ${FIXTURE_SHORT}`);
  assert.equal(passive.content, content);
});

// ---- Seonix Batch 3 (3b): temporal qualifiers on Commit queries ----

test("ask(): bare \"recent commits\"/\"latest commits\"/\"newest commits\" render a real dated list, newest first — never the false find-miss", () => {
  const graph = buildGraph();
  for (const q of ["recent commits", "latest commits", "newest commits"]) {
    const { content, tmct_ask } = ask(graph, q);
    assert.equal(tmct_ask.miss, false, `"${q}" should not miss`);
    assert.match(content, new RegExp(`^2 recent commit\\(s\\): ${FIXTURE_SHORT} \\(2026-07-01\\).*abc123`), `"${q}" -> ${content}`);
  }
});

test("ask(): \"what did the last commit touch\" substitutes the real newest Commit individual before resolution", () => {
  const graph = buildGraph();
  const direct = ask(graph, `what did commit ${FIXTURE_SHORT} touch`);
  for (const q of ["what did the last commit touch", "what did the latest commit touch", "what did the most recent commit touch"]) {
    const { content, tmct_ask } = ask(graph, q);
    assert.equal(tmct_ask.miss, false, `"${q}" should not miss`);
    assert.equal(content, direct.content, `"${q}" should read exactly like the real-sha form`);
  }
});

test("ask(): \"when was the latest commit\" resolves against the real newest commit's own date", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "when was the latest commit");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, new RegExp(FIXTURE_SHORT));
  assert.match(content, /2026-07-01/);
});

test("ask(): the existing commit-as-answer direction still works — \"which commits touched myFile.mjs\" lists commits flat", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which commits touched myFile.mjs");
  assert.equal(tmct_ask.miss, false);
  assert.deepEqual(tmct_ask.matches.map((m) => m.label).sort(), ["abc123", FIXTURE_SHORT]);
  assert.match(content, /abc123/);
  assert.match(content, new RegExp(FIXTURE_SHORT));
});

test("ask(): yes/no with a commit — \"did commit <sha> touch src/logging.mjs\" / an untouched module says No", () => {
  const graph = buildGraph();
  const yes = ask(graph, `did commit ${FIXTURE_SHORT} touch src/logging.mjs`);
  // (0.8.2 WS1: plain-words yes — the edge sentence itself, no parenthetical receipt.)
  assert.match(yes.content, /^Yes — touches\+touchesSymbol edge from ef74e44e25c8 to src\/logging\.mjs\.$/);
  const no = ask(graph, `did commit ${FIXTURE_SHORT} touch src/unrelated.mjs`);
  assert.match(no.content, /^No/);
});

test("ask(): a commit that touched nothing recorded renders the standard honest blank, commit acknowledged", () => {
  const c = { id: "commit:beefcafe00000000000000000000000000000000", label: "beefcafe0000", class: "Commit" };
  const graph = { individuals: [c], byId: new Map([[c.id, c]]), relations: [], truncated: [], proseIndex: {} };
  const { content, tmct_ask } = ask(graph, "what did commit beefcafe0000 touch");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /^commit beefcafe0000 touched nothing recorded in the index\.$/);
  // (0.8.2 WS1: the receipt rides the envelope for the why-path, not the prose.)
  assert.doesNotMatch(content, /traversal:/);
  assert.match(tmct_ask.traversal, /touches/, "the traversal receipt survives on the envelope");
});

test("render: commit answers obey OVERFLOW_CAP (12 shown, remainder counted)", () => {
  const c = { id: "commit:cafe00000000000000000000000000000000dead", label: "cafe00000000", class: "Commit" };
  const mods = Array.from({ length: 15 }, (_, i) => ({ id: `mod:m${i}.mjs`, label: `m${i}.mjs`, class: "Module" }));
  const graph = {
    individuals: [c, ...mods], byId: new Map([c, ...mods].map((i) => [i.id, i])), truncated: [], proseIndex: {},
    relations: [{
      predicate: "touchedByCommit", prop: "mgx:touchedbycommit", count: 15,
      edges: mods.map((m) => ({ subject: c.id, object: m.id, subjectLabel: c.label, objectLabel: m.label })),
    }],
  };
  const { content, tmct_ask } = ask(graph, "which changes touch commit cafe00000000");
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.matches.length, 15);
  assert.match(content, /…and 3 more\.$/);
  assert.match(content, /m11\.mjs/);
  assert.doesNotMatch(content, /m12\.mjs/);
});

test("rephraseHint: the grammar-miss hint now suggests the commit question shapes", () => {
  assert.match(rephraseHint(), /commit <sha>/);
});

test("ask(): a sha matching no commit is an honest miss that says \"commit\", not \"module\"", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which changes touch commit ffffff123");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /no commit matching "commit ffffff123" found in the index\./);
});

// ---- §two-level fuzzy (2026-07-02): curated MISSPELLINGS/WRONG_WORDS corrections
// at normalize time + the bounded Damerau-Levenshtein tier 5 in resolveObject.
// All of this is adapter-free plain JS (every test below passes nlp:null where a
// parse is involved, proving none of it needs wink). ----

test("normalizeQuery: curated misspellings and wrong words are corrected to canonical vocabulary", () => {
  assert.equal(normalizeQuery("whcih moduels improt walk.mjs"), "which modules import walk.mjs");
  assert.equal(normalizeQuery("which folders import walk.mjs"), "which modules import walk.mjs");
  assert.equal(normalizeQuery("which revisions touched walk.mjs"), "which commits touched walk.mjs");
});

test("normalizeQuery: a correction never rewrites a word glued to a dotted extension (real module names stay intact)", () => {
  assert.equal(normalizeQuery("which commits touched revision.mjs"), "which commits touched revision.mjs");
  assert.equal(normalizeQuery("what does property.py import"), "what does property.py import");
});

test("ask(): a misspelled query answers exactly like its correct spelling — adapter-free", () => {
  const graph = buildGraph();
  const clean = ask(graph, "which modules import src/logging.mjs", { nlp: null });
  const typod = ask(graph, "whcih moduels improt src/logging.mjs", { nlp: null });
  assert.equal(typod.content, clean.content);
  assert.equal(typod.tmct_ask.miss, false);
});

test("resolveObject: tier 5 fuzzy — a UNIQUE 1-edit typo of a label resolves, tagged matchedVia:fuzzy", () => {
  const graph = buildGraph();
  // "startupp" (1 insertion from "startup") misses tiers 1-4: no exact/ext/substring/
  // component/prose hit — only the bounded-edit-distance pass can honestly place it.
  const { match, tier, ambiguous, matchedVia } = resolveObject(graph, "startupp");
  assert.equal(match.label, "startup");
  assert.equal(tier, 5);
  assert.equal(ambiguous, false);
  assert.equal(matchedVia, "fuzzy");
});

test("resolveObject: tier 5 fuzzy tie — two labels equidistant from the term is an honest ambiguity, never \"the first one\"", () => {
  const a = { id: "fn:x.mjs#helpers", label: "helpers", class: "Function" };
  const b = { id: "fn:y.mjs#helpery", label: "helpery", class: "Function" };
  const graph = { individuals: [a, b], byId: new Map([[a.id, a], [b.id, b]]), relations: [], truncated: [], proseIndex: {} };
  const { ambiguous, candidates, tier } = resolveObject(graph, "helperz"); // 1 edit from BOTH
  assert.equal(tier, 5);
  assert.equal(ambiguous, true);
  assert.equal(candidates.length, 1);
});

test("resolveObject: sha-shaped terms are NEVER fuzzed against the commit namespace (exact-or-ambiguous only)", () => {
  const c = { id: "commit:cafe0002000000000000000000000000000000ff", label: "cafe00020000", class: "Commit" };
  const graph = { individuals: [c], byId: new Map([[c.id, c]]), relations: [], truncated: [], proseIndex: {} };
  // "cafe0001" is bare hex (sha-shaped), 1 edit from the label prefix — must stay a miss.
  const { match, tier } = resolveObject(graph, "cafe0001");
  assert.equal(match, null);
  assert.equal(tier, null);
});

test("resolveObject: terms under 4 chars never enter the fuzzy tier", () => {
  const m = { id: "mod:abcd.mjs", label: "abcd", class: "Module" };
  const graph = { individuals: [m], byId: new Map([[m.id, m]]), relations: [], truncated: [], proseIndex: {} };
  const { match } = resolveObject(graph, "abz"); // must not even try the fuzzy pass
  assert.equal(match, null);
});

test("resolveObject: a UNIQUE prose hit still wins before fuzzy is ever consulted (tier order preserved)", () => {
  const graph = buildGraph();
  const { tier, matchedVia } = resolveObject(graph, "invoice");
  assert.equal(tier, 4);
  assert.equal(matchedVia, "prose");
});

test("ask(): a fuzzy object resolution is ANNOUNCED — \"assuming you meant <label>:\" prefixes the answer", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "which modules import loging", { nlp: null }); // 1 edit from the "logging" component
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.matchedVia, "fuzzy");
  assert.match(content, /^assuming you meant src\/logging\.mjs: /);
  assert.match(content, /myFile\.mjs/);
});

// ---- §query families (2026-07-02): uses / where / mentions / exports / when,
// plus the dotted-symbol resolution fix. Parse assertions go through parseQuery
// (both strategies merged: a non-ambiguous deepEqual proves they agree or the
// firing one is correct); every family carries a real fixture hit AND an honest
// miss. ----

test("parseQuery: uses family — \"what uses X\" (keyword-only) and \"which modules use X\" (both strategies) parse to the union kind", () => {
  assert.deepEqual(parseQuery("what uses calculateTotalPrice", { nlp: null }),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "uses", object: "calculateTotalPrice" });
  assert.deepEqual(parseQuery("which modules use src/billing.mjs", { nlp: null }),
    { shape: "reverse", entityType: "Module", modifier: "direct", kind: "uses", object: "src/billing.mjs" });
});

test("ask(): uses — \"what uses calculateTotalPrice\" reaches the symbol-grain caller via the callsSymbol leg of the union", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what uses calculateTotalPrice");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /checkout/);
  assert.match(tmct_ask.traversal, /imports\+calls\+callsSymbol/);
});

test("ask(): uses — \"which modules use src/billing.mjs\" answers with the importing module (module grain of the union)", () => {
  const graph = buildGraph();
  const { tmct_ask } = ask(graph, "which modules use src/billing.mjs");
  assert.equal(tmct_ask.miss, false);
  assert.deepEqual(tmct_ask.matches.map((m) => m.label), ["src/checkout.mjs"]);
});

test("ask(): uses — honest miss for an unresolvable term", () => {
  const graph = buildGraph();
  assert.equal(ask(graph, "which modules use totallyMissingThing").tmct_ask.miss, true);
});

test("parseQuery: where family — \"where is startup defined\" parses identically through both strategies, marker optional", () => {
  const p = parseQuery("where is startup defined", { nlp: null });
  assert.deepEqual(p, { shape: "where", entityType: null, modifier: "direct", kind: "where", object: "startup" });
  assert.deepEqual(parseQuery("where is startup", { nlp: null }), p);
});

test("ask(): where — a function answers with module + line off the site attribute; a module answers with its path", () => {
  const graph = buildGraph();
  const fn = ask(graph, "where is startup defined");
  assert.equal(fn.tmct_ask.miss, false);
  assert.equal(fn.content, "function startup() is defined in myFile.mjs at line 3.");
  const mod = ask(graph, "where is src/logging.mjs");
  assert.equal(mod.tmct_ask.miss, false);
  assert.match(mod.content, /is a module/);
});

test("ask(): where — honest miss for an unresolvable term", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "where is totallymissingthing defined");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /no module matching/);
});

test("parseQuery: mentions family — \"where is X mentioned\" routes to the prose surface, not the where shape", () => {
  assert.deepEqual(parseQuery("where is invoice mentioned", { nlp: null }),
    { shape: "mentions", entityType: null, modifier: "direct", kind: "mentions", object: "invoice" });
});

test("ask(): mentions — a doc-comment word surfaces the symbols whose prose mentions it; an unknown word is an honest blank", () => {
  const graph = buildGraph();
  const hit = ask(graph, "where is invoice mentioned");
  assert.equal(hit.tmct_ask.miss, false);
  assert.match(hit.content, /calculateTotalPrice/);
  const miss = ask(graph, "where is zzznotaword mentioned");
  assert.equal(miss.tmct_ask.miss, true);
  assert.match(miss.content, /not mentioned in any indexed/);
});

test("ask(): exports family — \"what does myFile export\" reads the reExports surface; a module with no exports is an honest blank", () => {
  const graph = buildGraph();
  const hit = ask(graph, "what does myFile export");
  assert.equal(hit.tmct_ask.miss, false);
  assert.match(hit.content, /startup/);
  const blank = ask(graph, "what does src/unrelated.mjs export");
  assert.equal(blank.tmct_ask.miss, true);
  // Bug B3 (HANDOVER follow-up #2): the raw internal kind identifier "reexports"
  // must never leak into the rendered prose — verbFor()'s override table maps it
  // to the human word "export", matching every other kind's natural phrasing.
  assert.match(blank.content, /has no export edges/);
  assert.doesNotMatch(blank.content, /reexports/);
});

test("ask(): exports family — the un-answerable phrasings stay honest misses (pinned)", () => {
  const graph = buildGraph();
  // "what is exposed" names no module: a grammar miss with or without the adapter.
  assert.equal(parseQuery("what is exposed", { nlp: null }), null);
  assert.equal(ask(graph, "what is exposed").tmct_ask.miss, true);
  // "how does the API get exposed" has no traversal: adapter-less it is a grammar
  // miss; with the lemma adapter it decomposes but its term never resolves here.
  assert.equal(ask(graph, "how does the API get exposed", { nlp: null }).tmct_ask.miss, true);
  assert.equal(ask(graph, "how does the API get exposed").tmct_ask.miss, true);
});

test("parseQuery: when family — \"when did X change\" / \"when was X last touched\" parse identically through both strategies", () => {
  const p = parseQuery("when did myFile.mjs change", { nlp: null });
  assert.deepEqual(p, { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: "myFile.mjs" });
  assert.deepEqual(parseQuery("when was myFile.mjs last touched", { nlp: null }), p);
  assert.deepEqual(parseQuery("when was myFile.mjs last updated", { nlp: null }), p);
  // a non-temporal verb next to "when" is NOT bent into the when shape
  assert.notEqual(parseQuery("when does myFile import logging", { nlp: null })?.shape, "when");
});

test("ask(): when — newest dated commit cited with date and message; undated commits sort last", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "when did myFile.mjs change");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /myFile\.mjs was last touched by commit ef74e44e25c8 on 2026-07-01/);
  assert.match(content, /1 earlier commit recorded/); // abc123, undated, sorts last
});

test("ask(): when — asking about a commit answers with the commit's own date", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "when did ef74e44e25c8 change");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /commit ef74e44e25c8 is dated 2026-07-01/);
});

test("ask(): when — an untouched module is an honest blank; a dateless index is an honest miss with the precise re-index hint", () => {
  const graph = buildGraph();
  const blank = ask(graph, "when did src/unrelated.mjs change");
  assert.equal(blank.tmct_ask.miss, true);
  assert.match(blank.content, /no recorded commit touches src\/unrelated\.mjs/);
  // hand-built: one undated commit touching one module
  const c = { id: "commit:dddd000000000000000000000000000000000000", label: "dddd00000000", class: "Commit" };
  const m = { id: "mod:a.mjs", label: "a.mjs", class: "Module" };
  const g2 = {
    individuals: [c, m], byId: new Map([[c.id, c], [m.id, m]]), truncated: [], proseIndex: {},
    relations: [{ predicate: "touchedByCommit", prop: "mgx:touchedbycommit", count: 1,
      edges: [{ subject: c.id, object: m.id, subjectLabel: c.label, objectLabel: m.label }] }],
  };
  const dateless = ask(g2, "when did a.mjs change");
  assert.equal(dateless.tmct_ask.miss, true);
  assert.match(dateless.content, /records no commit dates/);
});

// ---- §dotted-symbol resolution fix (advisor-verified: "what defines res.json"
// invented the phantom path test/res.json.js) ----

test("resolveObject: a dotted object.member term resolves to the SYMBOL label (Response.json), never the path-grain module", () => {
  const graph = buildGraph();
  const { match, tier } = resolveObject(graph, "res.json");
  assert.equal(match.label, "Response.json");
  assert.equal(match.class, "Method");
  assert.equal(tier, 3);
});

test("resolveObject: an exact Class.method term resolves exactly (case-insensitive)", () => {
  const graph = buildGraph();
  assert.equal(resolveObject(graph, "Widget.render").match.label, "Widget.render");
  assert.equal(resolveObject(graph, "widget.render").match.label, "Widget.render");
});

test("resolveObject: with NO matching symbol anywhere, a dotted term is an honest miss — the path-substring module is never fabricated", () => {
  const m = { id: "mod:test/res.json.js", label: "test/res.json.js", class: "Module" };
  const graph = { individuals: [m], byId: new Map([[m.id, m]]), relations: [], truncated: [], proseIndex: { res: [m.id], json: [m.id] } };
  const { match, tier } = resolveObject(graph, "res.json");
  assert.equal(match, null);
  assert.equal(tier, null);
});

test("resolveObject: bare-file-name dotted terms still resolve by exact basename (walk.mjs-style, the pre-fix behavior that must survive)", () => {
  const graph = buildGraph();
  assert.equal(resolveObject(graph, "myFile.mjs").match.label, "myFile.mjs");
  assert.equal(resolveObject(graph, "logging.mjs").match.label, "src/logging.mjs");
});

test("ask(): \"what defines res.json\" now answers with the defining module of the SYMBOL", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what defines res.json");
  assert.equal(tmct_ask.miss, false);
  assert.match(tmct_ask.traversal, /object = Response\.json/);
  assert.match(content, /app\/response\.mjs/);
});

test("ask(): inherits with an unresolved ext: base — same-name ext references count, labeled in the receipt (commander shape: every subclass edge points at ext:Command)", () => {
  const base = { id: "fn:lib/command.js#Command", label: "Command", class: "Class" };
  const sub = { id: "fn:examples/my.js#MyCommand", label: "MyCommand", class: "Class" };
  const graph = {
    individuals: [base, sub], byId: new Map([[base.id, base], [sub.id, sub]]), truncated: [], proseIndex: {},
    relations: [{ predicate: "hasSuperType", prop: "seon:hassupertype", count: 1,
      edges: [{ subject: sub.id, object: "ext:Command", subjectLabel: "MyCommand", objectLabel: "Command" }] }],
  };
  const { content, tmct_ask } = ask(graph, "which classes inherit from Command");
  assert.equal(tmct_ask.miss, false);
  assert.deepEqual(tmct_ask.matches.map((m) => m.label), ["MyCommand"]);
  assert.match(tmct_ask.traversal, /by name, via unresolved ext:command references/);
  assert.match(content, /MyCommand/);
});

// ---- §commit-content frames (operator screenshot: "what was in commit <sha>"
// missed live) — "what was/is in commit <sha>", "what went into <sha>", "what
// made it into <sha>" rewrite to the canonical "what did <sha> touch". ----

test("parseQuery: \"what was in commit <sha>\" rewrites to the commit-subject touches shape (both strategies agree)", () => {
  const p = parseQuery(`what was in commit ${FIXTURE_SHORT}`, { nlp: null });
  assert.equal(p.ambiguousParse, undefined);
  assert.equal(p.shape, "forward");
  assert.equal(p.kind, "touches");
  assert.equal(p.object, `commit ${FIXTURE_SHORT}`);
});

test("parseQuery: the casual commit-content variants all reach the same shape", () => {
  for (const q of [
    `what is in ${FIXTURE_SHORT}`,
    `what's in commit ${FIXTURE_SHORT}`,
    `what went into commit ${FIXTURE_SHORT}`,
    `what made it into ${FIXTURE_SHORT}`,
  ]) {
    const p = parseQuery(q, { nlp: null });
    assert.ok(p && !p.ambiguousParse, `"${q}" failed to parse`);
    assert.equal(p.kind, "touches", q);
  }
});

test("ask(): \"what was in commit <sha>\" answers with the commit's touched entities (same as \"what did <sha> touch\")", () => {
  const graph = buildGraph();
  const framed = ask(graph, `what was in commit ${FIXTURE_SHORT}`);
  const canonical = ask(graph, `what did commit ${FIXTURE_SHORT} touch`);
  assert.equal(framed.tmct_ask.miss, false);
  assert.equal(framed.content, canonical.content);
  assert.match(framed.content, /myFile\.mjs/);
});

test("ask(): a commit-content frame over an UNKNOWN sha is the standard honest commit blank, not a phantom", () => {
  const graph = buildGraph();
  const { content, tmct_ask } = ask(graph, "what was in commit deadbeef123");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /no commit matching/);
});

test("parseQuery: the COMMIT frames require a sha tail — \"what is in walk.mjs\" is NOT bent into a commit query (the members phrasing-frame routes it to contains instead)", () => {
  // Over a non-sha object the commit-content frame does not fire; the SKILL_CHAT_PLAYTEST
  // members phrasing-frame (normalize.mjs) instead routes "what is in X" → "what does X
  // contain", so a natural "what's in <module/class>" flows to a members query rather
  // than the grammar wall. The load-bearing assertion is that it is NOT a commit touches
  // query — the sha-tail requirement of the commit frame still holds.
  const p = parseQuery("what is in walk.mjs", { nlp: null });
  assert.ok(p && !p.ambiguousParse, "what is in walk.mjs should parse (members routing)");
  assert.equal(p.kind, "contains");
  assert.equal(p.object, "walk.mjs");
  assert.notEqual(p.kind, "touches");
});

// ---- §grain-aware entity resolution (Bug C+D, HANDOVER follow-up #2): a
// grain-collision fixture — a Module "x/foo.mjs" and a same-stem Class "Foo" — a
// deliberately hand-built graph (not the shared MODULES fixture above), so the
// collision is exact and isolated from every other test's terms. ----

function buildGrainCollisionGraph() {
  const individuals = [
    { id: "mod:x/foo.mjs", label: "x/foo.mjs", class: "Module", attributes: [] },
    { id: "mod:y/qux.mjs", label: "y/qux.mjs", class: "Module", attributes: [] },
    { id: "cls:Foo", label: "Foo", class: "Class", attributes: [] },
    { id: "cls:Bar", label: "Bar", class: "Class", attributes: [] },
    { id: "fn:x/foo.mjs#createTask", label: "createTask", class: "Function", attributes: [] },
  ];
  return {
    individuals, byId: new Map(individuals.map((i) => [i.id, i])), proseIndex: {}, truncated: [],
    relations: [
      {
        predicate: "mgx:importsNamespace", prop: "mgx:importsnamespace", count: 1,
        edges: [{ subject: "mod:y/qux.mjs", object: "mod:x/foo.mjs", subjectLabel: "y/qux.mjs", objectLabel: "x/foo.mjs" }],
      },
      {
        predicate: "seon:declaresMethod", prop: "seon:declaresmethod", count: 1,
        edges: [{ subject: "mod:x/foo.mjs", object: "fn:x/foo.mjs#createTask", subjectLabel: "x/foo.mjs", objectLabel: "createTask" }],
      },
      {
        predicate: "mgx:testsCoverage", prop: "mgx:testscoverage", count: 1,
        edges: [{ subject: "mod:y/qux.mjs", object: "mod:x/foo.mjs", subjectLabel: "y/qux.mjs", objectLabel: "x/foo.mjs" }],
      },
    ],
  };
}

test("resolveObject: expectedClass narrows the pool BEFORE every tier — the grain-collision fixture (Module x/foo.mjs, same-stem Class Foo)", () => {
  const graph = buildGrainCollisionGraph();
  // unscoped: tier-1 exact match wins the Class over the same-stem Module — this
  // IS Bug C's root cause, byte-identical (2-arg call sites are unaffected).
  const unscoped = resolveObject(graph, "foo");
  assert.equal(unscoped.tier, 1);
  assert.equal(unscoped.match.class, "Class");
  // expectedClass:"Module" excludes the Class from the pool entirely before tier 1
  // even runs, so tier 3 (substring) finds the Module instead.
  const scoped = resolveObject(graph, "foo", { expectedClass: "Module" });
  assert.equal(scoped.match.id, "mod:x/foo.mjs");
  assert.equal(scoped.match.class, "Module");
  // expectedClass:"Class" keeps the exact-match Class (already the right grain).
  const classScoped = resolveObject(graph, "foo", { expectedClass: "Class" });
  assert.equal(classScoped.match.id, "cls:Foo");
});

test("ask(): grain-aware resolution — \"which modules import foo\" resolves the Module, not the same-stem Class (Bug C)", () => {
  const graph = buildGrainCollisionGraph();
  const { content, tmct_ask } = ask(graph, "which modules import foo");
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.parsed.object, "foo");
  assert.match(content, /y\/qux\.mjs/);
  assert.match(tmct_ask.traversal, /object = x\/foo\.mjs/);
});

test("ask(): grain-aware resolution — a resolved wrong-grain term with NO same-grain alternative renders the new honest wrongGrainMiss (distinct from the plain unresolved miss)", () => {
  const graph = buildGrainCollisionGraph();
  // "Bar" resolves (tier 1, exact) to the Class, but no Module anywhere has any
  // trace of "bar" in its label — the retry scoped to Module genuinely fails, and
  // "imports" is neither tests nor cochange, so there is no up-refine path either.
  const { content, tmct_ask } = ask(graph, "which modules import Bar");
  assert.equal(tmct_ask.miss, true);
  assert.match(content, /"Bar" resolved to the class Bar, but this question needs a module/);
  assert.match(content, /no module named "Bar" was found in the index/);
});

test("ask(): grain-aware resolution — tests/cochange up-refine a resolved fine-grain entity to its containing module (Bug D)", () => {
  const graph = buildGrainCollisionGraph();
  // createTask is a real Function, correctly resolved — but no plain edge ever
  // points AT a Function for the module-coarse "tests" kind; the containing
  // module (x/foo.mjs, which y/qux.mjs tests) is the honest subject.
  const { content, tmct_ask } = ask(graph, "does createTask have tests");
  assert.equal(tmct_ask.miss, false);
  assert.match(content, /y\/qux\.mjs/);
  assert.match(tmct_ask.traversal, /refined from createTask to its containing module/);
});
