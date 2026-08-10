# The row service

A same-origin HTTP surface over a §3.1 row backend (see `PLAN_MEMORY_BACKEND.md`, §3.8, for the
full design). `handler.mjs` holds the routing, validation, and caps, and never touches storage
directly — it calls a backend and a small counters seam it's handed.

## Running it locally

`local.mjs` mounts the same handler over the in-memory reference backend instead of DynamoDB:

```js
import { createLocalRowService } from "./local.mjs";

const service = await createLocalRowService();
// service.url is the base address, e.g. http://127.0.0.1:54321
await fetch(`${service.url}/api/sessions/<a-v4-uuid>/rows`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ puts: [{ rowKey: "fact:1@src:1", rowClass: "fact", term: "x", json: "{}" }] }),
});
await service.close();
```

`createLocalRowService` takes `tableRowCap`, `ttlDays`, and `mutationRateLimit` overrides so a
test can shrink the defaults rather than waiting them out, and exposes `reconcile()` — the
in-process analogue of the daily EventBridge reconcile, a physical recount that rewrites the
global row counter.

## Env vars (the deployed Lambda)

- `TABLE_NAME` — the DynamoDB table the row service and its counters share.
- `TTL_DAYS` — default 7. Converted to seconds and stamped on every row this service writes.
- `TABLE_ROW_CAP` — default 2,000,000. The hard global cap the counter enforces.

## What deploys it

`npm run build:row-service` bundles `handler.mjs` (the AWS SDK stays external — the Lambda
runtime ships it). The infra stack wires the bundle to a function URL behind the site's own
CloudFront distribution at `/api/*`, plus a daily EventBridge rule invoking the same function
with a `{"mode":"reconcile"}` input.
