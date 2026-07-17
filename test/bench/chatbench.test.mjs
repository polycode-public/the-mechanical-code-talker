// chatbench tests — the measurement harness only, NEVER the measurements:
// cases.jsonl lint, the runner's tier-1 evaluation logic, the judge's prompt
// construction / output parsing / aggregation (via --dry-run pieces and
// injected fakes — NO live claude call is ever made here), and the report
// renderers. The bench itself runs via `npm run chatbench:run` (free) and
// `npm run chatbench:judge` (the only paid step) — deliberately NOT in tests,
// so `npm test` gates the harness, and the bench measures the product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  TAGS, EXPECT_KEYS, JUDGE_DIMENSIONS, FIXTURE_CONTEXT,
  parseCases, evaluateExpect, summarizeTier1, runTurnsCase, runSessionCase,
  compareProducts,
} from "../../chatbench/run.mjs";
import {
  JUDGE_MODEL, PROMPT_VERSION, DIMENSIONS,
  renderTranscript, buildPrompt, validateScores, parseJudgeOutput, maskScores,
  judgeSample, sampleMean, isHardFail, computeSummary, pool,
} from "../../chatbench/judge.mjs";
import {
  renderReport, renderTranscripts, orderDiscriminating,
} from "../../chatbench/report.mjs";
import { runChat } from "../../src/services/chat.mjs";
import { parseSessionJsonl, parseSessionLog, turnKey } from "../../src/services/sessions.mjs";

const POOL_FILE = fileURLToPath(new URL("../../chatbench/graded-pool.jsonl", import.meta.url));
const PROMPT_FILE = fileURLToPath(new URL("../../chatbench/judge-prompt-v1.txt", import.meta.url));
const SCHEMA_FILE = fileURLToPath(new URL("../../chatbench/rubric.schema.json", import.meta.url));

// ---- frozen v1 core lint. The core cases live in graded-pool.jsonl as
// fully-graded cells rather than in a separate ungraded file, and are
// identified here by id: the pool's own ids are "g-*" and the frozen-core
// ids never were. ----

const v1CoreCases = (cases) => cases.filter((c) => !c.id.startsWith("g-"));

test("frozen v1 core (in graded-pool.jsonl): parses clean — unique ids, known tags/expect keys, valid modes", async () => {
  const { cases, errors } = parseCases(await readFile(POOL_FILE, "utf8"));
  assert.deepEqual(errors, [], "lint errors");
  const core = v1CoreCases(cases);
  assert.ok(core.length >= 36 && core.length <= 64, `case count in contract range (got ${core.length})`);
});

test("frozen v1 core (in graded-pool.jsonl): every coverage tag is populated; baselineFail weaknesses are documented", async () => {
  const { cases: allCases } = parseCases(await readFile(POOL_FILE, "utf8"));
  const cases = v1CoreCases(allCases);
  const byTag = new Map(TAGS.map((t) => [t, 0]));
  // every core case now also carries "graded" (case-set v3) so it validates
  // as a pool member; that's an EXTRA_TAG, not part of the v1 coverage
  // registry above, so it's deliberately not counted here.
  for (const c of cases) for (const t of c.tags) if (byTag.has(t)) byTag.set(t, byTag.get(t) + 1);
  for (const [tag, n] of byTag) assert.ok(n >= 2, `tag "${tag}" has at least 2 cases (got ${n})`);
  const baseline = cases.filter((c) => c.turns.some((t) => t.expect?.baselineFail));
  assert.ok(baseline.length >= 5, `documented baseline weaknesses exist (got ${baseline.length})`);
  // memory-recall cases must be session-mode (bare runTurn has no fold-in side-effects)
  for (const c of cases.filter((x) => x.tags.includes("memory-recall"))) {
    assert.equal(c.mode, "session", `${c.id}: memory-recall requires session mode`);
  }
  for (const c of cases.filter((x) => x.tags.includes("bootstrap-empty"))) {
    assert.equal(c.graph, "empty", `${c.id}: bootstrap-empty runs over an empty graph dir`);
  }
});

