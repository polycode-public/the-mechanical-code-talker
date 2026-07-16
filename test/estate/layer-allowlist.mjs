// The ratchet for import-layers.test.mjs: every layer violation that existed
// when the checker landed, verbatim as the checker reports it. The test fails
// on any violation missing from this list AND on any entry the checker no
// longer observes, so the list can only ever shrink. Fixing an edge means
// deleting its line here in the same change; never add a line.

export const ALLOWED_VIOLATIONS = [
  "src/services/chat.mjs -> src/tools/server.mjs",
  "src/services/index.mjs -> src/tools/server.mjs",
  "src/adapters/wink-model.mjs calls require()",
];
