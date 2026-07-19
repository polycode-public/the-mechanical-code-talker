// spider-fly-turn.test.mjs — direct unit coverage for spiderFlyTurn's own
// gameConfig threading: a custom override reaches startSpiderFlyGame's own
// written facts through the opening turn, without going through the full
// chat session/corpus lane (that end-to-end wiring is covered by the
// games/spider-fly corpus lane instead) — plus pillsForSpiderFly and
// oneStepDirectionBetween, the deception-pill machinery the chat dock's
// dynamic pill rail is built on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spiderFlyTurn, pillsForSpiderFly, oneStepDirectionBetween } from "../../src/services/spider-fly-turn.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

test("spiderFlyTurn's opening move threads a custom gameConfig into startSpiderFlyGame's own written facts", async () => {
  const memoryDir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-turn-config-"));
  try {
    const gameConfig = {
      ...DEFAULT_GAME_CONFIG,
      spiderFly: { ...DEFAULT_GAME_CONFIG.spiderFly, spiderInitialMass: 42 },
    };
    const planHolder = { state: null };
    const result = await spiderFlyTurn("watch the spider and the fly", { planHolder, memoryDir, env: {}, gameConfig });
    assert.ok(result, "the opener is claimed by the spider-fly lane");

    const rows = readFactRows(await loadMemory(memoryDir));
    assert.ok(
      rows.some((r) => r.subject === "spider-1" && r.predicate === "mgx:mass" && r.object === "42"),
      "the custom spiderInitialMass reaches the freshly-started game's own written facts, not the shipped default of 15",
    );
  } finally {
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("spiderFlyTurn defaults to DEFAULT_GAME_CONFIG when no gameConfig is passed — every existing caller that omits it keeps working", async () => {
  const memoryDir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-turn-default-"));
  try {
    const planHolder = { state: null };
    const result = await spiderFlyTurn("watch the spider and the fly", { planHolder, memoryDir, env: {} });
    assert.ok(result);

    const rows = readFactRows(await loadMemory(memoryDir));
    assert.ok(
      rows.some((r) => r.subject === "spider-1" && r.predicate === "mgx:mass" && r.object === String(DEFAULT_GAME_CONFIG.spiderFly.spiderInitialMass)),
      "with no gameConfig override, the shipped default spiderInitialMass is what lands in the store",
    );
  } finally {
    await rm(memoryDir, { recursive: true, force: true });
  }
});

// ---- oneStepDirectionBetween -------------------------------------------

test("oneStepDirectionBetween names the compass direction for an exact one-cell cardinal step, and null for anything else", () => {
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 4 }), "north");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 6 }), "south");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 6, y: 5 }), "east");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 4, y: 5 }), "west");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 5 }), null, "the same cell is never adjacent to itself");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 6, y: 6 }), null, "a diagonal neighbor has no cardinal direction");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 3 }), null, "two steps away is never 'adjacent'");
});

// ---- pillsForSpiderFly: the chat dock's dynamic deception-pill set ------

test("pillsForSpiderFly: with exactly one spider and one fly, address pills are bare and the claim pills read the true adjacent direction plus the point-reflected false cell", () => {
  const agents = { "spider-1": { cell: "cell-2-2" }, "fly-1": { cell: "cell-3-2" } };
  const { addressPills, claimPills, addresseeId } = pillsForSpiderFly(agents, null, {});
  assert.deepEqual(addressPills, [
    { id: "spider-1", kind: "spider", label: "@spider" },
    { id: "fly-1", kind: "fly", label: "@fly" },
  ]);
  assert.equal(addresseeId, "spider-1", "defaults to the spider when nothing is explicitly addressed");
  assert.equal(claimPills.length, 2, "one true and one false claim pill for the one live fly");
  const trueClaim = claimPills.find((p) => p.truth === true);
  const falseClaim = claimPills.find((p) => p.truth === false);
  assert.deepEqual(trueClaim, { subjectId: "fly-1", truth: true, text: "the fly is east", sentence: "@spider the fly is east" });
  assert.deepEqual(falseClaim, {
    subjectId: "fly-1", truth: false,
    text: "the fly is at cell-8-9", sentence: "@spider the fly is at cell-8-9",
  });
});

test("pillsForSpiderFly: a non-adjacent candidate's true claim falls back to the exact cell — always expressible even with no cardinal direction", () => {
  const agents = { "spider-1": { cell: "cell-2-2" }, "fly-1": { cell: "cell-5-5" } };
  const { claimPills } = pillsForSpiderFly(agents, null, {});
  const trueClaim = claimPills.find((p) => p.truth === true);
  assert.equal(trueClaim.text, "the fly is at cell-5-5");
  const falseClaim = claimPills.find((p) => p.truth === false);
  assert.equal(falseClaim.text, "the fly is at cell-6-6", "the point reflection of (5,5) through the board center is (6,6)");
});

test("pillsForSpiderFly: address pills switch from bare to numbered once more than one individual of a kind is live, and the subject term inside a claim sentence follows the same rule", () => {
  const agents = {
    "spider-1": { cell: "cell-2-2" },
    "fly-1": { cell: "cell-3-2" },
    "fly-2": { cell: "cell-5-5" },
  };
  const { addressPills, claimPills } = pillsForSpiderFly(agents, null, {});
  assert.deepEqual(addressPills, [
    { id: "spider-1", kind: "spider", label: "@spider" },
    { id: "fly-1", kind: "fly", label: "@fly-1" },
    { id: "fly-2", kind: "fly", label: "@fly-2" },
  ]);
  assert.equal(claimPills.length, 4, "one true and one false pill per live fly, two flies");
  assert.ok(claimPills.every((p) => p.text.includes("fly-1") || p.text.includes("fly-2")), "each candidate is numbered inside its own claim text once ambiguous");
});

test("pillsForSpiderFly: explicitAddresseeId switches the addressee and its OPPOSITE kind becomes the candidate set — a fly addressee gets spider claim pills", () => {
  const agents = { "spider-1": { cell: "cell-2-2" }, "fly-1": { cell: "cell-3-2" } };
  const { claimPills, addresseeId } = pillsForSpiderFly(agents, "fly-1", {});
  assert.equal(addresseeId, "fly-1");
  assert.equal(claimPills.length, 2);
  const trueClaim = claimPills.find((p) => p.truth === true);
  assert.deepEqual(trueClaim, { subjectId: "spider-1", truth: true, text: "the spider is west", sentence: "@fly the spider is west" });
});

test("pillsForSpiderFly: a stale explicitAddresseeId naming an agent no longer on the board falls back to the default addressee instead of producing no claim pills at all", () => {
  const agents = { "spider-1": { cell: "cell-2-2" }, "fly-1": { cell: "cell-3-2" } };
  const { addresseeId, claimPills } = pillsForSpiderFly(agents, "spider-9", {});
  assert.equal(addresseeId, "spider-1");
  assert.equal(claimPills.length, 2);
});

test("pillsForSpiderFly: no live agents at all yields empty pill sets, never a thrown error", () => {
  assert.deepEqual(pillsForSpiderFly({}, null, {}), { addressPills: [], claimPills: [], addresseeId: null });
});

test("pillsForSpiderFly: a spider with no live fly at all still offers its own address pill, with an empty claim set", () => {
  const agents = { "spider-1": { cell: "cell-2-2" } };
  const { addressPills, claimPills, addresseeId } = pillsForSpiderFly(agents, null, {});
  assert.deepEqual(addressPills, [{ id: "spider-1", kind: "spider", label: "@spider" }]);
  assert.equal(addresseeId, "spider-1");
  assert.deepEqual(claimPills, []);
});
