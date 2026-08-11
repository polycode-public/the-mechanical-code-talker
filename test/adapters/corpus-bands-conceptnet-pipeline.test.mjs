// build-conceptnet-full.mjs over a miniature raw-dump fixture — no network,
// no real ConceptNet dump.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildConceptnetFullRows, conceptnetFullNotice, CONCEPTNET_FULL_BAND } from "../../scripts/corpus-bands/build-conceptnet-full.mjs";
import { writeRowsStreaming } from "../../scripts/corpus-bands/stream-band-rows.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "corpus-bands", "conceptnet-sample.tsv");

test("admits every en→en canonical-relation edge with no seed restriction", async () => {
  const { rows, scanned } = await buildConceptnetFullRows(FIXTURE);
  assert.equal(scanned, 8);
  const subjects = rows.map((row) => row.term).sort();
  assert.deepEqual(subjects, ["dog", "dog", "dog", "happy", "wheel"].sort());
  for (const row of rows) assert.equal(rowProblems(row).length, 0, rowProblems(row).join("; "));
});

test("a non-English edge and a policy-filtered relation never reach a row", async () => {
  const { rows } = await buildConceptnetFullRows(FIXTURE);
  const triples = rows.map((row) => {
    const attr = (key) => JSON.parse(row.json).individual.attributes.find((a) => a.key === key).value;
    return `${attr("subject")} ${attr("predicate")} ${attr("object")}`;
  });
  assert.ok(!triples.some((t) => t.includes("chien")), "the French edge was excluded");
  assert.ok(!triples.some((t) => t.includes("dogge")), "the etymology relation was excluded");
});

test("a duplicate triple at two weights collapses to one row, the higher weight's surface text", async () => {
  const { rows } = await buildConceptnetFullRows(FIXTURE);
  const dogMammal = rows.filter((row) => {
    const attr = (key) => JSON.parse(row.json).individual.attributes.find((a) => a.key === key).value;
    return attr("subject") === "dog" && attr("object") === "mammal";
  });
  assert.equal(dogMammal.length, 1);
});

test("a sense-tagged English endpoint (dog/n) is admitted, sense tag stripped", async () => {
  const { rows } = await buildConceptnetFullRows(FIXTURE);
  const objects = rows.map((row) => JSON.parse(row.json).individual.attributes.find((a) => a.key === "object").value);
  assert.ok(objects.includes("canine"));
});

test("two runs over the same fixture produce byte-identical rows", async () => {
  const [first, second] = await Promise.all([buildConceptnetFullRows(FIXTURE), buildConceptnetFullRows(FIXTURE)]);
  assert.deepEqual(first.rows, second.rows);
});

test("rows land already stamped with this band's provenance", async () => {
  const { rows } = await buildConceptnetFullRows(FIXTURE);
  for (const row of rows) {
    const provenance = JSON.parse(row.json).individual.attributes.find((a) => a.key === "provenance").value;
    assert.match(provenance, new RegExp(`^corpus(-weak)?:${CONCEPTNET_FULL_BAND}`));
  }
});

test("the emitted NOTICE names CC-BY-SA-4.0, share-alike, and the row count", () => {
  const notice = conceptnetFullNotice({ rowCount: 5, outPath: "conceptnet-full.band.jsonl" });
  assert.match(notice, /CC-BY-SA 4\.0|CC BY-SA 4\.0/);
  assert.match(notice, /Share-alike/);
  assert.match(notice, /5 rows/);
});

test("the CLI writes both the jsonl and its NOTICE beside it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-conceptnet-pipeline-"));
  const outPath = join(dir, "out.jsonl");
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "corpus-bands", "build-conceptnet-full.mjs");
    await promisify(execFile)(process.execPath, [script, "--source", FIXTURE, "--out", outPath]);
    const jsonl = await readFile(outPath, "utf8");
    assert.ok(jsonl.trim().split("\n").length >= 4);
    const notice = await readFile(`${outPath}.NOTICE`, "utf8");
    assert.match(notice, /CC-BY-SA 4\.0|CC BY-SA 4\.0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the streamed write produces the same bytes and digest as joining every row into one string", async () => {
  const { rows } = await buildConceptnetFullRows(FIXTURE);
  const joined = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const dir = await mkdtemp(join(tmpdir(), "tmct-conceptnet-stream-"));
  const outPath = join(dir, "out.jsonl");
  try {
    const { bytes, digest } = await writeRowsStreaming(outPath, rows);
    assert.equal(bytes, joined.length);
    assert.equal(digest, createHash("sha256").update(joined).digest("hex"));
    assert.equal(await readFile(outPath, "utf8"), joined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