test("parseCases: lints bad cases — duplicate id, bad tag, bad expect key, focusLabel in session mode", () => {
  const bad = [
    { id: "a", tags: ["graph-query"], mode: "turns", turns: [{ say: "x" }] },
    { id: "a", tags: ["nope"], mode: "turns", turns: [{ say: "x", expect: { bogus: 1 } }] },
    { id: "b", tags: ["memory-recall"], mode: "session", graph: "fixture", turns: [{ say: "x", session: 1, expect: { focusLabel: "y" } }] },
    { id: "c", tags: ["graph-query"], mode: "nope", turns: [] },
  ].map((c) => JSON.stringify(c)).join("\n");
  const { errors } = parseCases(bad);
  assert.ok(errors.some((e) => e.includes("duplicate id a")), errors.join("; "));
  assert.ok(errors.some((e) => e.includes('unknown tag "nope"')));
  assert.ok(errors.some((e) => e.includes('unknown expect key "bogus"')));
  assert.ok(errors.some((e) => e.includes("focusLabel/end are turns-mode")));
  assert.ok(errors.some((e) => e.includes("mode must be one of")));
  assert.ok(errors.some((e) => e.includes("turns must be a non-empty array")));
});

// ---- tier-1 evaluation ----

const OUTCOME = {
  answer: "app/lib/b.mjs and app/lib/c.mjs.",
  miss: false,
  resolvedIds: ["mod-a"],
  answeredIds: ["mod-b", "mod-c"],
  focusLabel: "app/lib/a.mjs",
  end: false,
};

test("evaluateExpect: each check kind passes and fails on the right evidence", () => {
  const pass = evaluateExpect({
    miss: false,
    answerMatch: ["app/lib/b\\.mjs", "c\\.mjs"],
    answerNotMatch: ["zebra"],
    answeredIdsInclude: ["mod-b"],
    resolvedIdsInclude: ["mod-a"],
    focusLabel: "app/lib/a.mjs",
    end: false,
  }, OUTCOME);
  assert.equal(pass.length, 8, "one check per declared expectation (answerMatch contributes two)");
  assert.ok(pass.every((c) => c.pass), JSON.stringify(pass.filter((c) => !c.pass)));

  const fail = evaluateExpect({
    miss: true,
    answerMatch: ["zebra"],
    answerNotMatch: ["b\\.mjs"],
    answeredIdsInclude: ["mod-z"],
    focusLabel: "Widget",
    end: true,
  }, OUTCOME);
  assert.ok(fail.every((c) => !c.pass), "every check fails against contrary evidence");
  const keys = fail.map((c) => c.key);
  assert.deepEqual(keys.sort(), ["answerMatch", "answerNotMatch", "answeredIdsInclude", "end", "focusLabel", "miss"]);
});

test("evaluateExpect: no expect → no checks (a scripted setup turn)", () => {
  assert.deepEqual(evaluateExpect(undefined, OUTCOME), []);
});

test("summarizeTier1: baselineFail turns never fail the case; all-green baselineFail flags improvement", () => {
  const ok = { checks: [{ key: "miss", pass: true }], baselineFail: false };
  const bad = { checks: [{ key: "miss", pass: false, expected: false, actual: true }], baselineFail: false };
  const bfStillBad = { checks: [{ key: "answerMatch", pass: false }], baselineFail: true };
  const bfNowGood = { checks: [{ key: "answerMatch", pass: true }], baselineFail: true };

  const failing = summarizeTier1([ok, bad, bfStillBad]);
  assert.equal(failing.pass, false);
  assert.equal(failing.checksFailed, 1, "the baselineFail turn's failure is not counted");
  assert.deepEqual(failing.baselineFailTurns, [2]);
  assert.deepEqual(failing.improvedBaselineTurns, []);

  const improved = summarizeTier1([ok, bfNowGood]);
  assert.equal(improved.pass, true, "a baselineFail turn passing is an improvement, never a failure");
  assert.deepEqual(improved.improvedBaselineTurns, [1]);
});

