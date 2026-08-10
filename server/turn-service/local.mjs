// local.mjs — the turn service's test double: `handler.mjs`'s core mounted
// on `node:http`, session rows in the M2 in-memory reference backend, and a
// fixture corpus band loaded through T0's real loader (`loadBand`) into a
// small hand-rolled DynamoDB-shaped fake. Every later phase that needs a
// running turn service starts one of these rather than talking to AWS.
//
// Two fake client SHAPES back the two things a real deployment splits
// across one DynamoDBClient wrapped two ways (handler.mjs's own comment):
// a `.query()/.get()/.put()/.delete()` convenience client for the corpus
// band (`loadBand`, retrieval's term reads), and a `.send(Command)` client
// for the corpus breaker's `_meta` item. Neither is an emulator — each
// understands exactly the request shapes this surface's own modules send,
// the same deliberate narrowness the shipped test fakes use, and throws
// loudly on anything else rather than matching it by accident.
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import { createDynamoCorpusBreaker, CORPUS_BREAKER_PARTITION_KEY, CORPUS_BREAKER_SORT_KEY } from "../../src/adapters/memory/dynamo-circuit-breaker.mjs";
import { loadBand } from "../../src/services/corpus-loader.mjs";
import { termQueryOverDocumentClient } from "../../src/services/subgraph-retrieval.mjs";
import { createTurnServiceHandler, DEFAULT_TURN_RATE_LIMIT_PER_HOUR, TURN_RATE_WINDOW_SECONDS } from "./handler.mjs";

const DEFAULT_TABLE_NAME = "local-turn-service";

/** A convenience-shaped fake (`.query`/`.get`/`.put`/`.delete`) over an
 *  in-memory Map — the same request shapes `loadBand`/`clearBand`/
 *  `termQueryOverDocumentClient` send, understanding a plain pk equality
 *  Query and a pk-plus-`begins_with(sk, …)` Query, nothing wider. */
