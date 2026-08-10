// subgraph-retrieval.mjs — runs a retrieval plan against corpus band
// partitions and hands back the rows a turn can reason over, plus the metrics
// that say how complete the answer is.
//
// The whole point is that a smaller budget returns a prefix of a bigger one's
// answer rather than a different answer. That holds because the traversal order
// is fixed before the first read: terms sorted, bands sorted, each page sorted
// by row key, and every response folded in the order it was issued rather than
// the order it came back. Concurrency changes the wall time and nothing else.
//
// Running out of budget degrades. It never throws: the caller gets the rows
// that arrived, `bounded: true`, and the name of the budget that stopped it. A
// timeout is a smaller subgraph, never a guess.

import {
  buildRetrievalPlan, expandedTerms, ancestryTerms,
} from "../domain/retrieval-plan.mjs";
import { loadLexicon } from "../domain/grammar/lexicon.mjs";
import { BACKEND_UNAVAILABLE_CODE } from "../adapters/memory/row-backend.mjs";

/** The retrieval budgets, set from what scripts/corpus-bands/calibrate-retrieval.mjs
 *  measured over the committed WordNet and ConceptNet corpora. Changing one is
 *  a code change, deliberately: a request cannot widen its own read.
 *
 *  Each budget degrades rather than failing. `fuzzyVariantsPerTerm` and
 *  `hopDepth` cut the plan before any read; `rowsPerQueryPage` paginates;
 *  `totalRows`, `totalQueries` and `wallTimeMs` stop the traversal and mark the
 *  subgraph bounded; `inFlightQueries` only queues.
 *
 *  What each number came from:
 *
 *    fuzzyVariantsPerTerm  the widest measured tie was five candidates at the
 *                          same distance; below that the cap cuts alphabetically
 *                          and drops real candidates, so six clears every case
 *    hopDepth              the engine's own alias chase is two hops
 *    rowsPerQueryPage      the heaviest single term returned 92 rows, so 200
 *                          reads every measured term in one round trip
 *    totalRows             folding 1,000 rows into a payload costs about 12 ms
 *                          and about 1 MB; 5,000 costs 44 ms and 5.3 MB, which
 *                          is a third of the whole bundled seed for one question
 *    totalQueries          eight rounds of eight in flight, about 80 ms against
 *                          a store answering in the 10 ms class. A wide turn
 *                          spends 20-30 of these on its own terms across three
 *                          bands, and the rest goes to the subClassOf chain
 *    wallTimeMs            the latency the turn surface can spend on reads
 *    inFlightQueries       eight, so a turn cannot monopolize table throughput
 *    queryRetries          two retries at 25 ms doubling spends at most 75 ms of
 *    backoffBaseMs         the 300 ms on waiting, leaving 225 ms of reading
 *
 *  The measurement's headline is worth knowing when reading a turn's metrics: a
 *  grounded question over a corpus this dense wants thousands of Queries if
 *  nothing stops it, because the subClassOf closure branches rather than
 *  chaining. Every grounded turn comes back bounded, and the marker says so.
 *  Reads are ordered so what a budget takes is always the least targeted part. */
export const RETRIEVAL_BUDGETS = Object.freeze({
  fuzzyVariantsPerTerm: 6,
  hopDepth: 2,
  rowsPerQueryPage: 200,
  totalRows: 1000,
  totalQueries: 64,
  wallTimeMs: 300,
  inFlightQueries: 8,
  queryRetries: 2,
  backoffBaseMs: 25,
});

/** Retrieval ran and the answer stands on the corpus supplement as well as the
 *  seed and the session. */
export const SUPPLEMENTED_MODE = "supplemented";

/** No corpus read happened — no bands configured, or the breaker is open. The
 *  answer stands on the bundled seed and the session alone. */
export const SEED_SESSION_MODE = "seed-session";

const THROTTLE_ERROR_NAMES = new Set([
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "ThrottlingException",
  "TooManyRequestsException",
  "InternalServerError",
  "ServiceUnavailable",
  "TimeoutError",
  "AbortError",
]);

/** Does this failure mean the store itself is in trouble? Only these count
 *  toward a breaker: throttles, 5xx and timeouts. An empty result is an answer,
 *  and a rejected input is a bug in the caller, so neither is systemic. */
export function isSystemicFailure(error) {
  if (!error) return false;
  if (error.code === BACKEND_UNAVAILABLE_CODE) return true;
  if (error.retryable === true || error.$retryable?.throttling === true) return true;
  if (THROTTLE_ERROR_NAMES.has(error.name)) return true;
  const status = error.status ?? error.$metadata?.httpStatusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/** Is fuzzy variant expansion on for this turn? Most specific setting wins:
 *  the request, then the environment, then the config file, then the default,
 *  which is on. */
export function resolveFuzzyMode({ request, env = process.env, config } = {}) {
  if (typeof request === "boolean") return request;
  const fromEnv = env?.TMCT_RETRIEVAL_FUZZY;
  if (fromEnv === "0" || fromEnv === "false") return false;
  if (fromEnv === "1" || fromEnv === "true") return true;
  if (typeof config === "boolean") return config;
  return true;
}

const sleepFor = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** A term query over a DynamoDB document client, in the band partition layout:
 *  partition `corpus:<band>`, sort key `fact#<term>#<rowKey>`, so one term is
 *  one `begins_with` Query. Pass the result as `queryTerm`. */
export function termQueryOverDocumentClient({ client, tableName, pageSize }) {
  return async function queryTerm({ band, term, exclusiveStartKey, limit }) {
    const response = await client.query({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `corpus:${band}`, ":sk": `fact#${term}#` },
      Limit: limit ?? pageSize,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    });
    return { rows: response?.Items || [], lastEvaluatedKey: response?.LastEvaluatedKey ?? null };
  };
}

