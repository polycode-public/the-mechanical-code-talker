// turn-handler.test.mjs — the turn service's HTTP surface over its local
// double: a real node:http server, the in-memory session backend, and a
// fixture corpus band loaded through the real loader. Covers validation,
// teach-then-ask persistence across fresh per-call handles, a
// retrieval-supplemented answer, the breaker-skip path, the turn-rate limit,
// and the mid-bundle seed's own cold-boot cost.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalTurnService } from "../../server/turn-service/local.mjs";
import { createTurnServiceHandler, vocabularyFromSeed } from "../../server/turn-service/handler.mjs";
import { main as buildMidSeed, MID_BUNDLE_BANDS } from "../../server/turn-service/build-seed.mjs";
import { bandFactRow } from "../../src/adapters/memory/corpus-bands.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import { PERSIST_UNAVAILABLE_TEXT } from "../../src/services/chat.mjs";

const SESSION = "01890000-0000-4000-8000-0000000000f1";
const OTHER_SESSION = "01890000-0000-4000-8000-0000000000f2";

async function postTurn(service, sessionKey, body, headers = {}) {
  const response = await fetch(`${service.url}/api/sessions/${sessionKey}/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const DOLPHIN_ROWS = [
  bandFactRow({ subject: "dolphin", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 0 }),
  bandFactRow({ subject: "mammal", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 1 }),
];

test("404s on the wrong method or path", async () => {
  const service = await createLocalTurnService();
  try {
    const getResponse = await fetch(`${service.url}/api/sessions/${SESSION}/turn`);
    assert.equal(getResponse.status, 404);
    const wrongPath = await fetch(`${service.url}/api/sessions/${SESSION}/rows`, { method: "POST", body: "{}" });
    assert.equal(wrongPath.status, 404);
  } finally {
    await service.close();
  }
});

test("400s on a malformed session key, a non-JSON body and a missing text field", async () => {
  const service = await createLocalTurnService();
  try {
    const badKey = await postTurn(service, "not-a-uuid", { text: "hi" });
    assert.equal(badKey.status, 400);

    const badJson = await fetch(`${service.url}/api/sessions/${SESSION}/turn`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{not json",
    });
    assert.equal(badJson.status, 400);

    const missingText = await postTurn(service, SESSION, {});
    assert.equal(missingText.status, 400);

    const badFuzzy = await postTurn(service, SESSION, { text: "hi", retrieval: { fuzzy: "yes" } });
    assert.equal(badFuzzy.status, 400);
  } finally {
    await service.close();
  }
});

test("413s a body over the 4 KB cap", async () => {
  const service = await createLocalTurnService();
  try {
    const result = await postTurn(service, SESSION, { text: "hi", padding: "x".repeat(5000) });
    assert.equal(result.status, 413);
  } finally {
    await service.close();
  }
});

test("answers a plain turn with no bands configured, marked seed-session", async () => {
  const service = await createLocalTurnService();
  try {
    const result = await postTurn(service, SESSION, { text: "hello" });
    assert.equal(result.status, 200);
    assert.equal(typeof result.json.reply, "string");
    assert.deepEqual(result.json.factsTouched, []);
    assert.match(result.json.narration, /mode=seed-session/);
    assert.match(result.json.narration, /rows=0/);
  } finally {
    await service.close();
  }
});

test("a taught fact survives to a later turn on a fresh handle, and stays out of another session", async () => {
  const service = await createLocalTurnService();
  try {
    const taught = await postTurn(service, SESSION, { text: "remember that zorblatt is a dog" });
    assert.equal(taught.status, 200);
    assert.ok(taught.json.factsTouched.length > 0, "teaching wrote at least one fact row");

    const recalled = await postTurn(service, SESSION, { text: "what is zorblatt" });
    assert.equal(recalled.status, 200);
    assert.match(recalled.json.reply.toLowerCase(), /dog/);

    const otherSession = await postTurn(service, OTHER_SESSION, { text: "what is zorblatt" });
    assert.equal(otherSession.status, 200);
    assert.doesNotMatch(otherSession.json.reply.toLowerCase(), /dog/);
  } finally {
    await service.close();
  }
});

test("a turn's learned rows count toward the shared global row cap; a full table answers without persisting", async () => {
  const service = await createLocalTurnService({ tableRowCap: 0 });
  try {
    const taught = await postTurn(service, SESSION, { text: "remember that zorblatt is a dog" });
    assert.equal(taught.status, 200, "the turn still answers even though its write was refused");
    assert.deepEqual(taught.json.factsTouched, [], "the cap refused the write before anything landed");
    assert.ok(
      taught.json.reply.includes(PERSIST_UNAVAILABLE_TEXT),
      `the reply says the store refused the write, got: ${taught.json.reply}`,
    );
    assert.doesNotMatch(taught.json.reply, /as a word I know/, "the vocabulary is not what stopped the write");
    assert.equal(service.readGlobalRowCount(), 0, "a refused write never increments the counter");

    const recalled = await postTurn(service, SESSION, { text: "what is zorblatt" });
    assert.equal(recalled.status, 200);
    assert.doesNotMatch(recalled.json.reply.toLowerCase(), /dog/, "nothing was actually learned");
  } finally {
    await service.close();
  }
});

test("a generous cap counts a turn's writes without refusing them", async () => {
  const service = await createLocalTurnService({ tableRowCap: 1000 });
  try {
    const taught = await postTurn(service, SESSION, { text: "remember that zorblatt is a dog" });
    assert.equal(taught.status, 200);
    assert.ok(taught.json.factsTouched.length > 0, "the write went through under a cap with room");
    assert.ok(service.readGlobalRowCount() > 0, "the turn's writes counted toward the shared cap");
  } finally {
    await service.close();
  }
});

test("a question the seed cannot ground answers from the fixture band, marked supplemented", async () => {
  // A wide wall clock: the production 300ms budget is real time, and this
  // test proves supplementation, not budget behavior — on a saturated
  // machine the default budget can honestly empty the retrieval.
  const service = await createLocalTurnService({
    fixtureBand: { name: "wordnet-complete", rows: DOLPHIN_ROWS },
    retrievalBudgets: { wallTimeMs: 60_000 },
  });
  try {
    const result = await postTurn(service, SESSION, { text: "what is a dolphin" });
    assert.equal(result.status, 200);
    assert.match(result.json.narration, /mode=supplemented/);
    assert.doesNotMatch(result.json.narration, /rows=0\b/);
    assert.match(result.json.reply.toLowerCase(), /mammal/);
  } finally {
    await service.close();
  }
});

test("a forced-open breaker skips the same band's retrieval and answers seed-session", async () => {
  const service = await createLocalTurnService({ fixtureBand: { name: "wordnet-complete", rows: DOLPHIN_ROWS } });
  try {
    service.forceBreakerOpen();
    const result = await postTurn(service, SESSION, { text: "what is a dolphin" });
    assert.equal(result.status, 200);
    assert.match(result.json.narration, /mode=seed-session/);
    assert.match(result.json.narration, /rows=0/);
    assert.doesNotMatch(result.json.reply.toLowerCase(), /mammal/);
  } finally {
    await service.close();
  }
});

test("the turn rate limit answers 429 once a session's hourly cap is spent", async () => {
  const service = await createLocalTurnService({ turnRateLimit: 2 });
  try {
    assert.equal((await postTurn(service, SESSION, { text: "one" })).status, 200);
    assert.equal((await postTurn(service, SESSION, { text: "two" })).status, 200);
    const third = await postTurn(service, SESSION, { text: "three" });
    assert.equal(third.status, 429);
    // A different session has its own counter.
    assert.equal((await postTurn(service, OTHER_SESSION, { text: "one" })).status, 200);
  } finally {
    await service.close();
  }
});

test("a question routed through the ask engine reports the graph's honest emptiness in plain words, never a raw internal error — the turn service has no config or graph file at all", async () => {
  const service = await createLocalTurnService();
  try {
    const result = await postTurn(service, SESSION, { text: "what is a dolphin" });
    assert.equal(result.status, 200);
    assert.doesNotMatch(result.json.narration, /Cannot read propert/, "no raw TypeError text leaks into the narration");
    assert.match(result.json.narration, /the graph at undefined is empty/, "the ask engine's own bootstrap-empty message names the emptiness plainly instead of crashing on a missing config");
  } finally {
    await service.close();
  }
});

/** A minimal handler over a fresh in-memory backend and a spy
 *  `invokeNewsWorker`, bypassing `createLocalTurnService`'s own local news
 *  worker so these specs check the seam's own call/no-call/failure behavior
 *  directly, independent of what a real materialize cycle does with it. */
function directTurnHandler({ invokeNewsWorker } = {}) {
  return createTurnServiceHandler({
    createSessionBackend: () => createRowMemoryBackend({}),
    counters: { async incrementTurnRate() { return true; } },
    invokeNewsWorker,
  });
}

function directTurnRequest(sessionKey, text) {
  return {
    method: "POST",
    path: `/api/sessions/${sessionKey}/turn`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  };
}

test("a turn that teaches a fact fires one materialize invoke, carrying the session key and a fresh cycle id", async () => {
  const calls = [];
  const turnService = directTurnHandler({ invokeNewsWorker: async (sessionKey, args) => { calls.push({ sessionKey, ...args }); } });
  const result = await turnService.handle(directTurnRequest(SESSION, "remember that zorblatt is a dog"));
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1, "the teach turn fired exactly one invoke");
  assert.equal(calls[0].sessionKey, SESSION);
  assert.equal(calls[0].mode, "materialize");
  assert.equal(typeof calls[0].cycleId, "string");
  assert.ok(calls[0].cycleId.length > 0);
});

test("a turn that touches no facts fires no materialize invoke", async () => {
  const calls = [];
  const turnService = directTurnHandler({ invokeNewsWorker: async (...args) => { calls.push(args); } });
  const result = await turnService.handle(directTurnRequest(SESSION, "hello"));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body).factsTouched, []);
  assert.equal(calls.length, 0, "a turn that learned nothing never reaches the news worker");
});

test("a materialize invoke that rejects never fails the turn that fired it", async () => {
  const turnService = directTurnHandler({ invokeNewsWorker: async () => { throw new Error("the worker function is unreachable"); } });
  const result = await turnService.handle(directTurnRequest(SESSION, "remember that zorblatt is a dog"));
  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.ok(body.factsTouched.length > 0, "the teach itself still landed");
  assert.match(body.reply.toLowerCase(), /zorblatt/, "the reply is unaffected by the invoke's own failure");
});

test("vocabularyFromSeed collects single-word terms from a payload's own facts", () => {
  const payload = {
    individuals: [
      { class: "Fact", attributes: [{ prop: "rdf:subject", value: "dolphin" }, { prop: "rdf:object", value: "sea mammal" }] },
    ],
  };
  assert.deepEqual(vocabularyFromSeed(payload), ["dolphin", "mammal", "sea"]);
});

test("the real mid-bundle seed parses in the one-second class, not the multi-second xl class", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-turn-seed-"));
  const outPath = join(dir, "mid-seed.json");
  try {
    const built = await buildMidSeed(outPath);
    assert.deepEqual(built.bands, MID_BUNDLE_BANDS);
    assert.ok(built.facts > 0, "the mid bundle seeds at least one fact");

    const raw = await readFile(outPath, "utf8");
    const startedAt = performance.now();
    const payload = JSON.parse(raw);
    vocabularyFromSeed(payload);
    const coldConstructionMs = performance.now() - startedAt;

    console.log(`turn service mid-bundle cold construction: ${coldConstructionMs.toFixed(1)} ms, ${built.facts} facts, ${(built.bytes / 1024).toFixed(0)} KB`);
    assert.ok(coldConstructionMs < 2000, `mid-bundle cold construction took ${coldConstructionMs.toFixed(1)} ms, over the one-second class's generous bound`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