test("summarizeTier1: improvedIn ENFORCES a fixed baselineFail turn — a later regression is a real tier-1 failure", () => {
  const fixedStillGood = { checks: [{ key: "answerMatch", pass: true }], baselineFail: true, improvedIn: "002" };
  const fixedRegressed = { checks: [{ key: "answerMatch", pass: false, expected: "x", actual: "y" }], baselineFail: true, improvedIn: "002" };

  const good = summarizeTier1([fixedStillGood]);
  assert.equal(good.pass, true);
  assert.deepEqual(good.baselineFailTurns, [0], "the historical marker stays on the record");
  assert.deepEqual(good.improvedBaselineTurns, [0], "a fixed weakness still reports as improved");

  const regressed = summarizeTier1([fixedRegressed]);
  assert.equal(regressed.pass, false, "a regression on a fixed weakness FAILS the case — never a quietly-lapsed improvement");
  assert.equal(regressed.checksFailed, 1);
  assert.deepEqual(regressed.baselineFailTurns, [0]);
});

test("parseCases: improvedIn lint — string label required, and only alongside baselineFail:true", () => {
  const bad = [
    { id: "a", tags: ["noise"], mode: "turns", turns: [{ say: "x", expect: { miss: true, improvedIn: "002" } }] },
    { id: "b", tags: ["noise"], mode: "turns", turns: [{ say: "x", expect: { miss: true, baselineFail: true, improvedIn: 2 } }] },
    { id: "c", tags: ["noise"], mode: "turns", turns: [{ say: "x", expect: { miss: true, baselineFail: true, improvedIn: "002" } }] },
  ].map((c) => JSON.stringify(c)).join("\n");
  const { errors } = parseCases(bad);
  assert.ok(errors.some((e) => e.startsWith("a turn 1") && e.includes("only annotates a baselineFail:true turn")), errors.join("; "));
  assert.ok(errors.some((e) => e.startsWith("b turn 1") && e.includes("non-empty cycle label string")), errors.join("; "));
  assert.ok(!errors.some((e) => e.startsWith("c turn 1")), `the valid pairing lints clean: ${errors.join("; ")}`);
});

// ---- runner: turns mode (fake runTurn — proves threading + evaluation wiring) ----

test("runTurnsCase: threads focus/last turn-to-turn and stops on end, like runChat's loop", async () => {
  const seen = [];
  const fakeRunTurn = async (input, { focus, last }) => {
    seen.push({ input, focus, last });
    if (input === "one") {
      return {
        answer: "A1", record: { miss: false, resolvedIds: ["x"], answeredIds: ["y"] },
        focus: { id: "x", label: "X" }, last: { query: input, answer: "A1" },
      };
    }
    if (input === "bye") return { answer: "Bye", record: { miss: false, resolvedIds: [], answeredIds: [] }, focus, last, end: true };
    return { answer: "A2", record: { miss: false, resolvedIds: [], answeredIds: [] }, focus, last };
  };
  const caseDef = {
    id: "stub", tags: ["graph-query"], mode: "turns",
    turns: [
      { say: "one", expect: { miss: false, focusLabel: "X", answeredIdsInclude: ["y"] } },
      { say: "two", expect: { focusLabel: "X" } },
      { say: "bye", expect: { end: true } },
      { say: "never reached" },
    ],
  };
  const { transcript, turnEvals } = await runTurnsCase(caseDef, { runTurn: fakeRunTurn, config: {}, graph: {} });
  assert.equal(transcript.length, 3, "the end:true turn stops the case; the 4th line is unread");
  assert.deepEqual(seen[1].focus, { id: "x", label: "X" }, "turn 2 received turn 1's focus");
  assert.equal(seen[1].last.answer, "A1", "turn 2 received turn 1's last");
  assert.equal(transcript[2].end, true);
  const tier1 = summarizeTier1(turnEvals);
  assert.equal(tier1.pass, true, JSON.stringify(tier1.failing));
});

// ---- runner: session mode (REAL runChat over an empty temp dir — offline + fast) ----

