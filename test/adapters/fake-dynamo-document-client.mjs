// fake-dynamo-document-client.mjs — a hand-built double for
// @aws-sdk/lib-dynamodb's DynamoDBDocumentClient: Query/Put/Delete/Get/Update
// over a Map keyed "pk|sk", understanding only the exact command shapes the
// shipped DynamoDB row backend (row-backend-dynamo.mjs) is specified to
// send. Not an emulator — a Query's KeyConditionExpression is either plain
// pk equality or pk equality plus `begins_with(#sk, :skPrefix)`, and its
// FilterExpression, when present, is one or two clauses from a fixed set
// (`attribute_not_exists(#deletedAt)`, `NOT begins_with(#sk, :metaPrefix)`)
// joined by " AND ". An unrecognized expression throws loudly rather than
// silently matching everything, so a backend change that starts emitting a
// new shape fails here instead of passing by accident.
//
// Every command that reaches `send` is recorded in `calls`, so a test can
// inspect the exact expressions and `ConsistentRead` flags a backend call
// produced. `maxInFlight` tracks the largest number of concurrent `send`
// calls this client has ever had in progress, which is how a test proves a
// batch of writes went out concurrently rather than one at a time.
import {
  QueryCommand, PutCommand, DeleteCommand, GetCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const DEFAULT_ATTRIBUTE_NAMES = Object.freeze({
  pk: "pk", sk: "sk", expiresAt: "expiresAt", deletedAt: "deletedAt",
});

const UPDATE_SET_EXPRESSION = /^SET (#\w+) = (:\w+)$/;

export function createFakeDynamoDocumentClient({
  attributeNames = DEFAULT_ATTRIBUTE_NAMES,
  queryPageSize = 3,
} = {}) {
  const names = { ...DEFAULT_ATTRIBUTE_NAMES, ...attributeNames };
  const store = new Map();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;

  // A tiny delay so calls fired without awaiting between them (a
  // concurrent putRows batch) genuinely overlap in wall-clock time — without
  // it a fast synchronous fake could finish one send() before a second ever
  // starts, and a concurrency pin could never observe more than one in flight.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 1));

  const storeKeyFor = (item) => `${item[names.pk]}|${item[names.sk]}`;
  const storeKeyForKey = (key) => `${key[names.pk]}|${key[names.sk]}`;

  function applyFilterClause(items, clause, values) {
    // Real DynamoDB rejects any FilterExpression that references a key
    // attribute, and the live table enforced it where this fake once did
    // not — a meta-row filter on #sk passed every test and 503ed in
    // production. The fake now refuses the same way the service does.
    if (clause.includes("#sk") || clause.includes("#pk")) {
      throw new Error(`Filter Expression can only contain non-primary key attributes: "${clause}"`);
    }
    if (clause === "attribute_not_exists(#deletedAt)") {
      return items.filter((item) => item[names.deletedAt] === undefined);
    }
    throw new Error(`fake dynamo document client: unrecognized filter clause "${clause}"`);
  }

  function handleQuery(input) {
    const { KeyConditionExpression, FilterExpression, ExpressionAttributeValues, ExclusiveStartKey } = input;
    const values = ExpressionAttributeValues || {};
    let matches = [...store.values()].filter((item) => item[names.pk] === values[":pk"]);
    if (KeyConditionExpression.includes("begins_with(#sk, :skPrefix)")) {
      const prefix = values[":skPrefix"];
      matches = matches.filter((item) => String(item[names.sk]).startsWith(prefix));
    } else if (KeyConditionExpression !== "#pk = :pk") {
      throw new Error(`fake dynamo document client: unrecognized key condition "${KeyConditionExpression}"`);
    }
    if (FilterExpression) {
      for (const clause of FilterExpression.split(" AND ")) matches = applyFilterClause(matches, clause.trim(), values);
    }
    matches.sort((a, b) => (a[names.sk] < b[names.sk] ? -1 : a[names.sk] > b[names.sk] ? 1 : 0));

    const startIndex = ExclusiveStartKey ? ExclusiveStartKey.__cursor : 0;
    const page = matches.slice(startIndex, startIndex + queryPageSize);
    const nextIndex = startIndex + queryPageSize;
    return {
      Items: page.map((item) => ({ ...item })),
      LastEvaluatedKey: nextIndex < matches.length ? { __cursor: nextIndex } : undefined,
    };
  }

  function handlePut(input) {
    const item = { ...input.Item };
    store.set(storeKeyFor(item), item);
    return {};
  }

  function handleDelete(input) {
    store.delete(storeKeyForKey(input.Key));
    return {};
  }

  function handleGet(input) {
    const item = store.get(storeKeyForKey(input.Key));
    return { Item: item ? { ...item } : undefined };
  }

  function handleUpdate(input) {
    const key = storeKeyForKey(input.Key);
    const existing = store.get(key);
    if (!existing) return {};
    const match = input.UpdateExpression.match(UPDATE_SET_EXPRESSION);
    if (!match) throw new Error(`fake dynamo document client: unrecognized update expression "${input.UpdateExpression}"`);
    const [, nameAlias, valueAlias] = match;
    const attr = input.ExpressionAttributeNames[nameAlias];
    const value = input.ExpressionAttributeValues[valueAlias];
    store.set(key, { ...existing, [attr]: value });
    return {};
  }

  return {
    store,
    calls,
    get maxInFlight() { return maxInFlight; },
    async send(command) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await settle();
        calls.push(command);
        if (command instanceof QueryCommand) return handleQuery(command.input);
        if (command instanceof PutCommand) return handlePut(command.input);
        if (command instanceof DeleteCommand) return handleDelete(command.input);
        if (command instanceof GetCommand) return handleGet(command.input);
        if (command instanceof UpdateCommand) return handleUpdate(command.input);
        throw new Error(`fake dynamo document client: unsupported command ${command?.constructor?.name}`);
      } finally {
        inFlight--;
      }
    },
  };
}
