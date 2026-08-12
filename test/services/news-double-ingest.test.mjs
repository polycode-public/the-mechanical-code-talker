// One card per newsworthy item, however many times the item is offered. A
// source hands the same articles back on every poll, and a page refresh or a
// restart replays the same cycle again; what this suite holds is that the
// second offer of an article mints nothing — no snapshot, no fact, no card —
// and that an article the item window forgot is still recognised when it comes
// round again. Every fetch is an injected stub; no network anywhere here.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampNewsConfig, createNewsState, pollNewsSources, buildFeed,
} from "../../src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "../../src/adapters/memory/core.mjs";
import { normalizeFeedItems } from "../../src/domain/feed-normalize.mjs";
import { isNewsProvenance } from "../../src/domain/news-feed.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";

const SOURCE = "wikinews-published";
const FIXED_NOW = "2026-08-08T00:00:00.000Z";

const ARTICLES = [
  { guid: "a1", title: "Cyclone hits eastern Australia", summary: "" },
  { guid: "a2", title: "Storm hits northern Portugal", summary: "" },
  { guid: "a3", title: "Flood hits western Turkey", summary: "" },
  { guid: "a4", title: "Wildfire hits southern Poland", summary: "" },
  { guid: "a5", title: "Blizzard hits western Ireland", summary: "" },
];

const rawOf = (article) => ({
  guid: article.guid,
  title: article.title,
  summary: article.summary,
  url: `https://example.invalid/${article.guid}`,
  publishedAt: "2026-08-07T09:00:00.000Z",
});

/** A ctx over a fresh in-process store, fed by a stub fetcher that answers the
 *  same articles every time it is asked — a re-poll of an unchanged feed. */
async function makeSession({ articles = ARTICLES, itemCap = 30, clock = () => FIXED_NOW } = {}) {
  const backend = await openMemoryBackend("unused-repo-root", "memory");
  const ctx = {
    memoryDir: backend.dir,
    store: { loadMemory, readFactRows, appendFacts, removeFacts },
    cache: null,
    lexicon: loadLexicon(),
    config: clampNewsConfig({ sources: [SOURCE], itemCap, syllogismsPerIngest: 0 }),
    state: createNewsState(),
    providers: {
      newsFetchers: new Map([[SOURCE, {
        id: SOURCE,
        async fetchItems() {
          return { items: normalizeFeedItems(SOURCE, articles.map(rawOf), { now: clock() }), bytes: 512 };
        },
      }]]),
    },
    now: clock,
    notify: null,
  };
  return { ctx, close: backend.close };
}

async function readingOf(ctx) {
  const rows = readFactRows(await loadMemory(ctx.memoryDir));
  const feed = await buildFeed(ctx);
  return {
    newsFacts: rows.filter((row) => isNewsProvenance(row.provenance)).map((row) => row.id).sort(),
    cardIds: feed.items.map((item) => item.id).sort(),
    itemIds: (ctx.state.items || []).map((snap) => snap.id).sort(),
    rounds: (ctx.state.items || []).map((snap) => snap.processedRounds || 0),
  };
}

test("polling an unchanged feed a second time mints no snapshot, no news fact and no card", async () => {
  const { ctx, close } = await makeSession();
  try {
    const first = await pollNewsSources(ctx);
    const afterFirst = await readingOf(ctx);
    assert.equal(first.newItems, ARTICLES.length);
    assert.ok(afterFirst.newsFacts.length > 0, "the first poll really did admit facts");
    assert.ok(afterFirst.cardIds.length > 0, "the first poll really did build cards");

    const second = await pollNewsSources(ctx);
    const afterSecond = await readingOf(ctx);
    assert.equal(second.newItems, 0, "every article on offer was already known");
    assert.equal(second.facts, 0, "the second reading admitted no fact of its own");
    assert.deepEqual(afterSecond.newsFacts, afterFirst.newsFacts, "no duplicate news fact landed");
    assert.deepEqual(afterSecond.cardIds, afterFirst.cardIds, "the same cards, not a second set");
    assert.deepEqual(afterSecond.rounds, afterFirst.rounds, "no article was read twice");
  } finally {
    await close();
  }
});

test("a third and fourth poll of the same feed stay at zero — the feed converges rather than drifting", async () => {
  const { ctx, close } = await makeSession();
  try {
    await pollNewsSources(ctx);
    const settled = await readingOf(ctx);
    for (const pass of [2, 3, 4]) {
      const result = await pollNewsSources(ctx);
      assert.equal(result.newItems, 0, `poll ${pass} minted a snapshot`);
      assert.equal(result.facts, 0, `poll ${pass} minted a fact`);
    }
    assert.deepEqual(await readingOf(ctx), settled);
  } finally {
    await close();
  }
});

