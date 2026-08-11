// test/helpers/fake-corpus-document-client.mjs — a document client over an
// in-memory Map for the corpus-bands surface (corpus-bands.mjs,
// corpus-loader.mjs): the `.put`/`.get`/`.delete`/`.query` convenience-client
// shape `termQueryOverDocumentClient` (subgraph-retrieval.mjs) also reads, so
// one fake serves both the loader's tests and the band helper's tests. Not
// an emulator — it understands exactly the two Query shapes this surface
// sends (plain pk equality, and pk equality plus `begins_with(sk, …)`), the
// same deliberate narrowness as fake-dynamo-document-client.mjs.
export function createFakeCorpusDocumentClient() {
  const store = new Map();
  const storeKey = (pk, sk) => `${pk}|${sk}`;
  return {
    store,
    calls: [],
    async put({ Item }) {
      this.calls.push({ op: "put", Item });
      store.set(storeKey(Item.pk, Item.sk), { ...Item });
      return {};
    },
    async get({ Key }) {
      this.calls.push({ op: "get", Key });
      const item = store.get(storeKey(Key.pk, Key.sk));
      return { Item: item ? { ...item } : undefined };
    },
    async delete({ Key }) {
      this.calls.push({ op: "delete", Key });
      store.delete(storeKey(Key.pk, Key.sk));
      return {};
    },
    async query({ KeyConditionExpression, ExpressionAttributeValues, Limit, ExclusiveStartKey }) {
      this.calls.push({ op: "query", KeyConditionExpression });
      const pk = ExpressionAttributeValues[":pk"];
      let matches = [...store.values()].filter((item) => item.pk === pk);
      if (KeyConditionExpression.includes("begins_with")) {
        const prefix = ExpressionAttributeValues[":sk"];
        matches = matches.filter((item) => item.sk.startsWith(prefix));
      } else if (KeyConditionExpression !== "pk = :pk") {
        throw new Error(`fake corpus document client: unrecognized key condition "${KeyConditionExpression}"`);
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

/** A client wrapper that throws on the Nth `put` call — one shot, so a
 *  retried run after the failure proceeds normally. */
export function poisonPutCall(client, failOnCallNumber) {
  let putCount = 0;
  return {
    ...client,
    async put(params) {
      putCount += 1;
      if (putCount === failOnCallNumber) throw new Error("simulated mid-load death");
      return client.put(params);
    },
  };
}

/** A client wrapper whose every `put` call fails `failCount` times with an
 *  error named `errorName` before finally succeeding — a transient store
 *  outage that clears on its own, the shape the loader's retry logic exists
 *  for. Each call counts its own failures independently, matching a real
 *  store where different rows land on different partitions. */
export function flakyPutCall(client, failCount, errorName = "InternalServerError") {
  const failuresLeftByKey = new Map();
  return {
    ...client,
    async put(params) {
      const key = `${params.Item.pk}|${params.Item.sk}`;
      const failuresLeft = failuresLeftByKey.get(key) ?? failCount;
      if (failuresLeft > 0) {
        failuresLeftByKey.set(key, failuresLeft - 1);
        throw Object.assign(new Error(`simulated ${errorName}`), { name: errorName });
      }
      return client.put(params);
    },
  };
}

/** A client wrapper whose every `put` call fails every time with an error
 *  named `errorName` — a store outage that never clears, so the loader's
 *  retry budget runs out. */
export function alwaysFailingPutCall(client, errorName = "InternalServerError") {
  return {
    ...client,
    async put() {
      throw Object.assign(new Error(`simulated ${errorName}`), { name: errorName });
    },
  };
}
