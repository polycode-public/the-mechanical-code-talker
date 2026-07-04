// Multi-language front-end for the seonix index. Detects which non-Python
// languages are present under <root>, runs the PICKED extractor per language
// (each emitting the SAME `{modules:[{path,dotted,imports,defines,calls,exports}]}`
// contract extract_ast.py prints), and merges them. The product's extract.mjs owns
// buildEntities + git history; this module is parse-only and returns RAW modules.
//
// Offline, deterministic, ZERO-LLM (static parsing only). No source content leaves
// the machine. Python stays the responsibility of extract_ast.py (extract.mjs);
// this covers JS/TS (ts-morph) and C# (Roslyn, with a tree-sitter fallback).
import * as jstsTsc from "./jsts_tsc.mjs";
import * as csRoslyn from "./cs_roslyn.mjs";
import * as csTree from "./cs_treesitter.mjs";
import * as javaJavaparser from "./java_javaparser.mjs";
import * as javaTree from "./java_treesitter.mjs";

// THE EXTRACTOR REGISTRY — the single place a new language plugs in. Keyed by
// language; `exts` is the file-extension surface it owns, `pick` the default
// extractor, `alt` the fallback. Everything downstream is language-agnostic.
export const REGISTRY = {
  "js/ts": { exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], pick: jstsTsc, alt: null },
  "c#": { exts: [".cs"], pick: csRoslyn, alt: csTree },
  "java": { exts: [".java"], pick: javaJavaparser, alt: javaTree },
};

/** The full set of file extensions this front-end indexes (sorted, lower-cased).
 *  extract.mjs unions this with `.py` to gate its git-log file filters. */
export const LANG_EXTS = [...new Set(Object.values(REGISTRY).flatMap((r) => r.exts))].sort();

/** Choose the C# extractor: Roslyn when its built tool is present, else tree-sitter. */
async function chooseCs(prefer) {
  if (prefer === "treesitter") return csTree;
  if (prefer === "roslyn" || prefer === undefined) {
    if (await csRoslyn.toolAvailable()) return csRoslyn;
  }
  return csTree;
}

/** Choose the Java extractor: JavaParser+SymbolSolver (JDK helper) when a `java`
 *  runtime and the built jar are present, else the tree-sitter fallback. */
async function chooseJava(prefer) {
  if (prefer === "treesitter") return javaTree;
  if (prefer === "javaparser" || prefer === undefined) {
    if (await javaJavaparser.toolAvailable()) return javaJavaparser;
  }
  return javaTree;
}

/**
 * Parse every supported non-Python language under `root` and merge the results.
 * @returns {Promise<{modules:Array, perLang:Object, totalFiles:number, failures:Array}>}
 */
export async function ingestRepo(root, { cs, java, ignore = null } = {}) {
  const csExtractor = await chooseCs(cs);
  const javaExtractor = await chooseJava(java);
  const plan = [
    { lang: "js/ts", extractor: jstsTsc },
    { lang: "c#", extractor: csExtractor },
    { lang: "java", extractor: javaExtractor },
  ];
  const allModules = [];
  const perLang = {};
  let totalFiles = 0;
  const allFailures = [];
  for (const { lang, extractor } of plan) {
    const t0 = Date.now();
    const { modules, failures, fileCount } = await extractor.ingest(root, { ignore });
    const ms = Date.now() - t0;
    if (fileCount === 0) continue; // language not present
    allModules.push(...modules);
    totalFiles += fileCount;
    allFailures.push(...failures);
    const symbols = modules.reduce((n, m) => n + (m.defines?.length || 0), 0);
    perLang[lang] = { lib: extractor.meta.lib, files: fileCount, modules: modules.length, symbols, failures: failures.length, ms };
  }
  return { modules: allModules, perLang, totalFiles, failures: allFailures };
}
