// Benchmark-mechanisation harness tests (PLAN_BENCHMARK_MECHANISATION.md levers
// 1, 2, 3, 6): the verdict cache, the tier-promotion matchers, the
// per-construction rubrics + down-tier gate, skip-unchanged execution, and the
// per-rubric-family judge batching. Pure logic only — no live judge call and no
// engine replay is made here; these gate the machinery, the bench measures the
// product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  answerHash, answerText, judgeIdentity, entryValidFor,
  partition, buildCache, mergeJudged, emptyCache,
} from "../../chatbench/verdict-cache.mjs";
import {
  escapeRegex, groundedTokens, distillMatcher, matcherPasses,
  matcherTighterThanJudge, isStablePass, cycleReadings,
  proposePromotions, partitionByPromotion,
} from "../../chatbench/matchers.mjs";
import {
  validateRubrics, familyIndex, familyOf, groupByFamily,
  selectCalibrationSet, verdictBucket, agreementByFamily, gateDownTier, pickModel,
} from "../../chatbench/rubrics.mjs";
import {
  caseInputHash, partitionForReuse, stampReuseFields,
} from "../../chatbench/skip-unchanged.mjs";
import { batchRows, buildBatchPrompt, parseBatchOutput } from "../../chatbench/batch-judge.mjs";
import { validateScores, renderTranscript } from "../../chatbench/judge.mjs";
import { parseCases } from "../../chatbench/run.mjs";

const POOL_FILE = fileURLToPath(new URL("../../chatbench/graded-pool.jsonl", import.meta.url));
const RUBRICS_FILE = fileURLToPath(new URL("../../chatbench/rubrics.json", import.meta.url));

const CTX = { judgeModel: "claude-haiku-4-5-20251001", promptVersion: "judge-prompt-v2" };
const row = (caseId, answer, extra = {}) => ({
  caseId,
  transcript: [{ say: "q", answer, miss: false }],
  judge: { contextVersion: "fixture-context-v3", context: "GRAPH", dimensions: ["groundedness", "correctness", "honesty", "rephrase"] },
  tier1: { pass: true, baselineFailTurns: [], improvedBaselineTurns: [] },
  ...extra,
});

// ---- lever 1: verdict cache ----

test("verdict cache: answer hash is stable and changes only when the answer text changes", () => {
  const a = row("c1", "app/lib/a.mjs imports app/lib/b.mjs");
  assert.equal(answerHash(a), answerHash(row("c1", "app/lib/a.mjs imports app/lib/b.mjs")));
  assert.notEqual(answerHash(a), answerHash(row("c1", "app/lib/a.mjs imports app/lib/c.mjs")));
  assert.equal(answerText(a), "app/lib/a.mjs imports app/lib/b.mjs");
});

test("verdict cache: an entry is inheritable only when hash AND judge identity all match", () => {
  const r = row("c1", "two modules");
  const entry = { answerHash: answerHash(r), ...judgeIdentity(r, CTX), judged: [] };
  assert.ok(entryValidFor(entry, r, CTX));
  // changed answer invalidates
  assert.ok(!entryValidFor(entry, row("c1", "three modules"), CTX));
  // changed prompt version invalidates (a re-baseline, not comparable)
  assert.ok(!entryValidFor(entry, r, { ...CTX, promptVersion: "judge-prompt-v3" }));
  // changed model invalidates
  assert.ok(!entryValidFor(entry, r, { ...CTX, judgeModel: "other" }));
  // changed context grain invalidates
  const r2 = row("c1", "two modules");
  r2.judge.contextVersion = "fixture-context-v4";
  assert.ok(!entryValidFor(entry, r2, CTX));
});

test("verdict cache: partition sends changed cases fresh and inherits unchanged ones", () => {
  const rows = [row("a", "ans a"), row("b", "ans b")];
  const fresh = rows.map((r) => ({ caseId: r.caseId, sample: 1, void: false, scores: { groundedness: 2 }, rationale: "ok" }));
  const cache = buildCache(rows, fresh, new Map(), CTX);
  // unchanged run inherits everything
  const p1 = partition(rows, cache, CTX);
  assert.deepEqual(p1.counts, { total: 2, fresh: 0, inherited: 2 });
  assert.deepEqual(p1.inherited.get("a")[0].caseId, "a");
  // edit case a -> only a is fresh
  const edited = [row("a", "ans a EDITED"), row("b", "ans b")];
  const p2 = partition(edited, cache, CTX);
  assert.deepEqual(p2.counts, { total: 2, fresh: 1, inherited: 1 });
  assert.deepEqual(p2.fresh.map((r) => r.caseId), ["a"]);
});

