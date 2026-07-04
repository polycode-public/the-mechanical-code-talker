// C# extractor — Roslyn (syntax-level) via the bundled dotnet tool. PICKED C#
// candidate when dotnet is present. Spawns roslyn/publish/roslyn-extract which
// prints the {modules:[…]} contract; this wrapper just shells out and parses it.
// Falls back is the caller's job (cs_treesitter) when dotnet/the tool is absent.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const TOOL_DLL = join(here, "..", "roslyn", "publish", "roslyn-extract.dll");

export async function toolAvailable() {
  try { await access(TOOL_DLL); return true; } catch { return false; }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } });
    let out = ""; let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

export async function ingest(root) {
  if (!(await toolAvailable())) throw new Error("roslyn-extract.dll not built (run dotnet publish in roslyn/)");
  const { code, out, err } = await run("dotnet", [TOOL_DLL, root]);
  if (code !== 0) throw new Error(`roslyn-extract failed (exit ${code}): ${err.slice(-300)}`);
  let parsed;
  try { parsed = JSON.parse(out); }
  catch { throw new Error(`roslyn-extract produced non-JSON (${out.slice(0, 120)})`); }
  return { modules: parsed.modules || [], failures: parsed.failures || [], fileCount: parsed.fileCount || 0 };
}

export const meta = { id: "roslyn", language: "c#", lib: "Roslyn (Microsoft.CodeAnalysis.CSharp, syntax-level)", exts: [".cs"] };
