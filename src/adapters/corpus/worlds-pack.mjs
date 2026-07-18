// corpus/worlds-pack.mjs — lazy, failure-tolerated loader for the shipped
// worlds pack (corpus/worlds/): a gzipped world index consulted first, then
// exactly one gzipped JSONL shard per world. Nothing here ever throws at a
// caller — an absent, truncated or corrupt pack reads as null, and a null is
// the ordinary honest decline ("no worlds pack here").
//
// The provider seam mirrors reference-pack.mjs's exactly:
// registerWorldsPackProvider swaps the whole lookup behind one async
// `{ list(), load(worldName) }` contract. It exists because a browser surface
// cannot read this filesystem layout — a web provider can fetch worlds
// instead, and chat code never knows which one it is talking to. No provider
// registered = the fs loader below.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isWorldsIndexEntry, isWorldRow, isWorldFactRow, isWorldRuleRow, isWorldMetaRow } from "../../domain/worlds-pack.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The pack directory: TMCT_WORLDS_PACK_DIR when set, else the package's own
 *  corpus/worlds/. */
export function worldsPackDir(env = process.env) {
  return env?.TMCT_WORLDS_PACK_DIR || join(PKG_ROOT, "corpus", "worlds");
}

const indexCacheByDir = new Map();   // dir -> { worldName: {s} } | null
const worldCacheByKey = new Map();   // `${dir}\0${world}` -> payload | null

/** Drop every cached index/world — for tests that mutate a pack dir. */
export function clearWorldsPackCache() {
  indexCacheByDir.clear();
  worldCacheByKey.clear();
}

function readGunzipped(file) {
  try {
    return gunzipSync(readFileSync(file));
  } catch {
    return null;
  }
}

/** The pack's world index, lazily read and cached per dir; null (cached)
 *  when the pack is absent or unreadable. Never throws. */
export function loadWorldsIndex(dir) {
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

/** One world by name: index hit -> the one shard the index names (cached) ->
 *  { facts, rules, meta }. Null on an index miss or an unreadable shard, so
 *  an unknown world never costs a shard read. Never throws. */
export function loadWorld(dir, worldName) {
  const index = loadWorldsIndex(dir);
  if (!index) return null;
  const entry = index[String(worldName ?? "")];
  if (!isWorldsIndexEntry(entry)) return null;
  const key = `${dir}\0${worldName}`;
  if (worldCacheByKey.has(key)) return worldCacheByKey.get(key);
  let payload = null;
  const body = readGunzipped(join(dir, "shards", `${entry.s}.jsonl.gz`));
  if (body) {
    const facts = [];
    const rules = [];
    let meta = null;
    for (const line of body.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (!isWorldRow(row) || row.world !== worldName) continue;
        if (isWorldFactRow(row)) facts.push(row);
        else if (isWorldRuleRow(row)) rules.push(row);
        else if (isWorldMetaRow(row) && !meta) meta = row;
      } catch { /* tolerated: a bad line loses one row, not the world */ }
    }
    if (facts.length || rules.length || meta) payload = { name: worldName, facts, rules, meta };
  }
  worldCacheByKey.set(key, payload);
  return payload;
}

const fsProviderFor = (dirOf) => ({
  list: async () => {
    const index = loadWorldsIndex(dirOf());
    return index ? Object.keys(index).sort() : null;
  },
  load: async (worldName) => loadWorld(dirOf(), worldName),
});

const fsProvider = fsProviderFor(() => worldsPackDir());

let registeredProvider = null;

/** Swap the pack lookup: provider = { list: async () => string[]|null,
 *  load: async (worldName) => payload|null }. Pass null to restore the
 *  default fs loader. */
export function registerWorldsPackProvider(provider) {
  registeredProvider = provider
    && typeof provider.load === "function" && typeof provider.list === "function"
    ? provider : null;
}

/** The active provider — the registered one, else the lazy fs loader. An
 *  explicit `env` bag (a chat turn's own env, which may carry
 *  TMCT_WORLDS_PACK_DIR) makes the fs loader resolve the pack dir from that
 *  bag instead of process.env; with no argument the behavior is unchanged. */
export function getWorldsPackProvider(env) {
  if (registeredProvider) return registeredProvider;
  if (env === undefined) return fsProvider;
  return fsProviderFor(() => worldsPackDir(env));
}
