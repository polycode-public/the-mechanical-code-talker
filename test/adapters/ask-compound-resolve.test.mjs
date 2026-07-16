// ask-compound-resolve.test.mjs — the compound-name resolution fix (2026-07-09,
// operator's own worked example): "what is the payment system" should find
// PaymentSystem (PascalCase), payment-system (kebab-case), westfield-payment-system
// (embedded in a longer compound path), and IPaymentSystemImpl.cs (embedded in an
// interface-style file name) — a query whose words are naturally space-separated
// must still reach a graph symbol/path that encodes the SAME concept as one joined
// token in some OTHER naming convention.
//
// Fixture approach: an in-memory graph built through buildEntities() (graph-build.mjs)
// + ingestSchemaDocs() + parseEntities() (codegraph.mjs) — the exact pattern
// ask.test.mjs's own buildGraph() helper already uses for every other resolveObject
// test in this codebase. Deliberately NOT test/fixtures/large-scale/ (real, licensed,
// vendored commander.js/express.js source — not ours to add fictional payment-system
// content into) and NOT a new hand-authored real-source-file fixture directory either
// (this codebase's own resolveObject tests already favor small in-memory graphs for
// exactly this kind of resolution/ranking test — reusing that established pattern is
// simpler and more direct than standing up a parseable-file fixture just to test
// scoring logic that never touches a real parser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { resolveObject } from "../../src/domain/ask.mjs";

function graphFrom(modules) {
  const entities = buildEntities(modules, []);
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}

