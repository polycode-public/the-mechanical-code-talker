// temporal tests — the P1 code-browser core: two-cursor structural diff,
// deterministic per-commit narration, the query engine, cursor resolution, and the
// query-as-URL state codec. Pure functions, no I/O; the generated browser page
// inlines this exact source, so these tests ARE the page's logic tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliveAt,
  structuralDiff,
  narrateCommit,
  narrateRange,
  matchQuery,
  resolveCursor,
  encodeViewState,
  decodeViewState,
  VIEW_DEFAULTS,
  repoOfId,
  assignRepo,
  isMultiRepo,
} from "../src/temporal.mjs";
import { buildTemporalGraph, buildBrowserData, gitCommitOrder } from "../src/browser.mjs";

// A synthetic temporal graph over 5 commits (0..4, HEAD = 4):
//   modA   born 0, touched at 0,2   (lives to HEAD)
//   fnX    born 2 (added by commit 2), touched at 2,4
//   fnGone born 0, DIED at 2 (a historical death — the diff API must handle it even
//          though today's HEAD-only builder never emits one)
//   commits carry sha/shortSha/author/date/subject for narration
const TG = {
  commits: [
    { idx: 0, sha: "aaaa000000000000", shortSha: "aaaa00000000", date: "2026-01-01T10:00:00Z", author: "ada", subject: "init" },
    { idx: 1, sha: "bbbb111111111111", shortSha: "bbbb11111111", date: "2026-01-02T10:00:00Z", author: "ada", subject: "refactor" },
    { idx: 2, sha: "cccc222222222222", shortSha: "cccc22222222", date: "2026-01-03T10:00:00Z", author: "grace", subject: "add fnX" },
    { idx: 3, sha: "dddd333333333333", shortSha: "dddd33333333", date: "2026-01-04T10:00:00Z", author: "grace", subject: "wire it" },
    { idx: 4, sha: "eeee444444444444", shortSha: "eeee44444444", date: "2026-01-05T10:00:00Z", author: "ada", subject: "polish" },
  ],
  nodes: [
    { id: "mod:a.py", type: "Module", label: "a.py", site: "a.py:1", born: 0, died: 4, touches: [0, 2], churn: 2, degree: 3 },
    { id: "fn:a.py#x", type: "Function", label: "x", site: "a.py:10-20", born: 2, died: 4, touches: [2, 4], churn: 2, degree: 2 },
    { id: "fn:a.py#gone", type: "Function", label: "gone", site: "a.py:30", born: 0, died: 2, touches: [0], churn: 1, degree: 1 },
    { id: "commit:cccc222222222222", type: "Commit", label: "cccc22222222", site: "", born: 2, died: 4, touches: [], churn: 0, commitIdx: 2, degree: 0 },
  ],
  edges: [
    { src: "mod:a.py", dst: "fn:a.py#x", kind: "defines", valid: [2, 4] },
    { src: "mod:a.py", dst: "fn:a.py#gone", kind: "defines", valid: [0, 2] },
    // "wired" at 3 between two nodes that both pre-existed 2 → rewired in (2,4]
    { src: "fn:a.py#x", dst: "mod:a.py", kind: "callsSymbol", valid: [3, 4] },
    { src: "commit:cccc222222222222", dst: "fn:a.py#x", kind: "touchesSymbol", valid: [2, 4] },
  ],
};

test("structuralDiff: added / removed / changed / wired across a range", () => {
  const d = structuralDiff(TG, 1, 4);
  assert.deepEqual(d.added, ["fn:a.py#x"]);            // born inside (1,4]
  assert.deepEqual(d.removed, ["fn:a.py#gone"]);       // died at 2 → alive at 1, not at 4
  assert.deepEqual(d.changed, ["mod:a.py"]);           // alive both ends, touched at 2
  assert.equal(d.wired.length, 2);                     // defines(x) + callsSymbol appeared
  assert.ok(d.wired.every((e) => e.kind !== "touchesSymbol")); // history edges excluded
  const rewired = d.wired.filter((e) => e.rewired);
  assert.equal(rewired.length, 0);                     // fn:x itself is new inside the range
  assert.deepEqual(d.unwired, [{ src: "mod:a.py", dst: "fn:a.py#gone", kind: "defines" }]);
});

test("structuralDiff: rewired marks new edges between PRE-EXISTING nodes; cursors normalize", () => {
  const d = structuralDiff(TG, 4, 2); // reversed cursors — must normalize to (2,4]
  assert.equal(d.lo, 2);
  assert.equal(d.hi, 4);
  const rewired = d.wired.filter((e) => e.rewired);
  assert.deepEqual(rewired.map((e) => e.kind), ["callsSymbol"]); // both endpoints born ≤ 2
  assert.deepEqual(d.added, []); // fn:x was already alive at 2 (inclusive)
});

