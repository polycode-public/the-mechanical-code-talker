// Feature B: an ALWAYS-ON, short "Goal (inferred): …" line on structural/
// query-shaped answers — independent of the --narrate/TMCT_NARRATE opt-in full
// debug trace (chat-narrate.test.mjs), which stays exactly as it was. See
// withGoalLine's docblock (chat.mjs, right after withNarration) for the design.
// APPENDED (not prepended) — a blank-line-separated trailer, not a lead-in —
// so it never disturbs the start of the substantive answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn, NARRATE_MARKER } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("goal line: a structural query gets an always-on 'Goal (inferred): …' line, appended after the answer", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph() });
  assert.match(r.answer, /\n\nGoal \(inferred\): .+\.$/);
  assert.match(r.answer, /Goal \(inferred\): Understand a call relationship\.$/);
  // the substantive answer still LEADS, byte-identical to the non-goal-line text
  assert.match(r.answer, /^in app\/lib\/b\.mjs there is function Widget\.render\(\)\./);
});

test("goal line: NEVER touches last.answer — why/say-more and repeat-detection see the same text a goal-line-off run would", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph() });
  assert.doesNotMatch(r.last.answer, /Goal \(inferred\)/, "last.answer stays clean");
  const withoutGoalLine = r.answer.replace(/\n\nGoal \(inferred\):[^\n]*$/, "");
  assert.equal(r.last.answer, withoutGoalLine, "last.answer is exactly the pre-goal-line answer");
});

test("goal line: suppressed for conversational turns (greetings, thanks, farewells)", async () => {
  const g = await graph();
  for (const q of ["hello", "thanks", "bye"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.doesNotMatch(r.answer, /Goal \(inferred\)/, `"${q}" gets no goal line`);
  }
});

test("goal line: suppressed on a total grammar miss — never a fabricated 'Goal (inferred): unclear' line", async () => {
  const r = await runTurn("tell me a joke", { config: CONFIG, graph: await graph() });
  assert.doesNotMatch(r.answer, /Goal \(inferred\)/);
  assert.match(r.answer, /^couldn't parse this as a graph question/);
});

test("goal line: suppressed for non-ask turn types (a plain count) — the field is scoped to runAsk turns only", async () => {
  const r = await runTurn("how many classes are there", { config: CONFIG, graph: await graph() });
  assert.doesNotMatch(r.answer, /Goal \(inferred\)/);
  assert.match(r.answer, /^\d+ classes?\./);
});

test("goal line: --narrate mode is COMPLETELY UNAFFECTED — still shows the full trace block, now ALSO gets the short line just before it (additive, not a replacement)", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph(), narrate: true });
  assert.match(r.answer, /^in app\/lib\/b\.mjs there is function Widget\.render\(\)\./, "the substantive answer still leads");
  assert.match(r.answer, /Goal \(inferred\): Understand a call relationship\.\n\n--- narrate ---/, "the short line sits right before the full trace block");
  assert.ok(r.answer.includes(NARRATE_MARKER), "the full narrate block still appears");
  assert.match(r.answer, /goal: understand a call relationship/, "the trace's own goal: line is untouched (lowercase, no period — a separate mechanism)");
});