const byRowKey = (a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0);

/** One Query, with exponential backoff on a systemic failure and no retry on
 *  anything else. Backoff happens inside the wall budget: when the next sleep
 *  would spend more time than retrieval has left, the read is given up instead
 *  of waited on. */
async function queryWithBackoff(request, run) {
  let delay = run.budgets.backoffBaseMs;
  for (let attempt = 0; ; attempt += 1) {
    run.queries += 1;
    try {
      const response = await run.queryTerm(request);
      return { rows: [...(response?.rows || [])].sort(byRowKey), lastEvaluatedKey: response?.lastEvaluatedKey ?? null };
    } catch (error) {
      run.failedQueries += 1;
      if (!isSystemicFailure(error)) return { rows: [], lastEvaluatedKey: null, failed: true };
      run.systemicFailures += 1;
      const spent = run.now() - run.startedAt;
      if (attempt >= run.budgets.queryRetries || spent + delay >= run.budgets.wallTimeMs) {
        return { rows: [], lastEvaluatedKey: null, failed: true };
      }
      run.throttles += 1;
      await run.sleep(delay);
      delay *= 2;
    }
  }
}

/** The budget that has already stopped this run, or null while it can carry
 *  on. Checked between chunks, so a chunk already in flight finishes and its
 *  rows are folded in issue order. */
function trippedBudget(run) {
  if (run.rows.length >= run.budgets.totalRows) return "totalRows";
  if (run.queries >= run.budgets.totalQueries) return "totalQueries";
  if (run.now() - run.startedAt >= run.budgets.wallTimeMs) return "wallTimeMs";
  return null;
}

/** Fold one response into the run. Rows land in issue order, deduped by key,
 *  and the row budget cuts inside the page rather than after it, so the same
 *  inputs under a smaller budget stop at exactly the same row. */
function foldResponse(response, run) {
  const fresh = [];
  for (const row of response.rows) {
    if (!row?.rowKey || run.seenRowKeys.has(row.rowKey)) continue;
    if (run.rows.length >= run.budgets.totalRows) {
      run.tripped = run.tripped ?? "totalRows";
      break;
    }
    run.seenRowKeys.add(row.rowKey);
    run.rows.push(row);
    fresh.push(row);
  }
  if (response.failed) run.degraded = true;
  return fresh;
}

/** Run one wave of term reads to exhaustion or to a budget, and return the rows
 *  it brought back. Pagination re-queues the same term behind the rest of the
 *  wave, which keeps the issue order a pure function of the plan. */
async function runWave(requests, run) {
  const fresh = [];
  let pending = requests;
  while (pending.length) {
    const stoppedBy = trippedBudget(run);
    if (stoppedBy) { run.tripped = run.tripped ?? stoppedBy; break; }
    const chunk = pending.slice(0, run.budgets.inFlightQueries);
    const rest = pending.slice(run.budgets.inFlightQueries);
    for (const request of chunk) run.readTerms.add(request.term);
    const responses = await Promise.all(chunk.map((request) => queryWithBackoff(request, run)));
    const continuations = [];
    for (let i = 0; i < chunk.length; i += 1) {
      fresh.push(...foldResponse(responses[i], run));
      if (responses[i].lastEvaluatedKey) {
        continuations.push({ ...chunk[i], exclusiveStartKey: responses[i].lastEvaluatedKey });
      }
    }
    pending = [...rest, ...continuations];
  }
  return fresh;
}

/** Every (band, term) read one wave issues, in a fixed order: term first so a
 *  cut lands on whole terms wherever possible, band second. */
function requestsFor(terms, run) {
  const requests = [];
  for (const term of terms) {
    if (run.plannedTerms.has(term)) continue;
    run.plannedTerms.add(term);
    for (const band of run.bands) requests.push({ band, term, limit: run.budgets.rowsPerQueryPage });
  }
  return requests;
}

/** Read a wave and record what phase paid for it, so a run can say where its
 *  Queries went. */
async function runPhase(terms, run, phase) {
  const queriesBefore = run.queries;
  const rowsBefore = run.rows.length;
  const fresh = await runWave(requestsFor(terms, run), run);
  run.queriesByPhase[phase] += run.queries - queriesBefore;
  run.rowsByPhase[phase] += run.rows.length - rowsBefore;
  return fresh;
}

