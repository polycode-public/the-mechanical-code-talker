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
//
// The fold, the heuristics and the renderer live in src/domain/corpus-matrix.mjs,
// where they are unit-tested. This script is the disk half: find the lanes, read
// the JSONL, print.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tallyRows, thinGroups, groupsWithNoNegativeRow, lanesOfGroup, matrixRows, renderTable,
} from "../src/domain/corpus-matrix.mjs";
import { corpusLanes } from "../src/adapters/corpus-lanes.mjs";

const CORPUS_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "test", "corpus");

/** Every row across every lane. A line that will not parse names itself and
 *  stops the run — a half-read corpus would report holes that are really typos. */
function readLaneRows(lanes) {
  const entries = [];
  for (const lane of lanes) {
    const text = fs.readFileSync(path.join(CORPUS_DIR, `${lane}.jsonl`), "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (line.trim() === "") continue;
      try {
        entries.push({ lane, row: JSON.parse(line) });
      } catch (e) {
        throw new Error(`${lane}.jsonl line ${i + 1}: ${e.message}`);
      }
    }
  }
  return entries;
}

function printGapsView(tally) {
  console.log("thin key groups (a single row pins the whole capability):");
  for (const group of thinGroups(tally)) {
    console.log(`  ${group}  (in ${lanesOfGroup(tally, group)[0]})`);
  }

  console.log("\nkey groups with no negative row (no miss/guard/negation key):");
  for (const group of groupsWithNoNegativeRow(tally)) {
    console.log(`  ${group}  (${lanesOfGroup(tally, group).join(", ")})`);
  }
}

function main() {
  const lanes = corpusLanes(CORPUS_DIR);
  if (lanes.length === 0) {
    console.log("no corpus lanes yet (no test/corpus/*.jsonl files)");
    return 0;
  }

  let tally;
  try {
    tally = tallyRows(readLaneRows(lanes));
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  if (process.argv.includes("--gaps")) printGapsView(tally);
  else console.log(renderTable(matrixRows(tally, lanes)));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
