// local.mjs — the row service's test double: `handler.mjs`'s core mounted
// on `node:http`, storing rows in the M2 in-memory reference backend
// instead of DynamoDB. Every later phase that needs a running row service
// (the HTTP client backend, the news worker, the page e2e specs) starts one
// of these rather than talking to AWS.
//
// The reference backend is scoped to one session by construction, so this
// module keeps a registry of them keyed by session key and hands the same
// instance back across calls — the in-memory analogue of one DynamoDB
// table shared by every session. The counters (the global row cap, the
// per-session mutation rate) live beside that registry for the same
// reason: neither is a per-session concern, so neither belongs inside any
// one session's backend.
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import {
  createRowServiceHandler, DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR, MUTATION_RATE_WINDOW_SECONDS,
  DEFAULT_CYCLE_RATE_LIMIT_PER_HOUR, CYCLE_RATE_WINDOW_SECONDS,
} from "./handler.mjs";
import { createLocalNewsWorker } from "../news-worker/local.mjs";
import { createInMemorySourceGate } from "../news-worker/handler.mjs";
import { loadBand } from "../../src/services/corpus-loader.mjs";
import { termQueryOverDocumentClient } from "../../src/services/subgraph-retrieval.mjs";

const DEFAULT_TABLE_ROW_CAP = 2_000_000;
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_CORPUS_TABLE_NAME = "local-row-service-corpus";

/** A convenience-shaped fake (`.query`) over an in-memory Map — the corpus
 *  band partition this double serves `GET /api/corpus/:band/rows` from.
 *  Understands exactly the pk-plus-`begins_with(sk, …)` Query
 *  `termQueryOverDocumentClient` sends, one page at a time, the same
 *  deliberate narrowness `server/turn-service/local.mjs`'s own fake uses. */
function createFakeCorpusConvenienceClient() {
  const store = new Map();
  const storeKey = (pk, sk) => `${pk}|${sk}`;
  return {
    store,
    async put({ Item }) {
      store.set(storeKey(Item.pk, Item.sk), { ...Item });
      return {};
    },
    async get({ Key }) {
      const item = store.get(storeKey(Key.pk, Key.sk));
      return { Item: item ? { ...item } : undefined };
    },
    async query({ KeyConditionExpression, ExpressionAttributeValues, Limit, ExclusiveStartKey }) {
      const pk = ExpressionAttributeValues[":pk"];
      let matches = [...store.values()].filter((item) => item.pk === pk);
      if (KeyConditionExpression.includes("begins_with")) {
        const prefix = ExpressionAttributeValues[":sk"];
        matches = matches.filter((item) => item.sk.startsWith(prefix));
      } else if (KeyConditionExpression !== "pk = :pk") {
        throw new Error(`local row service: unrecognized key condition "${KeyConditionExpression}"`);
      }
      matches.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
      const startIndex = ExclusiveStartKey ? matches.findIndex((item) => item.sk === ExclusiveStartKey.sk) + 1 : 0;
      const limit = Limit || matches.length;
      const page = matches.slice(startIndex, startIndex + limit);
      const more = startIndex + page.length < matches.length;
      const last = page.at(-1);
      return {
        Items: page.map((item) => ({ ...item })),
        LastEvaluatedKey: more && last ? { pk: last.pk, sk: last.sk } : undefined,
      };
    },
  };
}

/** Loads `rows` (wire rows, e.g. built with `bandFactRow`) into `band` on a
 *  fresh fake convenience client, through the real loader — this double's
 *  fixture band takes the exact write path a deployed loader run would. */
