// The news-bench provenance comparison rule (PLAN_NEWS_FEED_QUALITY.md
// section 4's "digests, not re-runs"): two reports are directly comparable
// exactly when their seed digest, fixture dates, sources and take all
// match — the code that produced them is free to differ, that's the point
// of a lever's before/after pair.
import { test } from "node:test";
import assert from "node:assert/strict";

import { provenanceComparable } from "../../scripts/news-bench/run.mjs";

function provenance(overrides = {}) {
  return {
    seedDigest: "abc123",
    seedRowCount: 61724,
    fixtureDates: { "hacker-news": "2026-08-12", "nyt-world": "2026-08-12" },
    gitHead: "d4673c0759f3ab710c71a499ad9611598a9ca64e",
    sources: ["hacker-news", "nyt-world"],
    take: 5,
    doubleIngest: false,
    ...overrides,
  };
}

test("two reports with identical seed digest, fixture dates, sources and take are comparable", () => {
  const cmp = provenanceComparable(provenance(), provenance({ gitHead: "a-different-commit" }));
  assert.equal(cmp.comparable, true);
  assert.equal(cmp.reason, null);
});

test("a seed digest mismatch is not comparable, and names the drift", () => {
  const cmp = provenanceComparable(provenance(), provenance({ seedDigest: "def456" }));
  assert.equal(cmp.comparable, false);
  assert.match(cmp.reason, /seed digest differs/);
});

test("a fixture-date mismatch is not comparable, and names the drift", () => {
  const cmp = provenanceComparable(
    provenance(),
    provenance({ fixtureDates: { "hacker-news": "2026-08-11", "nyt-world": "2026-08-12" } }),
  );
  assert.equal(cmp.comparable, false);
  assert.match(cmp.reason, /fixture dates differ/);
});

test("a sources mismatch is not comparable, order-independent", () => {
  const same = provenanceComparable(provenance({ sources: ["nyt-world", "hacker-news"] }), provenance());
  assert.equal(same.comparable, true, "source order alone must not count as drift");

  const different = provenanceComparable(provenance(), provenance({ sources: ["hacker-news"] }));
  assert.equal(different.comparable, false);
  assert.match(different.reason, /sources differ/);
});

test("a --take mismatch is not comparable, and names the drift", () => {
  const cmp = provenanceComparable(provenance(), provenance({ take: null }));
  assert.equal(cmp.comparable, false);
  assert.match(cmp.reason, /--take differs/);
});

test("a missing provenance block on either side is not comparable", () => {
  assert.equal(provenanceComparable(null, provenance()).comparable, false);
  assert.equal(provenanceComparable(provenance(), undefined).comparable, false);
});
