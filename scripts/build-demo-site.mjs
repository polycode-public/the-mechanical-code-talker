// scripts/build-demo-site.mjs — regenerate everything the GitLab Pages site
// generates rather than tracks:
//
//   engine/           unmodified copies of the engine sources the in-page demo runs
//   demo-graph.json   the example code graph (see build-demo-graph.mjs)
//   demo-memory.json  the taught payload behind the ledger (see build-demo-memory.mjs)
//   ledger.html       the memory ledger, with the ask bundle inlined
//   plan.html         an animated replay of the solved hanoi-3 game
//
// All of them are .gitignored. src/, examples/mini-webapp/.tmct/graph.json and the
// binary stay the single source of truth, so the published site cannot drift from
// them. Run via `npm run demo:build`, the same script .gitlab-ci.yml's `pages` job
// calls, whenever you want to serve public/ locally and try the site yourself.
//
// The copied engine set is whatever src/domain/ask.mjs's imports actually reach, walked
// from the source at build time. The copies keep src/'s directory layout under
// public/engine/src/, because their own relative imports have to keep resolving.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SRC = join(ROOT, "src");
// Everything generated lands under SITE. It defaults to the repo's own public/,
// which is what CI and a local `npm run demo:build` want. Set TMCT_DEMO_SITE_OUT
// to build into a directory of your own instead — the browser tests do that so
// their run neither reads nor writes public/ while another build is touching it.
const SITE = process.env.TMCT_DEMO_SITE_OUT ? resolve(process.env.TMCT_DEMO_SITE_OUT) : join(ROOT, "public");
const OUT = join(SITE, "engine", "src");

// Relative specifiers only. Bare ones (wink-nlp) and node: builtins are the
// import map's job, and the shims under public/engine-shims/ stand in for them.
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.[^"']*)["']/g;

// The wink lemma/POS tier arrives through a computed specifier, so reading the
// source cannot see it. Everything these two reach is walked like any other file.
const DYNAMICALLY_LOADED = ["adapters/wink-model.mjs", "adapters/ask-nlp.mjs"];

/** Every file under src/ that `entry`'s imports reach, as paths relative to src/. */
function engineImportClosure(entry) {
  const reached = new Set();
  const visit = (file) => {
    const rel = relative(SRC, file);
    if (reached.has(rel) || !existsSync(file)) return;
    reached.add(rel);
    if (file.endsWith(".json")) return;
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
      visit(resolve(dirname(file), specifier));
    }
  };
  visit(join(SRC, entry));
  for (const file of DYNAMICALLY_LOADED) visit(join(SRC, file));
  return [...reached].sort();
}

const engineFiles = engineImportClosure("domain/ask.mjs");
for (const rel of engineFiles) {
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  cpSync(join(SRC, rel), join(OUT, rel));
}

console.log(`copied ${engineFiles.length} engine source files into ${OUT}`);

execFileSync(process.execPath, [join(here, "build-demo-graph.mjs"), join(SITE, "demo-graph.json")], { stdio: "inherit" });

// The ledger hero: build the memory payload through the real teach paths, then
// render public/ledger.html (self-contained, memory-ask bundle inlined) —
// the same page `tmct viz --ledger` writes, so the site can't drift from it.
const { main: buildDemoMemory } = await import(join(here, "build-demo-memory.mjs"));
const { outPath: memoryPath } = await buildDemoMemory(join(SITE, "demo-memory.json"));
const { readFile: readF, writeFile: writeF } = await import("node:fs/promises");
const { computeLedgerDataFromPayload, renderLedgerHtml, readMemoryAskBundle } = await import(join(ROOT, "src", "ledger-viz.mjs"));
const payload = JSON.parse(await readF(memoryPath, "utf8"));
const ledgerData = computeLedgerDataFromPayload(payload, {});
const memoryAskBundle = await readMemoryAskBundle();
const ledgerPath = join(SITE, "ledger.html");
await writeF(ledgerPath, renderLedgerHtml({ ...ledgerData, memoryAskBundle }));
console.log(`wrote ${ledgerPath} (${memoryAskBundle ? "chat dock enabled" : "no bundle — dock disabled"})`);

// The plan render: solve the hanoi-3 game through the real planner and keep the
// animated replay. This shells out to the binary a reader would run, so the page
// shows the artefact they get rather than one built a private way.
const HANOI_PROMPT =
  "disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a. " +
  "the goal is that every disk rests on peg-c. solve it.";
const planPath = join(SITE, "plan.html");
const planDir = mkdtempSync(join(tmpdir(), "tmct-demo-plan-"));
// stdin stays closed: chat reads it when it is open, and this run is scripted
// entirely by --prompt. The timeout is generous because these spawns load the
// wink model, and a build sharing a machine with a full test run has been seen
// to take minutes for work that takes seconds idle.
const runTmct = (args) =>
  execFileSync(process.execPath, [join(ROOT, "bin", "tmct.mjs"), ...args], {
    cwd: planDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 480_000,
  });
try {
  runTmct(["init"]);
  runTmct(["import", "--file", join(planDir, ".tmct", "imports", "games", "hanoi-3.txt")]);
  const solved = runTmct(["chat", "--prompt", HANOI_PROMPT, "--render", "blocks", "--output", planPath]);
  console.log(`wrote ${planPath} (${/\((.*?)\)\s*$/.exec(solved.trim())?.[1] ?? "rendered"})`);
} finally {
  rmSync(planDir, { recursive: true, force: true });
}
