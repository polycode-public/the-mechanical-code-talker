// The HTTP client backend (http-row-backend.mjs) runs the full published
// conformance kit over the wire: a real fetch, against the row service's
// node:http double (server/row-service/local.mjs), over the real in-memory
// reference backend. Three real layers, no fakes, for every check the kit
// runs. Beyond the kit, this file pins the client's own promises: the
// §3.8 status-code error mapping, the 404-on-meta-read-maps-to-null read,
// and the retry-once rule `deleteAll` alone carries.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createLocalRowService } from "../../server/row-service/local.mjs";
import { createHttpRowBackend } from "../../src/surfaces/web/http-row-backend.mjs";
import { runMemoryBackendConformance } from "../../src/tools/memory-backend-conformance.mjs";
import { BackendRejected, BackendUnavailable } from "../../src/adapters/memory/row-backend.mjs";

const service = await createLocalRowService();
after(async () => {
  await service.close();
});

runMemoryBackendConformance("the HTTP client backend, over the wire", () => createHttpRowBackend({
  apiBase: service.url,
  sessionKey: randomUUID(),
  fetchImpl: fetch,
}));

test("apiBase carrying a trailing slash still resolves every route", async () => {
  const backend = createHttpRowBackend({ apiBase: `${service.url}/`, sessionKey: randomUUID(), fetchImpl: fetch });
  await backend.putRows([{ rowKey: "fact:1@src:1", rowClass: "fact", term: "tariff", json: JSON.stringify({ ord: 0 }) }]);
  const rows = await backend.readRows();
  assert.deepEqual(rows.map((row) => row.rowKey), ["fact:1@src:1"]);
});

test("the constructor needs an apiBase, a sessionKey, and a fetchImpl or an ambient fetch", () => {
  assert.throws(() => createHttpRowBackend({ sessionKey: randomUUID(), fetchImpl: fetch }), TypeError);
  assert.throws(() => createHttpRowBackend({ apiBase: service.url, fetchImpl: fetch }), TypeError);
  assert.throws(() => createHttpRowBackend({ apiBase: service.url, sessionKey: randomUUID(), fetchImpl: "not a function" }), TypeError);
});

// The scripted error double: a fetchImpl that never touches the network,
// answering with whatever response (or sequence of responses) each test
// hands it. This is how the §3.8 status-to-class mapping gets pinned
// without needing the real service to reach every one of those statuses.
function scriptedFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const emptyResponse = (status) => new Response(null, { status });

test("400 and 413 map to BackendRejected", async () => {
  for (const status of [400, 413]) {
    const fetchImpl = scriptedFetch([jsonResponse(status, { error: { message: "refused" } })]);
    const backend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl });
    await assert.rejects(
      backend.putRows([{ rowKey: "x", rowClass: "fact", term: "", json: "{}" }]),
      (error) => {
        assert.ok(error instanceof BackendRejected, `status ${status} should be BackendRejected`);
        assert.equal(error.code, "TMCT_BACKEND_REJECTED");
        return true;
      },
    );
  }
});

test("429, 507, and any 5xx map to BackendUnavailable", async () => {
  for (const status of [429, 507, 500, 503]) {
    const fetchImpl = scriptedFetch([jsonResponse(status, { error: { message: "unavailable" } })]);
    const backend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl });
    await assert.rejects(
      backend.putRows([{ rowKey: "x", rowClass: "fact", term: "", json: "{}" }]),
      (error) => {
        assert.ok(error instanceof BackendUnavailable, `status ${status} should be BackendUnavailable`);
        assert.equal(error.code, "TMCT_BACKEND_UNAVAILABLE");
        return true;
      },
    );
  }
});

test("a network failure maps to BackendUnavailable", async () => {
  const fetchImpl = scriptedFetch([new TypeError("fetch failed")]);
  const backend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl });
  await assert.rejects(backend.readRows(), (error) => {
    assert.ok(error instanceof BackendUnavailable);
    assert.equal(error.code, "TMCT_BACKEND_UNAVAILABLE");
    return true;
  });
});

test("readMeta maps a 404 to null rather than an error", async () => {
  const fetchImpl = scriptedFetch([emptyResponse(404)]);
  const backend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl });
  assert.equal(await backend.readMeta("nodeId"), null);
});

test("deleteAll retries once on a 5xx and succeeds if the retry lands", async () => {
  const fetchImpl = scriptedFetch([emptyResponse(503), emptyResponse(204)]);
  const backend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl });
  await backend.deleteAll();
  assert.equal(fetchImpl.calls.length, 2, "the first 503 earned exactly one retry");
});

test("deleteAll still fails as BackendUnavailable when the retry also fails, and tries no further", async () => {
  const fetchImpl = scriptedFetch([emptyResponse(503), emptyResponse(503), emptyResponse(503)]);
  const backend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl });
  await assert.rejects(backend.deleteAll(), BackendUnavailable);
  assert.equal(fetchImpl.calls.length, 2, "one attempt plus one retry, never a third");
});

test("a keyed delete and a put do not retry on a 5xx", async () => {
  const deleteFetch = scriptedFetch([emptyResponse(503), emptyResponse(204)]);
  const deleteBackend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl: deleteFetch });
  await assert.rejects(deleteBackend.deleteRows(["x"]), BackendUnavailable);
  assert.equal(deleteFetch.calls.length, 1, "a keyed delete gets one attempt, unlike deleteAll");

  const putFetch = scriptedFetch([emptyResponse(503), emptyResponse(204)]);
  const putBackend = createHttpRowBackend({ apiBase: "http://example.invalid", sessionKey: randomUUID(), fetchImpl: putFetch });
  await assert.rejects(putBackend.putRows([{ rowKey: "x", rowClass: "fact", term: "", json: "{}" }]), BackendUnavailable);
  assert.equal(putFetch.calls.length, 1, "a put gets one attempt, unlike deleteAll");
});

test("readRows sends the session key in the header; a mutation addresses it in the path", async () => {
  const sessionKey = randomUUID();
  const realFetchCalls = [];
  const spyingBackend = createHttpRowBackend({
    apiBase: service.url,
    sessionKey,
    fetchImpl: (url, init) => {
      realFetchCalls.push({ url: String(url), headers: init?.headers || {} });
      return fetch(url, init);
    },
  });
  await spyingBackend.putRows([{ rowKey: "fact:1@src:1", rowClass: "fact", term: "tariff", json: JSON.stringify({ ord: 0 }) }]);
  await spyingBackend.readRows();

  const putCall = realFetchCalls.find((call) => call.url.includes("/rows") && call.headers["content-type"]);
  assert.ok(putCall.url.includes(`/api/sessions/${sessionKey}/rows`), "the put addresses the session key in the path");
  assert.equal(putCall.headers["x-tmct-session"], undefined, "the put never has to send the header too");

  const getCall = realFetchCalls.find((call) => call.url.endsWith("/api/rows"));
  assert.equal(getCall.headers["x-tmct-session"], sessionKey, "the read carries the session key in the header");

  await spyingBackend.close();
});

test("close() stops the backend from serving further calls", async () => {
  const backend = createHttpRowBackend({ apiBase: service.url, sessionKey: randomUUID(), fetchImpl: fetch });
  await backend.close();
  await assert.rejects(backend.readRows(), BackendUnavailable);
});
