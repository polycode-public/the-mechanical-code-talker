// answer-variants.mjs — deterministic, committed answer-phrasing variety for
// a curated set of answer templates (answer-variants.json).
//
// Selection is a pure hash of (poolId, key), never Math.random/Date.now, so
// output is byte-identical across runs (pinnable in tests). The data rides in
// as a JSON module (no filesystem read at import or call time); the browser
// bundle stubs this whole module to the base-phrase identity, so the dock's
// wording never varies.

import variantData from "./answer-variants.json" with { type: "json" };
import { sha256Bytes } from "./hash.mjs";

/** Deterministically choose `base` or one of `poolId`'s committed variants,
 *  keyed on `key`. Any failure (unknown pool, missing data, falsy `key`)
 *  falls back to `base`. */
export function pickPhrase(poolId, key, base) {
  if (!key) return base;
  const variants = variantData?.pools?.[poolId]?.variants;
  if (!Array.isArray(variants) || !variants.length) return base;
  const forms = [base, ...variants];
  const idx = sha256Bytes(`${poolId}:${String(key)}`)[0] % forms.length;
  return forms[idx];
}
