// chat-smalltalk-banner-1.8.14.test.mjs — BENCHMARK_CONVERSATION_1.8.14.md item 12
// (pure-small-talk persona): direct personal questions ("how are you doing today",
// "what's your favorite color", "do you get bored", "what do you do for fun", "can
// you tell jokes", "do you know about movies or sports") almost all hit the bare
// grammar wall instead of an honest, on-brand personality decline — the SAME
// FEELINGS_PHRASES closed set already exists for exactly this family (added for
// HANDOVER.md 2026-07-10 item 10's "do you have feelings"), it just didn't cover
// these particular phrasings yet. Widened additively (chat.mjs), same discipline
// CAPABILITY_PHRASES' own docblock names ("keeps growing as new natural phrasings
// surface, never a general rule").
//
// Also covers the scripted pivot line the persona was built to test: "ok well I
// guess you're a code thing, what can you actually help with". The CLEAN tail
// ("what can you actually help with") reaches the capability banner via a new
// CAPABILITY_PHRASES entry ("help (me)? with" as a synonym tail for "do" — only
// bare "help"/"help me" with no object was covered before). The FULL verbatim line
// (with its long leading declarative clause) still hits the wall — see the guard
// test below, which documents this as a deliberate non-fix: no existing closed-set
// preamble stripper (GREETING_PREAMBLE_RE/ACK_PREAMBLE_RE/MODAL_WRAPPER_RE,
// normalize.mjs) covers an arbitrary multi-word declarative lead like "ok well I
// guess X,", and inventing one would be an open-ended general clause parser, not a
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

test("direct personal questions get the honest personality decline, not the bare grammar wall", async () => {
  const g = await graph();
  const queries = [
    "how are you doing today",
    "whats your favorite color",
    "do you get bored",
    "what do you do for fun",
    "can you tell jokes",
    "do you know about movies or sports",
  ];
  for (const q of queries) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.match(r.answer, /^No — I don't have feelings/, `"${q}" gets the feelings/personal-decline template`);
    assert.doesNotMatch(r.answer, /couldn't parse this as a graph question/, `"${q}" must never hit the bare grammar wall`);
    assert.equal(r.record.miss, false);
  }
});

test("'what can you actually help with' (the clean capability pivot) reaches the orientation banner", async () => {
  const g = await graph();
  for (const q of ["what can you help with", "what can you actually help with", "so what can you help with"]) {
    const r = await runTurn(q, { config: CONFIG, graph: g });
    assert.match(r.answer, /^I'm tmct/, `"${q}" reaches the capability card`);
    assert.equal(r.record.miss, false);
  }
});

test("guard/documented gap: the FULL scripted pivot line, with its long leading declarative clause, still hits the wall — no closed-set preamble strip covers it", async () => {
  const g = await graph();
  const r = await runTurn("ok well I guess you're a code thing, what can you actually help with", { config: CONFIG, graph: g });
  assert.match(r.answer, /couldn't parse this as a graph question/);
});
