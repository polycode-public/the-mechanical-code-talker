// The generic taught-action interpreter.
//
//   - compileDomain groups an action family and derives members/ordering;
//   - movesFromRules is deterministic, honors every precondition shape and
//     the grounding budget;
//   - compileGoal walks support chains transitively;
//   - class-bound companion effects move two individuals per action, gated by
//     derived co-location; action constraints prune violating successors;
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
  precondHolds, applyEffects, roleBinding,
} from "../../src/domain/domain.mjs";
import { findActionPath } from "../../src/domain/planning.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows, readRuleRows } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const DOMAIN_SRC = fileURLToPath(new URL("../../src/domain/domain.mjs", import.meta.url));

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

// ---- companions and constraints ----------------------------------------------
// A second neutral fixture: three exclusive cargo pieces (a1/b1/c1, one per
// marker class), a sole escort k1 whose class appears as a class-bound effect
// role, and two zones. Structurally the river-crossing shape, in neutral words.
const ESCORT_RULES = [
  { id: "h1", name: "haul onto", kind: "action-signature", slots: { subjectClass: "cargo", targetClass: "zone" } },
  { id: "h2", name: "haul onto", kind: "action-signature", slots: { subjectClass: "escort", targetClass: "zone" } },
  { id: "h3", name: "haul onto", kind: "action-effect", slots: { predicate: "sit-at", subjectRole: "subject", objectRole: "target" } },
  { id: "h4", name: "haul onto", kind: "action-effect", slots: { predicate: "sit-at", subjectRole: "escort", objectRole: "target" } },
  { id: "h5", name: "haul onto", kind: "action-constraint", slots: { left: "alpha", right: "beta", guard: "escort" } },
  { id: "h6", name: "haul onto", kind: "action-constraint", slots: { left: "beta", right: "gamma", guard: "escort" } },
];
const ESCORT_FACTS = [
  { subject: "a1", predicate: "rdfs:subClassOf", object: "alpha" },
  { subject: "a1", predicate: "rdfs:subClassOf", object: "cargo" },
  { subject: "b1", predicate: "rdfs:subClassOf", object: "beta" },
  { subject: "b1", predicate: "rdfs:subClassOf", object: "cargo" },
  { subject: "c1", predicate: "rdfs:subClassOf", object: "gamma" },
  { subject: "c1", predicate: "rdfs:subClassOf", object: "cargo" },
  { subject: "k1", predicate: "rdfs:subClassOf", object: "escort" },
  { subject: "z1", predicate: "rdfs:subClassOf", object: "zone" },
  { subject: "z2", predicate: "rdfs:subClassOf", object: "zone" },
  { subject: "a1", predicate: "mgx:sit-at", object: "z1" },
  { subject: "b1", predicate: "mgx:sit-at", object: "z1" },
  { subject: "c1", predicate: "mgx:sit-at", object: "z1" },
  { subject: "k1", predicate: "mgx:sit-at", object: "z1" },
];

test("a class-bound effect role moves the subject and its companion in one action", () => {
  const domain = compileDomain(ESCORT_FACTS, ESCORT_RULES);
  const start = stateFromFacts(ESCORT_FACTS, domain);
  const moves = movesFromRules(start, domain);
  const crossing = moves.find((m) => m.action.label === "haul b1 onto z2");
  assert.ok(crossing, "the guarded crossing is legal");
  assert.ok(crossing.nextState.some((r) => r.subject === "b1" && r.predicate === "mgx:sit-at" && r.object === "z2"));
  assert.ok(crossing.nextState.some((r) => r.subject === "k1" && r.predicate === "mgx:sit-at" && r.object === "z2"),
    "the companion crossed in the same action");
});

