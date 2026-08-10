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
