// ledger-viz-cli.test.mjs — bin/tmct.mjs's `viz --ledger` flag surface,
// spawned as a real child process (the test/viz-cli.test.mjs pattern). The
// data/render contracts live in test/ledger-viz.test.mjs; this file owns only
// the CLI seam.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFact } from "../src/memory/core.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const runCli = (dir, cwd, ...args) =>
  spawnSync(process.execPath, [BIN, "viz", "--repo", dir, "--ledger", ...args], { encoding: "utf8", cwd });

async function seededRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ledger-cli-"));
  const TS = "2026-07-15T09:00:00.000Z";
  await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA", createdAt: TS });
  await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA", createdAt: TS });
  await appendFact(dir, { subject: "cat", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA", createdAt: TS });
  await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat", createdAt: TS });
  return dir;
}

function embeddedJson(html, name) {
  const m = new RegExp(`const ${name} = (.*);`).exec(html);
  assert.ok(m, `const ${name} = ...; not found in the rendered page`);
  return JSON.parse(m[1]);
}

test("tmct viz --ledger writes ledger.html in the cwd by default", async () => {
  const dir = await seededRepo();
  try {
    const res = runCli(dir, dir);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /tmct viz --ledger — wrote \d+ fact row\(s\)/);
    await access(join(dir, "ledger.html"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz --ledger --output overrides the destination; --focus threads through", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "custom.html");
    const res = runCli(dir, dir, "--output", out, "--focus", "dog");
    assert.equal(res.status, 0, res.stderr);
    const html = await readFile(out, "utf8");
    const ledger = embeddedJson(html, "LEDGER");
    assert.equal(ledger.focus, "dog");
    assert.match(res.stdout, /around 'dog'/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz --ledger --term resolves via normFactTerm (capitalized input)", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "term.html");
    const res = runCli(dir, dir, "--output", out, "--term", "Cat");
    assert.equal(res.status, 0, res.stderr);
    const ledger = embeddedJson(await readFile(out, "utf8"), "LEDGER");
    assert.equal(ledger.focus, "cat");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmct viz --ledger --limit caps the embedded rows and prints the truncation warning", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "capped.html");
    const res = runCli(dir, dir, "--output", out, "--limit", "2");
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /showing 2 of \d+ rows — narrow with --focus <term> or raise --limit/);
    const ledger = embeddedJson(await readFile(out, "utf8"), "LEDGER");
    assert.equal(ledger.rows.length, 2);
    assert.equal(ledger.meta.truncated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the generated page inlines the checked-in memory-ask bundle and renders the enabled chat dock", async () => {
  const dir = await seededRepo();
  try {
    const out = join(dir, "chat.html");
    const res = runCli(dir, dir, "--output", out);
    assert.equal(res.status, 0, res.stderr);
    const html = await readFile(out, "utf8");
    assert.match(html, /tmctMemoryAsk/, "the memory-ask bundle is inlined");
    assert.match(html, /id="chatform"/, "the dock form renders");
    assert.doesNotMatch(html, /chat unavailable/, "the disabled note is absent when the bundle is present");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
