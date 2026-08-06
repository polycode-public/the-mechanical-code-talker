// scripts/claims/run-all.mjs — runs every `claim:*` script listed in
// package.json and fails if any of them fail. Backs `npm run claims`.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const claimScripts = Object.keys(pkg.scripts ?? {}).filter((name) => name.startsWith("claim:")).sort();

if (claimScripts.length === 0) {
  console.log("claims: no claim:* scripts registered in package.json, nothing to run");
  process.exit(0);
}

const failures = [];
for (const script of claimScripts) {
  console.log(`claims: running ${script}`);
  const result = spawnSync("npm", ["run", script], { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) failures.push(script);
}

if (failures.length > 0) {
  console.error(`claims: ${failures.length} rig(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}

console.log(`claims: ${claimScripts.length} rig(s) passed`);
