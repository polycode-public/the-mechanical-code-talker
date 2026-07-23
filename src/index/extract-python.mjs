// Python extractor — stdlib `ast`, zero npm dependency. Runs extract_ast.py as a
// subprocess over the whole repo (the script does its own deterministic walk and
// emits one JSON doc: {modules:[{path,dotted,imports,defines,calls,exports}]} —
// the same contract the in-process JS/TS extractor emits) and parses the result.
//
// Requires a `python3` interpreter at index time (TMCT_PYTHON overrides). This is
// a runtime tool, not an npm dependency — no parser library ships. When no .py
// files are present the subprocess never runs; when python3 is missing but .py
// files exist, the backend degrades: it skips them and reports the count as
// failures rather than crashing the whole index (JS/TS still produces its graph).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { walk, relPath } from "./walk.mjs";
import { exec } from "./spawn.mjs";

const AST_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "extract_ast.py");
const EXTS = [".py"];
const PYTHON = () => process.env.TMCT_PYTHON || "python3";

/** Ingest every .py file under `root` → {modules, failures, fileCount} contract.
 *  `ignore` prunes the presence check; extract_ast.py applies its own SKIP_DIRS
 *  when it walks, so the module set follows the script's exclusions. */
export async function ingest(root, { ignore = null } = {}) {
  const files = await walk(root, EXTS, ignore);
  if (files.length === 0) return { modules: [], failures: [], fileCount: 0 };

  const python = PYTHON();
  const res = await exec(python, [AST_SCRIPT, root]);
  if (res.code !== 0) {
    const why = res.stderr.trim().split("\n").pop()?.slice(-200) || `exit ${res.code}`;
    process.stderr.write(
      `tmct index: python backend skipped ${files.length} .py file(s) — "${python}" unavailable or failed (${why})\n`,
    );
    return { modules: [], failures: files.map((f) => relPath(root, f)), fileCount: files.length };
  }
  let parsed;
  try { parsed = JSON.parse(res.stdout); }
  catch {
    process.stderr.write(`tmct index: python backend produced non-JSON (is "${python}" a Python 3.9+ interpreter?)\n`);
    return { modules: [], failures: files.map((f) => relPath(root, f)), fileCount: files.length };
  }
  const modules = Array.isArray(parsed?.modules) ? parsed.modules : [];
  return { modules, failures: [], fileCount: files.length };
}

export const meta = { id: "ast", language: "python", lib: "python stdlib ast", exts: EXTS };
