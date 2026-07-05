// finish.test.mjs — the composed-path masker, the invariance checker and the
// no-op finish() seam (Phase 7, lever 1 foundation). Contract: byte-exact
// reconstruction, protect-when-unsure, and a strictly neutral finish().
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENT_TYPES, PROTECTED_TYPES, isProtected,
  maskSegments, flatten,
  protectedSpans, protectedMultiset, invariantHolds, assertInvariance,
  finish,
} from "../src/finish.mjs";

const GRAPH = {
  individuals: [
    { id: "m:walk", class: "Module", label: "walk.mjs" },
    { id: "f:fnAlpha", class: "Function", label: "fnAlpha" },
    { id: "c:Widget", class: "Class", label: "Widget" },
  ],
};

test("segment vocabulary: prose is the only unprotected type", () => {
  assert.deepEqual(SEGMENT_TYPES, ["prose", "entity", "path", "number", "code", "provenance", "receipt"]);
  assert.ok(!PROTECTED_TYPES.has("prose"));
  for (const t of SEGMENT_TYPES) assert.equal(isProtected(t), t !== "prose");
  assert.equal(PROTECTED_TYPES.size, 6);
});

test("maskSegments: EXACT reconstruction — flatten(maskSegments(answer)) === answer, always", () => {
  const cases = [
    "app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs",
    "There are 3 classes.",
    "fnAlpha is called by walk.mjs (traversal: calls edges where object = fnAlpha)",
    'I read as "which modules import a.mjs" — repaired.',
    "background knowledge from ConceptNet, CC-BY-SA.",
    "just some plain prose with nothing to protect",
    "",
    "Widget contains 2 members: fnAlpha and helper.mjs.",
  ];
  for (const answer of cases) {
    assert.equal(flatten(maskSegments(answer, { graph: GRAPH })), answer, `reconstruction for ${JSON.stringify(answer)}`);
    assert.equal(flatten(maskSegments(answer)), answer, `reconstruction (no graph) for ${JSON.stringify(answer)}`);
  }
});

test("maskSegments: protects paths, numbers, receipts, provenance and known graph labels", () => {
  const has = (segs, type, text) => segs.some((s) => s.type === type && s.text === text);

  let segs = maskSegments("app/lib/b.mjs and app/lib/c.mjs", { graph: GRAPH });
  assert.ok(has(segs, "path", "app/lib/b.mjs") && has(segs, "path", "app/lib/c.mjs"), "paths protected");
  assert.ok(has(segs, "prose", " and "), "the connective stays prose");

  segs = maskSegments("There are 3 classes.", { graph: GRAPH });
  assert.ok(has(segs, "number", "3"), "bare number protected");

  segs = maskSegments("fnAlpha (traversal: calls edges where object = fnAlpha)", { graph: GRAPH });
  assert.ok(has(segs, "receipt", "(traversal: calls edges where object = fnAlpha)"), "traversal receipt protected");
  assert.ok(has(segs, "entity", "fnAlpha"), "known graph label protected as entity");

  segs = maskSegments('read as "which modules import a.mjs"', { graph: GRAPH });
  assert.ok(has(segs, "receipt", 'read as "which modules import a.mjs"'), "repair receipt protected whole");
  // the a.mjs inside the receipt is NOT separately emitted — the receipt owns it
  assert.ok(!has(segs, "path", "a.mjs"), "path inside a receipt is not double-claimed");

  segs = maskSegments("from ConceptNet, CC-BY-SA", { graph: GRAPH });
  assert.ok(has(segs, "provenance", "ConceptNet"), "source name protected");
  assert.ok(has(segs, "provenance", "CC-BY-SA"), "licence code protected");

  segs = maskSegments("see (source: git log)", { graph: GRAPH });
  assert.ok(has(segs, "provenance", "(source: git log)"), "parenthesized provenance protected");
});

test("maskSegments: conservative / graph-independent — plain prose becomes prose, un-adopted site is one span", () => {
  const segs = maskSegments("hello there friend", {});
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, "prose");
  assert.equal(segs[0].text, "hello there friend");
});

test("invariance checker: protected multiset survives a prose-only transform; fails if a fact moves", () => {
  const before = maskSegments("app/lib/b.mjs and app/lib/c.mjs — 2 files", { graph: GRAPH });

  // a prose-only transform (uppercase prose spans only) preserves the invariant
  const proseOnly = before.map((s) => (isProtected(s.type) ? s : { ...s, text: s.text.toUpperCase() }));
  assert.ok(invariantHolds(before, proseOnly), "prose-only transform preserves protected multiset");
  assert.equal(assertInvariance(before, proseOnly), proseOnly, "assertInvariance returns `after` on success");

  // reordering / duplicating prose is still fine (multiset is order-independent)
  const reordered = [...proseOnly].reverse();
  assert.ok(invariantHolds(before, reordered), "protected multiset is order-independent");

  // touching a protected span is a VIOLATION
  const tampered = before.map((s) => (s.type === "path" ? { ...s, text: "app/lib/HACKED.mjs" } : s));
  assert.ok(!invariantHolds(before, tampered), "a changed protected span breaks the invariant");
  assert.throws(() => assertInvariance(before, tampered), /fact-invariance violated/);

  // dropping a protected span is a VIOLATION
  const dropped = before.filter((s) => s.type !== "number");
  assert.ok(!invariantHolds(before, dropped), "a dropped protected span breaks the invariant");
});

test("protectedSpans / protectedMultiset: only non-prose, canonical + sorted", () => {
  const segs = [
    { type: "prose", text: "a " }, { type: "path", text: "x.mjs" },
    { type: "prose", text: " and " }, { type: "path", text: "w.mjs" },
  ];
  assert.deepEqual(protectedSpans(segs), [{ type: "path", text: "x.mjs" }, { type: "path", text: "w.mjs" }]);
  assert.deepEqual(protectedMultiset(segs), ["path w.mjs", "path x.mjs"]); // sorted
});

test("finish(): strict NO-OP — returns its input byte-for-byte", () => {
  const result = {
    answer: "app/lib/b.mjs and app/lib/c.mjs — 2 files",
    via: "composed",
    logLines: ["> q", "app/lib/b.mjs and app/lib/c.mjs — 2 files"],
  };
  const out = finish(result, { graph: GRAPH });
  assert.equal(out, result, "same reference — nothing rebuilt");
  assert.equal(out.answer, result.answer, "answer bytes unchanged");
  assert.deepEqual(out, result, "whole result unchanged");
});

test("finish() is idempotent: finish(finish(x)) === finish(x)", () => {
  const x = { answer: "There are 3 classes.", via: "count" };
  assert.equal(finish(finish(x)), finish(x));
  assert.deepEqual(finish(finish(x)), finish(x));
});
