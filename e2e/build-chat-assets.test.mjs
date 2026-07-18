// The home page's chat seed builds through the real corpus seed path and
// answers the canonical vocabulary exchange — the deploy-time guarantee
// behind the embedded chat's starter memory.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as buildChatSeed, SEED_BYTE_CEILING } from "../scripts/build-chat-seed.mjs";
import { factAnswer } from "../src/services/chat.mjs";
import { createInMemoryStore } from "../src/adapters/memory/core.mjs";

test("build-chat-seed: the payload answers 'what is a dog' with provenance, carries every band, and holds its byte ceiling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-seed-test-"));
  const out = join(dir, "chat-seed.json");
  try {
    const res = await buildChatSeed(out);
    assert.equal(res.outPath, out);
    assert.ok(res.bytes <= SEED_BYTE_CEILING, `${res.bytes} bytes stays under the builder's own ceiling`);
    assert.ok(res.facts >= 500, `${res.facts} facts — enough vocabulary to be worth shipping`);
    for (const band of ["human", "seon", "conceptnet"]) {
      assert.ok(res.perBundle[band]?.appended > 0, `the ${band} band seeded`);
    }

    const payload = JSON.parse(await readFile(out, "utf8"));
    const handle = createInMemoryStore();
    handle.payload = payload;

    const hit = await factAnswer(handle, "what is a dog", null, true, {});
    assert.ok(hit?.text, "the seeded store answers the canonical vocabulary question");
    assert.match(hit.text, /dog is a kind of/);
    assert.match(hit.text, /\(source: corpus:/, "the answer names its corpus provenance");

    const miss = await factAnswer(handle, "what is a zorblatt", null, true, {});
    assert.equal(miss, null, "an unseeded term still gets the honest null");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
