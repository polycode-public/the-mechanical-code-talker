#!/usr/bin/env node
// fetch-slice.mjs — regenerate corpus/conceptnet/slice.jsonl from the public
// ConceptNet API (https://api.conceptnet.io). NOT part of the product path —
// a maintainer tool, run by hand, results committed.
//
//   node corpus/conceptnet/fetch-slice.mjs [outFile]
//
// Polite client: strictly sequential, ~1.1s between requests (the public API
// asks for roughly 1 req/s sustained), exponential backoff on 429/5xx. A full
// run over the ~80 seed terms takes a few minutes.
//
// Filter rules (also documented in README.md here):
//   - /query?node=/c/en/<term>&other=/c/en — both endpoints English;
//   - keep only edges whose rel is one of the 34 canonical relations
//     (src/adapters/corpus/conceptnet-map.toml is the same closed set);
//   - drop en→en edges whose start/end still carry a sense suffix mismatch
//     (we keep the bare /c/en/<term> and /c/en/<term>/<pos> forms, normalized
//     to the bare term URI);
//   - dedupe by (start, rel, end), keeping the higher weight;
//   - one JSON object per line: {start, rel, end, surfaceText?, weight},
//     sorted by rel then start then end (deterministic diffs).
//
// Output is CC-BY-SA 4.0 (ConceptNet-derived) — see LICENSE-NOTICE.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const SEED_TERMS = [
  // core artifacts
  "software", "computer", "program", "code", "source_code", "module",
  "function", "subroutine", "algorithm", "data_structure", "database",
  "server", "network", "internet", "file", "directory", "memory",
  "application", "library", "framework", "api", "operating_system",
  "compiler", "interpreter", "script", "programming_language",
  // code constructs
  "variable", "array", "string", "integer", "boolean", "loop", "class",
  "object", "method", "parameter", "pointer", "stack", "queue", "cache",
  "thread", "process", "byte", "bit", "binary", "syntax", "logic",
  // the work
  "bug", "error", "test", "debug", "crash", "software_bug", "programmer",
  "computation", "data", "information", "password", "encryption",
  // version control
  "repository", "commit", "branch", "merge", "version",
  // hardware & devices
  "keyboard", "mouse", "screen", "monitor", "hardware", "cpu", "processor",
  "disk", "laptop", "smartphone", "robot", "circuit", "chip",
  // the wider net
  "email", "website", "browser", "cloud", "protocol", "http", "terminal",
  "shell", "command", "linux", "unix", "artificial_intelligence",
  "machine_learning", "virtual_machine",
];

export const CANONICAL_RELS = new Set([
  "/r/RelatedTo", "/r/FormOf", "/r/IsA", "/r/PartOf", "/r/HasA", "/r/UsedFor",
  "/r/CapableOf", "/r/AtLocation", "/r/Causes", "/r/HasSubevent",
  "/r/HasFirstSubevent", "/r/HasLastSubevent", "/r/HasPrerequisite",
  "/r/HasProperty", "/r/MotivatedByGoal", "/r/ObstructedBy", "/r/Desires",
  "/r/CreatedBy", "/r/Synonym", "/r/Antonym", "/r/DistinctFrom",
  "/r/DerivedFrom", "/r/SymbolOf", "/r/DefinedAs", "/r/MannerOf",
  "/r/LocatedNear", "/r/HasContext", "/r/SimilarTo",
  "/r/EtymologicallyRelatedTo", "/r/EtymologicallyDerivedFrom",
  "/r/CausesDesire", "/r/MadeOf", "/r/ReceivesAction", "/r/ExternalURL",
]);

// Relations excluded from the committed slice by policy (see README.md):
// pure-lexical/etymology noise and link-outs — they'd spend the size budget
// on rows toFacts() can never emit.
export const FILTERED_RELS = new Set([
  "/r/EtymologicallyRelatedTo", "/r/EtymologicallyDerivedFrom", "/r/ExternalURL",
]);

const API = "https://api.conceptnet.io";
const LIMIT = 100; // edges fetched per seed term
const PAUSE_MS = 1100; // polite: ~1 req/s sustained
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize a concept URI to its bare English term: /c/en/dog/n → /c/en/dog.
 *  Returns null for anything that is not an English concept. */
export const bareEnTerm = (uri) => {
  const m = /^\/c\/en\/([^/]+)/.exec(String(uri || ""));
  return m ? `/c/en/${m[1]}` : null;
};

/** Filter one raw API edge → a slice row, or null when it fails the rules. */
export function toRow(edge) {
  const rel = edge?.rel?.["@id"];
  if (!rel || !CANONICAL_RELS.has(rel) || FILTERED_RELS.has(rel)) return null;
  const start = bareEnTerm(edge?.start?.["@id"]);
  const end = bareEnTerm(edge?.end?.["@id"]);
  if (!start || !end || start === end) return null;
  const row = { start, rel, end, weight: Number(edge?.weight) || 1 };
  if (edge?.surfaceText) row.surfaceText = String(edge.surfaceText);
  return row;
}

async function fetchTerm(term, { fetchImpl = fetch, log = console.error } = {}) {
  const url = `${API}/query?node=/c/en/${term}&other=/c/en&limit=${LIMIT}`;
  for (let attempt = 1, wait = 5000; attempt <= 5; attempt += 1, wait *= 2) {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (res.ok) return (await res.json()).edges || [];
    log(`  ${term}: HTTP ${res.status}${attempt < 5 ? `, backing off ${wait / 1000}s` : " — giving up"}`);
    if (res.status !== 429 && res.status < 500) return [];
    if (attempt < 5) await sleep(wait);
  }
  throw new Error(`ConceptNet API unreachable while fetching "${term}"`);
}

export async function fetchSlice({ terms = SEED_TERMS, fetchImpl = fetch, log = console.error, pauseMs = PAUSE_MS } = {}) {
  const byKey = new Map(); // "start rel end" -> row (higher weight wins)
  for (const term of terms) {
    const edges = await fetchTerm(term, { fetchImpl, log });
    let kept = 0;
    for (const edge of edges) {
      const row = toRow(edge);
      if (!row) continue;
      const key = `${row.start} ${row.rel} ${row.end}`;
      const prev = byKey.get(key);
      if (!prev || row.weight > prev.weight) byKey.set(key, row);
      kept += 1;
    }
    log(`  ${term}: ${edges.length} edges, ${kept} kept`);
    await sleep(pauseMs);
  }
  return [...byKey.values()].sort((a, b) =>
    a.rel.localeCompare(b.rel) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const out = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "slice.jsonl");
  const rows = await fetchSlice({});
  const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(out, text);
  console.error(`wrote ${rows.length} assertions (${text.length} bytes) to ${out}`);
}
