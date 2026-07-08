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

const FLAT_FILES = ["ask.mjs", "ask-vocab.mjs", "prose.mjs", "codegraph.mjs", "embed.mjs", "wink-model.mjs", "ask-nlp.mjs"];
const INTERPRET_FILES = ["normalize.mjs", "fuzzy.mjs", "merge.mjs", "pipeline.mjs"];
const STRATEGY_FILES = ["grammar.mjs", "keywords.mjs", "noise-strip.mjs", "ace.mjs"];
const GRAMMAR_FILES = ["ace.mjs", "lexicon.mjs", "lexicon-core.json"];

mkdirSync(join(OUT, "interpret", "strategies"), { recursive: true });
mkdirSync(join(OUT, "grammar"), { recursive: true });

for (const f of FLAT_FILES) cpSync(join(SRC, f), join(OUT, f));
for (const f of INTERPRET_FILES) cpSync(join(SRC, "interpret", f), join(OUT, "interpret", f));
for (const f of STRATEGY_FILES) cpSync(join(SRC, "interpret", "strategies", f), join(OUT, "interpret", "strategies", f));
for (const f of GRAMMAR_FILES) cpSync(join(SRC, "grammar", f), join(OUT, "grammar", f));

console.log(`copied ${FLAT_FILES.length + INTERPRET_FILES.length + STRATEGY_FILES.length + GRAMMAR_FILES.length} engine source files into ${OUT}`);

execFileSync(process.execPath, [join(here, "build-demo-graph.mjs")], { stdio: "inherit" });
