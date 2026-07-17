#!/usr/bin/env node
// scripts/pii-lint.mjs — scan every tracked text file for personally
// identifying leftovers: home-directory paths, email addresses, and — in the
// playtests/ transcripts specifically — the author's personal name outside the
// intended public identity. The detectors are src/domain/pii-rules.mjs; the
// tree walk is src/adapters/pii-scan.mjs. Dependency-free (node builtins + git
// only) so CI can run it without npm ci. Exits 1 listing every finding not
// covered by scripts/pii-allowlist.json.
//
//   node scripts/pii-lint.mjs

import { scanRepo } from "../src/adapters/pii-scan.mjs";
import { CHECKS, scanText, looksBinary } from "../src/domain/pii-rules.mjs";

export { scanRepo, CHECKS, scanText, looksBinary };

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const findings = scanRepo();
  if (findings.length) {
    console.error(`${findings.length} PII finding(s) not covered by scripts/pii-allowlist.json:`);
    for (const f of findings) console.error(`  ${f.path}:${f.line}  [${f.kind}]  ${f.hit}`);
    console.error("\nScrub the file, or add an allowlist entry with a reason if the hit is a legitimate public identity/technical artefact.");
    process.exit(1);
  }
  console.log("pii lint: OK — no unallowlisted home paths, emails or personal names in tracked text files");
}
