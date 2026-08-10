// local.mjs — the news worker's test double: `handler.mjs`'s engine-neutral
// core wired over a caller-supplied session backend (the row service's own
// reference-backend registry, so a triggered cycle and an HTTP read see the
// exact same rows) with fixture-injectable fetchers and research provider.
// `server/row-service/local.mjs` is the one caller — it builds one of these
// and wires it as the trigger routes' async-invoke seam, running the whole
// cycle in-process instead of invoking a real Lambda.
import { createNewsWorker, createInMemorySourceGate } from "./handler.mjs";

/** `getSessionBackend(sessionKey)` should be the SAME function the row
 *  service double uses for its own routes, so the worker reads and writes
 *  through the identical backend instance a test's HTTP calls observe.
 *  `fetchersFor(config)` and `getResearchProvider` are fixtures a test
 *  injects per source; both default to nothing so a poll/enrich cycle with
 *  no wiring simply finds nothing to fetch rather than reaching the network.
 *  `sourceGate` defaults to one in-memory gate shared across every call this
 *  double makes — the local analogue of the DynamoDB `_meta` throttle. */
export function createLocalNewsWorker({
  getSessionBackend,
  fetchersFor = () => new Map(),
  getResearchProvider = () => null,
  seedPayload = null,
  seedStamp = "",
  now,
  nowMs,
  budgetMs,
  sourceGate = createInMemorySourceGate(),
  log,
} = {}) {
  return createNewsWorker({
    createSessionBackend: getSessionBackend,
    createFetchers: (config) => fetchersFor(config),
    getResearchProvider,
    seedPayload,
    seedStamp,
    sourceGate,
    ...(now !== undefined ? { now } : {}),
    ...(nowMs !== undefined ? { nowMs } : {}),
    ...(budgetMs !== undefined ? { budgetMs } : {}),
    ...(log !== undefined ? { log } : {}),
  });
}
