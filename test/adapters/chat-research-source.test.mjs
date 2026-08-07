// createSession/runChat's `researchSource` option and the /wikipedia,
// /wikidata slash commands — the config-selected research provider wired
// into the CHAT surface (session-scoped, mutable, exactly the /narrate and
// /wiki pattern).
//
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-research-source-"));
}

test("createSession default (no researchSource, no tmct.toml): the session's research source is wikipedia", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.researchSource, "wikipedia");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession({ repoPath }): tmct.toml's [research] source alone (no option) selects the backend", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[research]\nsource = "wikidata"\n');
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.researchSource, "wikidata");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession precedence: the explicit researchSource option (bin/tmct.mjs's --research-source) beats tmct.toml", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[research]\nsource = "wikidata"\n');
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, researchSource: "wikipedia" });
    assert.equal(s.researchSource, "wikipedia", "the explicit option wins over tmct.toml's wikidata");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSession: an unrecognized [research] source falls back to wikipedia, never throws", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    await writeFile(join(dir, "tmct.toml"), '[research]\nsource = "bogus"\n');
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.researchSource, "wikipedia");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/wikidata flips the session's research source and returns the exact reply line; /wikipedia flips it back; the flip holds across the following turn", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    const toWikidata = await s.turn("/wikidata");
    assert.match(
      toWikidata.answer,
      /^research fetches go to Wikidata \(structured claims, CC0 1\.0\) for the rest of this session — \/wikipedia switches them back to Simple English Wikipedia\./,
    );
    assert.equal(s.researchSource, "wikidata");

    // The flip holds across a following, unrelated turn.
    await s.turn("/stats");
    assert.equal(s.researchSource, "wikidata");

    const toWikipedia = await s.turn("/wikipedia");
    assert.match(
      toWikipedia.answer,
      /^research fetches go to Simple English Wikipedia \(prose articles, CC BY-SA 4\.0\) for the rest of this session — \/wikidata switches them to Wikidata\./,
    );
    assert.equal(s.researchSource, "wikipedia");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/wikidata re-issued while already the active source gives the same line, idempotent", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    const first = await s.turn("/wikidata");
    const second = await s.turn("/wikidata");
    assert.equal(first.answer, second.answer);
    assert.equal(s.researchSource, "wikidata");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bare /wiki names the current research source and does not flip it", async () => {
  clearCache();
  const dir = await tmpRepo();
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    const wikipediaStatus = await s.turn("/wiki");
    assert.match(wikipediaStatus.answer, /Research fetches currently go to Simple English Wikipedia — \/wikipedia or \/wikidata switches them\./);
    assert.equal(s.researchSource, "wikipedia");

    await s.turn("/wikidata");
    const wikidataStatus = await s.turn("/wiki");
    assert.match(wikidataStatus.answer, /Research fetches currently go to Wikidata — \/wikipedia or \/wikidata switches them\./);
    assert.equal(s.researchSource, "wikidata", "a bare /wiki never flips the research source");
    await s.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
