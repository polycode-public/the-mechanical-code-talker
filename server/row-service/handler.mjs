// handler.mjs — the row service: a same-origin HTTP surface over a §3.1 row
// backend. `createRowServiceHandler` is the whole thing — routing, session
// validation, request caps, and error mapping — and it never touches
// storage directly: every read or write goes through the backend the caller
// injects, plus a small `counters` seam for the two things no session-scoped
// backend can answer (a table-wide cap, a per-session mutation rate).
//
// `local.mjs` mounts this core on node:http over the in-memory reference
// backend — the test double every later phase runs against. `handler`
// (below) is the AWS entry point: esbuild bundles this file as the Lambda's
// code, so it also holds the Lambda-event adapter, the real DynamoDB row
// backend construction, and the DynamoDB-backed counters. Neither entry
// point adds routing or validation logic of its own; they only wire the
// core function to a transport and a storage choice.

import { randomUUID } from "node:crypto";
import {
  BackendRejected, BackendUnavailable, rowProblems,
} from "../../src/adapters/memory/row-backend.mjs";
import { createDynamoRowBackend } from "../../src/adapters/memory/row-backend-dynamo.mjs";
import { normFactTerm } from "../../src/domain/hash.mjs";
import { fuzzyVariantsFor } from "../../src/domain/retrieval-plan.mjs";
import { RETRIEVAL_BUDGETS, termQueryOverDocumentClient } from "../../src/services/subgraph-retrieval.mjs";
import { FIRST_CLASS_BANDS } from "../../src/adapters/memory/corpus-bands.mjs";

