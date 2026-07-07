// narrate mode — the operator's "let's be a lot more verbose, you and I are the
// only users" request: an opt-in developer/debug surface that appends a
// human-readable "--- narrate ---" block (decision points, the matched pattern,
// results + sources, a deduced per-turn goal, intermediate/near-miss detail) to
// the answer. Default OFF, so the two things this suite must prove above all:
//   1. narrate OFF is BYTE-IDENTICAL to plain runTurn (the ~1040+ existing tests
//      exercise the default path and must never see a behaviour change);
//   2. narrate ON visibly annotates a few different turn shapes without ever
//      touching `last.answer` (why/say-more + repeat-detection compare that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn, createSession, NARRATE_MARKER } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { clearCache } from "../src/source.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

/** A fixture-backed temp repo createSession can load a real graph from (mirrors
 *  chat-session.test.mjs / chat-ephemeral.test.mjs's helper). */
async function repoWithFixtureGraph(tag) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-narrate-${tag}-`));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}

// ---- 1. narrate OFF is byte-identical (the critical regression guard) ----

test("narrate OFF (default, and explicit narrate:false): byte-identical to plain runTurn, no marker anywhere", async () => {
  const g = await graph();
  const queries = [
    "which modules import a.mjs",
    "list classes",
    "tell me a joke",
    "can you describe Widget for me",
    "hello",
    "/stats",
    "/describe Widget",
    "how many classes are there",
  ];
  // Blank out ISO timestamps (record.ts, logLines[0]) — the one thing that
  // legitimately differs between two SEPARATE calls (each runTurn stamps its
  // own `new Date().toISOString()`). Every other byte of
  // answer/logLines/record/detail/focus/last must match exactly.
  const ISO_RE = /"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/g;
  const blankTs = (r) => JSON.stringify(r).replace(ISO_RE, '"<ts>"');
  for (const q of queries) {
    const plain = await runTurn(q, { config: CONFIG, graph: g });
    const explicitOff = await runTurn(q, { config: CONFIG, graph: g, narrate: false });
    assert.equal(blankTs(explicitOff), blankTs(plain), `narrate:false must be byte-identical to omitting it for "${q}" (modulo per-call timestamps)`);
    assert.doesNotMatch(plain.answer, new RegExp(NARRATE_MARKER.replace(/[-]/g, "\\-")), `no marker leaks into the default path for "${q}"`);
    assert.equal(plain.narrate, undefined, `no stray "narrate" field on a non-toggle turn for "${q}"`);
  }
});

// ---- 2. narrate ON annotates several different turn shapes ----

test("narrate ON: a resolved reverse/composed query gets goal + decision + pattern + result sections", async () => {
  const g = await graph();
  const r = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g, narrate: true });
  assert.ok(r.answer.includes(NARRATE_MARKER), "the narrate block is appended");
  const [answer, narration] = r.answer.split(`\n\n${NARRATE_MARKER}`);
  assert.ok(answer.length, "the real answer still leads");
  assert.match(narration, /goal:.*import/i, "goal deduction names the import relationship");
  assert.match(narration, /decision: via=composed/, "decision names the via band that answered");
  assert.match(narration, /pattern: parsed AST.*kind=imports/, "the matched AST/kind is surfaced");
  assert.match(narration, /result:/, "a results section is present");
});

test("narrate ON: a compositional list query is annotated with a list/enumerate goal", async () => {
  const g = await graph();
  const r = await runTurn("list classes", { config: CONFIG, graph: g, narrate: true });
  assert.ok(r.answer.includes(NARRATE_MARKER));
  assert.match(r.answer, /goal:.*(list|enumerate)/i);
  assert.match(r.answer, /pattern: parsed AST — node=list/);
});

test("narrate ON: an outright miss is annotated honestly — no fabricated goal/pattern", async () => {
  const g = await graph();
  const r = await runTurn("tell me a joke", { config: CONFIG, graph: g, narrate: true });
  assert.equal(r.record.miss, true);
  assert.ok(r.answer.includes(NARRATE_MARKER));
  assert.match(r.answer, /goal: unclear — the phrasing didn't resolve to a known query shape/);
  assert.match(r.answer, /decision: via=miss \(miss\)/);
  assert.match(r.answer, /pattern: no parse stood/);
});

test("narrate ON: the describe-wrapper RESCUE lane names itself explicitly", async () => {
  const g = await graph();
  const r = await runTurn("can you describe Widget for me", { config: CONFIG, graph: g, narrate: true });
  assert.equal(r.record.via, "describe");
  assert.ok(r.answer.includes(NARRATE_MARKER));
  assert.match(r.answer, /lane: \(4d\) DESCRIBE-WRAPPER RESCUE/);
  assert.match(r.answer, /decision: via=describe/);
});

test("narrate ON: a slash-command reuses its own COMMANDS help text as the goal, and reports resolution", async () => {
  const g = await graph();
  const r = await runTurn("/describe Widget", { config: CONFIG, graph: g, narrate: true });
  assert.ok(r.answer.includes(NARRATE_MARKER));
  assert.match(r.answer, /goal: a symbol's definition, kind and relations/);
  assert.match(r.answer, /lane: slash-command \/describe/);
  assert.match(r.answer, /result: resolved "Widget" -> Widget \(cls-widget/);
});

test("narrate ON: a conversational turn (bypasses withLast) is still annotated", async () => {
  const g = await graph();
  const r = await runTurn("hello", { config: CONFIG, graph: g, narrate: true });
  assert.ok(r.answer.includes(NARRATE_MARKER));
  assert.match(r.answer, /goal: casual\/social/);
  assert.match(r.answer, /lane: conversational — greeting/);
});

// ---- 3. narrate never touches `last.answer` / repeat-detection ----

test("narrate ON: the narrate block is appended to the OUTWARD answer only — `last.answer` stays exactly what narrate:false would have produced", async () => {
  const g = await graph();
  const off = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  const on = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g, narrate: true });
  assert.ok(on.answer.includes(NARRATE_MARKER), "the printed answer is narrated");
  assert.equal(on.last.answer, off.last.answer, "the remembered `last.answer` is identical whether narrate is on or off");
  assert.ok(!on.last.answer.includes(NARRATE_MARKER), "`last.answer` never carries the narrate block");
});

test("narrate ON: why/say-more re-renders the clean (pre-narration) previous answer", async () => {
  const g = await graph();
  const hit = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g, narrate: true });
  const why = await runTurn("why", { config: CONFIG, graph: g, last: hit.last, narrate: true });
  // the expansion re-renders hit.last.answer (clean) — never a narrate block nested inside a narrate block
  const beforeItsOwnMarker = why.answer.split(NARRATE_MARKER)[0];
  assert.ok(!beforeItsOwnMarker.includes("--- narrate ---"), "no nested/duplicated narrate block from the expanded answer");
});

// ---- 4. the /narrate on|off slash command (bare runTurn threading, mirrors /focus) ----

test("/narrate on|off toggles and rides the turn result the same way /focus rides `focus`", async () => {
  const g = await graph();
  const status = await runTurn("/narrate", { config: CONFIG, graph: g });
  assert.match(status.answer, /narrate mode is off/);
  assert.equal(status.narrate, undefined, "a status-only /narrate changes nothing");

  const on = await runTurn("/narrate on", { config: CONFIG, graph: g });
  assert.match(on.answer, /narrate mode on\./);
  assert.equal(on.narrate, true);

  const off = await runTurn("/narrate off", { config: CONFIG, graph: g });
  assert.match(off.answer, /narrate mode off\./);
  assert.equal(off.narrate, false);

  const statusOn = await runTurn("/narrate", { config: CONFIG, graph: g, narrate: true });
  assert.match(statusOn.answer, /narrate mode is on/);
});

// ---- 5. session-level: createSession's narrate option / TMCT_NARRATE, and the
// /narrate on|off toggle persisting turn-to-turn through the session handle ----

test("createSession({ narrate: true }): the FIRST turn is already narrated", async () => {
  const repo = await repoWithFixtureGraph("opt");
  try {
    clearCache();
    const s = await createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1" }, ephemeral: true, narrate: true });
    assert.equal(s.narrate, true, "the handle reports narrate is on before any turn");
    const r = await s.turn("which modules import a.mjs");
    assert.ok(r.answer.includes(NARRATE_MARKER), "narrate was already on for turn 1");
    await s.close();
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});

test("createSession: TMCT_NARRATE=1 in the env has the same effect as the option", async () => {
  const repo = await repoWithFixtureGraph("env");
  try {
    clearCache();
    const s = await createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1", TMCT_NARRATE: "1" }, ephemeral: true });
    assert.equal(s.narrate, true);
    const r = await s.turn("list classes");
    assert.ok(r.answer.includes(NARRATE_MARKER));
    await s.close();
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});

test("createSession: default narrate is OFF, and /narrate on|off mutates the handle's state turn-to-turn", async () => {
  const repo = await repoWithFixtureGraph("toggle");
  try {
    clearCache();
    const s = await createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1" }, ephemeral: true });
    assert.equal(s.narrate, false, "off by default");

    const r1 = await s.turn("which modules import a.mjs");
    assert.ok(!r1.answer.includes(NARRATE_MARKER), "off by default — first turn unnarrated");

    await s.turn("/narrate on");
    assert.equal(s.narrate, true, "the handle's narrate state flips after /narrate on");

    const r2 = await s.turn("which modules import a.mjs");
    assert.ok(r2.answer.includes(NARRATE_MARKER), "the VERY NEXT turn is narrated");

    await s.turn("/narrate off");
    assert.equal(s.narrate, false);
    const r3 = await s.turn("which modules import a.mjs");
    assert.ok(!r3.answer.includes(NARRATE_MARKER), "narrate off again — unnarrated");

    await s.close();
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});
