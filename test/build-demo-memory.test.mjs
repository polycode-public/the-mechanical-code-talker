// The Pages demo payload builds through the real teach paths and answers the
// canonical exchange — the deploy-time guarantee behind public/ledger.html.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as buildDemoMemory } from "../scripts/build-demo-memory.mjs";
import { factReadBack } from "../src/chat.mjs";
import { createInMemoryStore } from "../src/memory/core.mjs";

test("build-demo-memory: the payload answers the canonical exchange and carries corpus + hanoi rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "demo-memory-test-"));
  const out = join(dir, "demo-memory.json");
  try {
    const res = await buildDemoMemory(out);
    assert.equal(res.outPath, out);

    const payload = JSON.parse(await readFile(out, "utf8"));
    const handle = createInMemoryStore();
    handle.payload = payload;

    const answer = await factReadBack(handle, "who is the grandfather of ishmael", null, true);
    assert.match(String(answer?.text ?? ""), /ahab/, "the canonical exchange answers from the built payload");

    const json = JSON.stringify(payload);
    assert.match(json, /corpus:human/, "at least one corpus-provenance row is present");
    assert.match(json, /disk-1/, "the hanoi-3 game facts are present");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
