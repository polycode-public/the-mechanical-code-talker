// hanoi-board.test.mjs — the towers-of-hanoi board projection: a solved plan
// at one step in, board-shaped fact rows and an ask()-traversable graph out.
//
// Two halves, the same split ask-world-relation.test.mjs draws. The first
// drives the pure functions over a hand-built plan, so the derivations (the
// support chain, the top disk, the declared/undeclared class rule) are checked
// without an engine running. The second boots the REAL plan session, solves a
// puzzle, and asks the projected board questions through ask().
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { WORLD_RELATIONS } from "../../src/domain/ask-vocab.mjs";
import {
  hanoiBoardRows, hanoiBoardGraphPayload, hanoiMoveId,
  HANOI_BOARD_RELATIONS, HANOI_MOVE_CLASS,
} from "../../src/domain/hanoi-board.mjs";

const PLAN = {
  actions: [
    { name: "move onto", subject: "disk-1", target: "peg-c", label: "move disk-1 onto peg-c" },
    { name: "move onto", subject: "disk-2", target: "peg-b", label: "move disk-2 onto peg-b" },
  ],
  states: [
    [
      { subject: "disk-1", predicate: "mgx:rest-on", object: "disk-2" },
      { subject: "disk-2", predicate: "mgx:rest-on", object: "peg-a" },
    ],
    [
      { subject: "disk-1", predicate: "mgx:rest-on", object: "peg-c" },
      { subject: "disk-2", predicate: "mgx:rest-on", object: "peg-a" },
    ],
    [
      { subject: "disk-1", predicate: "mgx:rest-on", object: "peg-c" },
      { subject: "disk-2", predicate: "mgx:rest-on", object: "peg-b" },
    ],
  ],
  domain: {
    classMembers: {
      disk: ["disk-1", "disk-2"],
      peg: ["peg-a", "peg-b", "peg-c"],
      // the whole memory's taxonomy reaches this field, not just the puzzle's
      horse: ["dobbin"],
    },
    ordering: [{ subject: "disk-1", predicate: "mgx:smaller-than", object: "disk-2" }],
    renderHints: { disk: "block", peg: "slot" },
  },
  goal: { text: "every disk rests on peg-c" },
};

const rowsAt = (step) => hanoiBoardRows({ plan: PLAN, step });
const triples = (rows, predicate) =>
  rows.filter((r) => r.predicate === predicate).map((r) => `${r.subject} ${r.object}`).sort();
const graphAt = (step) => parseEntities(hanoiBoardGraphPayload(rowsAt(step)));

test("placement chases the support chain down to the peg a disk is standing on", () => {
  const place = HANOI_BOARD_RELATIONS.placement.predicate;
  assert.deepEqual(triples(rowsAt(0), place), ["disk-1 peg-a", "disk-2 peg-a"]);
  assert.deepEqual(triples(rowsAt(1), place), ["disk-1 peg-c", "disk-2 peg-a"]);
  assert.deepEqual(triples(rowsAt(2), place), ["disk-1 peg-c", "disk-2 peg-b"]);
});

test("the position rows are the plan's own state at that step, copied not restated", () => {
  assert.deepEqual(triples(rowsAt(0), HANOI_BOARD_RELATIONS.support.predicate), ["disk-1 disk-2", "disk-2 peg-a"]);
});

test("a peg's top disk is the one nothing rests on, and an empty peg gets no row", () => {
  const top = HANOI_BOARD_RELATIONS.topDisk.predicate;
  assert.deepEqual(triples(rowsAt(0), top), ["peg-a disk-1"]);
  assert.deepEqual(triples(rowsAt(2), top), ["peg-b disk-2", "peg-c disk-1"]);
});

test("a declared class contributes every member; an undeclared one contributes none the plan never names", () => {
  const typed = rowsAt(0).filter((r) => r.predicate === "rdf:type");
  const byClass = (cls) => typed.filter((r) => r.object === cls).map((r) => r.subject).sort();
  assert.deepEqual(byClass("disk"), ["disk-1", "disk-2"]);
  assert.deepEqual(byClass("peg"), ["peg-a", "peg-b", "peg-c"]);
  assert.deepEqual(byClass("horse"), []);
});

test("the whole solution's moves travel, numbered the way the movelist numbers them", () => {
  const rows = rowsAt(1);
  assert.deepEqual(triples(rows, HANOI_BOARD_RELATIONS.movesDisk.predicate), ["move-1 disk-1", "move-2 disk-2"]);
  assert.deepEqual(triples(rows, HANOI_BOARD_RELATIONS.movesOnto.predicate), ["move-1 peg-c", "move-2 peg-b"]);
  assert.equal(hanoiMoveId(0), "move-1");
});

test("the taught size order travels as its own relation", () => {
  assert.deepEqual(triples(rowsAt(0), HANOI_BOARD_RELATIONS.size.predicate), ["disk-1 disk-2"]);
});

