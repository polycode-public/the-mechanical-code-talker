// row-backend-dynamo.mjs — the DynamoDB row backend: the shipped, production
// storage adapter for the row-backend contract (row-backend.mjs). A consumer
// builds an @aws-sdk/lib-dynamodb document client with their own credentials
// and injects it here; this module holds no credentials and builds no
// client of its own.
//
// The AWS SDK loads lazily. Importing this module performs no IO and pulls
// no AWS code, so installing tmct never requires the SDK. The first storage
// call runs `await import("@aws-sdk/lib-dynamodb")` once, caches the command
// constructors, and a consumer who never installed the SDK sees a named
// error explaining what to add.
//
// Table shape, per the contract's recommended key layout: partition key is
// the session key; sort key is "<rowClass>#<term>#<rowKey>" for a row,
// "meta#<key>" for a sidecar value. A term-prefix Query is then one line
// (`begins_with(sk, "fact#<term>#")`), no table change needed later. The
// sort key alone can't be decoded back into rowClass/term/rowKey (a rowKey
// can itself carry "#" or "@"), so those travel as their own item attributes
// too. `attributeNames` remaps only the four storage attribute names — pk,
// sk, expiresAt, deletedAt; rowKey/rowClass/term/json/value are fixed wire
// vocabulary and never remap.
//
// Deletes arrive as bare rowKeys with no rowClass or term attached (the
// contract's own shape), so there is no way to build the target sk without
// first finding the item. `deleteRows`/`deleteAll` both Query the whole
// session partition, then loop Delete (physical mode) or Update (soft-delete
// mode, stamping `deletedAt`) over what they found.

import {
  BackendRejected, BackendUnavailable, assertValidRow, rowProblems, rowJsonBytes,
  ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION,
} from "./row-backend.mjs";

const META_SK_PREFIX = "meta#";
const SDK_MODULE_SPECIFIER = "@aws-sdk/lib-dynamodb";

const DEFAULT_ATTRIBUTE_NAMES = Object.freeze({
  pk: "pk", sk: "sk", expiresAt: "expiresAt", deletedAt: "deletedAt",
});

const nowEpochSeconds = () => Math.floor(Date.now() / 1000);
const OVERSIZED_ONLY = /over the \d+-byte cap$/;

