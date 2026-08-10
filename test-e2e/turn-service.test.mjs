// The turn service, end to end, over real HTTP against its local double:
// corpus-grounded answers citing band provenance, the enumeration honesty
// marker in both its supplemented and absent forms, an honest miss staying a
// miss under real retrieval, determinism on a replayed POST, strict
// validation at the edges, and a taught fact's round trip through the row
// service's own "stop & forget" purge. `test/services/turn-handler.test.mjs`
// already covers the handler's own validation and mode-selection unit
// tests — this file proves the same surface conversationally, over sockets,
// including the cross-service purge no single-service test can reach.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalTurnService } from "../server/turn-service/local.mjs";
import { MAX_TURN_BODY_BYTES } from "../server/turn-service/handler.mjs";
import { createRowServiceHandler } from "../server/row-service/handler.mjs";
import { createRowMemoryBackend } from "../src/adapters/memory/row-backend-memory.mjs";
import { bandFactRow } from "../src/adapters/memory/corpus-bands.mjs";

const SESSION = "01890000-0000-4000-8000-0000000000e1";

async function postTurn(service, sessionKey, body) {
  const response = await fetch(`${service.url}/api/sessions/${sessionKey}/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const DOLPHIN_FIXTURE_BAND = {
  name: "wordnet-complete",
  rows: [
    bandFactRow({ subject: "dolphin", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 0 }),
    bandFactRow({ subject: "mammal", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 1 }),
    bandFactRow({ subject: "dolphin", predicate: "mgx:capableOf", object: "swim", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 2 }),
  ],
};

test("a corpus-grounded answer cites the retrieving band's provenance, unbounded scope", async () => {
  const service = await createLocalTurnService({ fixtureBand: DOLPHIN_FIXTURE_BAND });
  try {
    const result = await postTurn(service, SESSION, { text: "what is a dolphin" });
    assert.equal(result.status, 200);
    assert.match(result.json.reply, /mammal/);
    assert.match(result.json.reply, /\(source: corpus:wordnet-complete\)/);
    assert.match(result.json.reply, /Corpus scope: the rows this query pulled from the corpus\.(?!.*may hold more)/s);
    assert.match(result.json.narration, /mode=supplemented/);
  } finally {
    await service.close();
  }
});

test("an enumeration answer grounded purely in the corpus carries the supplemented marker", async () => {
  const service = await createLocalTurnService({ fixtureBand: DOLPHIN_FIXTURE_BAND });
  try {
    // Nothing about dolphin is taught in this session — every fact the
    // answer lists came out of the fixture band's own retrieval, so the
    // marker on this answer proves the honesty mechanism runs off a real
    // subgraph, not an injected retrieval context.
    const result = await postTurn(service, SESSION, { text: "what else about a dolphin" });
    assert.equal(result.status, 200);
    assert.match(result.json.reply, /mammal/);
    assert.match(result.json.reply, /swim/);
    assert.match(result.json.reply, /Corpus scope: the rows this query pulled from the corpus\./);
    assert.match(result.json.narration, /mode=supplemented/);
  } finally {
    await service.close();
  }
});

test("a breaker-open turn's honest miss still carries the absent-supplement marker", async () => {
  const service = await createLocalTurnService({ fixtureBand: DOLPHIN_FIXTURE_BAND });
  try {
    service.forceBreakerOpen();
    const result = await postTurn(service, SESSION, { text: "what is a dolphin" });
    assert.equal(result.status, 200);
    assert.doesNotMatch(result.json.reply, /mammal/);
    assert.match(result.json.reply, /don't know "dolphin"/);
    assert.match(result.json.reply, /Corpus scope: none\. Answered without the corpus supplement\./);
    assert.match(result.json.narration, /mode=seed-session/);
  } finally {
    await service.close();
  }
});

test("an ungrounded query stays an honest miss under real retrieval, and a replayed POST is byte-identical", async () => {
  const service = await createLocalTurnService({ fixtureBand: DOLPHIN_FIXTURE_BAND });
  try {
    const first = await postTurn(service, SESSION, { text: "what is a zorptronic" });
    assert.equal(first.status, 200);
    assert.match(first.json.reply, /don't know "zorptronic"/);
    assert.match(first.json.narration, /mode=supplemented rows=0/);

    const second = await postTurn(service, SESSION, { text: "what is a zorptronic" });
    assert.equal(second.status, 200);
    assert.deepEqual(second.json, first.json);
  } finally {
    await service.close();
  }
});

test("a well-formed but non-v4 UUID in the path is a 400, not a silent pass-through", async () => {
  const service = await createLocalTurnService();
  try {
    const nonV4 = "01890000-0000-1000-8000-0000000000e1"; // right shape, wrong version nibble
    const result = await postTurn(service, nonV4, { text: "hello" });
    assert.equal(result.status, 400);
  } finally {
    await service.close();
  }
});

test("the 4 KB body cap holds exactly at the boundary, not just far over it", async () => {
  const service = await createLocalTurnService();
  try {
    const overheadBytes = JSON.stringify({ text: "hi", padding: "" }).length;
    const bodyOfSize = (targetBytes) => JSON.stringify({ text: "hi", padding: "x".repeat(targetBytes - overheadBytes) });

    const atCap = await postTurn(service, SESSION, bodyOfSize(MAX_TURN_BODY_BYTES));
    assert.equal(atCap.status, 200);

    const overCap = await postTurn(service, SESSION, bodyOfSize(MAX_TURN_BODY_BYTES + 1));
    assert.equal(overCap.status, 413);
  } finally {
    await service.close();
  }
});

test("a session's hourly turn-rate cap answers 429 over real HTTP", async () => {
  const service = await createLocalTurnService({ turnRateLimit: 1 });
  try {
    const first = await postTurn(service, SESSION, { text: "hello" });
    assert.equal(first.status, 200);
    const second = await postTurn(service, SESSION, { text: "hello again" });
    assert.equal(second.status, 429);
  } finally {
    await service.close();
  }
});

/** The counters seam a bare `createRowServiceHandler` needs for one purge
 *  route in a test with no cycle traffic — every method a no-op or an
 *  always-true gate, since this file exercises DELETE /rows alone. */
function createPermissiveRowServiceCounters() {
  return {
    async incrementGlobalRowCount() { return true; },
    async incrementMutationRate() { return true; },
    async incrementCycleRate() { return true; },
    async acquireCycleLock() { return true; },
    async releaseCycleLock() {},
  };
}

async function purgeAllRows(rowService, sessionKey) {
  return rowService.handle({
    method: "DELETE",
    path: `/api/sessions/${sessionKey}/rows`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ all: true }),
  });
}

test("a taught fact round-trips through a fresh handle, then the row service's stop-and-forget purge un-teaches it", async () => {
  // The turn service and the row service are separate Lambdas in production,
  // sharing nothing but the table — this composes both handlers directly
  // over ONE shared session-backend registry, the same seam
  // row-service/local.mjs hands the news worker, so a purge issued through
  // the real row-service handler is visible to the next turn the way it
  // would be over one shared DynamoDB table.
  const sessionBackends = new Map();
  const getSessionBackend = (sessionKey) => {
    let backend = sessionBackends.get(sessionKey);
    if (!backend) {
      backend = createRowMemoryBackend({});
      sessionBackends.set(sessionKey, backend);
    }
    return backend;
  };
  const rowService = createRowServiceHandler({
    createSessionBackend: getSessionBackend,
    counters: createPermissiveRowServiceCounters(),
    invokeNewsWorker: async () => {},
  });
  const service = await createLocalTurnService({ getSessionBackend });
  try {
    const taught = await postTurn(service, SESSION, { text: "remember that zorblatt is a dog" });
    assert.equal(taught.status, 200);
    assert.ok(taught.json.factsTouched.length > 0, "teaching wrote at least one fact row");

    // A separate POST is a fresh wrapping handle over the same shared
    // backend (the local double's own per-call construction discipline),
    // so this recall proves the taught row persisted past its own call.
    const recalled = await postTurn(service, SESSION, { text: "what is zorblatt" });
    assert.equal(recalled.status, 200);
    assert.match(recalled.json.reply.toLowerCase(), /dog/);

    const purge = await purgeAllRows(rowService, SESSION);
    assert.equal(purge.status, 204);

    const afterPurge = await postTurn(service, SESSION, { text: "what is zorblatt" });
    assert.equal(afterPurge.status, 200);
    assert.doesNotMatch(afterPurge.json.reply.toLowerCase(), /dog/);
    assert.match(afterPurge.json.reply, /don't know "zorblatt"/);
  } finally {
    await service.close();
    for (const backend of sessionBackends.values()) await backend.close();
  }
});
