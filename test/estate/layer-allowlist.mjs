// The ratchet for import-layers.test.mjs: every layer violation that existed
// when the checker landed, verbatim as the checker reports it. The test fails
// on any violation missing from this list AND on any entry the checker no
// longer observes, so the list can only ever shrink. Fixing an edge means
// deleting its line here in the same change; never add a line.

export const ALLOWED_VIOLATIONS = [
  "src/chat.mjs -> src/server.mjs",
  "src/codegraph.mjs -> src/embed.mjs",
  "src/completions/complete.mjs -> src/finish.mjs",
  "src/completions/complete.mjs -> src/memory/core.mjs",
  "src/completions/graph-adapter.mjs -> src/memory/core.mjs",
  "src/completions/graph-adapter.mjs -> src/providers/graph-service.mjs",
  "src/completions/group.mjs -> src/memory/blocks.mjs",
  "src/completions/infer.mjs -> src/memory/blocks.mjs",
  "src/completions/infer.mjs -> src/memory/core.mjs",
  "src/completions/rank.mjs -> src/memory/blocks.mjs",
  "src/completions/search.mjs -> src/memory/blocks.mjs",
  "src/graph-build.mjs -> src/prose.mjs",
  "src/index.mjs -> src/server.mjs",
  "src/memory/blocks.mjs -> src/memory/trust.mjs",
  "src/memory/core.mjs -> src/hash.mjs",
  "src/memory/core.mjs -> src/memory/shacl.mjs",
  "src/memory/core.mjs -> src/memory/trust.mjs",
  "src/memory/fold.mjs -> src/memory/blocks.mjs",
  "src/memory/fold.mjs -> src/memory/core.mjs",
  "src/memory/fold.mjs -> src/sessions.mjs",
  "src/memory/fold.mjs imports node:fs/promises",
  "src/memory/fold.mjs imports node:path",
  "src/providers/bootstrap.mjs -> src/codegraph.mjs",
  "src/providers/fixture.mjs -> src/codegraph.mjs",
  "src/providers/graph-service.mjs -> src/codegraph.mjs",
  "src/wink-model.mjs calls require()",
];
