// memory/bias.mjs — bias-weighted fact ranking, separate from trust.mjs's
// computeTrust. `biasByBundle` is the `[bias]` table from tmct.toml. CRITICAL:
// bias only REORDERS a hit list — it must never drop or hide one.

import { compareFactsByContent } from "./fact-order.mjs";

/** Matches a corpus-kind Source id ("src:corpus:<bundleName>"); anything else
 *  is not a corpus bundle and ranks at the neutral bias of 1. */
const CORPUS_SOURCE_RE = /^src:corpus:(.+)$/;

/** The bias weight of one Source id, resolved against `biasByBundle` (default
 *  1 when unconfigured or non-numeric; never throws). */
export function biasForSourceId(sourceId, biasByBundle = {}) {
  const m = CORPUS_SOURCE_RE.exec(String(sourceId || ""));
  if (!m) return 1;
  const v = biasByBundle?.[m[1]];
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

/** A fact row's bias: the MAX across its (possibly several) Sources, never
 *  averaged down. No sourceIds -> neutral 1. */
export function biasForRow(row, biasByBundle = {}) {
  const ids = Array.isArray(row?.sourceIds) ? row.sourceIds : [];
  if (!ids.length) return 1;
  return Math.max(...ids.map((id) => biasForSourceId(id, biasByBundle)));
}

/** Rank fact rows by bias (desc), then trust (desc), then content order —
 *  reorders only, never drops a row. The last step is content and not array
 *  index on purpose: an index tiebreak is arrival order, so two peers holding
 *  one fact set would rank it two ways. */
export function rankByBiasThenTrust(rows, biasByBundle = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row) => ({ row, bias: biasForRow(row, biasByBundle) }))
    .sort((a, b) => (b.bias - a.bias) || ((b.row?.trust ?? 0) - (a.row?.trust ?? 0)) || compareFactsByContent(a.row, b.row))
    .map((x) => x.row);
}
