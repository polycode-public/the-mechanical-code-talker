// commonsenseqa-fixture.test.mjs — the committed CommonsenseQA sample stays
// diffable against upstream (100 rows, unique ids, the fixed A-to-E shape)
// and selectSample's cut stays a pure function of its input: the same order
// out for the same rows in, whatever order they arrive in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectSample, assertFixtureRow, SAMPLE_SIZE } from "../../scripts/claims/fetch-commonsenseqa-sample.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "commonsenseqa-sample.jsonl");
const NOTICE_PATH = join(ROOT, "test-benchmarks", "claims", "commonsenseqa-sample.NOTICE");

async function loadFixtureRows() {
  const body = await readFile(FIXTURE_PATH, "utf8");
  return body.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

test("the fixture parses as JSONL and holds exactly 100 rows", async () => {
  const rows = await loadFixtureRows();
  assert.equal(rows.length, SAMPLE_SIZE);
});

test("every fixture row passes assertFixtureRow", async () => {
  const rows = await loadFixtureRows();
  for (const row of rows) assert.doesNotThrow(() => assertFixtureRow(row), `row ${row?.id} failed assertFixtureRow`);
});

test("fixture ids are unique", async () => {
  const rows = await loadFixtureRows();
  const ids = new Set(rows.map((row) => row.id));
  assert.equal(ids.size, rows.length);
});

function syntheticRows(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: i.toString(16).padStart(8, "0"),
      answerKey: "A",
      question: {
        question_concept: `concept-${i}`,
        choices: ["A", "B", "C", "D", "E"].map((label) => ({ label, text: `${label}-${i}` })),
        stem: `synthetic stem ${i}?`,
      },
    });
  }
  return rows;
}

test("selectSample returns the same ids in the same order on a repeat run", () => {
  const rows = syntheticRows(1221);
  const first = selectSample(rows).map((row) => row.id);
  const second = selectSample(rows).map((row) => row.id);
  assert.deepEqual(first, second);
});

test("selectSample returns the same ids in the same order when the input is shuffled first", () => {
  const rows = syntheticRows(1221);
  const ordered = selectSample(rows).map((row) => row.id);
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(((i * 2654435761) % (i + 1) + (i + 1)) % (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const fromShuffled = selectSample(shuffled).map((row) => row.id);
  assert.deepEqual(fromShuffled, ordered);
});

test("the NOTICE file exists and states both licences it carries", async () => {
  const body = await readFile(NOTICE_PATH, "utf8");
  assert.match(body, /\bMIT\b/);
  assert.match(body, /CC BY SA 4\.0/);
});
