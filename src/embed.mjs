// embed.mjs — deterministic static-embedding lookup (model2vec potion-base-8M).
// PLAN_SEON_TUNING.md §7.6(5b), 2026-07-02 library-leverage review.
//
// The honest "near-LLM" locate lever: a STATIC per-token embedding table (model2vec's
// potion-base-8M, MIT — 29,528 WordPiece subwords × 256 fp32 dims, ~30 MB) read straight
// from its safetensors export, mean-pooled and L2-normalised. No ONNX runtime, no model
// calls, no network after the one-time fetch — pure table lookup + float arithmetic, so
// the same text always embeds to the same vector ($0, deterministic, offline).
//
// Dependency choice (documented per the review): the safetensors format is an 8-byte LE
// header length + JSON header + raw little-endian tensor bytes, and the tokenizer is a
// plain Bert-style WordPiece (tokenizer.json: BertNormalizer lowercase + BertPreTokenizer
// + greedy longest-match with "##" continuations) — both are small enough to hand-roll
// with node built-ins, so neither the @yarflam/potion-base-8m fallback package nor an HF
// tokenizer dependency is taken. Numerical intent follows model2vec's own encode (subword
// ids WITHOUT the [CLS]/[SEP] template, mean pool, normalize per config.json) — exact
// float parity with the Python lib is not claimed; determinism and rank usefulness are.
//
// The weights are NEVER committed and NEVER in the npm package: they live in the
// gitignored vendor/ tree (fetched by scripts/fetch-embeddings.mjs, `npm run
// refs:embeddings`, SHA-256-pinned like the repo's other binary artefacts). Everything
// here degrades gracefully — loadEmbedder() returns null when the weights dir is absent,
// and callers (codegraph.mjs's opt-in embedRank, scripts/rank-gate.mjs) no-op with a
// clear note instead of failing, so CI/tests never require the 30 MB download.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_FILE = "model.safetensors";
const TOKENIZER_FILE = "tokenizer.json";
const CONFIG_FILE = "config.json";

/** Default artifact dir: $TMCT_EMBED_DIR, else <repo>/vendor/embeddings/potion-base-8M
 *  (gitignored via vendor/ — the location scripts/fetch-embeddings.mjs writes). */
export function defaultEmbeddingsDir() {
  if (process.env.TMCT_EMBED_DIR) return process.env.TMCT_EMBED_DIR;
  const here = dirname(fileURLToPath(import.meta.url)); // packages/tmct/src
  return join(here, "..", "..", "..", "vendor", "embeddings", "potion-base-8M");
}

// ---- safetensors (hand-rolled: u64le header length + JSON header + raw tensors) -------

/** Read the single 2-D F32 embedding tensor from a safetensors file →
 *  { matrix: Float32Array (row-major), rows, dim }. model2vec exports exactly one
 *  tensor named "embeddings"; any lone 2-D F32 tensor is accepted for test fixtures. */
function readSafetensors(file) {
  const buf = readFileSync(file);
  const headerLen = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString("utf8"));
  const name = header.embeddings
    ? "embeddings"
    : Object.keys(header).find((k) => k !== "__metadata__" && header[k]?.shape?.length === 2);
  const t = name && header[name];
  if (!t) throw new Error(`no 2-D tensor in ${file}`);
  if (t.dtype !== "F32") throw new Error(`unsupported dtype ${t.dtype} in ${file} (only F32)`);
  const [rows, dim] = t.shape;
  const [start, end] = t.data_offsets;
  const bytes = buf.subarray(8 + headerLen + start, 8 + headerLen + end);
  if (bytes.byteLength !== rows * dim * 4) throw new Error(`tensor size mismatch in ${file}`);
  // Copy into a fresh ArrayBuffer: the slice's byteOffset inside the file buffer is not
  // guaranteed 4-byte aligned, and Float32Array requires alignment.
  const matrix = new Float32Array(rows * dim);
  new Uint8Array(matrix.buffer).set(bytes);
  return { matrix, rows, dim };
}

// ---- Bert-style WordPiece tokenizer (from tokenizer.json) -----------------------------

const isPunct = (ch) => {
  const c = ch.codePointAt(0);
  // ASCII punctuation ranges (Bert treats these as standalone tokens) + general unicode P/S.
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126) ||
    /[\p{P}\p{S}]/u.test(ch);
};
const isCjk = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2ffff);
};

