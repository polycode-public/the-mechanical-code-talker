import test from "node:test";
import assert from "node:assert/strict";
import {
  retrieveSubgraph, resolveFuzzyMode, isSystemicFailure, termQueryOverDocumentClient,
  RETRIEVAL_BUDGETS, SUPPLEMENTED_MODE, SEED_SESSION_MODE,
} from "../../src/services/subgraph-retrieval.mjs";
import { ANCESTRY_PREDICATE } from "../../src/domain/retrieval-plan.mjs";
import { bandRow, createFakeDocumentClient } from "../../scripts/corpus-bands/calibrate-retrieval.mjs";
import { BackendUnavailable, BackendRejected } from "../../src/adapters/memory/row-backend.mjs";

const BAND = "wordnet-complete";

const TRIPLES = [
  { subject: "dolphin", predicate: ANCESTRY_PREDICATE, object: "mammal" },
  { subject: "dolphin", predicate: "mgx:capableOf", object: "swim" },
  { subject: "dolphin", predicate: "mgx:hasA", object: "fin" },
  { subject: "mammal", predicate: ANCESTRY_PREDICATE, object: "animal" },
  { subject: "animal", predicate: ANCESTRY_PREDICATE, object: "organism" },
  { subject: "swim", predicate: "mgx:relatedTo", object: "water" },
  { subject: "fin", predicate: "mgx:partOf", object: "body" },
];

/** A band partition over the triples, optionally shuffled, so a test can prove
 *  the answer does not depend on the order the store hands rows back. */
function bandStore({ rotateBy = 0 } = {}) {
  const rows = TRIPLES.map((triple, ord) => bandRow({ ...triple, band: BAND, ord }));
  const ordered = [...rows.slice(rotateBy), ...rows.slice(0, rotateBy)];
  return new Map([[`corpus:${BAND}`, ordered.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0))]]);
}

/** The same partition with the sort-key index deliberately left unsorted, so a
 *  backend handing rows back in insertion order is exercised too. */
function unsortedBandStore(rotateBy) {
  const rows = TRIPLES.map((triple, ord) => bandRow({ ...triple, band: BAND, ord }));
  return new Map([[`corpus:${BAND}`, [...rows.slice(rotateBy), ...rows.slice(0, rotateBy)]]]);
}

const budgetsWith = (overrides) => ({ ...RETRIEVAL_BUDGETS, ...overrides });

function queryTermOver(partitions, { pageSize = 200, sorted = true } = {}) {
  const client = createFakeDocumentClient(partitions, { sorted });
  return termQueryOverDocumentClient({ client, tableName: "test", pageSize });
}

async function retrieve({ text = "what is a dolphin", partitions = bandStore(), sorted = true, ...rest } = {}) {
  return retrieveSubgraph({
    text,
    bands: [BAND],
    queryTerm: queryTermOver(partitions, { sorted }),
    fuzzy: false,
    ...rest,
  });
}

const rowKeys = (result) => result.rows.map((row) => row.rowKey);

test("the same store answers the same subgraph twice", async () => {
  const first = await retrieve();
  const second = await retrieve();
  assert.deepEqual(rowKeys(first), rowKeys(second));
  assert.ok(first.rows.length > 0, "the fixture should ground this turn");
});

test("a store handing its rows back in a different order answers the same subgraph", async () => {
  const answers = [];
  for (const rotation of [0, 2, 5]) {
    answers.push(rowKeys(await retrieve({ partitions: unsortedBandStore(rotation), sorted: false })));
  }
  assert.ok(answers[0].length > 1, "the fixture should return several rows for this to mean anything");
  assert.deepEqual(answers[1], answers[0]);
  assert.deepEqual(answers[2], answers[0]);
  assert.deepEqual(answers[0], rowKeys(await retrieve()));
});

