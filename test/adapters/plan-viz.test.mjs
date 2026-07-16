// plan-viz: the blocks archetype renderer over the plan-lane contract.
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeBlocksLayout, renderPlanHtml } from "../../src/services/plan-viz.mjs";

function embeddedJson(html, name) {
  const m = new RegExp(`const ${name} = (.*);`).exec(html);
  assert.ok(m, `const ${name} = ...; not found in the rendered page`);
  return JSON.parse(m[1]);
}

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
const PLAN_FIXTURE = {
  actions: MOVES.map(([subject, target]) => ({
    name: "move onto", subject, target, label: `move ${subject} onto ${target}`,
  })),
  states: STATES,
  stepGoals: MOVES.map(([s, t], i) =>
    `move ${s} onto ${t} (step ${i + 1} of 7, working toward: every disk rests on peg-c)`),
  goal: { text: "every disk rests on peg-c", specs: [] },
  domain: {
    classMembers: { disk: ["disk-1", "disk-2", "disk-3"], peg: ["peg-a", "peg-b", "peg-c"] },
    ordering: [],
    renderHints: { disk: "block", peg: "slot" },
  },
};
const RENDERS_AS = { disk: "block", peg: "slot" };
const SIZE_ORDER = [["disk-1", "disk-2"], ["disk-1", "disk-3"], ["disk-2", "disk-3"]];

const layoutArgs = { plan: PLAN_FIXTURE, rendersAs: RENDERS_AS, sizeOrder: SIZE_ORDER };

test("computeBlocksLayout: 8 snapshots; the final one satisfies the goal through the stacks", () => {
  const layout = computeBlocksLayout(layoutArgs);
  assert.equal(layout.snapshots.length, 8);
  assert.deepEqual(layout.snapshots[7].stacks["peg-c"], ["disk-3", "disk-2", "disk-1"]);
  assert.deepEqual(layout.snapshots[0].stacks["peg-a"], ["disk-3", "disk-2", "disk-1"]);
});

test("computeBlocksLayout: ordinal widths strictly increase with rank; shading darkens", () => {
  const layout = computeBlocksLayout(layoutArgs);
  const items = layout.snapshots[0].items.filter((i) => i.kind === "block");
  const byRank = [...items].sort((a, b) => a.rank - b.rank);
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
  };
  for (let i = 1; i < byRank.length; i += 1) {
    assert.ok(byRank[i].w > byRank[i - 1].w, "width increases with rank");
    assert.ok(luminance(byRank[i].fill) < luminance(byRank[i - 1].fill), "shade darkens with rank");
  }
});

test("computeBlocksLayout: deterministic (byte-identical JSON on re-run)", () => {
  const a = JSON.stringify(computeBlocksLayout(layoutArgs));
  const b = JSON.stringify(computeBlocksLayout(layoutArgs));
  assert.equal(a, b);
});

test("computeBlocksLayout: a class without a rendersAs entry falls back to circles", () => {
  const layout = computeBlocksLayout({ plan: PLAN_FIXTURE, rendersAs: { disk: "block" }, sizeOrder: SIZE_ORDER });
  assert.ok(layout.anchors.length === 3 && layout.anchors.every((a) => a.kind === "circle"));
  assert.deepEqual(layout.snapshots[7].stacks["peg-c"], ["disk-3", "disk-2", "disk-1"]);
});

// A crossing puzzle: several pieces rest directly on the same support at once,
// and one step's effects move a carrier plus its passenger together.
const S = (subject, object) => ({ subject, predicate: "mgx:stand-on", object });
const E = "bank-east";
const W = "bank-west";
const CROSSING_STATES = [
  [S("wolf-1", E), S("goat-1", E), S("cabbage-1", E), S("farmer-1", E)],
  [S("wolf-1", E), S("goat-1", W), S("cabbage-1", E), S("farmer-1", W)],
  [S("wolf-1", E), S("goat-1", W), S("cabbage-1", E), S("farmer-1", E)],
  [S("wolf-1", E), S("goat-1", W), S("cabbage-1", W), S("farmer-1", W)],
  [S("wolf-1", E), S("goat-1", E), S("cabbage-1", W), S("farmer-1", E)],
  [S("wolf-1", W), S("goat-1", E), S("cabbage-1", W), S("farmer-1", W)],
  [S("wolf-1", W), S("goat-1", E), S("cabbage-1", W), S("farmer-1", E)],
  [S("wolf-1", W), S("goat-1", W), S("cabbage-1", W), S("farmer-1", W)],
];
const CROSSINGS = [
  ["goat-1", W], ["farmer-1", E], ["cabbage-1", W], ["goat-1", E],
  ["wolf-1", W], ["farmer-1", E], ["goat-1", W],
];
const CROSSING_PLAN = {
  actions: CROSSINGS.map(([subject, target]) => ({
    name: "ferry onto", subject, target, label: `ferry ${subject} onto ${target}`,
  })),
  states: CROSSING_STATES,
  goal: { text: "every passenger stands on bank-west", specs: [] },
  domain: {
    classMembers: {
      passenger: ["wolf-1", "goat-1", "cabbage-1"],
      farmer: ["farmer-1"],
      bank: [E, W],
    },
    ordering: [],
    renderHints: { passenger: "block", farmer: "block", bank: "slot" },
  },
};
const CROSSING_ARGS = {
  plan: CROSSING_PLAN,
  rendersAs: { passenger: "block", farmer: "block", bank: "slot" },
  sizeOrder: [],
};