// The operator's own worked example, modeled as four distinct symbol/path shapes:
//  - a PascalCase Class ("PaymentSystem") — the "1 symbol" canonical target.
//  - a kebab-case Module directory ("payment-system/index.js").
//  - the SAME concept embedded as a substring within a longer compound path
//    ("westfield-payment-system/src/MyCode.cs").
//  - the SAME concept embedded within an interface-style file name
//    ("IPaymentSystemImpl.cs").
// Plus an unrelated Class/Module pair (Logger) so the new tier can't be accidentally
// vacuous (i.e. so a "nothing else in the pool" degenerate case isn't the only
// reason these tests pass).
function buildCompoundGraph() {
  return graphFrom([
    { path: "src/domain/models.mjs", dotted: "src.domain.models", imports: [], calls: [],
      defines: [{ name: "PaymentSystem", kind: "class", lineno: 1, decorators: [] }] },
    { path: "payment-system/index.js", dotted: "paymentSystemIndex", imports: [], calls: [], defines: [] },
    { path: "westfield-payment-system/src/MyCode.cs", dotted: "westfieldPaymentSystemMyCode", imports: [], calls: [], defines: [] },
    { path: "IPaymentSystemImpl.cs", dotted: "iPaymentSystemImpl", imports: [], calls: [], defines: [] },
    { path: "src/util/logger.mjs", dotted: "src.util.logger", imports: [], calls: [],
      defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
  ]);
}

// 1. "the payment system" resolves to the PascalCase Class uniquely — the leading
// article strips (mirrors LEADING_ARTICLE_RE precedent), the joined form
// ("paymentsystem") exactly equals PaymentSystem's own joined label, and every
// other compound candidate in this fixture only CONTAINS the joined form (a
// strictly lower tier), so the exact hit stands alone, unambiguous.
test("compound resolve: 'the payment system' resolves uniquely to the PascalCase Class PaymentSystem", () => {
  const graph = buildCompoundGraph();
  const { match, tier, ambiguous } = resolveObject(graph, "the payment system");
  assert.equal(match?.label, "PaymentSystem");
  assert.equal(match?.class, "Class");
  assert.equal(tier, 3);
  assert.equal(ambiguous, false);
});

// 2. The SAME query also surfaces the kebab-case payment-system module — as a
// (non-ambiguous, lower-scored) candidate alongside the exact PaymentSystem match,
// per the operator's own "or lists as ambiguous candidates including" allowance.
test("compound resolve: 'the payment system' also lists the kebab-case payment-system module among its candidates", () => {
  const graph = buildCompoundGraph();
  const { match, candidates } = resolveObject(graph, "the payment system");
  assert.equal(match?.label, "PaymentSystem");
  assert.ok(candidates.some((c) => c.label === "payment-system/index.js"),
    "payment-system/index.js must surface as a candidate even though PaymentSystem wins outright");
});

// 3. A term embedded in a longer compound path ("westfield-payment-system") is
// found via containment against the candidate's OWN joined (separator-stripped)
// label — never invented, never silently dropped.
test("compound resolve: 'payment system' is found via containment inside the longer compound path westfield-payment-system/src/MyCode.cs", () => {
  const graph = buildCompoundGraph();
  const { match, candidates } = resolveObject(graph, "payment system");
  assert.equal(match?.label, "PaymentSystem");
  assert.ok(candidates.some((c) => c.label === "westfield-payment-system/src/MyCode.cs"),
    "the nested compound path must surface as a candidate via joined-form containment");
});

// 4. A term embedded in an interface-style name ("IPaymentSystemImpl.cs") is found
// via the same containment check, extension-stripped first.
test("compound resolve: 'payment system' is found via containment inside the interface-style IPaymentSystemImpl.cs", () => {
  const graph = buildCompoundGraph();
  const { match, candidates } = resolveObject(graph, "payment system");
  assert.equal(match?.label, "PaymentSystem");
  assert.ok(candidates.some((c) => c.label === "IPaymentSystemImpl.cs"),
    "IPaymentSystemImpl.cs must surface as a candidate via joined-form containment");
});

// 5. A mashed-together typo ("paymntsystem", one letter short, no word boundary at
// all) still resolves — via the EXISTING bounded-fuzzy tier (tier 5), announced as
// a fuzzy match, never silently absorbed by the new compound tier (which only
// fires for a query with 2+ SPACE-separated words — a single mashed token like
// this one never qualifies as isMultiWord, so it falls through unaffected to
// tier 5 exactly as any other typo would).
test("compound resolve: a mashed-together typo 'paymntsystem' still resolves via the fuzzy tier, announced (not silently absorbed)", () => {
  const graph = buildCompoundGraph();
  const { match, tier, ambiguous, matchedVia } = resolveObject(graph, "paymntsystem");
  assert.equal(match?.label, "PaymentSystem");
  assert.equal(tier, 5);
  assert.equal(matchedVia, "fuzzy");
  assert.equal(ambiguous, false);
});

// 6. A genuine ambiguous case: two real, different compound entities both contain
// the SAME joined substring at an equal score (same joined-length distance from
// the query) — this must surface as ambiguous:true with both real candidates
// listed, never a silently-picked single "winner".
test("compound resolve: two equally-scored compound entities sharing the joined substring return ambiguous:true, never a silent pick", () => {
  const graph = graphFrom([
    { path: "old-payment-system.js", dotted: "oldPaymentSystem", imports: [], calls: [], defines: [] },
    { path: "new-payment-system.js", dotted: "newPaymentSystem", imports: [], calls: [], defines: [] },
  ]);
  const { match, candidates, ambiguous } = resolveObject(graph, "payment system");
  assert.equal(ambiguous, true);
  const allLabels = [match?.label, ...candidates.map((c) => c.label)].sort();
  assert.deepEqual(allLabels, ["new-payment-system.js", "old-payment-system.js"]);
});

// 7. Negative case: a query that has nothing to do with any compound name in the
// graph must stay an honest miss — the new tier must never spuriously match.
test("compound resolve: an unrelated multi-word query never spuriously matches via the new compound tier", () => {
  const graph = buildCompoundGraph();
  const { match, tier, ambiguous } = resolveObject(graph, "the coffee machine");
  assert.equal(match, null);
  assert.equal(tier, null);
  assert.equal(ambiguous, false);
});
