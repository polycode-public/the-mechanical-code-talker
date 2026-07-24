// synthbench/code/verify/tiers.mjs — run the verification tiers a planned-edit
// case declares (expect.tiers) against a synthesized, non-abstained artifact,
// through the real sandbox. Returns a per-tier result map plus verifiedComplete
// (every declared tier passed). Grading (grade.mjs) is pure and reads this; the
// real execution lives here.
import { openSandbox, nodeCheck, runExportStdout } from "./sandbox.mjs";

/** Verify a planned-edit artifact. `caseDef.expect.tiers` names the tiers:
 *    "parse"       — tier 0, `node --check` on each edited module
 *    "side-effect" — run the export and confirm its stdout carries the token
 *  Returns { tiers: { <name>: { ok, detail } }, verifiedComplete }. */
export function verifyPlannedEdit(caseDef, synth, fixtureRoot) {
  const declared = caseDef.expect?.tiers ?? [];
  const { dir, cleanup } = openSandbox(fixtureRoot, synth.edits);
  const tiers = {};
  try {
    for (const name of declared) {
      if (name === "parse") {
        let result = { ok: true, detail: "" };
        for (const edit of synth.edits) {
          const r = nodeCheck(dir, edit.module);
          if (!r.ok) { result = { ok: false, detail: `${edit.module}: ${r.detail}` }; break; }
        }
        tiers.parse = result;
      } else if (name === "side-effect") {
        const se = caseDef.goal?.sideEffect ?? {};
        const r = runExportStdout(dir, { ...se.run, token: se.contains });
        tiers["side-effect"] = { ok: r.ok, detail: r.detail };
      } else {
        tiers[name] = { ok: false, detail: `unknown tier '${name}'` };
      }
    }
  } finally {
    cleanup();
  }
  const verifiedComplete = declared.length > 0 && declared.every((n) => tiers[n]?.ok);
  return { tiers, verifiedComplete };
}