test("a grounding whose companion is not co-located with the subject is pruned", () => {
  const domain = compileDomain(ESCORT_FACTS, ESCORT_RULES);
  const apart = [
    { subject: "a1", predicate: "mgx:sit-at", object: "z1" },
    { subject: "b1", predicate: "mgx:sit-at", object: "z1" },
    { subject: "c1", predicate: "mgx:sit-at", object: "z1" },
    { subject: "k1", predicate: "mgx:sit-at", object: "z2" },
  ];
  const labels = movesFromRules(apart, domain).map((m) => m.action.label);
  assert.ok(!labels.some((l) => /^haul [abc]1\b/.test(l)), "no cargo moves while the escort is on the far zone");
  assert.deepEqual(labels, ["haul k1 onto z1"], "the escort returning alone is its own trivially co-located companion");
});

test("a constraint prunes exactly the successors where left and right share a place the guard lacks", () => {
  const rules = [
    { id: "s1", name: "shift onto", kind: "action-signature", slots: { subjectClass: "piece", targetClass: "zone" } },
    { id: "s2", name: "shift onto", kind: "action-effect", slots: { predicate: "sit-at", subjectRole: "subject", objectRole: "target" } },
    { id: "s3", name: "shift onto", kind: "action-constraint", slots: { left: "red", right: "blue", guard: "keeper" } },
  ];
  const facts = [
    { subject: "p1", predicate: "rdfs:subClassOf", object: "red" },
    { subject: "p1", predicate: "rdfs:subClassOf", object: "piece" },
    { subject: "p2", predicate: "rdfs:subClassOf", object: "blue" },
    { subject: "p2", predicate: "rdfs:subClassOf", object: "piece" },
    { subject: "g1", predicate: "rdfs:subClassOf", object: "keeper" },
    { subject: "g1", predicate: "rdfs:subClassOf", object: "piece" },
    { subject: "z1", predicate: "rdfs:subClassOf", object: "zone" },
    { subject: "z2", predicate: "rdfs:subClassOf", object: "zone" },
  ];
  const domain = compileDomain(facts, rules);
  const state = [
    { subject: "g1", predicate: "mgx:sit-at", object: "z2" },
    { subject: "p1", predicate: "mgx:sit-at", object: "z1" },
    { subject: "p2", predicate: "mgx:sit-at", object: "z2" },
  ];
  const labels = movesFromRules(state, domain).map((m) => m.action.label);
  // p2 -> z1 would put red+blue on z1 while the keeper stays on z2: pruned.
  // p1 -> z2 puts red+blue+keeper together: allowed. g1 -> z1 splits them: allowed.
  assert.deepEqual(labels, ["shift g1 onto z1", "shift p1 onto z2"]);
});

test("compileDomain throws when a class-bound role or constraint word has zero or several members", () => {
  const ghostRole = ESCORT_RULES.map((r) =>
    (r.id === "h4" ? { ...r, slots: { ...r.slots, subjectRole: "phantom" } } : r));
  assert.throws(() => compileDomain(ESCORT_FACTS, ghostRole), /"phantom".*exactly one member.*0/);

  const twoEscorts = [...ESCORT_FACTS, { subject: "k2", predicate: "rdfs:subClassOf", object: "escort" }];
  assert.throws(() => compileDomain(twoEscorts, ESCORT_RULES), /"escort".*exactly one member.*2/);

  const ghostGuard = ESCORT_RULES.map((r) =>
    (r.id === "h5" ? { ...r, slots: { ...r.slots, guard: "phantom" } } : r));
  assert.throws(() => compileDomain(ESCORT_FACTS, ghostGuard), /constraint term.*"phantom"/);
});

test("the escort domain opens with exactly one legal move and crosses in 7", () => {
  const domain = compileDomain(ESCORT_FACTS, ESCORT_RULES);
  const start = stateFromFacts(ESCORT_FACTS, domain);
  assert.equal(movesFromRules(start, domain).length, 1, "only the guarded crossing is legal at the start");
  const isGoal = compileGoal([{ universal: true, term: "cargo", predicate: "sit-at", object: "z2" }], domain);
  const result = findActionPath(start, isGoal, (s) => movesFromRules(s, domain), { maxDepth: 50, stateKey: stateKeyFor });
  assert.ok(result, "a crossing plan exists");
  assert.equal(result.actions.length, 7, "the classic optimum");
});

