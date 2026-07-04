// temporal P2 tests — co-change gravity, hotspot heat, the query-grammar
// extensions (touched:/since:/cochange:), the deterministic NL→query mapping, and
// the link self-test. Pure functions, no I/O; the generated browser page inlines
// this exact source, so these tests ARE the page's logic tests (P1 convention).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cochangeWeightAt,
  gravityAt,
  heatAt,
  heatScale,
  matchQuery,
  nlToQuery,
  validateLink,
  encodeViewState,
  decodeViewState,
  VIEW_DEFAULTS,
} from "../src/temporal.mjs";
import { buildTemporalGraph } from "../src/browser.mjs";

// Five commits (0..4, HEAD = 4). modA and modB co-change at 1 and 3; fnHot is
// touched at 3 and 4 (recent), fnCold only at 0 (ancient, same total churn as none).
const TG = {
  commits: [
    { idx: 0, sha: "aaaa000000000000", shortSha: "aaaa00000000", date: "2026-01-01", author: "ada", subject: "init" },
    { idx: 1, sha: "bbbb111111111111", shortSha: "bbbb11111111", date: "2026-01-02", author: "ada", subject: "couple a+b" },
    { idx: 2, sha: "cccc222222222222", shortSha: "cccc22222222", date: "2026-01-03", author: "grace", subject: "drift" },
    { idx: 3, sha: "dddd333333333333", shortSha: "dddd33333333", date: "2026-01-04", author: "grace", subject: "couple again" },
    { idx: 4, sha: "eeee444444444444", shortSha: "eeee44444444", date: "2026-01-05", author: "ada", subject: "hot work" },
  ],
  nodes: [
    { id: "mod:a.py", type: "Module", label: "a.py", site: "a.py:1", born: 0, died: 4, touches: [0, 1, 3], churn: 3, degree: 3 },
    { id: "mod:b.py", type: "Module", label: "b.py", site: "b.py:1", born: 1, died: 4, touches: [1, 3], churn: 2, degree: 2 },
    { id: "fn:a.py#hot", type: "Function", label: "renderHot", site: "a.py:10", born: 3, died: 4, touches: [3, 4], churn: 2, degree: 1 },
    { id: "fn:a.py#cold", type: "Function", label: "cold", site: "a.py:30", born: 0, died: 4, touches: [0], churn: 1, degree: 1 },
    { id: "commit:eeee444444444444", type: "Commit", label: "eeee44444444", site: "", born: 4, died: 4, touches: [], churn: 0, commitIdx: 4, degree: 0 },
  ],
  edges: [
    { src: "mod:a.py", dst: "mod:b.py", kind: "cochange", valid: [1, 4] },
    { src: "mod:a.py", dst: "fn:a.py#hot", kind: "defines", valid: [3, 4] },
    { src: "mod:a.py", dst: "fn:a.py#cold", kind: "defines", valid: [0, 4] },
  ],
};

// ---- gravity --------------------------------------------------------------------

test("cochangeWeightAt: shared touches up to the cursor, cutoff respected", () => {
  const a = TG.nodes[0].touches; // [0,1,3]
  const b = TG.nodes[1].touches; // [1,3]
  assert.equal(cochangeWeightAt(a, b, 0), 0); // no shared commit yet
  assert.equal(cochangeWeightAt(a, b, 1), 1); // shared 1
  assert.equal(cochangeWeightAt(a, b, 2), 1); // drift commit adds nothing
  assert.equal(cochangeWeightAt(a, b, 4), 2); // shared 1 and 3
  assert.equal(cochangeWeightAt([], b, 4), 0);
  assert.equal(cochangeWeightAt(null, b, 4), 0);
});

test("gravityAt: cochange edges only, w>0 only, tightens as the cursor advances, deterministic order", () => {
  assert.deepEqual(gravityAt(TG, 0), []); // before the first shared commit: no gravity
  const at1 = gravityAt(TG, 1);
  assert.deepEqual(at1, [{ src: "mod:a.py", dst: "mod:b.py", w: 1 }]);
  const at4 = gravityAt(TG, 4);
  assert.deepEqual(at4, [{ src: "mod:a.py", dst: "mod:b.py", w: 2 }]); // cluster tightened
  assert.ok(at4[0].w > at1[0].w);
  // defines edges never contribute gravity
  assert.ok(gravityAt(TG, 4).every((e) => e.src === "mod:a.py" && e.dst === "mod:b.py"));
});

// ---- heat -----------------------------------------------------------------------

test("heatAt: a touch AT the cursor weighs 1; decay halves per halfLife; empty is 0", () => {
  assert.equal(heatAt([4], 4, 8), 1);
  assert.equal(heatAt([0], 8, 8), 0.5);         // exactly one half-life old
  assert.equal(heatAt([], 4), 0);
  assert.equal(heatAt(null, 4), 0);
  assert.equal(heatAt([5], 4), 0);              // the future does not glow
  // two touches beat one at equal recency
  assert.ok(heatAt([3, 4], 4, 8) > heatAt([4], 4, 8));
});

test("heatScale: normalized to [0,1], commits excluded, hotspots migrate with recency", () => {
  const hs = heatScale(TG, 4, 2); // short half-life exaggerates recency
  assert.ok(!hs.has("commit:eeee444444444444"));
  assert.equal(hs.get("fn:a.py#hot"), 1); // the max normalizes to 1
  // fnCold's single ancient touch is far colder than fnHot despite nonzero churn
  assert.ok(hs.get("fn:a.py#cold") < 0.3);
  // scrub back to 0: fnHot does not exist yet (no touches ≤ 0) and fnCold IS the max
  const hs0 = heatScale(TG, 0, 2);
  assert.equal(hs0.get("fn:a.py#hot"), 0);
  assert.equal(hs0.get("fn:a.py#cold"), 1);
});

