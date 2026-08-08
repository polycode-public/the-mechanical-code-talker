// The point of reading drives off rows: the same board, the same engine entry
// point, and a world whose rows say the goblin hunts the fox produces a chase
// rung on the goblin and an evade rung on the fox. The swap lives entirely in
// test/fixtures/mudiii-swapped-cast.json's trait rows — no roles object, no
// config change, no code branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTownSquareTick, startTownSquareGame, townSquareTickPayload } from "../../src/services/predator-prey.mjs";
import { TOWN_SQUARE_LAYOUTS, worldFactRows } from "../../src/domain/town-square-world.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE = JSON.parse(readFileSync(join(REPO_ROOT, "test", "fixtures", "mudiii-swapped-cast.json"), "utf8"));
const LAYOUT = TOWN_SQUARE_LAYOUTS[FIXTURE.world];
const DRIVE_PREDICATES = ["mgx:pursues", "mgx:evades", "mgx:consumes"];

async function swappedBoard(label) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-mudiii-swapped-${label}-`));
  const shippedRowsMinusDrives = [...worldFactRows(LAYOUT)]
    .filter((f) => !DRIVE_PREDICATES.includes(f.predicate))
    .map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: `world:${LAYOUT.name}` }));
  await appendFacts(dir, shippedRowsMinusDrives);
  await appendFacts(dir, FIXTURE.traitRows.map((f) => ({ ...f, provenance: `world:${LAYOUT.name}` })));
  await startTownSquareGame(dir, { layout: LAYOUT, agents: FIXTURE.initial.agents });
  return dir;
}

test("the swapped rows send the goblin to the chase rung and the fox to the evade rung, through the unchanged engine", async () => {
  const dir = await swappedBoard("rungs");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "chase", "the goblin's own pursues row makes it the hunter");
    assert.match(tick.agents["goblin-1"].goal, /chasing fox-1/);
    assert.equal(tick.agents["goblin-1"].mood, "angry");
    assert.equal(tick.rungs["fox-1"], "evade", "the fox's fear derives from the goblin's own consumes row");
    assert.match(tick.agents["fox-1"].goal, /evading — last saw goblin-1/);
    assert.equal(tick.agents["fox-1"].mood, "scared");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two separate swapped stores play the same opening tick byte-identically", async () => {
  const first = await swappedBoard("determinism-a");
  const second = await swappedBoard("determinism-b");
  try {
    const a = townSquareTickPayload(await runTownSquareTick(first, { layout: LAYOUT }));
    const b = townSquareTickPayload(await runTownSquareTick(second, { layout: LAYOUT }));
    assert.deepEqual(a, b);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
