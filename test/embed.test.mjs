// embed.mjs tests — the deterministic static-embedding loader (PLAN_SEON_TUNING.md §7.6(5b)).
// CI/tests must pass WITHOUT the 30 MB potion-base-8M download, so these tests build a tiny
// synthetic model (hand-written safetensors bytes + a 6-token WordPiece tokenizer.json) in a
// temp dir and verify the whole pipeline numerically: safetensors parse, Bert-style
// normalize/pre-tokenize, greedy WordPiece with "##" continuations, [UNK] fallback, mean pool,
// L2 normalisation, determinism, and the absent-dir → null contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEmbedder, cosine, defaultEmbeddingsDir } from "../src/embed.mjs";

// ── synthetic model: 6 vocab rows × 4 dims ──────────────────────────────────────────────────────
// ids: [PAD]=0 [UNK]=1 hello=2 world=3 walk=4 ##ing=5 — rows are easy-to-check unit-ish vectors.
const DIM = 4;
const ROWS = [
  [0, 0, 0, 0],     // [PAD]
  [1, 1, 1, 1],     // [UNK]
  [2, 0, 0, 0],     // hello
  [0, 2, 0, 0],     // world
  [0, 0, 2, 0],     // walk
  [0, 0, 0, 2],     // ##ing
];

function writeSyntheticModel() {
  const dir = mkdtempSync(join(tmpdir(), "seonix-embed-test-"));
  const header = Buffer.from(JSON.stringify({
    embeddings: { dtype: "F32", shape: [ROWS.length, DIM], data_offsets: [0, ROWS.length * DIM * 4] },
  }), "utf8");
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(header.length));
  const data = Buffer.from(new Float32Array(ROWS.flat()).buffer);
  writeFileSync(join(dir, "model.safetensors"), Buffer.concat([lenBuf, header, data]));
  writeFileSync(join(dir, "tokenizer.json"), JSON.stringify({
    normalizer: { type: "BertNormalizer", clean_text: true, lowercase: true },
    pre_tokenizer: { type: "BertPreTokenizer" },
    model: {
      type: "WordPiece", unk_token: "[UNK]", continuing_subword_prefix: "##",
      max_input_chars_per_word: 100,
      vocab: { "[PAD]": 0, "[UNK]": 1, hello: 2, world: 3, walk: 4, "##ing": 5 },
    },
  }));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ model_type: "model2vec", normalize: true }));
  return dir;
}

const dir = writeSyntheticModel();
const embedder = loadEmbedder({ dir });

const l2 = (v) => Math.sqrt([...v].reduce((s, x) => s + x * x, 0));
const approx = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≉ ${b}`);

test("loadEmbedder: absent dir → null (silent no-op contract; CI never needs the 30 MB fetch)", () => {
  assert.equal(loadEmbedder({ dir: join(tmpdir(), "seonix-embed-definitely-absent") }), null);
});

test("loadEmbedder: parses the synthetic safetensors + tokenizer (dim from the tensor shape)", () => {
  assert.ok(embedder, "synthetic model loads");
  assert.equal(embedder.dim, DIM);
  assert.equal(embedder.dir, dir);
});

test("embed: mean pool + L2 normalise — 'hello world' is the normalised mean of its two rows", () => {
  const v = embedder.embed("hello world");
  // mean([2,0,0,0],[0,2,0,0]) = [1,1,0,0] → normalised [1/√2, 1/√2, 0, 0]
  approx(v[0], Math.SQRT1_2, "dim 0");
  approx(v[1], Math.SQRT1_2, "dim 1");
  approx(v[2], 0, "dim 2");
  approx(l2(v), 1, "unit norm");
});

test("embed: BertNormalizer lowercase + punctuation pre-tokenizer don't disturb known tokens", () => {
  // "Hello, WORLD!" → hello , world ! — the two punct chars miss the vocab and become [UNK]s,
  // but lowercasing must map Hello/WORLD onto their rows (ids 2 and 3).
  const v = embedder.embed("Hello, WORLD!");
  // mean over ids [2, UNK, 3, UNK] = ([2,0,0,0]+[1,1,1,1]+[0,2,0,0]+[1,1,1,1])/4 = [1, 1, .5, .5]
  const raw = [1, 1, 0.5, 0.5];
  const n = l2(raw);
  raw.forEach((x, i) => approx(v[i], x / n, `dim ${i}`));
});

test("embed: greedy WordPiece continuation — 'walking' = walk + ##ing", () => {
  const v = embedder.embed("walking");
  // mean([0,0,2,0],[0,0,0,2]) = [0,0,1,1] → normalised
  approx(v[0], 0, "dim 0");
  approx(v[2], Math.SQRT1_2, "dim 2");
  approx(v[3], Math.SQRT1_2, "dim 3");
});

test("embed: an unsegmentable word falls back to [UNK]; empty text is the zero vector", () => {
  const unk = embedder.embed("zzzqqq");
  approx(cosine(unk, embedder.embed("xxyyzz")), 1, "two unknown words share the [UNK] row exactly");
  const zero = embedder.embed("");
  assert.ok([...zero].every((x) => x === 0), "empty text → zero vector");
  assert.equal(cosine(zero, unk), 0, "cosine against the zero vector is 0, never NaN");
});

test("embed: deterministic — identical input, identical floats (the whole point of a static table)", () => {
  const a = embedder.embed("hello walking world");
  const b = embedder.embed("hello walking world");
  assert.deepEqual([...a], [...b]);
});

test("cosine: orthogonal rows are 0, identical rows are 1", () => {
  approx(cosine(embedder.embed("hello"), embedder.embed("world")), 0, "orthogonal");
  approx(cosine(embedder.embed("hello"), embedder.embed("hello")), 1, "identical");
});

test("defaultEmbeddingsDir: SEONIX_EMBED_DIR env override wins", () => {
  const prev = process.env.SEONIX_EMBED_DIR;
  try {
    process.env.SEONIX_EMBED_DIR = "/tmp/somewhere-else";
    assert.equal(defaultEmbeddingsDir(), "/tmp/somewhere-else");
  } finally {
    if (prev === undefined) delete process.env.SEONIX_EMBED_DIR;
    else process.env.SEONIX_EMBED_DIR = prev;
  }
  assert.match(defaultEmbeddingsDir(), /vendor[\\/]embeddings[\\/]potion-base-8M$/);
});
