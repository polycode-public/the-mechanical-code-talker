// module-paths.mjs — classifying a module by its path, for the graph builders and
// the rankers that read what they build.

/** Does this module path (or a lowercased path-shaped label) belong to test code?
 *  Covers `test/` and `tests/` segments, a hyphen/underscore-prefixed test directory
 *  (`behaviour-tests/`, `unit_test/`), Python's `test_*.py` convention, .NET's
 *  `*.Tests` assembly suffix, and a `.test`/`.spec` file anywhere in the tree.
 *  Case-sensitive: callers holding mixed-case paths lowercase first. */
export const isTestPath = (p) =>
  /(^|\/)tests?\//.test(p) || /(^|\/)test_[^/]*\.py$/.test(p) || /\.tests(\.|$)/.test(p)
  || /(^|\/)[^/]*[-_]tests?\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
