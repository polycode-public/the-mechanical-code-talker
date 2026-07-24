// The extractor REGISTRY — the single place a language backend plugs in. Keyed
// by language; `exts` is the file-extension surface it owns, `extractor` the
// module that turns those files into the shared `{modules:[…]}` contract. Every
// backend emits the SAME shape (path, dotted, imports, defines, calls, exports),
// so everything downstream (index-repo.mjs, buildEntities) is language-agnostic.
import * as jsts from "./extract-jsts.mjs";
import * as python from "./extract-python.mjs";

export const REGISTRY = {
  "js/ts": { exts: jsts.meta.exts, extractor: jsts },
  python: { exts: python.meta.exts, extractor: python },
};

/** The full set of file extensions the registry covers (sorted, lower-cased). */
export const LANG_EXTS = [...new Set(Object.values(REGISTRY).flatMap((r) => r.exts))].sort();

/** Parse every registered language under `root` and merge the per-language module
 *  lists into one. Returns {modules, perLang, totalFiles, failures}. A language
 *  with zero files present is silently absent from `perLang`. */
export async function ingestRepo(root, { ignore = null } = {}) {
  const allModules = [];
  const perLang = {};
  let totalFiles = 0;
  const allFailures = [];
  for (const [lang, { extractor }] of Object.entries(REGISTRY)) {
    const t0 = Date.now();
    const { modules, failures, fileCount } = await extractor.ingest(root, { ignore });
    const ms = Date.now() - t0;
    if (fileCount === 0) continue; // language not present
    for (const m of modules) allModules.push(m);
    totalFiles += fileCount;
    for (const f of failures) allFailures.push(f);
    const symbols = modules.reduce((n, m) => n + (m.defines?.length || 0), 0);
    perLang[lang] = { lib: extractor.meta.lib, files: fileCount, modules: modules.length, symbols, failures: failures.length, ms };
  }
  return { modules: allModules, perLang, totalFiles, failures: allFailures };
}