export const MAX_ROW_SERVICE_BODY_BYTES = 256 * 1024;
export const DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR = 120;
export const MUTATION_RATE_WINDOW_SECONDS = 3600;
export const DEFAULT_CYCLE_RATE_LIMIT_PER_HOUR = 12;
export const CYCLE_RATE_WINDOW_SECONDS = 3600;
// A lock held longer than this belongs to a crashed worker, not a live one —
// the next trigger acquires it rather than 409ing a session forever.
export const CYCLE_LOCK_STALE_MS = 5 * 60 * 1000;
const META_CYCLE_KEY = "cycle";
const META_FEED_KEY = "feed";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSessionKey(value) {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

const SESSION_HEADER = "x-tmct-session";

function redactSessionSegment(path) {
  return path.replace(/\/sessions\/[^/]+/, "/sessions/<redacted>");
}

function jsonBody(payload) {
  return payload === undefined ? "" : JSON.stringify(payload);
}

function respond(status, payload) {
  return { status, headers: payload === undefined ? {} : { "content-type": "application/json" }, body: jsonBody(payload) };
}

function fail(status, message) {
  return respond(status, { error: { message } });
}

function requestBodyBytes(request) {
  return Buffer.byteLength(request.body || "", "utf8");
}

function hasJsonContentType(request) {
  if (!request.body) return true;
  const contentType = request.headers?.["content-type"];
  return typeof contentType === "string" && contentType.split(";")[0].trim().toLowerCase() === "application/json";
}

function parseJsonBody(request) {
  try {
    return { value: request.body ? JSON.parse(request.body) : {} };
  } catch {
    return { error: "the request body is not valid JSON" };
  }
}

function sessionHeaderValue(request) {
  return request.headers?.[SESSION_HEADER];
}

/** The shared guard every mutating route runs first: the caps and the
 *  content-type check, before anything about the body's shape is asked.
 *  Returns an early response on rejection, or null to continue. */
function rejectMalformedMutation(request) {
  if (requestBodyBytes(request) > MAX_ROW_SERVICE_BODY_BYTES) {
    return fail(413, `the request body is over the ${MAX_ROW_SERVICE_BODY_BYTES}-byte cap`);
  }
  if (!hasJsonContentType(request)) return fail(400, "the request body must be application/json");
  return null;
}

/** The session-key gate every route runs: the path segment (mutations) and
 *  the header (reads, and mutations that also sent one) are each checked
 *  against the strict v4 shape before any storage call, and a mutation
 *  carrying both must have them agree. Returns the session key on success,
 *  or an early response on rejection. */
function resolveSessionKey(request, { pathSessionKey } = {}) {
  const headerKey = sessionHeaderValue(request);
  if (pathSessionKey !== undefined) {
    if (!isValidSessionKey(pathSessionKey)) return { response: fail(400, "the session key in the path is not a valid v4 UUID") };
    if (headerKey !== undefined && headerKey !== pathSessionKey) {
      return { response: fail(400, "the session key in the path and the x-tmct-session header disagree") };
    }
    return { sessionKey: pathSessionKey };
  }
  if (!isValidSessionKey(headerKey)) return { response: fail(400, "the x-tmct-session header is missing or not a valid v4 UUID") };
  return { sessionKey: headerKey };
}

function errorFromBackendFailure(error) {
  if (error instanceof BackendRejected) return fail(400, error.message);
  if (error instanceof BackendUnavailable) return fail(503, error.message);
  throw error;
}

const ROWS_MUTATION_PATH = /^\/api\/sessions\/([^/]+)\/rows$/;
const ROWS_DELETE_PATH = /^\/api\/sessions\/([^/]+)\/rows\/delete$/;
const META_MUTATION_PATH = /^\/api\/sessions\/([^/]+)\/meta\/([^/]+)$/;
const META_READ_PATH = /^\/api\/meta\/([^/]+)$/;
const CYCLE_TRIGGER_PATH = /^\/api\/sessions\/([^/]+)\/(poll|enrich|ingest)$/;
const FEED_READ_PATH = /^\/api\/feed$/;
const CORPUS_READ_PATH = /^\/api\/corpus\/([^/]+)\/rows$/;

/** The row-service core: routing, validation, caps, error mapping. Takes no
 *  storage dependency but the seams every route needs —
 *  `createSessionBackend(sessionKey)` for a §3.1 backend scoped to that
 *  session, `counters` for the table-wide cap and the per-session mutation
 *  and cycle rates, and `invokeNewsWorker(sessionKey, { mode, cycleId, body })`
 *  for the trigger routes' async invoke — none of which any one session's
 *  backend can answer on its own. `ttlSeconds` (null when unset) is stamped
 *  onto every row this service writes; the shipped backends do their own
 *  TTL bookkeeping only when constructed with a `ttlSeconds` of their own,
 *  so a consumer wiring `createDynamoRowBackend` behind this handler leaves
 *  it null and lets the service stamp rows once, not twice.
 *
 *  `corpusBands` (default none) and `queryCorpusTerm` (a
 *  `({band, term, limit}) => Promise<{rows, lastEvaluatedKey}>` function,
 *  e.g. `termQueryOverDocumentClient`'s result) back the one sessionless
 *  read, `GET /api/corpus/:band/rows` — omitting either leaves every band
 *  404, the shape a deployment with no corpus table wiring needs. */
export function createRowServiceHandler({
  createSessionBackend,
  counters,
  invokeNewsWorker,
  ttlSeconds = null,
  now = () => Math.floor(Date.now() / 1000),
  log = () => {},
  corpusBands = [],
  queryCorpusTerm = null,
} = {}) {
  if (typeof createSessionBackend !== "function") {
    throw new TypeError("createRowServiceHandler needs a createSessionBackend(sessionKey) function");
  }
  const REQUIRED_COUNTER_METHODS = ["incrementGlobalRowCount", "incrementMutationRate", "incrementCycleRate", "acquireCycleLock", "releaseCycleLock"];
  if (!counters || REQUIRED_COUNTER_METHODS.some((m) => typeof counters[m] !== "function")) {
    throw new TypeError(`createRowServiceHandler needs a counters seam with ${REQUIRED_COUNTER_METHODS.join(", ")}`);
  }
  if (typeof invokeNewsWorker !== "function") {
    throw new TypeError("createRowServiceHandler needs an invokeNewsWorker(sessionKey, { mode, cycleId, body }) function");
  }

  const stampRowExpiry = (row) => (ttlSeconds == null ? row : { ...row, expiresAt: now() + ttlSeconds });

  async function handleGetRows(request) {
    const gate = resolveSessionKey(request, {});
    if (gate.response) return gate.response;
    const backend = await createSessionBackend(gate.sessionKey);
    const termParam = request.query?.term;
    const classParam = request.query?.class;
    let rows;
    try {
      rows = termParam
        ? (typeof backend.readRowsByTerm === "function"
          ? await backend.readRowsByTerm(termParam)
          : (await backend.readRows()).filter((row) => row.term === termParam))
        : await backend.readRows();
    } catch (error) {
      return errorFromBackendFailure(error);
    }
    if (classParam) rows = rows.filter((row) => row.rowClass === classParam);
    return respond(200, { rows });
  }

  async function handleGetMeta(request, key) {
    const gate = resolveSessionKey(request, {});
    if (gate.response) return gate.response;
    const backend = await createSessionBackend(gate.sessionKey);
    let value;
    try {
      value = await backend.readMeta(key);
    } catch (error) {
      return errorFromBackendFailure(error);
    }
    if (value === null || value === undefined) return fail(404, "no meta value under that key");
    return respond(200, { value });
  }

  async function handlePutRows(request, pathSessionKey) {
    const gate = resolveSessionKey(request, { pathSessionKey });
    if (gate.response) return gate.response;
    const { sessionKey } = gate;
    const malformed = rejectMalformedMutation(request);
    if (malformed) return malformed;

    const parsed = parseJsonBody(request);
    if (parsed.error) return fail(400, parsed.error);
    const puts = parsed.value?.puts;
    if (!Array.isArray(puts) || puts.length === 0) return fail(400, "the body must carry a non-empty puts array");

    const stamped = puts.map(stampRowExpiry);
    for (const row of stamped) {
      const problems = rowProblems(row);
      if (problems.length) return fail(400, `invalid row ${JSON.stringify(row?.rowKey ?? null)}: ${problems.join("; ")}`);
    }

    const rateOk = await counters.incrementMutationRate(sessionKey);
    if (!rateOk) return fail(429, "this session's mutation rate is over its hourly limit");
    const capOk = await counters.incrementGlobalRowCount(stamped.length);
    if (!capOk) return fail(507, "the table has reached its configured row cap");

    const backend = await createSessionBackend(sessionKey);
    try {
      await backend.putRows(stamped);
    } catch (error) {
      return errorFromBackendFailure(error);
    }
    return respond(204);
  }

  async function handleDeleteRows(request, pathSessionKey) {
    const gate = resolveSessionKey(request, { pathSessionKey });
    if (gate.response) return gate.response;
    const { sessionKey } = gate;
    const malformed = rejectMalformedMutation(request);
    if (malformed) return malformed;

    const parsed = parseJsonBody(request);
    if (parsed.error) return fail(400, parsed.error);
    const body = parsed.value || {};
    const hasRowKeys = Array.isArray(body.rowKeys);
    const hasAll = body.all === true;
    if (hasRowKeys === hasAll) return fail(400, "the body must carry exactly one of rowKeys or {all: true}");

    const rateOk = await counters.incrementMutationRate(sessionKey);
    if (!rateOk) return fail(429, "this session's mutation rate is over its hourly limit");

    const backend = await createSessionBackend(sessionKey);
    try {
      if (hasAll) await backend.deleteAll();
      else await backend.deleteRows(body.rowKeys);
    } catch (error) {
      return errorFromBackendFailure(error);
    }
    return respond(204);
  }

  async function handlePutMeta(request, pathSessionKey, key) {
    const gate = resolveSessionKey(request, { pathSessionKey });
    if (gate.response) return gate.response;
    const { sessionKey } = gate;
    const malformed = rejectMalformedMutation(request);
    if (malformed) return malformed;

    const parsed = parseJsonBody(request);
    if (parsed.error) return fail(400, parsed.error);
    if (typeof parsed.value?.value !== "string") return fail(400, "the body must carry a string value");

    const rateOk = await counters.incrementMutationRate(sessionKey);
    if (!rateOk) return fail(429, "this session's mutation rate is over its hourly limit");

    const backend = await createSessionBackend(sessionKey);
    try {
      await backend.putMeta(key, parsed.value.value);
    } catch (error) {
      return errorFromBackendFailure(error);
    }
    return respond(204);
  }

  /** GET /api/corpus/:band/rows?term=X&fuzzy=0|1 — the one sessionless,
   *  read-only route: public reference-corpus rows for a term. No session
   *  key, no rate limit beyond the shared per-IP edge rule (§3.9's
   *  corpus-read-flooding row treats this as a cost surface, not a
   *  confidentiality one). An unconfigured or unknown band 404s before any
   *  query. `fuzzy=1` widens the one requested term to its deterministic
   *  typo-repair variants (the same fixed edit-distance machinery retrieval
   *  uses), each read with its own single-page Query — this route never
   *  drains a band partition, it takes one page per term and stops. */
  async function handleCorpusRead(request, bandParam) {
    const band = decodeURIComponent(bandParam);
    if (typeof queryCorpusTerm !== "function" || !corpusBands.includes(band)) {
      return fail(404, `no such corpus band ${JSON.stringify(band)}`);
    }
    const term = normFactTerm(request.query?.term || "");
    if (!term) return fail(400, "the term query parameter is required");
    const fuzzy = request.query?.fuzzy === "1";

    const terms = new Set([term]);
    if (fuzzy) {
      for (const variant of fuzzyVariantsFor(term, { cap: RETRIEVAL_BUDGETS.fuzzyVariantsPerTerm })) terms.add(variant);
    }

    const byRowKey = new Map();
    for (const oneTerm of [...terms].sort()) {
      let response;
      try {
        response = await queryCorpusTerm({ band, term: oneTerm, limit: RETRIEVAL_BUDGETS.rowsPerQueryPage });
      } catch (error) {
        return errorFromBackendFailure(error);
      }
      for (const row of response?.rows || []) {
        byRowKey.set(row.rowKey, { rowKey: row.rowKey, rowClass: row.rowClass, term: row.term, json: row.json });
      }
    }
    const rows = [...byRowKey.values()].sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
    return respond(200, { rows });
  }

  async function handleGetFeed(request) {
    const gate = resolveSessionKey(request, {});
    if (gate.response) return gate.response;
    const backend = await createSessionBackend(gate.sessionKey);
    let raw;
    try {
      raw = await backend.readMeta(META_FEED_KEY);
    } catch (error) {
      return errorFromBackendFailure(error);
    }
    if (raw === null || raw === undefined) return fail(404, "no materialized feed for this session yet");
    let feed;
    try { feed = JSON.parse(raw); } catch { return fail(500, "the stored feed document is not valid JSON"); }
    return respond(200, { feed });
  }

  /** POST /api/sessions/:uuid/poll|enrich|ingest: validate, acquire the
   *  session's cycle lock, stamp a running cycle marker for the page's own
   *  display, async-invoke the news worker, and answer before the cycle
   *  runs. One running cycle per session (409, via the lock — never a
   *  read-then-write race on the marker document, since two triggers can
   *  land in the same tick); the cycle rate and the ordinary mutation rate
   *  both count a trigger (429 either way). The lock releases once the
   *  invoked cycle settles, or on its own once `CYCLE_LOCK_STALE_MS` has
   *  passed, so a crashed worker never wedges a session. */
  async function handleCycleTrigger(request, pathSessionKey, kind) {
    const gate = resolveSessionKey(request, { pathSessionKey });
    if (gate.response) return gate.response;
    const { sessionKey } = gate;
    const malformed = rejectMalformedMutation(request);
    if (malformed) return malformed;

    const parsed = parseJsonBody(request);
    if (parsed.error) return fail(400, parsed.error);
    const body = parsed.value || {};

    if (kind === "ingest") {
      const hasText = typeof body.text === "string" && body.text.trim().length > 0;
      const hasRows = Array.isArray(body.rows) && body.rows.length > 0;
      if (hasText === hasRows) return fail(400, "the body must carry exactly one of text or rows");
    }

    const nowSeconds = now();
    const nowMsVal = nowSeconds * 1000;
    const nowIso = new Date(nowMsVal).toISOString();

    const lockOk = await counters.acquireCycleLock(sessionKey, { nowMsVal, staleMs: CYCLE_LOCK_STALE_MS });
    if (!lockOk) return fail(409, "a cycle is already running for this session");

    const cycleRateOk = await counters.incrementCycleRate(sessionKey);
    if (!cycleRateOk) { await counters.releaseCycleLock(sessionKey); return fail(429, "this session's cycle rate is over its hourly limit"); }
    const mutationRateOk = await counters.incrementMutationRate(sessionKey);
    if (!mutationRateOk) { await counters.releaseCycleLock(sessionKey); return fail(429, "this session's mutation rate is over its hourly limit"); }

    const backend = await createSessionBackend(sessionKey);
    const cycleId = randomUUID();
    try {
      await backend.putMeta(META_CYCLE_KEY, JSON.stringify({ cycleId, kind, state: "running", startedAt: nowIso, sources: {} }));
    } catch (error) {
      await counters.releaseCycleLock(sessionKey);
      return errorFromBackendFailure(error);
    }

    Promise.resolve(invokeNewsWorker(sessionKey, { mode: kind, cycleId, body }))
      .catch((error) => log({ error: error.message, cycleId }))
      .finally(() => counters.releaseCycleLock(sessionKey));

    return respond(202, { cycleId });
  }

  /** `request` is transport-neutral: `{ method, path, headers (lowercased
   *  keys), query, body (a string or "") }`. Both `local.mjs` and the Lambda
   *  entry below adapt their own transport into this shape and adapt the
   *  `{ status, headers, body }` result back out. */
  async function handle(request) {
    const method = request.method?.toUpperCase();
    const path = request.path || "/";
    log({ method, path: redactSessionSegment(path) });

    try {
      if (method === "GET" && path === "/api/rows") return await handleGetRows(request);

      const metaRead = path.match(META_READ_PATH);
      if (method === "GET" && metaRead) return await handleGetMeta(request, decodeURIComponent(metaRead[1]));

      const rowsMutation = path.match(ROWS_MUTATION_PATH);
      if (rowsMutation && method === "PUT") return await handlePutRows(request, rowsMutation[1]);
      if (rowsMutation && method === "DELETE") return await handleDeleteRows(request, rowsMutation[1]);

      // CloudFront's OAC signs a DELETE as body-less, so a body-carrying
      // DELETE can never pass edge auth. POST .../rows/delete takes the same
      // body and does the same thing — the edge-safe spelling of a delete.
      const rowsDelete = path.match(ROWS_DELETE_PATH);
      if (rowsDelete && method === "POST") return await handleDeleteRows(request, rowsDelete[1]);

      const metaMutation = path.match(META_MUTATION_PATH);
      if (metaMutation && method === "PUT") {
        return await handlePutMeta(request, metaMutation[1], decodeURIComponent(metaMutation[2]));
      }

      if (method === "GET" && FEED_READ_PATH.test(path)) return await handleGetFeed(request);

      const corpusRead = path.match(CORPUS_READ_PATH);
      if (corpusRead && method === "GET") return await handleCorpusRead(request, corpusRead[1]);

      const cycleTrigger = path.match(CYCLE_TRIGGER_PATH);
      if (cycleTrigger && method === "POST") return await handleCycleTrigger(request, cycleTrigger[1], cycleTrigger[2]);

      return fail(404, "no such row-service route");
    } catch (error) {
      log({ error: error.message });
      return fail(500, "the row service failed unexpectedly");
    }
  }

  return { handle };
}

// ---------------------------------------------------------------------------
// The AWS entry point. Bundled directly as the Lambda's code
// (`npm run build:row-service`), invoked either by the function URL (a
// row-service HTTP request, API Gateway payload format 2.0) or by the daily
// EventBridge rule with a static `{"mode":"reconcile"}` input. Both paths
// share one lazily-built document client per execution environment; a fresh
// `createSessionBackend` result per call is still the rule (§3.6), since
// building the wrapper object is cheap and keeps every invocation's session
// scoping honest even when the container is reused.

const GLOBAL_COUNTER_SK = "counter";
const META_PARTITION_KEY = "_meta";
const RATE_SK_PREFIX = "rate#";
const CYCLE_RATE_SK_PREFIX = "cyclerate#";
const CYCLE_LOCK_SK_PREFIX = "cyclelock#";

// Two client SHAPES over one raw DynamoDBClient, cached once per execution
// environment: the `.send(Command)` client every counter and the row backend
// itself take, and the `.query()` convenience client `queryCorpusTerm`
// (`termQueryOverDocumentClient`) takes — the same split turn-service/
// handler.mjs's own Lambda entry point uses, for the same corpus-band reads.
let cachedClientsPromise = null;
async function loadDocumentClients() {
  if (!cachedClientsPromise) {
    cachedClientsPromise = (async () => {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      const { DynamoDBDocumentClient, DynamoDBDocument } = await import("@aws-sdk/lib-dynamodb");
      const raw = new DynamoDBClient({});
      return { commandClient: DynamoDBDocumentClient.from(raw), convenienceClient: DynamoDBDocument.from(raw) };
    })();
  }
  return cachedClientsPromise;
}

/** One conditional `UpdateCommand` against a raw `_meta` item: the condition
 *  is either the item doesn't exist yet or the running count still leaves
 *  room, so a call that would cross `limit` fails the condition and applies
 *  nothing. The one primitive every counter here shares — the global table
 *  cap, the per-session mutation/cycle rates, and (via
 *  `createDynamoGlobalRowCapCounter` below) the turn service's own writes
 *  against that same global cap. */
async function conditionalAdd({ client, tableName, sk, amount, limit, expiresAt }) {
  const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
  try {
    await client.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: META_PARTITION_KEY, sk },
      UpdateExpression: expiresAt === undefined
        ? "ADD #count :amount"
        : "ADD #count :amount SET #expiresAt = if_not_exists(#expiresAt, :expiresAt)",
      ConditionExpression: "attribute_not_exists(#count) OR #count <= :threshold",
      ExpressionAttributeNames: expiresAt === undefined
        ? { "#count": "count" }
        : { "#count": "count", "#expiresAt": "expiresAt" },
      ExpressionAttributeValues: expiresAt === undefined
        ? { ":amount": amount, ":threshold": limit - amount }
        : { ":amount": amount, ":threshold": limit - amount, ":expiresAt": expiresAt },
    }));
    return true;
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") return false;
    throw new BackendUnavailable(`the row-service counter update failed: ${error.message}`, { cause: error });
  }
}

