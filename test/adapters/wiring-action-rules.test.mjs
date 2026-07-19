// Action-rule teach frames → stored Rule family (PLAN_HANOI Phase 1R).
//
//   - every action/renders sentence of the hanoi-3 worked example teaches, and
//     the stored family matches a hand-written expected shape exactly;
//   - two preconditions for the same action coexist as distinct Rule rows;
//   - question-lead and plain-pronoun sentences still decline;
//   - re-teaching a sentence is idempotent (content-addressed rule ids).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readRuleRows, findRulesByName, readFactRows } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

const ACTION_SENTENCES = [
  "you can move a disk onto a peg.",
  "you can move a disk onto a disk.",
  "to move a disk onto a target, nothing may rest on the disk.",
  "to move a disk onto a target, nothing may rest on the target.",
  "to move a disk onto a disk, the disk must be smaller than the target.",
  "moving a disk onto a target makes the disk rest on the target.",
];

test("action rules: the worked example's action sentences all teach, and the stored family matches exactly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-action-teach-"));
  try {
    for (const sentence of ACTION_SENTENCES) {
      const r = await runTurn(sentence, { config: CONFIG, memoryDir: dir, sessionId: "act" });
      assert.equal(r.record.via, "assert", `"${sentence}" should teach (got: ${r.answer})`);
      assert.equal(r.record.miss, false, `"${sentence}" should not miss`);
      assert.match(r.answer, /^noted — remembered: /);
    }
    const memory = await loadMemory(dir);
    assert.equal(findRulesByName(memory, "move onto").length, 6, "the family holds six sibling individuals");
    const family = readRuleRows(memory).filter((r) => r.name === "move onto");
    const bySlots = (a, b) => a.kind.localeCompare(b.kind) || JSON.stringify(a.slots).localeCompare(JSON.stringify(b.slots));
    const shape = family.map((r) => ({ kind: r.kind, slots: r.slots })).sort(bySlots);
    // action-precond/action-effect slots also carry value/negate — the
    // fact-value shape's optional fields, defaulted to "" (never taught by
    // any of these six live sentences) the same way readRuleRows defaults
    // any other unwritten slot.
    assert.deepEqual(shape, [
      { kind: "action-effect", slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target", value: "" } },
      { kind: "action-precond", slots: { shape: "no-incoming", predicate: "rest-on", role: "subject", scope: "any", value: "", negate: "" } },
      { kind: "action-precond", slots: { shape: "no-incoming", predicate: "rest-on", role: "target", scope: "any", value: "", negate: "" } },
      { kind: "action-precond", slots: { shape: "comparator", predicate: "smaller-than", role: "subject", scope: "disk", value: "", negate: "" } },
      { kind: "action-signature", slots: { subjectClass: "disk", targetClass: "disk" } },
      { kind: "action-signature", slots: { subjectClass: "disk", targetClass: "peg" } },
    ].sort(bySlots),
    "the move-onto family should hold exactly the six taught rules");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("action rules: renders-as teaches an ordinary Fact on mgx:rendersAs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-action-renders-"));
  try {
    const r = await runTurn("a disk renders as a block.", { config: CONFIG, memoryDir: dir, sessionId: "act" });
    assert.equal(r.record.via, "assert", r.answer);
    assert.match(r.answer, /^noted — remembered: disk renders as block/);
    const rows = readFactRows(await loadMemory(dir));
    const hit = rows.find((row) => row.predicate === "mgx:rendersAs");
    assert.ok(hit, "a mgx:rendersAs fact row should exist");
    assert.equal(hit.subject, "disk");
    assert.equal(hit.object, "block");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("action rules: two same-name preconditions coexist; re-teaching is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-action-idem-"));
  try {
    await runTurn("to move a disk onto a target, nothing may rest on the disk.", { config: CONFIG, memoryDir: dir });
    await runTurn("to move a disk onto a target, nothing may rest on the target.", { config: CONFIG, memoryDir: dir });
    let rules = readRuleRows(await loadMemory(dir)).filter((r) => r.kind === "action-precond");
    assert.equal(rules.length, 2, "both preconditions should coexist");
    await runTurn("to move a disk onto a target, nothing may rest on the disk.", { config: CONFIG, memoryDir: dir });
    rules = readRuleRows(await loadMemory(dir)).filter((r) => r.kind === "action-precond");
    assert.equal(rules.length, 2, "re-teaching must not duplicate (content-addressed id)");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("action rules: question leads and plain pronoun sentences still decline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-action-guards-"));
  try {
    const q = await runTurn("can you move a disk onto a peg?", { config: CONFIG, memoryDir: dir });
    assert.notEqual(q.record.via, "assert", "a question must never teach an action rule");
    assert.equal(readRuleRows(await loadMemory(dir)).length, 0);

    // "you can fly" is answered by the conversational orientation card today
    // (pre-existing routing); the binding requirement is that the signature
    // exemption never lets it TEACH anything.
    const fly = await runTurn("you can fly", { config: CONFIG, memoryDir: dir });
    assert.notEqual(fly.record.via, "assert", "'you can fly' must never teach");
    assert.equal(readRuleRows(await loadMemory(dir)).length, 0);

    const meta = await runTurn("what kind of thing is move onto", { config: CONFIG, memoryDir: dir });
    assert.equal(meta.record.via === "assert", false, "an ask about the rule name must not teach");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("action rules: a role word naming neither the subject class nor 'target' declines honestly, storing nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-action-role-"));
  try {
    const r = await runTurn("to move a disk onto a target, nothing may rest on the table.", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /can't place "table"/);
    assert.equal(readRuleRows(await loadMemory(dir)).length, 0, "a declined rule stores nothing");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