test("verdict cache: buildCache carries inherited entries forward, refreshes judged ones, drops verdict-less rows, sorts keys", () => {
  const rows = [row("z", "z ans"), row("a", "a ans"), row("m", "m ans")];
  const prior = buildCache([row("z", "z ans")], [{ caseId: "z", sample: 1, void: false, scores: { groundedness: 1 }, rationale: "prior" }], new Map(), CTX);
  const fresh = [{ caseId: "a", sample: 1, void: false, scores: { groundedness: 2 }, rationale: "new" }];
  const inherited = new Map([["z", prior.entries.z.judged.map((j) => ({ ...j, caseId: "z" }))]]);
  const next = buildCache(rows, fresh, inherited, CTX, prior);
  assert.deepEqual(Object.keys(next.entries), ["a", "z"]); // sorted; "m" had no verdict so it is dropped
  assert.equal(next.entries.z.judged[0].rationale, "prior"); // inherited carried forward
  assert.equal(next.entries.a.judged[0].rationale, "new");
});

test("verdict cache: mergeJudged folds fresh + inherited into one id-sorted set", () => {
  const merged = mergeJudged(
    [{ caseId: "b", sample: 1 }],
    new Map([["a", [{ caseId: "a", sample: 2 }, { caseId: "a", sample: 1 }]]]),
  );
  assert.deepEqual(merged.map((m) => `${m.caseId}#${m.sample}`), ["a#1", "a#2", "b#1"]);
});

test("verdict cache: emptyCache partitions everything fresh (a missing cache means judge everything)", () => {
  const rows = [row("a", "x")];
  const p = partition(rows, emptyCache(), CTX);
  assert.deepEqual(p.counts, { total: 1, fresh: 1, inherited: 0 });
});

// ---- lever 2: tier-promotion matchers ----

test("matchers: escapeRegex neutralises every regex metacharacter", () => {
  assert.equal(escapeRegex("a.b*c+"), "a\\.b\\*c\\+");
  assert.ok(new RegExp(escapeRegex("mod:app/lib/a.mjs")).test("mod:app/lib/a.mjs"));
  assert.ok(!new RegExp(escapeRegex("a.c")).test("axc")); // the dot is literal, not a wildcard
});

test("matchers: groundedTokens lifts graph ids, paths, provenance and counts, de-duplicated", () => {
  const toks = groundedTokens("app/lib/a.mjs (id mod:app/lib/a.mjs) touched by 2 commit(s): git:abc1234, app/lib/a.mjs");
  assert.ok(toks.includes("git:abc1234"));
  assert.ok(toks.includes("mod:app/lib/a.mjs"));
  assert.ok(toks.includes("app/lib/a.mjs"));
  assert.ok(toks.includes("2"));
  assert.equal(toks.filter((t) => t === "app/lib/a.mjs").length, 1); // de-duplicated
});

test("matchers: distillMatcher returns a tight matcher for a grounded answer, null for a miss or a tokenless answer", () => {
  const grounded = row("c1", "Widget.render (id m-render) calls fnAlpha (id fn-alpha)");
  const m = distillMatcher(grounded);
  assert.equal(m.miss, false);
  assert.ok(m.answerMatch.length >= 2);
  assert.ok(matcherPasses(m, grounded));
  assert.ok(matcherTighterThanJudge(m, grounded));
  // a miss turn is not a positive-matcher candidate
  const missRow = { ...row("c2", "I answer questions about code"), transcript: [{ say: "q", answer: "no idea", miss: true }] };
  assert.equal(distillMatcher(missRow), null);
  // no distinctive grounded token -> null (leave it to the judge)
  assert.equal(distillMatcher(row("c3", "yes it does indeed")), null);
});

test("matchers: matcherPasses requires every grounded token present and the miss gate to hold", () => {
  const src = row("c1", "the count is 3 over mod:app/lib/a.mjs");
  const m = distillMatcher(src);
  assert.ok(matcherPasses(m, src));
  assert.ok(!matcherPasses(m, row("c1", "the count is 3"))); // missing the id token
  const missVariant = { ...src, transcript: [{ say: "q", answer: "the count is 3 over mod:app/lib/a.mjs", miss: true }] };
  assert.ok(!matcherPasses(m, missVariant)); // miss gate fails
});

test("matchers: the tighter-than-the-judge invariant rejects an empty or wildcard matcher", () => {
  const src = row("c1", "mod:app/lib/a.mjs");
  assert.ok(!matcherTighterThanJudge({ miss: false, answerMatch: [] }, src)); // empty
  assert.ok(!matcherTighterThanJudge({ miss: false, answerMatch: [".*"] }, src)); // an un-escaped wildcard is not tight
});