// ---- query grammar extensions -----------------------------------------------------

test("matchQuery: touched:> / >= / exact compare total churn", () => {
  assert.deepEqual([...matchQuery(TG, "touched:>2")], ["mod:a.py"]);
  assert.deepEqual([...matchQuery(TG, "touched:>=2")].sort(), ["fn:a.py#hot", "mod:a.py", "mod:b.py"]);
  assert.deepEqual([...matchQuery(TG, "touched:1")], ["fn:a.py#cold"]);
  assert.equal(matchQuery(TG, "touched:garbage").size, 0); // malformed term matches nothing
});

test("matchQuery: since:<sha|ordinal> = touched at-or-after; unresolvable fails loud (empty)", () => {
  assert.deepEqual([...matchQuery(TG, "since:dddd")].sort(), ["fn:a.py#hot", "mod:a.py", "mod:b.py"]);
  assert.deepEqual([...matchQuery(TG, "since:4")], ["fn:a.py#hot"]);
  assert.equal(matchQuery(TG, "since:zzzz").size, 0); // stale link → empty, never silently wide
});

test("matchQuery: cochange:<term> finds partners in both edge directions and ANDs with other terms", () => {
  assert.deepEqual([...matchQuery(TG, "cochange:b.py")], ["mod:a.py"]);
  assert.deepEqual([...matchQuery(TG, "cochange:a.py")], ["mod:b.py"]);
  assert.equal(matchQuery(TG, "cochange:a.py type:function").size, 0); // AND semantics
  assert.equal(matchQuery(TG, "cochange:").size, 0);
});

// ---- NL → query -------------------------------------------------------------------

test("nlToQuery: keyword phrases map deterministically; stopwords drop; same input → same q", () => {
  const r = nlToQuery("show me all classes that change with render since dddd33 touched more than 1 times");
  assert.equal(r.q, "since:dddd33 cochange:render touched:>1 type:Class");
  assert.deepEqual(nlToQuery("show me all classes that change with render since dddd33 touched more than 1 times").q, r.q);
  const hot = nlToQuery("hot functions");
  assert.equal(hot.q, "touched:>2 type:Function");
  assert.ok(hot.notes.some((n) => n.includes("touched:>2")));
  assert.equal(nlToQuery("modules that co-changed with b.py").q, "cochange:b.py type:Module");
  assert.equal(nlToQuery("").q, "");
  // plain words survive as substring terms
  assert.equal(nlToQuery("the renderHot function").q, "renderhot type:Function");
});

// ---- link self-test ----------------------------------------------------------------

test("validateLink: ok iff the query matches and every cursor resolves", () => {
  const ok = validateLink(TG, { q: "type:Module", at: "dddd33" });
  assert.equal(ok.ok, true);
  assert.equal(ok.matches, 2);
  assert.equal(ok.cursor, 3);
  const empty = validateLink(TG, { q: "type:Class" }); // no Class in TG
  assert.equal(empty.ok, false);
  assert.equal(empty.matches, 0);
  assert.ok(empty.reasons[0].includes("render empty"));
  const badCursor = validateLink(TG, { q: "type:Module", at: "ffff99" });
  assert.equal(badCursor.ok, false);
  assert.ok(badCursor.reasons[0].includes("resolves to no commit"));
  const blankQ = validateLink(TG, {}); // default view is a valid link
  assert.equal(blankQ.ok, true);
  assert.equal(blankQ.matches, null);
});

// ---- build-time roll-up ------------------------------------------------------------

test("buildTemporalGraph rolls symbol touches up the container chain (module-grain gravity/heat)", () => {
  const raw = {
    individuals: [
      { id: "mod:m.py", label: "m.py", class: "Module", attributes: [] },
      { id: "fn:m.py#f", label: "f", class: "Function", attributes: [] },
      { id: "commit:aaaa000000000000", label: "aaaa00000000", class: "Commit",
        attributes: [{ key: "author", value: "ada" }, { key: "date", value: "2026-01-01" }, { key: "message", value: "init" }] },
      { id: "commit:bbbb111111111111", label: "bbbb11111111", class: "Commit",
        attributes: [{ key: "author", value: "ada" }, { key: "date", value: "2026-01-02" }, { key: "message", value: "touch f" }] },
    ],
    objectProperties: [
      { prop: "seon:containsCodeEntity", examples: [{ subject: "mod:m.py", object: "fn:m.py#f" }] },
      // history lands ONLY on the symbol — the real self-index shape
      { prop: "mgx:touchesSymbol", examples: [{ subject: "commit:bbbb111111111111", object: "fn:m.py#f" }] },
    ],
  };
  const tg = buildTemporalGraph(raw, ["aaaa000000000000", "bbbb111111111111"]);
  const mod = tg.nodes.find((n) => n.id === "mod:m.py");
  assert.deepEqual(mod.touches, [1]); // rolled up from fn:m.py#f
  assert.ok(heatAt(mod.touches, 1) > 0); // module-grain heat is no longer blind
});

// ---- URL codec: the P2 flags -------------------------------------------------------

test("view-state codec: g/heat flags round-trip and defaults stay silent", () => {
  const s = { ...VIEW_DEFAULTS, q: "hot", g: "1", heat: "1" };
  const enc = encodeViewState(s);
  assert.equal(enc, "q=hot&g=1&heat=1");
  assert.deepEqual(decodeViewState(enc), s);
  assert.equal(encodeViewState({ ...VIEW_DEFAULTS }), "");
});