test("runSessionCase: drives full runChat in a temp dir, reads answers + records back, evaluates tier-1", async () => {
  const caseDef = {
    id: "stub-session", tags: ["bootstrap-empty"], mode: "session", graph: "empty",
    // Plumbing-only (greeting + a literal module count on an empty repo) — none
    // of it depends on the corpus seed, so opt out of paying that tax.
    env: { TMCT_NO_SEED: "1" },
    turns: [
      { say: "hi", session: 1, expect: { miss: false, answerMatch: ["^Hi\\."] } },
      { say: "how many modules are there", session: 1, expect: { miss: false, answerMatch: ["^0 modules\\.$"] } },
    ],
  };
  const { transcript, turnEvals } = await runSessionCase(caseDef, {
    runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson: "{}",
  });
  assert.equal(transcript.length, 2);
  assert.match(transcript[0].answer, /^Hi\./);
  assert.equal(transcript[1].answer, "0 modules.");
  assert.equal(transcript[0].miss, false);
  const tier1 = summarizeTier1(turnEvals);
  assert.equal(tier1.pass, true, JSON.stringify(tier1.failing));
});

test("runSessionCase: clears the product read cache before EVERY session (H1a bench fidelity — real sessions are separate processes)", async () => {
  // Two sessions in one case: without deps.clearCache() between them, session 2
  // would be served src/adapters/source.mjs's process-cached pre-session payload and
  // never see session 1's graph fold-in (the cycle-1 mr-session-count hard
  // fail). The runner must call it once per session run.
  let cleared = 0;
  const caseDef = {
    id: "stub-two-sessions", tags: ["memory-recall"], mode: "session", graph: "empty",
    // Only asserts the cache-clear counter — no seeded content is checked, so
    // skip the corpus-seed pass on both sessions.
    env: { TMCT_NO_SEED: "1" },
    turns: [
      { say: "hi", session: 1 },
      { say: "hi", session: 2 },
    ],
  };
  const { transcript } = await runSessionCase(caseDef, {
    runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson: "{}",
    clearCache: () => { cleared += 1; },
  });
  assert.equal(transcript.length, 2);
  assert.equal(cleared, 2, "one cache clear per session run");
});

// ---- compare (the regression gate) ----

test("compareProducts: pass→fail is a regression; new cases are reported, never regressions", () => {
  const prior = [
    { caseId: "a", tier1: { pass: true } },
    { caseId: "b", tier1: { pass: false } },
  ];
  const current = [
    { caseId: "a", tier1: { pass: false } },
    { caseId: "b", tier1: { pass: true } },
    { caseId: "c", tier1: { pass: false } },
  ];
  const { regressions, newCases } = compareProducts(prior, current);
  assert.deepEqual(regressions, ["a"], "only pass→fail counts");
  assert.deepEqual(newCases, ["c"]);
});

// ---- judge: prompt construction (--dry-run's substance) ----

const PRODUCT_ROW = {
  caseId: "gq-x", tags: ["graph-query"], mode: "turns", stamp: "t",
  judge: { dimensions: ["groundedness", "correctness"], context: FIXTURE_CONTEXT },
  transcript: [
    { say: "which modules import a.mjs", answer: "app/lib/b.mjs." },
    { say: "why", answer: "(expanding) ..." },
  ],
  tier1: { pass: true, baselineFailTurns: [], improvedBaselineTurns: [], failing: [] },
};

test("buildPrompt: fills every placeholder from the product row — none left unfilled", async () => {
  const template = await readFile(PROMPT_FILE, "utf8");
  for (const ph of ["{{CASE_ID}}", "{{TAGS}}", "{{CONTEXT}}", "{{TRANSCRIPT}}", "{{DIMENSIONS}}"]) {
    assert.ok(template.includes(ph), `template carries ${ph}`);
  }
  const prompt = buildPrompt(PRODUCT_ROW, template);
  assert.ok(!prompt.includes("{{"), "no unfilled placeholders");
  assert.ok(prompt.includes("gq-x"));
  assert.ok(prompt.includes("visitor: which modules import a.mjs"));
  assert.ok(prompt.includes("tmct: app/lib/b.mjs."));
  assert.ok(prompt.includes("Score ONLY these dimensions: groundedness, correctness"));
  assert.ok(prompt.includes("The graph under discussion"));
});