/** The one seam a session write from ANY surface needs to count toward
 *  §3.8's table-wide `TABLE_ROW_CAP`: this service's own PUT /rows route
 *  uses it directly, and the turn service imports this factory so a turn's
 *  learned facts land against the exact same reserved counter item — one
 *  cap, shared by every writer, never a per-surface copy that could drift
 *  from it. */
export function createDynamoGlobalRowCapCounter({ client, tableName, tableRowCap }) {
  return {
    async incrementGlobalRowCount(n) {
      return conditionalAdd({ client, tableName, sk: GLOBAL_COUNTER_SK, amount: n, limit: tableRowCap });
    },
  };
}

/** The counters seam over raw DynamoDB items in the same table the row
 *  backend uses, under the reserved `_meta` partition no valid v4 session
 *  key can ever collide with. */
function createDynamoCounters({
  client, tableName, tableRowCap,
  mutationRateLimit = DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR, mutationRateWindowSeconds = MUTATION_RATE_WINDOW_SECONDS,
  cycleRateLimit = DEFAULT_CYCLE_RATE_LIMIT_PER_HOUR, cycleRateWindowSeconds = CYCLE_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const { incrementGlobalRowCount } = createDynamoGlobalRowCapCounter({ client, tableName, tableRowCap });

  return {
    incrementGlobalRowCount,
    async incrementMutationRate(sessionKey) {
      return conditionalAdd({
        client, tableName,
        sk: `${RATE_SK_PREFIX}${sessionKey}`,
        amount: 1,
        limit: mutationRateLimit,
        expiresAt: now() + mutationRateWindowSeconds,
      });
    },
    async incrementCycleRate(sessionKey) {
      return conditionalAdd({
        client, tableName,
        sk: `${CYCLE_RATE_SK_PREFIX}${sessionKey}`,
        amount: 1,
        limit: cycleRateLimit,
        expiresAt: now() + cycleRateWindowSeconds,
      });
    },
    /** The trigger routes' one-cycle-per-session lock: a conditional
     *  `UpdateCommand` that only lands when no lock is held, or the held one
     *  is older than `staleMs` — the same settle-every-race shape every
     *  other conditional write here uses, so two triggers landing in the
     *  same millisecond can never both acquire it. */
    async acquireCycleLock(sessionKey, { nowMsVal, staleMs }) {
      const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { pk: META_PARTITION_KEY, sk: `${CYCLE_LOCK_SK_PREFIX}${sessionKey}` },
          UpdateExpression: "SET lockedAt = :now",
          ConditionExpression: "attribute_not_exists(lockedAt) OR lockedAt <= :staleFloor",
          ExpressionAttributeValues: { ":now": nowMsVal, ":staleFloor": nowMsVal - staleMs },
        }));
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw new BackendUnavailable(`the row-service cycle lock update failed: ${error.message}`, { cause: error });
      }
    },
    async releaseCycleLock(sessionKey) {
      const { DeleteCommand } = await import("@aws-sdk/lib-dynamodb");
      await client.send(new DeleteCommand({ TableName: tableName, Key: { pk: META_PARTITION_KEY, sk: `${CYCLE_LOCK_SK_PREFIX}${sessionKey}` } }));
    },
    /** Rewrites the counter to a physical count. Not conditional: the daily
     *  reconcile is the one caller allowed to move the counter down. */
    async setGlobalRowCount(n) {
      const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
      await client.send(new PutCommand({ TableName: tableName, Item: { pk: META_PARTITION_KEY, sk: GLOBAL_COUNTER_SK, count: n } }));
    },
  };
}

