#!/usr/bin/env node
// Print the capability-by-lane coverage matrix from the corpus files: one row
// per key group (the first two dot-segments of each row's `key`), one column
// per lane, each cell the number of rows. Gaps show up as empty cells.
//
// --gaps prints the hole-hunting view instead: thin key groups (one row
// total), and key groups with no negative row (no key segment naming a miss/
// guard/negation), so a capability whose happy path is pinned but whose
// decline is not stands out. Both are heuristics — a listed group is a
// review candidate, not automatically a hole.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GAPS_VIEW = process.argv.includes("--gaps");

const CORPUS_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "test", "corpus");

// Sharded lane families live one directory down (e.g. games/openers.jsonl).
const lanes = fs
  .readdirSync(CORPUS_DIR, { withFileTypes: true, recursive: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
  .map((entry) => path.relative(CORPUS_DIR, path.join(entry.parentPath, entry.name)).slice(0, -".jsonl".length))
  .sort();

if (lanes.length === 0) {
  console.log("no corpus lanes yet (no test/corpus/*.jsonl files)");
  process.exit(0);
}

const counts = new Map(); // keyGroup -> Map<lane, rowCount>
const fullKeys = new Map(); // keyGroup -> Set<full key>
for (const lane of lanes) {
  const text = fs.readFileSync(path.join(CORPUS_DIR, `${lane}.jsonl`), "utf8");
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      console.error(`${lane}.jsonl line ${i + 1}: ${e.message}`);
      process.exit(2);
    }
    const key = String(row.key ?? "(no key)");
    const group = key.split(".").slice(0, 2).join(".");
    if (!counts.has(group)) counts.set(group, new Map());
    const perLane = counts.get(group);
    perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
    if (!fullKeys.has(group)) fullKeys.set(group, new Set());
    fullKeys.get(group).add(key);
  }
}

if (GAPS_VIEW) {
  const NEGATIVE_RE = /(honest-miss|miss|guard|negation|negative|never|decline|refus|unsolvable|unknown|hedge|no-antecedent|untouched|empty)/;
  // Lane families that pin per-capability behaviour; bench-smoke rows assert a
  // rig runs, so "no negative row" is not a gap there.
  const behaviourGroups = [...counts.keys()].filter((g) => !g.startsWith("bench.")).sort();

  const rowTotal = (g) => [...counts.get(g).values()].reduce((a, b) => a + b, 0);
  const thin = behaviourGroups.filter((g) => rowTotal(g) === 1);
  console.log("thin key groups (a single row pins the whole capability):");
  for (const g of thin) {
    console.log(`  ${g}  (in ${[...counts.get(g).keys()][0]})`);
  }

  const noNegative = behaviourGroups.filter((g) => ![...fullKeys.get(g)].some((k) => NEGATIVE_RE.test(k)));
  console.log("\nkey groups with no negative row (no miss/guard/negation key):");
  for (const g of noNegative) {
    const laneList = [...counts.get(g).keys()].join(", ");
    console.log(`  ${g}  (${laneList})`);
  }
  process.exit(0);
}

const groups = [...counts.keys()].sort();
const header = ["key", ...lanes];
const rows = groups.map((group) => [
  group,
  ...lanes.map((lane) => {
    const n = counts.get(group).get(lane);
    return n ? String(n) : "";
  }),
]);

const widths = header.map((h, col) => Math.max(h.length, ...rows.map((r) => r[col].length)));
const renderLine = (cells) => cells.map((c, col) => c.padEnd(widths[col])).join("  ").trimEnd();
console.log(renderLine(header));
console.log(renderLine(widths.map((w) => "-".repeat(w))));
for (const row of rows) console.log(renderLine(row));
