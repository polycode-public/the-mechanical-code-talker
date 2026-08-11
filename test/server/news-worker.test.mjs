// The news worker: real routing and validation through the row service's
// trigger and feed routes, the worker itself running in-process against the
// reference row backend with fixture fetchers — the same double
// test/server/row-service.test.mjs drives, extended with the poll/enrich/
// ingest triggers and the materialized feed.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalRowService } from "../../server/row-service/local.mjs";
import { createLocalNewsWorker } from "../../server/news-worker/local.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import { serializeCard, enforceFeedSizeBound, MAX_FACT_LINES_PER_CARD, MAX_FEED_DOCUMENT_BYTES } from "../../server/news-worker/handler.mjs";

const SESSION_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SESSION_B = "b2b2b2b2-b2b2-4b2b-9b2b-b2b2b2b2b2b2";

function fixtureFetcher(id, titles) {
  let calls = 0;
  return {
    id,
    calls: () => calls,
    async fetchItems() {
      calls += 1;
      return {
        items: titles.map((title, i) => ({
          id: `${id}:${i}`, guid: String(i), title, url: `https://example.com/${id}/${i}`, summary: "", publishedAt: "", sourceId: id,
        })),
        bytes: 100,
      };
    },
  };
}

function fetchersFor(ids, titles) {
  return (config) => {
    const map = new Map();
    for (const id of config.sources) if (ids.includes(id)) map.set(id, fixtureFetcher(id, titles));
    return map;
  };
}

async function withService(options, run) {
  const service = await createLocalRowService(options);
  try {
    await run(service);
  } finally {
    await service.close();
  }
}

async function readJsonMeta(url, sessionKey, key) {
  const res = await fetch(`${url}/api/meta/${key}`, { headers: { "x-tmct-session": sessionKey } });
  if (res.status === 404) return null;
  return JSON.parse((await res.json()).value);
}

