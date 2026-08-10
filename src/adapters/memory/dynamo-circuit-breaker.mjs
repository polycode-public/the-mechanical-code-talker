// dynamo-circuit-breaker.mjs — guards the turn surface's corpus band Queries
// against a struggling table. Lambda invocations share nothing, so the state
// a breaker would normally hold in a local variable lives instead in one
// shared item read and written through the same document client every
// corpus Query already uses: partition `_meta`, sort key `breaker#corpus`.
// A conditional write settles every race between concurrent invocations —
// whichever write lands first wins the state transition, and every loser's
// write fails its own condition and falls back to the same skip its read
// would have given it anyway.
//
// The machine has three states. Closed lets a turn retrieve; a systemic
// failure adds to a count inside a fixed window, and crossing a fixed
// threshold opens the breaker. Open skips retrieval outright until a fixed
// cooldown elapses, at which point exactly one turn — the winner of the
// closed-to-half-open race — runs a single bounded probe before every other
// turn resumes skipping. The probe's own outcome decides closed or open
// again.
//
// Every decision comes back as `{ mode, probe, report }`. `mode` is the same
// flag the retrieval layer's own honesty marker reads, imported rather than
// re-minted here so a breaker skip and a bandless skip read identically to
// an answer. `report(outcome)` is the one call a caller makes once retrieval
// (or the skip) is over; it is a no-op when `mode` was the skip mode, since
// there was nothing to report.
//
// The clock is injected (default `Date.now`) so window rollover, cooldown
// expiry and the conditional-write races are all reproducible without a
// real wall clock.

import { isSystemicFailure } from "./systemic-failure.mjs";
import { SUPPLEMENTED_MODE, SEED_SESSION_MODE } from "../../domain/retrieval-modes.mjs";

const SDK_MODULE_SPECIFIER = "@aws-sdk/lib-dynamodb";

export const CORPUS_BREAKER_KIND = "tmct.dynamo-corpus-breaker@1";
export const CORPUS_BREAKER_PARTITION_KEY = "_meta";
export const CORPUS_BREAKER_SORT_KEY = "breaker#corpus";

export const CORPUS_BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 60_000,
});

const DEFAULT_ATTRIBUTE_NAMES = Object.freeze({ pk: "pk", sk: "sk" });

const STATE_CLOSED = "closed";
const STATE_OPEN = "open";
const STATE_HALF_OPEN = "half-open";

let sdkPromise = null;
async function loadDynamoCommands() {
  if (!sdkPromise) {
    sdkPromise = import(SDK_MODULE_SPECIFIER).catch((cause) => {
      sdkPromise = null;
      throw new Error(`the corpus breaker needs "${SDK_MODULE_SPECIFIER}" (>=3) installed alongside tmct: ${cause.message}`, { cause });
    });
  }
  return sdkPromise;
}

function isConditionalCheckFailure(error) {
  return error?.name === "ConditionalCheckFailedException";
}

/** How many systemic failures does this outcome carry? Accepts whatever
 *  shape a caller has to hand: a bare number, an aggregate retrieval
 *  metrics object (or `{ metrics }` wrapping one) carrying its own
 *  `systemicFailures` count, or a single raw error from one bounded probe
 *  read — classified with the retrieval layer's own rule so a query that
 *  merely returned nothing never counts against the breaker. */
export function failureCountFromOutcome(outcome) {
  if (outcome == null) return 0;
  if (typeof outcome === "number") return outcome;
  if (typeof outcome.systemicFailures === "number") return outcome.systemicFailures;
  if (outcome.metrics && typeof outcome.metrics.systemicFailures === "number") return outcome.metrics.systemicFailures;
  if ("error" in outcome) return isSystemicFailure(outcome.error) ? 1 : 0;
  return 0;
}

