// node-path.mjs — browser stand-in for `node:path`, mapped via the page's import map.
//
// Genuinely functional (not a throwing stub): grammar/lexicon.mjs computes
// `join(dirname(fileURLToPath(import.meta.url)), "lexicon-core.json")` on every
// loadLexicon() call (see node-fs.mjs's header for why that path really executes),
// so dirname/join need to produce SOME sane string — node-fs.mjs's readFileSync
// only matches on the "lexicon-core.json" suffix, so exact POSIX fidelity doesn't
// matter, but a plain forward-slash join/dirname is cheap and correct enough.
//
// embed.mjs also imports join/dirname (its own defaultEmbeddingsDir), but that
// function is only reached behind the embedRank opt-in flag this page never sets.

export function dirname(path) {
  const s = String(path);
  const idx = s.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return s.slice(0, idx);
}

export function join(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== "")
    .join("/")
    .replace(/\/+/g, "/");
}
