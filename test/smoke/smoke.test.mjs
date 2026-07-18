// The 1-second tier: one assertion per capability family, chosen so a failure here
// means the build is broken rather than subtly wrong. Everything runs in one file so
// there is no second process to pay for.
//
// Most of this drives ask() against a fixture graph built in memory, the same shape
// test/tools/ask.test.mjs uses and for the same reason: it is the cheapest real
// evidence in the estate (~3ms an assertion). The teach/proof family cannot be bought
// that cheaply — teaching needs a grounded store, and createSession is the only path
// that assembles one — so it pays for a single session and every teach assertion
// shares it. test/smoke/budget.test.mjs is what holds that trade honest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { driveSessionTurns } from "../helpers/session.mjs";

const MODULES = [
  { path: "src/logging.mjs", dotted: "src.logging", imports: [], calls: [],
    defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
  { path: "myFile.mjs", dotted: "myFile", imports: ["src.logging"], calls: [],
    defines: [{ name: "startup", kind: "function", lineno: 3, decorators: [] }] },
  { path: "src/someOtherFile.mjs", dotted: "src.someOtherFile", imports: ["src.logging"], calls: [],
    defines: [{ name: "myFunc", kind: "function", lineno: 5, decorators: [] }] },
  { path: "src/unrelated.mjs", dotted: "src.unrelated", imports: [], calls: [],
    defines: [{ name: "noop", kind: "function", lineno: 1, decorators: [] }] },
];
const graph = parseEntities(buildEntities(MODULES, [], {}));

// ---- direction: the invariant the whole query engine rests on ----

test("a forward query reads the edges out of the named module", () => {
  const { tmct_ask } = ask(graph, "what does myFile.mjs import");
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.parsed.shape, "forward");
  assert.deepEqual(tmct_ask.matches.map((m) => m.label), ["src/logging.mjs"]);
});

test("a reverse query reads the edges into the named module", () => {
  const { tmct_ask } = ask(graph, "which modules import src/logging.mjs");
  assert.equal(tmct_ask.miss, false);
  assert.equal(tmct_ask.parsed.shape, "reverse");
  assert.deepEqual(
    tmct_ask.matches.map((m) => m.label).sort(),
    ["myFile.mjs", "src/someOtherFile.mjs"],
  );
});

test("forward and reverse over one module disagree — the direction is real, not decorative", () => {
  const fwd = ask(graph, "what does myFile.mjs import").tmct_ask;
  const rev = ask(graph, "which modules import myFile.mjs").tmct_ask;
  assert.notDeepEqual(fwd.matches.map((m) => m.label), rev.matches.map((m) => m.label));
});

// ---- the miss wall: the honesty machinery's load-bearing half ----

test("an unknown symbol lands on the miss wall instead of resolving to something near it", () => {
  const { tmct_ask } = ask(graph, "what imports qqqzzz");
  assert.equal(tmct_ask.miss, true);
  assert.equal(tmct_ask.matches.length, 0);
});

test("a term that narrows to several candidates asks which, rather than picking one", () => {
  // "src" places in three module labels alike, so the tie is a real ambiguity
  // between readings (a term carrying words NO candidate accounts for declines
  // instead — that residue guard has its own pins)
  const { tmct_ask } = ask(graph, "what imports src");
  assert.equal(tmct_ask.ambiguous, true);
  assert.equal(tmct_ask.matches.length, 0);
});

test("an empty graph says it is empty rather than answering from nothing", () => {
  const empty = parseEntities(buildEntities([], [], {}));
  const { tmct_ask } = ask(empty, "what does myFile.mjs import");
  assert.equal(tmct_ask.miss, true);
});

// ---- the canonical restatement: what makes a misreading visible ----

test("an answered query restates the shape it actually ran", () => {
  const { tmct_ask } = ask(graph, "which modules import src/logging.mjs");
  assert.match(tmct_ask.traversal, /imports edges where object = src\/logging\.mjs/);
});

// ---- teach, recall and proof: one session, shared by every assertion below ----

test("teach, recall and a two-hop proof survive a real session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-smoke-"));
  try {
    const turns = await driveSessionTurns(
      { repoPath: dir, env: { TMCT_NO_SEED: "1" } },
      ["john is a man", "every man is mortal", "is john mortal", "is john a giraffe"],
    );
    assert.match(turns[0].answer, /^noted — remembered: john is a kind of man/);
    assert.match(turns[1].answer, /^noted — remembered: man is a kind of mortal/);
    // the two-hop proof cites both premises it chained, not just its verdict
    assert.match(turns[2].answer, /^yes —/);
    assert.match(turns[2].answer, /john is a kind of man/);
    assert.match(turns[2].answer, /man is a kind of mortal/);
    // and a fact nobody taught is not invented to fill the gap
    assert.doesNotMatch(turns[3].answer, /^yes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