export function createDynamoCorpusBreaker({
  client,
  tableName,
  clock = Date.now,
  attributeNames = DEFAULT_ATTRIBUTE_NAMES,
  failureThreshold = CORPUS_BREAKER_DEFAULTS.failureThreshold,
  windowMs = CORPUS_BREAKER_DEFAULTS.windowMs,
  cooldownMs = CORPUS_BREAKER_DEFAULTS.cooldownMs,
} = {}) {
  if (!client) throw new TypeError("createDynamoCorpusBreaker needs a client (an @aws-sdk/lib-dynamodb DynamoDBDocumentClient)");
  if (!tableName) throw new TypeError("createDynamoCorpusBreaker needs a tableName");

  const names = { ...DEFAULT_ATTRIBUTE_NAMES, ...attributeNames };
  const key = { [names.pk]: CORPUS_BREAKER_PARTITION_KEY, [names.sk]: CORPUS_BREAKER_SORT_KEY };

  function stateFromItem(item) {
    if (!item) return { state: STATE_CLOSED, failures: 0, windowStart: null, openedAt: null };
    return {
      state: item.state ?? STATE_CLOSED,
      failures: typeof item.failures === "number" ? item.failures : 0,
      windowStart: typeof item.windowStart === "number" ? item.windowStart : null,
      openedAt: typeof item.openedAt === "number" ? item.openedAt : null,
    };
  }

  /** The breaker's current state, read consistently. Exposed for narration
   *  and tests; deciding a turn's own retrieval plan goes through `decide`,
   *  never this alone, since a read with no accompanying write is not a
   *  transition. */
  async function readState() {
    const { GetCommand } = await loadDynamoCommands();
    const result = await client.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
    return stateFromItem(result.Item);
  }

  const noopReport = async () => {};

  /** Adds `failureCount` systemic failures to the current window, creating
   *  the item on its first failure ever. A window that has already aged out
   *  resets to this failure alone rather than adding to a stale total.
   *  Crossing the threshold opens the breaker; losing that race to another
   *  invocation is not an error, it is the point of the condition. */
  async function recordSystemicFailure(failureCount) {
    const { UpdateCommand } = await loadDynamoCommands();
    const now = clock();
    const windowFloor = now - windowMs;
    let updatedFailures;
    try {
      const result = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: "SET windowStart = if_not_exists(windowStart, :now), #state = if_not_exists(#state, :closed) ADD failures :failureCount",
        ConditionExpression: "attribute_not_exists(windowStart) OR windowStart > :windowFloor",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: {
          ":now": now, ":closed": STATE_CLOSED, ":failureCount": failureCount, ":windowFloor": windowFloor,
        },
        ReturnValues: "UPDATED_NEW",
      }));
      updatedFailures = result.Attributes?.failures ?? failureCount;
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
      const result = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: "SET failures = :failureCount, windowStart = :now",
        ExpressionAttributeValues: { ":failureCount": failureCount, ":now": now },
        ReturnValues: "UPDATED_NEW",
      }));
      updatedFailures = result.Attributes?.failures ?? failureCount;
    }

    if (updatedFailures < failureThreshold) return;
    try {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: "SET #state = :open, openedAt = :now",
        ConditionExpression: "#state = :closed",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":open": STATE_OPEN, ":closed": STATE_CLOSED, ":now": now },
      }));
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
      // another invocation already opened it from the same window's count
    }
  }

  /** Settles the one probe a half-open breaker allows: success closes it and
   *  clears the failure count, a systemic failure reopens it with a fresh
   *  cooldown. The condition guards against a caller reporting the same
   *  probe twice; a second report finds the state already moved on and is
   *  ignored rather than thrown. */
  async function resolveProbe(failed) {
    const { UpdateCommand } = await loadDynamoCommands();
    const now = clock();
    const transition = failed
      ? {
          UpdateExpression: "SET #state = :open, openedAt = :now",
          ExpressionAttributeValues: { ":open": STATE_OPEN, ":halfOpen": STATE_HALF_OPEN, ":now": now },
        }
      : {
          UpdateExpression: "SET #state = :closed, failures = :zero",
          ExpressionAttributeValues: { ":closed": STATE_CLOSED, ":halfOpen": STATE_HALF_OPEN, ":zero": 0 },
        };
    try {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: transition.UpdateExpression,
        ConditionExpression: "#state = :halfOpen",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: transition.ExpressionAttributeValues,
      }));
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
    }
  }

  /** The race an open breaker's cooldown resolves: every invocation past
   *  cooldown tries this same conditional write, keyed to the exact
   *  `openedAt` it read, and only the first one lands. Everyone else's
   *  condition fails — the state moved to half-open, or on to closed, or
   *  reopened under a newer `openedAt` — and they skip like any other
   *  reader of a breaker that is not closed. */
  async function attemptHalfOpenTransition(openedAt) {
    const { UpdateCommand } = await loadDynamoCommands();
    try {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: "SET #state = :halfOpen",
        ConditionExpression: "#state = :open AND openedAt = :openedAt",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":halfOpen": STATE_HALF_OPEN, ":open": STATE_OPEN, ":openedAt": openedAt },
      }));
      return true;
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
      return false;
    }
  }

  /** Decides this turn's retrieval plan and hands back the one call needed
   *  to close the loop afterward. `mode` is what the answer's retrieval
   *  payload carries; `probe` marks the single winning call that must bound
   *  itself to one read instead of the turn's usual plan. */
  async function decide() {
    const current = await readState();

    if (current.state === STATE_CLOSED) {
      return {
        mode: SUPPLEMENTED_MODE,
        probe: false,
        report: async (outcome) => {
          const failureCount = failureCountFromOutcome(outcome);
          if (failureCount > 0) await recordSystemicFailure(failureCount);
        },
      };
    }

    if (current.state === STATE_OPEN) {
      const now = clock();
      if (current.openedAt == null || now - current.openedAt < cooldownMs) {
        return { mode: SEED_SESSION_MODE, probe: false, report: noopReport };
      }
      const won = await attemptHalfOpenTransition(current.openedAt);
      if (!won) return { mode: SEED_SESSION_MODE, probe: false, report: noopReport };
      return {
        mode: SUPPLEMENTED_MODE,
        probe: true,
        report: async (outcome) => { await resolveProbe(failureCountFromOutcome(outcome) > 0); },
      };
    }

    // half-open: every reader that did not itself win the transition above
    // skips, including a fresh decide() call that finds it already half-open
    return { mode: SEED_SESSION_MODE, probe: false, report: noopReport };
  }

  return {
    kind: CORPUS_BREAKER_KIND,
    decide,
    readState,
  };
}
