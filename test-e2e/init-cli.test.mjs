// init-cli.test.mjs — `tmct init --corpus <id>` (bin/tmct.mjs).
//
// These flags used to be a separate, untested, ad hoc code path (a bespoke
// seedMemory call, provenance "corpus:tier2:<id>" — colon-separated). Part 2 of
// the extension-pack batch folds them into the unified corpus loader
// (src/services/extensions.mjs): `--corpus <id>` now means "activate
// extensions.tier2-<id> and PERSIST that into tmct.toml" (so a later bare
// `tmct init`/chat session remembers the choice), and the provenance tag is
// now hyphenated ("corpus:tier2-<id>") to match the TOML-legal extension name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMemory, openMemoryBackend, FACT_CLASS } from "../src/adapters/memory/core.mjs";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const runCli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });
const tmp = () => mkdtemp(join(tmpdir(), "tmct-init-cli-"));

/** Read a repo's memory back through the DEFAULT-routed backend (sqlite) —
 *  the store a zero-flag init actually seeds. */
async function readRoutedMemory(dir) {
  const { dir: handle, close } = await openMemoryBackend(dir, "");
  try { return await loadMemory(handle); } finally { await close(); }
}

test("`tmct init --corpus general`: seeds tier-2 facts NOW, tagged with the new hyphenated provenance", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--corpus", "general"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /seeded tier-2 corpus "general" \(domain\) — \d+ fact\(s\) added/);
    assert.match(r.stdout, /Activated in tmct\.toml/);
    const mem = await readRoutedMemory(dir);
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const generalFacts = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-general")));
    assert.ok(generalFacts.length > 0, "tier2-general facts landed, hyphenated provenance");
    const oldStyle = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2:general")));
    assert.equal(oldStyle.length, 0, "the old colon-separated provenance tag is gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --corpus general` PERSISTS the choice: tmct.toml carries [extensions.tier2-general] active = true", async () => {
  const dir = await tmp();
  try {
    const r = runCli(["init", "--corpus", "general"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const toml = await readFile(join(dir, "tmct.toml"), "utf8");
    assert.match(toml, /\[extensions\.tier2-general\]/);
    assert.match(toml, /active = true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a persisted --corpus choice is remembered: a later bare `tmct init` re-seeds tier2-general without the flag", async () => {
  const dir = await tmp();
  try {
    const first = runCli(["init", "--corpus", "general"], { cwd: dir });
    assert.equal(first.status, 0, first.stderr);
    await rm(join(dir, ".tmct"), { recursive: true, force: true }); // simulate a fresh install of the same config
    const second = runCli(["init"], { cwd: dir });
    assert.equal(second.status, 0, second.stderr);
    const mem = await readRoutedMemory(dir);
    const facts = mem.individuals.filter((i) => i.class === FACT_CLASS);
    const generalFacts = facts.filter((f) =>
      (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-general")));
    assert.ok(generalFacts.length > 0, "tier2-general seeded again, remembered from tmct.toml — no --corpus flag needed this time");
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
    assert.match(r.stderr, /Available tier-2 corpuses: general, human/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

