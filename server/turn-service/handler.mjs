// handler.mjs — the turn service: one HTTP route, one full engine turn per
// call. `createTurnServiceHandler` is the whole thing — validation, the
// corpus breaker, retrieval, the engine call, the response — and like the
// row service it never touches storage directly: the session row backend
// and the corpus band reads are both injected.
//
// `local.mjs` mounts this core on node:http over the in-memory session
// backend and a fixture corpus band, the test double every later phase runs
// against. `handler` (below) is the AWS entry point: esbuild bundles this
// file as the Lambda's code, so it also holds the Lambda-event adapter, the
// real DynamoDB wiring, and the mid-bundle seed's lazy load.
//
// The sequence one call runs: validate → the turn-rate counter and the
// corpus breaker (one `_meta` read/write each) → retrieval, unless the
// breaker or an empty band list says skip → a FRESH row backend and a FRESH
// wrapped handle over seed ⊕ subgraph, one per call (warm containers never
// share a handle) → the unchanged synchronous engine → respond. Persisting
// what the turn learned happens inside that same engine call — `runTurn`'s
// own write path (core.mjs's Backend D) — so this module never calls it
// separately.

import { randomUUID } from "node:crypto";
import { BackendUnavailable } from "../../src/adapters/memory/row-backend.mjs";
import { createDynamoRowBackend } from "../../src/adapters/memory/row-backend-dynamo.mjs";
import { wrapRowBackend, emptyMemory, FACT_CLASS } from "../../src/adapters/memory/core.mjs";
import { payloadToRows, rowsToPayload, payloadMeta } from "../../src/adapters/memory/rows.mjs";
import { normFactTerm } from "../../src/domain/hash.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import {
  retrieveSubgraph, resolveFuzzyMode, termQueryOverDocumentClient,
  SUPPLEMENTED_MODE, SEED_SESSION_MODE,
} from "../../src/services/subgraph-retrieval.mjs";
import { createDynamoCorpusBreaker } from "../../src/adapters/memory/dynamo-circuit-breaker.mjs";
import { FIRST_CLASS_BANDS } from "../../src/adapters/memory/corpus-bands.mjs";
import { isValidSessionKey, createDynamoGlobalRowCapCounter } from "../row-service/handler.mjs";

export const MAX_TURN_BODY_BYTES = 4 * 1024;
export const DEFAULT_TURN_RATE_LIMIT_PER_HOUR = 30;
export const TURN_RATE_WINDOW_SECONDS = 3600;

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

/** The one route this surface owns. This file's route table is deliberately
 *  narrow — a consumer wires it alongside the row service's own routes at
 *  the transport layer; neither module reaches into the other's dispatch. */
const TURN_PATH = /^\/api\/sessions\/([^/]+)\/turn$/;

/** Every single-word term the seed's own facts mention, folded through
 *  `normFactTerm` and split on whitespace (a corpus subject is routinely two
 *  words). This is retrieval's fuzzy-mode vocabulary (§3.15.1's "the
 *  lexicon's own vocabulary" over the seed's own store rather than the bare
 *  grammar lexicon), so a persona-band term the grammar never declared still
 *  attracts its own typo repairs. */
export function vocabularyFromSeed(seedPayload) {
  const words = new Set();
  for (const individual of seedPayload?.individuals || []) {
    if (individual?.class !== FACT_CLASS) continue;
    for (const attribute of individual.attributes || []) {
      if (attribute?.prop !== "rdf:subject" && attribute?.prop !== "rdf:object") continue;
      const term = normFactTerm(attribute.value);
      if (!term) continue;
      for (const word of term.split(" ")) if (word) words.add(word);
    }
  }
  return [...words].sort();
}

/** The read-only overlay a turn's engine call runs over: the bundled seed's
 *  rows with this turn's retrieved corpus rows layered on top (a subgraph
 *  row wins a key collision, being the more specific of the two — in
 *  practice they never collide, since a seed fact and a corpus fact never
 *  share a content-addressed id). Session rows go over BOTH, inside
 *  `wrapRowBackend` itself, so the three-layer "seed ⊕ subgraph ⊕ session"
 *  order (§3.15) holds end to end. */
