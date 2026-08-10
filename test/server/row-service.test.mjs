// The row service: real routing, real validation, real error semantics,
// driven through `local.mjs`'s node:http double over the in-memory
// reference backend. Every check here exercises the handler exactly as a
// real caller would — no reaching into its internals.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalRowService } from "../../server/row-service/local.mjs";
import { bandFactRow } from "../../src/adapters/memory/corpus-bands.mjs";

const SESSION_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SESSION_B = "b2b2b2b2-b2b2-4b2b-9b2b-b2b2b2b2b2b2";

function fixtureRow(rowKey, overrides = {}) {
  return { rowKey, rowClass: "fact", term: "tariff", json: JSON.stringify({ ord: 0 }), ...overrides };
}

async function putRows(url, sessionKey, rows, headers = {}) {
  return fetch(`${url}/api/sessions/${sessionKey}/rows`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ puts: rows }),
  });
}

async function getRows(url, sessionKey) {
  return fetch(`${url}/api/rows`, { headers: { "x-tmct-session": sessionKey } });
}

async function deleteRows(url, sessionKey, body) {
  return fetch(`${url}/api/sessions/${sessionKey}/rows`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withService(options, run) {
  const service = await createLocalRowService(options);
  try {
    await run(service);
  } finally {
    await service.close();
  }
}

test("a valid v4 session key is accepted in the header and in the path", async () => {
  await withService({}, async (service) => {
    const putResponse = await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    assert.equal(putResponse.status, 204);

    const getResponse = await getRows(service.url, SESSION_A);
    assert.equal(getResponse.status, 200);
    const { rows } = await getResponse.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rowKey, "fact:1@src:1");
  });
});

test("missing, malformed, wrong-version, and wrong-variant session keys are each a 400 before any storage call", async () => {
  await withService({}, async (service) => {
    const noHeader = await fetch(`${service.url}/api/rows`);
    assert.equal(noHeader.status, 400);

    const malformed = await getRows(service.url, "not-a-uuid-at-all");
    assert.equal(malformed.status, 400);

    // version nibble must be "4" — this one carries "7".
    const wrongVersion = await getRows(service.url, "a1a1a1a1-a1a1-7a1a-8a1a-a1a1a1a1a1a1");
    assert.equal(wrongVersion.status, 400);

    // variant nibble must be 8/9/a/b — this one carries "1".
    const wrongVariant = await getRows(service.url, "a1a1a1a1-a1a1-4a1a-1a1a-a1a1a1a1a1a1");
    assert.equal(wrongVariant.status, 400);

    // The same four shapes, rejected in the path on a mutating route.
    for (const badKey of ["not-a-uuid", "a1a1a1a1-a1a1-7a1a-8a1a-a1a1a1a1a1a1", "a1a1a1a1-a1a1-4a1a-1a1a-a1a1a1a1a1a1"]) {
      const response = await putRows(service.url, badKey, [fixtureRow("fact:x@src:1")]);
      assert.equal(response.status, 400, badKey);
    }

    // None of the rejections left anything behind for a key that happens to look valid later.
    const stillEmpty = await getRows(service.url, SESSION_A);
    assert.deepEqual((await stillEmpty.json()).rows, []);
  });
});

test("a mutating request whose path segment and header disagree is a 400", async () => {
  await withService({}, async (service) => {
    const response = await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")], { "x-tmct-session": SESSION_B });
    assert.equal(response.status, 400);

    const stillEmptyA = await getRows(service.url, SESSION_A);
    assert.deepEqual((await stillEmptyA.json()).rows, []);
  });
});

test("a fresh key's first write is an implicit session mint, and an unknown key reads as an empty session", async () => {
  await withService({}, async (service) => {
    const beforeAnyWrite = await getRows(service.url, SESSION_A);
    assert.equal(beforeAnyWrite.status, 200);
    assert.deepEqual((await beforeAnyWrite.json()).rows, [], "no prior mint, no session endpoint, just an empty read");

    const firstWrite = await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    assert.equal(firstWrite.status, 204);

    const afterWrite = await getRows(service.url, SESSION_A);
    assert.equal((await afterWrite.json()).rows.length, 1);

    const neverTouched = await getRows(service.url, SESSION_B);
    assert.deepEqual((await neverTouched.json()).rows, [], "a key nobody ever wrote through stays an empty session");
  });
});

test("the whole batch is validated before anything applies", async () => {
  await withService({}, async (service) => {
    const response = await putRows(service.url, SESSION_A, [
      fixtureRow("fact:good@src:1"),
      { rowKey: "fact:bad@src:1", rowClass: "not-a-real-class", term: "x", json: "{}" },
    ]);
    assert.equal(response.status, 400);

    const rows = await getRows(service.url, SESSION_A);
    assert.deepEqual((await rows.json()).rows, [], "the good row in the same batch never landed");
  });
});

test("a non-JSON content-type on a mutating request is a 400", async () => {
  await withService({}, async (service) => {
    const response = await fetch(`${service.url}/api/sessions/${SESSION_A}/rows`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ puts: [fixtureRow("fact:1@src:1")] }),
    });
    assert.equal(response.status, 400);
  });
});

