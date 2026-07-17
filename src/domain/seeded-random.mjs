// seeded-random.mjs — the single home for tmct's seedable, platform-stable
// pseudo-randomness: a mulberry32 generator and a Fisher-Yates shuffle driven by
// it. Both are pure arithmetic (no I/O, no imports), so a seed reproduces the
// same sequence on every machine and every run.
//
// The bench case generators (infbench, chatbench's graded pool) draw their
// committed fixtures through these, so the byte sequence they produce is part of
// those artifacts' identity: two callers on one seed must shuffle identically or
// the committed cases.jsonl / graded pool drift. That is the same reason the
// content-address hashes live once in hash.mjs beside this file — a deterministic
// primitive shared across writers has exactly one definition.

/** mulberry32 PRNG — small, seedable, deterministic across platforms. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, driven by the supplied rng. */
export function seededShuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