async function loadFixtureBand({ client, tableName, band, rows }) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-row-service-"));
  const path = join(dir, "band.jsonl");
  try {
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
    if (rows.length) await loadBand({ client, tableName, band, source: path });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createInMemoryCounters({
  tableRowCap,
  mutationRateLimit = DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR,
  mutationRateWindowSeconds = MUTATION_RATE_WINDOW_SECONDS,
  cycleRateLimit = DEFAULT_CYCLE_RATE_LIMIT_PER_HOUR,
  cycleRateWindowSeconds = CYCLE_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
}) {
  let globalRowCount = 0;
  const mutationWindows = new Map(); // sessionKey -> { count, resetAt }
  const cycleWindows = new Map(); // sessionKey -> { count, resetAt }
  const cycleLocks = new Map(); // sessionKey -> lockedAtMs

  function incrementWindow(windows, sessionKey, limit, windowSeconds) {
    const currentTime = now();
    let window = windows.get(sessionKey);
    if (!window || window.resetAt <= currentTime) {
      window = { count: 0, resetAt: currentTime + windowSeconds };
      windows.set(sessionKey, window);
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }

  return {
    async incrementGlobalRowCount(n) {
      if (globalRowCount + n > tableRowCap) return false;
      globalRowCount += n;
      return true;
    },
    async incrementMutationRate(sessionKey) {
      return incrementWindow(mutationWindows, sessionKey, mutationRateLimit, mutationRateWindowSeconds);
    },
    async incrementCycleRate(sessionKey) {
      return incrementWindow(cycleWindows, sessionKey, cycleRateLimit, cycleRateWindowSeconds);
    },
    // Synchronous under the hood — no await anywhere in this function body —
    // so two "concurrent" triggers for the same session can never interleave
    // between the check and the set, even though callers `await` the result.
    async acquireCycleLock(sessionKey, { nowMsVal, staleMs }) {
      const existing = cycleLocks.get(sessionKey);
      if (existing !== undefined && nowMsVal - existing < staleMs) return false;
      cycleLocks.set(sessionKey, nowMsVal);
      return true;
    },
    async releaseCycleLock(sessionKey) {
      cycleLocks.delete(sessionKey);
    },
    // Not part of the counters seam handler.mjs calls — reconcile drives
    // this directly, the same way the AWS reconcile mode rewrites its item.
    setGlobalRowCount(n) { globalRowCount = n; },
    readGlobalRowCount() { return globalRowCount; },
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Starts the row service's test double on an ephemeral port.
 *
 *  `tableRowCap`/`ttlDays`/`mutationRateLimit` mirror the deployment
 *  parameters (`TABLE_ROW_CAP`, `TTL_DAYS`) so a test can fill a tiny cap
 *  or shrink the rate window rather than waiting out the real defaults.
 *  `now` is a clock hook threading through to both the row TTL stamp and
 *  the mutation-rate window, for deterministic tests.
 *
 *  `newsWorker` (all optional) wires the poll/enrich/ingest trigger routes'
 *  worker: `fetchersFor(config)`, `getResearchProvider`, `seedPayload`,
 *  `seedStamp`, `nowMs`, `budgetMs` pass straight through to
 *  `createLocalNewsWorker` — a test supplies fixture fetchers per source the
 *  same way `news-fixture:` replay does in-page. Every trigger runs the
 *  worker in-process without the route awaiting it, so a test that needs the
 *  cycle finished before asserting calls `drainNewsWorkers()`.
 *
 *  `fixtureBand` (optional, `{name, rows}`) loads a small corpus band of
 *  wire rows through the real loader, into a corpus-shaped fake convenience
 *  client separate from the session store — the same fixture-loading
 *  pattern `server/turn-service/local.mjs` uses — so a test can exercise
 *  `GET /api/corpus/:band/rows` against real band content. `corpusBands`
 *  overrides the configured band allow-list directly; omitted, it defaults
 *  to `[fixtureBand.name]` when a fixture is given, else `[]` (every band
 *  404s, the shape a deployment with no corpus table wiring needs). */
export async function createLocalRowService({
  tableRowCap = DEFAULT_TABLE_ROW_CAP,
  ttlDays = DEFAULT_TTL_DAYS,
  mutationRateLimit = DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR,
  mutationRateWindowSeconds = MUTATION_RATE_WINDOW_SECONDS,
  cycleRateLimit = DEFAULT_CYCLE_RATE_LIMIT_PER_HOUR,
  cycleRateWindowSeconds = CYCLE_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
  newsWorker: newsWorkerOptions = {},
  fixtureBand = null,
  corpusBands = fixtureBand ? [fixtureBand.name] : [],
  corpusTableName = DEFAULT_CORPUS_TABLE_NAME,
  log = () => {},
} = {}) {
  const sessionBackends = new Map();
  const getSessionBackend = (sessionKey) => {
    let backend = sessionBackends.get(sessionKey);
    if (!backend) {
      backend = createRowMemoryBackend({ clock: now });
      sessionBackends.set(sessionKey, backend);
    }
    return backend;
  };

  const counters = createInMemoryCounters({ tableRowCap, mutationRateLimit, mutationRateWindowSeconds, cycleRateLimit, cycleRateWindowSeconds, now });
  const ttlSeconds = ttlDays == null ? null : ttlDays * 86400;

  const corpusClient = createFakeCorpusConvenienceClient();
  if (fixtureBand) {
    await loadFixtureBand({ client: corpusClient, tableName: corpusTableName, band: fixtureBand.name, rows: fixtureBand.rows });
  }
  const queryCorpusTerm = corpusBands.length
    ? termQueryOverDocumentClient({ client: corpusClient, tableName: corpusTableName })
    : null;

  const sourceGate = newsWorkerOptions.sourceGate ?? createInMemorySourceGate();
  const newsWorker = createLocalNewsWorker({
    getSessionBackend,
    fetchersFor: newsWorkerOptions.fetchersFor,
    getResearchProvider: newsWorkerOptions.getResearchProvider,
    seedPayload: newsWorkerOptions.seedPayload,
    seedStamp: newsWorkerOptions.seedStamp,
    now: newsWorkerOptions.now,
    nowMs: newsWorkerOptions.nowMs,
    budgetMs: newsWorkerOptions.budgetMs,
    sourceGate,
    log: newsWorkerOptions.log,
  });

  const pendingNewsWorkerCycles = [];
  async function invokeNewsWorker(sessionKey, { mode, cycleId, body }) {
    const promise = newsWorker.runCycle({ sessionKey, cycleId, mode, body });
    pendingNewsWorkerCycles.push(promise);
    return promise;
  }
  /** Awaits every cycle the trigger routes have fired so far — the local
   *  double's stand-in for "poll the marker until it says done", since the
   *  worker here runs in-process and a real test should not sleep-poll for
   *  something it can simply await. */
  async function drainNewsWorkers() {
    const pending = pendingNewsWorkerCycles.splice(0, pendingNewsWorkerCycles.length);
    await Promise.allSettled(pending);
  }

  const rowService = createRowServiceHandler({
    createSessionBackend: getSessionBackend,
    counters,
    invokeNewsWorker,
    ttlSeconds,
    corpusBands,
    queryCorpusTerm,
    now,
    log,
  });

  const server = createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, "http://localhost");
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    const query = Object.fromEntries(parsedUrl.searchParams);
    const body = await readRequestBody(req);

    const result = await rowService.handle({ method: req.method, path: parsedUrl.pathname, headers, query, body });
    res.writeHead(result.status, result.headers);
    res.end(result.body || "");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  /** The daily EventBridge reconcile, in-process: a physical recount over
   *  every session this double has ever seen, live rows only (a deleted row
   *  in the reference backend has already left the map — this double's
   *  physical-delete analogue of TTL having reaped a tombstone), then the
   *  counter is rewritten from that number. */
  async function reconcile() {
    let total = 0;
    for (const backend of sessionBackends.values()) total += (await backend.readRows()).length;
    counters.setGlobalRowCount(total);
    return total;
  }

  async function close() {
    for (const backend of sessionBackends.values()) await backend.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return { url, close, reconcile, readGlobalRowCount: counters.readGlobalRowCount, drainNewsWorkers, corpusClient };
}
