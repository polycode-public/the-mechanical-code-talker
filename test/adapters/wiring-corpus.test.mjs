// W5 seam tests — corpus on-demand, LOCAL tier only, behind TMCT_CORPUS_LOOKUP=1
// (ROADMAP Phase 4). Default OFF: without the flag every miss is byte-unchanged.
// Flag ON: an unknown-term miss gains a grounded, licence-cited aside from the
// committed ConceptNet slice; a term the corpus doesn't know stays an honest
// miss (which is also the documented tier-3 network seam — NOT in this wave).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn, CORPUS_LOOKUP_FLAG } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

// FEATURE B (0.9.x): every runAsk-composed answer now carries an ALWAYS-ON
// trailing "\n\nGoal (inferred): …" line (chat.mjs's withGoalLine), including
// on a meta-shaped MISS (deduceGoalFromParsed reads envelope.parsed, which
// stands — shape:"meta" — even when the term itself misses), optionally
// followed by a "\n\nCanonical: …" line (withCanonicalLine, also set for a
// meta-shaped miss) — orthogonal to this suite's own corpus-aside licence
// citation, so both are stripped (Canonical first, since it trails Goal when
// both are present) before the end-anchored assertions below.
const GOAL_LINE_RE = /\n\nGoal \(inferred\):[^\n]*$/;
const CANONICAL_LINE_RE = /\n\nCanonical:[^\n]*$/;
const noGoal = (s) => String(s).replace(CANONICAL_LINE_RE, "").replace(GOAL_LINE_RE, "");

test("corpus lookup: flag OFF (default) — the miss is byte-unchanged, no corpus consulted", async () => {
  const off = await runTurn("what is a cache", { config: CONFIG, env: {} });
  const bare = await runTurn("what is a cache", { config: CONFIG });
  assert.equal(off.answer.includes("the corpus knows"), false);
  assert.equal(off.record.miss, true);
  assert.equal(off.record.via, "composed");
  // process.env carries no flag in the suite → the default path is identical
  assert.equal(off.answer, bare.answer);
  clearCache();
});

test("corpus lookup: flag ON — an unknown-term miss appends the grounded aside, licence cited", async () => {
  const { answer, record } = await runTurn("what is a cache", {
    config: CONFIG, env: { [CORPUS_LOOKUP_FLAG]: "1" },
  });
  assert.match(answer, /isn't a term in this graph's own vocabulary/,
    "the honest miss still leads — the aside is context, not an answer");
  assert.match(answer, /\nthe corpus knows: a cache is a kind of \w+/);
  assert.match(noGoal(answer), /\(ConceptNet, CC-BY-SA\)$/, "licence + source cited");
  assert.equal(record.via, "corpus");
  assert.equal(record.miss, true, "still recorded as the miss it honestly is");
  clearCache();
});

test("corpus lookup: flag ON — a term unknown everywhere stays the plain honest miss", async () => {
  const on = await runTurn("what is a flurbnix", { config: CONFIG, env: { [CORPUS_LOOKUP_FLAG]: "1" } });
  const off = await runTurn("what is a flurbnix", { config: CONFIG, env: {} });
  assert.equal(on.answer, off.answer, "no corpus hit → byte-identical honest miss");
  assert.equal(on.record.via, "composed");
  assert.equal(on.record.miss, true);
  clearCache();
});

test("corpus lookup: flag ON — a RESOLVED answer never grows an aside (misses only)", async () => {
  const { answer, record } = await runTurn("which modules import a.mjs", {
    config: CONFIG, env: { [CORPUS_LOOKUP_FLAG]: "1" },
  });
  assert.equal(answer.includes("the corpus knows"), false);
  assert.equal(record.via, "composed");
  assert.equal(record.miss, false);
  clearCache();
});
