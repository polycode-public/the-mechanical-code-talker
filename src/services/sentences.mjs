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

/** Bracketed reference residue an encyclopedia paragraph leaves in prose:
 *  numeric footnote markers ([3], [12]), single-letter notes ([a]), and the
 *  named ones ([note 4], [citation needed], [source?], [page 2]). Removed
 *  case-insensitively so the sentence downstream reads as plain text, with the
 *  gap tidied so "period.[3] Sales" becomes "period. Sales", not
 *  "period.  Sales". A file path never carries a bracket, so a dotted module
 *  identifier ("src/core/store.mjs") is left whole — only bracketed spans are
 *  touched. Deliberately NOT wired into the shared splitter; a caller that
 *  wants clean prose applies it before or after splitting. */
export function stripCitationResidue(text) {
  return String(text ?? "")
    .replace(/\[\s*\d+\s*\]/g, "")
    .replace(/\[\s*[a-z]\s*\]/gi, "")
    .replace(/\[\s*(?:note|citation|ref|source|page|pp?)\b[^\]]*\]/gi, "")
    .replace(/ +([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}
