// The home page's chat seed builds through the real corpus seed path and
// answers the canonical vocabulary exchange — the deploy-time guarantee
// behind the embedded chat's starter memory. The seed mirrors the CLI's
// init:xl band set (scale-capped, never band-capped), so this also guards
// the browser/CLI band parity and the byte ceiling that keeps the page's
// boot budget realistic.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as buildChatSeed, SEED_BAND_CAPS, SEED_BYTE_CEILING } from "../scripts/build-chat-seed.mjs";
import { factAnswer } from "../src/services/chat.mjs";
import { createInMemoryStore } from "../src/adapters/memory/core.mjs";

const INIT_XL_BANDS = [
  "human", "human-medium", "human-large",
  "seon", "conceptnet",
  "tier2-aws", "tier2-python", "tier2-java",
  "wordnet-xl",
];

test("build-chat-seed: the payload answers 'what is a dog' with provenance, carries the init:xl band set, and holds its byte ceiling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-seed-test-"));
  const out = join(dir, "chat-seed.json");
  try {
    const res = await buildChatSeed(out);
    assert.equal(res.outPath, out);
    assert.ok(res.bytes <= SEED_BYTE_CEILING, `${res.bytes} bytes stays under the builder's own ceiling`);
    assert.deepEqual(res.bands, INIT_XL_BANDS, "the seed's band set matches what npm run init:xl gives the CLI");
    assert.ok(res.facts >= 15000, `${res.facts} facts — the WordNet-xl-tier seed, not the old starter slice`);
    for (const band of INIT_XL_BANDS) {
      assert.ok(res.perBundle[band]?.appended > 0, `the ${band} band seeded`);
      assert.ok(res.perBundle[band]?.bytes > 0, `the ${band} band's serialized cost was measured`);
    }
    for (const [band, cap] of Object.entries(SEED_BAND_CAPS)) {
      assert.ok(res.perBundle[band].total <= cap, `the ${band} band respects its ${cap}-fact cap (took ${res.perBundle[band].total})`);
    }
    assert.ok(
      res.perBundle["wordnet-xl"].appended >= SEED_BAND_CAPS["wordnet-xl"] * 0.5,
      "the WordNet-xl cap is spent on facts the other bands don't already hold, not eaten by dedupe",
    );

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

test("build-chat-seed: band and ceiling overrides reproduce a smaller configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-seed-small-test-"));
  const out = join(dir, "chat-seed.json");
  try {
    const res = await buildChatSeed(out, {
      bands: ["human", "seon", "conceptnet"],
      caps: { conceptnet: 200 },
      byteCeiling: 1600 * 1024,
    });
    assert.deepEqual(res.bands, ["human", "seon", "conceptnet"]);
    assert.ok(res.bytes <= 1600 * 1024, `${res.bytes} bytes respects the overridden ceiling`);
    assert.ok(res.perBundle.conceptnet.total <= 200, "the overridden cap holds");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