const blockPos = (snapshot, id) =>
  snapshot.items.find((i) => i.id === id && i.kind === "block");

test("computeBlocksLayout: pieces sharing one support all render, none dropped", () => {
  const layout = computeBlocksLayout(CROSSING_ARGS);
  const pieces = ["wolf-1", "goat-1", "cabbage-1", "farmer-1"];
  layout.snapshots.forEach((snapshot, i) => {
    for (const id of pieces) {
      assert.ok(blockPos(snapshot, id), `${id} missing from snapshot ${i}`);
    }
  });
  assert.deepEqual(layout.snapshots[0].stacks[E], ["cabbage-1", "farmer-1", "goat-1", "wolf-1"]);
  assert.deepEqual(layout.snapshots[0].stacks[W], []);
  assert.deepEqual(layout.snapshots[7].stacks[W], ["cabbage-1", "farmer-1", "goat-1", "wolf-1"]);
  assert.deepEqual(layout.snapshots[7].stacks[E], []);
});

test("computeBlocksLayout: a step moving a carrier and a passenger changes both their columns", () => {
  const layout = computeBlocksLayout(CROSSING_ARGS);
  const columnChangers = (i) =>
    ["wolf-1", "goat-1", "cabbage-1", "farmer-1"]
      .filter((id) => blockPos(layout.snapshots[i], id).x !== blockPos(layout.snapshots[i + 1], id).x)
      .sort();
  assert.deepEqual(columnChangers(0), ["farmer-1", "goat-1"]);
  assert.deepEqual(columnChangers(2), ["cabbage-1", "farmer-1"]);
  assert.deepEqual(columnChangers(1), ["farmer-1"]);
  assert.deepEqual(columnChangers(5), ["farmer-1"]);
});

test("computeBlocksLayout: single-support chains stack one piece per step, unchanged by shared supports", () => {
  const layout = computeBlocksLayout(layoutArgs);
  const columnChangers = (i) =>
    ["disk-1", "disk-2", "disk-3"]
      .filter((id) => blockPos(layout.snapshots[i], id).x !== blockPos(layout.snapshots[i + 1], id).x);
  for (let i = 0; i < 7; i += 1) {
    assert.equal(columnChangers(i).length, 1, `hanoi step ${i} moves exactly one disk`);
  }
});

test("renderPlanHtml: animates every travelling piece rather than only lone movers", () => {
  const html = renderPlanHtml(CROSSING_ARGS);
  assert.ok(!/movers\.length !== 1/.test(html), "no single-mover bail-out remains");
  assert.ok(/travellers/.test(html) && /settlers/.test(html));
  const plan = embeddedJson(html, "PLAN");
  assert.equal(plan.layouts.length, 8);
  for (const layout of plan.layouts) {
    assert.equal(layout.items.filter((i) => i.kind === "block").length, 4);
  }
});

test("renderPlanHtml: embeds the plan, goal strings, facts, and phase brackets", () => {
  const html = renderPlanHtml(layoutArgs);
  const plan = embeddedJson(html, "PLAN");
  assert.equal(plan.layouts.length, 8);
  assert.equal(plan.facts.length, 8);
  assert.equal(plan.stepGoals.length, 7);
  assert.ok(plan.facts[0].includes("disk-3 rest on peg-a"));
  assert.deepEqual(plan.phases.map((p) => [p.from, p.to]), [[0, 3], [3, 4], [4, 7]]);
  assert.ok(plan.phases[0].label.includes("disk-3"));
  assert.ok(html.includes("Goal (inferred)"));
  assert.ok(html.includes("board@step"));
});

test("renderPlanHtml: self-contained, reduced-motion respected, both theme schemes present", () => {
  const html = renderPlanHtml(layoutArgs);
  assert.ok(!/(?:src|href)=["']https?:/.test(html), "no external resource loads");
  assert.ok(html.includes("prefers-reduced-motion"));
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes('data-theme="light"') && html.includes('data-theme="dark"'));
  assert.ok(!html.includes("color-mix("));
});

test("renderPlanHtml: omits the goal line honestly when stepGoals are absent", () => {
  const noGoals = { ...PLAN_FIXTURE, stepGoals: undefined };
  const html = renderPlanHtml({ plan: noGoals, rendersAs: RENDERS_AS, sizeOrder: SIZE_ORDER });
  const plan = embeddedJson(html, "PLAN");
  assert.equal(plan.stepGoals, null);
});