test("a request body over the byte cap is a 413", async () => {
  await withService({}, async (service) => {
    const response = await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1", { json: "x".repeat(300_000) })]);
    assert.equal(response.status, 413);
  });
});

test("the mutation rate cap answers 429 with nothing applied", async () => {
  await withService({ mutationRateLimit: 2 }, async (service) => {
    const first = await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    assert.equal(first.status, 204);
    const second = await putRows(service.url, SESSION_A, [fixtureRow("fact:2@src:1")]);
    assert.equal(second.status, 204);
    const third = await putRows(service.url, SESSION_A, [fixtureRow("fact:3@src:1")]);
    assert.equal(third.status, 429);

    const rows = await getRows(service.url, SESSION_A);
    assert.equal((await rows.json()).rows.length, 2, "the refused third write left no trace");
  });
});

test("the global table cap answers 507 with nothing applied, and a delete never frees it", async () => {
  await withService({ tableRowCap: 3 }, async (service) => {
    const fits = await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1"), fixtureRow("fact:2@src:1"), fixtureRow("fact:3@src:1")]);
    assert.equal(fits.status, 204);

    const overCap = await putRows(service.url, SESSION_B, [fixtureRow("fact:1@src:2")]);
    assert.equal(overCap.status, 507);
    const sessionBRows = await getRows(service.url, SESSION_B);
    assert.deepEqual((await sessionBRows.json()).rows, [], "nothing applied on the refused write");

    const purge = await deleteRows(service.url, SESSION_A, { all: true });
    assert.equal(purge.status, 204);
    assert.deepEqual((await (await getRows(service.url, SESSION_A)).json()).rows, []);

    const stillOverCap = await putRows(service.url, SESSION_B, [fixtureRow("fact:2@src:2")]);
    assert.equal(stillOverCap.status, 507, "the counter never decremented on delete");
  });
});

test("only the reconcile mode trues the global counter back down", async () => {
  await withService({ tableRowCap: 3 }, async (service) => {
    await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1"), fixtureRow("fact:2@src:1"), fixtureRow("fact:3@src:1")]);
    await deleteRows(service.url, SESSION_A, { all: true });
    assert.equal((await putRows(service.url, SESSION_B, [fixtureRow("fact:1@src:2")])).status, 507);

    const physicalCount = await service.reconcile();
    assert.equal(physicalCount, 0, "every row was purged, and the reference backend deletes physically");

    const afterReconcile = await putRows(service.url, SESSION_B, [fixtureRow("fact:1@src:2")]);
    assert.equal(afterReconcile.status, 204, "reconcile freed the room the counter had refused to give back");
  });
});

