// memory/bias.mjs — bias-weighted fact ranking (extension-pack batch, Part 6).
//
// A small, PURE module, deliberately SEPARATE from trust.mjs's existing closed
// 3-input computeTrust contract (many tests pin computeTrust's exact
// signature; this module never touches it). Trust answers "how much do I
// believe this fact"; bias answers a DIFFERENT question an operator asks
// explicitly — "when two facts disagree, which BUNDLE do I prefer to hear
// from first" (the worked example: is a class part of code, or part of a
// school — a `[bias]` table lets an operator say "for MY repo, weight the
// code-vocabulary bundle over the general-English one").
//
//   biasForSourceId(sourceId, biasByBundle)  "src:corpus:<name>" -> weight (default 1)
//   biasForRow(row, biasByBundle)            max bias across row.sourceIds
//   rankByBiasThenTrust(rows, biasByBundle)  stable: bias desc, trust desc, original order
//
// biasByBundle is the flat `{ bundleName: number }` table src/extensions.mjs's
// resolveExtensions() reads out of tmct.toml's `[bias]` table — resolved ONCE
// per chat session and threaded through, never re-read per turn.
//
// CRITICAL CONTRACT (the operator's own "disclosed, never dropped"
// requirement): bias only REORDERS a hit list. It must NEVER drop, hide, or
// silently prefer a lower-biased fact over a higher-trust one within the same
// bias tier — every hit rankByBiasThenTrust is given still comes back out,
// same length, same members, just reordered.

/** A Fact's statedBy Source id is shaped "src:corpus:<bundleName>" for every
 *  corpus-kind Source (memory/core.mjs's own sourceIdFor — see its `corpus`
 *  case). Any other shape (operator/teach/provider/web/entailed Source ids,
 *  or a malformed/absent id) is NOT a corpus bundle and always ranks at the
 *  neutral bias of 1 — bias is a corpus-bundle-only concept, never a proxy
 *  for a different trust dimension. */
const CORPUS_SOURCE_RE = /^src:corpus:(.+)$/;

/** The bias weight of one Source id, resolved against `biasByBundle`. Default
 *  1 (neutral) for a non-corpus source id, an unconfigured bundle name, or a
 *  non-numeric configured value (never throws — a malformed `[bias]` entry is
 *  caught earlier, at resolveExtensions() load time). */
export function biasForSourceId(sourceId, biasByBundle = {}) {
  const m = CORPUS_SOURCE_RE.exec(String(sourceId || ""));
  if (!m) return 1;
  const v = biasByBundle?.[m[1]];
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

/** The bias weight of one fact ROW (readFactRows' shape: `{..., sourceIds}`)
 *  — the MAX bias across its (possibly several, corroborating) Sources, so a
 *  fact corroborated by both a neutral and a high-bias bundle ranks at the
 *  higher of the two, never averaged down. A row with no sourceIds (or an
 *  empty array) ranks at the neutral 1. */
export function biasForRow(row, biasByBundle = {}) {
  const ids = Array.isArray(row?.sourceIds) ? row.sourceIds : [];
  if (!ids.length) return 1;
  return Math.max(...ids.map((id) => biasForSourceId(id, biasByBundle)));
}

/**
 * Rank fact rows by bias (desc), then trust (desc), then original relative
 * order (STABLE — Array.prototype.sort is stable in Node, reinforced here
 * with an explicit index tiebreak so the guarantee never depends on engine
 * internals). Every row that goes in comes back out — same length, same
 * members — this ONLY reorders, it never filters or drops a hit, honouring
 * the "disclosed, never dropped" contract every caller in chat.mjs relies on.
 *
 * With an empty/absent `biasByBundle` (the default, unconfigured case) every
 * row's bias is 1 — a true no-op tier, so the sort degrades to trust-desc,
 * ties broken by original order: BYTE-IDENTICAL to today's behaviour for any
 * caller that previously sorted by trust alone (or didn't sort at all and
 * every row happened to share the same trust, the common single-session
 * operator-taught case).
 */
export function rankByBiasThenTrust(rows, biasByBundle = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row, index) => ({ row, index, bias: biasForRow(row, biasByBundle) }))
    .sort((a, b) => (b.bias - a.bias) || ((b.row?.trust ?? 0) - (a.row?.trust ?? 0)) || (a.index - b.index))
    .map((x) => x.row);
}