function mergeSeedAndSubgraph(seedPayload, subgraphRows, { log } = {}) {
  const seedRows = payloadToRows(seedPayload || emptyMemory(), { onOversizedRow: "drop", log });
  const byKey = new Map();
  for (const row of seedRows) byKey.set(row.rowKey, row);
  for (const row of subgraphRows || []) byKey.set(row.rowKey, row);
  return rowsToPayload([...byKey.values()], { meta: payloadMeta(seedPayload) });
}

/** The operational line this module folds into every turn's narration: the
 *  retrieval numbers a tuning pass reads (§3.15.1), independent of whatever
 *  honesty marker the answer text itself carries (chat.mjs's enumeration
 *  lanes read `retrieval: {mode, bounded}` off the engine call below for
 *  that; this module never writes answer prose). */
function retrievalNarrationLine(metrics) {
  const parts = [
    `mode=${metrics.mode}`, `rows=${metrics.rows}`, `queries=${metrics.queries}`, `bounded=${metrics.bounded}`,
  ];
  if (metrics.tripped) parts.push(`tripped=${metrics.tripped}`);
  return `retrieval: ${parts.join(" ")}`;
}

function foldRetrievalIntoNarration(narration, metrics) {
  const line = retrievalNarrationLine(metrics);
  return narration ? `${narration}\n${line}` : line;
}

const GENERIC_TURN_FAILURE_TEXT = (message) => `Something went wrong answering that (${message}). Try rephrasing, or /help.`;
const CAP_REACHED_TURN_TEXT = "I can answer, but I can't save anything right now — this deployment's storage is at capacity. Nothing you taught this turn was learned.";

/** Every session write a turn's engine call makes goes through `putRows`
 *  on the handle `wrapRowBackend` returns — so this is the one seam that
 *  makes a turn's learned facts count toward §3.8's table-wide row cap the
 *  same way a direct PUT does. `backend` is unwrapped when no counter is
 *  configured, matching every session read/write it already had. */
function withGlobalRowCap(backend, globalRowCapCounter) {
  if (!globalRowCapCounter) return backend;
  return {
    ...backend,
    async putRows(rows) {
      if (rows.length) {
        const withinCap = await globalRowCapCounter.incrementGlobalRowCount(rows.length);
        if (!withinCap) throw new BackendUnavailable("the table has reached its configured row cap");
      }
      return backend.putRows(rows);
    },
  };
}

/** The turn service's core: routing, validation, the turn-rate limit, the
 *  corpus breaker, retrieval, and the engine call.
 *
 *  `createSessionBackend(sessionKey)` resolves to a §3.1 row backend for
 *  that session (fresh per call is the caller's job, matching the row
 *  service's own construction discipline);
 *
 *  `seedPayload` is the bundled mid-band seed (§3.18), read once by the
 *  caller and passed in as a plain object — this module never parses or
 *  caches it, so a warm container's cold-parse cost is paid exactly once, by
 *  whoever loaded it;
 *
 *  `vocabulary` defaults to `vocabularyFromSeed(seedPayload)`, computed once
 *  here at construction time rather than per turn;
 *
 *  `bands`/`queryTerm` are retrieval's corpus surface — an empty `bands`
 *  array (no bands configured) always answers in seed-session mode, the
 *  same shape a breaker-open skip produces;
 *
 *  `breaker` (optional) is a §3.16 corpus breaker (`{decide, readState}`);
 *  absent, retrieval always runs supplemented (subject to `bands`/
 *  `queryTerm` being present) — a deployment with no live table wiring
 *  passes none and gets no breaker protection, which is only ever correct
 *  for a bandless deployment;
 *
 *  `counters.incrementTurnRate(sessionKey)` is the one seam this module
 *  requires: an atomic per-session-per-hour limit, mirroring the row
 *  service's own mutation-rate counter but under its own key and window.
 *
 *  `globalRowCapCounter` (optional, `{incrementGlobalRowCount(n)}` —
 *  `createDynamoGlobalRowCapCounter`'s shape) is the row service's own
 *  table-wide cap: a turn's learned facts land on the same table a session's
 *  direct PUT does, so without this seam they would never count against
 *  §3.8's `TABLE_ROW_CAP`. Omitted, a turn's writes go uncapped — only ever
 *  correct for a deployment with no shared cap to honour.
 *
 *  `invokeNewsWorker` (optional, `(sessionKey, {mode, cycleId, body}) =>
 *  Promise`, the row service's own trigger seam) closes the feed's staleness
 *  window: a turn whose `factsTouched` is non-empty fires one materialize-
 *  mode invoke after the engine call, so the taught row reaches the news
 *  feed within the next version poll rather than waiting on an unrelated
 *  cycle. The invoke is fired, never awaited, before the response goes out,
 *  and a rejection only logs — a stuck or failing worker never turns a
 *  successful turn into a failed one; the feed just stays one cycle behind.
 *  Omitted, a turn never materializes — only ever correct for a deployment
 *  with no news worker wired up. */
