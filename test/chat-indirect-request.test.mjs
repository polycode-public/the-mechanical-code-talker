// Bug F (operator follow-up request, this session): closed-set indirect-request
// wrapper stripping + a goal-inference generalization. Five sub-points, see
// chat.mjs's TEACH_RE / asBareCommand / INDIRECT_REQUEST_RE / describeWrapperAnswer
// (DESCRIBE_WRAPPER_RE) / GOAL_BY_COMMAND docblocks for the design:
//   1. "I want you to remember X" / "I'd like you to remember X" teaches like "remember X".
//   2. "search for X" (bare) strips the leading "for" filler before it becomes the search term.
//   3. "I want you to search for X" strips the whole lead-in centrally, before asBareCommand runs.
//   4. "please tell me X" (no "about") answers like "describe X"/"what is X".
//   5. Command dispatches (search/find/describe/…) now carry their own "Goal (inferred): …" line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-indirect-${tag}-`));
const stripGoal = (s) => s.replace(/\n\nGoal \(inferred\):.*$/s, "");

test("Bug F point 1: 'I want you to remember X had soup' teaches identically to 'remember X had soup'", async () => {
  const dir = await mem("f1");
  try {
    const baseline = await runTurn("remember tony had soup", { config: CONFIG, memoryDir: dir, sessionId: "f1a" });
    for (const q of ["I want you to remember tony had soup", "I wanted you to remember tony had soup", "I'd like you to remember tony had soup", "I would like you to remember tony had soup"]) {
      const dir2 = await mem("f1b");
      try {
        const r = await runTurn(q, { config: CONFIG, memoryDir: dir2, sessionId: "f1b" });
        assert.equal(stripGoal(r.answer), stripGoal(baseline.answer), `"${q}" should teach identically to "remember tony had soup"`);
        assert.doesNotMatch(r.answer, /haves soup/, "Bug A's fix still applies through the indirect wrapper");
        const rows = readFactRows(await loadMemory(dir2));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].predicate, "mgx:hasA");
      } finally {
        clearCache();
        await rm(dir2, { recursive: true, force: true });
      }
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug F point 2: 'search for Widget' (bare) resolves the actual entity, not a literal 'for Widget' search", async () => {
  const r = await runTurn("search for Widget", { config: CONFIG, graph: GRAPH });
  assert.equal(r.record.command, "search");
  assert.equal(r.record.miss, false);
  assert.match(r.answer, /Widget/);
  assert.doesNotMatch(r.answer, /no module matches "for Widget"/);
});

test("Bug F point 2: 'search for the payment controller' isn't wrongly rejected as too long just because 'for' used up a token", async () => {
  // 4 words WITH "for", 3 without — asBareCommand's <=3-token cap must be
  // checked against the STRIPPED remainder, not the original.
  const r = await runTurn("search for the payment controller", { config: CONFIG, graph: GRAPH });
  assert.equal(r.record.command, "search", "still routed as a command dispatch, not left to fall through unrouted");
});

test("Bug F point 3: 'I want you to search for Widget' strips the lead-in centrally, before asBareCommand runs", async () => {
  const direct = await runTurn("search for Widget", { config: CONFIG, graph: GRAPH });
  for (const q of ["I want you to search for Widget", "I'd like you to search for Widget"]) {
    const r = await runTurn(q, { config: CONFIG, graph: GRAPH });
    assert.equal(r.record.command, "search", `"${q}" should dispatch /search, not fall into the teach lane`);
    assert.equal(stripGoal(r.answer), stripGoal(direct.answer), `"${q}" should resolve exactly like the bare "search for Widget"`);
    // record.query/logLines preserve the ORIGINAL raw text, for transcript fidelity.
    assert.equal(r.record.query, q);
    assert.equal(r.logLines[1], `> ${q}`);
  }
});

test("Bug F point 3 no-regression: 'I want you to remember X' never gets caught by the pronoun-subject teach guard (the pre-fix symptom)", async () => {
  const dir = await mem("f3-noregress");
  try {
    const r = await runTurn("I want you to remember tony has a hat", { config: CONFIG, memoryDir: dir, sessionId: "f3" });
    assert.doesNotMatch(r.answer, /pronouns aren't things I can classify/, "must never be mis-swallowed as a bare <subject> <verb> <object> teach triple with subject \"I\"");
    assert.match(r.answer, /^noted — remembered: tony has hat/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug F point 4: 'please tell me about Widget' and 'please tell me Widget' (no 'about') both answer like describe/what-is", async () => {
  const a = await runTurn("please tell me about Widget", { config: CONFIG, graph: GRAPH });
  const b = await runTurn("please tell me Widget", { config: CONFIG, graph: GRAPH });
  assert.equal(a.record.via, "describe");
  assert.equal(b.record.via, "describe");
  assert.equal(stripGoal(a.answer), stripGoal(b.answer));
  assert.match(b.answer, /^Widget/);
});

test("Bug F point 4 guard: 'tell me a joke' and 'tell me about <enumerable concept>' keep their existing (non-describe) behavior", async () => {
  const joke = await runTurn("tell me a joke", { config: CONFIG, graph: GRAPH });
  assert.notEqual(joke.record.via, "describe");
  const concept = await runTurn("tell me about inheritance", { config: CONFIG, graph: GRAPH });
  assert.notEqual(concept.record.via, "describe", "the relation/concept force's own richer answer must still win, never shadowed by the describe rescue");
});

test("Bug F point 5: a /search command dispatch now carries a Goal (inferred) line where it previously had none", async () => {
  const r = await runTurn("/search Widget", { config: CONFIG, graph: GRAPH });
  assert.equal(r.record.command, "search");
  assert.match(r.answer, /Goal \(inferred\): Locate a specific named entity\./);
});

test("Bug F point 5: /describe reuses distinct wording from /search — a real, honest goal per command, not one generic line for everything", async () => {
  const r = await runTurn("/describe Widget", { config: CONFIG, graph: GRAPH });
  assert.match(r.answer, /Goal \(inferred\): Look up a symbol's definition and relations\./);
});

test("Bug F point 5: /members and /subclasses reuse GOAL_BY_KIND's existing contains/inherits wording verbatim", async () => {
  const members = await runTurn("/members Widget", { config: CONFIG, graph: GRAPH });
  assert.match(members.answer, /Goal \(inferred\): Understand class membership \(methods\/attributes\)\./);
  const subclasses = await runTurn("/subclasses Base", { config: CONFIG, graph: GRAPH });
  assert.match(subclasses.answer, /Goal \(inferred\): Understand a class hierarchy\/inheritance relationship\./);
});

test("Bug F point 5: a command with no bespoke entry (/stats) falls back to the short generic goal line", async () => {
  const r = await runTurn("/stats", { config: CONFIG, graph: GRAPH });
  assert.match(r.answer, /Goal \(inferred\): Use a specific tool\/command directly\./);
});
