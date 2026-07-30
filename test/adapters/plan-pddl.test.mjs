// plan-pddl.mjs: the PDDL-style + OWL/RDF text renderer over a solved plan.
// Pure formatting over the plan-lane contract's own shape — asserts real
// ontology tags (rdf:type/rdfs:subClassOf/mgx:*) actually land in the
// output, that the precondition/effect blocks are a genuine diff of the
// plan's own state snapshots, and that nothing renders as a placeholder or
// literal "undefined".
import { test } from "node:test";
import assert from "node:assert/strict";

import { planToPddl } from "../../src/services/plan-pddl.mjs";

const R = (subject, object) => ({ subject, predicate: "mgx:rest-on", object });
const STATES = [
  [R("disk-1", "disk-2"), R("disk-2", "disk-3"), R("disk-3", "peg-a")],
  [R("disk-1", "peg-c"), R("disk-2", "disk-3"), R("disk-3", "peg-a")],
  [R("disk-1", "peg-c"), R("disk-2", "peg-b"), R("disk-3", "peg-a")],
  [R("disk-1", "disk-2"), R("disk-2", "peg-b"), R("disk-3", "peg-a")],
  [R("disk-1", "disk-2"), R("disk-2", "peg-b"), R("disk-3", "peg-c")],
  [R("disk-1", "peg-a"), R("disk-2", "peg-b"), R("disk-3", "peg-c")],
  [R("disk-1", "peg-a"), R("disk-2", "disk-3"), R("disk-3", "peg-c")],
  [R("disk-1", "disk-2"), R("disk-2", "disk-3"), R("disk-3", "peg-c")],
];
const MOVES = [
  ["disk-1", "peg-c"], ["disk-2", "peg-b"], ["disk-1", "disk-2"], ["disk-3", "peg-c"],
  ["disk-1", "peg-a"], ["disk-2", "disk-3"], ["disk-1", "disk-2"],
];
const HANOI_PLAN = {
  actions: MOVES.map(([subject, target]) => ({
    name: "move onto", subject, target, label: `move ${subject} onto ${target}`,
  })),
  states: STATES,
  stepGoals: MOVES.map(([s, t], i) =>
    `move ${s} onto ${t} (step ${i + 1} of 7, working toward: every disk rests on peg-c)`),
  goal: {
    text: "every disk rests on peg-c",
    specs: [{ universal: true, term: "disk", predicate: "rest-on", object: "peg-c" }],
  },
  domain: {
    classMembers: {
      "game-piece": ["disk"], disk: ["disk-1", "disk-2", "disk-3"],
      place: ["peg"], peg: ["peg-a", "peg-b", "peg-c"],
    },
    ordering: [
      { subject: "disk-1", predicate: "mgx:smaller-than", object: "disk-2" },
      { subject: "disk-1", predicate: "mgx:smaller-than", object: "disk-3" },
      { subject: "disk-2", predicate: "mgx:smaller-than", object: "disk-3" },
    ],
    renderHints: { disk: "block", peg: "slot" },
  },
  becauseText: `you taught me the "move onto" rule and 3 ordering facts.`,
};

test("planToPddl: real rdf:type/rdfs:subClassOf ontology tags appear, derived from domain.classMembers", () => {
  const pddl = planToPddl(HANOI_PLAN);
  assert.match(pddl, /\(rdf:type disk-1 disk\)/);
  assert.match(pddl, /\(rdf:type peg-a peg\)/);
  assert.match(pddl, /\(rdfs:subClassOf disk game-piece\)/);
  assert.match(pddl, /\(rdfs:subClassOf peg place\)/);
});

