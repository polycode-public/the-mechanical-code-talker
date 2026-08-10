// chat-browser-entry.mjs's and ledger-browser-entry.mjs's AWS backend mode:
// createChatSession/createLedgerSession's `awsSessionKey` option binds the
// session's memory to the row service (server/row-service/local.mjs's real
// double, never a fake of the client's own making) with the seed payload as
// a read-only overlay, and discardAwsSession purges it. Local (in-memory)
// sessions are unaffected — this file is the engine-level contract; the
// pages' own copy/slider/URL wiring is pinned in the e2e specs instead.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createLocalRowService } from "../../server/row-service/local.mjs";
import { createChatSession, discardAwsSession } from "../../src/surfaces/web/chat-browser-entry.mjs";
import { createLedgerSession } from "../../src/surfaces/web/ledger-browser-entry.mjs";
import { createInMemoryStore, appendFact, loadMemory } from "../../src/adapters/memory/core.mjs";

const service = await createLocalRowService({});
after(async () => { await service.close(); });

/** Resolves this module's own root-relative paths ("/api/…") against a
 *  running service's base URL — the same resolution a browser's ambient
 *  fetch does for free against `document.location`. */
function fetchAgainst(baseUrl) {
  return (path, init) => fetch(new URL(path, baseUrl), init);
}

const seedPayload = { individuals: [], objectProperties: [] };

test("createChatSession: an awsSessionKey binds memory to the row service, and a taught fact restores on reopen", async () => {
  const key = randomUUID();
  const fetchImpl = fetchAgainst(service.url);

  const first = createChatSession({ seedPayload, awsSessionKey: key, fetchImpl });
  const taught = await first.turn("a zorble is a kind of animal");
  assert.match(taught.answer, /^noted — remembered:/);

  const reopened = createChatSession({ seedPayload, awsSessionKey: key, fetchImpl });
  const recall = await reopened.turn("what is a zorble");
  assert.match(recall.answer, /zorble is a kind of animal/);
  assert.match(recall.answer, /source: teach:chat:/);
});

test("createChatSession: two AWS-mode sessions under different keys never share a store", async () => {
  const fetchImpl = fetchAgainst(service.url);
  const a = createChatSession({ seedPayload, awsSessionKey: randomUUID(), fetchImpl });
  await a.turn("a wibblefrog is a kind of mammal");

  const b = createChatSession({ seedPayload, awsSessionKey: randomUUID(), fetchImpl });
  const miss = await b.turn("what is a wibblefrog");
  assert.match(miss.answer, /I don't know "wibblefrog" yet/);
});

test("discardAwsSession: purges an AWS-mode session's rows, so a reopen under the same key is an honest miss again", async () => {
  const key = randomUUID();
  const fetchImpl = fetchAgainst(service.url);

  const first = createChatSession({ seedPayload, awsSessionKey: key, fetchImpl });
  await first.turn("a snarklebee is a kind of insect");

  await discardAwsSession(first.memoryDir);

  const reopened = createChatSession({ seedPayload, awsSessionKey: key, fetchImpl });
  const miss = await reopened.turn("what is a snarklebee");
  assert.match(miss.answer, /I don't know "snarklebee" yet/, "the purge reached the service, not just this handle's cache");
});

test("discardAwsSession: a no-op for a local (in-memory) session — nothing server-side to discard", async () => {
  const local = createChatSession({ seedPayload });
  await local.turn("a fennoc is a kind of dog");
  await discardAwsSession(local.memoryDir);
  const recall = await local.turn("what is a fennoc");
  assert.match(recall.answer, /fennoc is a kind of dog/, "a local session's own memory is untouched by the AWS-mode purge seam");
});

test("createLedgerSession: an awsSessionKey binds memory to the row service, and a taught fact restores on reopen", async () => {
  const key = randomUUID();
  const fetchImpl = fetchAgainst(service.url);

  const first = createLedgerSession({ seedPayload, awsSessionKey: key, fetchImpl });
  const taught = await first.turn("a blorp is a kind of peg");
  assert.match(taught.answer, /^noted — remembered:/);

  const reopened = createLedgerSession({ seedPayload, awsSessionKey: key, fetchImpl });
  const recall = await reopened.turn("what is a blorp");
  assert.match(recall.answer, /blorp is a kind of peg/);
});

test("a fact carried in the seed answers without ever being taught — the seed is a read-only overlay, not session memory", async () => {
  // A tiny, real seed built with the engine's own appendFact (never the raw
  // network), so its shape is guaranteed valid without needing the full
  // corpus build.
  const scratch = createInMemoryStore();
  await appendFact(scratch, { subject: "tarquin", predicate: "is a kind of", object: "widget", provenance: "corpus:seed-test" });
  const seedWithFact = await loadMemory(scratch);

  const key = randomUUID();
  const fetchImpl = fetchAgainst(service.url);
  const session = createChatSession({ seedPayload: seedWithFact, vocabSeeded: true, awsSessionKey: key, fetchImpl });
  const { answer, record } = await session.turn("what is a tarquin");
  assert.match(answer, /tarquin is a kind of widget/, "the seed's own fact grounds the answer with nothing taught this session");
  assert.ok(!record?.miss);
});
