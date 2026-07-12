// archive/PLAN_CONVERSATION.md Finding 4 — safety fix only (this session).
//
// QUESTION_LEAD_RE (chat.mjs, near hasMidSentenceInterrogative) is anchored to
// the FIRST word of a sentence, so a wh-word appearing LATER ("it uses WHICH
// controller as its base") slipped every teachLane guard that reuses it,
// including TEACH_PRONOUN_RE's own check (which had no interrogative guard at
// all). Two confirmed-live repros (Finding 4's exact text):
//   1. two-turn, pronoun subject: "what does createApp call" (context), then
//      "it uses which controller as its base" — used to answer with the
//      pronoun-classification refusal ("I can't store a fact about \"it\" as
//      a class") even though the real problem was a misrouted mid-sentence
//      QUESTION, not a pronoun. This repro uses "Widget.render" in place of
//      "createApp" (not present in this repo's committed test fixture) —
//      the mechanism under test (a real forward-call turn establishing
//      context, then the pronoun-led mid-sentence-interrogative follow-up)
//      is identical either way.
//   2. single-turn, no pronoun: "TaskController uses which controller as its
//      base" — used to store the GARBAGE fact "noted — remembered:
//      taskcontroller uses which controller as its base" via
//      generalVerbTeach's bare path, corrupting memory.
//
// The fix (hasMidSentenceInterrogative, chat.mjs, near QUESTION_LEAD_RE): a
// wink-POS check of whether the token immediately before a non-initial
// wh-word is a VERB/AUX (wh-in-situ interrogative — "uses WHICH controller")
// vs. a NOUN (relative clause — "the handler WHICH processes requests").
// Applied alongside every existing QUESTION_LEAD_RE guard in teachLane, plus
// TEACH_PRONOUN_RE's previously-unguarded check. This does NOT make either
// repro sentence answerable as a real question — that needs two separately-
// scoped features (a discontiguous verb-frame parser for "uses X as its
// base"; a union-kind reverse-question capability for relation verbs like
// "uses"/"calls") neither of which this fix attempts. The only guarantee
// here: no bogus fact gets stored, and no confusing wrong-reason refusal is
// shown, for a sentence that is actually still a question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-msi-${tag}-`));
const factCount = async (dir) => (await loadMemory(dir)).individuals.filter((i) => i.class === FACT_CLASS).length;

test("Finding 4 repro 1: 'it uses which controller as its base' after a forward-call turn never stores a fact and drops the wrong-reason pronoun refusal", async () => {
  const dir = await mem("repro1");
  try {
    const t1 = await runTurn("what does Widget.render call", { config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "s1" });
    assert.match(t1.answer, /fnAlpha/, "turn 1 establishes real context (unaffected by this fix)");

    const t2 = await runTurn("it uses which controller as its base", {
      config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "s1", last: t1.last, focus: t1.focus,
    });
    assert.doesNotMatch(t2.answer, /pronouns aren't things I can classify/,
      `must never be the old wrong-reason pronoun refusal -> ${t2.answer}`);
    assert.doesNotMatch(t2.answer, /^noted — remembered/, `must never store a fact -> ${t2.answer}`);
    assert.equal(await factCount(dir), 0, "no fact of any kind may have been stored");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Finding 4 repro 2: 'TaskController uses which controller as its base' (no pronoun) never stores the garbage fact", async () => {
  const dir = await mem("repro2");
  try {
    const r = await runTurn("TaskController uses which controller as its base", {
      config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "s2",
    });
    assert.doesNotMatch(r.answer, /^noted — remembered/, `must never store a fact -> ${r.answer}`);
    assert.doesNotMatch(r.answer, /taskcontroller uses which controller/i,
      "the exact garbage fact text must never appear in the answer");

    const rows = (await loadMemory(dir)).individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(rows.length, 0, "no fact of any kind may have been stored");
    for (const row of rows) {
      assert.doesNotMatch(
        row.attributes?.find((a) => a.key === "subject")?.value || "",
        /taskcontroller/i,
      );
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Finding 4 guard: a genuine mid-sentence RELATIVE-clause teach declarative ('a grandfather is a grandparent who is male') still stores — the VERB-vs-NOUN heuristic must not regress a real teach", async () => {
  const dir = await mem("guard-relative");
  try {
    const r = await runTurn("a grandfather is a grandparent who is male", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    assert.equal(r.record.miss, false, `expected a real teach, got: ${r.answer}`);
    assert.match(r.answer, /^noted — remembered/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Finding 4 guard: pre-existing pronoun-decline regressions (no mid-sentence interrogative) are unaffected — still get the pronoun-specific message", async () => {
  const dir = await mem("guard-pronoun");
  try {
    const r = await runTurn("he is a doctor", { config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "s4" });
    assert.match(r.answer, /I can't store a fact about "he" as a class — pronouns aren't things I can classify\./);
    assert.equal(r.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
