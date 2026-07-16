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
