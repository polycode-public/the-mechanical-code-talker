// The reference pack's two halves: the pure contract (shard naming, row/index
// shapes, the cited answer, the provenance tag, the pure clean-miss gate) and
// the lazy fs loader with its provider seam. Driven by the hand-written
// mini-pack in test/fixtures/reference-pack/, which mirrors the real pack's
// layout exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_PACK_NAME, REFERENCE_SHARD_COUNT, shardNameFor,
  isReferenceIndexEntry, isReferenceArticleRow,
  renderReferenceAnswer, referenceProvenanceTag, cleanMissReferenceTerm,
} from "../../src/domain/reference-pack.mjs";
import { fnv1aHex } from "../../src/domain/hash.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
import {
  referencePackDir, loadReferenceIndex, loadReferenceArticle,
  registerReferencePackProvider, getReferencePackProvider, clearReferencePackCache,
} from "../../src/adapters/corpus/reference-pack.mjs";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference-pack");

const row = (term, revid = 1000 + term.length) => ({
  term, title: term[0].toUpperCase() + term.slice(1),
  text: `A ${term} is a thing. It has several sentences of text.`,
  summary: `A ${term} is a thing.`,
  url: `https://simple.wikipedia.org/wiki/${term}`,
  revid,
});

async function writePack(dir, rows, { indexOverride } = {}) {
  await mkdir(join(dir, "shards"), { recursive: true });
  const byShard = new Map();
  const index = {};
  for (const r of rows) {
    const s = shardNameFor(r.term);
    if (!byShard.has(s)) byShard.set(s, []);
    byShard.get(s).push(r);
    index[r.term] = { s, t: r.term, r: r.revid };
  }
  for (const [s, shardRows] of byShard) {
    await writeFile(join(dir, "shards", `${s}.jsonl.gz`), gzipSync(shardRows.map((r) => JSON.stringify(r)).join("\n")));
  }
  await writeFile(join(dir, "index.json.gz"), gzipSync(JSON.stringify(indexOverride ?? index)));
}

// ---- the pure contract ------------------------------------------------------

test("shardNameFor is the FNV-1a first byte mod 64, spelled ref-00 … ref-3f", () => {
  for (const term of ["otter", "harbor", "a", "polar bear", ""]) {
    const expected = parseInt(fnv1aHex(term).slice(0, 2), 16) % REFERENCE_SHARD_COUNT;
    assert.equal(shardNameFor(term), `ref-${expected.toString(16).padStart(2, "0")}`);
  }
  assert.match(shardNameFor("anything"), /^ref-[0-3][0-9a-f]$/);
  assert.equal(shardNameFor("otter"), shardNameFor("otter"), "deterministic");
});

test("index-entry and article-row validators accept the shipped shapes and reject near-misses", () => {
  assert.ok(isReferenceIndexEntry({ s: "ref-2a", t: "otter", r: 9184482 }));
  assert.ok(!isReferenceIndexEntry({ s: "ref-4a", t: "otter", r: 1 }), "shard out of range");
  assert.ok(!isReferenceIndexEntry({ s: "ref-2a", t: "", r: 1 }));
  assert.ok(!isReferenceIndexEntry({ s: "ref-2a", t: "otter", r: 0 }));
  assert.ok(!isReferenceIndexEntry(null));
  const good = row("otter");
  assert.ok(isReferenceArticleRow(good));
  assert.ok(isReferenceArticleRow({ ...good, isa: "animal" }));
  assert.ok(!isReferenceArticleRow({ ...good, summary: "" }));
  assert.ok(!isReferenceArticleRow({ ...good, revid: "9184482" }), "revid must be an integer");
  assert.ok(!isReferenceArticleRow({ ...good, isa: "" }), "an isa field, when present, must name a term");
  assert.ok(isReferenceArticleRow({ ...good, source: "a demo corpus", licence: "none" }), "source/licence are accepted per-entry overrides");
  assert.ok(!isReferenceArticleRow({ ...good, source: "" }), "a source field, when present, must name one");
  assert.ok(!isReferenceArticleRow({ ...good, licence: "" }), "a licence field, when present, must name one");
});

test("renderReferenceAnswer cites title, licence and the revision-pinned URL in one line, then names the grain", () => {
  const article = row("otter", 9184482);
  assert.equal(
    renderReferenceAnswer("otter", article),
    'otter — A otter is a thing. (source: reference article "Otter", Simple English Wikipedia, '
      + "CC BY-SA 4.0 — https://simple.wikipedia.org/wiki/otter?oldid=9184482)"
      + " General vocabulary, not from this codebase.",
  );
});

