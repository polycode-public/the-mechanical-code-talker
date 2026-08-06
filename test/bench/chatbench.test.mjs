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
} from "../../test-benchmarks/chatbench/run.mjs";
import {
  JUDGE_MODEL, PROMPT_VERSION, DIMENSIONS,
  renderTranscript, buildPrompt, validateScores, parseJudgeOutput, maskScores,
  judgeSample, sampleMean, isHardFail, computeSummary, pool,
} from "../../test-benchmarks/chatbench/judge.mjs";
import {
  renderReport, renderTranscripts, orderDiscriminating,
  cellRollup, uncoveredCells, undeclaredCells,
} from "../../test-benchmarks/chatbench/report.mjs";
import { OFF_MATRIX_FOLD_CELLS, HORIZON_CELLS } from "../../test-benchmarks/chatbench/graded.mjs";
import { runChat } from "../../src/services/chat.mjs";
import { parseSessionJsonl, parseSessionLog, turnKey } from "../../src/services/sessions.mjs";

const POOL_FILE = fileURLToPath(new URL("../../test-benchmarks/chatbench/graded-pool.jsonl", import.meta.url));
const PROMPT_FILE = fileURLToPath(new URL(`../../test-benchmarks/chatbench/${PROMPT_VERSION}.txt`, import.meta.url));
const SCHEMA_FILE = fileURLToPath(new URL("../../test-benchmarks/chatbench/rubric.schema.json", import.meta.url));

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

test("graded pool default: off-matrix graded cells are exactly the named frozen-v1 folds + P-axis horizon cells, never matrix drift", async () => {
  const { cases } = parseCases(await readFile(POOL_FILE, "utf8"));
  // Every graded cell in the default pool that GRADED_MATRIX does not declare is
  // either one of the named frozen-v1 folds or one of the named P-axis HORIZON
  // cells (the pragmatics/discourse family, graded but deliberately un-sized) —
  // no unnamed off-matrix cell (new drift), and no named cell silently gone.
  assert.deepEqual(undeclaredCells(cases), [...OFF_MATRIX_FOLD_CELLS, ...HORIZON_CELLS].sort());
  // and a matrix-generated case (id "g-*") must never populate a FROZEN-FOLD
  // cell — only the frozen v1 folds may sit there. The horizon cells are the one
  // intentional exception: they ARE authored as g-* graded cases.
  const offMatrix = new Set(OFF_MATRIX_FOLD_CELLS);
  const strays = cases.filter((c) => offMatrix.has(`${c.grade}:${c.construction}`) && c.id.startsWith("g-"));
  assert.deepEqual(strays.map((c) => c.id), [], "generated cells never populate an off-matrix fold cell");
});

