// The PII detectors: what counts as a personally identifying leftover in a
// tracked text file, and how a line of text is scanned for one. Pure rules —
// scripts/pii-lint.mjs drives them over the real tree through
// src/adapters/pii-scan.mjs.
//
// Pattern scope, chosen deliberately:
// - `~/foo` (bare home-relative) names no user, so it is NOT flagged;
//   `~name/` (a tilde USER area) is, except inside a URL path (academic
//   pages like …edu/~weld/ are public technical references, not PII).
// - The email regex is loose on purpose; false positives go in the
//   allowlist with a reason rather than into a looser regex.

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "webp", "svgz",
  "gz", "zip", "tgz", "br",
  "sqlite", "db",
  "woff", "woff2", "ttf", "eot",
  "pdf", "mp3", "mp4", "wasm",
]);

export const CHECKS = [
  {
    kind: "home-directory path",
    regex: /(?:\/Users|\/home)\/[A-Za-z][A-Za-z0-9._-]*/g,
  },
  {
    kind: "tilde user area",
    // ~name/ at a path start; a preceding "/" means a URL path segment.
    regex: /(?<![/\w])~[A-Za-z][A-Za-z0-9._-]*\//g,
  },
  {
    kind: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    kind: "personal name in a playtest transcript",
    regex: /\b(?:Antony|Anthony)\b(?:\s+[A-Z][a-z]+)?/g,
    onlyUnder: "playtests/",
  },
];

export function looksBinary(path, buf) {
  const ext = path.split(".").pop().toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return buf.subarray(0, 8000).includes(0);
}

export function scanText(text, path, allowlist) {
  const isAllowed = (hit) => allowlist.some((allowed) => hit.includes(allowed) || allowed.includes(hit));
  const findings = [];
  for (const { kind, regex, onlyUnder } of CHECKS) {
    if (onlyUnder && !path.startsWith(onlyUnder)) continue;
    for (const match of text.matchAll(regex)) {
      if (isAllowed(match[0])) continue;
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({ path, line, kind, hit: match[0] });
    }
  }
  return findings;
}