test("TTL_DAYS stamps expiresAt on written rows; leaving it unset stamps nothing", async () => {
  let clockSeconds = 1_000_000;
  await withService({ ttlDays: 1, now: () => clockSeconds }, async (service) => {
    await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    const rows = (await (await getRows(service.url, SESSION_A)).json()).rows;
    assert.equal(rows[0].expiresAt, clockSeconds + 86400);
  });

  await withService({ ttlDays: null, now: () => clockSeconds }, async (service) => {
    await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    const rows = (await (await getRows(service.url, SESSION_A)).json()).rows;
    assert.equal(rows[0].expiresAt, undefined, "no TTL policy configured, nothing stamped");
  });
});

test("a keyed delete leaves the row absent from every later read, and repeated deletes are idempotent", async () => {
  await withService({}, async (service) => {
    await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1"), fixtureRow("fact:2@src:1")]);

    const firstDelete = await deleteRows(service.url, SESSION_A, { rowKeys: ["fact:1@src:1"] });
    assert.equal(firstDelete.status, 204);
    const afterFirstDelete = (await (await getRows(service.url, SESSION_A)).json()).rows.map((row) => row.rowKey);
    assert.deepEqual(afterFirstDelete, ["fact:2@src:1"]);

    const secondDelete = await deleteRows(service.url, SESSION_A, { rowKeys: ["fact:1@src:1"] });
    assert.equal(secondDelete.status, 204, "deleting an already-deleted key is a no-op 204, not an error");
    const afterSecondDelete = (await (await getRows(service.url, SESSION_A)).json()).rows.map((row) => row.rowKey);
    assert.deepEqual(afterSecondDelete, ["fact:2@src:1"]);
  });
});

test("a {all: true} delete leaves the whole session absent, rows and meta alike", async () => {
  await withService({}, async (service) => {
    await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    await fetch(`${service.url}/api/sessions/${SESSION_A}/meta/nodeId`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "node-1" }),
    });

    const purge = await deleteRows(service.url, SESSION_A, { all: true });
    assert.equal(purge.status, 204);

    assert.deepEqual((await (await getRows(service.url, SESSION_A)).json()).rows, []);
    const metaAfterPurge = await fetch(`${service.url}/api/meta/nodeId`, { headers: { "x-tmct-session": SESSION_A } });
    assert.equal(metaAfterPurge.status, 404);
  });
});

test("a body naming neither rowKeys nor {all: true}, or both, is a 400", async () => {
  await withService({}, async (service) => {
    const neither = await deleteRows(service.url, SESSION_A, {});
    assert.equal(neither.status, 400);
    const both = await deleteRows(service.url, SESSION_A, { rowKeys: ["fact:1@src:1"], all: true });
    assert.equal(both.status, 400);
  });
});

test("a purge never resets the session's own mutation rate", async () => {
  await withService({ mutationRateLimit: 2 }, async (service) => {
    await putRows(service.url, SESSION_A, [fixtureRow("fact:1@src:1")]);
    const purge = await deleteRows(service.url, SESSION_A, { all: true });
    assert.equal(purge.status, 204, "the purge itself is the session's second mutation");

    const thirdMutation = await putRows(service.url, SESSION_A, [fixtureRow("fact:2@src:1")]);
    assert.equal(thirdMutation.status, 429, "the purge counted toward the same limit as any other mutation");
  });
});

test("GET /api/meta/:key reads a value back, and 404s when there is none", async () => {
  await withService({}, async (service) => {
    const missing = await fetch(`${service.url}/api/meta/nodeId`, { headers: { "x-tmct-session": SESSION_A } });
    assert.equal(missing.status, 404);

    const put = await fetch(`${service.url}/api/sessions/${SESSION_A}/meta/nodeId`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "node-1" }),
    });
    assert.equal(put.status, 204);

    const found = await fetch(`${service.url}/api/meta/nodeId`, { headers: { "x-tmct-session": SESSION_A } });
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { value: "node-1" });
  });
});

