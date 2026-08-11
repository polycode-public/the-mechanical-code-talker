// http-row-backend.mjs — the §3.1 row-backend contract over the row
// service's HTTP surface (server/row-service/handler.mjs's endpoint table).
// This is the client half of the seam the DynamoDB backend fills on the
// storage side. A page or a Node caller constructs one per session and gets
// the same contract every other backend gives. Only the network can fail.
//
// The module is fetch-only and imports nothing node-specific, so it runs
// unmodified in a browser bundle and in a node test. `fetchImpl` lets a test
// or an older runtime hand in its own implementation.

import {
  ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION,
  BackendRejected, BackendUnavailable,
} from "../../adapters/memory/row-backend.mjs";

const SESSION_HEADER = "x-tmct-session";
const PAYLOAD_HASH_HEADER = "x-amz-content-sha256";

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** Hex SHA-256 of `text`, via Web Crypto (available as `globalThis.crypto.subtle`
 *  in both browsers and node >= 20, so this needs no node-only import and
 *  stays safe to bundle for the page). Every body-carrying `/api/*` request
 *  needs this as `x-amz-content-sha256`: Lambda URLs behind OAC 403 at the
 *  URL auth layer, before the handler ever runs, if a body-carrying request
 *  arrives without it. */
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reads whatever text the response carries, for the error's own message
 *  only. The class decision uses the status code alone (the service's own
 *  §3.8 mapping), so a consumer never has to parse a body to know whether a
 *  failure is worth retrying. */
async function responseFailureMessage(response, fallback) {
  try {
    const text = await response.text();
    if (!text) return fallback;
    const parsed = JSON.parse(text);
    return parsed?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

async function throwForStatus(response, fallbackMessage) {
  const status = response.status;
  const message = await responseFailureMessage(response, fallbackMessage);
  if (status === 400 || status === 413) throw new BackendRejected(message, { status });
  // 429 (mutation rate), 507 (table cap), and any 5xx (503 is the handler's
  // own mapping for a backend-level BackendUnavailable; 500 is an
  // unexpected handler fault) all mean the store refused or failed to
  // serve. They share one retryable bucket, decided by status, never by
  // matching on message text.
  throw new BackendUnavailable(message, { status });
}

async function runFetch(fetchImpl, url, init, networkFailureMessage) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    throw new BackendUnavailable(networkFailureMessage, { cause: error });
  }
}

/** One retry, on a 5xx only, for the one call the spec singles out.
 *  `deleteAll`'s purge is query-then-mark and idempotent, so a retried
 *  DELETE just re-marks whatever the first attempt already reached; it
 *  never double-applies. Every other mutation gets one attempt only:
 *  retrying a PUT or a keyed DELETE past a 5xx is a caller decision, not
 *  this backend's. */
async function fetchWithOneRetryOn5xx(fetchImpl, url, init, networkFailureMessage) {
  const first = await runFetch(fetchImpl, url, init, networkFailureMessage);
  if (first.status < 500) return first;
  return runFetch(fetchImpl, url, init, networkFailureMessage);
}

/** `createHttpRowBackend({ apiBase, sessionKey, fetchImpl })`: a §3.1 row
 *  backend over the row service at `apiBase` (same-origin, no trailing
 *  slash needed), scoped to `sessionKey` (a v4 UUID the caller minted).
 *  `fetchImpl` defaults to the ambient `fetch`, so a page never has to pass
 *  one. A test points it at a running `local.mjs` double instead. */
