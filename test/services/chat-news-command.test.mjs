// /news [poll|rank|enrich|sources|add <url>|interval <minutes>] — chat's own
// wiring over src/services/news.mjs's newsTurn: every reply comes from that
// one function, so the wording here is a pin against news.mjs itself. Poll
// and enrich are exercised with an injected `newsProviders` (the same seam
// runTurn/createSession expose for research), so nothing here touches the
// network — the same discipline test/adapters/chat-research-lane.test.mjs
// already keeps for the research lane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn, helpText } from "../../src/services/chat.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";
import { normalizeFeedItems } from "../../src/domain/feed-normalize.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-news-"));
}

/** A `providers.newsFetchers` entry that hands back `rawItems` exactly once
 *  (a second poll reads as "nothing new", the same as a real source with no
 *  fresh content) — no network, no courtesy gate, no gate. */
function stubFetcher(sourceId, rawItems) {
  let served = false;
  return {
    id: sourceId,
    async fetchItems() {
      if (served) return { items: [], bytes: 0 };
      served = true;
      return { items: normalizeFeedItems(sourceId, rawItems, { now: new Date().toISOString() }), bytes: 0 };
    },
  };
}

test("/news with no state shows the feed built from the seeded graph", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, [
      { subject: "otter", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:test" },
      { subject: "otter", predicate: "mgx:hasA", object: "webbed foot", provenance: "corpus:test" },
    ]);
    const { answer, record } = await runTurn("/news", { memoryDir: dir, env: { TMCT_NO_SEED: "1" } });
    assert.match(answer, /otter/);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/news poll with a stubbed provider set ingests and reports counts", async () => {
  const dir = await tmpRepo();
  try {
    const newsFetchers = new Map([["wikimedia-featured", stubFetcher("wikimedia-featured", [
      { guid: "a1", title: "A heron is a bird." },
    ])]]);
    const { answer, record, newsState } = await runTurn("/news poll", {
      memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsProviders: { newsFetchers },
    });
    assert.match(answer, /polled 1 source: 1 new item/);
    assert.equal(record.miss, false);
    assert.equal(newsState.items.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/news rank lists ranked fact-ungrounded terms", async () => {
  const dir = await tmpRepo();
  try {
    const newsFetchers = new Map([["wikimedia-featured", stubFetcher("wikimedia-featured", [
      { guid: "a1", title: "A quokka is a marsupial." },
    ])]]);
    const poll = await runTurn("/news poll", { memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsProviders: { newsFetchers } });
    const { answer } = await runTurn("/news rank", {
      memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsState: poll.newsState, newsProviders: { newsFetchers },
    });
    assert.match(answer, /quokka \(1\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/news enrich grounds the top ranked term through a stubbed research provider and reports the refresh", async () => {
  const dir = await tmpRepo();
  try {
    const newsFetchers = new Map([["wikimedia-featured", stubFetcher("wikimedia-featured", [
      { guid: "a1", title: "A quokka is a marsupial." },
    ])]]);
    const poll = await runTurn("/news poll", { memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsProviders: { newsFetchers } });
    const stubResearchProvider = {
      lookup: async (term) => (term === "quokka" ? { title: "Quokka", summary: "A quokka is a herbivore.", isa: "herbivore" } : null),
      provenanceTag: (term) => `research:${term}@0`,
    };
    const { answer, newsState } = await runTurn("/news enrich", {
      memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsState: poll.newsState,
      newsProviders: { newsFetchers, getResearchProvider: () => stubResearchProvider },
    });
    assert.match(answer, /enriched 1 term \(quokka\)/);
    const quokkaEntry = newsState.ledger.terms.find((t) => t.term === "quokka");
    assert.equal(quokkaEntry.status, "grounded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown /news subcommand shows usage, never a guess", async () => {
  const dir = await tmpRepo();
  try {
    const { answer, record } = await runTurn("/news frobnicate", { memoryDir: dir, env: { TMCT_NO_SEED: "1" } });
    assert.match(answer, /^usage: \/news/);
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("newsConfig persists a /news add across turns when the caller threads the same object (the way chat-session.mjs's own session does)", async () => {
  const dir = await tmpRepo();
  try {
    const { resolveNewsConfig } = await import("../../src/services/news.mjs");
    const newsConfig = resolveNewsConfig(null);
    const startCount = newsConfig.sources.length;
    const providers = { newsFetchers: new Map(), preflightNewsUrl: async () => ({ ok: true, format: "jsonfeed" }) };
    const added = await runTurn("/news add https://example.test/feed.json", {
      memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsConfig, newsProviders: providers,
    });
    assert.match(added.answer, /added https:\/\/example\.test\/feed\.json/);
    assert.equal(newsConfig.sources.length, startCount + 1, "the SAME newsConfig object grew by the added source");
    const sources = await runTurn("/news sources", {
      memoryDir: dir, env: { TMCT_NO_SEED: "1" }, newsConfig, newsProviders: providers,
    });
    assert.equal(sources.record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/help lists the /news command", async () => {
  const text = await helpText(false, []);
  assert.match(text, /\/news \[poll\|rank\|enrich\|sources\|add <url>\]/);
});