function createFakeConvenienceClient() {
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
    async delete({ Key }) {
      store.delete(storeKey(Key.pk, Key.sk));
      return {};
    },
    async query({ KeyConditionExpression, ExpressionAttributeValues, Limit, ExclusiveStartKey }) {
      const pk = ExpressionAttributeValues[":pk"];
      let matches = [...store.values()].filter((item) => item.pk === pk);
      if (KeyConditionExpression.includes("begins_with")) {
        const prefix = ExpressionAttributeValues[":sk"];
        matches = matches.filter((item) => item.sk.startsWith(prefix));
      } else if (KeyConditionExpression !== "pk = :pk") {
        throw new Error(`local turn service: unrecognized key condition "${KeyConditionExpression}"`);
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

const metaKey = (sk) => `${CORPUS_BREAKER_PARTITION_KEY}|${sk}`;

/** The evaluators for exactly the four condition expressions
 *  `dynamo-circuit-breaker.mjs` sends, keyed by their exact text — an
 *  unrecognized condition throws rather than passing by accident. */
const CONDITION_EVALUATORS = {
  "attribute_not_exists(windowStart) OR windowStart > :windowFloor": (item, values) => (
    item.windowStart === undefined || item.windowStart > values[":windowFloor"]
  ),
  "#state = :closed": (item, values) => (item.state ?? "closed") === values[":closed"],
  "#state = :halfOpen": (item, values) => item.state === values[":halfOpen"],
  "#state = :open AND openedAt = :openedAt": (item, values) => (
    item.state === values[":open"] && item.openedAt === values[":openedAt"]
  ),
};

function conditionPasses(item, conditionExpression, values) {
  if (!conditionExpression) return true;
  const evaluator = CONDITION_EVALUATORS[conditionExpression];
  if (!evaluator) throw new Error(`local turn service: unrecognized condition expression "${conditionExpression}"`);
  return evaluator(item ?? {}, values);
}

/** The evaluators for exactly the three SET/ADD update expressions
 *  `dynamo-circuit-breaker.mjs` sends. Each returns the item's next shape;
 *  the caller only commits it once the paired condition has passed. */
const UPDATE_APPLIERS = {
  "SET windowStart = if_not_exists(windowStart, :now), #state = if_not_exists(#state, :closed) ADD failures :failureCount": (item, values) => ({
    ...item,
    windowStart: item.windowStart ?? values[":now"],
    state: item.state ?? values[":closed"],
    failures: (item.failures ?? 0) + values[":failureCount"],
  }),
  "SET failures = :failureCount, windowStart = :now": (item, values) => ({
    ...item, failures: values[":failureCount"], windowStart: values[":now"],
  }),
  "SET #state = :open, openedAt = :now": (item, values) => ({ ...item, state: values[":open"], openedAt: values[":now"] }),
  "SET #state = :closed, failures = :zero": (item, values) => ({ ...item, state: values[":closed"], failures: values[":zero"] }),
  "SET #state = :halfOpen": (item, values) => ({ ...item, state: values[":halfOpen"] }),
};

/** A `.send(Command)`-shaped fake over an in-memory Map, understanding only
 *  the Get and the five exact Update shapes the corpus breaker sends. A
 *  test seeds or inspects breaker state directly through the exposed
 *  `store` Map (key `"pk|sk"`), which is simpler and no less faithful than
 *  driving five real systemic failures through the window/threshold math to
 *  reach the same state. */
function createFakeMetaCommandClient() {
  const store = new Map();
  return {
    store,
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      const key = metaKey(input.Key.sk);
      if (name === "GetCommand") {
        const item = store.get(key);
        return { Item: item ? { ...item } : undefined };
      }
      if (name === "UpdateCommand") {
        const applier = UPDATE_APPLIERS[input.UpdateExpression];
        if (!applier) throw new Error(`local turn service: unrecognized update expression "${input.UpdateExpression}"`);
        const current = store.get(key);
        if (!conditionPasses(current, input.ConditionExpression, input.ExpressionAttributeValues)) {
          const error = new Error("The conditional request failed");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        const next = applier(current ?? {}, input.ExpressionAttributeValues);
        store.set(key, next);
        return { Attributes: next };
      }
      throw new Error(`local turn service: unsupported command ${name}`);
    },
  };
}

/** `now` is epoch SECONDS, matching the row service's own local double and
 *  `createRowMemoryBackend`'s TTL clock — the one exception is the corpus
 *  breaker and retrieval's own wall-clock budget, both of which want
 *  milliseconds and get `now`-times-1000 where they're constructed below. */
function createInMemoryTurnRateCounter({
  turnRateLimit = DEFAULT_TURN_RATE_LIMIT_PER_HOUR,
  turnRateWindowSeconds = TURN_RATE_WINDOW_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const windows = new Map(); // sessionKey -> { count, resetAt }
  return {
    async incrementTurnRate(sessionKey) {
      const currentTime = now();
      let window = windows.get(sessionKey);
      if (!window || window.resetAt <= currentTime) {
        window = { count: 0, resetAt: currentTime + turnRateWindowSeconds };
        windows.set(sessionKey, window);
      }
      if (window.count >= turnRateLimit) return false;
      window.count += 1;
      return true;
    },
  };
}

/** The same table-wide cap shape `createDynamoGlobalRowCapCounter` gives the
 *  real deployment, over a plain counter instead of a conditional Dynamo
 *  write — so a test can push a turn's own writes into the cap without
 *  standing up the row service's own local double. `null` (the default)
 *  turns this into a no-op object that always says yes, the same "no cap
 *  configured" shape an unset `tableRowCap` deployment answers with. */
function createInMemoryGlobalRowCapCounter(tableRowCap) {
  let count = 0;
  return {
    async incrementGlobalRowCount(n) {
      if (tableRowCap == null) return true;
      if (count + n > tableRowCap) return false;
      count += n;
      return true;
    },
    readGlobalRowCount: () => count,
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

/** Loads `rows` (wire rows, e.g. built with `bandFactRow`) into `band` on a
 *  fresh fake convenience client, through the real loader — so this
 *  double's fixture band takes the exact write path a deployed loader run
 *  would. */
async function loadFixtureBand({ client, tableName, band, rows }) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-turn-service-"));
  const path = join(dir, "band.jsonl");
  try {
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
    if (rows.length) await loadBand({ client, tableName, band, source: path });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Starts the turn service's test double on an ephemeral port.
 *
 *  `fixtureBand` (optional, `{name, rows}`) loads a small band of wire rows
 *  (`bandFactRow`-shaped) through the real loader before the server opens,
 *  so a test can ask a question the fixture actually grounds. Omitting it
 *  leaves `bands: []`, the same "no corpus configured" shape a bandless
 *  deployment answers with.
 *
 *  `seedPayload` is the mid-bundle stand-in this double runs over — a small,
 *  fixed payload is enough for a test; the real mid bundle is a separate,
 *  one-off measurement (`server/turn-service/build-seed.mjs`), not something
 *  every test run pays to parse.
 *
 *  `turnRateLimit`/`now`/`sleep` mirror the deployment parameters and the
 *  clock hook, for deterministic tests. `tableRowCap` (default null,
 *  uncapped) mirrors the row service's own global table cap over an
 *  in-memory counter, so a test can push a turn's learned writes into the
 *  cap without a real Dynamo table; `readGlobalRowCount()` on the returned
 *  object reads it back. `breakerStore` and `bandClient` on the returned
 *  object expose the two fakes' underlying Maps, so a test can seed breaker
 *  state (open/half-open) or inspect band writes directly.
 *
 *  `getSessionBackend` (optional) lets a caller supply the SAME
 *  session-backend registry another local double already owns — the row
 *  service's own real "stop & forget" purge (`deleteAll()`) only reaches
 *  what a later turn reads back when both sides construct their backend
 *  from one shared factory, the same pattern `row-service/local.mjs` uses to
 *  hand its own registry to the news worker. Supplying one hands this
 *  double ownership of nobody's backends, so `close()` leaves them open for
 *  whichever caller built them. */
export async function createLocalTurnService({
  seedPayload = { individuals: [] },
  fixtureBand = null,
  tableName = DEFAULT_TABLE_NAME,
  turnRateLimit = DEFAULT_TURN_RATE_LIMIT_PER_HOUR,
  turnRateWindowSeconds = TURN_RATE_WINDOW_SECONDS,
  tableRowCap = null,
  now = () => Math.floor(Date.now() / 1000),
  sleep = undefined,
  getSessionBackend: sharedGetSessionBackend = null,
  log = () => {},
} = {}) {
  const bandClient = createFakeConvenienceClient();
  const metaClient = createFakeMetaCommandClient();
  const bands = fixtureBand ? [fixtureBand.name] : [];

  if (fixtureBand) await loadFixtureBand({ client: bandClient, tableName, band: fixtureBand.name, rows: fixtureBand.rows });

  const sessionBackends = new Map();
  const ownGetSessionBackend = (sessionKey) => {
    let backend = sessionBackends.get(sessionKey);
    if (!backend) {
      backend = createRowMemoryBackend({ clock: now });
      sessionBackends.set(sessionKey, backend);
    }
    return backend;
  };
  const getSessionBackend = sharedGetSessionBackend ?? ownGetSessionBackend;

  const globalRowCapCounter = createInMemoryGlobalRowCapCounter(tableRowCap);

  const turnService = createTurnServiceHandler({
    createSessionBackend: getSessionBackend,
    seedPayload,
    bands,
    queryTerm: bands.length ? termQueryOverDocumentClient({ client: bandClient, tableName }) : null,
    breaker: bands.length ? createDynamoCorpusBreaker({ client: metaClient, tableName, clock: () => now() * 1000 }) : null,
    counters: createInMemoryTurnRateCounter({ turnRateLimit, turnRateWindowSeconds, now }),
    globalRowCapCounter,
    now: () => now() * 1000,
    sleep,
    log,
  });

  const server = createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, "http://localhost");
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    const query = Object.fromEntries(parsedUrl.searchParams);
    const body = await readRequestBody(req);

    const result = await turnService.handle({ method: req.method, path: parsedUrl.pathname, headers, query, body });
    res.writeHead(result.status, result.headers);
    res.end(result.body || "");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  /** Force the corpus breaker straight to the open state, cooldown starting
   *  now — the shortcut a test takes instead of driving five real systemic
   *  failures through the window/threshold math. No-op when no band is
   *  configured (there is no breaker to force). */
  function forceBreakerOpen({ openedAt = now() * 1000 } = {}) {
    if (!bands.length) return;
    metaClient.store.set(metaKey(CORPUS_BREAKER_SORT_KEY), {
      pk: CORPUS_BREAKER_PARTITION_KEY, sk: CORPUS_BREAKER_SORT_KEY, state: "open", failures: 0, openedAt,
    });
  }

  async function close() {
    for (const backend of sessionBackends.values()) await backend.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    url, close, bandClient, breakerStore: metaClient.store, forceBreakerOpen,
    readGlobalRowCount: globalRowCapCounter.readGlobalRowCount,
  };
}
