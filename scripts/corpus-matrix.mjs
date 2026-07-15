#!/usr/bin/env node
// Print the capability-by-lane coverage matrix from the corpus files: one row
// per key group (the first two dot-segments of each row's `key`), one column
// per lane, each cell the number of rows. Gaps show up as empty cells.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORPUS_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "test", "corpus");

const lanes = fs
  .readdirSync(CORPUS_DIR)
  .filter((name) => name.endsWith(".jsonl"))
  .map((name) => name.slice(0, -".jsonl".length))
  .sort();

if (lanes.length === 0) {
  console.log("no corpus lanes yet (no test/corpus/*.jsonl files)");
  process.exit(0);
}

const counts = new Map(); // keyGroup -> Map<lane, rowCount>
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
    const group = String(row.key ?? "(no key)").split(".").slice(0, 2).join(".");
    if (!counts.has(group)) counts.set(group, new Map());
    const perLane = counts.get(group);
    perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
  }
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
