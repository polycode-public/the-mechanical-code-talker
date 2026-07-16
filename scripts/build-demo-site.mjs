// scripts/build-demo-site.mjs — regenerate the two CI-generated pieces the GitLab
// Pages site's live chat demo needs: public/engine/ (literal, unmodified copies of the
// small browser-clean transitive import set src/ask.mjs's ask() actually needs) and
// public/demo-graph.json (see build-demo-graph.mjs). Both are .gitignored — src/ and
// examples/mini-webapp/.tmct/graph.json stay the single source of truth, so the
// published site can never silently drift from them. Run via `npm run demo:build`
// (same script .gitlab-ci.yml's `pages` job calls) whenever you want to serve public/
// locally (e.g. `npx serve public`) and try the live demo yourself.
//
// The copied file set + directory layout is exactly what src/ask.mjs's real import
// graph needs (verified transitively — see the implementation report): copying
// src/interpret/ or src/grammar/ flat would break their own relative imports, so the
// layout under public/engine/src/ mirrors src/'s own structure.

import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "public", "engine", "src");

// Paths are src-relative, and each file is copied to the same path under OUT,
// so the copies' own relative imports resolve exactly as they do in src/.
const ENGINE_FILES = [
  "ask.mjs",
  "ask-vocab.mjs",
  "prose.mjs",
  "codegraph.mjs",
  "adapters/embed.mjs",
  "adapters/wink-model.mjs",
  "adapters/ask-nlp.mjs",
  "interpret/normalize.mjs",
  "interpret/fuzzy.mjs",
  "interpret/merge.mjs",
  "interpret/pipeline.mjs",
  "interpret/strategies/grammar.mjs",
  "interpret/strategies/keywords.mjs",
  "interpret/strategies/noise-strip.mjs",
  "interpret/strategies/ace.mjs",
  "grammar/ace.mjs",
  "grammar/lexicon.mjs",
  "grammar/lexicon-core.json",
];

for (const f of ENGINE_FILES) {
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(SRC, f), dest);
}

console.log(`copied ${ENGINE_FILES.length} engine source files into ${OUT}`);

execFileSync(process.execPath, [join(here, "build-demo-graph.mjs")], { stdio: "inherit" });

// The ledger hero: build the memory payload through the real teach paths, then
// render public/ledger.html (self-contained, memory-ask bundle inlined) —
// the same page `tmct viz --ledger` writes, so the site can't drift from it.
const { main: buildDemoMemory } = await import(join(here, "build-demo-memory.mjs"));
const { outPath: memoryPath } = await buildDemoMemory();
const { readFile: readF, writeFile: writeF } = await import("node:fs/promises");
const { computeLedgerDataFromPayload, renderLedgerHtml, readMemoryAskBundle } = await import(join(ROOT, "src", "ledger-viz.mjs"));
const payload = JSON.parse(await readF(memoryPath, "utf8"));
const ledgerData = computeLedgerDataFromPayload(payload, {});
const memoryAskBundle = await readMemoryAskBundle();
const ledgerPath = join(ROOT, "public", "ledger.html");
await writeF(ledgerPath, renderLedgerHtml({ ...ledgerData, memoryAskBundle }));
console.log(`wrote ${ledgerPath} (${memoryAskBundle ? "chat dock enabled" : "no bundle — dock disabled"})`);
