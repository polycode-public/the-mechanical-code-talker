// The home page's chat seed builds through the real corpus seed path and
// answers the canonical vocabulary exchange — the deploy-time guarantee
// behind the embedded chat's starter memory. The seed mirrors the CLI's
// init:xl band set (scale-capped, never band-capped), so this also guards
// the browser/CLI band parity and the byte ceiling that keeps the page's
// boot budget realistic. The last test picks the seed up again at the other
// end, as the deployed edge hands it to a client.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as buildChatSeed, SEED_BAND_CAPS, SEED_BYTE_CEILING } from "../scripts/build-chat-seed.mjs";
import { factAnswer } from "../src/services/chat.mjs";
import { createInMemoryStore } from "../src/adapters/memory/core.mjs";

const DEPLOYED_ORIGIN = process.env.TMCT_E2E_BASE_URL?.replace(/\/+$/, "");

const INIT_XL_BANDS = [
  "human", "human-medium", "human-large",
  "code", "conceptnet",
  "wordnet-xl", "namenet", "child",
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

    const payload = JSON.parse(await readFile(out, "utf8"));
    const handle = createInMemoryStore();
    handle.payload = payload;

    const hit = await factAnswer(handle, "what is a dog", null, true, {});
    assert.ok(hit?.text, "the seeded store answers the canonical vocabulary question");
    assert.match(hit.text, /dog is a (canine|domestic animal|four legged animal|mammal|pet)/i);
    assert.match(hit.text, /\(sources?: corpus:/, "the answer names its corpus provenance");

    const miss = await factAnswer(handle, "what is a zorblatt", null, true, {});
    assert.equal(miss, null, "an unseeded term still gets the honest null");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// This ceiling only proves the override mechanism narrows the build, not a real
// page's boot budget (that's SEED_BYTE_CEILING, checked above). human+seon
// grow with the corpus itself; re-measured at 1,798,187 bytes (human 954,322 +
// seon 549,538 + conceptnet-capped-200 294,327) — 1,900,000 leaves ~100 KB of
// headroom. Re-measure before raising this again.
test("build-chat-seed: band and ceiling overrides reproduce a smaller configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-seed-small-test-"));
  const out = join(dir, "chat-seed.json");
  try {
    const res = await buildChatSeed(out, {
      bands: ["human", "seon", "conceptnet"],
      caps: { conceptnet: 200 },
      byteCeiling: 1_900_000,
    });
    assert.deepEqual(res.bands, ["human", "seon", "conceptnet"]);
    assert.ok(res.bytes <= 1_900_000, `${res.bytes} bytes respects the overridden ceiling`);
    assert.ok(res.perBundle.conceptnet.total <= 200, "the overridden cap holds");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The seed as the edge actually hands it over, one client encoding at a time.
 * The tests above prove the file the build wrote; this proves the copy a
 * visitor receives is still JSON once the transfer encoding has been undone.
 * Those came apart in production: the edge re-compressed an object that was
 * already brotli, so a browser's single decode left JSON.parse holding binary
 * and chat.html booted with no starter memory at all.
 *
 * The local static server serves the plain file with no encoding at all, so
 * there is nothing here for a local run to check.
 */
test(
  "the deployed chat-seed.json decodes to JSON for every encoding a client can negotiate",
  { skip: DEPLOYED_ORIGIN ? false : "needs a deployed origin (TMCT_E2E_BASE_URL)" },
  async (t) => {
    for (const accept of ["br, gzip", "br", "gzip"]) {
      const res = await fetch(`${DEPLOYED_ORIGIN}/chat-seed.json`, {
        signal: AbortSignal.timeout(60_000),
        headers: { "accept-encoding": accept, "cache-control": "no-cache" },
      });
      assert.equal(res.status, 200, `chat-seed.json for a client asking "${accept}"`);
      const encoding = res.headers.get("content-encoding") ?? "identity";
      assert.notEqual(encoding, "identity", `the edge serves a compressed variant to a client asking "${accept}"`);

      // Only the first chunk: enough to tell JSON from compressed bytes,
      // without pulling ~93 MB three times.
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let head = "";
      try {
        while (head.length < 64) {
          const step = await reader.read();
          if (step.done) break;
          head += decoder.decode(step.value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      assert.equal(
        head.trimStart().slice(0, 1),
        "{",
        `"${accept}" got content-encoding "${encoding}" whose body starts ${JSON.stringify(head.slice(0, 24))} — `
        + "a second layer of compression at the edge is the usual cause",
      );
      t.diagnostic(`${accept} -> ${encoding}, decodes as JSON`);
    }
  },
);