test("the interpreter source carries zero domain vocabulary", () => {
  const src = readFileSync(DOMAIN_SRC, "utf8");
  assert.doesNotMatch(src, /disk|peg|rest-on|hanoi/i);
  assert.doesNotMatch(src, /wolf|goat|cabbage|farmer|ferry|passenger|\briver\b|\bbank\b/i);
});

// ---- the "fact-value" precond shape and literal-valued effects --------------
// A datatype/state check ("is this locked", "is this already open") and its
// matching write can't be expressed by no-incoming (an edge INTO the role
// term) or comparator (an ordering fact) — both read a fact ABOUT some OTHER
// term. fact-value reads a fact ABOUT the role term itself, with an optional
// literal `value` and an optional `negate`; its effect counterpart writes a
// literal instead of resolving a role. Neutral vocabulary throughout (an
// "operator" raising/lowering a "gate"), unrelated to any shipped game.

test("precondHolds: fact-value checks existence, an optional literal value, and negation", () => {
  const domain = { classMembers: {}, ordering: [] };
  const state = [{ subject: "g1", predicate: "mgx:raised", object: "true" }];
  const exists = { shape: "fact-value", predicate: "mgx:raised", role: "target" };
  assert.equal(precondHolds(exists, "h1", "g1", state, domain), true, "existence-only holds when any matching fact is present");
  assert.equal(precondHolds(exists, "h1", "g2", state, domain), false, "existence-only fails for a term with no matching fact");
  assert.equal(precondHolds({ ...exists, negate: true }, "h1", "g1", state, domain), false, "negate inverts an existence-only check");
  assert.equal(precondHolds({ ...exists, negate: true }, "h1", "g2", state, domain), true);

  const matched = { shape: "fact-value", predicate: "mgx:raised", role: "target", value: "true" };
  assert.equal(precondHolds(matched, "h1", "g1", state, domain), true, "a matching value holds");
  assert.equal(precondHolds({ ...matched, value: "false" }, "h1", "g1", state, domain), false, "a mismatched value fails");
  assert.equal(precondHolds({ ...matched, negate: true }, "h1", "g1", state, domain), false, "negate inverts a value match");
  assert.equal(precondHolds({ ...matched, value: "false", negate: true }, "h1", "g1", state, domain), true);

  const subjectRole = { shape: "fact-value", predicate: "mgx:raised", role: "subject" };
  assert.equal(precondHolds(subjectRole, "g1", "h1", state, domain), true, "role:subject reads the grounding's subject as the role term");
});

test("applyEffects: a literal-valued effect writes its value directly, independent of objectRole", () => {
  const domain = { classMembers: {} };
  const literalEffect = [{ predicate: "mgx:raised", subjectRole: "target", value: "true" }];
  const next = applyEffects(literalEffect, "h1", "g1", [], domain);
  assert.deepEqual(next, [{ subject: "g1", predicate: "mgx:raised", object: "true" }]);
  // Re-applying the identical literal is a no-op (the "already" dedup check
  // reads effect.value the same way it reads a role-resolved effObject).
  assert.equal(applyEffects(literalEffect, "h1", "g1", next, domain), null);
  const flipped = applyEffects([{ predicate: "mgx:raised", subjectRole: "target", value: "false" }], "h1", "g1", next, domain);
  assert.deepEqual(flipped, [{ subject: "g1", predicate: "mgx:raised", object: "false" }]);
});

test("roleBinding resolves subject/target for a literal effect's subjectRole the same way a role-valued one does", () => {
  const domain = { classMembers: { escort: ["k1"] } };
  assert.equal(roleBinding("target", "h1", "g1", domain), "g1");
  assert.equal(roleBinding("subject", "h1", "g1", domain), "h1");
  assert.equal(roleBinding("escort", "h1", "g1", domain), "k1", "a class-bound role still resolves through classMembers");
});

