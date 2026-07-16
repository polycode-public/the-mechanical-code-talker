// The ratchet for import-layers.test.mjs: every layer violation that existed
// when the checker landed, verbatim as the checker reports it. The test fails
// on any violation missing from this list AND on any entry the checker no
// longer observes, so the list can only ever shrink. Fixing an edge means
// deleting its line here in the same change; never add a line.

export const ALLOWED_VIOLATIONS = [
  // Services reaching up for tool dispatch. Still open work.
  "src/services/chat.mjs -> src/tools/server.mjs",
  "src/services/index.mjs -> src/tools/server.mjs",

  // Not open work — this one is answered, and the answer is that createRequire stays.
  // loadWinkModel() is synchronous under parseQueryFull(), an exported sync domain API, so an
  // async loader ripples through domain/, services/, tools/ and bin/. Top-level await would
  // keep callers sync, but the ledger bundle builds `iife`, which esbuild rejects TLA in. And
  // `await import("wink-nlp")` pulls wink INTO that bundle: measured at 4,013,990 bytes against
  // the bundle's own 477,206 — createRequire is exactly what keeps it out, and
  // build-ask-bundle.mjs stubs it as a thrower on purpose. Renaming the local so the checker's
  // /\brequire\s*\(/ stops matching would dodge the rule while still being a CJS require.
  "src/adapters/wink-model.mjs calls require()",
];
