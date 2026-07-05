#!/usr/bin/env node
// quality-filter.mjs — a SECOND-PASS noise filter over corpus/conceptnet/slice.jsonl.
// NOT part of the product path — a maintainer tool, run by hand, result committed.
//
// The committed slice is stream-filtered from the ConceptNet dump by
// filter-dump.mjs (tech-domain seed match + canonical relations + budget). That
// pass keeps the DATA honest but not the SEMANTICS: ConceptNet's crowd-sourced
// "Verbosity"/Open-Mind rows leave sentence-fragment "concepts" and opinion
// axioms in the slice that read as nonsense once they become memory facts —
// e.g. "a computer is a kind of dumb", "a class is a kind of elegance",
// "mouse AtLocation taloned_grip_of_owl", "2 is a kind of software".
//
// This pass removes exactly those, by term/relation shape only (never by hand
// per row), so it is reproducible:
//
//   node corpus/conceptnet/quality-filter.mjs < corpus/conceptnet/slice.jsonl > slice.clean.jsonl
//   # or in place (what produced the committed clean slice):
//   node corpus/conceptnet/quality-filter.mjs --in-place corpus/conceptnet/slice.jsonl
//
// Cut rules (a row is DROPPED when ANY applies):
//   1. numeric endpoint      — start/end bare term is all digits ("2", "1000")
//   2. single-char endpoint  — bare term length <= 1 ("a", "r", "m")
//   3. sentence fragment     — bare term is >= 4 underscore-words on EITHER
//                              endpoint ("taloned_grip_of_owl",
//                              "worlds_largest_interconnected_network_of_networks")
//   4. definitional phrase   — /r/DefinedAs whose object is >= 3 words
//                              (real DefinedAs is a synonym: cpu->processor)
//   5. opinion object        — /r/IsA or /r/DefinedAs whose object is one of a
//                              small, evidence-based OPINION set (adjectives /
//                              value words that never name a class)
//
// Rules 1-3 apply to every relation (they only ever remove junk); 4-5 are the
// definitional band the sims flagged. Stats land on stderr; JSONL on stdout.

import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const bareTerm = (uri) => String(uri || "").replace(/^\/c\/en\//, "");
const words = (t) => t.split("_").filter(Boolean).length;

// Evidence-based: the only 1-word IsA/DefinedAs objects in the committed slice
// that are opinions/adjectives rather than classes. Kept explicit (not a POS
// heuristic) so it never cuts a legitimate abstract class like "abstraction",
// "cognition" or "relation".
export const OPINION_OBJECTS = new Set([
  "elegance", "evil", "gloom", "unreality", "universalism", "dumb", "free", "junk",
]);

/** Why this row is noise, or null to keep it. Pure function of the row shape. */
export function cutReason(row) {
  const s = bareTerm(row.start);
  const e = bareTerm(row.end);
  for (const t of [s, e]) {
    if (/^\d+$/.test(t)) return "numeric-endpoint";
    if (t.length <= 1) return "single-char-endpoint";
    if (words(t) >= 4) return "sentence-fragment";
  }
  if (row.rel === "/r/DefinedAs" && words(e) >= 3) return "definitional-phrase";
  if ((row.rel === "/r/IsA" || row.rel === "/r/DefinedAs") && OPINION_OBJECTS.has(e)) return "opinion-object";
  return null;
}

async function readLines(stream) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const rows = [];
  for await (const raw of rl) {
    const line = raw.trim();
    if (line) rows.push(JSON.parse(line));
  }
  return rows;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const inPlace = process.argv.includes("--in-place");
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const rows = inPlace
    ? (await readFile(fileArg, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : await readLines(process.stdin);

  const byReason = new Map();
  const kept = [];
  for (const row of rows) {
    const reason = cutReason(row);
    if (reason) { byReason.set(reason, (byReason.get(reason) || 0) + 1); continue; }
    kept.push(row);
  }
  const text = kept.map((r) => JSON.stringify(r)).join("\n") + "\n";
  if (inPlace) await writeFile(fileArg, text);
  else process.stdout.write(text);

  const cut = rows.length - kept.length;
  console.error(`quality-filter: ${rows.length} rows in, ${kept.length} kept, ${cut} cut (${text.length} bytes out)`);
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.error(`  ${reason}: ${n}`);
}