const GATE_RULES = [
  { id: "gr1", name: "raise", kind: "action-signature", slots: { subjectClass: "operator", targetClass: "gate" } },
  { id: "gr2", name: "raise", kind: "action-precond", slots: { shape: "fact-value", predicate: "held-fast", role: "target", scope: "any", negate: "true" } },
  { id: "gr3", name: "raise", kind: "action-precond", slots: { shape: "fact-value", predicate: "raised", role: "target", scope: "any", value: "true", negate: "true" } },
  { id: "gr4", name: "raise", kind: "action-effect", slots: { predicate: "raised", subjectRole: "target", value: "true" } },
  { id: "gr5", name: "lower", kind: "action-signature", slots: { subjectClass: "operator", targetClass: "gate" } },
  { id: "gr6", name: "lower", kind: "action-precond", slots: { shape: "fact-value", predicate: "raised", role: "target", scope: "any", value: "true" } },
  { id: "gr7", name: "lower", kind: "action-effect", slots: { predicate: "raised", subjectRole: "target", value: "false" } },
];
const GATE_FACTS = [
  { subject: "h1", predicate: "rdfs:subClassOf", object: "operator" },
  { subject: "g1", predicate: "rdfs:subClassOf", object: "gate" },
  { subject: "g1", predicate: "mgx:held-fast", object: "true" },
];

test("compileDomain: an effect/precond's value/negate key is present only when actually taught", () => {
  const domain = compileDomain(GATE_FACTS, GATE_RULES);
  const raise = domain.actions.find((a) => a.name === "raise");
  const roleValuedEffect = compileDomain(FACTS, RULES).actions[0].effects[0];
  assert.deepEqual(Object.keys(roleValuedEffect).sort(), ["objectRole", "predicate", "subjectRole"],
    "an existing role-valued effect (no value ever taught) carries no value key at all");
  assert.deepEqual(Object.keys(raise.effects[0]).sort(), ["objectRole", "predicate", "subjectRole", "value"],
    "a literal effect's objectRole is still present (empty — never taught), same as any other unset required slot");
  assert.equal(raise.effects[0].objectRole, "");
  const noValuePrecond = compileDomain(FACTS, RULES).actions[0].preconds.find((p) => p.shape === "no-incoming");
  assert.deepEqual(Object.keys(noValuePrecond).sort(), ["predicate", "role", "scope", "shape"],
    "an existing no-incoming precond carries no value/negate keys");
});

test("compileDomain does not throw the class-membership check over a literal effect's unused objectRole", () => {
  // Before the guard, a literal effect's absent objectRole ("") tripped
  // requireSoleMember as if it named an ill-bound class.
  assert.doesNotThrow(() => compileDomain(GATE_FACTS, GATE_RULES));
});

test("the gate world: locked declines raise, unlocking admits it, and lower requires raised first", () => {
  // Hand-built state, not stateFromFacts: "held-fast" is a static world fact
  // no action here ever writes, so it is never a dynamic predicate — exactly
  // the shape a real lock check takes (a fact-value precond need not name a
  // predicate any effect in the domain touches), and precisely why a caller
  // consulting one grounded fact-value precond builds its own small state
  // array instead of routing through stateFromFacts (whose dynamic-predicate
  // filter exists for full-search planning, not this).
  const domain = compileDomain(GATE_FACTS, GATE_RULES);
  const held = [{ subject: "g1", predicate: "mgx:held-fast", object: "true" }];
  assert.deepEqual(movesFromRules(held, domain), [], "held-fast blocks the only otherwise-legal move");

  const freeMoves = movesFromRules([], domain);
  assert.deepEqual(freeMoves.map((m) => m.action.label), ["raise h1 g1"]);
  assert.ok(freeMoves[0].nextState.some((r) => r.subject === "g1" && r.predicate === "mgx:raised" && r.object === "true"));

  const raised = freeMoves[0].nextState;
  const raisedMoves = movesFromRules(raised, domain).map((m) => m.action.label);
  assert.deepEqual(raisedMoves, ["lower h1 g1"], "raised again is illegal; lower is now legal");
  const lowered = movesFromRules(raised, domain)[0].nextState;
  assert.ok(lowered.some((r) => r.subject === "g1" && r.predicate === "mgx:raised" && r.object === "false"));
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
