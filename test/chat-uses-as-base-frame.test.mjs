// archive/PLAN_CONVERSATION.md Finding 4 — the remaining gap, closed this
// session. test/chat-mid-sentence-interrogative.test.mjs already pins the
// FIRST-increment safety fix (a mid-sentence "which"/"what" no longer gets
// mistaught as a garbage fact, or misread as a pronoun-classification
// refusal). This file pins the SECOND increment: the discontiguous verb
// frame ("SUBJECT uses OBJECT as its base") is now actually ANSWERABLE, both
// as a teach and as a query, via chat.mjs's rewriteUsesAsBaseFrame — a raw-
// text rewrite (applied once, before any dispatch lane sees the turn) onto
// the ALREADY-WORKING "is a kind of" surface form (RELATIONS.inherits,
// ask-vocab.mjs), so the fix reuses the existing, separately-tested
// rdfs:subClassOf teach/yesno/forward-read mechanisms end to end instead of
// inventing a parallel one.
//
// Also pins the archived doc's OTHER named sub-problem — "a union-kind
// reverse-question capability for relation verbs like uses/calls that map to
// more than one stored predicate" — confirmed, by direct investigation this
// session, to be ALREADY RESOLVED as a side effect of the shipped
// hasMidSentenceInterrogative fix: KIND_UNIONS/kindsFor (ask.mjs) already
// apply uniformly to every reverse/forward traversal regardless of how the
// parse arrived, so once a mid-sentence "which"/"what" is correctly routed
// into the ask engine instead of teachLane, a union kind like "uses" answers
// exactly like a single-predicate kind always did. No KIND_UNIONS change was
// needed; the tests below just lock in the already-correct behavior so a
// future regression is caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { loadMemory, readFactRows, FACT_CLASS } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-uab-${tag}-`));

