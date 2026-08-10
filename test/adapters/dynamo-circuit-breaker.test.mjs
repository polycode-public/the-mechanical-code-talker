// dynamo-circuit-breaker.test.mjs — the corpus breaker's state machine over
// a hand-built double for @aws-sdk/lib-dynamodb's Get/Update, understanding
// only the exact Update and Condition expression shapes the breaker module
// is specified to send. An unrecognized shape throws loudly rather than
// silently matching everything, so a change to the breaker's own wire
// format fails here instead of passing by accident.

import test from "node:test";
import assert from "node:assert/strict";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import {
  createDynamoCorpusBreaker,
  failureCountFromOutcome,
  CORPUS_BREAKER_KIND,
  CORPUS_BREAKER_PARTITION_KEY,
  CORPUS_BREAKER_SORT_KEY,
  CORPUS_BREAKER_DEFAULTS,
} from "../../src/adapters/memory/dynamo-circuit-breaker.mjs";
import { SUPPLEMENTED_MODE, SEED_SESSION_MODE } from "../../src/services/subgraph-retrieval.mjs";

// Splits a Dynamo expression fragment on a separator, skipping any
// separator found inside parentheses — the only way to tell
// "if_not_exists(a, b)"'s own comma from a clause boundary.
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && text.slice(i, i + separator.length) === separator) {
      parts.push(current);
      current = "";
      i += separator.length;
      continue;
    }
    current += char;
    i += 1;
  }
  parts.push(current);
  return parts;
}

function resolveAttribute(rawName, names) {
  return rawName.startsWith("#") ? names[rawName] : rawName;
}

