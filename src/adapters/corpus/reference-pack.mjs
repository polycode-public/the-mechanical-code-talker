// corpus/reference-pack.mjs — lazy, failure-tolerated loader for the shipped
// reference pack (corpus/reference/): a gzipped term index consulted first,
// then exactly one gzipped JSONL shard per hit. Nothing here ever throws at a
// caller — an absent, truncated or corrupt pack reads as null, and a null is
// the ordinary honest miss.
//
// The provider seam: registerReferencePackProvider swaps the whole lookup
// behind one async `{ lookup(normTerm) }` contract. It exists because the
// browser demo cannot read this filesystem layout — the web surface registers
// a fetch-backed provider over public/reference-pack/ instead, and chat code
// never knows which one it is talking to. No provider registered = the fs
// loader below.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isReferenceArticleRow, isReferenceIndexEntry } from "../../domain/reference-pack.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The pack directory: TMCT_REFERENCE_PACK_DIR when set, else the package's
 *  own corpus/reference/. */
export function referencePackDir(env = process.env) {
  return env?.TMCT_REFERENCE_PACK_DIR || join(PKG_ROOT, "corpus", "reference");
}

const indexCacheByDir = new Map();   // dir -> { term: {s, t, r} } | null
const shardCacheByKey = new Map();   // `${dir}\0${shard}` -> Map(term -> row) | null

/** Drop every cached index/shard — for tests that mutate a pack dir. */
export function clearReferencePackCache() {
  indexCacheByDir.clear();
  shardCacheByKey.clear();
}

function readGunzipped(file) {
  try {
    return gunzipSync(readFileSync(file));
  } catch {
    return null;
  }
}

/** The pack's term index, lazily read and cached per dir; null (cached) when
 *  the pack is absent or unreadable. Never throws. */
export function loadReferenceIndex(dir) {
  if (indexCacheByDir.has(dir)) return indexCacheByDir.get(dir);
  let index = null;
  const body = readGunzipped(join(dir, "index.json.gz"));
  if (body) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) index = parsed;
    } catch { /* tolerated: a corrupt index is an absent pack */ }
  }
  indexCacheByDir.set(dir, index);
  return index;
}

function loadShard(dir, shardName) {
  const key = `${dir}\0${shardName}`;
  if (shardCacheByKey.has(key)) return shardCacheByKey.get(key);
  let rows = null;
  const body = readGunzipped(join(dir, "shards", `${shardName}.jsonl.gz`));
  if (body) {
    rows = new Map();
    for (const line of body.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (isReferenceArticleRow(row)) rows.set(row.term, row);
      } catch { /* tolerated: a bad line loses one row, not the shard */ }
    }
  }
  shardCacheByKey.set(key, rows);
  return rows;
}

/** One article by its normalised term: index hit -> the one shard the index
 *  names (cached) -> the row. Null on an index miss, so an unknown term never
 *  costs a shard read. Never throws. */
export function loadReferenceArticle(dir, term) {
  const index = loadReferenceIndex(dir);
  if (!index) return null;
  const entry = index[String(term ?? "")];
  if (!isReferenceIndexEntry(entry)) return null;
  const rows = loadShard(dir, entry.s);
  return rows?.get(entry.t) ?? null;
}

const fsProvider = {
  lookup: async (normTerm) => loadReferenceArticle(referencePackDir(), normTerm),
};

let registeredProvider = null;

/** Swap the pack lookup: provider = { lookup: async (normTerm) => row|null }.
 *  Pass null to restore the default fs loader. */
export function registerReferencePackProvider(provider) {
  registeredProvider = provider && typeof provider.lookup === "function" ? provider : null;
}

/** The active provider — the registered one, else the lazy fs loader. */
export function getReferencePackProvider() {
  return registeredProvider ?? fsProvider;
}
