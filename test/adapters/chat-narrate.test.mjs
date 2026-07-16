// narrate mode's library-surface invariants: the corpus templates lane pins
// what narrate SAYS (the annotated sections per turn shape); this file pins
// what rows cannot read — byte-identity of the default path, the purity of
// `last.answer`, and the createSession option/env/handle state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn, createSession, NARRATE_MARKER } from "../../src/chat.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import * as source from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

/** A fixture-backed temp repo createSession can load a real graph from. */
async function repoWithFixtureGraph(tag) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-narrate-${tag}-`));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}

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

test("/narrate on|off rides the bare runTurn result the same way /focus rides `focus`", async () => {
  const g = await graph();
  const status = await runTurn("/narrate", { config: CONFIG, graph: g });
  assert.equal(status.narrate, undefined, "a status-only /narrate changes nothing");
  const on = await runTurn("/narrate on", { config: CONFIG, graph: g });
  assert.equal(on.narrate, true);
  const off = await runTurn("/narrate off", { config: CONFIG, graph: g });
  assert.equal(off.narrate, false);
});

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
    await s.turn("/narrate on");
    assert.equal(s.narrate, true, "the handle's narrate state flips after /narrate on");
    await s.turn("/narrate off");
    assert.equal(s.narrate, false);
    await s.close();
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});
