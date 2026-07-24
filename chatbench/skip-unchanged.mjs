// chatbench/skip-unchanged.mjs — skip-unchanged-case execution (PLAN lever 6).
//
// The product replay is deterministic: a case whose INPUT is unchanged, run
// against an UNCHANGED engine, produces a byte-identical product row. So a run
// can reuse a prior run's row for such a case instead of replaying it. The reuse
// key is (case-input hash, engine token): the input hash covers everything a
// case feeds the engine (its turns, mode, graph, env), and the engine token is
// the caller's assertion that the code the lane reaches is unchanged since the
// prior run — a git rev, or a hash of the engine tree. Reuse never happens
// without an engine token, so a code change always forces a full replay (the
// caller opts in by asserting the engine is the same).
//
// This is the execution-speed twin of the verdict cache: the cache saves JUDGE
// calls on unchanged answers; this saves PRODUCT replays on unchanged inputs.
// Both key on content, never on file dates.

import { fnv1aHex } from "../src/domain/hash.mjs";

/** A stable, canonical string of everything a case feeds the engine — the fields
 *  that determine its replayed answer. Ordered explicitly (not JSON.stringify of
 *  the whole object) so an incidental field like a comment never perturbs the
 *  hash, and so the string is stable across case-object key reorderings. */
export function caseInputString(caseDef) {
  const turns = (caseDef.turns ?? []).map((t) => `${t.session ?? 1}${t.say ?? ""}`).join("");
  const env = caseDef.env ? Object.keys(caseDef.env).sort().map((k) => `${k}=${caseDef.env[k]}`).join(",") : "";
  return [caseDef.mode ?? "", caseDef.graph ?? "", env, turns].join("");
}

/** The case-input hash — a narrow content address over caseInputString. */
export function caseInputHash(caseDef) {
  return fnv1aHex(caseInputString(caseDef));
}

/** Partition cases against a prior run's rows for reuse. A prior row is reusable
 *  for a case iff the engine token matches AND the prior row's recorded
 *  caseInputHash equals this case's — i.e. same input, same engine. Returns
 *  `reuse` (a Map caseId -> prior row to keep verbatim) and `run` (the cases
 *  that must be replayed). With no engine token, nothing is reused. */
export function partitionForReuse(cases, priorRows, engineToken) {
  const reuse = new Map();
  const run = [];
  const priorById = new Map((priorRows ?? []).map((r) => [r.caseId, r]));
  for (const c of cases) {
    const prior = priorById.get(c.id);
    if (engineToken && prior && prior.engineToken === engineToken && prior.caseInputHash === caseInputHash(c)) {
      reuse.set(c.id, prior);
    } else {
      run.push(c);
    }
  }
  return { reuse, run, counts: { total: cases.length, reused: reuse.size, run: run.length } };
}

/** Stamp reuse provenance onto a freshly-run product row so the NEXT run can
 *  reuse it. Only called when the caller supplied an engine token; without one
 *  the row shape is unchanged (byte-identical to a run that never asked for
 *  reuse), so existing determinism assertions are unaffected. */
export function stampReuseFields(row, caseDef, engineToken) {
  return { ...row, engineToken, caseInputHash: caseInputHash(caseDef) };
}
