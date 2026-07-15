// plan-viz: the blocks archetype renderer over the plan-lane contract.
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeBlocksLayout, renderPlanHtml } from "../src/plan-viz.mjs";

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
