// scripts/claims/fetch-commonsenseqa-sample.mjs — maintainer-run fetch that
// cuts test-benchmarks/claims/commonsenseqa-sample.jsonl from CommonsenseQA's
// dev split. Not wired into npm test and not run by CI; output is committed.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEFAULT_OUT = join(ROOT, "test-benchmarks", "claims", "commonsenseqa-sample.jsonl");

export const DEV_SPLIT_URL = "https://s3.amazonaws.com/commensenseqa/dev_rand_split.jsonl";
export const DEV_SPLIT_ROWS = 1221;
export const SAMPLE_SIZE = 100;
export const SAMPLE_STRIDE = 12;

const CHOICE_LABELS = ["A", "B", "C", "D", "E"];

/** Sorts rows by id ascending as strings, then keeps every SAMPLE_STRIDE-th
 *  row from index 0 until SAMPLE_SIZE rows are held. Pure: same input, same
 *  output, no clock and no randomness. */
export function selectSample(rows, { size = SAMPLE_SIZE, stride = SAMPLE_STRIDE } = {}) {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sample = [];
  for (let i = 0; i < sorted.length && sample.length < size; i += stride) {
    sample.push(sorted[i]);
  }
  return sample;
}

/** Throws when a row is not the five-choice A-to-E shape the rig assumes:
 *  five choices, labels exactly A B C D E in order, a non-empty stem, a
 *  non-empty question_concept, and an answerKey that names one of the five. */
export function assertFixtureRow(row) {
  const id = row?.id ?? "(missing id)";
  const q = row?.question;
  if (!q || typeof q !== "object") throw new Error(`row ${id}: missing "question" object`);
  if (!Array.isArray(q.choices) || q.choices.length !== 5) {
    throw new Error(`row ${id}: expected exactly 5 choices, got ${q.choices?.length ?? "none"}`);
  }
  q.choices.forEach((choice, i) => {
    if (choice?.label !== CHOICE_LABELS[i]) {
      throw new Error(`row ${id}: choice ${i} labelled "${choice?.label}", expected "${CHOICE_LABELS[i]}"`);
    }
    if (!choice?.text || !String(choice.text).trim()) {
      throw new Error(`row ${id}: choice ${choice?.label} has empty text`);
    }
  });
  if (!q.stem || !String(q.stem).trim()) throw new Error(`row ${id}: empty stem`);
  if (!q.question_concept || !String(q.question_concept).trim()) {
    throw new Error(`row ${id}: empty question_concept`);
  }
  if (!CHOICE_LABELS.includes(row.answerKey)) {
    throw new Error(`row ${id}: answerKey "${row.answerKey}" does not name one of A-E`);
  }
}

function parseJsonl(body) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function loadRows({ from }) {
  if (from) {
    return parseJsonl(await readFile(from, "utf8"));
  }
  const response = await fetch(DEV_SPLIT_URL);
  if (!response.ok) {
    throw new Error(`fetch ${DEV_SPLIT_URL} failed: ${response.status} ${response.statusText}`);
  }
  return parseJsonl(await response.text());
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, from: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--from") args.from = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadRows(args);
  if (rows.length !== DEV_SPLIT_ROWS) {
    throw new Error(`expected ${DEV_SPLIT_ROWS} dev-split rows, got ${rows.length} — the upstream split has drifted`);
  }
  const sample = selectSample(rows);
  sample.forEach(assertFixtureRow);
  const body = `${sample.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await writeFile(args.out, body);
  console.log(`wrote ${sample.length} rows to ${args.out}`);
}

// Guarded so importing this module for its pure helpers (selectSample,
// assertFixtureRow — the fixture estate test does exactly that) never
// triggers a live network fetch; only running the file directly does.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
