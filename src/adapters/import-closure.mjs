// Every file under `root` that `entry`'s relative imports reach, walked from
// source at read time and returned as paths relative to root, sorted.
//
// `seeds` names extra entry points to fold into the same closure — modules that
// arrive through a computed specifier a static read cannot follow (a lemma/POS
// tier loaded by a variable), so they and everything they reach still get
// walked.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { relativeSpecifiers } from "../domain/relative-specifiers.mjs";

export function importClosure(entry, { root, seeds = [] } = {}) {
  const reached = new Set();
  const visit = (file) => {
    const rel = relative(root, file);
    if (reached.has(rel) || !existsSync(file)) return;
    reached.add(rel);
    if (file.endsWith(".json")) return;
    const source = readFileSync(file, "utf8");
    for (const specifier of relativeSpecifiers(source)) {
      visit(resolve(dirname(file), specifier));
    }
  };
  visit(join(root, entry));
  for (const file of seeds) visit(join(root, file));
  return [...reached].sort();
}