test("renderTranscript: session-mode rows carry session separators", () => {
  const row = {
    mode: "session",
    transcript: [
      { session: 1, say: "q1", answer: "a1" },
      { session: 2, say: "q2", answer: "" },
    ],
  };
  const text = renderTranscript(row);
  assert.match(text, /--- session 1 /);
  assert.match(text, /--- session 2 /);
  assert.match(text, /tmct: \(no answer recorded\)/);
});

// ---- judge: rubric schema + score validation ----

test("rubric.schema.json: parses; its dimensions and bounds agree with the harness validator", async () => {
  const schema = JSON.parse(await readFile(SCHEMA_FILE, "utf8"));
  for (const d of DIMENSIONS) {
    assert.ok(schema.properties[d], `schema documents "${d}"`);
    assert.ok(schema.required.includes(d), `"${d}" is required`);
    const int = schema.properties[d].anyOf.find((x) => x.type === "integer");
    assert.deepEqual([int.minimum, int.maximum], [0, 2]);
  }
  assert.ok(schema.required.includes("rationale"));
  assert.equal(schema.additionalProperties, false);
});

test("validateScores: accepts in-bounds scores with nulls; rejects out-of-bounds/missing/all-null", () => {
  assert.equal(validateScores({ groundedness: 2, correctness: 1, honesty: 0, rephrase: null, rationale: "r" }), null);
  assert.match(validateScores({ groundedness: 3, correctness: 1, honesty: 0, rephrase: null, rationale: "r" }), /groundedness/);
  assert.match(validateScores({ correctness: 1, honesty: 0, rephrase: null, rationale: "r" }), /missing dimension "groundedness"/);
  assert.match(validateScores({ groundedness: null, correctness: null, honesty: null, rephrase: null, rationale: "r" }), /all dimensions null/);
  assert.match(validateScores({ groundedness: 2, correctness: 1, honesty: 0, rephrase: null }), /rationale/);
  assert.match(String(validateScores(null)), /not an object/);
});

test("parseJudgeOutput: probe-verified envelope shapes — structured_output object, string result, is_error", () => {
  const rubric = { groundedness: 2, correctness: 2, honesty: null, rephrase: null, rationale: "ok" };
  // shape A (probe-verified): structured_output carries the parsed object
  const a = parseJudgeOutput(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(rubric), structured_output: rubric }));
  assert.equal(a.error, undefined);
  assert.equal(a.scores.groundedness, 2);
  // shape B: only a stringified result
  const b = parseJudgeOutput(JSON.stringify({ is_error: false, result: JSON.stringify(rubric) }));
  assert.equal(b.scores.correctness, 2);
  assert.equal(b.rationale, "ok");
  // refusal / error envelope → an error (the caller voids the sample)
  assert.match(parseJudgeOutput(JSON.stringify({ is_error: true, result: "refused" })).error, /error/);
  assert.match(parseJudgeOutput("not json").error, /not JSON/);
  assert.match(parseJudgeOutput(JSON.stringify({ is_error: false, result: "plain prose, no json" })).error, /not rubric JSON/);
});

test("maskScores: dimensions outside the case's declared set are nulled (judge overreach guard)", () => {
  const masked = maskScores(
    { groundedness: 2, correctness: 2, honesty: 1, rephrase: 0 },
    ["groundedness", "honesty", "rephrase"],
  );
  assert.deepEqual(masked, { groundedness: 2, correctness: null, honesty: 1, rephrase: 0 });
});

// ---- judge: sampling (injected fake call — retry then void) ----

