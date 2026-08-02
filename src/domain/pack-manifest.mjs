// What `npm pack` would publish, compared against the committed expected
// manifest. Pure — the caller reads the pack JSON and the manifest file and
// prints the difference (scripts/check-pack-manifest.mjs).
//
// The file list is only half the question. `files` carries `src/` wholesale and
// then subtracts modules by name, so a shipped module can grow an import of a
// subtracted one and still pack cleanly — the tarball then fails at require
// time in a consumer's install, where nothing in this repo can see it.
// unshippedImports closes that half: it walks the graph the package's own entry
// points reach and names any edge that leaves the shipped set.

import { relativeSpecifiers } from "./relative-specifiers.mjs";

// Node ESM needs the extension, so only these two can name a module on disk.
// Anything else a source file mentions relatively — ./vendor/wink.js in the
// page builders' emitted HTML — is a browser URL resolved against the deployed
// page, never against the packed tree.
const MODULE_FILE = /\.(?:mjs|json)$/;

/** Extract the sorted file-path list from `npm pack --dry-run --json` output. */
export function packedPaths(packJsonText) {
  const parsed = JSON.parse(packJsonText);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) throw new Error("unexpected npm pack --json shape: no files array");
  return entry.files.map((f) => f.path).sort();
}

/** Compare actual against expected. Returns { missing, unexpected } — both
 *  empty when the package contents match the committed manifest. */
export function comparePackManifest(actualPaths, expectedPaths) {
  const actual = new Set(actualPaths);
  const expected = new Set(expectedPaths);
  return {
    missing: [...expected].filter((p) => !actual.has(p)).sort(),
    unexpected: [...actual].filter((p) => !expected.has(p)).sort(),
  };
}

/** Resolve a relative specifier against the module that wrote it, both as
 *  package-root-relative POSIX paths — the shape `npm pack` reports. */
function resolveAgainst(fromPath, specifier) {
  const segments = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    else if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

/** Every import edge that would break in the packed tarball: walk the module
 *  graph from `entryPaths` and collect each relative specifier whose target is
 *  not in `packedPaths`. `readSource(path)` returns a module's source text, or
 *  null when the path names no readable file. Returns `{ from, specifier,
 *  target }` rows, sorted, one per distinct edge. */
export function unshippedImports({ packedPaths, entryPaths, readSource }) {
  const packed = new Set(packedPaths);
  const walked = new Set();
  const pending = [...entryPaths];
  const broken = new Map();
  while (pending.length > 0) {
    const from = pending.pop();
    if (walked.has(from)) continue;
    walked.add(from);
    if (!from.endsWith(".mjs")) continue;
    const source = readSource(from);
    if (source == null) continue;
    for (const specifier of relativeSpecifiers(source)) {
      if (!MODULE_FILE.test(specifier)) continue;
      const target = resolveAgainst(from, specifier);
      if (packed.has(target)) pending.push(target);
      else broken.set(`${from} -> ${target}`, { from, specifier, target });
    }
  }
  return [...broken.values()].sort((a, b) => `${a.from}${a.target}`.localeCompare(`${b.from}${b.target}`));
}

/** The paths a consumer can load the package through: its binaries, its main,
 *  and every subpath in its exports map, package-root-relative. */
export function packageEntryPaths(packageJson) {
  const declared = [
    ...Object.values(packageJson.bin ?? {}),
    packageJson.main,
    ...Object.values(packageJson.exports ?? {}).flatMap((e) => (typeof e === "string" ? [e] : Object.values(e ?? {}))),
  ];
  return [...new Set(declared.filter((p) => typeof p === "string").map((p) => p.replace(/^\.\//, "")))].sort();
}