async function triggerCycle(url, sessionKey, kind, body = {}) {
  return fetch(`${url}/api/sessions/${sessionKey}/${kind}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("an ingest trigger answers 202, and the rows and feed appear once the cycle drains", async () => {
  await withService({}, async (service) => {
    const trigger = await triggerCycle(service.url, SESSION_A, "ingest", { text: "A dog is a mammal." });
    assert.equal(trigger.status, 202);
    assert.match((await trigger.json()).cycleId, /^[0-9a-f-]{36}$/);

    await service.drainNewsWorkers();

    const rows = await fetch(`${service.url}/api/rows`, { headers: { "x-tmct-session": SESSION_A } });
    assert.ok((await rows.json()).rows.length > 0, "the ingested facts landed as session rows");

    const feed = await fetch(`${service.url}/api/feed`, { headers: { "x-tmct-session": SESSION_A } });
    assert.equal(feed.status, 200);
    const { feed: document } = await feed.json();
    assert.ok(Array.isArray(document.items));
    assert.ok(document.stats.graphSize > 0);

    const marker = await readJsonMeta(service.url, SESSION_A, "cycle");
    assert.equal(marker.state, "done");
    assert.equal(marker.kind, "ingest");
  });
});

test("GET /api/feed 404s before the first materialization, and GET /api/meta/feedVersion 404s the same way", async () => {
  await withService({}, async (service) => {
    const feed = await fetch(`${service.url}/api/feed`, { headers: { "x-tmct-session": SESSION_A } });
    assert.equal(feed.status, 404);
    const version = await fetch(`${service.url}/api/meta/feedVersion`, { headers: { "x-tmct-session": SESSION_A } });
    assert.equal(version.status, 404);
  });
});

test("an ingest trigger's body must carry exactly one of text or rows", async () => {
  await withService({}, async (service) => {
    const neither = await triggerCycle(service.url, SESSION_A, "ingest", {});
    assert.equal(neither.status, 400);
    const both = await triggerCycle(service.url, SESSION_A, "ingest", { text: "a", rows: [{}] });
    assert.equal(both.status, 400);
  });
});

test("a poll cycle's per-source progress lands in the cycle marker", async () => {
  await withService({ newsWorker: { fetchersFor: fetchersFor(["wikimedia-featured"], ["Acme Corp announces a new product."]) } }, async (service) => {
    const trigger = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] });
    assert.equal(trigger.status, 202);
    await service.drainNewsWorkers();

    const marker = await readJsonMeta(service.url, SESSION_A, "cycle");
    assert.equal(marker.state, "done");
    assert.deepEqual(marker.sources, {
      "wikimedia-featured": { status: "ok", newItems: 1, grounded: 1, pending: 0 },
    });
  });
});

test("a trigger while a cycle is already running for that session is a 409", async () => {
  // A real fixture cycle finishes faster than the HTTP round trip that
  // triggered it — the in-process worker holds no real I/O wait, so a
  // second request racing the first over the wire almost always lands after
  // the lock has already released. A fetcher that parks until released
  // keeps the first cycle genuinely running for as long as the assertion
  // needs, rather than depending on network timing to land inside a window
  // that can be a fraction of a millisecond wide.
  let releaseHang;
  const hangingFetcher = {
    id: "wikimedia-featured",
    async fetchItems() {
      await new Promise((resolve) => { releaseHang = resolve; });
      return { items: [], bytes: 0 };
    },
  };
  await withService({ newsWorker: { fetchersFor: () => new Map([["wikimedia-featured", hangingFetcher]]) } }, async (service) => {
    const first = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] });
    assert.equal(first.status, 202);

    const second = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] });
    assert.equal(second.status, 409);

    releaseHang();
    await service.drainNewsWorkers();
  });
});

test("a stale cycle lock is acquired again rather than 409ing the session forever", async () => {
  let clockSeconds = 1_000_000;
  const releaseHangs = [];
  const hangingFetcher = {
    id: "wikimedia-featured",
    async fetchItems() {
      await new Promise((resolve) => releaseHangs.push(resolve));
      return { items: [], bytes: 0 };
    },
  };
  await withService({
    now: () => clockSeconds,
    newsWorker: { fetchersFor: () => new Map([["wikimedia-featured", hangingFetcher]]) },
  }, async (service) => {
    const first = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] });
    assert.equal(first.status, 202);

    const stillHeld = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] });
    assert.equal(stillHeld.status, 409, "the first cycle's lock is still fresh — it never got a chance to finish");

    clockSeconds += 6 * 60; // past the lock's own staleness window
    const afterStale = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] });
    assert.equal(afterStale.status, 202, "a stale lock does not 409 a session forever");

    for (const release of releaseHangs.splice(0, releaseHangs.length)) release();
    await service.drainNewsWorkers();
  });
});

test("the abort budget stops a poll between sources, marking the cycle done-partial", async () => {
  let calls = 0;
  const nowMs = () => { calls += 1; return calls > 2 ? 1_000_000 : 0; };
  await withService({
    newsWorker: {
      nowMs, budgetMs: 500_000,
      fetchersFor: fetchersFor(["wikimedia-featured", "hacker-news"], ["A story."]),
    },
  }, async (service) => {
    const trigger = await triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured", "hacker-news"] });
    assert.equal(trigger.status, 202);
    await service.drainNewsWorkers();

    const marker = await readJsonMeta(service.url, SESSION_A, "cycle");
    assert.equal(marker.state, "done-partial");
    assert.equal(Object.keys(marker.sources).length, 1, "the second source never ran once the budget tripped");
  });
});

test("graphVersion is monotonic across a session's cycles", async () => {
  await withService({}, async (service) => {
    const beforeAny = await readJsonMeta(service.url, SESSION_A, "graphVersion");
    assert.equal(beforeAny, null);

    await triggerCycle(service.url, SESSION_A, "ingest", { text: "A dog is a mammal." });
    await service.drainNewsWorkers();
    const afterFirst = Number((await fetch(`${service.url}/api/meta/graphVersion`, { headers: { "x-tmct-session": SESSION_A } }).then((r) => r.json())).value);
    assert.ok(afterFirst >= 1);

    await triggerCycle(service.url, SESSION_A, "ingest", { text: "A cat is a mammal." });
    await service.drainNewsWorkers();
    const afterSecond = Number((await fetch(`${service.url}/api/meta/graphVersion`, { headers: { "x-tmct-session": SESSION_A } }).then((r) => r.json())).value);
    assert.ok(afterSecond > afterFirst, "a second cycle's writes moved the counter forward, never back");
  });
});

test("the shared per-source throttle is read across concurrent invocations, not once per session", async () => {
  const fetcher = fixtureFetcher("wikimedia-featured", ["A story."]);
  await withService({
    newsWorker: {
      fetchersFor: (config) => {
        const map = new Map();
        if (config.sources.includes("wikimedia-featured")) map.set("wikimedia-featured", fetcher);
        return map;
      },
    },
  }, async (service) => {
    const [first, second] = await Promise.all([
      triggerCycle(service.url, SESSION_A, "poll", { sources: ["wikimedia-featured"] }),
      triggerCycle(service.url, SESSION_B, "poll", { sources: ["wikimedia-featured"] }),
    ]);
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    await service.drainNewsWorkers();

    assert.equal(fetcher.calls(), 1, "only one of the two concurrent sessions actually reached the source");

    const markerA = await readJsonMeta(service.url, SESSION_A, "cycle");
    const markerB = await readJsonMeta(service.url, SESSION_B, "cycle");
    const statuses = [markerA.sources["wikimedia-featured"].status, markerB.sources["wikimedia-featured"].status].sort();
    assert.deepEqual(statuses, ["not-modified", "ok"]);
  });
});

test("a purge soft-deletes the materialized feed along with the rows", async () => {
  await withService({}, async (service) => {
    await triggerCycle(service.url, SESSION_A, "ingest", { text: "A dog is a mammal." });
    await service.drainNewsWorkers();
    assert.equal((await fetch(`${service.url}/api/feed`, { headers: { "x-tmct-session": SESSION_A } })).status, 200);

    await fetch(`${service.url}/api/sessions/${SESSION_A}/rows`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }),
    });

    assert.equal((await fetch(`${service.url}/api/feed`, { headers: { "x-tmct-session": SESSION_A } })).status, 404);
  });
});

test("the cycle rate limit answers 429 once a session's hourly trigger budget is spent", async () => {
  await withService({ cycleRateLimit: 1 }, async (service) => {
    const first = await triggerCycle(service.url, SESSION_A, "ingest", { text: "A dog is a mammal." });
    assert.equal(first.status, 202);
    await service.drainNewsWorkers();
    const second = await triggerCycle(service.url, SESSION_A, "ingest", { text: "A cat is a mammal." });
    assert.equal(second.status, 429);
  });
});

test("materialize mode rebuilds the feed from stored rows without fetching anything", async () => {
  const sessionBackends = new Map();
  const getSessionBackend = (sessionKey) => {
    let backend = sessionBackends.get(sessionKey);
    if (!backend) { backend = createRowMemoryBackend(); sessionBackends.set(sessionKey, backend); }
    return backend;
  };
  const worker = createLocalNewsWorker({ getSessionBackend });

  await worker.runCycle({ sessionKey: SESSION_A, cycleId: "c1", mode: "ingest", body: { text: "A dog is a mammal." } });

  let fetchersBuilt = false;
  const materializeWorker = createLocalNewsWorker({
    getSessionBackend,
    fetchersFor: () => { fetchersBuilt = true; throw new Error("materialize mode must never build fetchers"); },
  });
  const result = await materializeWorker.runCycle({ sessionKey: SESSION_A, mode: "materialize" });
  assert.equal(fetchersBuilt, false);
  assert.ok(result.feedVersion >= 2, "materialize ran its own materialization on top of the ingest's own");

  await sessionBackends.get(SESSION_A).close();
});

test("a card's factLines trim to the first 24 lines, carrying the true count alongside", () => {
  const rowsById = new Map();
  const factIds = [];
  for (let i = 0; i < 60; i += 1) {
    const id = `fact:${i}`;
    rowsById.set(id, { id, subject: "the reservoir", predicate: "mgx:hasA", object: `gauge-${i}` });
    factIds.push(id);
  }
  const card = serializeCard({
    id: "news-feed:abc", hub: "the reservoir", factIds, changedCount: 3, builtAt: "2026-08-10T00:00:00.000Z",
    paragraph: "p", tier: "core", sources: [], backgroundParagraph: "", newName: false,
  }, rowsById);
  assert.equal(card.factLines.length, MAX_FACT_LINES_PER_CARD);
  assert.equal(card.factCount, 60);
});

test("the 350 KB bound drops whole cards' factLines from the tail until the document fits, marking it trimmed", () => {
  const bigLine = "x".repeat(400);
  const items = [];
  for (let i = 0; i < 40; i += 1) {
    items.push({
      id: `news-feed:${i}`, hub: `hub-${i}`, paragraph: "p", tier: "core", newName: false, sources: [],
      backgroundParagraph: "", factCount: 24, observedMs: i, changedCount: 0,
      factLines: Array.from({ length: 24 }, () => bigLine),
    });
  }
  const document = { items, rankedTerms: [], stats: { graphSize: 0, factsFromNews: 0 }, sourceStatus: [], requestLog: [], builtAt: "" };
  const before = Buffer.byteLength(JSON.stringify(document), "utf8");
  assert.ok(before > MAX_FEED_DOCUMENT_BYTES, "the fixture must actually breach the bound to exercise the trim");

  const trimmed = enforceFeedSizeBound(document);
  assert.equal(trimmed.trimmed, true);
  assert.ok(Buffer.byteLength(JSON.stringify(trimmed), "utf8") <= MAX_FEED_DOCUMENT_BYTES);
  assert.equal(trimmed.items[0].factLines.length, 24, "the front of the feed keeps its drill-down");
  assert.equal(trimmed.items[trimmed.items.length - 1].factLines.length, 0, "the tail gives up its drill-down first");
});
