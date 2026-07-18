// corpus/child-pack.mjs — lazy, failure-tolerated loader for the shipped CHILD
// triples pack (corpus/child/): a gzipped term index consulted first, then
// exactly one gzipped JSONL shard per hit. Nothing here ever throws at a
// caller — an absent, truncated or corrupt pack reads as null, and a null is
// the ordinary honest miss the clean-miss cascade already knows how to answer.
//
// Mirrors src/adapters/corpus/reference-pack.mjs exactly, including its provider
// seam: registerChildPackProvider swaps the whole lookup behind one async
// `{ lookup(normTerm) }` contract, so the browser demo (which cannot read this
// filesystem layout) can register a fetch-backed provider and the chat miss-
// cascade never knows which one it is talking to. No provider registered = the
// fs loader below.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isChildFactsRow, isChildIndexEntry } from "../../domain/child-pack.mjs";
import { normFactTerm } from "../../domain/hash.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The pack directory: TMCT_CHILD_PACK_DIR when set, else the package's own
 *  corpus/child/. */
export function childPackDir(env = process.env) {
  return env?.TMCT_CHILD_PACK_DIR || join(PKG_ROOT, "corpus", "child");
}

const indexCacheByDir = new Map();   // dir -> { term: {s, t, n} } | null
const shardCacheByKey = new Map();   // `${dir}\0${shard}` -> Map(term -> row) | null

/** Drop every cached index/shard — for tests that mutate a pack dir. */
export function clearChildPackCache() {
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
export function loadChildIndex(dir) {
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
        if (isChildFactsRow(row)) rows.set(row.term, row);
      } catch { /* tolerated: a bad line loses one row, not the shard */ }
    }
  }
  shardCacheByKey.set(key, rows);
  return rows;
}

/** One term's triples row by its (already-normalised) key: index hit -> the one
 *  shard the index names (cached) -> the row. The term is normFactTerm-folded
 *  here too, so a caller may pass a raw spelling. Null on an index miss, so an
 *  unknown term never costs a shard read. Never throws. */
export function loadChildFacts(dir, term) {
  const index = loadChildIndex(dir);
  if (!index) return null;
  const key = normFactTerm(term);
  const entry = index[key];
  if (!isChildIndexEntry(entry)) return null;
  const rows = loadShard(dir, entry.s);
  return rows?.get(entry.t) ?? null;
}

const fsProvider = {
  lookup: async (normTerm) => loadChildFacts(childPackDir(), normTerm),
};

let registeredProvider = null;

/** Swap the pack lookup: provider = { lookup: async (normTerm) => row|null }.
 *  Pass null to restore the default fs loader. */
export function registerChildPackProvider(provider) {
  registeredProvider = provider && typeof provider.lookup === "function" ? provider : null;
}

/** The active provider — the registered one, else the lazy fs loader. An
 *  explicit `env` bag (a chat turn's own env, which may carry
 *  TMCT_CHILD_PACK_DIR) makes the fs loader resolve the pack dir from that bag
 *  instead of process.env; with no argument the behavior is unchanged. */
export function getChildPackProvider(env) {
  if (registeredProvider) return registeredProvider;
  if (env === undefined) return fsProvider;
  return { lookup: async (normTerm) => loadChildFacts(childPackDir(env), normTerm) };
}
