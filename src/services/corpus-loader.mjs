// corpus-loader.mjs — load, clear and read the shared, read-only corpus
// bands (corpus-bands.mjs) over an injected DynamoDB-shaped document client:
// the AWS SDK's `DynamoDBDocument` convenience wrapper (`.put`/`.get`/
// `.delete`/`.query`, no Command objects), the same client shape
// `termQueryOverDocumentClient` (subgraph-retrieval.mjs) already reads. This
// module holds no credentials and imports no AWS package itself — the
// consumer constructs the client (a profile locally, OIDC in CI) and injects
// it, matching the shipped DynamoDB row backend's own discipline (§3.10).
//
// `queryBandTerm` lives here rather than in corpus-bands.mjs because it
// wraps subgraph-retrieval.mjs's `termQueryOverDocumentClient` — the one
// term-Query implementation this whole surface shares — and that module is
// services-layer; corpus-bands.mjs is adapters-layer and may not import
// upward into it (test/estate/import-layers.test.mjs).
//
// Load streams the source jsonl (wire-row-shaped facts, one per line),
// writes each with bounded concurrency, and writes the manifest row last —
// a run that dies mid-load leaves individually valid rows and a stale
// manifest, and re-running completes it, because every write is a content-
// addressed overwrite. Load is also a no-op when the source digest matches
// the manifest already on the band, which is what makes a CI job that runs
// this against every band on every deploy cheap.
//
// Clear queries the whole band partition and physically deletes every item
// it finds, manifest last. Physical, not the row service's soft delete: the
// loader holds AWS credentials on the operator's side of the trust line, not
// a public API caller's.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import {
  bandPartitionKey, bandSortKeyForRow, buildBandManifest, bandLicenseInfo, MANIFEST_SORT_KEY,
} from "../adapters/memory/corpus-bands.mjs";
import { BackendRejected, BackendUnavailable, assertValidRow } from "../adapters/memory/row-backend.mjs";
import { termQueryOverDocumentClient } from "./subgraph-retrieval.mjs";

const DEFAULT_WRITE_CONCURRENCY = 25;

/** Runs `fn` over `items` with at most `limit` calls in flight, mirroring the
 *  DynamoDB row backend's own bounded-concurrency write loop. */
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

/** Every store call funnels through here so a network failure or a
 *  429/5xx-shaped rejection surfaces as `BackendUnavailable`, never a raw
 *  client error a caller would have to string-match. */
async function call(fn, label) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BackendRejected || error instanceof BackendUnavailable) throw error;
    throw new BackendUnavailable(`corpus loader's ${label} call failed: ${error.message}`, { cause: error });
  }
}

/** sha256 of a file's bytes, streamed — the source digest the loader's
 *  no-op check compares against the manifest already on the band. */
export async function digestFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

/** Stream a wire-row jsonl (one `{rowKey, rowClass, term, json}` per line),
 *  validating each row on the way in — a malformed source row is a
 *  `BackendRejected`, naming the line, before anything reaches the store. */
async function* readWireRows(path) {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const raw of rl) {
    lineNumber += 1;
    const line = raw.trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new BackendRejected(`${path}:${lineNumber}: not valid JSON: ${error.message}`);
    }
    assertValidRow(row);
    yield row;
  }
}

/** The manifest row for `band`, or null when the band has never been loaded. */
export async function bandStatus({ client, tableName, band }) {
  const result = await call(
    () => client.get({ TableName: tableName, Key: { pk: bandPartitionKey(band), sk: MANIFEST_SORT_KEY } }),
    "get",
  );
  return result?.Item ? { ...result.Item } : null;
}

/** Every item (fact rows and the manifest, if present) under a band's
 *  partition, paginated. Shared by `clearBand` and any caller that wants a
 *  full inventory rather than one term's rows. */
async function queryWholePartition({ client, tableName, band }) {
  const items = [];
  let exclusiveStartKey;
  do {
    const response = await call(() => client.query({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": bandPartitionKey(band) },
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }), "query");
    items.push(...(response?.Items || []));
    exclusiveStartKey = response?.LastEvaluatedKey || null;
  } while (exclusiveStartKey);
  return items;
}

/** Load `band` from a jsonl source of wire rows. Resolves to
 *  `{status: "unchanged" | "loaded" | "dry-run", band, rowCount, sourceDigest}`.
 *  `dryRun` computes the digest and reports what would happen without
 *  writing anything. */