test("matchers: isStablePass needs a two-cycle pass with identical answer wording", () => {
  const passing = { tier1Pass: true, hardFail: false, mean: 1.8, answerHash: "h1" };
  assert.ok(isStablePass(passing, { ...passing }));
  assert.ok(!isStablePass(passing, { ...passing, answerHash: "h2" })); // wording moved
  assert.ok(!isStablePass(passing, { ...passing, hardFail: true }));
  assert.ok(!isStablePass(passing, { ...passing, mean: 1.0 })); // below floor
  assert.ok(!isStablePass(passing, { ...passing, tier1Pass: false }));
});

test("matchers: proposePromotions emits tight matchers for stable passes and partitionByPromotion routes appeals to the judge", () => {
  const rows = [row("a", "calls fnAlpha (id fn-alpha)"), row("b", "no tokens here")];
  const summary = { perCase: [{ caseId: "a", mean: 1.9, hardFail: false }, { caseId: "b", mean: 1.9, hardFail: false }] };
  const rA = cycleReadings(summary, rows, answerHash);
  const rB = cycleReadings(summary, rows, answerHash);
  const proposals = proposePromotions(rA, rB);
  assert.deepEqual(proposals.map((p) => p.caseId), ["a"]); // b has no distinctive token
  const promoted = new Map(proposals.map((p) => [p.caseId, p.matcher]));
  // a promoted case whose matcher still passes skips the judge; a regressed one appeals
  const part = partitionByPromotion([rows[0], row("a", "no longer grounded")], promoted);
  assert.deepEqual(part.deterministic.map((r) => r.caseId), ["a"]);
  assert.deepEqual(part.appeals, ["a"]);
});

// ---- lever 3: rubrics + down-tier gate ----

test("rubrics: the committed rubrics.json validates (no family claims a construction twice)", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  assert.deepEqual(validateRubrics(rubrics), []);
});

test("rubrics: every pool construction maps to a rubric family", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const index = familyIndex(rubrics);
  const { cases } = parseCases(await readFile(POOL_FILE, "utf8"));
  for (const c of cases.filter((x) => x.construction)) {
    assert.ok(familyOf(c.construction, index), `${c.construction} maps to a family`);
    assert.ok(rubrics.families[familyOf(c.construction, index)], `${c.construction} -> known family`);
  }
});

test("rubrics: familyOf maps singles, drops noise from combos, and reads a two-construction combo as composition", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const index = familyIndex(rubrics);
  assert.equal(familyOf("naming-vocabulary", index), "vocabulary");
  assert.equal(familyOf("noise+svo-query", index), "factoid"); // noise dropped
  assert.equal(familyOf("noise", index), "surface-noise");
  assert.equal(familyOf("pronoun-binding+negation", index), "composition"); // two real parts
});

test("rubrics: selectCalibrationSet is deterministic and caps per family", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const index = familyIndex(rubrics);
  const { cases } = parseCases(await readFile(POOL_FILE, "utf8"));
  const a = selectCalibrationSet(cases, index, { perFamily: 4, seed: 7 });
  const b = selectCalibrationSet(cases, index, { perFamily: 4, seed: 7 });
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id)); // deterministic
  const byFamily = groupByFamily(a, index);
  for (const list of byFamily.values()) assert.ok(list.length <= 4, "per-family cap holds");
  assert.notDeepEqual(a.map((c) => c.id), selectCalibrationSet(cases, index, { perFamily: 4, seed: 8 }).map((c) => c.id));
});

test("rubrics: verdictBucket + agreementByFamily + gateDownTier gate a family only above threshold and case floor", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const index = familyIndex(rubrics);
  assert.equal(verdictBucket({ mean: 1.8, hardFail: false }), "pass");
  assert.equal(verdictBucket({ mean: 1.0, hardFail: false }), "fail");
  assert.equal(verdictBucket({ mean: 2, hardFail: true }), "fail");
  assert.equal(verdictBucket({ mean: null }), null);
  const calib = [
    { caseId: "v1", construction: "naming-vocabulary" },
    { caseId: "v2", construction: "naming-vocabulary" },
    { caseId: "v3", construction: "naming-vocabulary" },
    { caseId: "s1", construction: "svo-query" },
  ];
  const frontier = new Map([["v1", { mean: 2, hardFail: false }], ["v2", { mean: 2, hardFail: false }], ["v3", { mean: 0, hardFail: true }], ["s1", { mean: 2, hardFail: false }]]);
  const small = new Map([["v1", { mean: 2, hardFail: false }], ["v2", { mean: 2, hardFail: false }], ["v3", { mean: 0, hardFail: true }], ["s1", { mean: 0.5, hardFail: false }]]);
  const agreement = agreementByFamily(calib, frontier, small, index);
  assert.equal(agreement.vocabulary.rate, 1); // 3/3 agree
  const gate = gateDownTier(agreement, { threshold: 0.9, minCases: 3 });
  assert.equal(gate.vocabulary.downTier, true);
  assert.equal(gate.factoid.downTier, false); // only 1 calibration case (< minCases)
  // model pick follows the gate
  const opts = { frontierModel: "big", smallModel: "small" };
  assert.equal(pickModel({ construction: "naming-vocabulary" }, gate, index, opts), "small");
  assert.equal(pickModel({ construction: "svo-query" }, gate, index, opts), "big");
});

