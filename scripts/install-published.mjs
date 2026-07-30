// scripts/install-published.mjs — install THIS commit's version of the package
// from the public npm registry into a throwaway directory, the way a consumer
// would, and print the path to the installed binary.
//
// The point is the gap smoke:deploy cannot close: that script asks the registry
// what version it SERVES, which proves propagation and nothing about whether the
// tarball works. This installs it for real — dependency resolution, bin links,
// shipped data files — so the e2e CLI/TUI files can then be run against the
// installed binary instead of bin/tmct.mjs in the source tree.
//
// A publish lands on the registry a minute or two after the job that pushed it,
// so the version probe polls before giving up, same posture as
// scripts/post-deploy-smoke.mjs.
//
// Prints the absolute path of the installed binary on the last stdout line, so a
// CI job can capture it:
//   TMCT_E2E_CLI_BIN=$(node scripts/install-published.mjs | tail -1)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const REGISTRY_URL = `https://registry.npmjs.org/${name.replace("/", "%2f")}`;
const ATTEMPTS = Number(process.env.INSTALL_ATTEMPTS ?? 10);
const DELAY_MS = Number(process.env.INSTALL_DELAY_MS ?? 30_000);
const FETCH_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 300_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the registry already serves this exact version. */
async function versionIsPublished() {
  const res = await fetch(`${REGISTRY_URL}/${version}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "user-agent": `${name} install-published` },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return JSON.parse(await res.text()).version === version;
}

async function waitForPublish() {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    let live = false;
    let failure = null;
    try {
      live = await versionIsPublished();
    } catch (err) {
      failure = err.message;
    }
    console.error(`attempt ${attempt}/${ATTEMPTS}: registry has ${name}@${version}? ${failure ?? live}`);
    if (live) return;
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
  throw new Error(`${name}@${version} never appeared on the registry after ${ATTEMPTS} attempts`);
}

/** A clean consumer install: its own directory, its own package.json, and npm
 *  run from THERE so the repo's own .npmrc (ignore-scripts, save-exact) plays no
 *  part — a real consumer's install has neither. */
function installIntoTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "tmct-published-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "tmct-published-consumer", private: true, version: "0.0.0" }, null, 2)}\n`);
  execFileSync("npm", ["install", "--no-save", "--no-fund", "--no-audit", `${name}@${version}`], {
    cwd: dir,
    // npm's own chatter goes to STDERR so stdout stays reserved for the one
    // line the caller captures: the installed binary's path.
    stdio: ["ignore", 2, "inherit"],
    timeout: INSTALL_TIMEOUT_MS,
  });
  return dir;
}

async function main() {
  await waitForPublish();
  const dir = installIntoTempDir();
  const packageDir = join(dir, "node_modules", ...name.split("/"));
  const installed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (installed.version !== version) {
    throw new Error(`installed ${name}@${installed.version} but this commit is ${version}`);
  }
  const binary = join(packageDir, installed.bin?.tmct ?? "bin/tmct.mjs");
  const help = execFileSync(process.execPath, [binary, "--help"], { encoding: "utf8", timeout: 60_000 });
  if (!help.includes("tmct")) throw new Error("the installed binary printed no recognisable help");
  console.error(`installed ${name}@${installed.version} into ${dir}`);
  console.log(binary);
}

await main();
