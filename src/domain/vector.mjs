// vector.mjs — pure vector arithmetic over embedding vectors. No model, no fs:
// the loader that reads weights off disk lives in src/adapters/embed.mjs.

/** Cosine similarity. Over L2-normalised vectors this is just the dot product, but the
 *  full form is kept so unnormalised test fixtures behave. 0 when either vector is zero. */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
