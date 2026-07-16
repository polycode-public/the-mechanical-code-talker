// examples.mjs — the two rules that decide whether a WordNet `example:` field
// can serve as a persona example sentence, and what its text actually is.
//
// Pure: values in, values out, no imports.

/** A handful of WordNet examples are cross-reference stubs ("see table 1"),
 *  not real sentences. Filtering them keeps a re-run reproducing the committed
 *  corpus/tier2/human-examples.jsonl exactly — this was the one candidate
 *  dropped by hand when that file was first curated. */
export const isRealSentence = (s) => !/^see\s+\w+\s*\d*\.?$/i.test(String(s).trim());

/** A WordNet `example:` is usually a plain string, but a few are an ATTRIBUTED
 *  LITERARY QUOTE — a `{source, text}` mapping, e.g. "ecstasy"'s example is
 *  `{source: "Charles Dickens", text: "listening to sweet music…"}`. That shape
 *  is real and was found live while extending coverage past Small tier's own
 *  665-word list; none of Small's words happened to hit it, so it went uncaught
 *  until Medium/Large's much wider coverage.
 *
 *  Returns the plain sentence text, or null for any other shape. The literary
 *  source is real but this corpus wants a plain example sentence, not a
 *  citation index. */
export function normalizeExample(example) {
  if (typeof example === "string") return example;
  if (example && typeof example === "object" && typeof example.text === "string") return example.text;
  return null;
}