test("each fuzzy mode is stable on its own, and the two ask different questions", async () => {
  const vocabulary = ["dolphin", "dolman"];
  const on = async () => retrieve({ text: "what is a dolfin", fuzzy: true, vocabulary });
  const off = async () => retrieve({ text: "what is a dolfin", fuzzy: false, vocabulary });
  assert.deepEqual(rowKeys(await on()), rowKeys(await on()));
  assert.deepEqual(rowKeys(await off()), rowKeys(await off()));
  assert.ok((await on()).rows.length > (await off()).rows.length, "the variant should reach rows the exact term cannot");
  assert.equal((await off()).rows.length, 0);
});

test("a smaller row budget returns a prefix of the bigger budget's answer", async () => {
  const full = await retrieve();
  const cut = await retrieve({ budgets: budgetsWith({ totalRows: 3 }) });
  assert.deepEqual(rowKeys(cut), rowKeys(full).slice(0, 3));
  assert.equal(cut.metrics.tripped, "totalRows");
  assert.equal(cut.metrics.bounded, true);
});

test("the row budget cuts inside a page, not after it", async () => {
  const cut = await retrieve({ budgets: budgetsWith({ totalRows: 2, rowsPerQueryPage: 200 }) });
  assert.equal(cut.rows.length, 2);
});

test("the query budget stops the traversal and says so", async () => {
  const cut = await retrieve({ budgets: budgetsWith({ totalQueries: 1 }) });
  assert.equal(cut.metrics.tripped, "totalQueries");
  assert.equal(cut.metrics.bounded, true);
  assert.ok(cut.metrics.queries <= RETRIEVAL_BUDGETS.inFlightQueries);
});

test("the wall budget stops the traversal without waiting for a real clock", async () => {
  let clock = 0;
  const cut = await retrieve({
    budgets: budgetsWith({ wallTimeMs: 5 }),
    now: () => { clock += 4; return clock; },
  });
  assert.equal(cut.metrics.tripped, "wallTimeMs");
  assert.equal(cut.metrics.bounded, true);
});

test("a hop depth of zero asks only for the turn's own terms", async () => {
  const shallow = await retrieve({ budgets: budgetsWith({ hopDepth: 0 }) });
  const deep = await retrieve({ budgets: budgetsWith({ hopDepth: 2 }) });
  assert.equal(shallow.metrics.rowsByPhase.expansion, 0);
  assert.ok(deep.metrics.rowsByPhase.expansion > 0, "two hops should reach past the seed terms");
  assert.ok(shallow.rows.length < deep.rows.length);
});

test("pagination brings back the same rows as one big page", async () => {
  const paged = await retrieve({ partitions: bandStore(), budgets: budgetsWith({ rowsPerQueryPage: 1 }) });
  const whole = await retrieve({ budgets: budgetsWith({ rowsPerQueryPage: 200 }) });
  assert.deepEqual(rowKeys(paged).sort(), rowKeys(whole).sort());
  assert.ok(paged.metrics.queries > whole.metrics.queries, "a one-row page costs more Queries");
});

test("the turn's own words are read before any variant of them", async () => {
  const asked = [];
  const inner = queryTermOver(bandStore());
  const queryTerm = async (request) => { asked.push(request.term); return inner(request); };
  await retrieveSubgraph({
    text: "what is a dolfin", bands: [BAND], queryTerm, fuzzy: true,
    vocabulary: ["dolphin", "coffin"],
    budgets: budgetsWith({ hopDepth: 0 }),
  });
  assert.equal(asked[0], "dolfin");
});

test("the variant cap trims the plan before any read happens", async () => {
  const vocabulary = ["dolphin", "dolman", "dolmen"];
  const wide = await retrieve({ text: "what is a dolfin", fuzzy: true, vocabulary, budgets: budgetsWith({ fuzzyVariantsPerTerm: 3 }) });
  const narrow = await retrieve({ text: "what is a dolfin", fuzzy: true, vocabulary, budgets: budgetsWith({ fuzzyVariantsPerTerm: 1 }) });
  assert.equal(wide.metrics.fuzzyTerms, 3);
  assert.equal(narrow.metrics.fuzzyTerms, 1);
});

