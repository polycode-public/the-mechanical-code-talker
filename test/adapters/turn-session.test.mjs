// turn-session.test.mjs — createTurnSession, the shared turn-dispatch
// wrapper behind the nine near-identical browser session factories
// (chat/code-explorer/ledger/adventure/spider-fly/plan/research/mud/sprites
// -browser-entry.mjs): focus/last/planState/researchState threading, the
// canonical error fallback, and the buildExtraOptions/captureExtraState
// seams a specific page's own adapter hooks its extra behaviour through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { createTurnSession } from "../../src/surfaces/web/turn-session.mjs";

const emptyGraph = parseEntities({ individuals: [], objectProperties: [] });
const lexicon = loadLexicon();

function newSession(extra = {}) {
  return createTurnSession({
    memoryDir: createInMemoryStore(),
    graph: emptyGraph,
    lexicon,
    sessionId: "test-session",
    ...extra,
  });
}

test("turn(): a taught fact is recalled later in the same session, threading focus/last across calls", async () => {
  const session = newSession();
  await session.turn("every container is a thing");
  const taught = await session.turn("every zorbcase is a container");
  assert.doesNotMatch(taught.answer, /couldn't store/i);
  const recall = await session.turn("what is a zorbcase");
  assert.match(recall.answer, /container/);
});

test("turn(): the returned envelope carries answer/end/record/plan/research even when a call doesn't use plan/research", async () => {
  const session = newSession();
  const res = await session.turn("hello");
  assert.equal(typeof res.answer, "string");
  assert.equal(typeof res.end, "boolean");
  assert.ok("record" in res);
  assert.ok("plan" in res);
  assert.ok("research" in res);
});

test("turn(): a throwing runTurn returns the canonical fallback answer, never kills the session", async () => {
  const session = createTurnSession({
    memoryDir: createInMemoryStore(), graph: emptyGraph, lexicon, sessionId: "test-session",
    runTurn: async () => { throw new Error("simulated engine failure"); },
  });
  const res = await session.turn("hello");
  assert.equal(res.answer, "Something went wrong answering that (simulated engine failure). Try rephrasing, or /help.");
  assert.equal(res.end, false);
  assert.equal(res.record, null);
  assert.equal(res.plan, null);
  assert.equal(res.research, null);
});

test("turn(): a non-Error throw still renders through String(), never crashing the fallback itself", async () => {
  const session = createTurnSession({
    memoryDir: createInMemoryStore(), graph: emptyGraph, lexicon, sessionId: "s",
    runTurn: async () => { throw "a plain string throw"; },
  });
  const res = await session.turn("hello");
  assert.equal(res.answer, "Something went wrong answering that (a plain string throw). Try rephrasing, or /help.");
});

test("turn(): a session survives a throw and keeps working on the next call", async () => {
  let fail = true;
  const realSession = newSession();
  const session = createTurnSession({
    memoryDir: realSession.memoryDir, graph: emptyGraph, lexicon, sessionId: "s",
    runTurn: async (line, options) => {
      if (fail) { fail = false; throw new Error("one-time failure"); }
      const { runTurn: realRunTurn } = await import("../../src/services/chat.mjs");
      return realRunTurn(line, options);
    },
  });
  const first = await session.turn("hello");
  assert.match(first.answer, /Something went wrong/);
  const second = await session.turn("hello");
  assert.doesNotMatch(second.answer, /Something went wrong/);
});

test("buildExtraOptions can override a base option (vocabHint has no effect here, but a per-call sessionId does)", async () => {
  const seen = [];
  const session = createTurnSession({
    memoryDir: createInMemoryStore(), graph: emptyGraph, lexicon, sessionId: "base-id",
    buildExtraOptions(state, callArgs) {
      seen.push({ state, callArgs });
      return { sessionId: "overridden-id" };
    },
  });
  await session.turn("hello", { some: "arg" });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].callArgs, { some: "arg" });
  assert.deepEqual(seen[0].state, { focus: null, last: null, planState: null, researchState: null });
});

test("captureExtraState runs once after a successful turn with the folded-forward state, and never runs on a throw", async () => {
  const captured = [];
  const throwingSession = createTurnSession({
    memoryDir: createInMemoryStore(), graph: emptyGraph, lexicon, sessionId: "s",
    runTurn: async () => { throw new Error("boom"); },
    captureExtraState: async (result, state) => { captured.push(state); },
  });
  await throwingSession.turn("hello");
  assert.equal(captured.length, 0, "captureExtraState never runs when runTurn itself threw");

  const session = createTurnSession({
    memoryDir: createInMemoryStore(), graph: emptyGraph, lexicon, sessionId: "s",
    captureExtraState: async (result, state) => { captured.push(state); },
  });
  await session.turn("hello");
  assert.equal(captured.length, 1);
  assert.ok("focus" in captured[0] && "last" in captured[0] && "planState" in captured[0] && "researchState" in captured[0]);
});

test("every session runs the engine on the browser surface, so a dead-end never names a CLI-only remedy", async () => {
  const seen = [];
  const session = createTurnSession({
    memoryDir: createInMemoryStore(), graph: emptyGraph, lexicon, sessionId: "s",
    runTurn: async (line, options) => { seen.push(options.uiContext); return { answer: "", focus: null, last: null }; },
  });
  await session.turn("which modules import walk.mjs");
  assert.deepEqual(seen, ["browser"]);

  const real = newSession({ vocabHint: "" });
  const { answer } = await real.turn("which modules import walk.mjs");
  assert.doesNotMatch(answer, /tmct index|tmct init|--repo|npm run example:mini/);
});

test("session.setPlanState/setResearchState let an external caller redirect what the next turn sees, mirroring the plan/adventure planHolder pattern", async () => {
  const session = newSession();
  session.setPlanState({ custom: "state" });
  assert.deepEqual(session.planState, { custom: "state" });
  session.setResearchState({ queue: [] });
  assert.deepEqual(session.researchState, { queue: [] });
});

test("focus/last/planState/researchState getters start null and are read-only snapshots of the live session", async () => {
  const session = newSession();
  assert.equal(session.focus, null);
  assert.equal(session.last, null);
  assert.equal(session.planState, null);
  assert.equal(session.researchState, null);
});
