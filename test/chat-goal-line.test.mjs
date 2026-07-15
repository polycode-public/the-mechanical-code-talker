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
  // a real record.canonical trails the goal line here (Feature: "Canonical: …"),
  // so the goal line itself is no longer the string's own end — matched mid-string.
  assert.match(r.answer, /\n\nGoal \(inferred\): .+\.\n\nCanonical:/);
  assert.match(r.answer, /Goal \(inferred\): Understand a call relationship\.\n\nCanonical:/);
  // the substantive answer still LEADS, byte-identical to the non-goal-line text
  assert.match(r.answer, /^in app\/lib\/b\.mjs there is function Widget\.render\(\)\./);
});

test("goal line: NEVER touches last.answer — why/say-more and repeat-detection see the same text a goal-line-off run would", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph() });
  assert.doesNotMatch(r.last.answer, /Goal \(inferred\)/, "last.answer stays clean");
  const withoutTrailers = r.answer
    .replace(/\n\nCanonical:[^\n]*$/, "")
    .replace(/\n\nGoal \(inferred\):[^\n]*$/, "");
  assert.equal(r.last.answer, withoutTrailers, "last.answer is exactly the pre-goal-line, pre-canonical-line answer");
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

test("goal line: a RELATION-FORCE answer gets the line too, even as a fresh vague-touch opener with no envelope.parsed to deduce from", async () => {
  // "tell me about inheritance" never gets a raw grammar parse at all (it's a
  // vague relation touch, not a structured query) — relationForceAnswer is
  // what actually answers it. Before the fix, `deduced` was computed once,
  // early, straight off envelope.parsed, and stayed null forever even though
  // the answer was real — no line at all. Tier-2 playtest cycle 9.
  const r = await runTurn("tell me about inheritance", { config: CONFIG, graph: await graph() });
  assert.match(r.answer, /Goal \(inferred\): Understand a class hierarchy\/inheritance relationship\.$/);
});

test("goal line: a STACCATO relation-chain continuation whose leading connective never itself parses ('and inherits?') gets the line too, matching a normally-parsed relation query's own wording", async () => {
  const g = await graph();
  const first = await runTurn("what does Widget inherit from", { config: CONFIG, graph: g });
  const second = await runTurn("and inherits?", { config: CONFIG, graph: g, last: first.last });
  assert.match(second.answer, /Goal \(inferred\): Understand a class hierarchy\/inheritance relationship\.$/,
    "the relation force answered correctly even on the first pass — only the goal line went missing, since 'and inherits?' itself never parses");
});

test("goal line: --narrate mode is COMPLETELY UNAFFECTED — still shows the full trace block, now ALSO gets the short line (and the canonical line) just before it (additive, not a replacement)", async () => {
  const r = await runTurn("what calls fnAlpha", { config: CONFIG, graph: await graph(), narrate: true });
  assert.match(r.answer, /^in app\/lib\/b\.mjs there is function Widget\.render\(\)\./, "the substantive answer still leads");
  assert.match(r.answer, /Goal \(inferred\): Understand a call relationship\.\n\nCanonical: .+\n\n--- narrate ---/, "the goal line, then the canonical line, sit right before the full trace block");
  assert.ok(r.answer.includes(NARRATE_MARKER), "the full narrate block still appears");
  assert.match(r.answer, /goal: understand a call relationship/, "the trace's own goal: line is untouched (lowercase, no period — a separate mechanism)");
});

// ---- the fact readers' own additive `goal` field ---------------------------
// factAnswer/factReadBack returns carry `goal` when a goal is deducible, so an
// envelope-less consumer (the ledger page's chat dock) can render the same
// "Goal (inferred)" line chat prints. Every other consumer reads named fields
// and ignores it.
import { factAnswer, factReadBack } from "../src/chat.mjs";
import { createInMemoryStore, appendFact } from "../src/memory/core.mjs";

async function taughtStore() {
  const h = createInMemoryStore();
  await appendFact(h, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA" });
  await appendFact(h, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" });
  await appendFact(h, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
  return h;
}

test("goal field: an envelope-less 'what is X' factAnswer hit carries the vocabulary-goal wording chat's own parse would deduce", async () => {
  const h = await taughtStore();
  const hit = await factAnswer(h, "what is a dog", null, true, {});
  assert.ok(hit && hit.text, "the definition answers");
  assert.equal(hit.goal, 'understand a vocabulary/definition term ("dog")');
});

test("goal field: an envelope-less relation chase through factReadBack carries the taught-fact-lookup goal", async () => {
  const h = await taughtStore();
  const hit = (await factAnswer(h, "who is the father of john", null, true, {}))
    ?? (await factReadBack(h, "who is the father of john", null, true, null));
  assert.ok(hit && hit.text, "the relation query answers");
  assert.match(hit.text, /ahab/);
  assert.equal(hit.goal, "look up a taught fact about a subject/verb/object");
});

test("goal field: absent (undefined) on a hit whose shape maps to no goal, and never fabricated on a miss", async () => {
  const h = await taughtStore();
  const canHit = (await factAnswer(h, "can a dog bark", null, true, {}))
    ?? (await factReadBack(h, "can a dog bark", null, true, null));
  assert.ok(canHit && canHit.text, "the capability yes/no answers");
  assert.equal(canHit.goal, undefined, "no goal wording exists for this shape — the field stays absent, the dock renders no line");
  const miss = await factAnswer(h, "zzz unparseable zzz", null, true, {});
  assert.equal(miss, null, "a miss stays a plain null — no goal-bearing wrapper object");
});
