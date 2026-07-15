// The generic taught-action interpreter.
//
//   - compileDomain groups an action family and derives members/ordering;
//   - movesFromRules is deterministic, honors every precondition shape and
//     the grounding budget;
//   - compileGoal walks support chains transitively;
//   - the interpreter source carries zero domain vocabulary;
//   - the oracle: for n = 1..8 disks taught purely as sentences, the search
//     finds exactly 2^n - 1 moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileDomain, stateFromFacts, stateKeyFor, movesFromRules, compileGoal, PlanBudgetError,
} from "../src/domain.mjs";
import { findActionPath } from "../src/planning.mjs";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows, readRuleRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const DOMAIN_SRC = fileURLToPath(new URL("../src/domain.mjs", import.meta.url));

// A neutral vocabulary fixture (tokens/slots), unrelated to any shipped game.
const RULES = [
  { id: "r1", name: "put on", kind: "action-signature", slots: { subjectClass: "token", targetClass: "slot" } },
  { id: "r2", name: "put on", kind: "action-signature", slots: { subjectClass: "token", targetClass: "token" } },
  { id: "r3", name: "put on", kind: "action-precond", slots: { shape: "no-incoming", predicate: "sit-on", role: "subject", scope: "any" } },
  { id: "r4", name: "put on", kind: "action-precond", slots: { shape: "no-incoming", predicate: "sit-on", role: "target", scope: "any" } },
  { id: "r5", name: "put on", kind: "action-precond", slots: { shape: "comparator", predicate: "lighter-than", role: "subject", scope: "token" } },
  { id: "r6", name: "put on", kind: "action-effect", slots: { predicate: "sit-on", subjectRole: "subject", objectRole: "target" } },
];
const FACTS = [
  { subject: "t1", predicate: "rdfs:subClassOf", object: "token" },
  { subject: "t2", predicate: "rdfs:subClassOf", object: "token" },
  { subject: "s1", predicate: "rdfs:subClassOf", object: "slot" },
  { subject: "s2", predicate: "rdfs:subClassOf", object: "slot" },
  { subject: "t1", predicate: "mgx:lighter-than", object: "t2" },
  { subject: "t1", predicate: "mgx:sit-on", object: "t2" },
  { subject: "t2", predicate: "mgx:sit-on", object: "s1" },
];

test("compileDomain groups the family and derives members, dynamics, ordering", () => {
  const domain = compileDomain(FACTS, RULES);
  assert.equal(domain.actions.length, 1);
  const action = domain.actions[0];
  assert.equal(action.name, "put on");
  assert.equal(action.signatures.length, 2);
  assert.equal(action.preconds.length, 3);
  assert.equal(action.effects.length, 1);
  assert.deepEqual(domain.classMembers.token, ["t1", "t2"]);
  assert.deepEqual(domain.classMembers.slot, ["s1", "s2"]);
  assert.ok(domain.dynamicPredicates.has("mgx:sit-on"));
  assert.ok(domain.ordering.some((r) => r.predicate === "mgx:lighter-than"));
  assert.ok(!domain.ordering.some((r) => r.predicate === "mgx:sit-on"), "dynamic rows stay out of ordering");
});

