// The external sources' breaker where a reader meets it: a live source that
// keeps timing out is skipped for the rest of the session, and the answer it
// no longer stands on says so. Nothing here touches the network — every
// provider is a registered stub, and the only thing that varies between them
// is whether their failures said the source itself was struggling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { registerLiveReferenceProvider, registerResearchProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";
import { resetSourceBreakers, SOURCE_BREAKER_DEFAULTS } from "../../src/domain/source-breaker.mjs";

const noPackEnv = { TMCT_REFERENCE_PACK_DIR: "/nonexistent-reference-pack", TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" };

const SKIP_NOTE = "Answered without wikipedia. That source kept failing, so this session stopped asking it.";

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-source-breaker-"));
}

async function turn(line, { memoryDir, liveReference = false }) {
  return runTurn(line, { config: null, memoryDir, env: noPackEnv, liveReference });
}

/** A live source that answers nothing. `systemic` decides what its silence
 *  means: a timing-out source, or one with no article on the term. */
function silentSource(name, { systemic }) {
  const seen = { lookups: 0, systemicFailures: 0 };
  const provider = {
    name,
    stats: () => ({ systemicFailures: seen.systemicFailures }),
    async lookup() {
      seen.lookups += 1;
      if (systemic) seen.systemicFailures += 1;
      return null;
    },
  };
  return { provider, seen };
}

test("a live source that keeps failing is skipped, and the answer says it was answered without it", async () => {
  const dir = await freshRepo();
  const { provider, seen } = silentSource("wikipedia", { systemic: true });
  resetSourceBreakers();
  registerLiveReferenceProvider(provider);
  try {
    for (let i = 0; i < SOURCE_BREAKER_DEFAULTS.failureThreshold; i += 1) {
      const r = await turn("what is a quasar", { memoryDir: dir, liveReference: true });
      assert.equal(r.record.miss, true, "a failed live lookup leaves the honest miss standing");
      assert.ok(!r.answer.includes("Answered without"), "nothing is marked while the source is still being asked");
    }
    assert.equal(seen.lookups, SOURCE_BREAKER_DEFAULTS.failureThreshold);

    const skipped = await turn("what is a quasar", { memoryDir: dir, liveReference: true });
    assert.equal(seen.lookups, SOURCE_BREAKER_DEFAULTS.failureThreshold, "the skipped source is never asked again");
    assert.equal(skipped.record.miss, true, "the miss is unchanged — the source only stopped being asked");
    assert.ok(skipped.answer.endsWith(SKIP_NOTE), `the answer ends with the skip note: ${JSON.stringify(skipped.answer)}`);
  } finally {
    registerLiveReferenceProvider(null);
    resetSourceBreakers();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live source with no article on the term keeps being asked, and no answer is ever marked", async () => {
  const dir = await freshRepo();
  const rounds = SOURCE_BREAKER_DEFAULTS.failureThreshold * 2;
  const { provider, seen } = silentSource("wikipedia", { systemic: false });
  resetSourceBreakers();
  registerLiveReferenceProvider(provider);
  try {
    for (let i = 0; i < rounds; i += 1) {
      const r = await turn("what is a quasar", { memoryDir: dir, liveReference: true });
      assert.ok(!r.answer.includes("Answered without"), "an empty answer is an answer, so nothing is marked");
    }
    assert.equal(seen.lookups, rounds, "an empty answer never counts against the source");
  } finally {
    registerLiveReferenceProvider(null);
    resetSourceBreakers();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a turn that asks no live source is byte-identical to a run with no breaker at all", async () => {
  const dir = await freshRepo();
  const { provider } = silentSource("wikipedia", { systemic: true });
  resetSourceBreakers();
  registerLiveReferenceProvider(provider);
  try {
    for (let i = 0; i < SOURCE_BREAKER_DEFAULTS.failureThreshold; i += 1) {
      await turn("what is a quasar", { memoryDir: dir, liveReference: true });
    }
    const off = await turn("what is a quasar", { memoryDir: dir });
    assert.ok(!off.answer.includes("Answered without"), "a turn with the live toggle off asked nothing, so it says nothing");
  } finally {
    registerLiveReferenceProvider(null);
    resetSourceBreakers();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a research source that keeps failing is skipped, and the research turn says so", async () => {
  const dir = await freshRepo();
  const seen = { lookups: 0, systemicFailures: 0 };
  const provider = {
    name: "wikipedia",
    stats: () => ({ systemicFailures: seen.systemicFailures }),
    async lookup() { seen.lookups += 1; seen.systemicFailures += 1; return null; },
    async pageByTitle() { return null; },
    async linkedTitles() { return null; },
  };
  resetSourceBreakers();
  registerResearchProvider(provider);
  registerLiveReferenceProvider({ lookup: async () => null });
  try {
    for (let i = 0; i < SOURCE_BREAKER_DEFAULTS.failureThreshold; i += 1) {
      const r = await turn(`research topic${i}`, { memoryDir: dir });
      assert.equal(r.record.via, "research");
      assert.ok(!r.answer.includes("Answered without"));
    }
    assert.equal(seen.lookups, SOURCE_BREAKER_DEFAULTS.failureThreshold);

    const skipped = await turn("research owl", { memoryDir: dir });
    assert.equal(seen.lookups, SOURCE_BREAKER_DEFAULTS.failureThreshold, "the skipped source is never fetched");
    assert.equal(skipped.record.miss, true, "the lane keeps its own miss shape");
    assert.ok(skipped.answer.endsWith(SKIP_NOTE), `the research answer ends with the skip note: ${JSON.stringify(skipped.answer)}`);
  } finally {
    registerResearchProvider(null);
    registerLiveReferenceProvider(null);
    resetSourceBreakers();
    await rm(dir, { recursive: true, force: true });
  }
});