test("judgeSample: retries once sequentially, then VOIDS — a refusal never scores as fail", async () => {
  const rubric = { groundedness: 1, correctness: 1, honesty: null, rephrase: null, rationale: "r" };
  const good = JSON.stringify({ is_error: false, structured_output: rubric, result: JSON.stringify(rubric) });

  let calls = 0;
  const failThenGood = async () => (++calls === 1 ? { error: "boom" } : { stdout: good });
  const r1 = await judgeSample("p", {}, failThenGood);
  assert.equal(calls, 2, "one sequential retry");
  assert.equal(r1.void, false);
  assert.equal(r1.scores.groundedness, 1);

  const alwaysRefuse = async () => ({ stdout: JSON.stringify({ is_error: true, result: "I refuse" }) });
  const r2 = await judgeSample("p", {}, alwaysRefuse);
  assert.equal(r2.void, true);
  assert.match(r2.reason, /error/);
  assert.equal(r2.scores, null, "a voided sample carries no scores at all");
});

// ---- judge: aggregation ----

test("sampleMean / isHardFail: means skip nulls; hard fail = confidently-wrong or ungrounded consensus", () => {
  assert.equal(sampleMean({ groundedness: 2, correctness: 1, honesty: null, rephrase: null }), 1.5);
  assert.equal(sampleMean({ groundedness: null, correctness: null, honesty: null, rephrase: null }), null);
  assert.equal(isHardFail({ groundedness: 0, correctness: 2, honesty: 2, rephrase: null }), true);
  assert.equal(isHardFail({ groundedness: 2, correctness: 0, honesty: 0, rephrase: null }), true);
  assert.equal(isHardFail({ groundedness: 2, correctness: 0, honesty: 2, rephrase: null }), false, "wrong but honest is not a hard fail");
  assert.equal(isHardFail({ groundedness: 2, correctness: null, honesty: null, rephrase: 2 }), false);
});

test("computeSummary: per-case/per-tag/overall means, voids excluded (never counted as fail), pins recorded", () => {
  const product = [
    { caseId: "a", tags: ["graph-query"], stamp: "s1", tier1: { pass: true, baselineFailTurns: [] } },
    { caseId: "b", tags: ["graph-query", "honesty-miss"], stamp: "s1", tier1: { pass: false, baselineFailTurns: [1] } },
  ];
  const judged = [
    { caseId: "a", sample: 1, void: false, scores: { groundedness: 2, correctness: 2, honesty: null, rephrase: null } },
    { caseId: "a", sample: 2, void: false, scores: { groundedness: 2, correctness: 1, honesty: null, rephrase: null } },
    { caseId: "a", sample: 3, void: true, scores: null },
    { caseId: "b", sample: 1, void: false, scores: { groundedness: 0, correctness: 0, honesty: 0, rephrase: 0 } },
  ];
  const s = computeSummary(product, judged, { samples: 3 });
  assert.equal(s.judgeModel, JUDGE_MODEL);
  assert.equal(s.promptVersion, PROMPT_VERSION);
  assert.equal(s.stamp, "s1");
  const a = s.perCase.find((c) => c.caseId === "a");
  assert.equal(a.mean, 1.75, "mean of sample means (2 + 1.5)/2 — the void sample excluded");
  assert.equal(a.voids, 1);
  assert.equal(a.hardFail, false);
  const b = s.perCase.find((c) => c.caseId === "b");
  assert.equal(b.mean, 0);
  assert.equal(b.hardFail, true);
  assert.equal(b.baselineFail, true);
  assert.equal(s.overall.mean, 0.875);
  assert.equal(s.overall.hardFailCount, 1);
  assert.equal(s.overall.voidCount, 1);
  const gq = s.perTag.find((t) => t.tag === "graph-query");
  assert.equal(gq.cases, 2);
  assert.equal(gq.mean, 0.875);
});

