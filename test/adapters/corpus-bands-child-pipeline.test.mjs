// build-child.mjs over a miniature pack written to a temp directory — the
// shipped pack's own on-disk shape (gzipped shards under shards/), a handful
// of rows of it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildChildRows, CHILD_BAND } from "../../scripts/corpus-bands/build-child.mjs";
import { shardNameFor } from "../../src/domain/child-pack.mjs";
import { normFactTerm } from "../../src/domain/hash.mjs";
import { rowProblems } from "../../src/adapters/memory/row-backend.mjs";

/** Write `rows` ({term, facts}) into a pack directory, each row in the shard
 *  the pack's own naming contract puts it in. */
async function writePack(rows) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-child-pipeline-"));
  await mkdir(join(dir, "shards"), { recursive: true });
  const byShard = new Map();
  for (const row of rows) {
    const shard = shardNameFor(row.term);
    if (!byShard.has(shard)) byShard.set(shard, []);
    byShard.get(shard).push({ ...row, term: normFactTerm(row.term) });
  }
  for (const [shard, shardRows] of byShard) {
    const body = shardRows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await writeFile(join(dir, "shards", `${shard}.jsonl.gz`), gzipSync(Buffer.from(body, "utf8")));
  }
  return dir;
}

const SAMPLE = [
  { term: "penguin", facts: [
    { subject: "penguin", predicate: "rdfs:subClassOf", object: "bird" },
    { subject: "penguin", predicate: "mgxneg:capableOf", object: "fly" },
  ] },
  { term: "bird", facts: [
    { subject: "bird", predicate: "mgx:capableOf", object: "fly" },
    { subject: "penguin", predicate: "rdfs:subClassOf", object: "bird" },
  ] },
];

test("every row over a sample pack is a valid, band-stamped wire row", async () => {
  const dir = await writePack(SAMPLE);
  try {
    const rows = buildChildRows(dir);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(rowProblems(row).length, 0, rowProblems(row).join("; "));
      assert.equal(row.rowClass, "fact");
      const provenance = JSON.parse(row.json).individual.attributes.find((a) => a.key === "provenance").value;
      assert.match(provenance, new RegExp(`^corpus:${CHILD_BAND} `));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an edge both of its terms' rows carry is written once", async () => {
  const dir = await writePack(SAMPLE);
  try {
    const rows = buildChildRows(dir);
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.rowKey)).size, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two runs over the same pack produce byte-identical rows", async () => {
  const dir = await writePack(SAMPLE);
  try {
    assert.deepEqual(buildChildRows(dir), buildChildRows(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rows are ordered by (predicate, subject, object), and ord matches that order", async () => {
  const dir = await writePack(SAMPLE);
  try {
    const rows = buildChildRows(dir);
    const triples = rows.map((row) => {
      const attr = (key) => JSON.parse(row.json).individual.attributes.find((a) => a.key === key).value;
      return [attr("predicate"), attr("subject"), attr("object")];
    });
    const sorted = [...triples].sort(([ap, as_, ao], [bp, bs, bo]) => (
      ap !== bp ? (ap < bp ? -1 : 1) : as_ !== bs ? (as_ < bs ? -1 : 1) : ao < bo ? -1 : ao > bo ? 1 : 0
    ));
    assert.deepEqual(triples, sorted);
    rows.forEach((row, i) => assert.equal(JSON.parse(row.json).ord, i));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the negative capability edge keeps its own predicate, so it can never read as the positive one", async () => {
  const dir = await writePack(SAMPLE);
  try {
    const predicates = buildChildRows(dir).map(
      (row) => JSON.parse(row.json).individual.attributes.find((a) => a.key === "predicate").value,
    );
    assert.ok(predicates.includes("mgxneg:capableOf"));
    assert.ok(predicates.includes("mgx:capableOf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a pack directory with no shards builds nothing rather than throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-child-empty-"));
  try {
    assert.deepEqual(buildChildRows(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
