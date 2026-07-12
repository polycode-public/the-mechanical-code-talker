// HANDOVER.md 2026-07-12 open item: bare "what is TaskController?" (a CamelCase
// COMPOUND class name, no article) used to hit the plain grammar wall even though
// "describe TaskController" / "what is a TaskController" (indefinite article) /
// "taskcontroller" (lowercased) all resolved correctly. Root cause: looksCodeish()
// flags any lowercase-to-uppercase transition ("skC" in TaskController) as
// code-ish, so isConversational() returns false and the whole
// isConversationalCandidate gate — including the bare-meta-fact fallback lanes
// (2b) that answer bare "what is X" without an article — never ran for this shape.
// Fixed via a narrow, scoped exemption (isBareCamelCaseMetaQuestion, chat.mjs)
// that ONLY widens lane (2b)'s own gate, never looksCodeish()/isConversational()
// themselves and never the generic orientation-card fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runTurn, isConversational } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/camelcase-whatis.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));
const mem = () => mkdtemp(join(tmpdir(), "tmct-camelcase-whatis-"));

test("bare 'what is TaskController?' (CamelCase compound, no article) names the known Class, not the generic orientation card or grammar wall", async () => {
  const r = await runTurn("what is TaskController?", { config: CONFIG, graph: GRAPH });
  assert.match(r.answer, /^TaskController is a class in this codebase/);
  assert.equal(r.record.miss, false);
  assert.doesNotMatch(r.answer, /I'm tmct — a deterministic/, "never the generic orientation card once a real entity exists");
});

test("bare 'what is TaskController?' resolves the byte-identical first line as the articled 'what is a TaskController'", async () => {
  const bare = await runTurn("what is TaskController?", { config: CONFIG, graph: GRAPH });
  const articled = await runTurn("what is a TaskController", { config: CONFIG, graph: GRAPH });
  assert.equal(bare.answer.split("\n")[0], articled.answer.split("\n")[0]);
});

test("unaffected siblings: 'describe TaskController' and lowercased 'what is taskcontroller' still resolve exactly as before", async () => {
  const described = await runTurn("describe TaskController", { config: CONFIG, graph: GRAPH });
  assert.match(described.answer, /^TaskController/);
  assert.equal(described.record.miss, false);

  const lowered = await runTurn("what is taskcontroller", { config: CONFIG, graph: GRAPH });
  assert.match(lowered.answer, /^TaskController is a class in this codebase/);
  assert.equal(lowered.record.miss, false);
});

test("a taught property fact about a CamelCase subject is now reachable through the bare adjective shape ('is TaskController deprecated')", async () => {
  const dir = await mem();
  try {
    await runTurn("TaskController is deprecated", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    const r = await runTurn("is TaskController deprecated", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^yes/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("guard: an UNKNOWN CamelCase term ('what is FooBarBazUnknown?') still declines honestly — never a guessed hit, never the generic orientation card", async () => {
  const r = await runTurn("what is FooBarBazUnknown?", { config: CONFIG, graph: GRAPH });
  assert.equal(r.record.miss, true);
  assert.doesNotMatch(r.answer, /I'm tmct — a deterministic/);
});

test("guard: genuine code fragments (dotted ref, call syntax) are UNCHANGED — looksCodeish()/isConversational() still exclude them everywhere else", () => {
  assert.equal(isConversational("foo.bar()"), false);
  assert.equal(isConversational("src/lib/a.mjs"), false);
  assert.equal(isConversational("what is import"), false, "STRUCT_WORDS keyword stays code-ish, unaffected by the CamelCase exemption");
});

test("guard: 'what is foo.bar()' (dotted call, not a plain CamelCase name) is unaffected — stays the ordinary structural miss, not a bareMetaHit", async () => {
  const r = await runTurn("what is foo.bar()", { config: CONFIG, graph: GRAPH });
  assert.equal(r.record.miss, true);
  assert.doesNotMatch(r.answer, /I'm tmct — a deterministic/);
});
