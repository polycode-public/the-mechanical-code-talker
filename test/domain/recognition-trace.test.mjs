// recognition-trace.test.mjs — reading an observed trace back from an
// executed call list, played @turnN world rows, or a plan-lane's @stepN
// board rows. Pure, read-only, deterministic regardless of row order.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRACE, resolveRecognitionConfig, traceOfCalls, traceOfWorldRows, traceOfBoardRows,
} from "../../src/domain/router/recognize.mjs";

test("an executed call list reads back as one step per call, oldest first", () => {
  const calls = [
    { name: "tmct_impact", input: { symbol: "a.mjs" } },
    { name: "tmct_untested", input: {} },
  ];
  assert.deepEqual(traceOfCalls(calls), [
    { k: 1, actor: "caller", op: "tmct_impact", args: { symbol: "a.mjs" }, kind: "capability" },
    { k: 2, actor: "caller", op: "tmct_untested", args: {}, kind: "capability" },
  ]);
});

test("a tool_use block list reads back the same way a call list does", () => {
  const blocks = [{ name: "tmct_search", input: { query: "foo" } }];
  assert.deepEqual(traceOfCalls(blocks, { actor: "assistant" }), [
    { k: 1, actor: "assistant", op: "tmct_search", args: { query: "foo" }, kind: "capability" },
  ]);
});

test("@turnN world rows fold to one step per effect, ordered by turn", () => {
  const rows = [
    { subject: "player@turn2", predicate: "mgx:currently-in", object: "hall" },
    { subject: "player@turn1", predicate: "mgx:currently-in", object: "study" },
  ];
  assert.deepEqual(traceOfWorldRows(rows), [
    { k: 1, actor: "player", op: "mgx:currently-in", args: { object: "study" }, kind: "world-effect" },
    { k: 2, actor: "player", op: "mgx:currently-in", args: { object: "hall" }, kind: "world-effect" },
  ]);
});

test("a recast world reads only the current epoch's snapshots", () => {
  const rows = [
    { subject: "player@turn9", predicate: "mgx:currently-in", object: "attic" },
    { subject: "player@epoch1@turn1", predicate: "mgx:currently-in", object: "hall" },
  ];
  assert.deepEqual(traceOfWorldRows(rows), [
    { k: 1, actor: "player", op: "mgx:currently-in", args: { object: "hall" }, kind: "world-effect" },
  ]);
});

test("the trace cap drops the oldest steps and keeps the newest", () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ subject: `player@turn${n}`, predicate: "mgx:currently-in", object: `room${n}` }));
  const trace = traceOfWorldRows(rows, { maxTrace: 2 });
  assert.deepEqual(trace.map((s) => s.args.object), ["room4", "room5"]);
  assert.deepEqual(trace.map((s) => s.k), [1, 2]);
});

test("the same rows in a different order produce the same trace", () => {
  const rows = [1, 2, 3, 4].map((n) => ({ subject: `player@turn${n}`, predicate: "mgx:currently-in", object: `room${n}` }));
  const shuffled = [rows[2], rows[0], rows[3], rows[1]];
  assert.deepEqual(traceOfWorldRows(rows), traceOfWorldRows(shuffled));
});

test("an empty or unstamped row set yields no steps rather than throwing", () => {
  assert.deepEqual(traceOfWorldRows(null), []);
  assert.deepEqual(traceOfWorldRows(undefined), []);
  assert.deepEqual(traceOfWorldRows([]), []);
  assert.deepEqual(traceOfWorldRows([{ subject: "player", predicate: "mgx:currently-in", object: "hall" }]), []);
  assert.deepEqual(traceOfCalls(null), []);
  assert.deepEqual(traceOfCalls([]), []);
  assert.deepEqual(traceOfBoardRows(null), []);
  assert.deepEqual(traceOfBoardRows([]), []);
  assert.deepEqual(traceOfBoardRows([{ subject: "disk-1", predicate: "mgx:on-top-of", object: "peg-a" }]), []);
});

test("@stepN board rows fold to one step per effect, ordered by step", () => {
  const rows = [
    { subject: "disk-1@step2", predicate: "mgx:on-top-of", object: "peg-c" },
    { subject: "disk-1@step1", predicate: "mgx:on-top-of", object: "peg-b" },
  ];
  assert.deepEqual(traceOfBoardRows(rows), [
    { k: 1, actor: "planner", op: "mgx:on-top-of", args: { object: "peg-b" }, kind: "world-effect" },
    { k: 2, actor: "planner", op: "mgx:on-top-of", args: { object: "peg-c" }, kind: "world-effect" },
  ]);
});

test("a maxTrace of 0 or a non-integer yields no steps", () => {
  const rows = [{ subject: "player@turn1", predicate: "mgx:currently-in", object: "hall" }];
  assert.deepEqual(traceOfWorldRows(rows, { maxTrace: 0 }), []);
  assert.deepEqual(traceOfWorldRows(rows, { maxTrace: 1.5 }), []);
  assert.deepEqual(traceOfWorldRows(rows, { maxTrace: "9" }), []);
  const calls = [{ name: "tmct_impact", input: {} }];
  assert.deepEqual(traceOfCalls(calls, { maxTrace: 0 }), []);
});

test("resolveRecognitionConfig: the [recognition] max_trace knob overrides the default; junk falls back", () => {
  assert.deepEqual(resolveRecognitionConfig(null), { maxTrace: MAX_TRACE });
  assert.deepEqual(resolveRecognitionConfig({}), { maxTrace: MAX_TRACE });
  assert.deepEqual(resolveRecognitionConfig({ recognition: { max_trace: 3 } }), { maxTrace: 3 });
  assert.deepEqual(resolveRecognitionConfig({ recognition: { max_trace: 0 } }), { maxTrace: MAX_TRACE });
  assert.deepEqual(resolveRecognitionConfig({ recognition: { max_trace: "9" } }), { maxTrace: MAX_TRACE });
});
