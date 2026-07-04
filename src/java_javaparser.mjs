// Java extractor — JavaParser + JavaSymbolSolver (resolved calls) via the bundled
// JVM helper. PICKED Java candidate when a JDK/`java` runtime is present. Spawns
// `java -jar java/dist/seonix-java-extract.jar <root>` which prints the
// {modules:[…]} contract; this wrapper just shells out and parses it. Falling back
// (java_treesitter) is the caller's job when `java`/the jar is absent.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const TOOL_JAR = join(here, "..", "java", "dist", "seonix-java-extract.jar");

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let out = ""; let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

let _javaOk = null;
async function javaOnPath() {
  if (_javaOk !== null) return _javaOk;
  const { code } = await run("java", ["-version"]);
  _javaOk = code === 0;
  return _javaOk;
}

async function jarExists() {
  try { await access(TOOL_JAR); return true; } catch { return false; }
}

/** True iff a `java` runtime is on PATH AND the shaded fat-jar is present. */
export async function toolAvailable() {
  if (!(await jarExists())) return false;
  return javaOnPath();
}

export async function ingest(root) {
  if (!(await jarExists())) throw new Error("seonix-java-extract.jar not built (run `mvn package` in java/)");
  if (!(await javaOnPath())) throw new Error("`java` runtime not on PATH (install a JDK, or use the tree-sitter fallback)");
  const { code, out, err } = await run("java", ["-jar", TOOL_JAR, root]);
  if (code !== 0) throw new Error(`seonix-java-extract failed (exit ${code}): ${err.slice(-300)}`);
  let parsed;
  try { parsed = JSON.parse(out); }
  catch { throw new Error(`seonix-java-extract produced non-JSON (${out.slice(0, 120)})`); }
  return { modules: parsed.modules || [], failures: parsed.failures || [], fileCount: parsed.fileCount || 0 };
}

export const meta = { id: "javaparser", language: "java", lib: "JavaParser + JavaSymbolSolver (resolved calls)", exts: [".java"] };