test("GET /api/rows?class=&term= serves the dormant term read", async () => {
  await withService({}, async (service) => {
    await putRows(service.url, SESSION_A, [
      fixtureRow("fact:1@src:1", { term: "tariff" }),
      fixtureRow("fact:2@src:1", { term: "quota" }),
      { rowKey: "bookkeeping:1", rowClass: "bookkeeping", term: "", json: "{}" },
    ]);

    const byTerm = await fetch(`${service.url}/api/rows?term=tariff`, { headers: { "x-tmct-session": SESSION_A } });
    assert.deepEqual((await byTerm.json()).rows.map((row) => row.rowKey), ["fact:1@src:1"]);

    const byClassAndTerm = await fetch(`${service.url}/api/rows?class=fact&term=quota`, { headers: { "x-tmct-session": SESSION_A } });
    assert.deepEqual((await byClassAndTerm.json()).rows.map((row) => row.rowKey), ["fact:2@src:1"]);

    const byClassOnly = await fetch(`${service.url}/api/rows?class=bookkeeping`, { headers: { "x-tmct-session": SESSION_A } });
    assert.deepEqual((await byClassOnly.json()).rows.map((row) => row.rowKey), ["bookkeeping:1"]);
  });
});

test("an unrouted method or path is a 404", async () => {
  await withService({}, async (service) => {
    const wrongMethod = await fetch(`${service.url}/api/rows`, { method: "POST", headers: { "x-tmct-session": SESSION_A } });
    assert.equal(wrongMethod.status, 404);
    const wrongPath = await fetch(`${service.url}/api/nothing-here`);
    assert.equal(wrongPath.status, 404);
  });
});

const TARIFF_BAND_ROWS = [
  bandFactRow({ subject: "tariff", predicate: "rdfs:subClassOf", object: "tax", provenance: "corpus:wordnet-complete", band: "wordnet-complete", ord: 0 }),
];

test("GET /api/corpus/:band/rows needs no session key and 404s an unconfigured or unknown band", async () => {
  await withService({ fixtureBand: { name: "wordnet-complete", rows: TARIFF_BAND_ROWS } }, async (service) => {
    const unknownBand = await fetch(`${service.url}/api/corpus/conceptnet-full/rows?term=tariff`);
    assert.equal(unknownBand.status, 404);
  });
  // No fixture at all: every band is unconfigured, so even the band name a
  // fixture would have used still 404s.
  await withService({}, async (service) => {
    const noBandsConfigured = await fetch(`${service.url}/api/corpus/wordnet-complete/rows?term=tariff`);
    assert.equal(noBandsConfigured.status, 404);
  });
});

test("GET /api/corpus/:band/rows serves an exact-term match with no session header", async () => {
  await withService({ fixtureBand: { name: "wordnet-complete", rows: TARIFF_BAND_ROWS } }, async (service) => {
    const response = await fetch(`${service.url}/api/corpus/wordnet-complete/rows?term=tariff`);
    assert.equal(response.status, 200);
    const { rows } = await response.json();
    assert.deepEqual(rows.map((row) => row.rowKey), TARIFF_BAND_ROWS.map((row) => row.rowKey));
  });
});

test("GET /api/corpus/:band/rows without a term is a 400", async () => {
  await withService({ fixtureBand: { name: "wordnet-complete", rows: TARIFF_BAND_ROWS } }, async (service) => {
    const response = await fetch(`${service.url}/api/corpus/wordnet-complete/rows`);
    assert.equal(response.status, 400);
  });
});

test("fuzzy=1 widens the term to its deterministic typo-repair variants; fuzzy off finds nothing for the same typo", async () => {
  await withService({ fixtureBand: { name: "wordnet-complete", rows: TARIFF_BAND_ROWS } }, async (service) => {
    const exactOff = await fetch(`${service.url}/api/corpus/wordnet-complete/rows?term=tarif`);
    assert.deepEqual((await exactOff.json()).rows, []);

    const fuzzyOn = await fetch(`${service.url}/api/corpus/wordnet-complete/rows?term=tarif&fuzzy=1`);
    assert.equal(fuzzyOn.status, 200);
    const { rows } = await fuzzyOn.json();
    assert.deepEqual(rows.map((row) => row.rowKey), TARIFF_BAND_ROWS.map((row) => row.rowKey));
  });
});
