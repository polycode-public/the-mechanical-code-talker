// The code explorer's chat session answers over BOTH stores it seeds: the
// code graph (through source.mjs's provider seam) and an optional serialized
// memory payload — the same shape chat.html's seed asset carries — so one
// session grounds "what does a.mjs import" and "what is a <taught term>"
// alike, and a fact taught in one session survives the payload round-trip
// into the next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCodeExplorerSession } from "../../src/surfaces/web/code-explorer-browser-entry.mjs";

const graphPayload = {
  individuals: [
    { id: "mod:src/a.mjs", label: "src/a.mjs", class: "Module" },
    { id: "mod:src/b.mjs", label: "src/b.mjs", class: "Module" },
  ],
  objectProperties: [
    {
      predicate: "imports",
      prop: "mgx:importsNamespace",
      count: 1,
      examples: [{ subject: "mod:src/a.mjs", object: "mod:src/b.mjs", subjectLabel: "src/a.mjs", objectLabel: "src/b.mjs" }],
    },
  ],
};

test("a graph question answers from the registered code graph", async () => {
  const session = createCodeExplorerSession({ graphPayload });
  const res = await session.turn("what does src/a.mjs import");
  assert.match(res.answer, /src\/b\.mjs/, "the import edge grounds the answer");
});

test("a seeded memory payload answers general-knowledge questions beside the graph lanes, in the same session", async () => {
  const teacher = createCodeExplorerSession({ graphPayload });
  await teacher.turn("every container is a thing");
  const taught = await teacher.turn("every zorbcase is a container");
  assert.doesNotMatch(taught.answer, /couldn't store/i, "the teach turn lands");

  const seedPayload = structuredClone(teacher.memoryDir.payload);
  const seeded = createCodeExplorerSession({ graphPayload, seedPayload, vocabSeeded: true });

  const recall = await seeded.turn("what is a zorbcase");
  assert.match(recall.answer, /container/, "the seeded fact grounds the recall");

  const code = await seeded.turn("what does src/a.mjs import");
  assert.match(code.answer, /src\/b\.mjs/, "the same session still answers over the code graph");
});

test("an unseeded session stays the honest graph-only chat: an unknown term is a miss, never a guess", async () => {
  const session = createCodeExplorerSession({ graphPayload });
  const res = await session.turn("what is a zorbcase");
  assert.doesNotMatch(res.answer, /container/, "nothing grounds the term, so nothing is asserted");
});
