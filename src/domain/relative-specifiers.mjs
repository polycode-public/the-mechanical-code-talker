// The relative import/export specifiers in a module's source text, unique and
// in first-seen order. Relative only: bare specifiers (wink-nlp) and node
// builtins are somebody else's concern — an import map, a shim. Covers the
// three forms a specifier arrives in: after a from keyword (static import and
// re-export), a dynamic import call, and a bare side-effect import.
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.[^"']*)["']/g;

export function relativeSpecifiers(text) {
  const specs = new Set();
  for (const [, specifier] of text.matchAll(RELATIVE_SPECIFIER)) specs.add(specifier);
  return [...specs];
}
