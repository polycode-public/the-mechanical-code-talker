// scripts/roll.mjs — bump the version, with NO git tag and NO commit — the
// caller commits.
//
//   node scripts/roll.mjs [--patch|--minor|--major] [--version <x.y.z>]
//   npm run roll                       # patch (default): 2.5.0 -> 2.5.1
//   npm run roll -- --minor            # 2.5.0 -> 2.6.0   (note the `--`: npm
//   npm run roll -- --major            # forwards script args only after it)
//   npm run roll -- --version 3.0.0    # set an exact version
//
// Nothing in the tree is committed with the version baked into its own
// content anymore, so a version bump alone never makes anything else stale:
//   - the agentbench/infbench envelopes read package.json for the version
//     when a caller needs it; they don't embed it, so a bump that changes
//     nothing about either benchmark's own behavior never touches them;
//   - the home page's version.txt is gitignored and written fresh by
//     whichever CI job builds the site (deploy:website), not committed;
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

run("npm", ["version", explicit ?? release, "--no-git-tag-version", "--allow-same-version"]);
const version = versionNow();

console.log(`\nrolled to ${version}. Review with \`git status\`, then commit.`);
