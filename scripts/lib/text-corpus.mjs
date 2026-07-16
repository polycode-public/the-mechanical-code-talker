// scripts/lib/text-corpus.mjs — shared, maintainer-only corpus loading for
// the coverage harness (scripts/template-coverage.mjs) and the generator
// (scripts/generate-template-variants.mjs). Not part of the product path —
// never imported by src/ or bin/, never run by `npm test`.
//
// Corpus choice: corpus/prose/, an EXTERNAL, FROZEN corpus of public-domain
// SQLite documentation and CC-BY-SA-4.0 Wikipedia text, fetched by
// scripts/fetch-prose-corpus.mjs and committed with a per-file sha256.
//
// It used to be this repo's own root *.md docs, and the reason that had to go
// is the reason this file exists: the corpus moved every time anyone edited a
// doc. A sentence written into a plan that morning would appear in the next
// day's committed corpus/generated/ace-surface-variants.jsonl, and
// template-coverage's hit rate could not be compared between two versions
// because the thing being measured shifted underneath the measurement. Frozen
// text with a recorded URL and checksum holds still.
//
// The splitter is deliberately plain: strip fenced code blocks (the thing most
// likely to look like a "sentence" but isn't), strip markdown structural noise
// (headers, tables, bare list markers), then split on sentence-ending
// punctuation. Not an NLP sentence segmenter — a simple regex/period-based one.
// It still runs the markdown strip over corpus/prose/'s plain text, which is a
// no-op on prose that has no markdown in it and cheap insurance against any
// that sneaks through.

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

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

/** Every *.txt under `dir`, recursively, as paths relative to `dir` with "/"
 *  separators, sorted — one deterministic order on every platform. */
export async function proseCorpusFiles(dir) {
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(path)));
      else if (entry.name.endsWith(".txt")) found.push(relative(dir, path).split(sep).join("/"));
    }
    return found;
  };
  return (await walk(dir)).sort();
}

/** Load the frozen prose corpus under `proseDir` (corpus/prose/) and return
 *  `[{sentence, file}]` across every *.txt in it, in file-then-position order
 *  (deterministic — the same tree always yields the same array). `file` is the
 *  corpus-relative path, e.g. "wikipedia/Penguin.txt". */
export async function loadProseCorpus(proseDir, { files } = {}) {
  const names = files || (await proseCorpusFiles(proseDir));
  const out = [];
  for (const name of names) {
    const text = await readFile(join(proseDir, name), "utf8");
    for (const sentence of splitProseSentences(text)) out.push({ sentence, file: name });
  }
  return out;
}
