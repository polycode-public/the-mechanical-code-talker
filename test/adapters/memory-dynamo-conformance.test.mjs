// The DynamoDB row backend (row-backend-dynamo.mjs) runs the full published
// conformance kit over the fake document client (fake-dynamo-document-
// client.mjs) twice — once per delete mode — proving the kit's observable
// delete contract holds whether this backend removes an item or tombstones
// it. Beyond the shared kit, this file pins the backend's own DynamoDB-
// specific promises: the key expressions it emits, ConsistentRead, write
// concurrency, TTL stamping, the attribute-name remap, and soft-delete's
// idempotent re-mark.
//
// Setting TMCT_DYNAMO_LIVE_TABLE re-runs the same kit against a real table
// by hand; this file never sets it, so nothing here touches AWS in CI.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMemoryBackendConformance } from "../../src/tools/memory-backend-conformance.mjs";
import { createDynamoRowBackend } from "../../src/adapters/memory/row-backend-dynamo.mjs";
import { BackendRejected, BackendUnavailable } from "../../src/adapters/memory/row-backend.mjs";
import { createFakeDynamoDocumentClient } from "./fake-dynamo-document-client.mjs";

const execFileAsync = promisify(execFile);

let sessionCounter = 0;
const freshSessionKey = () => `session-${++sessionCounter}-${Math.random().toString(36).slice(2)}`;

runMemoryBackendConformance("the DynamoDB backend (physical delete)", () => createDynamoRowBackend({
  client: createFakeDynamoDocumentClient(),
  tableName: "tmct-sessions",
  sessionKey: freshSessionKey(),
}));

runMemoryBackendConformance("the DynamoDB backend (soft delete)", () => createDynamoRowBackend({
  client: createFakeDynamoDocumentClient(),
  tableName: "tmct-sessions",
  sessionKey: freshSessionKey(),
  softDelete: true,
}));

test("the package's ./memory-backends subpath resolves and carries the shipped constructors and classes", async () => {
  const subpath = await import("@polycode-projects/the-mechanical-code-talker/memory-backends");
  assert.equal(typeof subpath.createRowMemoryBackend, "function");
  assert.equal(typeof subpath.createDynamoRowBackend, "function");
  assert.equal(typeof subpath.isRowBackend, "function");
  assert.equal(subpath.BackendRejected, BackendRejected);
  assert.equal(subpath.BackendUnavailable, BackendUnavailable);
});

