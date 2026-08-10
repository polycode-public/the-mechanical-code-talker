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

import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import { createRowServiceHandler, DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR, MUTATION_RATE_WINDOW_SECONDS } from "./handler.mjs";

const DEFAULT_TABLE_ROW_CAP = 2_000_000;
const DEFAULT_TTL_DAYS = 7;

function createInMemoryCounters({
  tableRowCap,
  mutationRateLimit = DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR,
  mutationRateWindowSeconds = MUTATION_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
}) {
  let globalRowCount = 0;
  const mutationWindows = new Map(); // sessionKey -> { count, resetAt }

  return {
    async incrementGlobalRowCount(n) {
      if (globalRowCount + n > tableRowCap) return false;
      globalRowCount += n;
      return true;
    },
    async incrementMutationRate(sessionKey) {
      const currentTime = now();
      let window = mutationWindows.get(sessionKey);
      if (!window || window.resetAt <= currentTime) {
        window = { count: 0, resetAt: currentTime + mutationRateWindowSeconds };
        mutationWindows.set(sessionKey, window);
      }
      if (window.count >= mutationRateLimit) return false;
      window.count += 1;
      return true;
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
 *  the mutation-rate window, for deterministic tests. */
export async function createLocalRowService({
  tableRowCap = DEFAULT_TABLE_ROW_CAP,
  ttlDays = DEFAULT_TTL_DAYS,
  mutationRateLimit = DEFAULT_MUTATION_RATE_LIMIT_PER_HOUR,
  mutationRateWindowSeconds = MUTATION_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
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

  const counters = createInMemoryCounters({ tableRowCap, mutationRateLimit, mutationRateWindowSeconds, now });
  const ttlSeconds = ttlDays == null ? null : ttlDays * 86400;

  const rowService = createRowServiceHandler({
    createSessionBackend: getSessionBackend,
    counters,
    ttlSeconds,
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

  return { url, close, reconcile, readGlobalRowCount: counters.readGlobalRowCount };
}
