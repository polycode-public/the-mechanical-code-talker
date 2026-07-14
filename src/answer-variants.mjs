// answer-variants.mjs — deterministic, committed answer-phrasing variety for
// a curated set of answer templates (answer-variants.json).
//
// Selection is a pure hash of (poolId, key), never Math.random/Date.now, so
// output is byte-identical across runs (pinnable in tests). Load is lazy and
// failure-tolerant (missing file, or a stubbed node:fs in the browser bundle,
// both degrade to returning `base`) rather than throwing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), "answer-variants.json");

let dataCache; // undefined = not yet attempted; null = load failed/unavailable
function loadData() {
  if (dataCache !== undefined) return dataCache;
  try {
    dataCache = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch {
    dataCache = null;
  }
  return dataCache;
}

/** Deterministically choose `base` or one of `poolId`'s committed variants,
 *  keyed on `key`. Any failure (unknown pool, unreadable data, falsy `key`)
 *  falls back to `base`. */
export function pickPhrase(poolId, key, base) {
  if (!key) return base;
  const data = loadData();
  const variants = data?.pools?.[poolId]?.variants;
  if (!Array.isArray(variants) || !variants.length) return base;
  const forms = [base, ...variants];
  const digest = createHash("sha256").update(`${poolId}:${String(key)}`).digest();
  const idx = digest[0] % forms.length;
  return forms[idx];
}
