// item_cap bounds each source's OWN window, not the combined total across
// every enabled source. mergeSnapshots' drop-grounded-first rule means a
// smaller, earlier-processed source's already-ingested snapshots are exactly
// what a later, prolific source evicts first when the two share one pool —
// so the earlier source's facts still land, but its window presence (what a
// second poll's de-dupe reads, and what a per-source count like an admission
// rate reads) drops to nothing. Scoping the cap to each source's own
// snapshots removes that dependency on processing order.
import { test } from "node:test";
import assert from "node:assert/strict";

import { clampNewsConfig, createNewsState, pollNewsSources } from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { normalizeFeedItems } from "../../src/domain/feed-normalize.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";

const BIG_SOURCE = "usgs-quakes";
const SMALL_SOURCE = "wikinews-published";
const FIXED_NOW = "2026-08-08T00:00:00.000Z";

function quakeItems(count) {
  const raw = [];
  for (let i = 0; i < count; i += 1) {
    raw.push({
      guid: `quake-${i}`,
      title: `A magnitude ${2 + (i % 6)} earthquake hits region ${i}`,
      url: `https://example.invalid/quake/${i}`,
      summary: "",
    });
  }
  return normalizeFeedItems(BIG_SOURCE, raw, { now: FIXED_NOW });
}

function stormItems(count) {
  const raw = [];
  for (let i = 0; i < count; i += 1) {
    raw.push({
      guid: `storm-${i}`,
      title: `A storm hits coastal town ${i}`,
      url: `https://example.invalid/storm/${i}`,
      summary: "",
    });
  }
  return normalizeFeedItems(SMALL_SOURCE, raw, { now: FIXED_NOW });
}

/** A ctx over a fresh in-process store, with two stub fetchers offering a
 *  fixed count of items each. `sources` sets the poll order, so the same
 *  fixture can be run with either source processed first. */
async function makeSession({ sources, bigCount = 40, smallCount = 5, itemCap = 30 } = {}) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  const ctx = {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config: clampNewsConfig({ sources, itemCap, syllogismsPerIngest: 0 }),
    state: createNewsState(),
    providers: {
      newsFetchers: new Map([
        [BIG_SOURCE, { id: BIG_SOURCE, async fetchItems() { return { items: quakeItems(bigCount), bytes: 2048 }; } }],
        [SMALL_SOURCE, { id: SMALL_SOURCE, async fetchItems() { return { items: stormItems(smallCount), bytes: 512 }; } }],
      ]),
    },
    now: () => FIXED_NOW,
    notify: null,
  };
  return { ctx, close: backend.close };
}

function windowCountsOf(ctx) {
  return {
    big: ctx.state.items.filter((snap) => snap.sourceId === BIG_SOURCE).length,
    small: ctx.state.items.filter((snap) => snap.sourceId === SMALL_SOURCE).length,
  };
}

test("a small source's window survives a prolific source's poll however the two are ordered", async () => {
  const { ctx, close } = await makeSession({ sources: [SMALL_SOURCE, BIG_SOURCE] });
  try {
    await pollNewsSources(ctx);
    const counts = windowCountsOf(ctx);
    assert.equal(counts.big, 30, "the prolific source's own window still trims to item_cap");
    assert.equal(counts.small, 5, "the small source, processed first, keeps every item it offered");
    assert.equal(ctx.state.items.length, 35, "each source's window is capped on its own, not against the combined total");
  } finally {
    await close();
  }
});

test("swapping which source polls first changes neither source's own window", async () => {
  const { ctx, close } = await makeSession({ sources: [BIG_SOURCE, SMALL_SOURCE] });
  try {
    await pollNewsSources(ctx);
    const counts = windowCountsOf(ctx);
    assert.equal(counts.big, 30);
    assert.equal(counts.small, 5, "the small source, processed second, is not crowded out by the source ahead of it");
  } finally {
    await close();
  }
});

test("a source offering more than item_cap in one poll still trims to its own cap", async () => {
  const { ctx, close } = await makeSession({ sources: [BIG_SOURCE], smallCount: 0, itemCap: 10 });
  try {
    const result = await pollNewsSources(ctx);
    assert.equal(ctx.state.items.length, 10, "one source's own overflow is unaffected by the per-source scoping");
    assert.equal(result.sources[0].grounded, 10);
  } finally {
    await close();
  }
});