test("stateFromFacts restricts to dynamic rows over subject-class members", () => {
  const domain = compileDomain(FACTS, RULES);
  const state = stateFromFacts(FACTS, domain);
  assert.deepEqual(state, [
    { subject: "t1", predicate: "mgx:sit-on", object: "t2" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s1" },
  ]);
});

test("stateFromFacts prefers the newest @step snapshot over untagged rows", () => {
  const domain = compileDomain(FACTS, RULES);
  const rows = [
    ...FACTS,
    { subject: "t1@step1", predicate: "mgx:sit-on", object: "s2" },
    { subject: "t2@step1", predicate: "mgx:sit-on", object: "s1" },
    { subject: "t1@step2", predicate: "mgx:sit-on", object: "t2" },
    { subject: "t2@step2", predicate: "mgx:sit-on", object: "s2" },
  ];
  const state = stateFromFacts(rows, domain);
  assert.deepEqual(state, [
    { subject: "t1", predicate: "mgx:sit-on", object: "t2" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s2" },
  ], "the max-step snapshot wins, suffixes stripped");
});

test("movesFromRules: legality, per-shape preconditions, determinism", () => {
  const domain = compileDomain(FACTS, RULES);
  const state = stateFromFacts(FACTS, domain);
  const moves = movesFromRules(state, domain);
  const labels = moves.map((m) => m.action.label);
  // t1 is topmost (nothing sits on it); t2 carries t1 so t2 may not move;
  // t1 may go to the free slot s2 only (s1 is covered by t2; t2 is covered by t1).
  assert.deepEqual(labels, ["put t1 on s2"]);
  const again = movesFromRules(state, domain);
  assert.equal(JSON.stringify(moves), JSON.stringify(again), "byte-identical on re-run");
  // comparator: with t1 atop nothing and t2 clear, moving t2 onto t1 must fail
  // (t2 is not lighter-than t1) while t1 onto t2 passes when both are clear.
  const clear = [
    { subject: "t1", predicate: "mgx:sit-on", object: "s1" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s2" },
  ];
  const clearMoves = movesFromRules(clear, domain).map((m) => m.action.label);
  assert.ok(clearMoves.includes("put t1 on t2"), "lighter onto heavier is legal");
  assert.ok(!clearMoves.includes("put t2 on t1"), "heavier onto lighter is not");
});

test("movesFromRules: scope gating keeps the comparator off out-of-scope targets", () => {
  const domain = compileDomain(FACTS, RULES);
  const clear = [
    { subject: "t1", predicate: "mgx:sit-on", object: "s1" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s2" },
  ];
  const labels = movesFromRules(clear, domain).map((m) => m.action.label);
  // slots are outside the comparator's scope ("token"), so moves onto free
  // slots need no ordering fact at all.
  assert.ok(labels.includes("put t2 on s1") === false, "occupied slots stay illegal");
  const oneFree = [
    { subject: "t1", predicate: "mgx:sit-on", object: "t2" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s1" },
  ];
  const l2 = movesFromRules(oneFree, domain).map((m) => m.action.label);
  assert.deepEqual(l2, ["put t1 on s2"]);
});

test("movesFromRules throws PlanBudgetError when groundings exceed the budget", () => {
  const domain = compileDomain(FACTS, RULES);
  const state = stateFromFacts(FACTS, domain);
  assert.throws(() => movesFromRules(state, domain, { budget: 3 }), PlanBudgetError);
});

test("compileGoal walks the support chain transitively", () => {
  const domain = compileDomain(FACTS, RULES);
  const isGoal = compileGoal([{ universal: true, term: "token", predicate: "sit-on", object: "s1" }], domain);
  const stacked = [
    { subject: "t1", predicate: "mgx:sit-on", object: "t2" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s1" },
  ];
  assert.equal(isGoal(stacked), true, "t1 reaches s1 through t2");
  const apart = [
    { subject: "t1", predicate: "mgx:sit-on", object: "s2" },
    { subject: "t2", predicate: "mgx:sit-on", object: "s1" },
  ];
  assert.equal(isGoal(apart), false);
  assert.throws(() => compileGoal([{ universal: true, term: "ghost", predicate: "sit-on", object: "s1" }], domain),
    /no known members/);
});

test("the interpreter source carries zero domain vocabulary", () => {
  const src = readFileSync(DOMAIN_SRC, "utf8");
  assert.doesNotMatch(src, /disk|peg|rest-on|hanoi/i);
});

// ---- the oracle -------------------------------------------------------------

const ACTION_SENTENCES = [
  "you can move a disk onto a peg.",
  "you can move a disk onto a disk.",
  "to move a disk onto a target, nothing may rest on the disk.",
  "to move a disk onto a target, nothing may rest on the target.",
  "to move a disk onto a disk, the disk must be smaller than the target.",
  "moving a disk onto a target makes the disk rest on the target.",
];

function hanoiSentences(n) {
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push(`remember that disk-${i} is a disk.`);
  for (const p of ["a", "b", "c"]) out.push(`remember that peg-${p} is a peg.`);
  for (let i = 1; i <= n; i += 1) {
    for (let j = i + 1; j <= n; j += 1) out.push(`disk-${i} is smaller than disk-${j}`);
  }
  out.push(...ACTION_SENTENCES);
  for (let i = 1; i < n; i += 1) out.push(`disk-${i} rests on disk-${i + 1}.`);
  out.push(`disk-${n} rests on peg-a.`);
  return out;
}

test("oracle: taught definitions solve hanoi optimally for n = 1..8", async () => {
  const started = Date.now();
  for (let n = 1; n <= 8; n += 1) {
    const dir = await mkdtemp(join(tmpdir(), `tmct-oracle-${n}-`));
    try {
      for (const sentence of hanoiSentences(n)) {
        const r = await runTurn(sentence, { config: {}, memoryDir: dir, sessionId: "oracle" });
        assert.equal(r.record.via, "assert", `n=${n}: "${sentence}" should teach (got: ${r.answer})`);
      }
      const memory = await loadMemory(dir);
      const domain = compileDomain(readFactRows(memory), readRuleRows(memory));
      const state = stateFromFacts(readFactRows(memory), domain);
      assert.equal(state.length, n, `n=${n}: the step-0 board has one support row per disk`);
      const isGoal = compileGoal(
        [{ universal: true, term: "disk", predicate: "mgx:rest-on", object: "peg-c" }], domain);
      const result = findActionPath(state, isGoal, (s) => movesFromRules(s, domain), {
        maxDepth: 300, stateKey: stateKeyFor,
      });
      assert.ok(result, `n=${n}: a plan must exist`);
      assert.equal(result.actions.length, 2 ** n - 1, `n=${n}: optimal length`);
    } finally {
      clearCache();
      await rm(dir, { recursive: true, force: true });
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`oracle n=1..8 wall time: ${seconds}s`);
});