export function createTurnServiceHandler({
  createSessionBackend,
  seedPayload = null,
  vocabulary = null,
  bands = [],
  queryTerm = null,
  breaker = null,
  counters,
  globalRowCapCounter = null,
  invokeNewsWorker = null,
  fuzzyEnv = process.env,
  fuzzyConfig = undefined,
  now = () => Date.now(),
  sleep = undefined,
  // Merged over the production retrieval budgets when set. The budgets are
  // real-clock, so a test proving supplementation (not budget behavior)
  // widens wallTimeMs rather than flaking on a saturated machine.
  retrievalBudgets = null,
  log = () => {},
} = {}) {
  if (typeof createSessionBackend !== "function") {
    throw new TypeError("createTurnServiceHandler needs a createSessionBackend(sessionKey) function");
  }
  if (!counters || typeof counters.incrementTurnRate !== "function") {
    throw new TypeError("createTurnServiceHandler needs a counters seam with incrementTurnRate");
  }

  const resolvedVocabulary = vocabulary ?? vocabularyFromSeed(seedPayload);
  const noSkipDecision = { mode: SUPPLEMENTED_MODE, probe: false, report: async () => {} };
  const forcedSkipDecision = { mode: SEED_SESSION_MODE, probe: false, report: async () => {} };

  async function handleTurn(request, sessionKey) {
    if (requestBodyBytes(request) > MAX_TURN_BODY_BYTES) {
      return fail(413, `the request body is over the ${MAX_TURN_BODY_BYTES}-byte cap`);
    }
    if (!hasJsonContentType(request)) return fail(400, "the request body must be application/json");

    const parsed = parseJsonBody(request);
    if (parsed.error) return fail(400, parsed.error);
    const text = parsed.value?.text;
    if (typeof text !== "string" || !text.trim()) return fail(400, "the body must carry a non-empty text string");
    const requestedFuzzy = parsed.value?.retrieval?.fuzzy;
    if (requestedFuzzy !== undefined && typeof requestedFuzzy !== "boolean") {
      return fail(400, "retrieval.fuzzy must be a boolean");
    }

    const rateOk = await counters.incrementTurnRate(sessionKey);
    if (!rateOk) return fail(429, "this session's turn rate is over its hourly limit");

    const canRetrieve = bands.length > 0 && typeof queryTerm === "function";
    const decision = !canRetrieve ? forcedSkipDecision : breaker ? await breaker.decide() : noSkipDecision;

    const retrieval = await retrieveSubgraph({
      text,
      bands,
      queryTerm,
      fuzzy: resolveFuzzyMode({ request: requestedFuzzy, env: fuzzyEnv, config: fuzzyConfig }),
      skip: decision.mode === SEED_SESSION_MODE,
      vocabulary: resolvedVocabulary,
      budgets: decision.probe ? { totalQueries: 1, hopDepth: 0 } : (retrievalBudgets ?? undefined),
      now,
      ...(sleep ? { sleep } : {}),
    });
    // retrieveSubgraph degrades rather than throwing, so this always runs
    // with a real metrics object.
    await decision.report({ metrics: retrieval.metrics });

    // A fresh WRAPPING handle every call, over whatever `createSessionBackend`
    // hands back — a brand-new `createDynamoRowBackend` in AWS (§3.10), the
    // same long-lived in-memory store across calls in the local double
    // (one DynamoDB table, many requests). This handle is never closed here:
    // closing is the underlying backend's own resource-teardown seam (a real
    // connection in a consumer's own store), never a per-turn concern — the
    // row service's own handler leaves it alone for the same reason, and a
    // local double that closed it here would disable the very session it
    // just wrote to for every turn after this one.
    const basePayload = mergeSeedAndSubgraph(seedPayload, retrieval.rows, { log });
    const sessionBackend = await createSessionBackend(sessionKey);
    const cappedBackend = withGlobalRowCap(sessionBackend, globalRowCapCounter);
    const memoryDir = wrapRowBackend(cappedBackend, { basePayload, onOversizedRow: "drop", log });

    let result;
    try {
      result = await runTurn(text, {
        memoryDir,
        sessionId: sessionKey,
        narrate: true,
        // `bands` rides along so the enumeration honesty marker can tell a
        // bandless deployment's seed-session mode (no line) from a
        // breaker-open skip with bands configured (the absent-supplement
        // line) — dropping it here silently strips the marker from every
        // breaker-open turn.
        retrieval: { mode: retrieval.metrics.mode, bounded: retrieval.metrics.bounded, bands: retrieval.metrics.bands },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log({ error: message });
      // §3.12's posture: a full table still answers the turn, it just
      // doesn't learn from it — the same "continues without persistence"
      // shape every BackendUnavailable consumer takes (§3.1), never a
      // status code the caller would have to branch on.
      const reply = error instanceof BackendUnavailable ? CAP_REACHED_TURN_TEXT : GENERIC_TURN_FAILURE_TEXT(message);
      return respond(200, {
        reply,
        factsTouched: [],
        narration: foldRetrievalIntoNarration(undefined, retrieval.metrics),
      });
    }
    const factsTouched = result.factsTouched || [];
    if (invokeNewsWorker && factsTouched.length) {
      Promise.resolve(invokeNewsWorker(sessionKey, { mode: "materialize", cycleId: randomUUID(), body: {} }))
        .catch((error) => log({ error: error.message, sessionKey }));
    }
    return respond(200, {
      reply: result.answer,
      factsTouched,
      narration: foldRetrievalIntoNarration(result.narration, retrieval.metrics),
    });
  }

  async function handle(request) {
    const method = request.method?.toUpperCase();
    const path = request.path || "/";
    log({ method, path: redactSessionSegment(path) });

    try {
      const match = path.match(TURN_PATH);
      if (!match || method !== "POST") return fail(404, "no such turn-service route");
      const sessionKey = decodeURIComponent(match[1]);
      if (!isValidSessionKey(sessionKey)) return fail(400, "the session key in the path is not a valid v4 UUID");
      return await handleTurn(request, sessionKey);
    } catch (error) {
      log({ error: error.message });
      return fail(500, "the turn service failed unexpectedly");
    }
  }

  return { handle };
}

// ---------------------------------------------------------------------------
// The AWS entry point. Bundled directly as the Lambda's code
// (`npm run build:turn-service`), invoked by the function URL (a turn-service
// HTTP request, API Gateway payload format 2.0). One DynamoDBClient backs
// both client shapes this surface needs: the `.send(Command)` pattern the
// row backend and the corpus breaker take, and the `.query()` convenience
// pattern retrieval's term reads take — built once per execution
// environment and wrapped both ways, matching the row service's own lazy,
// cached SDK load. The mid-bundle seed (§3.18) is loaded and parsed once per
// container for the same reason: warm invocations pay nothing.

const TURN_RATE_SK_PREFIX = "turn-rate#";
const META_PARTITION_KEY = "_meta";

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

let cachedSeedPromise = null;
/** Loads and parses the mid-bundle seed once per container. `seedPath`
 *  defaults to `mid-seed.json` beside this file — `server/turn-service/
 *  build-seed.mjs` (`npm run build:turn-seed`) writes it there; the AWS
 *  package ships both files side by side. */
async function loadMidSeed(seedPath = new URL("./mid-seed.json", import.meta.url)) {
  if (!cachedSeedPromise) {
    cachedSeedPromise = (async () => {
      const { readFile } = await import("node:fs/promises");
      const seedPayload = JSON.parse(await readFile(seedPath, "utf8"));
      return { seedPayload, vocabulary: vocabularyFromSeed(seedPayload) };
    })();
  }
  return cachedSeedPromise;
}

/** The turn-rate counter over raw DynamoDB items in the row service's own
 *  table, under the same reserved `_meta` partition, one conditional
 *  `UpdateCommand` exactly like the row service's `incrementMutationRate` —
 *  its own sort-key prefix and its own window, so the two limits never
 *  collide even though they share a table. */
function createDynamoTurnCounters({
  client, tableName,
  turnRateLimit = DEFAULT_TURN_RATE_LIMIT_PER_HOUR,
  turnRateWindowSeconds = TURN_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
}) {
  return {
    async incrementTurnRate(sessionKey) {
      const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
      const expiresAt = now() + turnRateWindowSeconds;
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { pk: META_PARTITION_KEY, sk: `${TURN_RATE_SK_PREFIX}${sessionKey}` },
          UpdateExpression: "ADD #count :one SET #expiresAt = if_not_exists(#expiresAt, :expiresAt)",
          ConditionExpression: "attribute_not_exists(#count) OR #count <= :threshold",
          ExpressionAttributeNames: { "#count": "count", "#expiresAt": "expiresAt" },
          ExpressionAttributeValues: { ":one": 1, ":threshold": turnRateLimit - 1, ":expiresAt": expiresAt },
        }));
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw new BackendUnavailable(`the turn service's rate counter update failed: ${error.message}`, { cause: error });
      }
    },
  };
}

