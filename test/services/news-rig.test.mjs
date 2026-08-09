// The news measurement rig (scripts/news-rig.mjs): running the full service
// loop (poll -> ingest -> rank -> enrich -> build) against the committed
// fixtures produces internally consistent arithmetic, and running it twice
// against the same fixed clock produces byte-identical results — the rig's
// own claim to determinism, checked rather than assumed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runNewsRig } from "../../scripts/news-rig.mjs";

test("running the rig twice against the same fixed clock returns byte-identical results", async () => {
  const first = await runNewsRig();
  const second = await runNewsRig();
  assert.deepEqual(first, second);
});

test("the headline grounding rate is the per-source counts folded into one weighted rate", async () => {
  const result = await runNewsRig();
  const totalSentences = result.perSource.reduce((sum, s) => sum + s.sentences, 0);
  const totalRecognized = result.perSource.reduce((sum, s) => sum + s.recognized, 0);
  const totalOptimistic = result.perSource.reduce((sum, s) => sum + s.optimisticCount, 0);
  assert.equal(result.headline.sentences, totalSentences);
  assert.equal(result.headline.recognized, totalRecognized);
  assert.equal(result.headline.optimisticCount, totalOptimistic);
  assert.equal(result.headline.groundedRateStrict, totalSentences > 0 ? totalRecognized / totalSentences : 0);
  assert.equal(
    result.headline.groundedRateOptimistic,
    totalSentences > 0 ? (totalRecognized + totalOptimistic) / totalSentences : 0,
  );
});

test("both grounding-rate columns are published, never merged into one number", async () => {
  const result = await runNewsRig();
  assert.ok(Number.isFinite(result.headline.groundedRateStrict));
  assert.ok(Number.isFinite(result.headline.groundedRateOptimistic));
  assert.ok(
    result.headline.groundedRateOptimistic >= result.headline.groundedRateStrict,
    "the optimistic tier only ever adds recognized sentences on top of the strict tier, never fewer",
  );
});

test("every configured contemporary source produced its own per-source breakdown row", async () => {
  const result = await runNewsRig();
  const sourceIds = result.perSource.map((s) => s.sourceId).sort();
  assert.deepEqual(sourceIds, [...result.config.sources].sort());
});

test("facts synthesised per poll and syllogisms derived per poll match the poll result's own totals", async () => {
  const result = await runNewsRig();
  const perSourceFacts = result.perSource.reduce((sum, s) => sum + s.factsAdded, 0);
  const perSourceDerived = result.perSource.reduce((sum, s) => sum + s.derived, 0);
  assert.equal(result.poll.facts, perSourceFacts);
  assert.equal(result.poll.derived, perSourceDerived);
});

test("the enrichment round never tries more terms than enrichTermsPerCycle allows", async () => {
  const result = await runNewsRig();
  const tried = result.enrich.enriched.length + result.enrich.missed.length;
  assert.ok(tried <= result.config.enrichTermsPerCycle, `tried ${tried}, cap ${result.config.enrichTermsPerCycle}`);
});

test("an enrichment miss and a grounded flip never claim the same term", async () => {
  const result = await runNewsRig();
  const enriched = new Set(result.enrich.enriched);
  const missed = new Set(result.enrich.missed);
  for (const term of enriched) assert.ok(!missed.has(term), `"${term}" cannot be both enriched and missed in the same round`);
});

test("the built feed carries at least one item and never claims the seed fallback once the poll has run", async () => {
  const result = await runNewsRig();
  assert.ok(result.feed.itemCount > 0);
  assert.equal(result.feed.seedFallback, false, "a completed poll leaves news-tagged facts inside the window, so the seed-only fallback never fires");
});
