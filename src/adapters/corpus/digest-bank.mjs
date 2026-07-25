// corpus/digest-bank.mjs — the filesystem side of the digest layer's stage-5
// wiring: read the committed sentence-structure bank and build the pre-parsed
// table the pure layer (src/domain/digest/) expects, then run one term end to
// end from a set of fact rows. The pure store scan and the pure pipeline live
// in src/domain/digest; only the TOML read lives here, so every node surface
// (chat, `tmct digest`, the page generators) shares one seam.
//
// build-chat-bundle.mjs swaps this module for a live in-memory twin (the
// chat dock DOES digest in-page there — chat-browser-entry.mjs feeds it the
// build-time-embedded [[structure]] rows via setDigestStructures); every
// other browser bundle (ask, ledger's static render) still stubs it out to
// null, so those consumers keep treating a null article as "fall back to the
// flat fact list". setDigestStructures below is a no-op on THIS, the real
// node-side module — kept only for interface parity with the live bundle
// twin, so a file that imports both under plain Node (as a chat-engine
// contract test does) resolves the same export set either way.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";
import { buildStructureTable, digestTerm } from "../../domain/digest/index.mjs";
import { digestStoreStats, chainsForObjects, isaObjectsOf } from "../../domain/digest/store-stats.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK_FILE = join(HERE, "..", "..", "..", "data", "templates", "constructions", "digest-sentence-structures.toml");

/** No-op here — the node-side adapter always reads its structures from the
 *  committed TOML bank (below), never from an externally-supplied table. Only
 *  the browser bundle's live twin (build-chat-bundle.mjs's stub) actually
 *  holds state behind this setter. */
export function setDigestStructures() {}

/** The raw [[structure]] rows parsed from the committed bank, once. A missing or
 *  unparseable bank yields an empty list — the digest degrades to the caller's
 *  flat fallback rather than throwing, the same posture the construction-bank
 *  loader takes. The raw rows (not the built table) are cached so a surface that
 *  needs to embed them for a browser render gets them without re-reading. */
let cachedStructures = null;
export function readDigestStructures() {
  if (cachedStructures) return cachedStructures;
  try {
    const parsed = parseToml(readFileSync(BANK_FILE, "utf8"));
    cachedStructures = Array.isArray(parsed.structure) ? parsed.structure : [];
  } catch {
    cachedStructures = [];
  }
  return cachedStructures;
}

let cachedTable = null;
/** The built structure table, once. Empty when the bank is unavailable. */
export function loadDigestStructureTable() {
  if (cachedTable) return cachedTable;
  cachedTable = buildStructureTable(readDigestStructures());
  return cachedTable;
}

/**
 * Digest one term end to end from fact rows. `termRows` are the rows whose
 * subject is the term; `allRows` is the whole store the statistics scan over
 * (pass the same array for both when the caller has already narrowed to one
 * term). Returns the term-article shape, or null when the structure bank is
 * unavailable (the browser-stub case) so the surface falls back to its flat
 * rendering. `opts.budget` picks the per-surface fact budget.
 */
export function digestTermFromRows(term, termRows, allRows, opts = {}) {
  const table = loadDigestStructureTable();
  if (!table || table.size === 0) return null;
  const rows = termRows || [];
  const store = digestStoreStats(allRows || rows);
  const chains = chainsForObjects(store.subClassEdges, isaObjectsOf(rows));
  return digestTerm(term, rows, store, table, { ...opts, chains });
}
