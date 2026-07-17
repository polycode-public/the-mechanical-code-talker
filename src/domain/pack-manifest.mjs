// What `npm pack` would publish, compared against the committed expected
// manifest. Pure — the caller reads the pack JSON and the manifest file and
// prints the difference (scripts/check-pack-manifest.mjs).

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