// ---- lever 6: skip-unchanged + batching ----

test("skip-unchanged: caseInputHash covers turns, mode, graph and env, and is stable otherwise", () => {
  const c = { id: "x", mode: "turns", turns: [{ say: "hi" }] };
  assert.equal(caseInputHash(c), caseInputHash({ id: "x", mode: "turns", turns: [{ say: "hi" }], note: "ignored" }));
  assert.notEqual(caseInputHash(c), caseInputHash({ id: "x", mode: "turns", turns: [{ say: "bye" }] }));
  assert.notEqual(caseInputHash(c), caseInputHash({ id: "x", mode: "session", graph: "empty", turns: [{ say: "hi" }] }));
});

test("skip-unchanged: reuse is engine-token gated — no token reuses nothing, a token mismatch or input change forces a replay", () => {
  const cases = [{ id: "a", mode: "turns", turns: [{ say: "q" }] }, { id: "b", mode: "turns", turns: [{ say: "q" }] }];
  const prior = [
    stampReuseFields({ caseId: "a", ok: 1 }, cases[0], "ENG1"),
    stampReuseFields({ caseId: "b", ok: 1 }, cases[1], "ENG1"),
  ];
  assert.equal(partitionForReuse(cases, prior, null).counts.reused, 0); // no token
  assert.equal(partitionForReuse(cases, prior, "ENG1").counts.reused, 2); // token + input match
  assert.equal(partitionForReuse(cases, prior, "ENG2").counts.reused, 0); // token mismatch
  const edited = [{ id: "a", mode: "turns", turns: [{ say: "CHANGED" }] }, cases[1]];
  assert.equal(partitionForReuse(edited, prior, "ENG1").counts.reused, 1); // a changed -> replay a, reuse b
});

test("batch-judge: batchRows groups by rubric family and splits by size deterministically", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const index = familyIndex(rubrics);
  const rows = [
    { caseId: "n2", construction: "naming-vocabulary" },
    { caseId: "n1", construction: "naming-vocabulary" },
    { caseId: "n3", construction: "naming-vocabulary" },
    { caseId: "s1", construction: "svo-query" },
  ];
  const batches = batchRows(rows, index, { size: 2 });
  // vocabulary (3 cases -> 2 batches) + factoid (1 case) = 3 batches; vocabulary batch is id-sorted
  assert.equal(batches.length, 3);
  assert.equal(batches[0].family, "factoid");
  assert.deepEqual(batches[1].rows.map((r) => r.caseId), ["n1", "n2"]);
  assert.deepEqual(batches[2].rows.map((r) => r.caseId), ["n3"]);
});

test("batch-judge: buildBatchPrompt carries the family criteria, dimensions and every case id", async () => {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const batch = { family: "vocabulary", rows: [
    { caseId: "n1", tags: ["graded"], transcript: [{ say: "what does defines mean", answer: "defines is a predicate" }] },
  ] };
  const prompt = buildBatchPrompt(batch, { rubric: rubrics.families.vocabulary, context: "GRAPH CONTEXT", renderTranscript });
  assert.ok(prompt.includes("n1"));
  assert.ok(prompt.includes("groundedness"));
  assert.ok(prompt.includes(rubrics.families.vocabulary.criteria[0]));
  assert.ok(prompt.includes("GRAPH CONTEXT"));
});

test("batch-judge: parseBatchOutput validates each verdict and flags unexpected or missing ids", () => {
  const arr = [
    { caseId: "a", groundedness: 2, correctness: 2, honesty: null, rephrase: null, rationale: "ok" },
    { caseId: "z", groundedness: 2, correctness: 2, honesty: null, rephrase: null, rationale: "stray" },
    { caseId: "b", groundedness: 5, correctness: 2, honesty: null, rephrase: null, rationale: "bad score" },
  ];
  const { verdicts, errors } = parseBatchOutput(JSON.stringify(arr), ["a", "b"], validateScores);
  assert.deepEqual([...verdicts.keys()], ["a"]); // a is valid; b is out of range; z is unexpected
  assert.ok(errors.some((e) => e.includes("z"))); // unexpected id flagged
  assert.ok(errors.some((e) => e.startsWith("b:"))); // invalid verdict flagged
  assert.deepEqual(parseBatchOutput("not json", ["a"], validateScores).verdicts.size, 0);
});
