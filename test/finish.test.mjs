// finish.test.mjs — the composed-path masker, the invariance checker and the
// no-op finish() seam (Phase 7, lever 1 foundation). Contract: byte-exact
// reconstruction, protect-when-unsure, and a strictly neutral finish().
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENT_TYPES, PROTECTED_TYPES, isProtected,
  maskSegments, flatten,
  protectedSpans, protectedMultiset, invariantHolds, assertInvariance,
  finish, applyGrammar, loadGrammarRules,
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

test("finish() is idempotent on neutral input: finish(finish(x)) === finish(x)", () => {
  const x = { answer: "There are 3 classes.", via: "count" };
  assert.equal(finish(finish(x)), finish(x));
  assert.deepEqual(finish(finish(x)), finish(x));
});

// --- The grammar-rule engine (Phase 7, lever 2) -----------------------------
// applyGrammar transforms ONLY prose spans; the invariance checker is a hard
// gate on top. Golden per rule (input segments → finished flat output), plus
// the two properties every rule must hold: fact-invariance and idempotence.

// A rule's golden proves its behaviour INDEPENDENT of its live `enabled` flag —
// four rules are PARKED (enabled=false) this cycle, so force-enable to test them.
const only = (id) => loadGrammarRules().filter((r) => r.id === id).map((r) => ({ ...r, enabled: true }));
const allEnabled = () => loadGrammarRules().map((r) => ({ ...r, enabled: true }));
const golden = (rules, input, expected) => {
  const out = applyGrammar(input, rules);
  assert.equal(flatten(out), expected, `golden: ${JSON.stringify(input)}`);
  assert.ok(invariantHolds(input, out), "protected multiset preserved");
  // idempotence: a rule never re-fires on its own output
  assert.equal(flatten(applyGrammar(out, rules)), expected, "idempotent");
};

test("the rule table loads: 5 rules; the three SAFE defect rules are live this cycle", () => {
  const rules = loadGrammarRules();
  assert.equal(rules.length, 5);
  const kinds = rules.map((r) => r.kind);
  assert.deepEqual(kinds, ["article", "agreement", "capitalise", "list", "terminal"]);
  for (const r of rules) assert.ok(r.id && r.kind, "id + kind present");
  // LIVE (cycle 005): article-selection (cycle 4) + the two safe defect fixes
  // subject-verb-agreement and terminal-punctuation. capitalise/list stay PARKED
  // (they rewrite established product voice — a judged A/B in cycle 006).
  const live = rules.filter((r) => r.enabled !== false).map((r) => r.id);
  assert.deepEqual(live, ["article-selection", "subject-verb-agreement", "terminal-punctuation"],
    "the three safe defect rules are live; the voice rules stay parked");
});

test("live finish() applies the SAFE defect rules; the VOICE rules (capitalise/list) stay inert", () => {
  const result = { answer: "every module is a artifact and b and c..", via: "assert" };
  const out = finish(result, {});
  // article fixes "a artifact"; terminal collapses the trailing ".." -> "."; the
  // opener stays lowercase (capitalise parked) and "and…and" is untouched (list parked).
  assert.equal(out.answer, "every module is an artifact and b and c.");
});

test("GOLDEN rule 1 — article selection (the 'a artifact' → 'an artifact' fix)", () => {
  const rules = only("article-selection");
  // the live defect, in-span
  golden(rules, [{ type: "prose", text: "every module is a artifact" }], "every module is an artifact");
  // the SAME defect across a prose→protected boundary (the noun is the next span)
  golden(rules, [{ type: "prose", text: "every module is a " }, { type: "entity", text: "artifact" }], "every module is an artifact");
  // the reverse defect: "an" before a consonant sound
  golden(rules, [{ type: "prose", text: "it is an module" }], "it is a module");
  // spelling-vs-sound exceptions read from the TOML row
  golden(rules, [{ type: "prose", text: "a hour ago" }], "an hour ago");        // silent h → vowel sound
  golden(rules, [{ type: "prose", text: "an unicorn" }], "a unicorn");          // "yu" onset → consonant sound
  // case preserved on a sentence-initial article
  golden(rules, [{ type: "prose", text: "A artifact" }], "An artifact");
  // NEUTRAL: correct usage is byte-stable
  golden(rules, [{ type: "prose", text: "a module and an artifact" }], "a module and an artifact");
  // guard #3: a trailing "a " before a bare NUMBER span (no readable word) refuses to fire
  golden(rules, [{ type: "prose", text: "give me a " }, { type: "number", text: "3" }], "give me a 3");
});

test("GOLDEN rule 2 — subject–verb agreement (existential + explicit plurality flag)", () => {
  const rules = only("subject-verb-agreement");
  // existential copula agrees with the FOLLOWING count's value
  golden(rules, [{ type: "prose", text: "There is " }, { type: "number", text: "3" }, { type: "prose", text: " classes" }], "There are 3 classes");
  golden(rules, [{ type: "prose", text: "there are " }, { type: "number", text: "1" }, { type: "prose", text: " class" }], "there is 1 class");
  // an OBJECT count after a non-existential copula is NOT the subject → untouched
  golden(rules, [{ type: "prose", text: "the file has " }, { type: "number", text: "3" }, { type: "prose", text: " imports" }], "the file has 3 imports");
  // structure-marker path: an explicit `plural` flag drives agreement
  golden(rules, [{ type: "prose", text: "there is " }, { type: "entity", text: "widgets", plural: true }, { type: "prose", text: " here" }], "there are widgets here");
  // NEUTRAL: already-correct agreement is byte-stable
  golden(rules, [{ type: "prose", text: "There are " }, { type: "number", text: "5" }, { type: "prose", text: " tests" }], "There are 5 tests");
});