function makeTokenizer(spec) {
  if (spec?.model?.type !== "WordPiece") {
    throw new Error(`unsupported tokenizer model "${spec?.model?.type}" (only WordPiece)`);
  }
  const vocab = spec.model.vocab; // token -> id
  const contPrefix = spec.model.continuing_subword_prefix ?? "##";
  const maxChars = spec.model.max_input_chars_per_word ?? 100;
  const unkId = vocab[spec.model.unk_token] ?? null;
  const lowercase = spec.normalizer?.lowercase !== false;

  // BertNormalizer: clean control chars, pad CJK, lowercase (+ strip accents when lowercasing).
  const normalize = (text) => {
    let s = String(text).replace(/[\u0000\ufffd]/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
    s = [...s].map((ch) => (isCjk(ch) ? ` ${ch} ` : ch)).join("");
    if (lowercase) s = s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
    return s;
  };
  // BertPreTokenizer: split on whitespace; every punctuation char is its own word.
  const preTokenize = (s) => {
    const words = [];
    for (const chunk of s.split(/\s+/)) {
      if (!chunk) continue;
      let cur = "";
      for (const ch of chunk) {
        if (isPunct(ch)) {
          if (cur) { words.push(cur); cur = ""; }
          words.push(ch);
        } else cur += ch;
      }
      if (cur) words.push(cur);
    }
    return words;
  };
  // Greedy longest-match WordPiece per word; a word with no valid segmentation → [UNK].
  const wordPiece = (word) => {
    if (word.length > maxChars) return unkId == null ? [] : [unkId];
    const ids = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let id = null;
      while (end > start) {
        const piece = (start > 0 ? contPrefix : "") + word.slice(start, end);
        if (vocab[piece] !== undefined) { id = vocab[piece]; break; }
        end--;
      }
      if (id == null) return unkId == null ? [] : [unkId];
      ids.push(id);
      start = end;
    }
    return ids;
  };
  // No [CLS]/[SEP] template — model2vec pools content subwords only.
  return (text) => preTokenize(normalize(text)).flatMap(wordPiece);
}

// ---- embedder ---------------------------------------------------------------------------

const LOADED = new Map(); // dir -> embedder | null (per-process cache; weights load once)

/** Load tokenizer + embedding matrix from `dir` (default: defaultEmbeddingsDir()).
 *  Returns null — silently — when the artifacts are absent (the one-time
 *  `npm run refs:embeddings` fetch has not run): callers no-op, never fail.
 *  The returned embedder is { dim, dir, embed(text) → L2-normalised Float32Array }. */
export function loadEmbedder({ dir = defaultEmbeddingsDir() } = {}) {
  if (LOADED.has(dir)) return LOADED.get(dir);
  const modelFile = join(dir, MODEL_FILE);
  const tokFile = join(dir, TOKENIZER_FILE);
  if (!existsSync(modelFile) || !existsSync(tokFile)) {
    LOADED.set(dir, null);
    return null;
  }
  const { matrix, rows, dim } = readSafetensors(modelFile);
  const tokenize = makeTokenizer(JSON.parse(readFileSync(tokFile, "utf8")));
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(dir, CONFIG_FILE), "utf8")); } catch { /* optional */ }
  const doNormalize = cfg.normalize !== false;

  const embed = (text) => {
    const ids = tokenize(text);
    const v = new Float32Array(dim);
    if (!ids.length) return v; // zero vector: cosine 0 against everything
    for (const id of ids) {
      if (id < 0 || id >= rows) continue;
      const off = id * dim;
      for (let j = 0; j < dim; j++) v[j] += matrix[off + j];
    }
    for (let j = 0; j < dim; j++) v[j] /= ids.length; // mean pool
    if (doNormalize) {
      let norm = 0;
      for (let j = 0; j < dim; j++) norm += v[j] * v[j];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let j = 0; j < dim; j++) v[j] /= norm;
    }
    return v;
  };
  const embedder = { dim, dir, embed };
  LOADED.set(dir, embedder);
  return embedder;
}

/** Cosine similarity. Over L2-normalised vectors this is just the dot product, but the
 *  full form is kept so unnormalised test fixtures behave. 0 when either vector is zero. */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
