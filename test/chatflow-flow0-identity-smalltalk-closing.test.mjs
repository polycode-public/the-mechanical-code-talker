// FLOW-0 (bootstrap: before any graph, the identity surface) regressions for
// dead-ends a 2.11.0 persona sweep found in the identity/AI, capability-
// decline, farewell/closing, and small-talk recognizer families
// (archive/BENCHMARK_CONVERSATION_2.11.0.md's routed backlog #2, #4, #5, #6, #7, #8).
// Every probe runs with no graph and no memory store — a bare `tmct chat`
// with no --repo, matching FLOW-0's own discipline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runTurn } from "../src/services/chat.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";

const CONFIG = { graphFile: fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url)) };
const bare = (line) => runTurn(line, { config: CONFIG, graph: null });

// The committed mini-webapp graph — a real repo with a src/core/validate.mjs
// module, used by the vague-touch-opener probes below (which need a graph the
// bare FLOW-0 turns above deliberately lack).
const MINI_WEBAPP_GRAPH = fileURLToPath(new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url));
const miniWebappGraph = parseEntities(JSON.parse(readFileSync(MINI_WEBAPP_GRAPH, "utf8")));
const onMiniWebapp = (line) => runTurn(line, { config: { graphFile: MINI_WEBAPP_GRAPH }, graph: miniWebappGraph });

// ---- #2: the "are you an LLM / what model are you" family ----

test("a comparison-shaped LLM-identity question (\"are you like chatgpt or gemini or something\") gets the no-LLM answer, not a teach attempt", async () => {
  const r = await bare("are you like chatgpt or gemini or something");
  assert.match(r.answer, /no LLM involved/i);
  assert.equal(r.record.miss, false);
});

test("an open-pick model question with no \"built on\" bridge (\"what model are you, gpt-4 or claude or something else\") gets the no-LLM answer", async () => {
  const r = await bare("what model are you, gpt-4 or claude or something else");
  assert.match(r.answer, /no LLM involved/i);
});

test("\"can you use an LLM to answer this\" gets the no-LLM answer instead of a module-name search for the literal words", async () => {
  const r = await bare("can you use an LLM to answer this");
  assert.match(r.answer, /no LLM involved/i);
  assert.doesNotMatch(r.answer, /no module matching/i);
});

// ---- #4: internet/web-access capability questions ----

test("\"can you look things up on the internet\" gets a clean offline decline, not a module-name search", async () => {
  const r = await bare("can you look things up on the internet");
  assert.match(r.answer, /no LLM involved/i);
  assert.doesNotMatch(r.answer, /no module matching/i);
});

test("\"can you browse the web to check something\" gets a clean offline decline, not a module-name search", async () => {
  const r = await bare("can you browse the web to check something");
  assert.match(r.answer, /no LLM involved/i);
  assert.doesNotMatch(r.answer, /no module matching/i);
});

// ---- #5: a non-sequitur identity blurb firing for nonsense input ----

test("a bare SQL statement (\"DROP TABLE users;\") gets a targeted decline naming the SQL shape, not the identity/orientation blurb", async () => {
  const r = await bare("DROP TABLE users;");
  assert.match(r.answer, /SQL statement/i);
  assert.doesNotMatch(r.answer, /deterministic, offline code-graph assistant/i);
});

// ---- #6: casual farewells with "thanks" but not "bye" ----

test("\"gtg thx\" (a bye word and a thanks word with no delimiter) ends the session like any other farewell", async () => {
  const r = await bare("gtg thx");
  assert.equal(r.end, true);
  assert.match(r.answer, /Bye/i);
});

