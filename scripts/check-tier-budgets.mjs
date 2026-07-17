// The smoke and fast tiers are named after their budgets, so the budget is a
// contract. This is what holds them to it: a tier that breaks its budget is a bug
// in the tier — cut its content, never raise the number here.
//
// This is a CI check rather than a test, and that is not a filing decision. It
// measures wall-clock, and `npm test` runs eight workers at once, so a budget test
// inside the suite spends its whole measurement competing with the thing it is
// timing. It read 4,135ms against a 1,000ms budget that way while the tier itself
// takes ~620ms — the number said nothing about the tier and everything about the
// machine. Benchmarks do not run under load.
//
// Measured best-of-three, taking the MINIMUM rather than the mean. These walls
// swing badly on a shared machine — the same corpus lane has measured 5.4s and
// 31.6s — and every source of that swing only ever ADDS time, so the minimum is
// the closest thing to a quiet-machine number available without owning the
// machine. A mean would import the noise it is trying to reject.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
const RUNS = 3;

// Budgets are in milliseconds, and the tier's name is the contract.
const TIERS = [
  { script: "test:smoke", budget: 1000 },
  { script: "test:fast", budget: 10000 },
];

// Measure the npm script itself, not a transcription of it, so a tier that grows a
// file in package.json is measured with that file in it and the budget cannot be
// dodged by editing one of two lists.
function fastestWall(scriptName) {
  const command = SCRIPTS[scriptName];
  if (!command) throw new Error(`package.json has no "${scriptName}" script for this budget to measure`);
  let best = Infinity;
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    execSync(command, { cwd: REPO, stdio: "ignore" });
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

let failed = false;
for (const { script, budget } of TIERS) {
  const wall = fastestWall(script);
  const verdict = wall < budget ? "ok" : "OVER BUDGET";
  console.log(`${script.padEnd(12)} ${wall.toFixed(0).padStart(6)}ms / ${budget}ms  ${verdict}`);
  if (wall >= budget) {
    failed = true;
    console.error(`  ${script} is over the budget its name promises — cut content, don't raise the budget.`);
  }
}
process.exit(failed ? 1 : 0);