// Cached across every backend instance in this process — the SDK's command
// constructors never change per session, so there is nothing session-scoped
// to re-fetch. A failed import is not cached: a consumer who installs the
// SDK after a first failed call should have their very next call succeed.
let sdkPromise = null;
async function loadDynamoCommands() {
  if (!sdkPromise) {
    sdkPromise = import(SDK_MODULE_SPECIFIER).catch((cause) => {
      sdkPromise = null;
      throw new BackendUnavailable(
        `the DynamoDB row backend needs "${SDK_MODULE_SPECIFIER}" (>=3) installed alongside tmct; run \`npm install ${SDK_MODULE_SPECIFIER}\` and retry`,
        { cause },
      );
    });
  }
  return sdkPromise;
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once.
 *  `writeConcurrency: Infinity` (the default) runs the whole batch together —
 *  batches are 1-5 rows, so that is the natural ceiling; `1` serializes it. */
async function mapWithConcurrency(items, limit, fn) {
  if (!items.length) return;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
}

export function createDynamoRowBackend({
  client,
  tableName,
  sessionKey,
  ttlSeconds = null,
  softDelete = false,
  consistentRead = true,
  writeConcurrency = Infinity,
  onOversizedRow = "throw",
  basePayload = null,
  maxRows = null,
  maxBytes = null,
  attributeNames = DEFAULT_ATTRIBUTE_NAMES,
} = {}) {
  if (!client) throw new TypeError("createDynamoRowBackend needs a client (an @aws-sdk/lib-dynamodb DynamoDBDocumentClient)");
  if (!tableName) throw new TypeError("createDynamoRowBackend needs a tableName");
  if (!sessionKey) throw new TypeError("createDynamoRowBackend needs a sessionKey");

  const names = { ...DEFAULT_ATTRIBUTE_NAMES, ...attributeNames };
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new BackendUnavailable("this row backend was closed and can no longer be used");
  };

  const primaryKey = (sk) => ({ [names.pk]: sessionKey, [names.sk]: sk });
  const skForRow = (rowClass, term, rowKey) => `${rowClass}#${term}#${rowKey}`;
  const skForMeta = (metaKey) => `${META_SK_PREFIX}${metaKey}`;
  const expiresAtToStamp = () => (ttlSeconds == null ? undefined : nowEpochSeconds() + ttlSeconds);

  function rowFromItem(item) {
    const row = { rowKey: item.rowKey, rowClass: item.rowClass, term: item.term, json: item.json };
    const expiresAt = item[names.expiresAt];
    if (typeof expiresAt === "number") row.expiresAt = expiresAt;
    return row;
  }

  /** Wraps every store call so a network failure or a 429/5xx-shaped
   *  rejection surfaces as `BackendUnavailable`, never a raw SDK error a
   *  consumer would have to string-match. `BackendRejected`/`BackendUnavailable`
   *  raised deliberately elsewhere in this module (the SDK-missing error,
   *  the size caps) pass through unchanged. */
  async function send(command) {
    try {
      return await client.send(command);
    } catch (error) {
      if (error instanceof BackendRejected || error instanceof BackendUnavailable) throw error;
      throw new BackendUnavailable(`the DynamoDB row backend's store call failed: ${error.message}`, { cause: error });
    }
  }

  async function query({ keyConditionExpression, filterExpression, expressionAttributeNames, expressionAttributeValues }) {
    const { QueryCommand } = await loadDynamoCommands();
    const items = [];
    let exclusiveStartKey;
    do {
      const result = await send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConsistentRead: consistentRead,
        ExclusiveStartKey: exclusiveStartKey,
      }));
      items.push(...(result.Items || []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  /** Every item under this session's partition, row and meta alike,
   *  regardless of soft-delete state — the shared read `deleteRows`/
   *  `deleteAll` resolve a bare rowKey against, since neither can build the
   *  target sk from the rowKey alone. */
  async function queryAllItems() {
    return query({
      keyConditionExpression: "#pk = :pk",
      expressionAttributeNames: { "#pk": names.pk },
      expressionAttributeValues: { ":pk": sessionKey },
    });
  }

  async function readRows() {
    assertOpen();
    // Meta rows are excluded here in code, not in the FilterExpression:
    // DynamoDB rejects any filter that references a key attribute, and the
    // sort key is one.
    const expressionAttributeNames = { "#pk": names.pk };
    let filterExpression;
    if (softDelete) {
      filterExpression = "attribute_not_exists(#deletedAt)";
      expressionAttributeNames["#deletedAt"] = names.deletedAt;
    }
    const items = await query({
      keyConditionExpression: "#pk = :pk",
      filterExpression,
      expressionAttributeNames,
      expressionAttributeValues: { ":pk": sessionKey },
    });
    return items
      .filter((item) => !String(item[names.sk] ?? "").startsWith(META_SK_PREFIX))
      .map(rowFromItem);
  }

  async function readRowsByTerm(term) {
    assertOpen();
    const expressionAttributeNames = { "#pk": names.pk, "#sk": names.sk };
    let filterExpression;
    if (softDelete) {
      filterExpression = "attribute_not_exists(#deletedAt)";
      expressionAttributeNames["#deletedAt"] = names.deletedAt;
    }
    const items = await query({
      keyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
      filterExpression,
      expressionAttributeNames,
      expressionAttributeValues: { ":pk": sessionKey, ":skPrefix": `fact#${term}#` },
    });
    return items.map(rowFromItem);
  }

  async function putRows(candidateRows) {
    assertOpen();
    const rows = candidateRows || [];
    if (maxRows != null && rows.length > maxRows) {
      throw new BackendRejected(`putRows carries ${rows.length} rows, over this session's ${maxRows}-row cap`);
    }
    if (maxBytes != null) {
      const totalBytes = rows.reduce((sum, row) => sum + rowJsonBytes(row), 0);
      if (totalBytes > maxBytes) {
        throw new BackendRejected(`putRows carries ${totalBytes} bytes, over this session's ${maxBytes}-byte cap`);
      }
    }

    const toWrite = [];
    for (const row of rows) {
      const problems = rowProblems(row);
      if (!problems.length) { toWrite.push(row); continue; }
      const oversizedOnly = problems.length === 1 && OVERSIZED_ONLY.test(problems[0]);
      if (oversizedOnly && onOversizedRow === "drop") {
        // The wire row carries no separate provenance field of its own —
        // rowKey is the provenance-derived id (core.mjs's factGroupId
        // model), so it is what a dropped-row log can name.
        console.warn(`tmct memory row backend: dropped oversized row ${JSON.stringify(row?.rowKey ?? null)}`);
        continue;
      }
      assertValidRow(row); // throws BackendRejected naming every problem; aborts the whole batch
    }

    const { PutCommand } = await loadDynamoCommands();
    const expiresAt = expiresAtToStamp();
    await mapWithConcurrency(toWrite, writeConcurrency, async (row) => {
      const item = {
        ...primaryKey(skForRow(row.rowClass, row.term, row.rowKey)),
        rowKey: row.rowKey, rowClass: row.rowClass, term: row.term, json: row.json,
        ...(expiresAt !== undefined ? { [names.expiresAt]: expiresAt } : {}),
      };
      await send(new PutCommand({ TableName: tableName, Item: item }));
    });
  }

  async function applyDeletes(items) {
    if (!items.length) return;
    if (softDelete) {
      const { UpdateCommand } = await loadDynamoCommands();
      await Promise.all(items.map((item) => send(new UpdateCommand({
        TableName: tableName,
        Key: primaryKey(item[names.sk]),
        UpdateExpression: "SET #deletedAt = :deletedAt",
        ExpressionAttributeNames: { "#deletedAt": names.deletedAt },
        ExpressionAttributeValues: { ":deletedAt": Date.now() },
      }))));
      return;
    }
    const { DeleteCommand } = await loadDynamoCommands();
    await Promise.all(items.map((item) => send(new DeleteCommand({
      TableName: tableName,
      Key: primaryKey(item[names.sk]),
    }))));
  }

  async function deleteRows(rowKeys) {
    assertOpen();
    const wanted = new Set(rowKeys || []);
    if (!wanted.size) return;
    const items = await queryAllItems();
    await applyDeletes(items.filter((item) => wanted.has(item.rowKey)));
  }

  async function deleteAll() {
    assertOpen();
    await applyDeletes(await queryAllItems());
  }

  async function readMeta(metaKey) {
    assertOpen();
    const { GetCommand } = await loadDynamoCommands();
    const result = await send(new GetCommand({
      TableName: tableName,
      Key: primaryKey(skForMeta(metaKey)),
      ConsistentRead: consistentRead,
    }));
    const item = result.Item;
    if (!item) return null;
    if (softDelete && item[names.deletedAt] !== undefined) return null;
    return typeof item.value === "string" ? item.value : null;
  }

  async function putMeta(metaKey, value) {
    assertOpen();
    const { PutCommand } = await loadDynamoCommands();
    const expiresAt = expiresAtToStamp();
    const item = {
      ...primaryKey(skForMeta(metaKey)),
      value,
      ...(expiresAt !== undefined ? { [names.expiresAt]: expiresAt } : {}),
    };
    await send(new PutCommand({ TableName: tableName, Item: item }));
  }

  async function close() {
    closed = true;
  }

  return {
    kind: ROW_BACKEND_KIND,
    contractVersion: ROW_BACKEND_CONTRACT_VERSION,
    // Not part of the contract: an inert read-only overlay carried for the
    // wrapping layer (§3.4's basePayload mechanics) to assemble beneath this
    // session's own rows once it lands. This backend never reads or writes it.
    basePayload,
    readRows,
    readRowsByTerm,
    putRows,
    deleteRows,
    readMeta,
    putMeta,
    deleteAll,
    close,
  };
}
