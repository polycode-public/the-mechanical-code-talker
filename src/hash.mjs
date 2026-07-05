// hash.mjs — the single home for tmct's content-address hash.
//
// FNV-1a 32-bit is deliberately home-grown (see archive/PLAN_DEPENDENCY_STRATEGY.md): it
// must be synchronous, browser-safe, dependency-free, and — critically —
// CROSS-VERSION STABLE, because fact ids are content-addressed by it and a fact's
// id is its identity across the whole memory graph. Every library candidate fails
// at least one of those; this eight-line function fails none. It lives here, once,
// so the fact-id contract has exactly one definition.
//
// Two historical copies are reconciled here without changing a single output byte:
//   - src/memory/core.mjs used the hex form for fact ids;
//   - chatbench/graded.mjs used the integer form as a PRNG seed, with a redundant
//     mid-loop `>>> 0`. That `>>> 0` was always a no-op: `^` and Math.imul both
//     apply ToInt32 to their operands, so the 32-bit pattern is invariant between
//     iterations whether the accumulator is stored signed or unsigned. The final
//     `h >>> 0` therefore yields the same value either way — proven, not assumed.

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
