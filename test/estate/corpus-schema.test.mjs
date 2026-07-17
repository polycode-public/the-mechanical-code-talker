import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lanePredicates, readLaneRows, validateRow } from "../corpus/run-lane.mjs";
import { corpusLanes } from "../../src/adapters/corpus-lanes.mjs";

const CORPUS_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "corpus");

const laneNames = corpusLanes(CORPUS_DIR);

test("every row of every corpus lane conforms to the row schema", async () => {
  const problems = [];
  for (const lane of laneNames) {
    const predicateNames = Object.keys(await lanePredicates(lane));
    for (const [i, row] of readLaneRows(lane).entries()) {
      for (const problem of validateRow(row, predicateNames)) {
        problems.push(`${lane}.jsonl row ${i + 1} (${row?.id ?? "no id"}): ${problem}`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("the validator accepts a well-formed chat row", () => {
  assert.deepEqual(
    validateRow({
      id: "greet-hello",
      key: "conversational.greeting",
      setup: { teach: ["every module is a component"], memoryBackend: "memory" },
      turns: ["hello"],
      expect: [
        { turn: 0, mode: "regex", value: "\\w" },
        { turn: 0, mode: "predicate", value: { name: "answerIncludes", arg: "" } },
      ],
    }),
    [],
  );
});

test("the validator accepts a well-formed bench-smoke row", () => {
  assert.deepEqual(
    validateRow({
      id: "chatbench-one-case",
      key: "bench.cefr",
      run: { script: "chatbench/run.mjs", args: ["--limit", "1"], predicate: "answerIncludes" },
    }),
    [],
  );
});

test("the validator rejects a missing id, an unknown mode, an out-of-range turn and an unknown predicate", () => {
  const problems = validateRow({
    key: "conversational.greeting",
    turns: ["hello"],
    expect: [
      { turn: 3, mode: "fuzzy", value: "hi" },
      { turn: 0, mode: "predicate", value: "noSuchPredicate" },
    ],
  });
  assert.ok(problems.some((p) => p.startsWith("id:")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("expect[0].turn")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("expect[0].mode")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("noSuchPredicate")), problems.join("\n"));
});
