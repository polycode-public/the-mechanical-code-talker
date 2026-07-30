// A caller that hands runTurn a graph means THAT graph — an in-process session
// (a page's own world facts) has no graph file for the tool layer to re-read, so
// the ask lane has to use what it was given from the very first turn.
//
// The failure this pins: the direct-ask branch used to be gated on session
// history (a standing focus, or a previous turn's result set), so a cold turn
// against a perfectly good caller-supplied graph fell through to the tool layer,
// read the config's absent graph, and refused with "no code graph is loaded" —
// then started answering correctly once any focus happened to be set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";

const worldGraph = () => parseEntities({
  individuals: [
    { id: "fly-1", label: "fly-1", class: "Fly" },
    { id: "fly-2", label: "fly-2", class: "Fly" },
    { id: "cell-7-1", label: "cell-7-1", class: "Cell" },
  ],
  objectProperties: [
    { predicate: "mgx:in", count: 1, examples: [{ subject: "fly-1", object: "cell-7-1" }] },
  ],
});

test("the very first turn of a session answers from the caller's own graph, with no config graph anywhere", async () => {
  const r = await runTurn("list the flies", { graph: worldGraph(), sessionId: "cold" });
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /fly-1/);
  assert.match(r.answer, /fly-2/);
  assert.doesNotMatch(r.answer, /no code graph/i, "a graph was handed in, so nothing may claim none is loaded");
});

test("a caller-supplied graph holding nothing still refuses honestly rather than inventing a member", async () => {
  const empty = parseEntities({ individuals: [], objectProperties: [] });
  const r = await runTurn("list the flies", { graph: empty, sessionId: "cold-empty" });
  assert.equal(r.record?.miss, true, r.answer);
  assert.doesNotMatch(r.answer, /fly-1|fly-2/);
});