/** The daily reconcile: a paginated `Scan` (`Select: "COUNT"`) over the
 *  whole table, physical and unfiltered, so a soft-deleted row still counts
 *  until TTL takes it — then the counter is rewritten from that number.
 *  Drift between reconciles only ever pushes the counter up (§29.7), so
 *  this is the one place it comes back down. */
async function reconcileTableRowCount({ client, tableName, counters }) {
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  let total = 0;
  let exclusiveStartKey;
  do {
    const result = await client.send(new ScanCommand({ TableName: tableName, Select: "COUNT", ExclusiveStartKey: exclusiveStartKey }));
    total += result.Count || 0;
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  await counters.setGlobalRowCount(total);
  return total;
}

function requestFromLambdaEvent(event) {
  const headers = {};
  for (const [key, value] of Object.entries(event.headers || {})) headers[key.toLowerCase()] = value;
  let body = event.body || "";
  if (event.isBase64Encoded && body) body = Buffer.from(body, "base64").toString("utf8");
  return {
    method: event.requestContext?.http?.method || "GET",
    path: event.rawPath || "/",
    headers,
    query: event.queryStringParameters || {},
    body,
  };
}

function lambdaResponseFromResult(result) {
  return { statusCode: result.status, headers: result.headers, body: result.body, isBase64Encoded: false };
}

function rowServiceConfigFromEnv() {
  const ttlDays = process.env.TTL_DAYS ? Number(process.env.TTL_DAYS) : 7;
  const tableRowCap = process.env.TABLE_ROW_CAP ? Number(process.env.TABLE_ROW_CAP) : 2_000_000;
  const bandsRaw = process.env.TMCT_CORPUS_BANDS;
  const corpusBands = bandsRaw === undefined ? [...FIRST_CLASS_BANDS] : bandsRaw.split(",").map((b) => b.trim()).filter(Boolean);
  return { tableName: process.env.TABLE_NAME, ttlSeconds: ttlDays * 86400, tableRowCap, corpusBands };
}

let cachedLambdaClientPromise = null;
async function loadLambdaClient() {
  if (!cachedLambdaClientPromise) {
    cachedLambdaClientPromise = (async () => {
      const { LambdaClient } = await import("@aws-sdk/client-lambda");
      return new LambdaClient({});
    })();
  }
  return cachedLambdaClientPromise;
}

/** The trigger routes' async-invoke seam in AWS: an `InvocationType: "Event"`
 *  invoke of the news worker function, so this call returns as soon as the
 *  invoke request is accepted, before the cycle itself runs. The worker
 *  function's name is a deployment parameter — the CDK phase that wires this
 *  Lambda's IAM policy to invoke it also sets `NEWS_WORKER_FUNCTION_NAME`. */
function createLambdaNewsWorkerInvoker({ functionName }) {
  return async function invokeNewsWorker(sessionKey, { mode, cycleId, body }) {
    const { InvokeCommand } = await import("@aws-sdk/client-lambda");
    const client = await loadLambdaClient();
    await client.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ sessionKey, mode, cycleId, body })),
    }));
  };
}