test("renderReferenceAnswer cites a synthetic entry's OWN source/licence/URL, never the Wikipedia default", () => {
  const article = {
    ...row("trelvox", 1),
    url: "https://example.test/trelvox",
    source: "a coined demo term, not from Wikipedia",
    licence: "none — not third-party content",
  };
  assert.equal(
    renderReferenceAnswer("trelvox", article),
    'trelvox — A trelvox is a thing. (source: reference article "Trelvox", '
      + "a coined demo term, not from Wikipedia, none — not third-party content — https://example.test/trelvox)"
      + " General vocabulary, not from this codebase.",
  );
  // No Wikipedia revision-pinning on a non-Wikipedia URL: the bare url stands,
  // not "https://example.test/trelvox?oldid=1".
  assert.ok(!renderReferenceAnswer("trelvox", article).includes("?oldid="));
});

test("referenceProvenanceTag emits the tag trust.mjs parses back to the same pack and article", () => {
  const tag = referenceProvenanceTag({ title: "Otter", revid: 9184482 });
  assert.equal(tag, "reference:simplewiki:Otter@9184482");
  assert.deepEqual(provenanceTagToSource(tag), { kind: "reference", pack: REFERENCE_PACK_NAME, article: "Otter@9184482" });
});

test("cleanMissReferenceTerm keys a lexicon noun on its lemma and refuses everything else", () => {
  assert.equal(cleanMissReferenceTerm("otter"), "otter");
  assert.equal(cleanMissReferenceTerm("Otters"), "otter", "plural folds to the lemma");
  assert.equal(cleanMissReferenceTerm("the otter"), "otter", "a leading article is normalised away");
  assert.equal(cleanMissReferenceTerm("imports"), null, "a vague relation touch is never a pack lookup");
  assert.equal(cleanMissReferenceTerm("heron"), null, "an unknown word is not a clean miss");
  assert.equal(cleanMissReferenceTerm(""), null);
  assert.equal(cleanMissReferenceTerm("42 otters"), null, "non-word shapes are refused");
});

// ---- the fs loader over the committed mini-pack -----------------------------

test("the fixture pack loads: a known term returns its full article row", () => {
  clearReferencePackCache();
  const otter = loadReferenceArticle(FIXTURE_DIR, "otter");
  assert.ok(isReferenceArticleRow(otter));
  assert.equal(otter.title, "Otter");
  assert.equal(otter.isa, "animal");
  const falcon = loadReferenceArticle(FIXTURE_DIR, "falcon");
  assert.equal(falcon.title, "Falcon");
  assert.equal(falcon.isa, undefined);
});

test("an alias index entry resolves to its target's row", () => {
  clearReferencePackCache();
  const viaAlias = loadReferenceArticle(FIXTURE_DIR, "harbour");
  const direct = loadReferenceArticle(FIXTURE_DIR, "harbor");
  assert.ok(isReferenceArticleRow(viaAlias));
  assert.deepEqual(viaAlias, direct);
});

test("an unindexed term returns null even when a shard holds a row for it — the index is the only door", () => {
  clearReferencePackCache();
  // the fixture plants a heron row in its shard but not in the index; a loader
  // that consulted shards without an index hit would wrongly serve it
  assert.equal(loadReferenceArticle(FIXTURE_DIR, "heron"), null);
});

test("an absent pack dir reads as null, never a throw", () => {
  clearReferencePackCache();
  const nowhere = join(tmpdir(), "tmct-no-such-pack-dir");
  assert.equal(loadReferenceIndex(nowhere), null);
  assert.equal(loadReferenceArticle(nowhere, "otter"), null);
});