test("planToPddl: :init/:goal/:action facts keep the real unstripped mgx: predicate tag", () => {
  const pddl = planToPddl(HANOI_PLAN);
  assert.match(pddl, /\(mgx:rest-on disk-1 disk-2\)/);
  assert.match(pddl, /\(mgx:rest-on disk-1 peg-c\)/);
  assert.ok(!/\(rest-on /.test(pddl), "the mgx: prefix must never be stripped in this panel");
});

test("planToPddl: the ordering block carries the real mgx:*-than facts", () => {
  const pddl = planToPddl(HANOI_PLAN);
  assert.match(pddl, /\(mgx:smaller-than disk-1 disk-2\)/);
  assert.match(pddl, /\(mgx:smaller-than disk-2 disk-3\)/);
});

test("planToPddl: never leaks a literal placeholder", () => {
  const pddl = planToPddl(HANOI_PLAN);
  assert.ok(!/undefined|\bNaN\b|\[object Object\]|null/.test(pddl), pddl);
});

test("planToPddl: one (:action ...) block per plan step, uniquely named", () => {
  const pddl = planToPddl(HANOI_PLAN);
  const names = [...pddl.matchAll(/\(:action ([a-z0-9-]+)/g)].map((m) => m[1]);
  assert.equal(names.length, 7);
  assert.equal(new Set(names).size, 7, "every action name is unique");
});

test("planToPddl: the action-sequence header pluralizes the move count through the shared countLabel helper", () => {
  const pddl = planToPddl(HANOI_PLAN);
  assert.match(pddl, /;; action sequence — findActionPath's own shortest path \(7 moves\)/);

  const singleMove = { ...HANOI_PLAN, actions: HANOI_PLAN.actions.slice(0, 1), states: HANOI_PLAN.states.slice(0, 2) };
  const singlePddl = planToPddl(singleMove);
  assert.match(singlePddl, /;; action sequence — findActionPath's own shortest path \(1 move\)/);
});

test("planToPddl: the first action's precondition/effect is exactly the diff between states[0] and states[1]", () => {
  const pddl = planToPddl(HANOI_PLAN);
  const block = pddl.split("(:action move-onto-step1")[1].split(")\n\n(:action")[0];
  assert.match(block, /:precondition \(and\s*\n\s*\(mgx:rest-on disk-1 disk-2\)/);
  assert.match(block, /:effect \(and\s*\n\s*\(not \(mgx:rest-on disk-1 disk-2\)\)\s*\n\s*\(mgx:rest-on disk-1 peg-c\)/);
});

test("planToPddl: the goal block expands a universal spec over every real class member", () => {
  const pddl = planToPddl(HANOI_PLAN);
  const goalBlock = pddl.split("(:goal (and")[1].split("))")[0];
  for (const disk of ["disk-1", "disk-2", "disk-3"]) {
    assert.match(goalBlock, new RegExp(`\\(mgx:rest-on ${disk} peg-c\\)`));
  }
});

test("planToPddl: deterministic — identical input produces byte-identical output", () => {
  assert.equal(planToPddl(HANOI_PLAN), planToPddl(HANOI_PLAN));
});

test("planToPddl: a goal-satisfied plan (no actions) still renders a valid header with no action blocks", () => {
  const satisfied = { ...HANOI_PLAN, actions: [], states: [STATES[0]], stepGoals: [] };
  const pddl = planToPddl(satisfied);
  assert.match(pddl, /:domain tmct-taught-domain/);
  assert.ok(!/\(:action /.test(pddl), "no action blocks for an already-satisfied goal");
});

test("planToPddl: a universal goal term with no known class members expands to nothing, never a placeholder atom", () => {
  const unknownTerm = {
    ...HANOI_PLAN,
    goal: { text: "every gadget rests on peg-c", specs: [{ universal: true, term: "gadget", predicate: "rest-on", object: "peg-c" }] },
  };
  const pddl = planToPddl(unknownTerm);
  assert.ok(!/undefined/.test(pddl));
  assert.ok(!/\(mgx:rest-on gadget /.test(pddl));
});

test("planToPddl: omits the :objects/:ontology/:ordering/:init sections honestly when the domain carries none", () => {
  const bare = { actions: [], states: [], goal: { text: "", specs: [] }, domain: { classMembers: {}, ordering: [] } };
  const pddl = planToPddl(bare);
  assert.ok(!/:objects/.test(pddl));
  assert.ok(!/:ontology/.test(pddl));
  assert.ok(!/:ordering/.test(pddl));
  assert.ok(!/:init/.test(pddl));
  assert.ok(!/undefined/.test(pddl));
});

test("planToPddl: the becauseText a live session folds onto the plan appears as a header comment", () => {
  const pddl = planToPddl(HANOI_PLAN);
  assert.match(pddl, /;; because: you taught me the "move onto" rule and 3 ordering facts\./);
});