export function createHttpRowBackend({ apiBase, sessionKey, fetchImpl = fetch } = {}) {
  if (typeof apiBase !== "string" || !apiBase) throw new TypeError("createHttpRowBackend needs an apiBase URL");
  if (typeof sessionKey !== "string" || !sessionKey) throw new TypeError("createHttpRowBackend needs a sessionKey");
  if (typeof fetchImpl !== "function") throw new TypeError("createHttpRowBackend needs a fetchImpl(url, init) function, or an ambient fetch");

  const base = trimTrailingSlash(apiBase);
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new BackendUnavailable("this row backend was closed and can no longer be used");
  };

  const jsonHeaders = { "content-type": "application/json" };
  const sessionReadHeaders = { [SESSION_HEADER]: sessionKey };

  async function getJson(path, { headers = {} } = {}) {
    const response = await runFetch(fetchImpl, `${base}${path}`, { headers }, "could not reach the row service");
    if (response.status === 404) return { notFound: true };
    if (!response.ok) await throwForStatus(response, `GET ${path} failed`);
    return { value: await response.json() };
  }

  async function mutate(path, { method, body }, { retryOn5xx = false } = {}) {
    const serializedBody = JSON.stringify(body);
    const init = {
      method,
      headers: { ...jsonHeaders, [PAYLOAD_HASH_HEADER]: await sha256Hex(serializedBody) },
      body: serializedBody,
    };
    const response = retryOn5xx
      ? await fetchWithOneRetryOn5xx(fetchImpl, `${base}${path}`, init, "could not reach the row service")
      : await runFetch(fetchImpl, `${base}${path}`, init, "could not reach the row service");
    if (!response.ok) await throwForStatus(response, `${method} ${path} failed`);
  }

  return {
    kind: ROW_BACKEND_KIND,
    contractVersion: ROW_BACKEND_CONTRACT_VERSION,

    async readRows() {
      assertOpen();
      const result = await getJson("/api/rows", { headers: sessionReadHeaders });
      return result.notFound ? [] : (result.value.rows || []);
    },

    async readRowsByTerm(term) {
      assertOpen();
      const result = await getJson(`/api/rows?term=${encodeURIComponent(term)}`, { headers: sessionReadHeaders });
      return result.notFound ? [] : (result.value.rows || []);
    },

    async putRows(rows) {
      assertOpen();
      await mutate(`/api/sessions/${sessionKey}/rows`, { method: "PUT", body: { puts: rows } });
    },

    async deleteRows(rowKeys) {
      assertOpen();
      await mutate(`/api/sessions/${sessionKey}/rows`, { method: "DELETE", body: { rowKeys } });
    },

    async deleteAll() {
      assertOpen();
      await mutate(`/api/sessions/${sessionKey}/rows`, { method: "DELETE", body: { all: true } }, { retryOn5xx: true });
    },

    async readMeta(key) {
      assertOpen();
      const result = await getJson(`/api/meta/${encodeURIComponent(key)}`, { headers: sessionReadHeaders });
      return result.notFound ? null : result.value.value;
    },

    async putMeta(key, value) {
      assertOpen();
      await mutate(`/api/sessions/${sessionKey}/meta/${encodeURIComponent(key)}`, { method: "PUT", body: { value } });
    },

    async close() {
      closed = true;
    },
  };
}

function retryOnceOnUnavailable(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (!(err instanceof BackendUnavailable)) throw err;
      return fn(...args);
    }
  };
}

/** Wraps a row backend so every method retries once on `BackendUnavailable`
 *  — a network-level failure, never `BackendRejected`, which a retry cannot
 *  fix. Every method here is safe to repeat: reads are read-only,
 *  `putRows`/`deleteRows` are upserts/keyed-deletes the service already
 *  documents as per-row atomic (a repeat just upserts or re-marks the same
 *  rows), and `deleteAll` already carries its own retry. The one race this
 *  covers: a consumer whose memory binds a large read-only seed as its base
 *  overlay (`wrapRowBackend`'s `basePayload`) does one CPU-heavy row
 *  projection the first time that session's memory is read — long enough,
 *  in a same-process test double, to occasionally land the very next
 *  network call on a socket the server had already begun tearing down.
 *  Real deployments (browser ↔ a separate Lambda-backed service) don't
 *  share an event loop with the store, so this is a same-process artifact,
 *  not a form of casual unreliability to paper over broadly — hence one
 *  retry, not a backoff loop. */
export function withOneRetryOnUnavailable(rowBackend) {
  const wrapped = {
    ...rowBackend,
    readRows: retryOnceOnUnavailable(rowBackend.readRows),
    putRows: retryOnceOnUnavailable(rowBackend.putRows),
    deleteRows: retryOnceOnUnavailable(rowBackend.deleteRows),
    readMeta: retryOnceOnUnavailable(rowBackend.readMeta),
    putMeta: retryOnceOnUnavailable(rowBackend.putMeta),
  };
  if (typeof rowBackend.readRowsByTerm === "function") wrapped.readRowsByTerm = retryOnceOnUnavailable(rowBackend.readRowsByTerm);
  return wrapped;
}
