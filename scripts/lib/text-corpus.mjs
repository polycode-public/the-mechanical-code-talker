// scripts/lib/text-corpus.mjs — shared, maintainer-only corpus loading for
// PLAN_TEMPLATE_COVERAGE.md's §6 harness (scripts/template-coverage.mjs) and
// generator (scripts/generate-template-variants.mjs). Not part of the product
// path — never imported by src/ or bin/, never run by `npm test`.
//
// Corpus choice: this repo's own committed *.md docs — real, human-written
// prose about a real codebase, already committed, MPL-2.0 licensed (this
// project's own license — zero licensing question), and simpler to extract
// than SemCor's YAML-wrapped running text (PLAN_TEMPLATE_COVERAGE.md records
// the comparison that led here). A deliberately plain splitter: strip fenced
// code blocks (the thing most likely to look like a "sentence" but isn't),
// strip markdown structural noise (headers, tables, bare list markers), then
// split on sentence-ending punctuation. Not an NLP sentence segmenter — a
// simple regex/period-based one, exactly as the plan calls for.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Strip ``` fenced code blocks (any language tag) from markdown text. */
function stripFencedCode(text) {
  return text.replace(/```[\s\S]*?```/g, "\n");
}

/** Strip a few markdown structural line-shapes that would otherwise read as
 *  sentence fragments: ATX headers, table rows/separators, horizontal rules,
 *  blockquote/list markers (kept content, dropped marker), inline code spans
 *  (kept content, dropped backticks) and link markup (kept link text). */
function stripMarkdownNoise(text) {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^#{1,6}\s/.test(t)) return false; // header line — usually a fragment, not a sentence
      if (/^\|.*\|$/.test(t)) return false; // table row
      if (/^[-*_]{3,}$/.test(t)) return false; // horizontal rule
      if (/^[-*+]\s*$/.test(t)) return false; // empty bullet
      return true;
    })
    .map((line) =>
      line
        .replace(/^\s*>+\s?/, "") // blockquote marker
        .replace(/^\s*[-*+]\s+/, "") // bullet marker
        .replace(/^\s*\d+\.\s+/, "") // numbered-list marker
        .replace(/`([^`]*)`/g, "$1") // inline code span -> bare text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
        .replace(/\*\*([^*]*)\*\*/g, "$1") // **bold** -> text
        .replace(/\*([^*]*)\*/g, "$1"), // *italic* -> text
    )
    .join("\n");
}

/** Plain period/question/exclamation-mark sentence splitter over already-
 *  cleaned prose. Splits on a run of .?! followed by whitespace (or end of
 *  string), keeping the terminator off the returned sentence. Deliberately
 *  ignorant of abbreviations ("e.g.", "Node.js") — a few over-splits are
 *  expected and acceptable for a coverage measurement (parseAce would reject
 *  the resulting fragments as misses either way, which is the honest outcome
 *  for a genuinely ambiguous split). */
export function splitProseSentences(text) {
  const cleaned = stripMarkdownNoise(stripFencedCode(text)).replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.?!])\s+(?=[A-Z(])/)
    .map((s) => s.trim().replace(/[.?!]+$/, "").trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 3); // drop stray fragments
}

/** Load every root-level *.md file in `repoDir` (default: this repo) and
 *  return `[{sentence, file}]` across all of them, in file-then-position
 *  order (deterministic — same input tree always yields the same array). */
export async function loadMarkdownCorpus(repoDir, { files } = {}) {
  const names = files || (await readdir(repoDir)).filter((f) => f.endsWith(".md")).sort();
  const out = [];
  for (const name of names) {
    const text = await readFile(join(repoDir, name), "utf8");
    for (const sentence of splitProseSentences(text)) out.push({ sentence, file: name });
  }
  return out;
}
