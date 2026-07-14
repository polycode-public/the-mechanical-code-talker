// hash.mjs — the single home for tmct's content-address hash.
//
// FNV-1a 32-bit is deliberately home-grown: it must be synchronous, browser-safe,
// dependency-free, and — critically — CROSS-VERSION STABLE, because fact ids are
// content-addressed by it and a fact's id is its identity across the whole memory
// graph. Every library candidate fails at least one of those; this eight-line
// function fails none. It lives here, once, so the fact-id contract has exactly
// one definition.

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
 *  used for fact ids (`fact:<hex>`). Same (s,p,o) → same id → upsert, never a dup. */
export function fnv1aHex(str) {
  return fnv1a32(str).toString(16).padStart(8, "0");
}