test("an article the item window dropped is still recognised when the source offers it again", async () => {
  // Two articles fit the window at a time, so each poll leaves the rest of the
  // feed outside it — the case a long feed and a small window hit every cycle.
  const { ctx, close } = await makeSession({ itemCap: 2 });
  try {
    let polls = 0;
    let lastFacts = -1;
    while (lastFacts !== 0 && polls < 10) {
      const result = await pollNewsSources(ctx);
      lastFacts = result.facts;
      polls += 1;
    }
    assert.ok(polls < 10, "the feed settled instead of re-reading its own articles for ever");

    const settled = await readingOf(ctx);
    const again = await pollNewsSources(ctx);
    assert.equal(again.newItems, 0, "an article outside the window is remembered, not re-admitted");
    assert.equal(again.facts, 0);
    assert.deepEqual(await readingOf(ctx), settled);

    const distinctSubjects = new Set(
      readFactRows(await loadMemory(ctx.memoryDir))
        .filter((row) => isNewsProvenance(row.provenance))
        .map((row) => row.subject),
    );
    for (const subject of ["cyclone", "storm", "flood", "wildfire", "blizzard"]) {
      assert.ok(distinctSubjects.has(subject), `${subject}'s article never reached the graph`);
    }
  } finally {
    await close();
  }
});

test("an article re-issued under a fresh source id is one item, not two", async () => {
  const { ctx, close } = await makeSession({ articles: [ARTICLES[0]] });
  try {
    await pollNewsSources(ctx);
    const afterFirst = await readingOf(ctx);

    ctx.providers.newsFetchers.set(SOURCE, {
      id: SOURCE,
      async fetchItems() {
        const reissued = { ...rawOf(ARTICLES[0]), guid: "a1-reissued", url: "https://example.invalid/a1?ref=home" };
        return { items: normalizeFeedItems(SOURCE, [reissued], { now: FIXED_NOW }), bytes: 512 };
      },
    });
    const second = await pollNewsSources(ctx);
    const afterSecond = await readingOf(ctx);

    assert.equal(second.newItems, 0, "the same words under a new id are the same article");
    assert.deepEqual(afterSecond.itemIds, afterFirst.itemIds);
    assert.deepEqual(afterSecond.newsFacts, afterFirst.newsFacts);
    assert.deepEqual(afterSecond.cardIds, afterFirst.cardIds);
  } finally {
    await close();
  }
});

test("two copies of one article inside a single fetch admit one snapshot", async () => {
  const twinned = [ARTICLES[0], { ...ARTICLES[0], guid: "a1-twin" }];
  const { ctx, close } = await makeSession({ articles: twinned });
  try {
    const result = await pollNewsSources(ctx);
    assert.equal(result.newItems, 1, "one article, however many times the fetch listed it");
    assert.equal(ctx.state.items.length, 1);
  } finally {
    await close();
  }
});

test("the feed a source's items build does not depend on the order the source lists them", async () => {
  const forward = await makeSession({ articles: ARTICLES });
  const reversed = await makeSession({ articles: [...ARTICLES].reverse() });
  try {
    await pollNewsSources(forward.ctx);
    await pollNewsSources(reversed.ctx);
    const a = await readingOf(forward.ctx);
    const b = await readingOf(reversed.ctx);
    assert.deepEqual(b.itemIds, a.itemIds, "the same items were admitted");
    assert.deepEqual(b.newsFacts, a.newsFacts, "the same facts landed");
    assert.deepEqual(b.cardIds, a.cardIds, "the same cards were built");
    assert.deepEqual(
      (reversed.ctx.state.seenItemKeys || []).map((entry) => entry.key).sort(),
      (forward.ctx.state.seenItemKeys || []).map((entry) => entry.key).sort(),
      "the same items are remembered",
    );
  } finally {
    await forward.close();
    await reversed.close();
  }
});

test("which snapshot survives a collision does not depend on the order the source lists them", async () => {
  const twinned = [ARTICLES[0], { ...ARTICLES[0], guid: "a1-twin" }];
  const forward = await makeSession({ articles: twinned });
  const reversed = await makeSession({ articles: [...twinned].reverse() });
  try {
    await pollNewsSources(forward.ctx);
    await pollNewsSources(reversed.ctx);
    assert.deepEqual(
      reversed.ctx.state.items.map((snap) => snap.id),
      forward.ctx.state.items.map((snap) => snap.id),
      "the same copy of the article was kept either way",
    );
  } finally {
    await forward.close();
    await reversed.close();
  }
});

test("a poll after a restart reads the persisted state and adds nothing to it", async () => {
  const { ctx, close } = await makeSession();
  try {
    await pollNewsSources(ctx);
    const settled = await readingOf(ctx);

    // What a restart really carries over: the state as JSON, nothing else.
    ctx.state = JSON.parse(JSON.stringify(ctx.state));
    const result = await pollNewsSources(ctx);
    assert.equal(result.newItems, 0);
    assert.equal(result.facts, 0);
    assert.deepEqual(await readingOf(ctx), settled);
  } finally {
    await close();
  }
});
