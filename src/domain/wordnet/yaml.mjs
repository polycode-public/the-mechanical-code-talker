// yaml.mjs — a reader for the small YAML subset the Open English WordNet dump
// uses: 2-space-indented block mappings/sequences, quoted or bare scalars, and
// long scalar list-items that simply WRAP onto a further-indented continuation
// line. No block scalars, no anchors, no flow style — confirmed by direct
// inspection of the dump. This reads exactly that subset; it is not a general
// YAML parser.
//
// Pure: text in, object out, no imports, so it is testable without the WordNet
// clone the scripts that call it need.

/** Non-greedy key group so a MULTI-WORD entry key ("M-1 rifle", "ice cream")
 *  still matches — the first ": "/end-of-line colon wins, exactly as real
 *  YAML's block-mapping key/value split works. A plain wrapped scalar
 *  continuation line (a definition/example fragment) only coincidentally
 *  matches this if it ALSO happens to contain a bare "word: " sequence — rare
 *  in this corpus's prose, and this feeds a maintainer worksheet whose output
 *  is hand-reviewed, not a correctness-critical parser. */
const KEY_RE = /^(.+?):(\s+(.*)|)$/;

const isDash = (t) => t === "-" || t.startsWith("- ");

function parseScalar(s) {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'") && t.length >= 2) || (t.startsWith('"') && t.endsWith('"') && t.length >= 2)) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseYaml(text) {
  const rawLines = text.split("\n");
  const lines = [];
  for (const line of rawLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    lines.push({ indent, text: line.trimStart() });
  }
  let pos = 0;

  // A scalar that may continue on subsequent MORE-indented lines with no
  // "key:"/"- " marker of their own (WordNet's definition-wrapping style). A
  // QUOTED scalar ('...' or "...") is handled separately: WordNet definitions
  // routinely contain a literal ": " inside the quoted text itself (e.g. "…
  // Matthew, Mark, Luke, and John" split across a line boundary right after a
  // colon) — the bare-scalar heuristic below would misread that continuation
  // line as a new "key:" line and truncate the string. Once inside an open
  // quote, EVERY line is a continuation until one ends with the matching
  // closing quote, full stop — the key/dash heuristic never applies inside it.
  function parseScalarOrContinue(first, minContinIndent) {
    const trimmed = first.trim();
    const quote = trimmed[0] === "'" || trimmed[0] === '"' ? trimmed[0] : null;
    if (quote) {
      const closes = (s) => s.length >= 2 && s.endsWith(quote);
      let buf = trimmed;
      while (!closes(buf) && pos < lines.length && lines[pos].indent >= minContinIndent) {
        buf += " " + lines[pos].text.trim();
        pos += 1;
      }
      return closes(buf) ? buf.slice(1, -1) : buf;
    }
    let s = parseScalar(first);
    while (pos < lines.length && lines[pos].indent >= minContinIndent
      && !isDash(lines[pos].text) && !KEY_RE.test(lines[pos].text)) {
      s += " " + lines[pos].text.trim();
      pos += 1;
    }
    return s;
  }

  /** The value that follows a "key:" (bare, no inline scalar) — peeks at the
   *  next line to decide whether it's a nested sequence (which YAML allows to
   *  sit at the SAME indent as the key itself, not just deeper) or a nested
   *  mapping (which must be deeper) or simply absent (null). `parentIndent`
   *  is the indent of the "key:" line whose value this resolves. */
  function parseValue(parentIndent) {
    if (pos >= lines.length || lines[pos].indent < parentIndent) return null;
    const line = lines[pos];
    if (isDash(line.text)) return parseSeq(line.indent);
    if (line.indent > parentIndent && KEY_RE.test(line.text)) return parseMap(line.indent);
    return null;
  }

  function parseSeq(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && isDash(lines[pos].text)) {
      const dashIndent = indent;
      const rest = lines[pos].text === "-" ? "" : lines[pos].text.slice(2);
      pos += 1;
      if (rest === "") {
        arr.push(parseValue(dashIndent));
        continue;
      }
      // A quoted scalar is classified FIRST, unconditionally — WordNet
      // definitions routinely contain a literal ": " (or a colon at the very
      // end of a wrapped line, e.g. "…including:\n  whales, …") inside quoted
      // prose, which KEY_RE would otherwise misread as an inline "- key:"
      // mapping. Only an UNQUOTED rest is even considered for that shape.
      const quoted = rest[0] === "'" || rest[0] === '"';
      const m = quoted ? null : KEY_RE.exec(rest);
      if (m) {
        // "- key: value" or "- key:" — an inline mapping for this list item;
        // sibling keys of the SAME item are indented +2 from the dash.
        const obj = {};
        obj[m[1]] = m[3] !== undefined && m[3] !== "" ? parseScalarOrContinue(m[3], dashIndent + 2) : parseValue(dashIndent + 2);
        while (pos < lines.length && lines[pos].indent === dashIndent + 2 && KEY_RE.test(lines[pos].text)) {
          const mm = KEY_RE.exec(lines[pos].text);
          pos += 1;
          obj[mm[1]] = mm[3] !== undefined && mm[3] !== "" ? parseScalarOrContinue(mm[3], dashIndent + 4) : parseValue(dashIndent + 2);
        }
        arr.push(obj);
      } else {
        // a plain (or quoted) scalar list item — may wrap onto continuation lines
        arr.push(parseScalarOrContinue(rest, dashIndent + 2));
      }
    }
    return arr;
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && KEY_RE.test(lines[pos].text)) {
      const m = KEY_RE.exec(lines[pos].text);
      const key = parseScalar(m[1]);
      pos += 1;
      obj[key] = m[3] !== undefined && m[3] !== "" ? parseScalarOrContinue(m[3], indent + 2) : parseValue(indent);
      // (parseValue(indent) — not indent+2 — so a same-indent sequence value
      // is recognized; parseValue itself accepts child indent >= indent.)
    }
    return obj;
  }

  return parseMap(0);
}
