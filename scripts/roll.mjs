// scripts/roll.mjs — one command to bump the version and regenerate every
// artifact that carries the version, so a release never ships a stale stamp.
//
//   node scripts/roll.mjs [--patch|--minor|--major] [--version <x.y.z>]
//   npm run roll                       # patch (default): 2.5.0 -> 2.5.1
//   npm run roll -- --minor            # 2.5.0 -> 2.6.0   (note the `--`: npm
//   npm run roll -- --major            # forwards script args only after it)
//   npm run roll -- --version 3.0.0    # set an exact version
//
// It bumps package.json (and the lockfile) with NO git tag and NO commit — the
// caller commits — then regenerates the two committed artifacts that carry
// the version and must not ship stale: the agentbench envelope and the
// infbench envelope.
//
// Nothing else in the tree is committed with the version baked in anymore, so
// nothing else needs a local rebuild here:
//   - the home page's version.txt is gitignored and written fresh by whichever
//     CI job builds the site (deploy:website), not committed;
//   - the screenshot manifest's tmctVersion field is likewise not something a
//     local roll needs to chase — run `npm run gen:screenshots` directly when
//     you actually want new screenshots, version bump or not;
//   - the browser ask bundle (src/surfaces/web/memory-ask-browser.bundle.js)
//     is code-derived, not version-stamped, and no longer committed either —
//     publish:npm, pack:contents, and the two shared e2e job bases each build
//     their own fresh copy in CI.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let release = "patch";
let explicit = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--patch" || a === "--minor" || a === "--major") release = a.slice(2);
  else if (a === "--version") explicit = args[(i += 1)];
  else if (a.startsWith("--version=")) explicit = a.slice("--version=".length);
  else {
    console.error(`roll: unknown argument "${a}". Usage: roll [--patch|--minor|--major] [--version <x.y.z>]`);
    process.exit(2);
  }
}

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit" });
const versionNow = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// 1) bump package.json + package-lock.json, no git tag, no commit
run("npm", ["version", explicit ?? release, "--no-git-tag-version", "--allow-same-version"]);
const version = versionNow();
console.log(`\nrolled to ${version} — regenerating version-stamped artifacts\n`);

// 2) regenerate the committed, version-stamped release artifacts
run("node", ["test-benchmarks/agentbench/generate-envelope.mjs"]); // test-benchmarks/agentbench/envelope.json
run("node", ["test-benchmarks/infbench/generate-envelope.mjs"]); // test-benchmarks/infbench/envelope.json

console.log(`\nroll complete: ${version}. Review with \`git status\`, then commit.`);