test("structuralDiff: identical cursors → empty diff; Commit nodes never appear", () => {
  const d = structuralDiff(TG, 3, 3);
  assert.deepEqual([...d.added, ...d.removed, ...d.changed, ...d.wired, ...d.unwired], []);
  const wide = structuralDiff(TG, 0, 4);
  assert.ok(!wide.added.some((id) => id.startsWith("commit:")));
});

test("narrateCommit: deterministic — same input, same string, twice", () => {
  const a = narrateCommit(TG, 2);
  const b = narrateCommit(TG, 2);
  assert.equal(a, b);
  assert.match(a, /^cccc22222222 · 2026-01-03 · grace — add fnX/);
  assert.match(a, /added 1 Function: `x`/);
});

test("narrateCommit: rewiring and touch lines; ordinal 0 is the timeline start", () => {
  const wired = narrateCommit(TG, 3);
  assert.match(wired, /rewired: `x` —callsSymbol→ `a\.py`/);
  const first = narrateCommit(TG, 0);
  assert.match(first, /first commit on the timeline/);
});

test("narrateRange: totals over the two-cursor diff, deterministic", () => {
  const s = narrateRange(TG, 1, 4);
  assert.equal(s, narrateRange(TG, 4, 1)); // cursor order can't change the story
  assert.match(s, /bbbb11111111 → eeee44444444 \(3 commits\)/);
  assert.match(s, /\+1 added: `x`/);
  assert.match(s, /−1 removed: `gone`/);
  assert.match(s, /~1 changed: `a\.py`/);
});

test("matchQuery: type: filters, substring terms AND together, empty q is null", () => {
  assert.equal(matchQuery(TG, ""), null);
  assert.deepEqual([...matchQuery(TG, "type:function")].sort(), ["fn:a.py#gone", "fn:a.py#x"]);
  assert.deepEqual([...matchQuery(TG, "type:function gone")], ["fn:a.py#gone"]);
  assert.deepEqual([...matchQuery(TG, "a.py type:module")], ["mod:a.py"]);
  assert.equal(matchQuery(TG, "type:class nothing").size, 0); // no match → empty set, not null
});

test("resolveCursor: sha prefix beats ordinal; junk is null", () => {
  assert.equal(resolveCursor(TG, "cccc"), 2);
  assert.equal(resolveCursor(TG, "CCCC22"), 2); // case-insensitive
  assert.equal(resolveCursor(TG, "3"), 3);      // plain ordinal
  assert.equal(resolveCursor(TG, "99"), null);
  assert.equal(resolveCursor(TG, "zzz"), null);
  assert.equal(resolveCursor(TG, ""), null);
});

test("view-state codec: decode(encode(s)) round-trips; defaults encode to nothing", () => {
  const s = { q: "type:Class render", at: "cccc22222222", b: "eeee44444444", types: "Module,Class", deg: 4, sel: "fn:a.py#x", g: "1", heat: "1" };
  assert.deepEqual(decodeViewState(encodeViewState(s)), s);
  assert.equal(encodeViewState({ ...VIEW_DEFAULTS }), ""); // a default view is a bare URL
  // decode tolerates a leading '?', unknown keys, and the viewer's data= override
  const d = decodeViewState("?data=./x.json&q=render&deg=7&bogus=1");
  assert.equal(d.q, "render");
  assert.equal(d.deg, 7);
  assert.equal(d.at, "");
});

test("aliveAt re-export sanity (the scrub's core rule, inclusive both ends)", () => {
  assert.equal(aliveAt([2, 4], 2), true);
  assert.equal(aliveAt([2, 4], 5), false);
});

// ---- buildTemporalGraph: raw graph.json → temporal graph ------------------------
const RAW = {
  individuals: [
    { id: "mod:a.py", label: "a.py", class: "Module", attributes: [{ key: "site", value: "a.py:1" }] },
    { id: "fn:a.py#x", label: "x", class: "Function", attributes: [{ key: "site", value: "a.py:10-20" }] },
    { id: "mod:corpus/junk.py", label: "junk.py", class: "Module", attributes: [] },
    { id: "commit:aaaa000000000000", label: "aaaa00000000", class: "Commit",
      attributes: [{ key: "author", value: "ada" }, { key: "date", value: "2026-01-01" }, { key: "message", value: "init" }] },
    { id: "commit:bbbb111111111111", label: "bbbb11111111", class: "Commit",
      attributes: [{ key: "author", value: "grace" }, { key: "date", value: "2026-01-02" }, { key: "message", value: "add x" }] },
  ],
  objectProperties: [
    { prop: "seon:containsCodeEntity", examples: [{ subject: "mod:a.py", object: "fn:a.py#x" }] },
    { prop: "mgx:touchesSymbol", examples: [
      { subject: "commit:aaaa000000000000", object: "mod:a.py" },
      { subject: "commit:bbbb111111111111", object: "fn:a.py#x" },
    ] },
  ],
};
const ORDER = ["aaaa000000000000", "bbbb111111111111"];

