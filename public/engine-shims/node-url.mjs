// node-url.mjs — browser stand-in for `node:url`, mapped via the page's import map.
//
// fileURLToPath is read by grammar/lexicon.mjs (real call path — see node-fs.mjs's
// header) and by embed.mjs (inert unless embedRank is opted in, which this page never
// does). A real `file://` URL never exists in the browser, so this just strips the
// scheme if present and returns whatever string it's given otherwise — the result
// only ever flows into node-path.mjs's dirname/join, which don't need real filesystem
// semantics, only a stable string.

export function fileURLToPath(url) {
  const s = String(url);
  return s.startsWith("file://") ? s.slice("file://".length) : s;
}
