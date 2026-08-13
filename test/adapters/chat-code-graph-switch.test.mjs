// Whether a turn is about a code graph is DECLARED, never read out of the
// wording. `/code-graph on|off` (or the `codeGraphMode` option a host sets) is
// the only gate: no full stop, decimal, date slash or ordinary English word
// makes a line structural, and no loaded graph turns the mode on by itself.
//
// Two rules hold either side of the switch. Off, no answer may reach for
// code-graph vocabulary at all — a question that needed the code lane lands on
// the ordinary miss wall. On with no code graph behind the session, the turn
// reports that as an error rather than offering a way to go and get one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { runTurn, createSession, isConversational } from "../../src/services/chat.mjs";

// A loaded graph carrying zero modules — the shape that used to earn the
// "index it with `tmct index`" suffix.
const EMPTY_PAYLOAD = buildEntities([], []);
const EMPTY_GRAPH = parseEntities(EMPTY_PAYLOAD);

// One real module, so the switch has something to be on ABOUT.
const REAL_PAYLOAD = buildEntities([
  { path: "src/walk.mjs", dotted: "walk", imports: [], calls: [], defines: [{ name: "walk", kind: "function", lineno: 1, decorators: [] }] },
], []);
const REAL_GRAPH = parseEntities(REAL_PAYLOAD);

// The wording no answer may reach for while the switch is off.
const CODE_GRAPH_VOCABULARY = /code graph|tmct index|--repo|example:mini|graph\.json/i;

async function freshRepo(payload) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-code-graph-switch-"));
  const file = join(dir, "graph.json");
  await writeFile(file, JSON.stringify(payload));
  return { dir, config: { graphFile: file } };
}

// Ordinary English the old heuristic misread as "about code": a sentence-ending
// full stop, a decimal, a date slash, an abbreviation, and the everyday words
// (use, class, history, test, contains, members) it kept in its structural set.
const PLAIN_ENGLISH = [
  "A poodle is a dog.",
  "It costs 3.50",
  "Meet me on 12/05",
  "Dr. Smith is a vet",
  "Where is my keys",
  "I use a spoon to eat soup",
  "I went to my yoga class",
  "Tell me about the history of Rome",
  "I need a blood test",
  "That box contains apples",
  "Members of the club pay a fee",
];

test("with the switch off, ordinary English never draws code-graph vocabulary into the answer", async () => {
  const { dir, config } = await freshRepo(EMPTY_PAYLOAD);
  try {
    for (const line of PLAIN_ENGLISH) {
      const { answer } = await runTurn(line, { config, graph: EMPTY_GRAPH, memoryDir: dir });
      assert.doesNotMatch(answer, CODE_GRAPH_VOCABULARY, `"${line}" must not be answered in code-graph terms`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with the switch off, a genuinely code-shaped line also stays clear of code-graph vocabulary", async () => {
  const { dir, config } = await freshRepo(EMPTY_PAYLOAD);
  try {
    for (const line of ["which modules import store.mjs", "what calls buildContextBundle()", "where is walk.mjs defined"]) {
      const { answer } = await runTurn(line, { config, graph: EMPTY_GRAPH, memoryDir: dir });
      assert.doesNotMatch(answer, CODE_GRAPH_VOCABULARY, `"${line}" misses on the ordinary wall while the switch is off`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with the switch on and no code graph behind the session, the turn reports the error and offers no remedy", async () => {
  const { dir, config } = await freshRepo(EMPTY_PAYLOAD);
  try {
    const { answer, record } = await runTurn("which modules import store.mjs", {
      config, graph: EMPTY_GRAPH, memoryDir: dir, codeGraphMode: true,
    });
    assert.match(answer, /code-graph mode is on, but this session has no code graph behind it\./);
    assert.doesNotMatch(answer, /tmct index|--repo|example:mini/i, "an error names the failure, not a way to go and fix it");
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with the switch on and a real code graph loaded, a resolvable question answers as usual", async () => {
  const { dir, config } = await freshRepo(REAL_PAYLOAD);
  try {
    const { answer } = await runTurn("where is walk defined", { config, graph: REAL_GRAPH, memoryDir: dir, codeGraphMode: true });
    assert.match(answer, /src\/walk\.mjs/);
    assert.doesNotMatch(answer, /no code graph behind it/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/code-graph on|off rides the turn result, and a bare /code-graph reports the state without flipping it", async () => {
  const { dir, config } = await freshRepo(REAL_PAYLOAD);
  try {
    const on = await runTurn("/code-graph on", { config, graph: REAL_GRAPH, memoryDir: dir });
    assert.equal(on.codeGraphMode, true);
    assert.match(on.answer, /code-graph mode on\./);

    const off = await runTurn("/code-graph off", { config, graph: REAL_GRAPH, memoryDir: dir, codeGraphMode: true });
    assert.equal(off.codeGraphMode, false);
    assert.match(off.answer, /code-graph mode off\./);

    const status = await runTurn("/code-graph", { config, graph: REAL_GRAPH, memoryDir: dir, codeGraphMode: true });
    assert.equal(status.codeGraphMode, undefined, "a bare /code-graph never flips the state");
    assert.match(status.answer, /code-graph mode is on — \/code-graph on or \/code-graph off/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/code-graph on with no code graph loaded sets the mode and says the graph is missing", async () => {
  const { dir, config } = await freshRepo(EMPTY_PAYLOAD);
  try {
    const on = await runTurn("/code-graph on", { config, graph: EMPTY_GRAPH, memoryDir: dir });
    assert.equal(on.codeGraphMode, true, "the caller's declaration stands whatever happens to be loaded");
    assert.match(on.answer, /code-graph mode on\. code-graph mode is on, but this session has no code graph behind it\./);
    assert.equal(on.record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a session starts with the switch off and holds what /code-graph sets, turn to turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-code-graph-session-"));
  try {
    const session = await createSession({ repoPath: dir, ephemeral: true });
    try {
      assert.equal(session.codeGraphMode, false, "a session never infers the mode from what it loaded");
      await session.turn("/code-graph on");
      assert.equal(session.codeGraphMode, true);
      await session.turn("/code-graph off");
      assert.equal(session.codeGraphMode, false);
    } finally {
      await session.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a host can declare the mode at session creation without typing a command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-code-graph-session-"));
  try {
    const session = await createSession({ repoPath: dir, ephemeral: true, codeGraphMode: true });
    try {
      assert.equal(session.codeGraphMode, true);
    } finally {
      await session.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the exported isConversational reads the same declared switch, and nothing else", () => {
  assert.equal(isConversational("what calls walk"), true, "short and undeclared — ordinary prose");
  assert.equal(isConversational("what calls walk", { codeGraphMode: true }), false);
  assert.equal(isConversational("A poodle is a dog."), false, "five words, and the full stop decides nothing");
});