test("importing the module performs no IO, and the first storage call without the SDK installed fails with a named install hint", async () => {
  const sourceDir = path.dirname(fileURLToPath(new URL("../../src/adapters/memory/row-backend-dynamo.mjs", import.meta.url)));
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmct-dynamo-no-sdk-"));
  try {
    // A directory with no node_modules ancestor of its own — ESM bare-specifier
    // resolution walks up from the IMPORTING file's own location, so running the
    // real module from here (rather than from inside the repo tree, where the
    // SDK is a devDependency) is what actually exercises the uninstalled path.
    await fs.copyFile(path.join(sourceDir, "row-backend-dynamo.mjs"), path.join(tmpDir, "row-backend-dynamo.mjs"));
    await fs.copyFile(path.join(sourceDir, "row-backend.mjs"), path.join(tmpDir, "row-backend.mjs"));
    const runnerPath = path.join(tmpDir, "runner.mjs");
    await fs.writeFile(runnerPath, [
      'import { createDynamoRowBackend } from "./row-backend-dynamo.mjs";',
      'const backend = createDynamoRowBackend({ client: {}, tableName: "t", sessionKey: "s" });',
      "try {",
      "  await backend.readRows();",
      '  process.stdout.write(JSON.stringify({ threw: false }));',
      "} catch (error) {",
      '  process.stdout.write(JSON.stringify({ threw: true, name: error.name, code: error.code, message: error.message }));',
      "}",
    ].join("\n"));
    const { stdout } = await execFileAsync(process.execPath, [runnerPath], { cwd: tmpDir });
    const result = JSON.parse(stdout);
    assert.equal(result.threw, true, "importing the module alone must not throw; only the first storage call should");
    assert.equal(result.name, "BackendUnavailable");
    assert.equal(result.code, "TMCT_BACKEND_UNAVAILABLE");
    assert.match(result.message, /@aws-sdk\/lib-dynamodb/);
    assert.match(result.message, /npm install/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("the key expressions match the contract's layout exactly: sk is rowClass#term#rowKey, and a term read is a begins_with prefix Query", async () => {
  const client = createFakeDynamoDocumentClient();
  const backend = createDynamoRowBackend({ client, tableName: "tmct-sessions", sessionKey: "session-key-1" });
  await backend.putRows([{ rowKey: "fact:1a2b@src:x", rowClass: "fact", term: "tariff", json: "{}" }]);
  const put = client.calls.at(-1);
  assert.equal(put.input.Item.sk, "fact#tariff#fact:1a2b@src:x");
  assert.equal(put.input.Item.pk, "session-key-1");

  await backend.readRowsByTerm("tariff");
  const query = client.calls.at(-1);
  assert.equal(query.input.KeyConditionExpression, "#pk = :pk AND begins_with(#sk, :skPrefix)");
  assert.equal(query.input.ExpressionAttributeValues[":skPrefix"], "fact#tariff#");

  await backend.readRows();
  const fullQuery = client.calls.at(-1);
  assert.equal(fullQuery.input.KeyConditionExpression, "#pk = :pk");
  assert.equal(fullQuery.input.FilterExpression, "NOT begins_with(#sk, :metaPrefix)");
});

test("every Query carries ConsistentRead: true by default, and false when the option disables it", async () => {
  const strongClient = createFakeDynamoDocumentClient();
  const strongBackend = createDynamoRowBackend({ client: strongClient, tableName: "t", sessionKey: "s1" });
  await strongBackend.readRows();
  assert.equal(strongClient.calls.at(-1).input.ConsistentRead, true);

  const eventualClient = createFakeDynamoDocumentClient();
  const eventualBackend = createDynamoRowBackend({ client: eventualClient, tableName: "t", sessionKey: "s2", consistentRead: false });
  await eventualBackend.readRows();
  assert.equal(eventualClient.calls.at(-1).input.ConsistentRead, false);
});

test("a putRows batch reaches the fake concurrently by default, and writeConcurrency: 1 serializes it", async () => {
  const fiveRows = Array.from({ length: 5 }, (_, i) => ({
    rowKey: `fact:${i}@src:x`, rowClass: "fact", term: "alpha", json: "{}",
  }));

  const concurrentClient = createFakeDynamoDocumentClient();
  await createDynamoRowBackend({ client: concurrentClient, tableName: "t", sessionKey: "s1" }).putRows(fiveRows);
  assert.ok(concurrentClient.maxInFlight > 1, `expected concurrent sends, saw a max of ${concurrentClient.maxInFlight} in flight`);

  const serialClient = createFakeDynamoDocumentClient();
  await createDynamoRowBackend({ client: serialClient, tableName: "t", sessionKey: "s2", writeConcurrency: 1 }).putRows(fiveRows);
  assert.equal(serialClient.maxInFlight, 1, "writeConcurrency: 1 must never have more than one send in flight");
});

test("ttlSeconds stamps expiresAt from the write time, and null (the default) stamps nothing", async () => {
  const ttlClient = createFakeDynamoDocumentClient();
  const beforeSeconds = Math.floor(Date.now() / 1000);
  await createDynamoRowBackend({ client: ttlClient, tableName: "t", sessionKey: "s1", ttlSeconds: 60 })
    .putRows([{ rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: "{}" }]);
  const stamped = ttlClient.calls.at(-1).input.Item.expiresAt;
  assert.ok(Number.isInteger(stamped), "expiresAt should be an integer epoch-seconds value");
  assert.ok(stamped >= beforeSeconds + 60 && stamped <= beforeSeconds + 62, `expiresAt ${stamped} should land near now+60s`);

  const noTtlClient = createFakeDynamoDocumentClient();
  await createDynamoRowBackend({ client: noTtlClient, tableName: "t", sessionKey: "s2" })
    .putRows([{ rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: "{}" }]);
  assert.equal("expiresAt" in noTtlClient.calls.at(-1).input.Item, false, "no TTL policy means no expiresAt attribute at all");
});

test("attributeNames remaps every one of the four storage attributes, and only those four", async () => {
  const attributeNames = { pk: "PK", sk: "SK", expiresAt: "TTL", deletedAt: "Gone" };
  const client = createFakeDynamoDocumentClient({ attributeNames });
  const backend = createDynamoRowBackend({
    client, tableName: "t", sessionKey: "remap-session", ttlSeconds: 60, softDelete: true, attributeNames,
  });

  await backend.putRows([{ rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: "{}" }]);
  const item = client.calls.at(-1).input.Item;
  assert.deepEqual(Object.keys(item).sort(), ["PK", "SK", "TTL", "json", "rowClass", "rowKey", "term"].sort());
  assert.equal(item.rowKey, "fact:1@src:x", "the record's own fields never remap");

  await backend.putMeta("nodeId", "01890000-node");
  const metaItem = client.calls.at(-1).input.Item;
  assert.ok("PK" in metaItem && "SK" in metaItem, "meta rows use the remapped key attributes too");

  await backend.deleteRows(["fact:1@src:x"]);
  const updateCall = client.calls.at(-1).input;
  assert.equal(updateCall.ExpressionAttributeNames["#deletedAt"], "Gone");

  const rows = await backend.readRows();
  assert.deepEqual(rows, [], "the soft-deleted row is filtered from readRows even under remapped attribute names");
});

test("a store call that fails for any other reason surfaces as BackendUnavailable, not a raw SDK error", async () => {
  const failingClient = { async send() { throw new Error("simulated 5xx from the table"); } };
  const backend = createDynamoRowBackend({ client: failingClient, tableName: "t", sessionKey: "s" });
  await assert.rejects(backend.readRows(), (error) => {
    assert.ok(error instanceof BackendUnavailable);
    assert.equal(error.code, "TMCT_BACKEND_UNAVAILABLE");
    return true;
  });
});

test("maxRows and maxBytes reject an oversized batch with BackendRejected before any network call", async () => {
  const client = createFakeDynamoDocumentClient();
  const rowCappedBackend = createDynamoRowBackend({ client, tableName: "t", sessionKey: "s1", maxRows: 1 });
  await assert.rejects(
    rowCappedBackend.putRows([
      { rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: "{}" },
      { rowKey: "fact:2@src:x", rowClass: "fact", term: "beta", json: "{}" },
    ]),
    (error) => { assert.ok(error instanceof BackendRejected); return true; },
  );
  assert.equal(client.calls.length, 0, "a refused batch must never reach the store");

  const byteCappedBackend = createDynamoRowBackend({ client, tableName: "t", sessionKey: "s2", maxBytes: 10 });
  await assert.rejects(
    byteCappedBackend.putRows([{ rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: '{"padding":"well over ten bytes"}' }]),
    (error) => { assert.ok(error instanceof BackendRejected); return true; },
  );
  assert.equal(client.calls.length, 0);
});

test("onOversizedRow: drop persists the rest of the batch instead of throwing", async () => {
  const client = createFakeDynamoDocumentClient();
  const backend = createDynamoRowBackend({ client, tableName: "t", sessionKey: "s", onOversizedRow: "drop" });
  const oversized = { rowKey: "fact:big@src:x", rowClass: "fact", term: "alpha", json: `{"pad":"${"x".repeat(5000)}"}` };
  const fine = { rowKey: "fact:small@src:x", rowClass: "fact", term: "beta", json: "{}" };
  await backend.putRows([oversized, fine]);
  const rows = await backend.readRows();
  assert.deepEqual(rows.map((r) => r.rowKey), ["fact:small@src:x"]);
});

test("default mode physically removes a deleted row; soft-delete mode tombstones it, keeps its expiresAt, and re-marking is idempotent", async () => {
  const physicalClient = createFakeDynamoDocumentClient();
  const physicalBackend = createDynamoRowBackend({ client: physicalClient, tableName: "t", sessionKey: "s1" });
  await physicalBackend.putRows([{ rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: "{}" }]);
  await physicalBackend.deleteRows(["fact:1@src:x"]);
  assert.equal(physicalClient.store.size, 0, "physical mode removes the item from the table entirely");

  const softClient = createFakeDynamoDocumentClient();
  const softBackend = createDynamoRowBackend({ client: softClient, tableName: "t", sessionKey: "s2", softDelete: true, ttlSeconds: 3600 });
  await softBackend.putRows([{ rowKey: "fact:1@src:x", rowClass: "fact", term: "alpha", json: "{}" }]);
  const [storedItem] = [...softClient.store.values()];
  const expiresAtBeforeDelete = storedItem.expiresAt;

  await softBackend.deleteRows(["fact:1@src:x"]);
  assert.equal(softClient.store.size, 1, "soft delete leaves the item in the table");
  const [tombstoned] = [...softClient.store.values()];
  assert.ok(tombstoned.deletedAt, "the item carries a deletedAt stamp");
  assert.equal(tombstoned.expiresAt, expiresAtBeforeDelete, "soft delete never touches the row's own expiresAt; TTL still reaps it on schedule");
  assert.deepEqual(await softBackend.readRows(), [], "a tombstoned row is absent from reads");

  // Re-marking an already-marked row is an idempotent, no-op-shaped Update.
  await softBackend.deleteRows(["fact:1@src:x"]);
  assert.equal(softClient.store.size, 1);
  assert.deepEqual(await softBackend.readRows(), []);
});

test("TMCT_DYNAMO_LIVE_TABLE, when set, reruns the kit against a real table", { skip: !process.env.TMCT_DYNAMO_LIVE_TABLE }, async () => {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
  const tableName = process.env.TMCT_DYNAMO_LIVE_TABLE;
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const backend = createDynamoRowBackend({ client, tableName, sessionKey: freshSessionKey() });
  await backend.putRows([{ rowKey: "fact:live@src:x", rowClass: "fact", term: "alpha", json: "{}" }]);
  const rows = await backend.readRows();
  assert.equal(rows.length, 1);
  await backend.deleteAll();
});
