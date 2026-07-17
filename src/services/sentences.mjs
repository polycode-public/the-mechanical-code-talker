// sentences.mjs — sentence-boundary splitting, shared by the extract-facts
// script, the chat one-shot CLI, and runTurn's multi-sentence pre-split.

import { winkInstance } from "../adapters/wink-model.mjs";

/** Split text into trimmed, non-empty sentences via wink-nlp's own
 *  sentence-boundary detection — never a naive regex split, matching the
 *  ONE way every other adapter in this repo reaches wink (wink-model.mjs).
 *  Returns [] (never throws) when wink isn't available or the text is
 *  blank — the same honest-degrade idiom every wink-model.mjs consumer
 *  already uses. */
export function splitSentences(text) {
  const nlp = winkInstance();
  if (!nlp) return [];
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const doc = nlp.readDoc(raw);
  return doc.sentences().out().map((s) => s.trim()).filter(Boolean);
}

/** Does this line actually carry a sentence boundary — a terminator, then
 *  whitespace, then the next sentence's first word? wink's own splitter breaks
 *  "src/core/store.mjs" into "src/core/store." + "mjs …", so a line naming a
 *  file splits into sentences that were never there. Requiring the whitespace
 *  keeps a dotted identifier whole, and nothing that holds no boundary is ever
 *  handed to the splitter's judgement. */
export const carriesASentenceBoundary = (line) => /[.!?]\s+\w/.test(String(line));

/** Split multi-line text into sentences the way splitSentences does, but never
 *  let wink shatter a line that has no real sentence boundary. A bare dotted
 *  module path (`src/core/store.mjs`) would otherwise come back as
 *  ["src/core/store.", "mjs"]. Each line is only handed to wink when it carries
 *  a real boundary; otherwise the trimmed line stands as one sentence. */
export function splitSentencesPreservingPaths(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (carriesASentenceBoundary(line)) {
      out.push(...splitSentences(line));
    } else {
      const trimmed = line.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}
