// digest-cli.test.mjs — bin/tmct.mjs's `digest` mode: the vocabulary-side
// digest of one term, spawned as a real child process against a memory-seeded
// repo. The pure pipeline and the wiring seam are covered elsewhere
// (test/domain/digest-*.test.mjs, test/adapters/digest-bank.test.mjs); this
// file owns only the CLI seam — term matching, the narrative, its sources, and
// the honest miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, openMemoryBackend } from "../src/adapters/memory/core.mjs";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const runDigest = (dir, ...args) =>
  spawnSync(process.execPath, [BIN, "digest", ...args, "--repo", dir], { encoding: "utf8" });

async function seededRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-digest-cli-"));
  const TS = "2026-07-15T09:00:00.000Z";
  const backend = await openMemoryBackend(dir, "");
  try {
    // A term with facts across the digest's isa/location/capableOf families.
    await appendFact(backend.dir, { subject: "doctor", predicate: "rdfs:subClassOf", object: "person", provenance: "corpus:human /r/IsA", createdAt: TS });
    await appendFact(backend.dir, { subject: "doctor", predicate: "mgx:atLocation", object: "hospital", provenance: "corpus:human /r/AtLocation", createdAt: TS });
    await appendFact(backend.dir, { subject: "doctor", predicate: "mgx:capableOf", object: "treat patients", provenance: "corpus:human /r/CapableOf", createdAt: TS });
  } finally {
    await backend.close();
  }
  return dir;
}

test("tmct digest <term> leads with a bounded narrative, then its sources and a fact count", async () => {
  const dir = await seededRepo();
  try {
    const res = runDigest(dir, "doctor");
    assert.equal(res.status ?? 0, 0, res.stderr);
    assert.match(res.stdout, /A doctor is a person/);
    assert.match(res.stdout, /found in hospital/);
    assert.match(res.stdout, /can treat patients/);
    assert.match(res.stdout, /Sources: /);
    assert.match(res.stdout, /3 fact\(s\) stored/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct digest folds a plural query to the stored singular subject", async () => {
  const dir = await seededRepo();
  try {
    const res = runDigest(dir, "doctors");
    assert.equal(res.status ?? 0, 0, res.stderr);
    assert.match(res.stdout, /A doctor is a person/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct digest misses honestly on a term the store never saw", async () => {
  const dir = await seededRepo();
  try {
    const res = runDigest(dir, "wombat");
    assert.equal(res.status ?? 0, 0, res.stderr);
    assert.match(res.stdout, /don't have anything stored about "wombat"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct digest with no term names the shape it wants and exits non-zero", () => {
  const res = spawnSync(process.execPath, [BIN, "digest"], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /name a term/);
});