test("GOLDEN rule 3 — sentence capitalisation (prose-initial only)", () => {
  const rules = only("sentence-capitalisation");
  golden(rules, [{ type: "prose", text: "noted — remembered a fact" }], "Noted — remembered a fact");
  // an answer that OPENS on a protected span is left exactly as grounded
  golden(rules, [{ type: "path", text: "app/lib/a.mjs" }, { type: "prose", text: " is imported" }], "app/lib/a.mjs is imported");
  // NEUTRAL: already capitalised
  golden(rules, [{ type: "prose", text: "Already fine" }], "Already fine");
});

test("GOLDEN rule 4 — list punctuation ('a and b and c' → 'a, b and c')", () => {
  const rules = only("list-punctuation");
  golden(rules,
    [{ type: "path", text: "app/lib/b.mjs" }, { type: "prose", text: " and " },
     { type: "path", text: "app/lib/c.mjs" }, { type: "prose", text: " and " },
     { type: "path", text: "app/lib/e.mjs" }],
    "app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs");
  // a two-item list is already correct → untouched
  golden(rules,
    [{ type: "path", text: "a.mjs" }, { type: "prose", text: " and " }, { type: "path", text: "b.mjs" }],
    "a.mjs and b.mjs");
});

test("GOLDEN rule 5 — terminal punctuation (collapse a run of stops)", () => {
  const rules = only("terminal-punctuation");
  golden(rules, [{ type: "prose", text: "all done.." }], "all done.");
  golden(rules, [{ type: "number", text: "3" }, { type: "prose", text: " classes.." }], "3 classes.");
  // NEUTRAL: a single stop, or a legitimate fragment with none, is untouched
  golden(rules, [{ type: "prose", text: "fine." }], "fine.");
  golden(rules, [{ type: "path", text: "a.mjs" }, { type: "prose", text: " and " }, { type: "path", text: "b.mjs" }], "a.mjs and b.mjs");
});

test("applyGrammar over the WHOLE table preserves the protected multiset (necessary gate)", () => {
  const input = [
    { type: "prose", text: "every module is a " }, { type: "entity", text: "artifact" },
    { type: "prose", text: " — see " }, { type: "path", text: "app/lib/a.mjs" },
    { type: "prose", text: " and " }, { type: "path", text: "app/lib/b.mjs" },
    { type: "prose", text: " and " }, { type: "path", text: "app/lib/c.mjs" },
  ];
  const out = applyGrammar(input, allEnabled()); // force every rule on to prove composition
  assert.ok(invariantHolds(input, out), "no protected span moved");
  // article + capitalise + list all fire; entities/paths are byte-identical
  assert.equal(
    flatten(out),
    "Every module is an artifact — see app/lib/a.mjs, app/lib/b.mjs and app/lib/c.mjs",
  );
});

test("finish(): a GENUINE defect is fixed — 'a artifact' → 'an artifact', facts invariant", () => {
  const result = {
    answer: "Every module is a artifact.",
    via: "assert",
    logLines: ["> every module is a artifact", "Every module is a artifact."],
  };
  const out = finish(result, {});
  assert.equal(out.answer, "Every module is an artifact.", "the a/an defect is corrected");
  assert.notEqual(out, result, "a genuine fix rebuilds the result");
  assert.equal(out.via, "assert", "via is unchanged by finishing");
  assert.equal(out.logLines[1], "Every module is an artifact.", "logLines track the corrected answer");
  // finish is idempotent even after a fix
  assert.deepEqual(finish(out, {}), out);
});

test("finish(): NEUTRAL over a masked composed answer is byte-stable and preserves paths", () => {
  const GRAPH2 = { individuals: [{ id: "m:a", class: "Module", label: "app/lib/a.mjs" }] };
  const result = { answer: "app/lib/a.mjs is fine.", via: "composed" };
  const out = finish(result, { graph: GRAPH2 });
  assert.equal(out, result, "no rule fires → same reference, byte-stable");
  assert.equal(out.answer, "app/lib/a.mjs is fine.");
});

test("finish(): the invariance guard runs in production — a fact never moves through finishing", () => {
  // Over a masked answer that mixes prose with a path + a number + a receipt, the
  // finished answer's protected multiset is identical to the input's.
  const answer = 'fnAlpha is a artifact in app/lib/a.mjs (traversal: calls edges where object = fnAlpha) — 2 files.';
  const GRAPH2 = { individuals: [{ id: "f:fnAlpha", class: "Function", label: "fnAlpha" }] };
  const before = maskSegments(answer, { graph: GRAPH2 });
  const out = finish({ answer, via: "composed" }, { graph: GRAPH2 });
  const after = maskSegments(out.answer, { graph: GRAPH2 });
  assert.ok(invariantHolds(before, after), "every entity/path/number/receipt survived byte-for-byte");
  assert.match(out.answer, /is an artifact/, "the prose defect was fixed");
  assert.match(out.answer, /app\/lib\/a\.mjs/, "the path is untouched");
  assert.match(out.answer, /\(traversal: calls edges where object = fnAlpha\)/, "the receipt is untouched");
});
