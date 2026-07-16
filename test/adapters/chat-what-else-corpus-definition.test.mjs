// "what else is X" over a corpus-seeded prose definition: the primary answer
// is the curated SEON definition, and the follow-up must surface genuinely
// additional facts, never repeat the definition verbatim. Needs a direct
// seedMemory slice write (the seon concepts band), so it stays in the unit
// ring; the honest "that's everything" ladder is a templates-lane row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/chat.mjs";

test("'what else is X' after a curated prose definition surfaces additional facts, never the definition again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-what-else-"));
  try {
    const { seedMemory, SEON_CONCEPTS_FILE } = await import("../../src/adapters/corpus/conceptnet.mjs");
    await seedMemory(dir, { slicePath: SEON_CONCEPTS_FILE, provenancePrefix: "corpus:seon" });
    const config = { graphFile: join(dir, ".tmct", "graph.json") };

    const first = await runTurn("what is a function", { config, memoryDir: dir });
    assert.match(first.answer, /^A function is a named, reusable block of code/);
    assert.equal(first.record.via, "corpus/seon");

    const again = await runTurn("what else is a function", { config, memoryDir: dir, last: first.last });
    assert.notEqual(again.answer, first.answer, "never byte-identical to the primary definition turn");
    assert.doesNotMatch(again.answer, /^A function is a named, reusable block of code/, "never repeats the primary definition sentence verbatim");
    assert.match(again.answer, /what else I know about "function"/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
