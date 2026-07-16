// markdown-links.mjs — pull the relative link targets out of a markdown string.
// Pure: a string in, `[{ target, line }]` out, no filesystem and no imports, so
// the CI jobs that run without `npm ci` can reach it.
//
// Code is not prose. A doc that writes `[text](target)` inside backticks is
// showing you what a link looks like, not making one, and a checker that cannot
// tell the difference reports the example as a broken link to a file named
// "target". So the spans are blanked before the link patterns run — blanked
// rather than cut, because every offset behind them still has to name the right
// line number.

const blank = (line) => line.replace(/[^\n]/g, " ");
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** Replace every fenced block and inline code span with spaces, keeping the
 *  string's length and its newlines so later offsets still map to their line.
 *  Fences are walked line by line: a lazy multiline regex stops at the end of
 *  the opening fence's own line and blanks only the markers. */
export function blankCodeSpans(markdown) {
  let fence = null;
  const lines = markdown.split("\n").map((line) => {
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return blank(line);
    }
    if (marker) fence = marker;
    return marker ? blank(line) : line;
  });
  return lines.join("\n").replace(/(`+)[\s\S]*?\1/g, blank);
}

// Inline links/images: [text](target "title") — target ends at the first
// whitespace or closing paren. Reference definitions: [label]: target.
const INLINE_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REFERENCE_DEF = /^\s{0,3}\[[^\]]+\]:\s+(\S+)/gm;

/** Every repo-relative link target in `markdown`, with the 1-based line it sits
 *  on. External URLs, bare #anchors and absolute paths are out of scope. */
export function relativeTargets(markdown) {
  const prose = blankCodeSpans(markdown);
  const targets = [];
  for (const regex of [INLINE_LINK, REFERENCE_DEF]) {
    for (const match of prose.matchAll(regex)) {
      let target = match[1];
      if (/^(https?|mailto|ftp):/i.test(target)) continue;
      if (target.startsWith("#") || target.startsWith("/") || target.startsWith("<")) continue;
      target = decodeURIComponent(target.split("#")[0].split("?")[0]);
      if (!target) continue;
      const line = prose.slice(0, match.index).split("\n").length;
      targets.push({ target, line });
    }
  }
  return targets;
}
