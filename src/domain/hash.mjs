// hash.mjs — the single home for tmct's content-address contract: the hashes,
// the fact-term/predicate normalization, and the fact-id derivation.
//
// A fact's id is its identity across the whole memory graph, so its hash must be
// synchronous, browser-safe, dependency-free, CROSS-VERSION STABLE, and wide
// enough that two different facts do not land on one id. factIdFor derives the id
// from a 64-bit truncation of SHA-256 (sha256Bytes below) for the width; 32-bit
// FNV-1a is far too narrow for a graph of tens of thousands of facts. FNV-1a stays
// home-grown for the narrower content addresses that do not need that width (the
// paraphrase and answer-variant pools, per-URL web-Source ids, corpus dedupe).
// Every library candidate fails at least one of the stability constraints; these
// hand-rolled functions fail none. Normalization lives beside them because it is
// PART of that identity: the same (s, p, o) must normalize and hash to the same id
// from every writer, so the whole contract has exactly one definition.

/** FNV-1a 32-bit. Returns the unsigned 32-bit integer (0 … 2^32−1). */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a 32-bit as a zero-padded 8-char hex string — the stable content-address
 *  for the narrow, non-fact-id pools (paraphrase, per-URL web Source, corpus
 *  dedupe). Fact ids use factIdFor's wider SHA-256 truncation, not this. */
export function fnv1aHex(str) {
  return fnv1a32(str).toString(16).padStart(8, "0");
}

// SHA-256 (FIPS 180-4), home-grown for the same reasons FNV-1a is: it must be
// synchronous, browser-safe, dependency-free, and cross-version stable —
// answer-variant selection is keyed on digest bytes, so the digest is part of
// the answer-text contract. Pinned byte-identical to node:crypto by
// test/adapters/hash-digest.test.mjs.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a string (UTF-8), as a 32-byte Uint8Array. */
export function sha256Bytes(str) {
  const data = new TextEncoder().encode(String(str));
  const bitLen = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) ov.setUint32(i * 4, h[i]);
  return out;
}

/** SHA-256 of a string truncated to `nBytes` leading bytes, as lowercase hex.
 *  A fact id takes 8 bytes (64 bits): at 100,000 facts the chance of any two
 *  colliding is ~2.7e-10, against ~100% for 32-bit FNV at the same size. */
function sha256Hex(str, nBytes) {
  const bytes = sha256Bytes(str);
  let hex = "";
  for (let i = 0; i < nBytes; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

const TEXT_CAP = 2000;   // an utterance's stored text (a whole answer fits; a pasted book doesn't)

/** Whitespace-collapse + cap a stored text/predicate string. Every writer that
 *  feeds the fact-id hash uses THIS normalization, so id identity never depends
 *  on which module did the writing. */
export const normText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);

/** Normalize a fact TERM (subject/object) so every writer converges on one
 *  spelling: ConceptNet's /c/en/foo_bar, tmct:Foo_bar, and bare "Foo bar" all
 *  become "foo bar". Also strips a leading "the"/"a"/"an" (idempotent — safe
 *  for storage too). The predicate is never normalized this way — its casing
 *  is meaningful controlled vocabulary. */
export function normFactTerm(t) {
  let s = normText(t);
  s = s.replace(/^\/c\/[a-z]{2,3}\//i, "");
  s = s.replace(/^[a-z][\w.-]*:/i, "");
  s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:the|an?)\s+/i, "");
  return s.toLowerCase();
}

/** The closed taught→corpus predicate table. The teach lane mints a predicate
 *  from the verb's LEMMA ("fire causes smoke" → mgx:cause), while the corpus
 *  vocabulary spells the same relation in its curated form (mgx:causes). Left
 *  apart, a taught fact and the corpus fact for the same triple are two facts
 *  with two ids, and neither reader finds the other's. Each row below folds a
 *  minted lemma onto the curated predicate that means the SAME thing in the
 *  SAME direction, so both spellings converge on one fact id.
 *
 *  Closed on purpose — a table, not an inflection rule. Entries are added when
 *  a curated predicate's surface phrase is a plain verb ("causes", "wants",
 *  "requires", "involves") whose lemma the teach lane would otherwise mint
 *  unrelated — or when the participle+preposition teach frame mints a
 *  hyphenated spelling of a curated relation with the SAME arguments in the
 *  SAME direction ("X is used for Y" → mgx:used-for, the curated mgx:usedFor).
 *  Relations that invert their arguments (mgx:ownedBy,
 *  mgx:createdBy) are absent: "X owns Y" and "X is owned by Y" are not the
 *  same fact, so folding them would store a lie. */
const CANONICAL_FACT_PREDICATE = new Map([
  ["mgx:cause", "mgx:causes"],
  ["mgx:desire", "mgx:desires"],
  ["mgx:want", "mgx:desires"],
  ["mgx:require", "mgx:hasPrerequisite"],
  ["mgx:involve", "mgx:hasSubevent"],
  ["mgx:used-for", "mgx:usedFor"],
  ["mgx:made-of", "mgx:madeOf"],
]);

/** Normalize a fact PREDICATE: whitespace-collapse + cap (normText's storage
 *  contract), then fold a minted lemma onto its curated corpus spelling. Casing
 *  is left alone — a predicate is controlled vocabulary, not a term. */
export function normFactPredicate(p) {
  const t = normText(p);
  return CANONICAL_FACT_PREDICATE.get(t) ?? t;
}

/** A Fact is content-addressed by its NUL-delimited (s, p, o) — NUL never
 *  occurs in a normalized term/predicate, so the delimiter never collides
 *  unlike a space. The hash is a 64-bit SHA-256 truncation (16 hex chars),
 *  wide enough that distinct triples do not share an id at real corpus sizes.
 *  Takes ALREADY-normalized parts; factIdForTriple normalizes first. */
export const factIdFor = (s, p, o) => `fact:${sha256Hex(`${s}\0${p}\0${o}`, 8)}`;

/** The pre-widening 32-bit fact id (FNV-1a, 8 hex). A store written before
 *  factIdFor widened keys its Facts and their statedBy/derivedFrom edges by
 *  this; adapters/memory/core.mjs recognises the old shape and migrates each
 *  Fact onto its current factIdFor id on load. */
export const legacyFactIdFor = (s, p, o) => `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;

/** Content-address a fact's id from (subject, predicate, object) without
 *  writing it — same contract as factIdFor. Lets a caller (e.g.
 *  syllogise.mjs's retraction machinery) name a not-yet-written fact's id
 *  deterministically, without an extra read. Pure, no I/O. */
export function factIdForTriple(subject, predicate, object) {
  return factIdFor(normFactTerm(subject), normFactPredicate(predicate), normFactTerm(object));
}