test("a corrupt shard reads as null, never a throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-refpack-corrupt-"));
  try {
    const s = shardNameFor("otter");
    await mkdir(join(dir, "shards"), { recursive: true });
    await writeFile(join(dir, "index.json.gz"), gzipSync(JSON.stringify({ otter: { s, t: "otter", r: 9184482 } })));
    await writeFile(join(dir, "shards", `${s}.jsonl.gz`), Buffer.from("this is not gzip"));
    clearReferencePackCache();
    assert.equal(loadReferenceArticle(dir, "otter"), null);
  } finally {
    clearReferencePackCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("index and shards are cached per dir: a disk mutation is invisible until the cache is cleared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-refpack-cache-"));
  try {
    await writePack(dir, [row("otter", 111)]);
    clearReferencePackCache();
    assert.equal(loadReferenceArticle(dir, "otter").revid, 111);
    await writePack(dir, [row("otter", 222)]);
    assert.equal(loadReferenceArticle(dir, "otter").revid, 111, "served from cache, no re-read");
    clearReferencePackCache();
    assert.equal(loadReferenceArticle(dir, "otter").revid, 222);
  } finally {
    clearReferencePackCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the provider seam ------------------------------------------------------

test("the default provider is the fs loader over referencePackDir (TMCT_REFERENCE_PACK_DIR wins)", async () => {
  assert.equal(referencePackDir({ TMCT_REFERENCE_PACK_DIR: "/somewhere/else" }), "/somewhere/else");
  const prior = process.env.TMCT_REFERENCE_PACK_DIR;
  process.env.TMCT_REFERENCE_PACK_DIR = FIXTURE_DIR;
  try {
    clearReferencePackCache();
    const hit = await getReferencePackProvider().lookup("otter");
    assert.equal(hit?.title, "Otter");
    assert.equal(await getReferencePackProvider().lookup("heron"), null);
  } finally {
    if (prior === undefined) delete process.env.TMCT_REFERENCE_PACK_DIR;
    else process.env.TMCT_REFERENCE_PACK_DIR = prior;
    clearReferencePackCache();
  }
});

test("a registered provider replaces the fs loader; null restores it", async () => {
  const canned = { term: "otter", title: "Injected", text: "t", summary: "s", url: "u", revid: 1 };
  try {
    registerReferencePackProvider({ lookup: async (t) => (t === "otter" ? canned : null) });
    assert.equal((await getReferencePackProvider().lookup("otter")).title, "Injected");
    assert.equal(await getReferencePackProvider().lookup("falcon"), null);
  } finally {
    registerReferencePackProvider(null);
  }
  assert.equal(typeof getReferencePackProvider().lookup, "function", "the default seam is back");
});

// ---- fixture integrity ------------------------------------------------------

test("the committed fixture pack matches its own manifest byte-for-byte", async () => {
  const manifest = JSON.parse(await readFile(join(FIXTURE_DIR, "manifest.json"), "utf8"));
  assert.ok(manifest.files.length >= 7, "index + shards + notice");
  for (const entry of manifest.files) {
    const body = await readFile(join(FIXTURE_DIR, entry.file));
    assert.equal(body.length, entry.bytes, `${entry.file}: byte count drifted`);
    assert.equal(createHash("sha256").update(body).digest("hex"), entry.sha256, `${entry.file}: sha256 drifted`);
  }
});

test("isaOf: an of-chain reads through classifier heads only — a partitive container yields no isa", async () => {
  const { isaOf } = await import("../../src/domain/reference-pack.mjs");
  const { loadLexicon } = await import("../../src/domain/grammar/lexicon.mjs");
  const lex = loadLexicon();
  assert.equal(isaOf("A glacier is a large body of ice and snow.", lex), null);
  assert.equal(isaOf("A lake is a large body of water.", lex), null);
  assert.equal(isaOf("A poodle is a kind of dog.", lex), "dog");
  assert.equal(isaOf("Chess is a game of skill.", lex), "game");
});

test("isaOf: a mid-sentence parenthetical aside is skipped, and an of-chain reads through a quantifier to the real classifier chain", async () => {
  const { isaOf } = await import("../../src/domain/reference-pack.mjs");
  const { loadLexicon } = await import("../../src/domain/grammar/lexicon.mjs");
  const lex = loadLexicon();
  assert.equal(
    isaOf("Chinchillas are either of two species (Chinchilla chinchilla and Chinchilla lanigera) of rodents.", lex),
    "rodent",
  );
});

test("isaOf: the copula is reachable anywhere in a long first sentence, not just its first 80 characters", async () => {
  const { isaOf } = await import("../../src/domain/reference-pack.mjs");
  const { loadLexicon } = await import("../../src/domain/grammar/lexicon.mjs");
  const lex = loadLexicon();
  assert.equal(
    isaOf("Pumas (Puma concolor), also called cougars, mountain lions, catamounts, or brown panthers, are large wild cats.", lex),
    "cat",
  );
});

test("isaOf: a parenthetical aside with no copula in the sentence stays null", async () => {
  const { isaOf } = await import("../../src/domain/reference-pack.mjs");
  const { loadLexicon } = await import("../../src/domain/grammar/lexicon.mjs");
  const lex = loadLexicon();
  assert.equal(isaOf("Rome (also known as the Eternal City) has many famous monuments.", lex), null);
});

test("isaOf: an opening with no is-a statement at all stays null", async () => {
  const { isaOf } = await import("../../src/domain/reference-pack.mjs");
  const { loadLexicon } = await import("../../src/domain/grammar/lexicon.mjs");
  const lex = loadLexicon();
  assert.equal(isaOf("Paris has many famous museums.", lex), null);
});
