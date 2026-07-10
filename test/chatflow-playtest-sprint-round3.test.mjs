// SKILL_BENCHMARK_CONVERSATION.md capped sprint, round 3 (final round, 2026-07-10) —
// "brilliant" (a UK-English enthusiasm interjection) wasn't in THANKS, so
// "brilliant, that's all I needed" hit the raw grammar wall via item 2's own
// multi-clause scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/chat.mjs";

test("round 3: bare 'brilliant' reads as a thanks-style acknowledgement", async () => {
  const r = await runTurn("brilliant", {});
  assert.match(r.answer, /Any time/);
});