test("buildTemporalGraph: intervals from touches, container-birth fallback, product scope", () => {
  const tg = buildTemporalGraph(RAW, ORDER);
  assert.equal(tg.commits.length, 2);
  assert.equal(tg.commits[1].subject, "add x");
  const ids = tg.nodes.map((n) => n.id);
  assert.ok(!ids.includes("mod:corpus/junk.py")); // product scope drops corpus/
  const modA = tg.nodes.find((n) => n.id === "mod:a.py");
  const fnX = tg.nodes.find((n) => n.id === "fn:a.py#x");
  assert.deepEqual([modA.born, modA.died], [0, 1]);
  assert.deepEqual([fnX.born, fnX.died], [1, 1]);   // born when first touched
  assert.ok(ids.includes("commit:aaaa000000000000")); // commits become diamond nodes
  const contains = tg.edges.find((e) => e.kind === "contains");
  assert.deepEqual(contains.valid, [1, 1]); // edge waits for BOTH endpoints
  // an explicit scope keeps only the named prefixes
  const scoped = buildTemporalGraph(RAW, ORDER, { scope: "corpus/" });
  assert.deepEqual(scoped.nodes.filter((n) => n.type !== "Commit").map((n) => n.id), ["mod:corpus/junk.py"]);
});

test("buildTemporalGraph: no commits at all still yields a usable (flat) graph", () => {
  const tg = buildTemporalGraph({ individuals: RAW.individuals.filter((i) => i.class !== "Commit"), objectProperties: [] }, []);
  assert.equal(tg.commits.length, 0);
  assert.ok(tg.nodes.every((n) => n.born === 0 && n.died === 0));
});

test("buildBrowserData: payload = temporal graph + repo-specific config", () => {
  const tg = buildTemporalGraph(RAW, ORDER);
  const data = buildBrowserData(tg, { repoUrl: "https://gitlab.com/acme/proj/", repoRef: "dev", siteNav: true });
  assert.equal(data.repoUrl, "https://gitlab.com/acme/proj");
  assert.equal(data.repoRef, "dev");
  assert.equal(data.siteNav, true);
  assert.ok(Array.isArray(data.commits) && Array.isArray(data.nodes) && Array.isArray(data.edges));
});

// ---- P4: cross-repo awareness ---------------------------------------------------

test("repoOfId: first path component is the repo prefix; unprefixed ids → null", () => {
  assert.equal(repoOfId("mod:repo-a/pkg/alpha.py"), "repo-a");
  assert.equal(repoOfId("fn:repo-b/lib/gamma.py#gamma_util"), "repo-b"); // stops at the # symbol part
  assert.equal(repoOfId("mod:a.py"), null);            // single-repo id, no '/'
  assert.equal(repoOfId("commit:aaaa000000000000"), null);
  assert.equal(repoOfId("garbage"), null);
});

test("assignRepo: majority prefix wins; ties break lexicographically; empty → null", () => {
  assert.equal(assignRepo(new Map([["repo-a", 2], ["repo-b", 1]])), "repo-a");
  assert.equal(assignRepo(new Map([["z", 1], ["a", 1]])), "a"); // tie → lexicographic
  assert.equal(assignRepo(new Map()), null);
});

test("isMultiRepo: ≥2 sole prefixes + majority-confined commits → true; a monorepo → false", () => {
  // two repos, each commit confined to one prefix
  assert.equal(isMultiRepo([new Map([["x", 3]]), new Map([["y", 1]])]), true);
  // a single monorepo: every commit spans several top-level dirs → never fires
  assert.equal(isMultiRepo([new Map([["src", 1], ["test", 1]]), new Map([["src", 2], ["docs", 1]])]), false);
  // only one repo present → not multi
  assert.equal(isMultiRepo([new Map([["x", 1]]), new Map([["x", 2]])]), false);
  // cross-prefix commits outnumber the confined ones → not multi (guards false-positives)
  assert.equal(isMultiRepo([new Map([["x", 1]]), new Map([["x", 1], ["y", 1]]), new Map([["y", 1], ["x", 1]])]), false);
  // empty (no history) → not multi
  assert.equal(isMultiRepo([new Map(), new Map()]), false);
});

