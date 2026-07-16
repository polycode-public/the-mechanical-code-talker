// init-cli.test.mjs — `tmct init --corpus <id>` / `tmct init --detect` (bin/tmct.mjs).
//
// These flags used to be a separate, untested, ad hoc code path (a bespoke
// seedMemory call, provenance "corpus:tier2:<id>" — colon-separated). Part 2 of
// the extension-pack batch folds them into the unified corpus loader
// (src/extensions.mjs): `--corpus <id>` now means "activate
// extensions.tier2-<id> and PERSIST that into tmct.toml" (so a later bare
// `tmct init`/chat session remembers the choice), and the provenance tag is
// now hyphenated ("corpus:tier2-<id>") to match the TOML-legal extension name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const runCli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });
const tmp = () => mkdtemp(join(tmpdir(), "tmct-init-cli-"));

test("`tmct init --corpus aws`: seeds tier-2 facts NOW, tagged with the new hyphenated provenance", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--corpus", "aws"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /seeded tier-2 corpus "aws" \(domain\) — \d+ fact\(s\) added/);
    assert.match(r.stdout, /Activated in tmct\.toml/);
    const mem = await loadMemory(dir);
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const awsFacts = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-aws")));
    assert.ok(awsFacts.length > 0, "tier2-aws facts landed, hyphenated provenance");
    const oldStyle = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2:aws")));
    assert.equal(oldStyle.length, 0, "the old colon-separated provenance tag is gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --corpus aws` PERSISTS the choice: tmct.toml carries [extensions.tier2-aws] active = true", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--corpus", "aws"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.tier2-aws\]/);
    assert.match(toml, /active = true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a persisted --corpus choice is remembered: a later bare `tmct init` re-seeds tier2-aws without the flag", async () => {
  const dir = await tmp();
  try {
    const first = runCli(["init", "--corpus", "aws"], { cwd: dir });
    assert.equal(first.status, 0, first.stderr);
    await rm(join(dir, ".tmct"), { recursive: true, force: true }); // simulate a fresh install of the same config
    const second = runCli(["init"], { cwd: dir });
    assert.equal(second.status, 0, second.stderr);
    const mem = await loadMemory(dir);
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const awsFacts = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-aws")));
    assert.ok(awsFacts.length > 0, "tier2-aws seeded again, remembered from tmct.toml — no --corpus flag needed this time");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --corpus <unknown>`: a loud, specific error naming the available ids; exits non-zero; touches nothing on disk", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--corpus", "bogus"], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown --corpus "bogus"/);
    assert.match(r.stderr, /Available tier-2 corpuses: aws, python, java/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --detect`: suggests a tier-2 corpus from a manifest file, seeds NO tier-2 facts (only the tier-1 default)", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "pyproject.toml"), "[project]\n");
    const r = runCli(["init", "--detect"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /detected pyproject\.toml — run `tmct init --corpus python`/);
    // the plain `tmct init` this flag rides on top of always seeds the tier-1
    // default (seon + conceptnet) — --detect's own contract is narrower: it
    // never activates or seeds a TIER-2 bundle unasked.
    const mem = await loadMemory(dir);
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const tier2 = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2")));
    assert.equal(tier2.length, 0, "--detect never seeds a tier-2 bundle");
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.doesNotMatch(toml, /\[extensions\.tier2-/, "--detect never activates a tier-2 bundle in tmct.toml either");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --detect` with no matching manifest: an honest 'nothing detected' message", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--detect"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no tier-2 corpus auto-detected/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
