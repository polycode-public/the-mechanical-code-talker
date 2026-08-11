// The post-deploy smoke script's turn-service probe, proven against the
// same local double the turn handler's own tests use — no AWS reachable,
// and none needed: the probe only ever talks HTTP to whatever base URL it's
// handed.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalTurnService } from "../../server/turn-service/local.mjs";
import { turnServiceRoundTrip } from "../../scripts/post-deploy-smoke.mjs";

test("the round trip posts one turn and gets real reply text back from a local double", async () => {
  const service = await createLocalTurnService();
  try {
    const sessionKey = await turnServiceRoundTrip(service.url);
    assert.match(sessionKey, /^[0-9a-f-]{36}$/i);
  } finally {
    await service.close();
  }
});

test("a missing turn service reports the failure instead of throwing past the caller", async () => {
  await assert.rejects(() => turnServiceRoundTrip("http://127.0.0.1:1"), /fetch failed|ECONNREFUSED/);
});

test("the round trip's POST carries x-amz-content-sha256 — the URL auth layer 403s a body-carrying request without it", async () => {
  const service = await createLocalTurnService();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", headers: init?.headers || {} });
    return realFetch(url, init);
  };
  try {
    await turnServiceRoundTrip(service.url);
  } finally {
    globalThis.fetch = realFetch;
    await service.close();
  }

  const postCall = calls.find((call) => call.method === "POST");
  assert.ok(postCall.headers["x-amz-content-sha256"], "the POST carries the payload-hash header");
});
