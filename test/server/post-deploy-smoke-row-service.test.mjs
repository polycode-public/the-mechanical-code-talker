// The post-deploy smoke script's row-service probe, proven against the same
// local double the row-service handler's own tests use — no AWS reachable,
// and none needed: the probe only ever talks HTTP to whatever base URL it's
// handed.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalRowService } from "../../server/row-service/local.mjs";
import { rowServiceRoundTrip } from "../../scripts/post-deploy-smoke.mjs";

test("the round trip PUTs, reads back, and deletes its own row against a local double", async () => {
  const service = await createLocalRowService();
  try {
    const sessionKey = await rowServiceRoundTrip(service.url);
    assert.match(sessionKey, /^[0-9a-f-]{36}$/i);

    const rows = await (await fetch(`${service.url}/api/rows`, { headers: { "x-tmct-session": sessionKey } })).json();
    assert.equal(rows.rows.length, 0, "the round trip's own delete leaves nothing behind");
  } finally {
    await service.close();
  }
});

test("a missing row service reports the failure instead of throwing past the caller", async () => {
  await assert.rejects(() => rowServiceRoundTrip("http://127.0.0.1:1"), /fetch failed|ECONNREFUSED/);
});
