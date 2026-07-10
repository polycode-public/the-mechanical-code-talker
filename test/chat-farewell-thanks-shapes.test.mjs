// HANDOVER.md 2026-07-10 item 2: the THANKS/BYE closed sets only ever matched
// the WHOLE line — a thanks/bye clause tacked onto a larger sentence fell to the
// generic self-intro or grammar wall instead of a sign-off. Confirmed independently
// by 3 of 5 personas in the first SKILL_BENCHMARK_CONVERSATION.md §3.4 persona sweep
// (2026-07-10): "thanks, that was fun" (stranger), "ok thank you very much, bye bye"
// (ESL), "thanks, bye" (small-talk — notable: README implies "bye" should end the
// session, but it fell through to the self-intro instead). This file pins the fix:
// a bounded phrase-SHAPE generalization (chat.mjs's farewellOrThanksSignal), not
// another one-off literal string per phrasing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("HANDOVER item 2: 'thanks, that was fun' (stranger persona) reads as thanks, not the grammar wall", async () => {
  const { answer, record, end } = await runTurn("thanks, that was fun", { config: CONFIG, graph: await graph() });
  assert.match(answer, /Any time/);
  assert.equal(record.miss, false);
  assert.ok(!end, "a thanks-only clause never ends the session");
});

test("HANDOVER item 2: 'ok thank you very much, bye bye' (ESL persona) ends the session, not the self-intro", async () => {
  const { answer, record, end } = await runTurn("ok thank you very much, bye bye", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^Bye —/);
  assert.equal(record.miss, false);
  assert.equal(end, true, "a bye clause anywhere in the line ends the session");
});

test("HANDOVER item 2: 'thanks, bye' (small-talk persona) ends the session — bye wins over thanks", async () => {
  const { answer, end } = await runTurn("thanks, bye", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^Bye —/);
  assert.equal(end, true, "the README implies bye phrasing ends the session, even alongside a thanks");
});

test("HANDOVER item 2 guard: an ordinary multi-clause structural query is never swallowed by the phrase-shape scan", async () => {
  const g = await graph();
  const r1 = await runTurn("who calls a.mjs, and where is it used", { config: CONFIG, graph: g });
  assert.doesNotMatch(r1.answer, /^Bye —/);
  assert.doesNotMatch(r1.answer, /Any time/);
  const r2 = await runTurn("what does saveStore call, and does it import store.mjs", { config: CONFIG, graph: g });
  assert.doesNotMatch(r2.answer, /^Bye —/);
  assert.doesNotMatch(r2.answer, /Any time/);
});

test("HANDOVER item 2 guard: a bare single-clause 'bye'/'thanks' still resolves exactly as before (no regression)", async () => {
  const g = await graph();
  const bye = await runTurn("bye", { config: CONFIG, graph: g });
  assert.match(bye.answer, /^Bye —/);
  assert.equal(bye.end, true);
  const thanks = await runTurn("thanks", { config: CONFIG, graph: g });
  assert.match(thanks.answer, /Any time/);
});

// The rest of this file is a VARIED stress sweep (not just the 3 literal quotes
// above) — different intensifiers, orderings, reduplication, and delimiter
// combinations, since a generalization fix that only passes its own reported
// examples risks being disguised overfitting rather than a real generalization.

test("HANDOVER item 2 (varied): bare reduplication 'bye bye' (no comma at all) still ends the session", async () => {
  const { answer, end } = await runTurn("bye bye", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^Bye —/);
  assert.equal(end, true, "reduplication folding applies to the single-clause whole-line check too, not just the multi-clause scan");
});

test("HANDOVER item 2 (varied): comma-plus-'and' delimiter combo ('thank you, and goodbye') still recognizes BOTH clauses", async () => {
  const { answer, end } = await runTurn("thank you, and goodbye", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^Bye —/, "'and goodbye' must resolve as the clause 'goodbye', not the glued 'and goodbye'");
  assert.equal(end, true);
});

test("HANDOVER item 2 (varied): a different intensifier ('thanks so much, take care') still reads as thanks", async () => {
  const { answer, end } = await runTurn("thanks so much, take care", { config: CONFIG, graph: await graph() });
  assert.match(answer, /Any time/);
  assert.ok(!end);
});

test("HANDOVER item 2 (varied): bye-then-thanks ordering ('bye, thanks for everything') still ends the session — bye wins regardless of order", async () => {
  const { answer, end } = await runTurn("bye, thanks for everything", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^Bye —/);
  assert.equal(end, true);
});

test("HANDOVER item 2 (varied): three clauses ('hi, thanks, bye') still resolves to the farewell, not just the greeting", async () => {
  const { answer, end } = await runTurn("hi, thanks, bye", { config: CONFIG, graph: await graph() });
  assert.match(answer, /^Bye —/);
  assert.equal(end, true);
});

test("HANDOVER item 2 (varied) guard: an ack-preamble before a real question is never mistaken for thanks, regardless of which OK_ACK word leads", async () => {
  const g = await graph();
  for (const q of ["right, can you walk me through this codebase", "cool, what does the router import", "sure, tell me about the classes"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.doesNotMatch(r.answer, /^Bye —/, `"${q}" must not end the session`);
    assert.doesNotMatch(r.answer, /^Any time\./, `"${q}" must not be misread as thanks`);
  }
});

test("HANDOVER item 2 (varied) guard: a thanks clause followed by a genuine follow-up QUESTION (not filler) is left alone, not swallowed", async () => {
  const g = await graph();
  const r = await runTurn("cheers, what about imports then", { config: CONFIG, graph: g });
  assert.doesNotMatch(r.answer, /^Any time\./, "a substantive trailing clause (not short filler) must not be treated as a thanks close");
});