test("teach: 'Foo uses Bar as its base' stores the SAME rdfs:subClassOf shape 'Foo is a kind of Bar' already stores", async () => {
  const dir = await mem("teach-basic");
  try {
    const taught = await runTurn("Foo uses Bar as its base", { config: CONFIG, memoryDir: dir, sessionId: "s1" });
    assert.equal(taught.record.miss, false, `expected a real teach, got: ${taught.answer}`);
    assert.match(taught.answer, /foo is a kind of bar/i);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "foo");
    assert.equal(rows[0].predicate, "rdfs:subClassOf");
    assert.equal(rows[0].object, "bar");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ask (forward, WH-fronted): 'what does Foo use as its base?' answers from the just-taught fact — a real answer, not a miss", async () => {
  const dir = await mem("ask-forward");
  try {
    await runTurn("Foo uses Bar as its base", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    const asked = await runTurn("what does Foo use as its base?", { config: CONFIG, memoryDir: dir, sessionId: "s2" });
    assert.equal(asked.record.miss, false, `expected a real answer, got: ${asked.answer}`);
    assert.match(asked.answer, /foo is a kind of bar/i);
    assert.doesNotMatch(asked.answer, /couldn't parse this as a graph question/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ask (mid-sentence WH-object, Finding 4's exact repro shape): 'Foo uses which thing as its base' answers from the taught fact, not a miss and not a mistaught garbage fact", async () => {
  const dir = await mem("ask-wh-object");
  try {
    await runTurn("Foo uses Bar as its base", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    const asked = await runTurn("Foo uses which thing as its base", { config: CONFIG, memoryDir: dir, sessionId: "s3" });
    assert.equal(asked.record.miss, false, `expected a real answer, got: ${asked.answer}`);
    assert.match(asked.answer, /foo is a kind of bar/i);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1, "the WH-object question must never itself store a second (garbage) fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ask (yes/no): 'does Foo use Bar as its base' answers yes from the taught fact", async () => {
  const dir = await mem("ask-yesno");
  try {
    await runTurn("Foo uses Bar as its base", { config: CONFIG, memoryDir: dir, sessionId: "s4" });
    const asked = await runTurn("does Foo use Bar as its base", { config: CONFIG, memoryDir: dir, sessionId: "s4" });
    assert.equal(asked.record.miss, false);
    assert.match(asked.answer, /^yes/i);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reasonable qualifier variants ('as a base', 'as its parent', 'as base class', 'as parent class') all teach the same rdfs:subClassOf shape", async () => {
  const dir = await mem("variants");
  try {
    // The OBJECT is deliberately kept as the same already-proven-grounded
    // token ("Bar", used throughout this file) across all four qualifier
    // variants — an ungrounded/unfamiliar object word can land the teach on
    // a DIFFERENT, unrelated pre-existing fallback (a plain mgx:hasProperty
    // "X is Y" read, "kind of" folded away as noise) purely as a function of
    // whether the word is lexicon-grounded, independent of this fix's own
    // rewrite (confirmed live: e.g. "Foo is a kind of Snerk" already
    // collapses this way with NO "as its base" framing involved at all).
    // Only the SUBJECT varies here, to keep the four stored facts distinct.
    const cases = [
      ["Foo1 uses Bar as a base", "foo1", "bar"],
      ["Foo2 uses Bar as its parent", "foo2", "bar"],
      ["Foo3 uses Bar as base class", "foo3", "bar"],
      ["Foo4 uses Bar as parent class", "foo4", "bar"],
    ];
    for (const [text, subj, obj] of cases) {
      const r = await runTurn(text, { config: CONFIG, memoryDir: dir, sessionId: `variant-${subj}` });
      assert.equal(r.record.miss, false, `expected a real teach for "${text}", got: ${r.answer}`);
    }
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, cases.length);
    for (const [, subj, obj] of cases) {
      const row = rows.find((r) => r.subject === subj && r.object === obj);
      assert.ok(row, `expected a stored fact ${subj}/${obj}`);
      assert.equal(row.predicate, "rdfs:subClassOf");
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("plain 'does X use Y' (no \"as its base\" qualifier) still routes through the existing uses-union (imports+calls+callsSymbol) — the new frame never shadows it", async () => {
  const dir = await mem("uses-union-unaffected");
  try {
    const r = await runTurn("does app/functions/d/handler.mjs use app/lib/b.mjs", {
      config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "s5",
    });
    assert.match(r.answer, /^yes/i, `expected the ordinary uses-union yes/no answer, got: ${r.answer}`);
    assert.doesNotMatch(r.answer, /is a kind of/i, "must not be reinterpreted as an inherits/kind-of fact");

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 0, "a real graph-answerable uses-union question must never store a fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("plain 'X uses which module' (no \"as its base\" qualifier, mid-sentence WH-object) still answers via the uses-union — union reverse-question gap confirmed already resolved by hasMidSentenceInterrogative, no KIND_UNIONS change needed", async () => {
  const r = await runTurn("app/functions/d/handler.mjs uses which module", { config: CONFIG, graph: await graph(), sessionId: "s6" });
  assert.equal(r.record.miss, false, `expected a real answer, got: ${r.answer}`);
  assert.match(r.answer, /app\/lib\/b\.mjs/);
  assert.match(r.answer, /app\/lib\/c\.mjs/);
});

test("Finding 4's previously-shipped mis-teach safety behavior still holds: 'TaskController uses which controller as its base' (unknown subject, no matching fact) is an honest miss, never a stored garbage fact", async () => {
  const dir = await mem("safety-regress");
  try {
    const r = await runTurn("TaskController uses which controller as its base", {
      config: CONFIG, graph: await graph(), memoryDir: dir, sessionId: "s7",
    });
    assert.doesNotMatch(r.answer, /^noted — remembered/, `must never store a fact -> ${r.answer}`);
    assert.doesNotMatch(r.answer, /taskcontroller uses which controller/i);
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 0, "no fact of any kind may have been stored");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a genuine relative-clause 'which' declarative near the verb 'uses' is untouched (never mistaken for the discontiguous base-frame or an interrogative)", async () => {
  const dir = await mem("guard-relative-uses");
  try {
    const r = await runTurn("the module which uses Bar heavily is deprecated", { config: CONFIG, memoryDir: dir, sessionId: "s8" });
    assert.doesNotMatch(r.answer, /is a kind of/i);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