function turnServiceConfigFromEnv(env = process.env) {
  const ttlDays = env.TTL_DAYS ? Number(env.TTL_DAYS) : 7;
  const bandsRaw = env.TMCT_CORPUS_BANDS;
  const bands = bandsRaw === undefined ? [...FIRST_CLASS_BANDS] : bandsRaw.split(",").map((b) => b.trim()).filter(Boolean);
  return {
    tableName: env.TABLE_NAME,
    ttlSeconds: ttlDays * 86400,
    turnRateLimit: env.TURN_RATE_LIMIT_PER_HOUR ? Number(env.TURN_RATE_LIMIT_PER_HOUR) : DEFAULT_TURN_RATE_LIMIT_PER_HOUR,
    tableRowCap: env.TABLE_ROW_CAP ? Number(env.TABLE_ROW_CAP) : 2_000_000,
    bands,
  };
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

/** The materialize-on-teach invoke, in AWS: an `InvocationType: "Event"`
 *  invoke of the same news worker function the row service's own trigger
 *  routes call, so this returns as soon as the invoke is accepted, well
 *  before the worker's own materialize cycle runs. The worker function's
 *  name is a deployment parameter — the CDK phase that grants this Lambda
 *  invoke rights on it also sets `NEWS_WORKER_FUNCTION_NAME`. */
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

/** The Lambda entry point esbuild bundles: a function-URL HTTP request
 *  through the same handler every other consumer of this file exercises.
 *  No outbound HTTP beyond AWS's own control plane (§2) — every import
 *  above is either this package's own code or an AWS SDK client: DynamoDB
 *  or the news worker's own Lambda invoke. */
export const handler = async (event) => {
  const { tableName, ttlSeconds, turnRateLimit, tableRowCap, bands } = turnServiceConfigFromEnv();
  const [{ commandClient, convenienceClient }, { seedPayload, vocabulary }] = await Promise.all([
    loadDocumentClients(), loadMidSeed(),
  ]);

  const turnService = createTurnServiceHandler({
    createSessionBackend: (sessionKey) => createDynamoRowBackend({
      client: commandClient, tableName, sessionKey, ttlSeconds, softDelete: true,
    }),
    seedPayload,
    vocabulary,
    bands,
    queryTerm: bands.length ? termQueryOverDocumentClient({ client: convenienceClient, tableName }) : null,
    breaker: bands.length ? createDynamoCorpusBreaker({ client: commandClient, tableName }) : null,
    counters: createDynamoTurnCounters({ client: commandClient, tableName, turnRateLimit }),
    globalRowCapCounter: createDynamoGlobalRowCapCounter({ client: commandClient, tableName, tableRowCap }),
    invokeNewsWorker: createLambdaNewsWorkerInvoker({ functionName: process.env.NEWS_WORKER_FUNCTION_NAME }),
    log: () => {},
  });
  const result = await turnService.handle(requestFromLambdaEvent(event));
  return lambdaResponseFromResult(result);
};
