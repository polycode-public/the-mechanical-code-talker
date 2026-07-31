// synthbench/code/verify/sandbox.mjs — the REAL-execution surface for the
// planned-edit family. Copies a fixture repo into an OS temp dir, writes the
// synthesized edits over it, and runs the verification tiers in a subprocess:
// tier 0 is `node --check` (the real parser), the side-effect check runs the
// edited export and reads its stdout. No candidate-authored code runs beyond the
// fixture's own declared source; this is OS-process isolation, the mildest
// sandbox the skill's §6 assigns SYN-0. Nothing here samples — same edits in,
// same subprocess results out.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Materialize a fixture repo into a throwaway dir with the edits applied.
 *  Returns { dir, cleanup } — the caller MUST call cleanup(). */
export function openSandbox(fixtureRoot, edits) {
  const dir = mkdtempSync(join(tmpdir(), "tmct-synthbench-"));
  cpSync(fixtureRoot, dir, { recursive: true });
  for (const edit of edits) writeFileSync(join(dir, edit.module), edit.text);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Tier 0: the edited module re-parses through the real toolchain (`node
 *  --check`). Returns { ok, detail }. */
export function nodeCheck(dir, relModule) {
  const r = spawnSync(process.execPath, ["--check", join(dir, relModule)], { encoding: "utf8" });
  return { ok: r.status === 0, detail: r.status === 0 ? "" : (r.stderr || "").trim().split("\n")[0] };
}

/** The side-effect tier: run `<export>(...args)` from the edited module in a
 *  subprocess and report whether its stdout contains `token`. Real execution of
 *  the fixture's own function, reading the observable output the edit added.
 *  Returns { ok, stdout, detail }. */
export function runExportStdout(dir, { module: relModule, export: exportName, args = [], token }) {
  const target = join(dir, relModule);
  const script =
    `import(${JSON.stringify(target)}).then((m) => { m[${JSON.stringify(exportName)}](...${JSON.stringify(args)}); })` +
    `.catch((e) => { console.error(String(e)); process.exit(3); });`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const stdout = r.stdout ?? "";
  if (r.status !== 0) return { ok: false, stdout, detail: `run exited ${r.status}: ${(r.stderr || "").trim().split("\n")[0]}` };
  const ok = stdout.includes(token);
  return { ok, stdout, detail: ok ? "" : `stdout did not contain ${JSON.stringify(token)}` };
}