export async function loadBand({
  client, tableName, band, source, dryRun = false,
  writeConcurrency = DEFAULT_WRITE_CONCURRENCY, now = () => new Date().toISOString(),
}) {
  if (!client) throw new TypeError("loadBand needs a client");
  if (!tableName) throw new TypeError("loadBand needs a tableName");
  if (!band) throw new TypeError("loadBand needs a band");
  if (!source) throw new TypeError("loadBand needs a source path");

  const sourceDigest = await digestFile(source);
  const existing = await bandStatus({ client, tableName, band });
  if (existing?.sourceDigest === sourceDigest) {
    return { status: "unchanged", band, rowCount: existing.rowCount, sourceDigest };
  }

  const pk = bandPartitionKey(band);
  let rowCount = 0;
  const { license, notice } = bandLicenseInfo(band);

  if (!dryRun) {
    const rows = [];
    for await (const row of readWireRows(source)) rows.push(row);
    rowCount = rows.length;
    await mapWithConcurrency(rows, writeConcurrency, async (row) => {
      const item = {
        pk, sk: bandSortKeyForRow(row.rowClass, row.term, row.rowKey),
        rowKey: row.rowKey, rowClass: row.rowClass, term: row.term, json: row.json,
      };
      await call(() => client.put({ TableName: tableName, Item: item }), "put");
    });
    const manifest = buildBandManifest({
      band, rowCount, loadedAt: now(), sourceDigest, license, notice,
    });
    await call(() => client.put({
      TableName: tableName,
      Item: { pk, sk: MANIFEST_SORT_KEY, ...manifest },
    }), "put");
    return { status: "loaded", band, rowCount, sourceDigest };
  }

  for await (const _row of readWireRows(source)) rowCount += 1;
  return { status: "dry-run", band, rowCount, sourceDigest };
}

/** Physically delete every item under `band`'s partition, manifest last.
 *  Idempotent: an empty partition (already cleared, or never loaded) is a
 *  no-op. Resolves to `{band, deleted}`. */
export async function clearBand({ client, tableName, band, writeConcurrency = DEFAULT_WRITE_CONCURRENCY }) {
  if (!client) throw new TypeError("clearBand needs a client");
  if (!tableName) throw new TypeError("clearBand needs a tableName");
  if (!band) throw new TypeError("clearBand needs a band");

  const items = await queryWholePartition({ client, tableName, band });
  const facts = items.filter((item) => item.sk !== MANIFEST_SORT_KEY);
  const manifestItem = items.find((item) => item.sk === MANIFEST_SORT_KEY);

  await mapWithConcurrency(facts, writeConcurrency, async (item) => {
    await call(() => client.delete({ TableName: tableName, Key: { pk: item.pk, sk: item.sk } }), "delete");
  });
  if (manifestItem) {
    await call(() => client.delete({ TableName: tableName, Key: { pk: manifestItem.pk, sk: manifestItem.sk } }), "delete");
  }
  return { band, deleted: items.length };
}

const DEFAULT_BAND_QUERY_PAGE_SIZE = 200;

/** One term's rows from one band, fully paginated, wrapping
 *  subgraph-retrieval.mjs's `termQueryOverDocumentClient` — the one term
 *  Query this whole surface shares. `client` is the same convenience
 *  document client (`.query({...})` resolving to `{Items,
 *  LastEvaluatedKey}`) `loadBand`/`clearBand` already take. Returns plain
 *  wire rows (`{rowKey, rowClass, term, json}`), with the storage-only
 *  `pk`/`sk` stripped — the loader's own read-back checks and the read-only
 *  corpus route both call this rather than issuing their own Query. */
export async function queryBandTerm(client, tableName, band, term, { pageSize = DEFAULT_BAND_QUERY_PAGE_SIZE } = {}) {
  const queryTerm = termQueryOverDocumentClient({ client, tableName, pageSize });
  const rows = [];
  let exclusiveStartKey;
  for (;;) {
    const response = await queryTerm({ band, term, exclusiveStartKey });
    for (const item of response.rows) {
      rows.push({ rowKey: item.rowKey, rowClass: item.rowClass, term: item.term, json: item.json });
    }
    exclusiveStartKey = response.lastEvaluatedKey;
    if (!exclusiveStartKey) break;
  }
  return rows;
}
