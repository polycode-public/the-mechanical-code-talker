// parse.mjs — a targeted reader for SemCor's own regular YAML shape:
// flow-style lemmas/pos arrays and a folded single-quoted `text` scalar, one
// record per sentence. Not a general YAML parser (this repo has no YAML
// dependency), and not the same shape as the WordNet dump's reader in
// src/domain/wordnet/yaml.mjs — SemCor's flow style is JSON-compatible once
// isolated, which the WordNet subset never is.
//
// Pure: text in, arrays/strings out, no imports, so it runs with no SemCor
// clone present.

/** Split a SemCor YAML file into per-sentence record blocks (top-level
 *  "<key>:" lines, skipping the leading "_meta:" schema block). */
export function splitRecords(text) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length && lines[i] !== "_meta:") i++;
  i += 1;
  while (i < lines.length && (lines[i].startsWith(" ") || lines[i].trim() === "")) i++; // skip rest of _meta
  while (i < lines.length) {
    if (/^[A-Za-z0-9_]+:$/.test(lines[i])) {
      let j = i + 1;
      const block = [];
      while (j < lines.length && !/^[A-Za-z0-9_]+:$/.test(lines[j])) {
        block.push(lines[j]);
        j += 1;
      }
      blocks.push(block.join("\n"));
      i = j;
    } else {
      i += 1;
    }
  }
  return blocks;
}

/** Extract a flow-style JSON-compatible array value for `key` from one
 *  record block (lemmas/pos are double-quoted string arrays — valid JSON
 *  once isolated), balancing brackets across a line wrap if one occurs. */
export function extractArray(block, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(\\[.*)$`, "m");
  const m = re.exec(block);
  if (!m) return null;
  let buf = m[1];
  let depth = (buf.match(/\[/g) || []).length - (buf.match(/\]/g) || []).length;
  const afterIdx = block.indexOf(m[0]) + m[0].length;
  const rest = block.slice(afterIdx).split("\n");
  let ri = 0;
  while (depth > 0 && ri < rest.length) {
    buf += `\n${rest[ri]}`;
    depth += (rest[ri].match(/\[/g) || []).length - (rest[ri].match(/\]/g) || []).length;
    ri += 1;
  }
  try { return JSON.parse(buf); } catch { return null; }
}

/** Extract the `text:` folded single-quoted scalar (YAML's own `''` ->
 *  literal `'` escape; line breaks folded to spaces). */
export function extractText(block) {
  const m = /^\s*text:\s*'/m.exec(block);
  if (!m) return null;
  const start = block.indexOf("'", m.index);
  let i = start + 1;
  let raw = "";
  while (i < block.length) {
    if (block[i] === "'") {
      if (block[i + 1] === "'") { raw += "'"; i += 2; continue; }
      break;
    }
    raw += block[i];
    i += 1;
  }
  return raw.replace(/\s+/g, " ").trim();
}

export const NOUN_POS = new Set(["NN", "NNS"]);

/** Simple-grammar filter: short, no semicolons/colons, no embedded quotes
 *  (which signal reported speech), no more than one comma — a rough proxy for
 *  "no complex embedded clauses". */
export function isSimpleSentence(text, wordCount) {
  if (wordCount > 18) return false;
  if (/[;:]/.test(text)) return false;
  if ((text.match(/,/g) || []).length > 1) return false;
  if (/"/.test(text)) return false;
  return true;
}