test("graded pool default: the CEFR P-axis horizon cells are populated with well-formed pragmatics/discourse cases", async () => {
  const { cases } = parseCases(await readFile(POOL_FILE, "utf8"));
  for (const key of HORIZON_CELLS) {
    const [grade, construction] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const inCell = cases.filter((c) => c.grade === grade && c.construction === construction);
    assert.ok(inCell.length >= 2, `${key}: the horizon cell carries at least two cases (got ${inCell.length})`);
    for (const c of inCell) {
      assert.ok(c.id.startsWith("g-"), `${c.id}: a graded P-axis case`);
      assert.ok(c.turns.length >= 1 && c.turns.every((t) => typeof t.say === "string"), `${c.id}: well-formed turns`);
      assert.ok(Array.isArray(c.judge?.dimensions) && c.judge.context, `${c.id}: carries judge dimensions + context`);
    }
  }
  // the discourse-composition cell is genuinely multi-turn (its whole point)
  const disc = cases.filter((c) => c.construction === "cross-turn-composition");
  assert.ok(disc.length && disc.every((c) => c.turns.length >= 2), "cross-turn-composition cases span multiple turns");
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
  resolvedIds: ["mod:app/lib/a.mjs"],
  answeredIds: ["mod:app/lib/b.mjs", "mod:app/lib/c.mjs"],
  focusLabel: "app/lib/a.mjs",
  end: false,
};

test("evaluateExpect: each check kind passes and fails on the right evidence", () => {
  const pass = evaluateExpect({
    miss: false,
    answerMatch: ["app/lib/b\\.mjs", "c\\.mjs"],
    answerNotMatch: ["zebra"],
    answeredIdsInclude: ["mod:app/lib/b.mjs"],
    resolvedIdsInclude: ["mod:app/lib/a.mjs"],
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

// ---- lever 4: ingestbench's deterministic equivalence checker wired into
// tier-1, so a subclass-paraphrase case settles free instead of needing the
// judge ----

test("evaluateExpect: subclassParaphrase accepts ANY valid closed-template paraphrase, not just one pinned string", () => {
  // The product picks one of four closed templates deterministically per
  // (subject, object) — a case author who pins the literal string couples the
  // case to that pick. subclassParaphrase instead accepts whichever template
  // surfaced, as long as it is a genuine paraphrase of the same pair.
  const everyForm = evaluateExpect(
    { subclassParaphrase: { subject: "cache", object: "component" } },
    { answer: "noted — remembered 1 fact: cache rdfs:subClassOf component (every cache is a component)" },
  );
  assert.equal(everyForm.length, 1);
  assert.equal(everyForm[0].pass, true, JSON.stringify(everyForm));

  const kindOfForm = evaluateExpect(
    { subclassParaphrase: { subject: "cache", object: "component" } },
    { answer: "noted — remembered 1 fact: cache rdfs:subClassOf component (cache is a kind of component)" },
  );
  assert.equal(kindOfForm[0].pass, true, "a different template for the SAME pair still verifies");

  const wholeAnswerForm = evaluateExpect(
    { subclassParaphrase: { subject: "dog", object: "animal" } },
    { answer: "dog counts as an animal" },
  );
  assert.equal(wholeAnswerForm[0].pass, true, "checks the whole answer too, not only a parenthetical clause");
});

test("evaluateExpect: subclassParaphrase rejects a paraphrase of the wrong pair or no paraphrase at all", () => {
  const wrongPair = evaluateExpect(
    { subclassParaphrase: { subject: "cache", object: "component" } },
    { answer: "noted — remembered 1 fact: cache rdfs:subClassOf component (every widget is a container)" },
  );
  assert.equal(wrongPair[0].pass, false);

  const swapped = evaluateExpect(
    { subclassParaphrase: { subject: "cache", object: "component" } },
    { answer: "noted — remembered 1 fact: component rdfs:subClassOf cache (every component is a cache)" },
  );
  assert.equal(swapped[0].pass, false, "subject/object swap is a different claim, never accepted as equivalent");

  const noParaphrase = evaluateExpect(
    { subclassParaphrase: { subject: "cache", object: "component" } },
    { answer: "noted — remembered 1 fact: cache rdfs:subClassOf component" },
  );
  assert.equal(noParaphrase[0].pass, false, "the machine-notation triple alone is not a paraphrase claim");
});

// ---- ING-8: the harder, non-isa paraphrase shapes ING-7's own checker
// doesn't cover, wired in the same free way (src/domain/paraphrase-ing8.mjs) ----

test("evaluateExpect: ing8Paraphrase accepts any valid closed-template paraphrase of a non-isa relation", () => {
  const possessesForm = evaluateExpect(
    { ing8Paraphrase: { family: "has", subject: "bird", object: "feather" } },
    { answer: "noted — remembered 1 fact: bird tmct:has feather (bird possesses a feather)" },
  );
  assert.equal(possessesForm.length, 1);
  assert.equal(possessesForm[0].pass, true, JSON.stringify(possessesForm));

  const ownsForm = evaluateExpect(
    { ing8Paraphrase: { family: "has", subject: "bird", object: "feather" } },
    { answer: "noted — remembered 1 fact: bird tmct:has feather (bird owns a feather)" },
  );
  assert.equal(ownsForm[0].pass, true, "a different closed template for the SAME pair still verifies");

  const wholeAnswerForm = evaluateExpect(
    { ing8Paraphrase: { family: "capableOf", subject: "bird", object: "fly" } },
    { answer: "bird knows how to fly" },
  );
  assert.equal(wholeAnswerForm[0].pass, true, "checks the whole answer too, not only a parenthetical clause");
});

test("evaluateExpect: ing8Paraphrase rejects a swapped pair, the wrong relation family, or no paraphrase at all", () => {
  const swapped = evaluateExpect(
    { ing8Paraphrase: { family: "has", subject: "bird", object: "feather" } },
    { answer: "noted — remembered 1 fact: bird tmct:has feather (feather possesses a bird)" },
  );
  assert.equal(swapped[0].pass, false, "subject/object swap is a different claim, never accepted as equivalent");

  const wrongFamily = evaluateExpect(
    { ing8Paraphrase: { family: "has", subject: "bird", object: "feather" } },
    { answer: "noted — remembered 1 fact: bird tmct:has feather (bird creates a feather)" },
  );
  assert.equal(wrongFamily[0].pass, false, "a different relation family is a different claim");

  const noParaphrase = evaluateExpect(
    { ing8Paraphrase: { family: "has", subject: "bird", object: "feather" } },
    { answer: "noted — remembered 1 fact: bird tmct:has feather" },
  );
  assert.equal(noParaphrase[0].pass, false, "the machine-notation triple alone is not a paraphrase claim");
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
    // Plumbing-only (greeting + a second turn that threads focus/last across
    // the session) — none of it depends on the corpus seed, so opt out of
    // paying that tax. No code domain is active over a bare temp repo, so the
    // second turn's count is the ordinary honest miss, not a code-graph count.
    env: { TMCT_NO_SEED: "1" },
    turns: [
      { say: "hi", session: 1, expect: { miss: false, answerMatch: ["^Hi\\."] } },
      { say: "how many modules are there", session: 1, expect: { miss: true, answerMatch: ["couldn't read that"] } },
    ],
  };
  const { transcript, turnEvals } = await runSessionCase(caseDef, {
    runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson: "{}",
  });
  assert.equal(transcript.length, 2);
  assert.match(transcript[0].answer, /^Hi\./);
  assert.match(transcript[1].answer, /couldn't read that as a question/);
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

test("runSessionCase: a real teach-confirmation answer settles a subclassParaphrase case at tier-1, no judge involved", async () => {
  // The visitor teaches with "kind of" wording; the product's own paraphrase
  // suffix picks a DIFFERENT closed template ("every cache is a component" —
  // deterministic per (subject, object), src/domain/paraphrase.mjs) rather
  // than echoing the visitor's phrasing back. A case pinning the literal
  // string would either have to special-case that pick or go stale the moment
  // the template table changes; subclassParaphrase settles it on meaning.
  const caseDef = {
    id: "stub-subclass-paraphrase", tags: ["conversational"], mode: "session", graph: "empty",
    env: { TMCT_NO_SEED: "1" },
    turns: [{
      say: "a cache is a kind of component", session: 1,
      expect: { miss: false, subclassParaphrase: { subject: "cache", object: "component" } },
    }],
  };
  const { transcript, turnEvals } = await runSessionCase(caseDef, {
    runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson: "{}",
  });
  assert.match(transcript[0].answer, /\(every cache is a component\)/, "the product's own deterministic template pick");
  assert.doesNotMatch(transcript[0].answer, /cache is a kind of component/, "not an echo of the visitor's wording");
  const tier1 = summarizeTier1(turnEvals);
  assert.equal(tier1.pass, true, JSON.stringify(tier1.failing));

  // The same real answer against the WRONG pair fails tier-1 deterministically
  // too — the check is a real equivalence test, not a rubber stamp.
  const wrongPairEvals = [{
    checks: evaluateExpect({ subclassParaphrase: { subject: "widget", object: "container" } }, {
      answer: transcript[0].answer,
    }),
    baselineFail: false, improvedIn: null,
  }];
  assert.equal(summarizeTier1(wrongPairEvals).pass, false);
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

// A weak cell hiding inside two healthy marginals is the shape the cross table
// exists to expose, so the stub reproduces it: naming-vocabulary is weak at A1
// and strong at A2, and neither marginal shows either cell.
const CELL_SUMMARY = {
  ...STUB_SUMMARY,
  perCase: [
    { caseId: "g1", tags: ["graded"], mean: 1.4, hardFail: false },
    { caseId: "g2", tags: ["graded"], mean: 1.9, hardFail: false },
    { caseId: "g3", tags: ["graded"], mean: 1.8, hardFail: false },
  ],
};
const CELL_ROWS = [
  { caseId: "g1", tags: ["graded"], grade: "A1", construction: "naming-vocabulary", mode: "turns", transcript: [], tier1: { pass: true, failing: [] } },
  { caseId: "g2", tags: ["graded"], grade: "A2", construction: "naming-vocabulary", mode: "turns", transcript: [], tier1: { pass: true, failing: [] } },
  { caseId: "g3", tags: ["graded"], grade: "B1", construction: "svo-query", mode: "turns", transcript: [], tier1: { pass: false, failing: [] } },
];

test("cellRollup: crosses grade with construction, worst cell first", () => {
  const cells = cellRollup(CELL_SUMMARY, CELL_ROWS);
  assert.deepEqual(cells.map((c) => `${c.grade}:${c.construction}`), ["A1:naming-vocabulary", "B1:svo-query", "A2:naming-vocabulary"]);
  assert.equal(cells[0].mean, 1.4, "the floor cell leads, below both of its own marginals");
  assert.equal(cells[0].tier1Pass, 1);
  assert.equal(cells[0].tier1Total, 1);
});

test("cellRollup: a row belonging to no cell is left out of the cross table", () => {
  assert.deepEqual(cellRollup(STUB_SUMMARY, STUB_ROWS), [], "ungraded lanes carry no grade/construction");
});

test("cellRollup: a cell with no judged sample reports no mean rather than a zero", () => {
  const cells = cellRollup({ perCase: [] }, CELL_ROWS);
  assert.equal(cells.every((c) => c.mean === null), true);
});

test("uncoveredCells: names the declared cells a run never sampled", () => {
  const uncovered = uncoveredCells(CELL_ROWS).map((c) => `${c.grade}:${c.construction}`);
  assert.equal(uncovered.includes("A1:naming-vocabulary"), false, "a sampled cell is covered");
  assert.equal(uncovered.includes("C2:garden-path"), true, "a declared cell nobody ran is reported, not omitted");
});

test("undeclaredCells: names cells that are graded but absent from the matrix", () => {
  assert.deepEqual(undeclaredCells(CELL_ROWS), ["B1:svo-query"]);
  assert.deepEqual(undeclaredCells([CELL_ROWS[0]]), [], "a declared cell is not flagged");
});

test("renderReport: leads with the cell table, names the floor cell and the coverage gap", () => {
  const md = renderReport(CELL_SUMMARY, CELL_ROWS, 2);
  assert.match(md, /\*\*Floor cell: A1 naming-vocabulary at 1\.400\.\*\*/);
  assert.match(md, /\| A1 \| naming-vocabulary \| 1 \| 1\.400 \| 1\/1 \|/);
  assert.match(md, /## Coverage: 2 of 36 declared cells measured/);
  assert.match(md, /- C2 garden-path/, "an unmeasured cell is listed by name");
  assert.match(md, /graded but are not declared in GRADED_MATRIX\*\*: B1:svo-query/);
  assert.ok(md.indexOf("Per-cell breakdown") < md.indexOf("Per-tag breakdown"), "the cross table precedes the marginals it corrects");
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
  assert.equal(PROMPT_VERSION, "judge-prompt-v2");
  assert.ok((await readFile(PROMPT_FILE, "utf8")).length > 500, "the versioned prompt text exists");
  // the sanctioned capability surface the v2 prompt names — a correct game,
  // plan or reference-pack citation must never read as a charter violation.
  const prompt = await readFile(PROMPT_FILE, "utf8");
  for (const phrase of ["guess-the-number", "goal", "reference-pack", "vocabulary"]) {
    assert.ok(prompt.includes(phrase), `v2 prompt names the ${phrase} surface`);
  }
  // superseded prompt versions stay committed so recorded runs stay auditable.
  const v1 = fileURLToPath(new URL("../../test-benchmarks/chatbench/judge-prompt-v1.txt", import.meta.url));
  assert.ok((await readFile(v1, "utf8")).length > 500, "the superseded v1 prompt text stays");
  assert.deepEqual(DIMENSIONS, JUDGE_DIMENSIONS, "runner and judge agree on the rubric dimensions");
  assert.ok(EXPECT_KEYS.includes("baselineFail"));
  assert.equal(TAGS.length, 9);
});
