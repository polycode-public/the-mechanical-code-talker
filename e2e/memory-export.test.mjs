// `tmct memory --export <file.jsonl>` dumps every stored fact in the extract
// shape, then exits — the audit/backup leg that closes the gap where the sqlite
// store had no way out. Driven as a real child process so the whole flag path,
// the written file and the exit code are what an operator sees. Round-trips
// against `tmct import --file`: a dump re-imports fact-for-fact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const env = { ...process.env, TMCT_NO_SEED: "1" };
const runCli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd, env });
const parseLines = (jsonl) => jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("memory --export writes every stored fact as JSONL in the extract shape and exits 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-export-"));
  try {
    assert.equal(runCli(dir, "init").status, 0);
    await writeFile(join(dir, "seed.jsonl"),
      '{"subject":"zorble","predicate":"rdfs:subClassOf","object":"animal","provenance":"teach:chat:origin"}\n'
      + '{"subject":"quibbit","predicate":"rdf:type","object":"zorble","provenance":"corpus:demo"}\n');
    assert.equal(runCli(dir, "import", "--file", "seed.jsonl").status, 0);

    const exp = runCli(dir, "memory", "--export", "dump.jsonl");
    assert.equal(exp.status, 0, exp.stderr);
    assert.match(exp.stderr, /wrote 2 facts to dump\.jsonl/);

    const records = parseLines(await readFile(join(dir, "dump.jsonl"), "utf8"));
    assert.equal(records.length, 2);
    const zorble = records.find((r) => r.subject === "zorble");
    assert.deepEqual(zorble, { subject: "zorble", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:origin" });
    assert.ok(records.every((r) => typeof r.provenance === "string" && r.provenance.length > 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an export round-trips through import --file: dump one repo, load it into a fresh repo, the facts land with their provenance", async () => {
  const source = await mkdtemp(join(tmpdir(), "tmct-export-src-"));
  const target = await mkdtemp(join(tmpdir(), "tmct-export-dst-"));
  try {
    assert.equal(runCli(source, "init").status, 0);
    await writeFile(join(source, "seed.jsonl"),
      '{"subject":"zorble","predicate":"rdfs:subClassOf","object":"animal","provenance":"teach:chat:origin"}\n');
    assert.equal(runCli(source, "import", "--file", "seed.jsonl").status, 0);
    assert.equal(runCli(source, "memory", "--export", "dump.jsonl").status, 0);

    const dump = await readFile(join(source, "dump.jsonl"), "utf8");
    assert.equal(runCli(target, "init").status, 0);
    await writeFile(join(target, "roundtrip.jsonl"), dump);
    const imp = runCli(target, "import", "--file", "roundtrip.jsonl");
    assert.equal(imp.status, 0, imp.stdout + imp.stderr);
    assert.match(imp.stdout, /imported — zorble rdfs:subClassOf animal/);

    const dumpBack = runCli(target, "memory", "--export", "again.jsonl");
    assert.equal(dumpBack.status, 0, dumpBack.stderr);
    const back = parseLines(await readFile(join(target, "again.jsonl"), "utf8"));
    const zorble = back.find((r) => r.subject === "zorble");
    assert.deepEqual(zorble, { subject: "zorble", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:origin" });
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