test("an out-of-range step clamps onto the nearest real position", () => {
  assert.deepEqual(rowsAt(99), rowsAt(2));
  assert.deepEqual(rowsAt(-4), rowsAt(0));
});

test("a support chain that loops back on itself invents no peg for it", () => {
  const looped = {
    domain: PLAN.domain,
    actions: [],
    states: [[
      { subject: "disk-1", predicate: "mgx:rest-on", object: "disk-2" },
      { subject: "disk-2", predicate: "mgx:rest-on", object: "disk-1" },
    ]],
  };
  const rows = hanoiBoardRows({ plan: looped, step: 0 });
  assert.deepEqual(triples(rows, HANOI_BOARD_RELATIONS.placement.predicate), []);
});

test("the projection classes only what a type row names, and never invents one for an edge's object", () => {
  const payload = hanoiBoardGraphPayload(rowsAt(0));
  const classOf = Object.fromEntries(payload.individuals.map((i) => [i.id, i.class]));
  assert.equal(classOf["disk-1"], "disk");
  assert.equal(classOf["peg-b"], "peg");
  assert.equal(classOf["move-1"], HANOI_MOVE_CLASS);
  assert.equal(classOf.dobbin, undefined);
  for (const ind of payload.individuals) assert.equal(ind.label, ind.id);
});

test("the placement predicate is the same one the world-relation listing grammar reads", () => {
  assert.equal(HANOI_BOARD_RELATIONS.placement.predicate, WORLD_RELATIONS.placement.predicate);
});

test("ask() reads the projected board: locations move with the step, counts come off the classes", () => {
  assert.equal(ask(graphAt(0), "list the locations of disks").content, "disk-1 is in peg-a; disk-2 is in peg-a.");
  assert.equal(ask(graphAt(2), "list the locations of disks").content, "disk-1 is in peg-c; disk-2 is in peg-b.");
  assert.equal(ask(graphAt(0), "list the pegs").content, "peg-a, peg-b and peg-c.");
  assert.equal(ask(graphAt(0), "how many disks are there").tmct_ask.miss, false);
  assert.equal(ask(graphAt(0), "list the moves").content, "move-1 and move-2.");
});

test("'where are the disks' reads the board, not a did-you-mean over the disks' own names", () => {
  for (const q of ["where are the disks", "where is the disk"]) {
    const r = ask(graphAt(0), q);
    assert.equal(r.tmct_ask.ambiguous, false, q);
    assert.equal(r.content, "disk-1 is in peg-a; disk-2 is in peg-a.", q);
  }
  assert.equal(ask(graphAt(2), "where are the disks").content, "disk-1 is in peg-c; disk-2 is in peg-b.");
});

test("a tie the board cannot place names the pieces' own class, and each preview names one piece", () => {
  // Pegs carry no placement of their own, so the class lanes have no answer and
  // the name tie stands — as pegs, and with no candidate's label doubled back
  // onto itself.
  const r = ask(graphAt(0), "where is the peg");
  assert.equal(r.tmct_ask.ambiguous, true);
  assert.match(r.content, /matches more than one peg ambiguously/);
  for (const peg of ["peg-a", "peg-b", "peg-c"]) assert.ok(!r.content.includes(`${peg}-`), r.content);
});

test("ask() over the board still misses honestly on what the puzzle does not hold", () => {
  const graph = graphAt(0);
  assert.equal(ask(graph, "list the locations of horses").tmct_ask.miss, true);
  assert.equal(ask(graph, "list the moods of disks").tmct_ask.miss, true);
});

test("a live plan session answers board questions over its own solved puzzle", async () => {
  const { createPlanSession } = await import("../../src/surfaces/web/plan-browser-entry.mjs");
  const session = await createPlanSession({ diskCount: 3, maxDepth: 300 });
  assert.ok(session.plan, "sanity: a 3-disk puzzle should solve within 300 moves");

  const start = ask(session.boardGraph, "list the locations of disks");
  assert.equal(start.tmct_ask.miss, false);
  assert.equal(start.content, "disk-1 is in peg-a; disk-2 is in peg-a; disk-3 is in peg-a.");

  const asked = ask(session.boardGraph, "where are the disks");
  assert.equal(asked.tmct_ask.ambiguous, false);
  assert.equal(asked.content, start.content);

  session.showBoard({ step: session.plan.actions.length });
  const solved = ask(session.boardGraph, "list the locations of disks");
  assert.equal(solved.content, "disk-1 is in peg-c; disk-2 is in peg-c; disk-3 is in peg-c.");
  assert.equal(ask(session.boardGraph, "where are the disks").content, solved.content);
  assert.equal(ask(session.boardGraph, "how many moves are there").tmct_ask.miss, false);
});