test("\"thanks bye\" (the same glue in the other order) ends the session instead of parsing as a habitual teach", async () => {
  const r = await bare("thanks bye");
  assert.equal(r.end, true);
  assert.match(r.answer, /Bye/i);
  assert.doesNotMatch(r.answer, /I'll remember/i);
});

test("a bare thanks with no farewell beside it still acknowledges without ending the session", async () => {
  const r = await bare("thanks");
  assert.notEqual(r.end, true);
  assert.match(r.answer, /Any time/i);
});

test("\"alright, thats enough for now, thanks\" gets a warm closing acknowledgement instead of the grammar wall", async () => {
  const r = await bare("alright, thats enough for now, thanks");
  assert.match(r.answer, /Any time/i);
  assert.doesNotMatch(r.answer, /couldn't read that as a question/i);
});

// ---- #7: small-talk/opinion questions walling inconsistently ----

test("\"do you ever get tired\" gets the same no-feelings decline as \"how are you doing today\"", async () => {
  const r = await bare("do you ever get tired");
  assert.match(r.answer, /don't have feelings/i);
});

test("\"do you think dogs are smarter than cats\" (an opinion comparison) gets the no-feelings decline, not a wall", async () => {
  const r = await bare("do you think dogs are smarter than cats");
  assert.match(r.answer, /don't have feelings/i);
});

test("\"haha ok fair enough\" (a laughter beat leading a two-word ack) gets a thanks-style reply, not a wall", async () => {
  const r = await bare("haha ok fair enough");
  assert.match(r.answer, /Any time/i);
});

test("\"can I ask you something random\" (a permission-seeking preamble) gets the orientation card, not a wall", async () => {
  const r = await bare("can I ask you something random");
  assert.match(r.answer, /deterministic, offline code-graph assistant/i);
});

// ---- #8: "can you make up an answer if you don't know" ----

test("a direct probe of the honest-miss promise (\"can you make up an answer if you dont actually know\") confirms it on-brand instead of walling", async () => {
  const r = await bare("can you make up an answer if you dont actually know");
  assert.match(r.answer, /never make up an answer/i);
  assert.doesNotMatch(r.answer, /couldn't read that as a question/i);
});

// ---- a resolvable vague-touch opener reaches the describe path, not the card ----

test("a misspelled vague-touch opener whose term resolves uniquely (\"wat about validate\") answers the module, not the orientation card", async () => {
  const r = await onMiniWebapp("wat about validate");
  assert.match(r.answer, /validate\.mjs/);
  assert.doesNotMatch(r.answer, /deterministic, offline code-graph assistant/i);
  assert.equal(r.record.miss, false);
});

test("a vague-touch opener whose term resolves to nothing (\"wat about xyzzy\") stays on the orientation card", async () => {
  const r = await onMiniWebapp("wat about xyzzy");
  assert.match(r.answer, /deterministic, offline code-graph assistant/i);
});

// ---- colloquial identity questions: a greeting frame, and a comma-joined tail ----

test("an identity question behind a greeting frame (\"hello there, what am I talking to?\") gets the self-description, not a module lookup for \"I\"", async () => {
  const r = await bare("hello there, what am I talking to?");
  assert.match(r.answer, /deterministic, offline chat assistant/i);
  assert.doesNotMatch(r.answer, /no module matching/i);
  assert.equal(r.record.miss, false);
});

test("an identity question with an inserted adverb and a self-referential tail (\"what even is this thing, like what does it do?\") gets the self-description", async () => {
  const r = await bare("what even is this thing, like what does it do?");
  assert.match(r.answer, /deterministic, offline chat assistant/i);
  assert.equal(r.record.miss, false);
});

test("a bare \"what is this?\" still gets the self-description once the adverb slot is optional", async () => {
  const r = await bare("what is this?");
  assert.match(r.answer, /deterministic, offline chat assistant/i);
  assert.equal(r.record.miss, false);
});

test("an identity clause comma-joined to a REAL graph question keeps the graph answer — the clause split never swallows the second half", async () => {
  const r = await onMiniWebapp("what is this, and which modules import validate.mjs");
  assert.match(r.answer, /validate\.mjs/);
  assert.doesNotMatch(r.answer, /deterministic, offline chat assistant/i);
  assert.equal(r.record.miss, false);
});

// ---- orientation questions with "I" as the subject, not "you" ----

test("\"what can I ask you?\" gets the orientation card, not a graph query on the bare \"I\"", async () => {
  const r = await bare("what can I ask you?");
  assert.match(r.answer, /deterministic, offline code-graph assistant/i);
  assert.equal(r.record.miss, false);
});

test("\"what questions can I ask?\" gets the orientation card", async () => {
  const r = await bare("what questions can I ask?");
  assert.match(r.answer, /deterministic, offline code-graph assistant/i);
  assert.equal(r.record.miss, false);
});

test("\"what kind of questions can I ask about this codebase?\" gets the orientation card", async () => {
  const r = await bare("what kind of questions can I ask about this codebase?");
  assert.match(r.answer, /deterministic, offline code-graph assistant/i);
  assert.equal(r.record.miss, false);
});

test("\"how do I get started with this?\" reaches the same orientation answer the untailed \"how do I get started\" already did", async () => {
  const tailed = await bare("how do I get started with this?");
  const bareForm = await bare("how do I get started?");
  assert.equal(tailed.answer, bareForm.answer);
  assert.equal(tailed.record.miss, false);
  assert.doesNotMatch(tailed.answer, /couldn't parse this as a graph question/i);
});
