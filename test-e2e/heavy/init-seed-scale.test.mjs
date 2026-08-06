// The one genuinely slow assertion out of e2e/init.test.mjs's own suite: the
// `code` persona activates the uncapped ConceptNet band on top of SEON, which
// alone runs into minutes. Split out so a plain `tmct init` regression check
// (init.test.mjs's own per-push tier) never pays for a full ConceptNet seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, PERSONA_PRESETS } from "../../src/services/init.mjs";

async function tmp() {
  return mkdtemp(join(tmpdir(), "tmct-init-seed-scale-"));
}

test("the `code` persona's seed lands SEON and ConceptNet together, matching chat.mjs's own bootstrap", async () => {
  const dir = await tmp();
  try {
    const res = await initRepo(dir, { seed: true, persona: PERSONA_PRESETS.code });
    assert.ok(res.seedResult.code > 0, "the code pack's curated ontology landed");
    assert.ok(res.seedResult.conceptnet > 1000, "the ConceptNet band still landed, uncapped");
    assert.equal(res.seedResult.perBundle.code.appended, res.seedResult.code);
    assert.equal(res.seedResult.perBundle.conceptnet.appended, res.seedResult.conceptnet);
    // the `code` persona's own extensions override doesn't touch `human` (still
    // shipped active:true), so the total also includes it — internal
    // consistency is against the SUM of every bundle that actually ran, not
    // just the two named fields.
    const total = Object.values(res.seedResult.perBundle).reduce((n, b) => n + (b.appended || 0), 0);
    assert.equal(res.seedResult.appended, total, "counts are internally consistent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
