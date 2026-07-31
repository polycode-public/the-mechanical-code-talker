// The ambiguity refusal: when two referents admit the same singular form and
// share a registration turn, recency cannot order them, so the temporal
// comparison lane refuses and lists them ("'that' could mean A or B — which do
// you mean?") rather than silently picking one. The pure bind() branch is
// exercised directly on a synthetic same-turn record, then driven through
// runTurn against the committed mini-webapp graph. No real chat lane registers
// two same-turn singular referents yet (that arrives with superlative-winner
// registration), so the record is hand-built on purpose. The plural sibling at
// the foot does the same for a `set` referent and the plural lane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { emptyRecord, advanceTurn, register, bind } from "../../src/domain/discourse.mjs";

/** A complete event referent spec — the commit-filter pivot shape. */
const eventSpec = (over = {}) => ({
  kind: "event", class: "Commit", label: "1b2c3d4e5f60",
  ids: ["commit:1b2c3d4e5f60"], attrs: { date: "2026-05-24" },
  from: { lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  ...over,
});

/** Two events registered in one turn — the synthetic same-turn tie. */
function sameTurnPair() {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, eventSpec());
  rec = register(rec, eventSpec({ label: "e5f6a1b2c3d4", ids: ["commit:e5f6a1b2c3d4"], attrs: { date: "2026-05-15" } }));
  return rec;
}

test("a genuine same-turn tie returns both candidates instead of a pick", () => {
  const tied = bind(sameTurnPair(), "that", { tieRefuses: true });
  assert.equal(tied.referent, undefined, "no referent is picked");
  assert.equal(tied.tie.length, 2);
  assert.deepEqual(tied.tie.map((r) => r.label).sort(), ["1b2c3d4e5f60", "e5f6a1b2c3d4"]);
});

test("a clear case still resolves by recency, unaffected by tieRefuses being set", () => {
  // Only one referent admits the singular form.
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, eventSpec());
  const single = bind(rec, "that", { tieRefuses: true });
  assert.equal(single.referent.label, "1b2c3d4e5f60");
  assert.equal(single.tie, undefined);

  // Two referents from DIFFERENT turns: recency decides, no tie.
  rec = advanceTurn(rec);
  rec = register(rec, eventSpec({ label: "0a1b2c3d4e5f", ids: ["commit:0a1b2c3d4e5f"], attrs: { date: "2026-05-21" } }));
  const recent = bind(rec, "that", { tieRefuses: true });
  assert.equal(recent.referent.label, "0a1b2c3d4e5f", "the later turn's referent wins");
  assert.equal(recent.tie, undefined);
  assert.equal(recent.candidates.length, 2);
});

const GRAPH_FILE = join(new URL("../..", import.meta.url).pathname, "examples", "mini-webapp", ".tmct", "graph.json");

let graph;
test.before(async () => {
  graph = parseEntities(JSON.parse(await readFile(GRAPH_FILE, "utf8")));
});

test("the temporal-comparison lane refuses and lists a same-turn tie rather than composing", async () => {
  const r = await runTurn("was that before logger.mjs was touched", {
    config: { graphFile: GRAPH_FILE }, graph, discourse: sameTurnPair(),
  });
  assert.match(String(r.answer), /^"that" could mean e5f6a1b2c3d4 or 1b2c3d4e5f60 — which do you mean\?/);
  assert.doesNotMatch(String(r.answer), /came (?:before|after)|landed on the same day/, "it never composes a comparison over a tie");
});

/** A complete set referent spec — the shape a listing/filter answer registers. */
const setSpec = (over = {}) => ({
  kind: "set", class: "Commit", label: "2 commits",
  ids: ["commit:1b2c3d4e5f60", "commit:e5f6a1b2c3d4"], attrs: { count: 2 },
  from: { lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  ...over,
});

/** Two sets registered in one turn — the plural synthetic tie. */
function sameTurnSetPair() {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, setSpec());
  rec = register(rec, setSpec({ label: "3 commits", ids: ["commit:0a1b2c3d4e5f"], attrs: { count: 3 } }));
  return rec;
}

test("two sets sharing a registration turn tie on the plural forms too", () => {
  const tied = bind(sameTurnSetPair(), "those", { tieRefuses: true });
  assert.equal(tied.referent, undefined, "no set is picked");
  assert.equal(tied.tie.length, 2);
  assert.deepEqual(tied.tie.map((r) => r.label).sort(), ["2 commits", "3 commits"]);
});

test("the plural temporal-comparison lane refuses and lists a same-turn set tie", async () => {
  const r = await runTurn("were those before logger.mjs was touched", {
    config: { graphFile: GRAPH_FILE }, graph, discourse: sameTurnSetPair(),
  });
  assert.match(String(r.answer), /^"those" could mean 3 commits or 2 commits — which set do you mean\?/);
  assert.doesNotMatch(String(r.answer), /\bof the\b|all \d|none of/, "it never quantifies over a tie");
});