test("no more Queries run at once than the in-flight budget allows", async () => {
  let live = 0;
  let peak = 0;
  const inner = queryTermOver(bandStore());
  const queryTerm = async (request) => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((resolve) => { setTimeout(resolve, 1); });
    const answer = await inner(request);
    live -= 1;
    return answer;
  };
  await retrieveSubgraph({ text: "what is a dolphin", bands: [BAND], queryTerm, fuzzy: false, budgets: budgetsWith({ inFlightQueries: 2 }) });
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
  assert.ok(peak > 1, "the reads should actually overlap");
});

test("the ancestry chain is walked to the top, past the hop depth", async () => {
  const result = await retrieve({ budgets: budgetsWith({ hopDepth: 0 }) });
  const objects = result.rows.map((row) => JSON.parse(row.json).individual.attributes.find((a) => a.prop === "rdf:object").value);
  assert.ok(objects.includes("organism"), `the three-level chain should close: ${objects.join(", ")}`);
  assert.ok(result.metrics.rowsByPhase.ancestry > 0);
});

test("a throttled read backs off and succeeds inside the wall budget", async () => {
  const inner = queryTermOver(bandStore());
  let thrown = 0;
  const queryTerm = async (request) => {
    if (thrown === 0) { thrown += 1; throw new BackendUnavailable("throttled", { status: 429 }); }
    return inner(request);
  };
  const slept = [];
  const result = await retrieveSubgraph({
    text: "what is a dolphin", bands: [BAND], queryTerm, fuzzy: false,
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.deepEqual(slept, [RETRIEVAL_BUDGETS.backoffBaseMs]);
  assert.equal(result.metrics.throttles, 1);
  assert.equal(result.metrics.bounded, false);
  assert.ok(result.rows.length > 0);
});

test("a read that never recovers degrades to a smaller subgraph rather than an error", async () => {
  const result = await retrieveSubgraph({
    text: "what is a dolphin",
    bands: [BAND],
    queryTerm: async () => { throw new BackendUnavailable("still throttled", { status: 503 }); },
    fuzzy: false,
    sleep: async () => {},
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.metrics.mode, SUPPLEMENTED_MODE);
  assert.equal(result.metrics.bounded, true);
  assert.ok(result.metrics.systemicFailures > 0);
});

test("backoff never spends more time than retrieval has left", async () => {
  let clock = 0;
  const result = await retrieveSubgraph({
    text: "what is a dolphin",
    bands: [BAND],
    queryTerm: async () => { throw new BackendUnavailable("throttled", { status: 429 }); },
    fuzzy: false,
    budgets: budgetsWith({ wallTimeMs: 10, backoffBaseMs: 25 }),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  assert.equal(clock, 0, "a sleep longer than the budget's remainder must not happen at all");
  assert.equal(result.metrics.throttles, 0);
  assert.equal(result.metrics.bounded, true);
});

test("a refused input is not retried, because retrying gets the same answer", async () => {
  let calls = 0;
  const result = await retrieveSubgraph({
    text: "what is a dolphin",
    bands: [BAND],
    queryTerm: async () => { calls += 1; throw new BackendRejected("bad key"); },
    fuzzy: false,
    sleep: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.metrics.systemicFailures, 0);
  assert.equal(result.metrics.failedQueries, 1);
  assert.equal(result.metrics.bounded, true);
});

test("an empty band is an answer, not a failure", async () => {
  const result = await retrieve({ partitions: new Map([[`corpus:${BAND}`, []]]) });
  assert.deepEqual(result.rows, []);
  assert.equal(result.metrics.mode, SUPPLEMENTED_MODE);
  assert.equal(result.metrics.bounded, false);
  assert.equal(result.metrics.tripped, null);
});

test("skipping the corpus answers from the seed and the session alone", async () => {
  let calls = 0;
  const result = await retrieveSubgraph({
    text: "what is a dolphin", bands: [BAND], skip: true, fuzzy: false,
    queryTerm: async () => { calls += 1; return { rows: [] }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.metrics.mode, SEED_SESSION_MODE);
  assert.equal(result.metrics.bounded, false);
  assert.ok(result.plan.terms.length > 0, "the plan is still built, so narration can say what was not asked");
});

test("no configured band is the same honest mode as a skipped one", async () => {
  const result = await retrieveSubgraph({ text: "what is a dolphin", bands: [], queryTerm: queryTermOver(bandStore()), fuzzy: false });
  assert.equal(result.metrics.mode, SEED_SESSION_MODE);
});

test("the metrics say how the subgraph was built and how complete it is", async () => {
  const result = await retrieve();
  assert.deepEqual(Object.keys(result.metrics).sort(), [
    "bands", "bounded", "elapsedMs", "exactTerms", "failedQueries", "fuzzy", "fuzzyTerms",
    "hops", "mode", "planTerms", "queries", "queriesByPhase", "rows", "rowsByPhase",
    "systemicFailures", "termsPlanned", "termsRead", "throttles", "tripped",
  ]);
  assert.ok(result.metrics.termsRead <= result.metrics.termsPlanned, "a term the budget stopped is planned, not read");
  assert.equal(result.metrics.rows, result.rows.length);
  assert.equal(result.metrics.mode, SUPPLEMENTED_MODE);
  assert.deepEqual(result.metrics.bands, [BAND]);
  assert.equal(
    result.metrics.queries,
    result.metrics.queriesByPhase.seed + result.metrics.queriesByPhase.ancestry + result.metrics.queriesByPhase.expansion,
  );
});

test("the request decides the fuzzy mode over everything else", () => {
  assert.equal(resolveFuzzyMode({ request: false, env: { TMCT_RETRIEVAL_FUZZY: "1" }, config: true }), false);
  assert.equal(resolveFuzzyMode({ request: true, env: { TMCT_RETRIEVAL_FUZZY: "0" }, config: false }), true);
});

test("the environment decides when the request says nothing", () => {
  assert.equal(resolveFuzzyMode({ env: { TMCT_RETRIEVAL_FUZZY: "0" }, config: true }), false);
  assert.equal(resolveFuzzyMode({ env: { TMCT_RETRIEVAL_FUZZY: "false" }, config: true }), false);
  assert.equal(resolveFuzzyMode({ env: { TMCT_RETRIEVAL_FUZZY: "1" }, config: false }), true);
});

test("the config decides when neither the request nor the environment does", () => {
  assert.equal(resolveFuzzyMode({ env: {}, config: false }), false);
  assert.equal(resolveFuzzyMode({ env: { TMCT_RETRIEVAL_FUZZY: "maybe" }, config: false }), false);
});

test("fuzzy is on when nothing says otherwise", () => {
  assert.equal(resolveFuzzyMode({ env: {} }), true);
  assert.equal(resolveFuzzyMode(), true);
});

test("only a throttle, a 5xx or a timeout counts against the store", () => {
  assert.equal(isSystemicFailure(new BackendUnavailable("down")), true);
  assert.equal(isSystemicFailure(Object.assign(new Error("slow"), { name: "TimeoutError" })), true);
  assert.equal(isSystemicFailure(Object.assign(new Error("throttled"), { $metadata: { httpStatusCode: 429 } })), true);
  assert.equal(isSystemicFailure(Object.assign(new Error("boom"), { $metadata: { httpStatusCode: 503 } })), true);
  assert.equal(isSystemicFailure(new BackendRejected("bad row")), false);
  assert.equal(isSystemicFailure(Object.assign(new Error("bad key"), { $metadata: { httpStatusCode: 400 } })), false);
  assert.equal(isSystemicFailure(null), false);
});

test("the budgets are frozen, so a request cannot widen its own read", () => {
  assert.ok(Object.isFrozen(RETRIEVAL_BUDGETS));
});

test("naming one budget keeps every other one", async () => {
  const result = await retrieve({ budgets: { totalRows: 2 } });
  assert.equal(result.rows.length, 2);
  assert.equal(result.metrics.tripped, "totalRows");
});