test("pool: bounded concurrency, order-preserving", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await pool([...Array(9).keys()], 3, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [0, 2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(peak <= 3, `peak concurrency ${peak} <= 3`);
});

// ---- report ----

const STUB_SUMMARY = {
  stamp: "s1", judgeModel: JUDGE_MODEL, promptVersion: PROMPT_VERSION, samplesPerCase: 3,
  overall: { cases: 3, mean: 1.4, hardFailCount: 1, voidCount: 0, tier1PassCount: 2 },
  perTag: [
    { tag: "graph-query", cases: 2, mean: 1.6, hardFails: 0 },
    { tag: "honesty-miss", cases: 1, mean: 1.0, hardFails: 1 },
  ],
  perCase: [
    { caseId: "a", tags: ["graph-query"], tier1Pass: true, baselineFail: false, mean: 1.9, dims: {}, samples: 3, voids: 0, hardFail: false },
    { caseId: "b", tags: ["honesty-miss"], tier1Pass: true, baselineFail: false, mean: 1.0, dims: {}, samples: 3, voids: 0, hardFail: true },
    { caseId: "c", tags: ["graph-query"], tier1Pass: false, baselineFail: true, mean: 1.3, dims: {}, samples: 3, voids: 0, hardFail: false },
  ],
};
const STUB_ROWS = [
  { caseId: "a", tags: ["graph-query"], mode: "turns", transcript: [{ say: "q", answer: "x" }], tier1: { pass: true, failing: [], baselineFailTurns: [], improvedBaselineTurns: [] } },
  { caseId: "b", tags: ["honesty-miss"], mode: "turns", transcript: [{ say: "q", answer: "y" }], tier1: { pass: true, failing: [], baselineFailTurns: [], improvedBaselineTurns: [] } },
  { caseId: "c", tags: ["graph-query"], mode: "turns", transcript: [{ say: "q", answer: "z" }], tier1: { pass: false, failing: [{ turn: 0, key: "miss", expected: false, actual: true }], baselineFailTurns: [0], improvedBaselineTurns: [] } },
];

test("renderReport: headline, judge pin, per-tag table, hard fails, lever board + predictions stubs", () => {
  const md = renderReport(STUB_SUMMARY, STUB_ROWS, 2);
  assert.match(md, /^# CEFR_ENGLISH_002 /);
  assert.match(md, /Mean rubric score: 1\.4 \/ 2/);
  assert.match(md, /hard fails: 1/);
  assert.match(md, new RegExp(JUDGE_MODEL));
  assert.match(md, new RegExp(PROMPT_VERSION));
  assert.match(md, /\| graph-query \| 2 \| 1\.6 \| 0 \|/);
  assert.match(md, /## Hard fails \(1\)/);
  assert.match(md, /\*\*b\*\* \(honesty-miss\)/);
  assert.match(md, /## Tier-1 failures \(1\)/);
  assert.match(md, /## Predictions vs actuals/);
  assert.match(md, /RANKED LEVER BOARD/);
  assert.match(md, /## Top discriminating transcripts/);
  assert.match(md, /vs CEFR_ENGLISH_001/, "names the previous cycle for the decision rule");
});

test("renderTranscripts / orderDiscriminating: discriminating transcripts first", () => {
  const ordered = orderDiscriminating(STUB_SUMMARY, STUB_ROWS).map((r) => r.caseId);
  assert.deepEqual(ordered, ["c", "b", "a"], "tier-1 fail, then hard fail, then highest mean last");
  const md = renderTranscripts(STUB_SUMMARY, STUB_ROWS, 2);
  assert.match(md, /^# CEFR_ENGLISH_002_TRANSCRIPTS /);
  assert.ok(md.indexOf("## c ") < md.indexOf("## b "), "c leads");
  assert.ok(md.indexOf("## b ") < md.indexOf("## a "));
  assert.match(md, /TIER-1 FAIL/);
  assert.match(md, /HARD FAIL/);
});

// ---- guards on the pins the SKILL contract requires ----

test("pins: full judge model id (never an alias) + versioned prompt file + expect/tag registries", async () => {
  assert.match(JUDGE_MODEL, /^claude-haiku-4-5-\d{8}$/, "a dated full model id");
  assert.equal(PROMPT_VERSION, "judge-prompt-v1");
  assert.ok((await readFile(PROMPT_FILE, "utf8")).length > 500, "the versioned prompt text exists");
  assert.deepEqual(DIMENSIONS, JUDGE_DIMENSIONS, "runner and judge agree on the rubric dimensions");
  assert.ok(EXPECT_KEYS.includes("baselineFail"));
  assert.equal(TAGS.length, 9);
});