/** Walk the subClassOf chain above `rows` until it closes. This runs before
 *  each wider hop because the inheritance lanes read exactly these rows, so a
 *  budget that stops the traversal takes the widest reads and not the ones an
 *  answer is most likely to stand on. A term is asked for once per turn, so a
 *  cycle in the taxonomy cannot loop here. */
async function chaseAncestry(rows, run) {
  const found = [];
  let terms = ancestryTerms(rows, { seen: run.plannedTerms });
  while (terms.length && !run.tripped) {
    const fresh = await runPhase(terms, run, "ancestry");
    found.push(...fresh);
    terms = ancestryTerms(fresh, { seen: run.plannedTerms });
  }
  return found;
}

/** Retrieve the corpus subgraph one turn can reach.
 *
 *  `queryTerm({band, term, exclusiveStartKey, limit})` resolves to
 *  `{rows, lastEvaluatedKey}` — the injected read seam, so the caller decides
 *  whether that is a document client, an HTTP route or a fixture.
 *
 *  Returns `{rows, metrics, plan}`. `metrics.mode` and `metrics.bounded` are
 *  what an answer's honesty marker reads: `bounded` is true when a budget
 *  stopped the traversal or a read failed, which are the two ways the subgraph
 *  can hold less than the corpus does. */
export async function retrieveSubgraph({
  text,
  bands = [],
  queryTerm = null,
  fuzzy = true,
  skip = false,
  lexicon = loadLexicon(),
  vocabulary = null,
  budgets: budgetOverrides = null,
  now = () => Date.now(),
  sleep = sleepFor,
}) {
  // A partial override keeps every budget it did not name. A missing cap would
  // otherwise read as no cap, which is the one thing this module must never do.
  const budgets = budgetOverrides ? { ...RETRIEVAL_BUDGETS, ...budgetOverrides } : RETRIEVAL_BUDGETS;
  const startedAt = now();
  const plan = buildRetrievalPlan({
    text, fuzzy, lexicon, vocabulary,
    hopDepth: budgets.hopDepth,
    fuzzyVariantsPerTerm: budgets.fuzzyVariantsPerTerm,
  });
  const sortedBands = [...bands].sort();

  if (skip || !queryTerm || sortedBands.length === 0) {
    return {
      rows: [],
      plan,
      metrics: metricsOf({
        plan, bands: sortedBands, mode: SEED_SESSION_MODE, elapsedMs: now() - startedAt,
      }),
    };
  }

  const run = {
    budgets, queryTerm, now, sleep, startedAt,
    bands: sortedBands,
    rows: [],
    seenRowKeys: new Set(),
    plannedTerms: new Set(), readTerms: new Set(),
    queries: 0,
    failedQueries: 0,
    systemicFailures: 0,
    throttles: 0,
    tripped: null,
    degraded: false,
    hops: 0,
    queriesByPhase: { seed: 0, ancestry: 0, expansion: 0 },
    rowsByPhase: { seed: 0, ancestry: 0, expansion: 0 },
  };

  // The words the turn actually contained are read before any variant of them.
  // Under a tight query budget that ordering is the difference between a guess
  // spending the read the real term needed and the real term getting it.
  let wave = [
    ...plan.terms.filter((entry) => entry.origin === "exact").map((entry) => entry.term),
    ...plan.terms.filter((entry) => entry.origin === "fuzzy").map((entry) => entry.term),
  ];
  for (let hop = 0; hop <= budgets.hopDepth && wave.length; hop += 1) {
    const fresh = await runPhase(wave, run, hop === 0 ? "seed" : "expansion");
    run.hops = hop;
    const inherited = await chaseAncestry(fresh, run);
    if (run.tripped) break;
    wave = expandedTerms([...fresh, ...inherited], { seen: run.plannedTerms });
  }

  return {
    rows: run.rows,
    plan,
    metrics: metricsOf({
      plan,
      bands: sortedBands,
      mode: SUPPLEMENTED_MODE,
      elapsedMs: now() - startedAt,
      run,
    }),
  };
}

function metricsOf({ plan, bands, mode, elapsedMs, run = null }) {
  const exactTerms = plan.terms.filter((entry) => entry.origin === "exact").length;
  return {
    mode,
    bounded: Boolean(run && (run.tripped || run.degraded)),
    tripped: run?.tripped ?? null,
    fuzzy: plan.fuzzy,
    bands,
    planTerms: plan.terms.length,
    exactTerms,
    fuzzyTerms: plan.terms.length - exactTerms,
    termsPlanned: run ? run.plannedTerms.size : 0,
    termsRead: run ? run.readTerms.size : 0,
    queries: run?.queries ?? 0,
    rows: run?.rows.length ?? 0,
    hops: run?.hops ?? 0,
    failedQueries: run?.failedQueries ?? 0,
    systemicFailures: run?.systemicFailures ?? 0,
    throttles: run?.throttles ?? 0,
    queriesByPhase: run ? { ...run.queriesByPhase } : { seed: 0, ancestry: 0, expansion: 0 },
    rowsByPhase: run ? { ...run.rowsByPhase } : { seed: 0, ancestry: 0, expansion: 0 },
    elapsedMs,
  };
}
