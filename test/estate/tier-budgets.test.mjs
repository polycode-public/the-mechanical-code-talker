// The smoke and fast tiers are named after their budgets, so the budget is a
// contract and this is what holds them to it. A tier that breaks its budget is a
// bug in the tier: cut its content, never raise the number here.
//
// Measured best-of-three, taking the MINIMUM rather than the mean. These walls swing
// badly on a shared machine — the same corpus lane has measured 5.4s and 31.6s — and
// every source of that swing (another session compiling, a busy disk) only ever ADDS
// time. So the minimum of a few runs is the closest thing to a quiet-machine number
// this suite can get without owning the machine, and a mean would just import the
// noise it is trying to reject.
//
// This guard lives in the estate tier rather than inside test/smoke/ or test/fast/
// because a tier that measures itself pays its own cost twice, which would make
// `npm run test:smoke` miss the budget it exists to prove.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
const RUNS = 3;

// Measure the npm script itself, not a transcription of it — so a tier that grows a
// file in package.json is measured with that file in it, and the budget cannot be
// dodged by editing one of the two lists.
function fastestWall(scriptName) {
  const command = SCRIPTS[scriptName];
  assert.ok(command, `package.json has no "${scriptName}" script for this budget to measure`);
  let best = Infinity;
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    execSync(command, { cwd: REPO, stdio: "ignore" });
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

test("the smoke tier answers inside the one second it is named after", () => {
  const wall = fastestWall("test:smoke");
  assert.ok(wall < 1000, `test:smoke took ${wall.toFixed(0)}ms, over its 1000ms budget — cut content, don't raise the budget`);
});

test("the fast tier answers inside the ten seconds it is named after", () => {
  const wall = fastestWall("test:fast");
  assert.ok(wall < 10000, `test:fast took ${wall.toFixed(0)}ms, over its 10000ms budget — cut content, don't raise the budget`);
});