// A merged 2-repo raw graph (ids carry `mod:<repo>/…` prefixes; commits unprefixed,
// dated so the global axis interleaves the two histories: x1 < y1 < x2).
const MERGED = {
  individuals: [
    { id: "mod:repo-x/a.py", label: "repo-x/a.py", class: "Module", attributes: [] },
    { id: "fn:repo-x/a.py#f", label: "f", class: "Function", attributes: [] },
    { id: "mod:repo-y/b.py", label: "repo-y/b.py", class: "Module", attributes: [] },
    { id: "fn:repo-y/b.py#g", label: "g", class: "Function", attributes: [] },
    // repo-z has a module but NO commits — the zero-commit-repo case must not break anything.
    { id: "mod:repo-z/c.py", label: "repo-z/c.py", class: "Module", attributes: [] },
    { id: "commit:x1aaaaaaaaaaaa", label: "x1", class: "Commit",
      attributes: [{ key: "author", value: "ann" }, { key: "date", value: "2026-01-01" }, { key: "message", value: "x first" }] },
    { id: "commit:y1bbbbbbbbbbbb", label: "y1", class: "Commit",
      attributes: [{ key: "author", value: "ben" }, { key: "date", value: "2026-01-02" }, { key: "message", value: "y first" }] },
    { id: "commit:x2cccccccccccc", label: "x2", class: "Commit",
      attributes: [{ key: "author", value: "ann" }, { key: "date", value: "2026-01-03" }, { key: "message", value: "x second" }] },
  ],
  objectProperties: [
    { prop: "seon:containsCodeEntity", examples: [
      { subject: "mod:repo-x/a.py", object: "fn:repo-x/a.py#f" },
      { subject: "mod:repo-y/b.py", object: "fn:repo-y/b.py#g" },
    ] },
    { prop: "mgx:touchesSymbol", examples: [
      { subject: "commit:x1aaaaaaaaaaaa", object: "mod:repo-x/a.py" },
      { subject: "commit:x2cccccccccccc", object: "fn:repo-x/a.py#f" },
      { subject: "commit:y1bbbbbbbbbbbb", object: "mod:repo-y/b.py" },
    ] },
  ],
};

test("buildTemporalGraph: merged graph is date-ordered across repos, commits tagged by repo, meta.repos set", () => {
  // Pass a DELIBERATELY WRONG order (not date order) — a merge must re-derive its own
  // global date axis and ignore it.
  const tg = buildTemporalGraph(MERGED, ["x2cccccccccccc", "x1aaaaaaaaaaaa", "y1bbbbbbbbbbbb"]);
  assert.equal(tg.meta.multi_repo, true);
  assert.deepEqual(tg.meta.repos, ["repo-x", "repo-y"]); // repo-z has no commits → not listed
  assert.deepEqual(tg.commits.map((c) => c.shortSha.slice(0, 2)), ["x1", "y1", "x2"]); // by date, interleaved
  assert.deepEqual(tg.commits.map((c) => c.repo), ["repo-x", "repo-y", "repo-x"]);
  // commit diamond nodes and symbol nodes both carry their repo on a merged graph
  const cx1 = tg.nodes.find((n) => n.id === "commit:x1aaaaaaaaaaaa");
  assert.equal(cx1.repo, "repo-x");
  assert.equal(tg.nodes.find((n) => n.id === "mod:repo-y/b.py").repo, "repo-y");
  assert.equal(tg.nodes.find((n) => n.id === "mod:repo-z/c.py").repo, "repo-z"); // zero-commit repo still tagged
});

test("buildTemporalGraph: single-repo graph gets NO repo tags or multi_repo marker (byte-identical fields)", () => {
  const tg = buildTemporalGraph(RAW, ORDER);
  assert.equal(tg.meta.multi_repo, undefined);
  assert.equal("repos" in tg.meta, false);
  assert.equal(tg.meta.commit_order, "oldest-first (ordinal 0 = oldest, N-1 = HEAD)");
  assert.ok(tg.commits.every((c) => !("repo" in c)));
  assert.ok(tg.nodes.every((n) => !("repo" in n)));
});

test("gitCommitOrder: not-a-git-repo + datesBySha → global chronological order (merged fallback)", async () => {
  const dates = new Map([["x2cccccccccccc", "2026-01-03"], ["x1aaaaaaaaaaaa", "2026-01-01"], ["y1bbbbbbbbbbbb", "2026-01-02"]]);
  const ids = ["commit:x2cccccccccccc", "commit:x1aaaaaaaaaaaa", "commit:y1bbbbbbbbbbbb"];
  const order = await gitCommitOrder("/nonexistent-path-not-a-repo-xyz", ids, { datesBySha: dates });
  assert.deepEqual(order, ["x1aaaaaaaaaaaa", "y1bbbbbbbbbbbb", "x2cccccccccccc"]);
  // no dates → the existing graph-order fallback (never throws)
  const bare = await gitCommitOrder("/nonexistent-path-not-a-repo-xyz", ids);
  assert.equal(bare.length, 3);
});
