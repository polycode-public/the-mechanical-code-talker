// The ratchet for import-layers.test.mjs: every layer violation that existed
// when the checker landed, verbatim as the checker reports it. The test fails
// on any violation missing from this list AND on any entry the checker no
// longer observes, so the list can only ever shrink. Fixing an edge means
// deleting its line here in the same change; never add a line.

export const ALLOWED_VIOLATIONS = [
  "src/services/chat.mjs -> src/tools/server.mjs",
  "src/domain/codegraph.mjs -> src/adapters/embed.mjs",
  "src/domain/completions/complete.mjs -> src/services/finish.mjs",
  "src/domain/completions/complete.mjs -> src/adapters/memory/core.mjs",
  "src/domain/completions/graph-adapter.mjs -> src/adapters/memory/core.mjs",
  "src/domain/completions/graph-adapter.mjs -> src/adapters/providers/graph-service.mjs",
  "src/domain/completions/group.mjs -> src/adapters/memory/blocks.mjs",
  "src/domain/completions/infer.mjs -> src/adapters/memory/blocks.mjs",
  "src/domain/completions/infer.mjs -> src/adapters/memory/core.mjs",
  "src/domain/completions/rank.mjs -> src/adapters/memory/blocks.mjs",
  "src/domain/completions/search.mjs -> src/adapters/memory/blocks.mjs",
  "src/services/index.mjs -> src/tools/server.mjs",
  "src/adapters/memory/blocks.mjs -> src/domain/memory/trust.mjs",
  "src/adapters/memory/core.mjs -> src/domain/hash.mjs",
  "src/adapters/memory/core.mjs -> src/domain/memory/trust.mjs",
  "src/adapters/providers/bootstrap.mjs -> src/domain/codegraph.mjs",
  "src/adapters/providers/fixture.mjs -> src/domain/codegraph.mjs",
  "src/adapters/providers/graph-service.mjs -> src/domain/codegraph.mjs",
  "src/adapters/wink-model.mjs calls require()",
];