/** The Lambda entry point esbuild bundles. A `{"mode":"reconcile"}` event
 *  (the daily EventBridge rule's static input) runs the physical recount;
 *  anything else is a function-URL HTTP request through the same handler
 *  every other consumer of this file exercises. */
export const handler = async (event) => {
  const { tableName, ttlSeconds, tableRowCap, corpusBands } = rowServiceConfigFromEnv();
  const { commandClient: client, convenienceClient } = await loadDocumentClients();
  const counters = createDynamoCounters({ client, tableName, tableRowCap });

  if (event?.mode === "reconcile") {
    const total = await reconcileTableRowCount({ client, tableName, counters });
    return { reconciled: total };
  }

  const rowService = createRowServiceHandler({
    createSessionBackend: (sessionKey) => createDynamoRowBackend({ client, tableName, sessionKey, softDelete: true }),
    counters,
    invokeNewsWorker: createLambdaNewsWorkerInvoker({ functionName: process.env.NEWS_WORKER_FUNCTION_NAME }),
    ttlSeconds,
    corpusBands,
    queryCorpusTerm: corpusBands.length ? termQueryOverDocumentClient({ client: convenienceClient, tableName }) : null,
    log: () => {},
  });
  const result = await rowService.handle(requestFromLambdaEvent(event));
  return lambdaResponseFromResult(result);
};