function evalConditionFragment(fragment, item, names, values) {
  const notExists = fragment.match(/^attribute_not_exists\((\w+)\)$/);
  if (notExists) return item[notExists[1]] === undefined;
  const greaterThan = fragment.match(/^(\w+) > (:\w+)$/);
  if (greaterThan) return (item[greaterThan[1]] ?? -Infinity) > values[greaterThan[2]];
  const equals = fragment.match(/^(#?\w+) = (:\w+)$/);
  if (equals) return item[resolveAttribute(equals[1], names)] === values[equals[2]];
  throw new Error(`fake breaker client: unrecognized condition fragment "${fragment}"`);
}

function evalCondition(expression, item, names, values) {
  if (!expression) return true;
  if (expression.includes(" OR ")) return expression.split(" OR ").some((fragment) => evalConditionFragment(fragment.trim(), item, names, values));
  if (expression.includes(" AND ")) return expression.split(" AND ").every((fragment) => evalConditionFragment(fragment.trim(), item, names, values));
  return evalConditionFragment(expression.trim(), item, names, values);
}

function applyUpdate(expression, item, names, values) {
  const addIndex = expression.indexOf(" ADD ");
  const setPart = addIndex === -1 ? expression : expression.slice(0, addIndex);
  const addPart = addIndex === -1 ? null : expression.slice(addIndex + " ADD ".length);
  const next = { ...item };

  for (const clause of splitTopLevel(setPart.replace(/^SET /, ""), ", ")) {
    const eqIndex = clause.indexOf(" = ");
    const attr = resolveAttribute(clause.slice(0, eqIndex).trim(), names);
    const rawValue = clause.slice(eqIndex + 3).trim();
    const ifNotExists = rawValue.match(/^if_not_exists\((#?\w+),\s*(:\w+)\)$/);
    if (ifNotExists) {
      const existingAttr = resolveAttribute(ifNotExists[1], names);
      next[attr] = item[existingAttr] !== undefined ? item[existingAttr] : values[ifNotExists[2]];
    } else {
      next[attr] = values[rawValue];
    }
  }

  if (addPart) {
    const [rawAttr, rawValue] = addPart.trim().split(" ");
    const attr = resolveAttribute(rawAttr, names);
    next[attr] = (item[attr] ?? 0) + values[rawValue];
  }

  return next;
}

function createFakeBreakerTable() {
  let item;
  const updateCalls = [];
  return {
    updateCalls,
    async send(command) {
      if (command instanceof GetCommand) return { Item: item ? { ...item } : undefined };
      if (command instanceof UpdateCommand) {
        updateCalls.push(command);
        const { ConditionExpression, UpdateExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues = {} } = command.input;
        const current = item ?? {};
        if (!evalCondition(ConditionExpression, current, ExpressionAttributeNames, ExpressionAttributeValues)) {
          const error = new Error("The conditional request failed");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        item = applyUpdate(UpdateExpression, current, ExpressionAttributeNames, ExpressionAttributeValues);
        return { Attributes: { ...item } };
      }
      throw new Error(`fake breaker table: unsupported command ${command?.constructor?.name}`);
    },
  };
}

function createBreaker(overrides = {}) {
  const client = overrides.client ?? createFakeBreakerTable();
  let now = overrides.startAt ?? 0;
  const clock = () => now;
  const breaker = createDynamoCorpusBreaker({
    client,
    tableName: "corpus-table",
    clock,
    failureThreshold: overrides.failureThreshold ?? 3,
    windowMs: overrides.windowMs ?? 1000,
    cooldownMs: overrides.cooldownMs ?? 1000,
  });
  return { breaker, client, advance: (ms) => { now += ms; } };
}

test("a closed breaker with no prior failures lets a turn retrieve and never writes for a non-failing outcome", async () => {
  const { breaker, client } = createBreaker();
  const decision = await breaker.decide();
  assert.equal(decision.mode, SUPPLEMENTED_MODE);
  assert.equal(decision.probe, false);

  await decision.report({ systemicFailures: 0 });
  await decision.report(0);
  await decision.report(undefined);
  await decision.report({ metrics: { systemicFailures: 0 } });
  assert.equal(client.updateCalls.length, 0, "an empty or successful outcome never touches the table");
  assert.equal((await breaker.readState()).state, "closed");
});

test("systemic failures accumulate toward the threshold and open the breaker once it crosses", async () => {
  const { breaker } = createBreaker({ failureThreshold: 3 });

  let decision = await breaker.decide();
  await decision.report({ systemicFailures: 1 });
  assert.equal((await breaker.readState()).state, "closed");

  decision = await breaker.decide();
  await decision.report({ systemicFailures: 1 });
  assert.equal((await breaker.readState()).failures, 2);
  assert.equal((await breaker.readState()).state, "closed");

  decision = await breaker.decide();
  await decision.report({ systemicFailures: 1 });
  const opened = await breaker.readState();
  assert.equal(opened.state, "open");
  assert.equal(typeof opened.openedAt, "number");
});

test("a stale window resets the failure count instead of adding to it", async () => {
  const { breaker, advance } = createBreaker({ failureThreshold: 5, windowMs: 1000 });

  let decision = await breaker.decide();
  await decision.report({ systemicFailures: 2 });
  assert.equal((await breaker.readState()).failures, 2);

  advance(1500); // past the window
  decision = await breaker.decide();
  await decision.report({ systemicFailures: 1 });
  const state = await breaker.readState();
  assert.equal(state.failures, 1, "the new window starts counting from this failure alone");
  assert.equal(state.state, "closed");
});

test("failureCountFromOutcome classifies a raw error the same way the retrieval layer does, and never counts an empty result", () => {
  const throttled = new Error("throttled");
  throttled.name = "ThrottlingException";
  assert.equal(failureCountFromOutcome({ error: throttled }), 1);

  const notFound = new Error("nothing matched");
  assert.equal(failureCountFromOutcome({ error: notFound }), 0);

  assert.equal(failureCountFromOutcome(null), 0);
  assert.equal(failureCountFromOutcome({ systemicFailures: 0 }), 0);
  assert.equal(failureCountFromOutcome({ metrics: { systemicFailures: 4 } }), 4);
});

test("an open breaker skips every turn until its cooldown elapses", async () => {
  const { breaker, advance } = createBreaker({ failureThreshold: 1, cooldownMs: 1000 });

  const opening = await breaker.decide();
  await opening.report({ systemicFailures: 1 });
  assert.equal((await breaker.readState()).state, "open");

  let decision = await breaker.decide();
  assert.equal(decision.mode, SEED_SESSION_MODE);
  assert.equal(decision.probe, false);
  await decision.report({ systemicFailures: 1 }); // a no-op report; nothing was retrieved

  advance(999);
  decision = await breaker.decide();
  assert.equal(decision.mode, SEED_SESSION_MODE);

  advance(1); // now at the cooldown boundary
  decision = await breaker.decide();
  assert.equal(decision.mode, SUPPLEMENTED_MODE);
  assert.equal(decision.probe, true);
});

test("the winner of the half-open race gets the probe and every other reader skips", async () => {
  const { breaker: breakerA, client, advance } = createBreaker({ failureThreshold: 1, cooldownMs: 1000 });
  const opening = await breakerA.decide();
  await opening.report({ systemicFailures: 1 });
  advance(1000);

  const breakerB = createDynamoCorpusBreaker({
    client, tableName: "corpus-table", clock: () => 1000, failureThreshold: 1, windowMs: 1000, cooldownMs: 1000,
  });

  const [decisionA, decisionB] = await Promise.all([breakerA.decide(), breakerB.decide()]);
  const probes = [decisionA, decisionB].filter((decision) => decision.probe);
  const skips = [decisionA, decisionB].filter((decision) => !decision.probe);
  assert.equal(probes.length, 1, "exactly one contender wins the transition");
  assert.equal(skips.length, 1);
  assert.equal(probes[0].mode, SUPPLEMENTED_MODE);
  assert.equal(skips[0].mode, SEED_SESSION_MODE);

  const thirdReader = await breakerA.decide();
  assert.equal(thirdReader.mode, SEED_SESSION_MODE, "a fresh read while half-open is still open finds no transition left to win");
});

test("a successful probe closes the breaker and clears its failure count", async () => {
  const { breaker, advance } = createBreaker({ failureThreshold: 1, cooldownMs: 1000 });
  const opening = await breaker.decide();
  await opening.report({ systemicFailures: 1 });
  advance(1000);

  const probe = await breaker.decide();
  assert.equal(probe.probe, true);
  await probe.report({ systemicFailures: 0 });

  const state = await breaker.readState();
  assert.equal(state.state, "closed");
  assert.equal(state.failures, 0);

  const next = await breaker.decide();
  assert.equal(next.mode, SUPPLEMENTED_MODE);
  assert.equal(next.probe, false);
});

test("a failed probe reopens the breaker with a fresh cooldown", async () => {
  const { breaker, advance } = createBreaker({ failureThreshold: 1, cooldownMs: 1000 });
  const opening = await breaker.decide();
  await opening.report({ systemicFailures: 1 });
  advance(1000);

  const probe = await breaker.decide();
  assert.equal(probe.probe, true);
  const beforeRetry = await breaker.readState();
  await probe.report({ systemicFailures: 1 });

  const state = await breaker.readState();
  assert.equal(state.state, "open");
  assert.notEqual(state.openedAt, beforeRetry.openedAt);

  const immediatelyAfter = await breaker.decide();
  assert.equal(immediatelyAfter.mode, SEED_SESSION_MODE, "the cooldown restarted from the probe's own failure");
});

test("many concurrent systemic failures that all cross the threshold open the breaker exactly once", async () => {
  const { client } = createBreaker();
  const breakers = Array.from({ length: 5 }, () => createDynamoCorpusBreaker({
    client, tableName: "corpus-table", clock: () => 0, failureThreshold: 3, windowMs: 1000, cooldownMs: 1000,
  }));

  const decisions = await Promise.all(breakers.map((breaker) => breaker.decide()));
  // Every one of the five sees a failing outcome and every one that observes
  // the threshold crossed attempts the open write — that several attempt it
  // is expected and safe; the condition on `state` guarantees only the first
  // to land actually flips it, and this asserts that single scalar outcome
  // rather than counting attempts, which the state machine never promises to
  // limit to one.
  await Promise.all(decisions.map((decision) => decision.report({ systemicFailures: 1 })));

  const finalState = await breakers[0].readState();
  assert.equal(finalState.state, "open");
  assert.equal(typeof finalState.openedAt, "number");
  assert.equal(finalState.failures, 5, "every report's failure count lands; none of the five is silently lost to the race");
});

test("the reserved key and mode flags are the ones the turn surface and the retrieval layer both read", () => {
  assert.equal(CORPUS_BREAKER_PARTITION_KEY, "_meta");
  assert.equal(CORPUS_BREAKER_SORT_KEY, "breaker#corpus");
  assert.equal(CORPUS_BREAKER_KIND, "tmct.dynamo-corpus-breaker@1");
  assert.equal(CORPUS_BREAKER_DEFAULTS.failureThreshold, 5);
  assert.equal(CORPUS_BREAKER_DEFAULTS.windowMs, 60_000);
  assert.equal(CORPUS_BREAKER_DEFAULTS.cooldownMs, 60_000);
});

test("the constructor demands a client and a table name", () => {
  assert.throws(() => createDynamoCorpusBreaker({ tableName: "corpus-table" }), TypeError);
  assert.throws(() => createDynamoCorpusBreaker({ client: createFakeBreakerTable() }), TypeError);
});
